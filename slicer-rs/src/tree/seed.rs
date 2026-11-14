//! Where the trees start (Orca's `generate_initial_areas` and `sample_overhang_area`): under each overhang, two
//! layers of roof (a contact layer and an interface) where it is large enough, then tips sampled along the
//! support pattern's lines a layer under the roofs, a little apart; under a thin overhang along a wall, tips
//! around its outline. Each tip starts as a 10 µm circle that the growth widens.

use super::grow::{Element, State};
use super::util::{self, MITER};
use super::volumes::{Avoid, Volumes};
use super::{Config, mm};
use crate::base_support;
use crate::geom::{self, Pt, Shape, Shapes};
use std::collections::HashSet;

/// Where a tip may go from its point: to the plate or the model, and whether through the "safe" avoidance.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    ToModel,
    ToModelGracious,
    ToModelGraciousSafe,
    ToPlate,
    ToPlateSafe,
}

type Line = Vec<(Pt, Status)>;

/// What seeding hands the growth: each layer's tips, and the roofs it placed.
pub struct Seeds {
    pub layers: Vec<Vec<Element>>,
    /// Each layer's contact roofs and interface roofs, not combined.
    pub contacts: Vec<Shapes>,
    pub interfaces: Vec<Shapes>,
}

/// The shared things seeding works with.
pub struct Seeder<'a> {
    pub c: &'a Config,
    pub v: &'a Volumes,
    /// Units: the middle of the object's bounding box, which fill lines turn about.
    pub origin: (f64, f64),
    /// mm: the support line's spacing (Orca's float flow).
    pub spacing: f64,
    /// The roofs' density (Orca's float).
    pub roof_density: f64,
    min_xy: bool,
    roof_layers: usize,
    connect_length: f64,
    out: Seeds,
    taken: Vec<HashSet<(i64, i64)>>,
    base_circle: geom::Contour,
}

impl<'a> Seeder<'a> {
    pub fn new(c: &'a Config, v: &'a Volumes, origin: (f64, f64), spacing: f64, roof_density: f64, n: usize) -> Self {
        let lw = c.support_line_width as f64;
        let connect_length = (lw * 100.0 / c.top_rate + (2.0 * c.min_radius as f64 - lw).max(0.0)) as i64 as f64;
        Seeder {
            c,
            v,
            origin,
            spacing,
            roof_density,
            min_xy: c.xy_distance > c.xy_min_distance,
            roof_layers: c.support_roof_layers,
            connect_length,
            out: Seeds { layers: vec![Vec::new(); n], contacts: vec![Vec::new(); n], interfaces: vec![Vec::new(); n] },
            taken: vec![HashSet::new(); n],
            base_circle: geom::make_circle(0.01, 25e-6),
        }
    }

    pub fn finish(self) -> Seeds {
        self.out
    }

    fn r0(&self) -> i64 {
        self.c.radius(0, 0.0)
    }

    /// Where a tip on `layer` must not be: the model's collision (with the smallest gap), grown 5 µm.
    fn forbidden(&self, layer: usize) -> Shapes {
        let area = if self.c.support_rests_on_model {
            self.v.collision(self.r0(), layer, self.min_xy)
        } else {
            self.v.avoidance(self.r0(), layer, Avoid::Fast, false, self.min_xy)
        };
        util::offset(area, 5_000.0, MITER)
    }

    /// The support pattern's lines over `polygons` (`generate_support_infill_lines`): roofs in the interface's
    /// diagonal lines, a quarter turn from layer to layer, tips without a roof on the base pattern's, `distance` nm
    /// apart, each part's lines through the middle of its outline.
    fn support_lines(&self, polygons: &Shapes, roof: bool, layer: usize, distance: i64) -> Vec<Vec<Pt>> {
        let half_pi = std::f32::consts::FRAC_PI_2;
        let quarter = std::f32::consts::FRAC_PI_4;
        let angle =
            if roof { (half_pi + if layer & 1 == 1 { -quarter } else { quarter }) + half_pi } else { half_pi } as f64;
        let density = if roof {
            self.roof_density as f32 as f64
        } else {
            let s = (self.spacing * 1e6) as f32;
            (s / (s + distance as f32)) as f64
        };
        let mut out = Vec::new();
        for shape in &util::union(polygons, &Vec::new()) {
            let b = geom::bbox_of(shape);
            let centre = geom::pt((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
            out.extend(base_support::fill_on_grid(shape, angle, self.origin, Some(centre), self.spacing, density));
        }
        out
    }

    /// Each point's way down, splitting a line where a point has none (`convert_lines_to_internal`).
    fn classify(&self, polylines: &[Vec<Pt>], layer: usize) -> Vec<Line> {
        let r0 = self.r0();
        let rests = self.c.support_rests_on_model;
        let mut out = Vec::new();
        for line in polylines {
            let mut run: Line = Vec::new();
            for &p in line {
                let outside = |a: &Shapes| !util::contains(a, p);
                let status = if outside(self.v.avoidance(r0, layer, Avoid::FastSafe, false, self.min_xy)) {
                    Some(Status::ToPlateSafe)
                } else if outside(self.v.avoidance(r0, layer, Avoid::Fast, false, self.min_xy)) {
                    Some(Status::ToPlate)
                } else if rests && outside(self.v.avoidance(r0, layer, Avoid::FastSafe, true, self.min_xy)) {
                    Some(Status::ToModelGraciousSafe)
                } else if rests && outside(self.v.avoidance(r0, layer, Avoid::Fast, true, self.min_xy)) {
                    Some(Status::ToModelGracious)
                } else if rests && outside(self.v.collision(r0, layer, self.min_xy)) {
                    Some(Status::ToModel)
                } else {
                    None
                };
                match status {
                    Some(s) => run.push((p, s)),
                    None if !run.is_empty() => out.push(std::mem::take(&mut run)),
                    None => {}
                }
            }
            if !run.is_empty() {
                out.push(run);
            }
        }
        out
    }

    /// Whether a point of `layer` still has its way down from the layer below
    /// (`evaluate_point_for_next_layer_function`).
    fn holds_below(&self, layer: usize, (p, s): (Pt, Status)) -> bool {
        let r0 = self.r0();
        let below = layer - 1;
        let kind = |safe: bool| if safe { Avoid::FastSafe } else { Avoid::Fast };
        if !util::contains(self.v.avoidance(r0, below, kind(s == Status::ToPlateSafe), false, self.min_xy), p) {
            return true;
        }
        if self.c.support_rests_on_model && !matches!(s, Status::ToPlate | Status::ToPlateSafe) {
            let area = if matches!(s, Status::ToModelGracious | Status::ToModelGraciousSafe) {
                self.v.avoidance(r0, below, kind(s == Status::ToModelGraciousSafe), true, self.min_xy)
            } else {
                self.v.collision(r0, below, self.min_xy)
            };
            return !util::contains(area, p);
        }
        false
    }

    /// Lines cut into runs that keep (`keep`) and that don't (`split_lines`).
    fn split(lines: &[Line], mut keeps: impl FnMut((Pt, Status)) -> bool) -> (Vec<Line>, Vec<Line>) {
        let (mut keep, mut free) = (Vec::new(), Vec::new());
        for line in lines {
            let mut current = true;
            let mut run: Line = Vec::new();
            for &me in line {
                if keeps(me) != current {
                    if !run.is_empty() {
                        if current { &mut keep } else { &mut free }.push(std::mem::take(&mut run));
                    }
                    current = !current;
                }
                run.push(me);
            }
            if !run.is_empty() {
                if current { &mut keep } else { &mut free }.push(run);
            }
        }
        (keep, free)
    }

    /// Roofs on their layers: the first a contact layer, the next ones interface (`InterfacePlacer`).
    fn add_roof(&mut self, roof: &Shapes, layer: usize, depth: usize) {
        let target = if depth == 0 { &mut self.out.contacts } else { &mut self.out.interfaces };
        if depth == 0 || depth <= self.roof_layers {
            target[layer].extend(roof.iter().cloned());
        }
    }

    /// A tip on `layer` (`add_point_as_influence_area`): the first in each 40 µm cell of the layer.
    fn add_point(&mut self, (p, s): (Pt, Status), layer: usize, dont_move_until: usize, roof: bool, skip_oval: bool) {
        let to_plate = matches!(s, Status::ToPlate | Status::ToPlateSafe);
        let gracious = to_plate || matches!(s, Status::ToModelGracious | Status::ToModelGraciousSafe);
        let safe = matches!(s, Status::ToPlateSafe | Status::ToModelGraciousSafe);
        if !self.c.support_rests_on_model && !to_plate {
            return;
        }
        // Cells in the object's frame, in nanometres, truncated towards zero.
        let cell = (self.c.min_radius + 1) / 10;
        let frame = |v: i32, o: f64| ((v as f64 - o) * 100.0) as i64 / cell;
        let hash = (frame(p.x, self.origin.0), frame(p.y, self.origin.1));
        if !self.taken[layer].insert(hash) {
            return;
        }
        let state = State {
            target_height: layer,
            target_position: p,
            next_position: p,
            layer,
            result_on_layer: Some(p),
            to_buildplate: to_plate,
            to_model_gracious: gracious,
            use_min_xy_dist: self.min_xy,
            supports_roof: roof,
            dont_move_until,
            can_use_safe_radius: safe,
            skip_ovalisation: skip_oval,
            ..State::default()
        };
        let circle: Shape = vec![self.base_circle.iter().map(|q| geom::pt(q.x + p.x, q.y + p.y)).collect()];
        self.out.layers[layer].push(Element { state, parents: Vec::new(), area: vec![circle] });
    }

    /// Tips along the lines (`add_points_along_lines`, without tips forced into roofs).
    fn add_points_along_lines(&mut self, lines: Vec<Line>, layer: usize, roof_layers: usize, dont_move_until: usize) {
        for line in &lines {
            let skip = self.c.min_radius < 3 * self.c.support_line_width && line.len() > 5;
            for &p in line {
                self.add_point(p, layer, dont_move_until, roof_layers > 0, skip);
            }
        }
    }

    /// The roofs and tips under one part of an overhang on `layer` (`sample_overhang_area`).
    fn sample(&mut self, mut area: Shapes, roof: bool, layer: usize) {
        let c = self.c;
        let r = self.roof_layers;
        let roof_distance = c.support_roof_line_distance;
        let mut lines: Vec<Line> = Vec::new();
        let mut dtt_roof = 0;
        let mut generation_dtt = 0;
        if roof {
            let mut added: Vec<Shapes> = vec![Vec::new(); r];
            let mut last = area.clone();
            while dtt_roof < r && layer > dtt_roof {
                let next = util::diff(&area, &self.forbidden(layer - dtt_roof - 1));
                if util::area(&next) < 1e12 {
                    if dtt_roof > 0 {
                        let b = dtt_roof - 1;
                        let roof_lines = self.support_lines(&last, true, layer - b, roof_distance);
                        let sampled = ensure_maximum_distance(roof_lines, self.connect_length, 1);
                        let classified = self.classify(&sampled, layer - b);
                        lines = Self::split(&classified, |p| self.holds_below(layer - b, p)).0;
                    }
                    break;
                }
                added[dtt_roof] = area.clone();
                last = area;
                area = next;
                dtt_roof += 1;
            }
            generation_dtt = dtt_roof.max(1) - 1;
            if lines.is_empty()
                && dtt_roof != 0
                && self.support_lines(&area, true, layer - generation_dtt, roof_distance).is_empty()
            {
                for (idx, roof) in added.iter().enumerate().take(dtt_roof) {
                    if self.support_lines(roof, true, layer - idx, roof_distance).is_empty() {
                        dtt_roof = idx;
                        generation_dtt = dtt_roof.max(1) - 1;
                        break;
                    }
                }
            }
            added.truncate(dtt_roof);
            for (idx, roof) in added.iter().enumerate() {
                if !roof.is_empty() {
                    self.add_roof(roof, layer - idx, idx);
                }
            }
        }
        if lines.is_empty() {
            let supports_roof = dtt_roof > 0;
            let continuous = !supports_roof && roof;
            let distance = if supports_roof { roof_distance } else { c.branch_distance };
            let pattern = self.support_lines(&area, supports_roof, layer - generation_dtt, distance);
            let spacing = if continuous { (c.min_radius / 2) as f64 } else { self.connect_length };
            let mut polylines = ensure_maximum_distance(pattern, spacing, 1);
            let points: usize = polylines.iter().map(Vec::len).sum();
            let perimeter: f64 = area.iter().flatten().map(|ring| geom::length_mm(ring, true) * 1e6).sum();
            let min_points = ((perimeter / self.connect_length) as i64).clamp(1, 3) as usize;
            if points <= min_points {
                let reduced = util::offset(&area, (-(c.support_line_width as f64) / 2.2) as f32 as f64, MITER);
                let ring = util::offset(
                    &util::diff(&area, &reduced),
                    (c.support_line_width as f64).max(self.connect_length),
                    MITER,
                );
                let outline = if !reduced.is_empty() && util::area(&ring) < 1e6 { reduced } else { area.clone() };
                let closed: Vec<Vec<Pt>> = outline
                    .iter()
                    .flatten()
                    .map(|ring| {
                        let mut line = ring.clone();
                        line.push(ring[0]);
                        line
                    })
                    .collect();
                polylines = ensure_maximum_distance(closed, self.connect_length, min_points);
            }
            lines = self.classify(&polylines, layer - dtt_roof);
        }
        if dtt_roof >= layer && roof {
            let depth = dtt_roof.min(r);
            self.add_roof(&area, 0, depth);
        } else {
            let dont_move = if r > 0 { r - dtt_roof } else { 0 };
            self.add_points_along_lines(lines, layer - dtt_roof, dtt_roof, dont_move);
        }
    }

    /// Roofs and tips under every overhang (`generate_initial_areas`): those of object layer `l + 2` (the top gap
    /// and a layer) on support layer `l`, in ascending order.
    pub fn seed(&mut self, overhangs: &[Shapes]) {
        let c = self.c;
        let delta = c.z_distance_top_layers + 1;
        let layers = overhangs.len();
        let lw = c.support_line_width;
        let extra_outset = (c.min_radius - lw / 2).max(0) + if self.min_xy { lw / 2 } else { 0 };
        let half_change = if c.min_radius < lw {
            c.min_radius / 2
        } else {
            let (r, h) = (mm(c.min_radius as f64), mm((c.min_radius - lw / 2) as f64));
            ((r * r - h * h).sqrt() / 1e-6) as i64
        };
        for l in 1..layers.saturating_sub(delta) {
            if l >= self.out.layers.len() {
                break;
            }
            let raw = &overhangs[l + delta];
            if raw.is_empty() {
                continue;
            }
            let forbidden = self.forbidden(l);
            let mut regular = util::safe_offset_inc(raw, 0, &forbidden, 0, 0, 1);
            let mut remaining = util::intersection(
                &util::diff(raw, &util::offset(&regular, (lw as f64 * 0.5) as f32 as f64, MITER)),
                &forbidden,
            );
            let mut acc: i64 = 0;
            while !remaining.is_empty() && acc + lw / 8 < extra_outset {
                let step = (if acc + 2 * lw > c.min_radius { lw / 8 } else { half_change }).min(extra_outset - acc);
                acc += step;
                let raw_collision = self.v.collision(0, l, true);
                let offset_step = c.xy_min_distance + lw;
                let grown =
                    util::safe_offset_inc(&regular, (1.5 * acc as f64) as i64, raw_collision, offset_step, 0, 1);
                remaining = util::diff(&remaining, &grown);
                let out = util::safe_offset_inc(&remaining, acc, raw_collision, offset_step, 0, 1);
                regular = util::union(&regular, &util::diff(&out, &forbidden));
            }
            if self.roof_layers > 0 {
                let roofs = util::safe_offset_inc(raw, 0, &forbidden, 0, 0, 1);
                regular = util::diff(&regular, &roofs);
                for part in &util::union(&roofs, &Vec::new()) {
                    self.sample(vec![part.clone()], true, l);
                }
            }
            for part in &util::union(&regular, &Vec::new()) {
                self.sample(vec![part.clone()], false, l);
            }
        }
    }
}

/// Points along each line at least `distance` nm from every other point of the line, its start and far end first
/// (`ensure_maximum_distance_polyline`); at least `min_points` of them, closer if need be.
pub fn ensure_maximum_distance(input: Vec<Vec<Pt>>, distance: f64, min_points: usize) -> Vec<Vec<Pt>> {
    let units = |nm: f64| nm / 100.0;
    let mut out = Vec::new();
    for mut part in input {
        if part.is_empty() {
            continue;
        }
        let len = units(geom::length_mm(&part, false) * 1e6);
        let distance = units(distance);
        let mut line: Vec<Pt> = Vec::new();
        let mut current = distance.max(units(100_000.0));
        if len < 2.0 * distance && min_points <= 1 {
            line.push(clip_end_point(&part, len / 2.0));
        } else {
            let mut optimal_end = part.len() - 1;
            if part.first() == part.last() && part.len() > 1 {
                let mut start = 0;
                let mut best: i64 = 0;
                for i in 0..part.len() - 1 {
                    for j in 0..part.len() - 1 {
                        let d2 = geom::dist(part[i], part[j]).powi(2);
                        if d2 > best as f64 {
                            start = i;
                            optimal_end = j;
                            best = d2 as i64;
                        }
                    }
                }
                let n = part.len();
                part[..n - 1].rotate_left(start);
                part[n - 1] = part[0];
                optimal_end = (n + optimal_end - start - 1) % (n - 1);
            }
            while line.len() < min_points && current >= units(100_000.0) {
                line.clear();
                line.push(part[0]);
                if min_points > 1 || geom::dist(part[0], part[optimal_end]) > current {
                    line.push(part[optimal_end]);
                }
                let (mut at, mut index, mut next) = (part[0], 0usize, current);
                while let Some((p, segment)) = sample_next(&part, at, index, next) {
                    let nearest = line.iter().map(|q| geom::dist(*q, p)).fold(f64::MAX, f64::min);
                    if nearest >= current {
                        line.push(p);
                        (at, index, next) = (p, segment, current);
                    } else {
                        if at == p {
                            if next > 2.0 * current {
                                break;
                            }
                            next += current;
                            continue;
                        }
                        next = (current - nearest).max(units(100_000.0));
                        (at, index) = (p, segment);
                    }
                }
                current *= 0.9;
            }
        }
        out.push(line);
    }
    out
}

/// The point `dist` (units) from `start` along the polyline after point `start_idx`
/// (`polyline_sample_next_point_at_distance`).
fn sample_next(polyline: &[Pt], start: Pt, start_idx: usize, dist: f64) -> Option<(Pt, usize)> {
    let dist2 = dist * dist;
    let dist2i = dist2 as i64;
    let eps = 100.0;
    for i in start_idx + 1..polyline.len() {
        let p1 = polyline[i];
        let (dx, dy) = ((p1.x - start.x) as i64, (p1.y - start.y) as i64);
        if dx * dx + dy * dy < dist2i {
            continue;
        }
        let p0 = polyline[i - 1];
        let v = ((p1.x - p0.x) as f64, (p1.y - p0.y) as f64);
        let l2v = v.0 * v.0 + v.1 * v.1;
        if l2v < eps * eps {
            let c = geom::pt((p0.x + p1.x) / 2, (p0.y + p1.y) / 2);
            if (geom::dist(start, c) - dist).abs() < eps {
                return Some((c, i - 1));
            }
            continue;
        }
        let p0f = ((start.x - p0.x) as f64, (start.y - p0.y) as f64);
        let k = (p0f.0 * v.0 + p0f.1 * v.1) / l2v;
        let foot = (v.0 * k, v.1 * k);
        let xf = (p0f.0 - foot.0, p0f.1 - foot.1);
        let l2 = dist2 - (xf.0 * xf.0 + xf.1 * xf.1);
        if l2 > -0.01 {
            let l2 = l2.max(0.0);
            let rest = (v.0 - foot.0).powi(2) + (v.1 - foot.1).powi(2);
            if rest >= l2 {
                let t = (l2 / l2v).sqrt();
                let p = geom::pt(p0.x + (foot.0 + v.0 * t) as i32, p0.y + (foot.1 + v.1 * t) as i32);
                return Some((p, i - 1));
            }
        }
    }
    None
}

/// The point `distance` (units) back from a polyline's end (Orca's `clip_end`, then its last point).
fn clip_end_point(line: &[Pt], mut distance: f64) -> Pt {
    let mut points = line.to_vec();
    while points.len() >= 2 {
        let last = points[points.len() - 1];
        let before = points[points.len() - 2];
        let segment = geom::dist(before, last);
        if segment > distance {
            let t = distance / segment;
            let along = |a: i32, b: i32| (a as f64 + (b - a) as f64 * t) as i32;
            return geom::pt(along(last.x, before.x), along(last.y, before.y));
        }
        distance -= segment;
        points.pop();
    }
    points.first().copied().unwrap_or(line[0])
}
