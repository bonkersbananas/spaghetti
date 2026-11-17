//! Each layer's extrusions in Orca's print order: its islands on a tour that ends next to the plate's origin, each
//! island's walls (around each hole and then the outline, the deepest loop first), then its infill and gap fill
//! chained together as Orca chains them (`order.rs`). Outlines run counter-clockwise and holes clockwise, from the
//! island's rear (a seam that lines up layer to layer), each stopping the seam gap short of where it started. Widths, flows, speeds and accelerations are Orca's for the
//! role; speeds are capped by the filament's volumetric limit. Every path is simplified as Orca simplifies its paths
//! (`geom::simplify_line`, to the profile's resolution, 0.04 mm for sparse infill). Walls and bridges then meet the
//! layer below (`overhang.rs`): a wall's stretches beyond it print as overhang walls, and both slow down where they
//! hang.

use crate::arc_fit;
use crate::config::{ArcFitting, Settings};
use crate::fill;
use crate::geom::{self, Contour, Pt, Shapes};
use crate::infill;
use crate::medial;
use crate::monotonic;
use crate::order;
use crate::overhang::Below;
use crate::region::{self, Fills, Island, LayerRegions, Role};
use crate::solid;
use crate::support;

#[derive(Clone, Debug)]
pub struct Path {
    pub role: Role,
    /// A loop repeats its first point at the end.
    pub points: Vec<Pt>,
    pub closed: bool,
    pub width: f64,
    /// mm: how high it is laid down, the layer's height but for thick bridges and supports of their own height
    /// (Orca writes it as `; LAYER_HEIGHT:` where it changes).
    pub height: f64,
    pub mm3_per_mm: f64,
    /// mm/s, before any slowing down for a short layer.
    pub speed: f64,
    pub accel: f64,
    pub island: u32,
    /// Which of the plate's objects it belongs to (an index into them).
    pub object: u32,
    /// How each segment prints, where they don't all print alike: one per segment (empty when they do).
    pub parts: Vec<Part>,
    /// The stretches of its points that print as arcs (`G2`/`G3`), in order: Orca's arc fitting (`fit`).
    pub arcs: Vec<ArcRun>,
}

/// A stretch of a path's points, `start` to `end` (indexes), that prints as one arc round `arc` (in Orca's
/// nanometres): Orca's `PathFittingData` of an arc move. The points between stay, for the wipe and the overhangs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ArcRun {
    pub start: usize,
    pub end: usize,
    pub arc: arc_fit::Arc,
}

/// How one segment of a path prints, over an overhang: a wall's stretch beyond the layer below prints as an overhang
/// wall, and walls and bridges slow down where they hang.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Part {
    pub overhang: bool,
    /// mm/s, before any slowing down for a short layer.
    pub speed: f32,
}

impl Path {
    /// What segment `k` prints as.
    pub fn role_at(&self, k: usize) -> Role {
        if self.parts.get(k).is_some_and(|p| p.overhang) { Role::OverhangWall } else { self.role }
    }

    /// What it starts and what it ends printing as.
    pub fn first_role(&self) -> Role {
        self.role_at(0)
    }

    pub fn last_role(&self) -> Role {
        self.role_at(self.points.len().saturating_sub(2))
    }

    /// The same path the other way round, its arcs too (Orca's `Polyline::reverse`).
    pub fn reverse(&mut self) {
        self.points.reverse();
        self.parts.reverse();
        let last = self.points.len().saturating_sub(1);
        for run in &mut self.arcs {
            (run.start, run.end) = (last - run.end, last - run.start);
            run.arc.reverse();
        }
        self.arcs.reverse();
    }
}

#[derive(Default)]
pub struct LayerPlan {
    /// The G-code layer's index (counting the support's own layers).
    pub index: usize,
    /// Orca's id of the layer, which its fans count by: the object layer's index, else the support layer's.
    pub id: usize,
    pub z: f64,
    /// mm: the object layer's height (the support's own paths carry theirs).
    pub height: f64,
    /// The height the layer's header gives: from the layer below's top, as Orca works it out in single precision.
    pub header_height: f32,
    pub paths: Vec<Path>,
    /// Each object's support areas on the layer: a travel to support that stays inside one needn't retract.
    pub support_islands: Vec<(u32, Shapes)>,
    /// With several filaments, where the prime tower is visited (and the filament changed) between the paths.
    pub visits: Vec<crate::toolchange::Visit>,
    /// A spiral vase's layer that is one wall loop and nothing else: it rises as it goes round (`spiral.rs`).
    pub spiral: bool,
    /// In spiral vase mode, where the nozzle comes from and how the layer's loop rises (`spiral.rs`).
    pub course: Option<crate::spiral::Course>,
}

/// The kind of each infill region, in the order they print.
const FILL_ORDER: [Role; 6] =
    [Role::Bridge, Role::InternalBridge, Role::BottomSurface, Role::SolidInfill, Role::SparseInfill, Role::TopSurface];

/// Object layer `i`'s extrusions (its top at `z`, `h` high) in print order: the islands that print anything on Orca's
/// tour of their outlines' middles (rounded to the millimetre), which starts next to the wipe tower's position, read
/// as nanometres, so next to the plate's origin, and runs backwards so the layer ends there; an object can come round
/// more than once. `centres` are the middles of the objects' bounding boxes on the plate (units), where their infill
/// patterns are anchored. On the first layer each object's `brims` (`brim.rs`) print just before it. `supports` holds
/// each object's support layer printed with this one, if any: an object with support and no islands here is a stop
/// on the tour at its middle, and its support prints when the tour first comes to it, before its islands, chained as
/// Orca chains it. A layer of the support's own, between the objects' layers, is planned as one with no islands.
/// In spiral vase mode `start` is where the nozzle is when the layer begins (the layer before's end; the plate's
/// origin, where Orca's writer reckons it, for the first): each loop starts at the point on it nearest where the
/// nozzle is then, as Orca's `extrude_loop` splits loops in that mode.
#[allow(clippy::too_many_arguments)]
pub fn plan_layer(
    r: &LayerRegions,
    lower: Option<&LayerRegions>,
    i: usize,
    (z, h): (f64, f64),
    centres: &[(f64, f64)],
    brims: &[Vec<Contour>],
    supports: &[Option<&support::Layer>],
    start: Option<Pt>,
    s: &Settings,
) -> LayerPlan {
    plan_layer_of(None, r, lower, i, (z, h), centres, brims, supports, start, s)
}

/// What one filament prints of a layer, with several filaments (`toolchange.rs`).
pub struct Only<'a> {
    /// Each object's islands: those of the objects in this filament.
    pub islands: &'a [bool],
    /// Each object's support (held by the first region of its object on the plate), where this filament prints any
    /// of it, and how.
    pub supports: &'a [Option<support::Pass>],
    /// Each object on the plate (by group), whether this filament prints its brim: the first filament on the first
    /// layer that prints any of it.
    pub brims: &'a [bool],
    /// Each object's group: the object on the plate it is a region of.
    pub group: &'a [u32],
    /// Whether some support on the layer takes a flush: each filament then prints what it flushes into first.
    pub flushing: bool,
}

/// `plan_layer` for what one filament prints of the layer (all of it when `only` is None). `brims` are by object on
/// the plate (group).
#[allow(clippy::too_many_arguments)]
pub fn plan_layer_of(
    only: Option<&Only>,
    r: &LayerRegions,
    lower: Option<&LayerRegions>,
    i: usize,
    (z, h): (f64, f64),
    centres: &[(f64, f64)],
    brims: &[Vec<Contour>],
    supports: &[Option<&support::Layer>],
    start: Option<Pt>,
    s: &Settings,
) -> LayerPlan {
    let takes = |o: u32| only.is_none_or(|only| only.islands.get(o as usize).copied().unwrap_or(false));
    let group_of = |o: u32| only.and_then(|only| only.group.get(o as usize)).map_or(o as usize, |&g| g as usize);
    // How this filament prints each object's support: all of it, but for one filament of several.
    let pass_of = |o: usize| match only {
        None => Some(support::Pass { part: support::Part::Both, flush: false }),
        Some(only) => only.supports.get(o).copied().flatten(),
    };
    let brim_here = |g: usize| only.is_none_or(|only| only.brims.get(g).copied().unwrap_or(false));
    // Each object's layer below (all of its regions: by group), where it differs from this one (where it doesn't,
    // nothing hangs).
    let mut below: Vec<Option<Below>> = Vec::new();
    if let Some(lower) = lower
        && i > 0
        && (s.detect_overhang_wall || s.overhang_speed)
    {
        let groups = r.islands.iter().map(|island| island.group as usize + 1).max().unwrap_or(0);
        below = (0..groups as u32)
            .map(|g| {
                let here: Shapes = r.islands.iter().filter(|i| i.group == g).map(|i| i.outline.clone()).collect();
                if here.is_empty() {
                    return None;
                }
                let under = lower.slice_of(g);
                // A fuzzy wall stands out beyond even a layer below just like this one.
                (under != here || s.fuzzy.on()).then(|| Below::new(&under, s))
            })
            .collect();
    }
    let island_at = |k: usize, at: Option<Pt>, rising: bool| -> Vec<Path> {
        let island = &r.islands[k];
        if !takes(island.object) {
            return Vec::new();
        }
        let centre = centres.get(island.object as usize).copied().unwrap_or((0.0, 0.0));
        let under = below.get(island.group as usize).and_then(Option::as_ref);
        let trees = r.lightning.get(island.group as usize).map_or(&[][..], Vec::as_slice);
        let octree = r.octrees.get(island.group as usize).and_then(Option::as_ref);
        let size = r.sizes.get(island.group as usize).copied().unwrap_or((0.0, 0.0));
        let seams = r.seams.get(island.group as usize);
        let frame = (centre, size);
        island_paths(k as u32, island, &r.fills[k], under, i, (z, h), frame, (trees, octree), seams, (at, rising), s)
    };
    let mut per_island: Vec<Vec<Path>> = (0..r.islands.len()).map(|k| island_at(k, None, false)).collect();
    // In spiral vase mode, a layer that is one island's wall loop and nothing else rises as it goes round, as Orca's
    // spiral takes a layer of one loop, above the bottom layers and the skirt, with no support (`process_layer`).
    let rising = start.is_some()
        && i >= s.bottom_shell_layers.max(s.skirt_height).max(1)
        && supports.iter().all(|l| l.is_none_or(|l| l.items.is_empty()))
        && per_island.iter().filter(|p| !p.is_empty()).count() == 1
        && per_island.iter().flatten().all(|p| matches!(p.role, Role::OuterWall | Role::InnerWall));
    // Each object on the plate's support that this filament prints, by the region holding it (its first).
    let groups = supports.len().max(r.islands.iter().map(|i| i.group as usize + 1).max().unwrap_or(0));
    let mut holder: Vec<Option<(usize, support::Pass)>> = vec![None; groups];
    for (o, layer) in supports.iter().enumerate() {
        if let Some(pass) = pass_of(o).filter(|_| layer.is_some_and(|l| !l.items.is_empty())) {
            holder[group_of(o as u32)] = Some((o, pass));
        }
    }
    // The tour's stops: the islands that print anything, then each object with support and nothing else here.
    let mut nodes: Vec<(Option<usize>, u32)> =
        (0..per_island.len()).filter(|&k| !per_island[k].is_empty()).map(|k| (Some(k), r.islands[k].object)).collect();
    for &(o, _) in holder.iter().flatten() {
        if !nodes.iter().any(|&(_, object)| group_of(object) == group_of(o as u32)) {
            nodes.push((None, o as u32));
        }
    }
    let mm = geom::SCALE as i32;
    let to_mm = |c: i32| (if c >= 0 { c + mm / 2 } else { c - mm / 2 }) / mm * mm;
    let points: Vec<Pt> = nodes
        .iter()
        .map(|&(k, object)| {
            let c = match k {
                Some(k) => r.islands[k].outline.first().map_or(geom::pt(0, 0), |c| geom::centroid(c)),
                None => {
                    let (x, y) = centres.get(object as usize).copied().unwrap_or((0.0, 0.0));
                    geom::pt(x.round() as i32, y.round() as i32)
                }
            };
            geom::pt(to_mm(c.x), to_mm(c.y))
        })
        .collect();
    let mut tour = order::tour(&points, Some(geom::pt(0, 2)));
    tour.reverse();
    let mut paths: Vec<Path> = Vec::new();
    // Orca reckons the nozzle at the layer's start where the layer before ended, which is planned apart: the plate's
    // origin, where the tour ends, stands in for it (in spiral vase mode, where it ended).
    let end_of =
        |paths: &[Path]| paths.last().map_or(start.unwrap_or(geom::pt(0, 0)), |p| p.points[p.points.len() - 1]);
    let mut brims_done = vec![false; brims.len()];
    // What this filament flushes into prints first (Orca's wipe extrusions), each object's on the tour's first visit
    // to it, and the first layer's brims with them.
    let flushing = only.is_some_and(|only| only.flushing);
    if flushing {
        let mut seen = vec![false; groups];
        for &t in &tour {
            let g = group_of(nodes[t].1);
            if std::mem::replace(&mut seen[g], true) {
                continue;
            }
            if i == 0 && g < brims.len() && brim_here(g) && !brims[g].is_empty() {
                brims_done[g] = true;
                let at = end_of(&paths);
                paths.extend(brim_paths(&brims[g], nodes[t].1, at, h, s));
            }
            if let Some((o, pass)) = holder[g].filter(|(_, pass)| pass.flush)
                && let Some(Some(layer)) = supports.get(o)
            {
                let at = end_of(&paths);
                paths.extend(support_paths(layer, o as u32, pass.part, at, s));
            }
        }
    }
    let mut visited = vec![false; groups];
    // Spiral vase mode: the first layer's brims print first, so its loops start where they end.
    let spiral_brims = start.is_some() && i == 0;
    for t in tour {
        let (k, object) = nodes[t];
        let g = group_of(object);
        if !std::mem::replace(&mut visited[g], true)
            && let Some((o, pass)) = holder[g].filter(|(_, pass)| !pass.flush)
            && let Some(Some(layer)) = supports.get(o)
        {
            let at = end_of(&paths);
            paths.extend(support_paths(layer, o as u32, pass.part, at, s));
        }
        if let Some(k) = k {
            if let Some(start) = start {
                if spiral_brims && g < brims.len() && !brims_done[g] && brim_here(g) {
                    brims_done[g] = true;
                    let at = paths.last().map_or(start, |p: &Path| p.points[p.points.len() - 1]);
                    paths.extend(brim_paths(&brims[g], object, at, h, s));
                }
                let at = paths.last().map_or(start, |p: &Path| p.points[p.points.len() - 1]);
                per_island[k] = island_at(k, Some(at), rising);
            }
            for p in &mut per_island[k] {
                p.object = object;
            }
            paths.append(&mut per_island[k]);
        }
    }
    if i == 0 && !spiral_brims && brims.iter().enumerate().any(|(g, b)| brim_here(g) && !brims_done[g] && !b.is_empty())
    {
        let mine: Vec<&[Contour]> = brims
            .iter()
            .enumerate()
            .map(|(g, b)| if brim_here(g) && !brims_done[g] { b.as_slice() } else { &[] })
            .collect();
        paths = with_brims(paths, &mine, &group_of, h, s);
    }
    let support_islands =
        supports.iter().enumerate().filter_map(|(o, l)| l.map(|l| (o as u32, l.islands.clone()))).collect();
    LayerPlan {
        index: i,
        id: i,
        z,
        height: h,
        header_height: h as f32,
        paths,
        support_islands,
        visits: Vec::new(),
        spiral: rising,
        course: None,
    }
}

/// A support layer's extrusions as Orca prints them on an object's first visit (`extrude_support`): chained from
/// `at` (Orca's chaining with improvements), the flange's loop and lines in their own order.
fn support_paths(layer: &support::Layer, object: u32, part: support::Part, at: Pt, s: &Settings) -> Vec<Path> {
    let first = layer.first;
    let make = |p: &support::Path| {
        let mm3_per_mm = Settings::mm3_per_mm(p.width, p.height);
        let speed = if first {
            s.first_layer_infill_speed
        } else if p.role == Role::SupportInterface {
            s.support_interface_speed
        } else {
            s.support_speed
        };
        Path {
            role: p.role,
            points: p.points.clone(),
            closed: false,
            width: p.width,
            height: p.height,
            mm3_per_mm,
            speed: speed.min(s.speed_cap(mm3_per_mm)),
            accel: accel(p.role, first, s),
            island: u32::MAX,
            object,
            parts: Vec::new(),
            arcs: p.arcs.clone(),
        }
    };
    // The base or the interface alone, where they print in different filaments: Orca then leaves out what is both.
    let items: Vec<&support::Item> =
        layer.items.iter().filter(|item| part == support::Part::Both || item.part() == part).collect();
    let ends: Vec<(Pt, Pt)> = items
        .iter()
        .map(|item| match item {
            support::Item::Path(p) => (p.points[0], p.points[p.points.len() - 1]),
            support::Item::Fixed(group) => {
                let last = &group[group.len() - 1].points;
                (group[0].points[0], last[last.len() - 1])
            }
        })
        .collect();
    let reversible: Vec<bool> = items.iter().map(|item| matches!(item, support::Item::Path(_))).collect();
    let mut out = Vec::new();
    for (k, reversed) in order::chain(&ends, &reversible, Some(at), true) {
        match items[k] {
            support::Item::Path(p) => {
                let mut path = make(p);
                if reversed {
                    path.reverse();
                }
                out.push(path);
            }
            support::Item::Fixed(group) => out.extend(group.iter().map(make)),
        }
    }
    out
}

/// The first layer's paths with each object's brim loops just before its first path, as Orca prints an object's
/// brim when it first comes to the object. Each loop starts at the point on it nearest where the nozzle is (the
/// plate's origin for the layer's first, where Orca's writer reckons it is) and stops the seam gap short of that
/// point, as Orca's `extrude_loop` splits and clips loops other than walls.
fn with_brims(
    paths: Vec<Path>,
    brims: &[&[Contour]],
    group_of: &dyn Fn(u32) -> usize,
    h: f64,
    s: &Settings,
) -> Vec<Path> {
    let mut out = Vec::with_capacity(paths.len() + brims.iter().map(|b| b.len()).sum::<usize>());
    let mut done = vec![false; brims.len()];
    let mut at = geom::pt(0, 0);
    for p in paths {
        let g = group_of(p.object);
        if g < brims.len() && !done[g] {
            done[g] = true;
            out.extend(brim_paths(brims[g], p.object, at, h, s));
        }
        at = p.points[p.points.len() - 1];
        out.push(p);
    }
    out
}

/// An object's brim loops as they print, the first from the point on it nearest `at`, each next from where the one
/// before ended.
fn brim_paths(brims: &[Contour], object: u32, mut at: Pt, h: f64, s: &Settings) -> Vec<Path> {
    let (width, mm3_per_mm, speed) = flow(Role::Brim, true, h, s);
    let speed = speed.min(s.speed_cap(mm3_per_mm));
    let mut out = Vec::with_capacity(brims.len());
    for contour in brims {
        let Some(points) = brim_loop(contour, at, s.seam_gap) else { continue };
        at = points[points.len() - 1];
        out.push(Path {
            role: Role::Brim,
            points,
            closed: true,
            width,
            height: h,
            mm3_per_mm,
            speed,
            accel: accel(Role::Brim, true, s),
            island: u32::MAX,
            object,
            parts: Vec::new(),
            arcs: Vec::new(),
        });
    }
    out
}

/// A loop from the point on it nearest `at` (on a segment if need be) round to that point, less `gap` mm at the
/// end (Orca's `ExtrusionLoop::split_at` and `clip_end`); none if the loop is no longer than the gap.
fn brim_loop(contour: &Contour, at: Pt, gap: f64) -> Option<Vec<Pt>> {
    let n = contour.len();
    if n < 2 {
        return None;
    }
    // The first segment whose nearest point is nearest (Orca's `foot_pt`).
    let mut best = (f64::INFINITY, 0usize, contour[0]);
    for k in 0..n {
        let f = foot(at, contour[k], contour[(k + 1) % n]);
        let (dx, dy) = ((f.x - at.x) as f64, (f.y - at.y) as f64);
        let d = dx * dx + dy * dy;
        if d < best.0 {
            best = (d, k, f);
        }
    }
    let (_, k, f) = best;
    let mut points = Vec::with_capacity(n + 2);
    points.push(f);
    for j in 1..=n {
        let q = contour[(k + j) % n];
        if q != points[points.len() - 1] {
            points.push(q);
        }
    }
    if f != points[points.len() - 1] {
        points.push(f);
    }
    clip_end(&mut points, &mut Vec::new(), &mut Vec::new(), gap).then_some(points)
}

/// Starts a loop (closed: its last point its first) at the point on it nearest `at`, on a segment if need be, as
/// Orca's `ExtrusionLoop::split_at` does: the first segment whose nearest point is nearest, that point snapped to the
/// segment's nearer end within a micrometre.
fn split_loop(points: &mut Vec<Pt>, at: Pt) {
    let n = points.len();
    if n < 3 {
        return;
    }
    let d2 = |q: Pt| {
        let (dx, dy) = ((q.x - at.x) as f64, (q.y - at.y) as f64);
        dx * dx + dy * dy
    };
    let mut best = (f64::INFINITY, 0usize, points[0]);
    for k in 0..n - 1 {
        let f = foot(at, points[k], points[k + 1]);
        let d = d2(f);
        if d < best.0 {
            best = (d, k, f);
        }
    }
    let (_, k, mut f) = best;
    let snap = (0.001 * geom::SCALE).powi(2);
    let (a, b) = (points[k], points[k + 1]);
    let (da, db) = (d2(a), d2(b));
    if da < db {
        if da < snap {
            f = a;
        }
    } else if db < snap {
        f = b;
    }
    // From f round to f: the rest of segment k, the loop's points after it, its first ones up to segment k.
    let mut out = Vec::with_capacity(n + 2);
    out.push(f);
    for &q in points[k + 1..n - 1].iter().chain(&points[..=k]) {
        if q != out[out.len() - 1] {
            out.push(q);
        }
    }
    if f != out[out.len() - 1] {
        out.push(f);
    }
    *points = out;
}

/// Takes `gap` mm off the end of a loop, and off its segments' parts and arcs, so that it stops short of where it
/// started rather than print over it (Orca's `ExtrusionLoop::clip_end`, by its seam gap); false if nothing is left
/// of it. An arc cut short ends where the circle comes nearest the cut, as Orca's `Polyline::clip_end` ends it.
fn clip_end(points: &mut Vec<Pt>, parts: &mut Vec<Part>, arcs: &mut Vec<ArcRun>, gap: f64) -> bool {
    let mut left = gap * geom::SCALE;
    let mut inserted = false;
    while left > 0.0 && points.len() >= 2 {
        let n = points.len();
        let (a, b) = (points[n - 2], points[n - 1]);
        let l = geom::dist(a, b);
        if l > left {
            let t = left / l;
            let x = b.x as f64 + (a.x - b.x) as f64 * t;
            let y = b.y as f64 + (a.y - b.y) as f64 * t;
            points[n - 1] = geom::pt(x.round() as i32, y.round() as i32);
            inserted = true;
            break;
        }
        left -= l;
        points.pop();
        if !parts.is_empty() {
            parts.pop();
        }
    }
    if points.len() < 2 {
        return false;
    }
    let last = points.len() - 1;
    arcs.retain(|run| run.start < last);
    if let Some(run) = arcs.last_mut()
        && (run.end > last || (inserted && run.end == last))
    {
        let p = points[last];
        if run.arc.clip_end([i64::from(p.x) * 100, i64::from(p.y) * 100]) {
            run.end = last;
            points[last] = from_nm(run.arc.end);
        } else {
            // Orca prints it as lines then.
            arcs.pop();
        }
    }
    true
}

/// A point in Orca's nanometres, on our grid.
pub fn from_nm(p: arc_fit::P) -> Pt {
    geom::pt((p[0] as f64 / 100.0).round() as i32, (p[1] as f64 / 100.0).round() as i32)
}

/// The point of segment a–b nearest p (Orca's `Point::projection_onto`).
fn foot(p: Pt, a: Pt, b: Pt) -> Pt {
    if a == b {
        return a;
    }
    let (lx, ly) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
    let theta = ((b.x - p.x) as f64 * lx + (b.y - p.y) as f64 * ly) / (lx * lx + ly * ly);
    if (0.0..=1.0).contains(&theta) {
        let x = theta * a.x as f64 + (1.0 - theta) * b.x as f64;
        let y = theta * a.y as f64 + (1.0 - theta) * b.y as f64;
        return geom::pt(x.round() as i32, y.round() as i32);
    }
    let d2 = |q: Pt| {
        let (dx, dy) = ((q.x - p.x) as f64, (q.y - p.y) as f64);
        dx * dx + dy * dy
    };
    if d2(a) < d2(b) { a } else { b }
}

/// An infill extrusion collection, as Orca makes them: a fill region's lines, or one gap fill path. Fixed ones
/// (monotonic fills, the narrow loops) print as they come; the others may print backwards, and their paths are
/// chained again from where the nozzle is when they start.
struct Group {
    paths: Vec<Path>,
    sortable: bool,
}

/// An island's paths in the order they print. In spiral vase mode `at` is where the nozzle is as the island starts:
/// each loop starts at the point on it nearest where the nozzle is then; on a layer that `rises` (one wall loop and
/// nothing else) it goes all the way round, without the seam gap, as Orca turns loop clipping off there.
#[allow(clippy::too_many_arguments)]
fn island_paths(
    index: u32,
    island: &Island,
    fills: &Fills,
    below: Option<&Below>,
    layer: usize,
    (z, h): (f64, f64),
    (centre, size): ((f64, f64), (f64, f64)),
    (trees, octree): (&[Vec<Pt>], Option<&crate::adaptive::Octree>),
    seams: Option<&crate::seam::LayerSeams>,
    (mut at, rises): (Option<Pt>, bool),
    s: &Settings,
) -> Vec<Path> {
    let first = s.on_plate(layer);
    let (walls, gaps) = (&island.walls, &island.gaps);
    let lines = &island.lines;
    let narrow = island.narrow;
    let island_inner = &island.inner;
    let overlap = island.overlap;
    let mut out: Vec<Path> = Vec::new();
    let island = index;

    // Walls in Orca's order: around each hole and then the outline, the deepest loop first, each level's loops chained
    // from the object's centre.
    let centre_pt = geom::pt(centre.0.round() as i32, centre.1.round() as i32);
    let overhang = overhang_flow(first, h, s);
    if !lines.is_empty() {
        out.extend(arachne_walls(lines, below, overhang, seams, island, first, h, s));
    }
    for (contour, depth, outline) in wall_order(walls, centre_pt).into_iter().filter(|_| lines.is_empty()) {
        let role = if depth == 0 { Role::OuterWall } else { Role::InnerWall };
        // From where the seam placer starts it (`seam.rs`), else from the back; in spiral vase mode, which places no
        // seams, from the point nearest the nozzle, as Orca's loops start there.
        let points = seams
            .and_then(|seams| seams.wall_loop(contour, outline, depth == 0, s))
            .unwrap_or_else(|| seam_loop(contour, outline));
        let mut wall = path(role, points, true, island, first, h, s);
        if narrow {
            // A narrow island's one wall, as Bambu's narrow loops print it: a thinner line.
            wall.width = region::narrow_wall_width(wall.width, h);
            wall.mm3_per_mm = Settings::mm3_per_mm(wall.width, h);
        }
        if let Some(p) = at {
            split_loop(&mut wall.points, p);
        }
        let mut wall = match below {
            Some(below) => below.wall(wall, overhang, s),
            None => wall,
        };
        // It stops the seam gap short of where it started, as Orca's walls do.
        if rises || clip_end(&mut wall.points, &mut wall.parts, &mut wall.arcs, s.seam_gap) {
            if at.is_some() {
                at = wall.points.last().copied();
            }
            out.push(wall);
        }
    }

    // Gap fill along the middle of the gaps between walls, as wide as each gap is there: each path on its own.
    let mut groups: Vec<Group> = Vec::new();
    let (gap_min, gap_max) = region::gap_widths(layer, h, s);
    for line in gaps.iter().flat_map(|shape| medial::gap_fill(shape, gap_min, gap_max)) {
        for p in thick_paths(Role::GapFill, &line.points, &line.widths, island, first, h, s) {
            groups.push(Group { paths: vec![p], sortable: true });
        }
    }

    // The infill reaches into the innermost wall, but not into the infill of other kinds beside it.
    let into_walls = |region: &Shapes| -> Shapes {
        if overlap <= 0.0 || region.is_empty() {
            return region.clone();
        }
        let grown = geom::offset(region, overlap);
        let others = others_in(island_inner, region);
        if others.is_empty() { grown } else { geom::difference(&grown, &others) }
    };
    let origin = (centre.0, centre.1);
    for role in FILL_ORDER {
        let region = match role {
            Role::Bridge => &fills.bridge,
            Role::InternalBridge => &fills.internal_bridge,
            Role::BottomSurface => &fills.bottom,
            Role::SolidInfill => &fills.solid,
            Role::SparseInfill => &fills.sparse,
            Role::TopSurface => &fills.top,
            _ => continue,
        };
        if region.is_empty() {
            continue;
        }
        if role == Role::SparseInfill {
            // A collection for each region, as Orca fills them one by one.
            let others = others_in(island_inner, region);
            for shape in region {
                let one = vec![shape.clone()];
                let paths: Vec<Path> = sparse_lines(&one, &others, layer, z, h, (centre, size), trees, octree, s)
                    .into_iter()
                    .filter(|points| points.len() >= 2)
                    .map(|points| path(role, points, false, island, first, h, s))
                    .collect();
                if !paths.is_empty() {
                    groups.push(Group { paths, sortable: true });
                }
            }
            continue;
        }
        let (width, _, _) = flow(role, first, h, s);
        let solid_angle =
            if layer.is_multiple_of(2) { s.solid_infill_direction } else { s.solid_infill_direction + 90.0 };
        // Each bridge spans its own way; everything else in a region fills at one angle.
        let angled = |shapes: &Shapes, angles: &[f64]| -> Vec<(Shapes, f64)> {
            shapes
                .iter()
                .zip(angles.iter().copied().chain(std::iter::repeat(solid_angle)))
                .map(|(shape, angle)| (vec![shape.clone()], angle))
                .collect()
        };
        let parts: Vec<(Shapes, f64)> = match role {
            Role::Bridge => angled(&fills.bridge, &fills.bridge_angles),
            Role::InternalBridge => angled(&fills.internal_bridge, &fills.internal_bridge_angles),
            _ => vec![(region.clone(), solid_angle)],
        };
        let bridge = matches!(role, Role::Bridge | Role::InternalBridge);
        let spacing =
            if bridge { s.bridge_flow(role == Role::InternalBridge, h).spacing } else { Settings::spacing(width, h) };
        let style = solid_style(role, s);
        // Orca keeps a monotonic region's lines in the order its fill makes them.
        let sortable = !matches!(style, SolidStyle::Monotonic { .. });
        for (part, angle) in parts {
            for shape in &into_walls(&part) {
                let concentric = |shape: &geom::Shape| -> Group {
                    let mut paths = Vec::new();
                    for p in
                        solid::concentric_loops(&vec![shape.clone()], spacing, s.nozzle_diameter, h, geom::pt(0, 0))
                    {
                        let (points, widths) = simplify_thick(&p.points, &p.widths, s.resolution);
                        paths.extend(thick_paths(role, &points, &widths, island, first, h, s));
                    }
                    Group { paths, sortable: false }
                };
                if style == SolidStyle::Concentric && !(role == Role::SolidInfill && s.narrow_solid_loops) {
                    groups.push(concentric(shape));
                    continue;
                }
                if let SolidStyle::Curve(curve) = style {
                    let lines = fill::surface_curve(shape, curve, spacing, (origin, size), s);
                    let paths =
                        lines.into_iter().map(|points| path(role, points, false, island, first, h, s)).collect();
                    groups.push(Group { paths, sortable });
                    continue;
                }
                if role == Role::SolidInfill
                    && s.narrow_solid_loops
                    && let Some((normal, narrow)) = solid::split_narrow(shape, spacing, angle.to_radians())
                {
                    for n in &normal {
                        if style == SolidStyle::Concentric {
                            groups.push(concentric(n));
                            continue;
                        }
                        let paths = solid_lines(n, role, style, angle, spacing, origin, island, first, h, s);
                        groups.push(Group { paths, sortable });
                    }
                    // Loops fill the narrow part inside the walls (Orca fills it without the overlap), in an order
                    // of their own.
                    let room = geom::intersection(&narrow, &geom::local(island_inner, geom::bbox_of(shape)));
                    let near = geom::pt(origin.0.round() as i32, origin.1.round() as i32);
                    let mut paths = Vec::new();
                    for p in solid::narrow_loops(&room, spacing, s.nozzle_diameter, h, near) {
                        let (points, widths) = simplify_thick(&p.points, &p.widths, s.resolution);
                        paths.extend(thick_paths(role, &points, &widths, island, first, h, s));
                    }
                    groups.push(Group { paths, sortable: false });
                    continue;
                }
                if style == SolidStyle::Concentric {
                    groups.push(concentric(shape));
                    continue;
                }
                let mut paths = solid_lines(shape, role, style, angle, spacing, origin, island, first, h, s);
                if bridge && let Some(below) = below {
                    paths = paths.into_iter().map(|p| below.bridge(p, s)).collect();
                }
                groups.push(Group { paths, sortable });
            }
        }
    }

    let at = out.last().and_then(|p| p.points.last().copied());
    out.extend(chain_infill(groups, at));
    // Ironing last (`ironing.rs`), as Orca's `extrude_infill` irons an island once everything else is printed: each
    // area's lines in the order they were filled, the areas chained from where the nozzle is.
    if !fills.ironing.is_empty() {
        let solid_angle =
            if layer.is_multiple_of(2) { s.solid_infill_direction } else { s.solid_infill_direction + 90.0 };
        let angle = if s.iron.fixed { s.iron.angle } else { solid_angle + s.iron.angle };
        let params = monotonic::Params {
            direction: angle.to_radians(),
            spacing: s.iron.spacing,
            adjust: false,
            connect: true,
            link_max: 3.0 * s.iron.spacing,
            origin,
        };
        let areas: Vec<Vec<Path>> = fills
            .ironing
            .iter()
            .filter_map(|shape| monotonic::fill(shape, &params))
            .map(|filled| {
                filled.lines.into_iter().map(|points| path(Role::Ironing, points, false, island, first, h, s)).collect()
            })
            .filter(|paths: &Vec<Path>| !paths.is_empty())
            .collect();
        let at = out.last().and_then(|p| p.points.last().copied());
        let ends: Vec<(Pt, Pt)> =
            areas.iter().map(|a| (a[0].points[0], *a[a.len() - 1].points.last().unwrap())).collect();
        let mut areas: Vec<Option<Vec<Path>>> = areas.into_iter().map(Some).collect();
        for (k, _) in order::chain(&ends, &vec![false; ends.len()], at, true) {
            out.extend(areas[k].take().unwrap_or_default());
        }
    }
    // The object's first layer on a raft prints at the first layer's speeds, at its own widths and accelerations
    // (Orca's `object_layer_over_raft`): walls at the first layer's speed, the rest at its infill speed.
    if layer == 0 && !first {
        for p in &mut out {
            let speed = match p.role {
                Role::OuterWall | Role::InnerWall | Role::OverhangWall => s.first_layer_speed,
                _ => s.first_layer_infill_speed,
            };
            p.speed = speed.min(s.speed_cap(p.mm3_per_mm));
        }
    }
    out
}

/// The infill and gap fill as Orca's `extrude_infill` prints them, chained from `at`, where the walls end. A
/// collection that may be re-sorted joins the chain path by path (`Island::Region::append` adds its entities one by
/// one), so a region's sparse lines chain with the solid infill beside them; one printed in its own order (a
/// monotonic fill's lines) joins whole, and isn't turned round.
fn chain_infill(groups: Vec<Group>, at: Option<Pt>) -> Vec<Path> {
    let mut entries: Vec<Group> = Vec::new();
    for g in groups {
        if g.paths.is_empty() {
            continue;
        }
        if g.sortable {
            entries.extend(g.paths.into_iter().map(|p| Group { paths: vec![p], sortable: true }));
        } else {
            entries.push(g);
        }
    }
    let ends: Vec<(Pt, Pt)> =
        entries.iter().map(|g| (g.paths[0].points[0], *g.paths[g.paths.len() - 1].points.last().unwrap())).collect();
    let reversible: Vec<bool> = entries.iter().map(|g| g.sortable).collect();
    let mut entries: Vec<Option<Group>> = entries.into_iter().map(Some).collect();
    let mut out = Vec::new();
    for (k, flip) in order::chain(&ends, &reversible, at, true) {
        let Some(mut g) = entries[k].take() else { continue };
        if flip {
            g.paths.reverse();
            for p in &mut g.paths {
                p.reverse();
            }
        }
        out.extend(g.paths);
    }
    out
}

/// The walls' loops in Orca's order (`traverse_loops`): each hole's loops nest in the loop beyond them, the
/// outermost in the innermost loop of the outline that holds it, and each outline loop in the one outside it; a
/// level's loops are chained from `start` (the object's centre), each outline loop printed after what it holds, each
/// hole's loop before. With each loop, its depth (0 the outer wall) and whether it goes round an outline.
fn wall_order(walls: &[Vec<Contour>], start: Pt) -> Vec<(&Contour, usize, bool)> {
    let mut at: Vec<(usize, usize, bool)> = Vec::new();
    let mut contours: Vec<Vec<usize>> = vec![Vec::new(); walls.len()];
    let mut holes: Vec<Vec<usize>> = vec![Vec::new(); walls.len()];
    for (d, level) in walls.iter().enumerate() {
        for (k, c) in level.iter().enumerate() {
            let outline = geom::area2(c) > 0;
            if outline {
                contours[d].push(at.len());
            } else {
                holes[d].push(at.len());
            }
            at.push((d, k, outline));
        }
    }
    let contour = |id: usize| &walls[at[id].0][at[id].1];
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); at.len()];
    let boxes: Vec<[i32; 4]> = (0..at.len())
        .map(|id| {
            contour(id).iter().fold([i32::MAX, i32::MAX, i32::MIN, i32::MIN], |b, p| {
                [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)]
            })
        })
        .collect();
    let holds = |parent: usize, child: usize| {
        let (b, p) = (&boxes[parent], contour(child)[0]);
        p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] && geom::contour_contains(contour(parent), p)
    };
    let deepest = walls.len().saturating_sub(1);
    // Holes first: in a hole loop further from the hole, else in the innermost outline loop that holds them.
    for d in 0..walls.len() {
        let mut i = 0;
        while i < holes[d].len() {
            let l = holes[d][i];
            let parent = (d + 1..walls.len())
                .find_map(|t| holes[t].iter().copied().find(|&c| holds(c, l)))
                .or_else(|| (0..=deepest).rev().find_map(|t| contours[t].iter().copied().find(|&c| holds(c, l))));
            match parent {
                Some(p) => {
                    children[p].push(l);
                    holes[d].remove(i);
                }
                None => i += 1,
            }
        }
    }
    // Then each outline loop in the nearest outline loop outside it.
    for d in (1..walls.len()).rev() {
        let mut i = 0;
        while i < contours[d].len() {
            let l = contours[d][i];
            let parent = (0..d).rev().find_map(|t| contours[t].iter().copied().find(|&c| holds(c, l)));
            match parent {
                Some(p) => {
                    children[p].push(l);
                    contours[d].remove(i);
                }
                None => i += 1,
            }
        }
    }
    fn traverse(
        level: &[usize],
        children: &[Vec<usize>],
        first: &dyn Fn(usize) -> Pt,
        outline: &dyn Fn(usize) -> bool,
        start: Pt,
        out: &mut Vec<usize>,
    ) {
        let ends: Vec<(Pt, Pt)> = level.iter().map(|&l| (first(l), first(l))).collect();
        for (k, _) in order::chain(&ends, &vec![true; ends.len()], Some(start), false) {
            let l = level[k];
            if !outline(l) {
                out.push(l);
            }
            traverse(&children[l], children, first, outline, start, out);
            if outline(l) {
                out.push(l);
            }
        }
    }
    let mut order = Vec::with_capacity(at.len());
    let first = |l: usize| contour(l)[0];
    let outline = |l: usize| at[l].2;
    // Loops nested in nothing (Orca drops these; a wall is never dropped here) come after the rest, level by level.
    let mut top: Vec<usize> = contours.first().cloned().unwrap_or_default();
    for level in contours.iter().skip(1).chain(holes.iter()) {
        top.extend(level.iter().copied());
    }
    let (nested, loose): (Vec<usize>, Vec<usize>) = top.into_iter().partition(|&l| at[l].0 == 0 && at[l].2);
    traverse(&nested, &children, &first, &outline, start, &mut order);
    traverse(&loose, &children, &first, &outline, start, &mut order);
    order.into_iter().map(|l| (contour(l), at[l].0, at[l].2)).collect()
}

/// How a kind of solid infill is laid: Orca's monotonic lines (joined along the edge, or for its "monotonic line"
/// pattern each on its own), else zig-zag. Bridges are monotonic where the top surface pattern is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SolidStyle {
    Monotonic {
        connect: bool,
    },
    ZigZag,
    /// One of Orca's plane-path curves, on a top or bottom surface (`fill::surface_curve`).
    Curve(crate::plane_path::Curve),
    /// Concentric loops: Orca's Arachne fill (`solid::concentric_loops`).
    Concentric,
}

fn solid_style(role: Role, s: &Settings) -> SolidStyle {
    let pattern = match role {
        Role::TopSurface => s.top_surface_pattern.as_str(),
        Role::BottomSurface => s.bottom_surface_pattern.as_str(),
        Role::SolidInfill => s.internal_solid_infill_pattern.as_str(),
        _ => match s.top_surface_pattern.as_str() {
            "monotonic" | "monotonicline" => "monotonic",
            _ => "rectilinear",
        },
    };
    let surface = matches!(role, Role::TopSurface | Role::BottomSurface);
    match pattern {
        "concentric" if role != Role::Bridge && role != Role::InternalBridge => SolidStyle::Concentric,
        "monotonicline" => SolidStyle::Monotonic { connect: false },
        "monotonic" | "" => SolidStyle::Monotonic { connect: true },
        "hilbertcurve" if surface => SolidStyle::Curve(crate::plane_path::Curve::Hilbert),
        "archimedeanchords" if surface => SolidStyle::Curve(crate::plane_path::Curve::ArchimedeanChords),
        "octagramspiral" if surface => SolidStyle::Curve(crate::plane_path::Curve::OctagramSpiral),
        _ => SolidStyle::ZigZag,
    }
}

/// One region of solid infill (or a bridge) as lines `angle` degrees, in print order. Solid infill spreads its
/// lines over the region (Orca's `_adjust_solid_spacing`) and prints them as much wider; bridges keep their grid.
#[allow(clippy::too_many_arguments)]
fn solid_lines(
    shape: &geom::Shape,
    role: Role,
    style: SolidStyle,
    angle: f64,
    spacing: f64,
    origin: (f64, f64),
    island: u32,
    first: bool,
    h: f64,
    s: &Settings,
) -> Vec<Path> {
    let bridge = matches!(role, Role::Bridge | Role::InternalBridge);
    let mut out = Vec::new();
    if let SolidStyle::Monotonic { connect } = style {
        let params = monotonic::Params {
            direction: angle.to_radians(),
            spacing,
            adjust: !bridge,
            connect,
            // Orca joins solid lines along the edge up to three spacings; bridges any length.
            link_max: if bridge { 0.0 } else { 3.0 * spacing },
            origin,
        };
        if let Some(filled) = monotonic::fill(shape, &params) {
            let widen = filled.spacing - spacing;
            for points in filled.lines {
                let mut p = path(role, points, false, island, first, h, s);
                if widen > 1e-9 {
                    p.width += widen;
                    p.mm3_per_mm = Settings::mm3_per_mm(p.width, h);
                    p.speed = p.speed.min(s.speed_cap(p.mm3_per_mm));
                }
                out.push(p);
            }
            return out;
        }
    }
    let mut runs = infill::fill(&vec![shape.clone()], angle, spacing, 0.0);
    let mut at = None;
    order_runs(&mut runs, &mut at);
    for points in runs {
        if points.len() >= 2 {
            out.push(path(role, points, false, island, first, h, s));
        }
    }
    out
}

/// The sparse infill lines of a region on a layer, as printed: Orca's pattern where there is one (lightning's from
/// `trees`, the object's lightning lines on the layer), else Orca's rectilinear (with a note, `Settings::fallbacks`).
/// `others` is what else fills the island (`others_in`): the region reaches into the
/// walls, but not into that.
#[allow(clippy::too_many_arguments)]
pub fn sparse_lines(
    region: &Shapes,
    others: &Shapes,
    layer: usize,
    z: f64,
    h: f64,
    frame: ((f64, f64), (f64, f64)),
    trees: &[Vec<Pt>],
    octree: Option<&crate::adaptive::Octree>,
    s: &Settings,
) -> Vec<Vec<Pt>> {
    // No sparse infill at all (spiral vase mode's): Orca fills nothing there.
    if s.sparse_density <= 0.0 {
        return Vec::new();
    }
    let pattern = fill::Pattern::of(&s.sparse_infill_pattern).unwrap_or(fill::Pattern::Rectilinear);
    sparse_runs(region, others, pattern, layer, (z, h), frame, (trees, octree), s)
}

/// mm Orca's sparse infill area reaches into the walls on a layer `h` high: a share of half the last wall's and half
/// a solid line's spacing.
pub fn sparse_overlap(h: f64, s: &Settings) -> f64 {
    let inset = match s.wall_loops {
        0 => 0.0,
        1 => Settings::spacing(s.outer_wall_width, h) / 2.0,
        _ => Settings::spacing(s.inner_wall_width, h) / 2.0,
    };
    if inset > 0.0 { s.infill_wall_overlap * (inset + Settings::spacing(s.solid_infill_width, h) / 2.0) } else { 0.0 }
}

/// What else fills an island beside one kind of its infill (its infill area less `region`), without the hairline
/// slivers the booleans leave between them where they are one, which no line fits in and which would cut every line
/// short of the walls: what that kind keeps out of as it reaches into the walls. Nothing where the region is alone in
/// the island (the common case).
pub fn others_in(inner: &Shapes, region: &Shapes) -> Shapes {
    if region.is_empty() || (geom::area_mm2(inner) - geom::area_mm2(region)).abs() < 1e-3 {
        return Vec::new();
    }
    let mut others = geom::difference(inner, region);
    others.retain(|shape| geom::shape_area_mm2(shape) >= 1e-3);
    others
}

/// Sparse infill in Orca's pattern (`fill.rs`), where Orca puts its lines' middles: into the walls by Orca's
/// overlap (`sparse_overlap`), less half the infill's spacing. Orca grows the infill area into the walls before it
/// splits it by kind, so the sparse infill stops half a spacing short of the solid infill beside it (`others`).
#[allow(clippy::too_many_arguments)]
fn sparse_runs(
    region: &Shapes,
    others: &Shapes,
    pattern: fill::Pattern,
    layer: usize,
    (z, h): (f64, f64),
    (centre, size): ((f64, f64), (f64, f64)),
    (trees, octree): (&[Vec<Pt>], Option<&crate::adaptive::Octree>),
    s: &Settings,
) -> Vec<Vec<Pt>> {
    let overlap = sparse_overlap(h, s);
    // Orca spaces sparse lines for the object's layer height, so they line up from layer to layer.
    let spacing = Settings::spacing(s.sparse_infill_width, s.layer_height);
    let params = fill::Sparse {
        pattern,
        origin: centre,
        z,
        layer,
        angle: s.infill_direction,
        spacing,
        density: s.sparse_density,
        anchor: s.infill_anchor,
        anchor_max: s.infill_anchor_max,
        trees,
        octree,
        lattice_angles: s.lateral_lattice_angles,
        size,
        resolution: s.resolution,
        layer_height: h,
    };
    // Lightning's trees grow in the area grown all round (`region::lightning_lines`), which its lines keep to: with
    // the area Orca's generator takes, ours came out further from Orca's (+11.5 % against −0.3 % on a Benchy).
    if overlap <= 0.0 || others.is_empty() || pattern == fill::Pattern::Lightning {
        return fill::sparse(region, overlap - spacing / 2.0, &params);
    }
    let grown = geom::difference(&geom::offset(region, overlap), others);
    fill::sparse(&grown, -spacing / 2.0, &params)
}

/// A line of varying width as paths (Orca's `variable_width`): each a stretch whose width stays within 0.05 mm,
/// steps that change more split to that, at the stretch's average width. Widths are each line's share of the
/// region (the medial axis's and Arachne's), so a path takes width × height mm³ a mm, and Orca prints it that plus
/// h·(1 − π/4) wide.
fn thick_paths(role: Role, points: &[Pt], widths: &[f64], island: u32, first: bool, h: f64, s: &Settings) -> Vec<Path> {
    const TOLERANCE: f64 = 0.05;
    let mut out = Vec::new();
    if points.len() < 2 {
        return out;
    }
    let mut pts: Vec<Pt> = vec![points[0]];
    let mut ws: Vec<f64> = vec![widths[0]];
    for i in 1..points.len() {
        let (a, b, wa, wb) = (points[i - 1], points[i], widths[i - 1], widths[i]);
        let steps = ((wb - wa).abs() / TOLERANCE).ceil() as usize;
        for k in 1..steps {
            let t = k as f64 / steps as f64;
            pts.push(geom::pt(
                (a.x as f64 + (b.x - a.x) as f64 * t).round() as i32,
                (a.y as f64 + (b.y - a.y) as f64 * t).round() as i32,
            ));
            ws.push(wa + (wb - wa) * t);
        }
        pts.push(b);
        ws.push(wb);
    }
    let speed = match role {
        Role::GapFill if first => s.first_layer_infill_speed,
        Role::GapFill => s.gap_infill_speed,
        _ => flow(role, first, h, s).2,
    };
    let emit = |from: usize, to: usize, out: &mut Vec<Path>| {
        let (mut sum, mut length) = (0.0, 0.0);
        for k in from..to {
            let l = geom::dist(pts[k], pts[k + 1]);
            sum += l * (ws[k] + ws[k + 1]) / 2.0;
            length += l;
        }
        if length <= 0.0 {
            return;
        }
        let width = sum / length + h * (1.0 - std::f64::consts::FRAC_PI_4);
        let mm3_per_mm = Settings::mm3_per_mm(width, h);
        let (tolerance, arcs) = resolution(role, s);
        let (points, arcs) = fit(&pts[from..=to], tolerance, arcs);
        out.push(Path {
            role,
            points,
            closed: false,
            width,
            height: h,
            mm3_per_mm,
            speed: speed.min(s.speed_cap(mm3_per_mm)),
            accel: accel(role, first, s),
            island,
            object: 0,
            parts: Vec::new(),
            arcs,
        });
    };
    let mut start = 0;
    let (mut lo, mut hi) = (ws[0], ws[0]);
    for i in 1..pts.len() {
        let w = ws[i];
        if (hi - w).abs().max((lo - w).abs()) > TOLERANCE && i - 1 > start {
            emit(start, i - 1, &mut out);
            start = i - 1;
            lo = ws[start];
            hi = ws[start];
        }
        lo = lo.min(w);
        hi = hi.max(w);
    }
    emit(start, pts.len() - 1, &mut out);
    out
}

/// A line of varying width with the points dropped that change neither its course by more than `resolution` mm
/// nor its width by more than 0.02 mm (Ramer–Douglas–Peucker over position and width): the medial axis gives a
/// point every few hundredths of a millimetre, which only makes the file longer.
fn simplify_thick(points: &[Pt], widths: &[f64], resolution: f64) -> (Vec<Pt>, Vec<f64>) {
    let n = points.len();
    if n <= 2 || resolution <= 0.0 {
        return (points.to_vec(), widths.to_vec());
    }
    // Width in units, scaled so its tolerance counts as much as the position's.
    let w_scale = resolution / 0.02 * geom::SCALE;
    let at = |k: usize| [points[k].x as f64, points[k].y as f64, widths[k] * w_scale];
    let tol2 = (resolution * geom::SCALE).powi(2);
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0, n - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (pa, pb) = (at(a), at(b));
        let d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        let mut best = (a, -1.0);
        for k in a + 1..b {
            let p = at(k);
            let v = [p[0] - pa[0], p[1] - pa[1], p[2] - pa[2]];
            let d2 = if len2 == 0.0 {
                v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
            } else {
                let c = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]];
                (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) / len2
            };
            if d2 > best.1 {
                best = (k, d2);
            }
        }
        if best.1 > tol2 {
            keep[best.0] = true;
            stack.push((a, best.0));
            stack.push((best.0, b));
        }
    }
    let pts = (0..n).filter(|&k| keep[k]).map(|k| points[k]).collect();
    let ws = (0..n).filter(|&k| keep[k]).map(|k| widths[k]).collect();
    (pts, ws)
}

/// Width, mm³ per mm and nominal speed of a role on this layer.
pub fn flow(role: Role, first: bool, h: f64, s: &Settings) -> (f64, f64, f64) {
    if role == Role::Ironing {
        // A thread as thin as the ironing's share of the object's layer, spread over its spacing: as wide as the
        // nozzle (Orca's `make_ironing`), at the first layer's infill speed there.
        let height = ironing_height(s);
        let width = s.nozzle_diameter + height * (1.0 - std::f64::consts::FRAC_PI_4);
        let speed = if first { s.first_layer_infill_speed } else { s.iron.speed };
        return (width, s.nozzle_diameter * height, speed);
    }
    if first {
        let w = s.first_layer_width;
        if role == Role::Brim {
            return (w, Settings::mm3_per_mm(w, h) * s.brim_flow_ratio, s.first_layer_speed);
        }
        let speed = if role.is_infill() { s.first_layer_infill_speed } else { s.first_layer_speed };
        return (w, Settings::mm3_per_mm(w, h), speed);
    }
    let (w, speed) = match role {
        Role::OuterWall => (s.outer_wall_width, s.outer_wall_speed),
        Role::InnerWall => (s.inner_wall_width, s.inner_wall_speed),
        Role::SparseInfill => (s.sparse_infill_width, s.sparse_infill_speed),
        Role::SolidInfill => (s.solid_infill_width, s.solid_infill_speed),
        Role::TopSurface => (s.top_surface_width, s.top_surface_speed),
        // Orca's speed for a bottom surface anywhere: there is none but on the first layer, or on a raft.
        Role::BottomSurface => (s.solid_infill_width, s.first_layer_infill_speed),
        Role::Bridge | Role::InternalBridge => {
            let internal = role == Role::InternalBridge;
            let f = s.bridge_flow(internal, h);
            // Orca applies `internal_bridge_flow` to internal bridges as it writes them.
            let mm3 = if internal { f.mm3_per_mm * s.internal_bridge_flow } else { f.mm3_per_mm };
            return (f.width, mm3, if internal { s.internal_bridge_speed } else { s.bridge_speed });
        }
        Role::GapFill => (s.inner_wall_width, s.gap_infill_speed),
        Role::Ironing => unreachable!(),
        // Only the first layer has one.
        Role::Brim => (s.first_layer_width, s.first_layer_speed),
        Role::Support => (s.support.line_width, s.support_speed),
        Role::SupportInterface => (s.support.line_width, s.support_interface_speed),
        // The tower writes its own G-code (`wipe_tower.rs`).
        Role::PrimeTower => (s.line_width, s.travel_speed),
        Role::OverhangWall => {
            let f = s.overhang_wall_flow(h);
            return (f.width, f.mm3_per_mm, s.bridge_speed);
        }
    };
    (w, Settings::mm3_per_mm(w, h), speed)
}

/// How high a role's paths are laid on a layer `h` high: a thick bridge (and with thick bridges an overhang wall) is
/// a round thread as high as it is wide, a flat one carrying more plastic (`bridge_flow`) is that much higher, and
/// anything else is the layer's height.
pub fn path_height(role: Role, h: f64, s: &Settings) -> f64 {
    match role {
        Role::Bridge | Role::InternalBridge => s.bridge_flow(role == Role::InternalBridge, h).height,
        Role::OverhangWall => s.overhang_wall_flow(h).height,
        Role::Ironing => ironing_height(s),
        _ => h,
    }
}

/// mm: how high an ironing line is laid, Orca's `extrusion_height`: the ironing's share of the object's layer
/// height, spread from the nozzle's width over the ironing's spacing.
fn ironing_height(s: &Settings) -> f64 {
    s.layer_height * s.iron.flow * s.iron.spacing / s.nozzle_diameter
}

/// An overhang wall's width, mm³ per mm, speed and acceleration on a layer `h` high.
pub fn overhang_flow(first: bool, h: f64, s: &Settings) -> (f64, f64, f64, f64) {
    let (width, mm3_per_mm, speed) = flow(Role::OverhangWall, first, h, s);
    (width, mm3_per_mm, speed.min(s.speed_cap(mm3_per_mm)), accel(Role::OverhangWall, first, s))
}

fn accel(role: Role, first: bool, s: &Settings) -> f64 {
    if first {
        return s.first_layer_accel;
    }
    match role {
        Role::OuterWall => s.outer_wall_accel,
        Role::InnerWall => s.inner_wall_accel,
        Role::TopSurface => s.top_surface_accel,
        Role::Bridge | Role::InternalBridge | Role::OverhangWall => s.bridge_accel,
        _ => s.default_accel,
    }
}

/// mm a sparse infill line may stray from its course when Orca fits arcs to it (`SPARSE_INFILL_RESOLUTION`); other
/// paths keep to the profile's resolution.
const SPARSE_INFILL_RESOLUTION: f64 = 0.04;

/// How Orca simplifies a path of a role before printing it (`LayerRegion::simplify_path`): how far it may stray from
/// its course (mm), and whether arcs are fitted to it. Where arcs are fitted, sparse infill keeps to 0.04 mm and
/// everything else to the profile's resolution; where they aren't (and always in spiral vase mode), to the
/// resolution.
pub(crate) fn resolution(role: Role, s: &Settings) -> (f64, bool) {
    let sparse = role == Role::SparseInfill;
    let arcs = !s.spiral_mode
        && match s.arc_fitting {
            ArcFitting::Enabled => true,
            ArcFitting::SparseInfill => sparse,
            ArcFitting::Disabled => false,
        };
    (if arcs && sparse { SPARSE_INFILL_RESOLUTION } else { s.resolution }, arcs)
}

/// A path's points simplified to within `tolerance` mm, as Orca simplifies them: with `arcs`, its arcs fitted first
/// and each stretch simplified on its own (`Polyline::simplify_by_fitting_arc`, `arc_fit.rs`), else Douglas–Peucker
/// over the whole path (`Polyline::simplify`). The points kept are the path's own.
pub fn fit(points: &[Pt], tolerance: f64, arcs: bool) -> (Vec<Pt>, Vec<ArcRun>) {
    if !arcs || tolerance <= 0.0 || points.len() < 3 {
        return (geom::simplify_line(points, tolerance), Vec::new());
    }
    let mut nm: Vec<arc_fit::P> = points.iter().map(|p| [i64::from(p.x) * 100, i64::from(p.y) * 100]).collect();
    // Orca's `scaled<double>` of the tolerance, to the bit.
    let runs = arc_fit::fit_and_simplify(&mut nm, tolerance / 1e-6);
    let points = nm.iter().map(|p| geom::pt((p[0] / 100) as i32, (p[1] / 100) as i32)).collect();
    let arcs = runs.into_iter().filter_map(|r| r.arc.map(|arc| ArcRun { start: r.start, end: r.end, arc })).collect();
    (points, arcs)
}

/// A path of a role, simplified as Orca simplifies every path before printing it: without the points it can lose and
/// stay within its resolution of its course (`resolution`), which fills and their anchors along the walls leave by
/// the thousand, a few micrometres apart.
fn path(role: Role, points: Vec<Pt>, closed: bool, island: u32, first: bool, h: f64, s: &Settings) -> Path {
    let (width, mm3_per_mm, speed) = flow(role, first, h, s);
    let speed = speed.min(s.speed_cap(mm3_per_mm));
    let (tolerance, arcs) = resolution(role, s);
    let (points, arcs) = fit(&points, tolerance, arcs);
    Path {
        role,
        points,
        closed,
        width,
        height: path_height(role, h, s),
        mm3_per_mm,
        speed,
        accel: accel(role, first, s),
        island,
        object: 0,
        parts: Vec::new(),
        arcs,
    }
}

/// Arachne's lines as paths, in the order Orca's `process_arachne` prints them: the lines nearest where the nozzle is
/// first (open lines before closed ones among those free to go), each only after the lines it must follow (those
/// within 1.9 line widths of it whose inset differs by one: inner lines first, or outer first with
/// `wall_sequence`). A closed line starts where the seam placer puts it, as the classic walls do, and every line is
/// cut into pieces of one width (`thick_polyline_to_multi_path`), each slowed where it hangs.
#[allow(clippy::too_many_arguments)]
fn arachne_walls(
    lines: &[region::ArachneLine],
    below: Option<&Below>,
    overhang: (f64, f64, f64, f64),
    seams: Option<&crate::seam::LayerSeams>,
    island: u32,
    first: bool,
    h: f64,
    s: &Settings,
) -> Vec<Path> {
    use crate::arachne::width;
    // Inner-outer-inner starts from the outer-first order (on every layer but the first, where it is off).
    let sandwich = s.wall_sequence == "inner-outer-inner wall" && !first;
    let outer_first = s.outer_wall_first || sandwich;
    // `all_extrusions`: the insets from the innermost out (or the outermost in), each in its own order.
    let max_inset = lines.iter().map(|l| l.inset).max().unwrap_or(0);
    let mut all: Vec<usize> = Vec::new();
    let insets: Vec<usize> = if outer_first { (0..=max_inset).collect() } else { (0..=max_inset).rev().collect() };
    for inset in insets {
        all.extend((0..lines.len()).filter(|&i| lines[i].inset == inset));
    }
    // `getRegionOrder`: which line must come before which.
    let max_w = lines.iter().flat_map(|l| l.widths.iter().copied()).fold(0.0f64, f64::max);
    let mut blocked = vec![0usize; lines.len()];
    let mut blocking: Vec<Vec<usize>> = vec![Vec::new(); lines.len()];
    if max_w > 0.0 {
        let radius = max_w * 1.9;
        let cell = (radius * geom::SCALE).max(1.0);
        let key = |p: Pt| ((p.x as f64 / cell).floor() as i64, (p.y as f64 / cell).floor() as i64);
        let mut grid: std::collections::HashMap<(i64, i64), Vec<(usize, usize)>> = std::collections::HashMap::new();
        for (li, l) in lines.iter().enumerate() {
            for (k, &p) in l.points.iter().enumerate() {
                grid.entry(key(p)).or_default().push((li, k));
            }
        }
        let mut pairs: std::collections::BTreeSet<(usize, usize)> = std::collections::BTreeSet::new();
        for (hi, here) in lines.iter().enumerate() {
            for (k, &p) in here.points.iter().enumerate() {
                let (cx, cy) = key(p);
                for gx in cx - 1..=cx + 1 {
                    for gy in cy - 1..=cy + 1 {
                        let Some(v) = grid.get(&(gx, gy)) else { continue };
                        for &(ni, nk) in v {
                            let nearby = &lines[ni];
                            if ni == hi || nearby.inset == here.inset {
                                continue;
                            }
                            if nearby.inset > here.inset + 1 || here.inset > nearby.inset + 1 {
                                continue;
                            }
                            let reach = (here.widths[k] + nearby.widths[nk]) / 2.0 * 1.9 * geom::SCALE;
                            let d = geom::dist(p, nearby.points[nk]);
                            if d > reach {
                                continue;
                            }
                            if (nearby.inset < here.inset) == outer_first {
                                pairs.insert((ni, hi));
                            } else {
                                pairs.insert((hi, ni));
                            }
                        }
                    }
                }
            }
        }
        for (before, after) in pairs {
            blocked[after] += 1;
            blocking[before].push(after);
        }
    }
    let mut processed = vec![false; lines.len()];
    let mut ordered: Vec<usize> = Vec::with_capacity(lines.len());
    let mut current = all.first().map(|&i| lines[i].points[0]).unwrap_or(geom::pt(0, 0));
    while ordered.len() < all.len() {
        let mut available: Vec<usize> = all.iter().copied().filter(|&i| !processed[i] && blocked[i] == 0).collect();
        available.sort_by_key(|&i| lines[i].closed);
        let (mut best, mut best_d, mut best_closed) = (all[0], f64::MAX, false);
        for &c in &available {
            let l = &lines[c];
            let d = geom::dist(current, l.points[0]);
            if d < best_d && (l.closed || best_d != f64::MAX || !best_closed) {
                best = c;
                best_d = d;
                best_closed = l.closed;
            }
        }
        if best_d == f64::MAX {
            // Every line is blocked (a cycle): take the first not yet printed.
            if let Some(&c) = all.iter().find(|&&i| !processed[i]) {
                best = c;
            }
        }
        processed[best] = true;
        ordered.push(best);
        for &u in &blocking[best] {
            blocked[u] = blocked[u].saturating_sub(1);
        }
        let l = &lines[best];
        current = if l.closed { l.points[0] } else { *l.points.last().unwrap() };
    }
    if sandwich {
        use crate::arachne::ioi::{Wall, sandwich};
        let walls: Vec<Wall> = lines
            .iter()
            .map(|l| Wall {
                inset: l.inset,
                closed: l.closed,
                // Arachne's contours run clockwise, its holes counter-clockwise.
                contour: l.closed && geom::area2(&l.points) < 0,
                points: &l.points,
                widths: &l.widths,
            })
            .collect();
        let nm = |mm: f64| (mm * 1e6) as i64 as f64 / 1e6;
        let (ext, int) = (Settings::spacing(s.outer_wall_width, h), Settings::spacing(s.inner_wall_width, h));
        let external = if s.precise_outer_wall { nm(ext) + nm(int) / 2.0 } else { nm(ext) / 2.0 + nm(int) / 2.0 };
        ordered = sandwich(&walls, ordered, external, nm(int));
    }
    let mut out = Vec::new();
    for li in ordered {
        let l = &lines[li];
        let role = if l.inset == 0 { Role::OuterWall } else { Role::InnerWall };
        let (mut points, mut widths) = (l.points.clone(), l.widths.clone());
        if l.closed && points.len() > 3 {
            // A loop starts where the seam placer puts it, counter-clockwise round an outline and clockwise round a
            // hole (Arachne's contours run the other way round).
            let contour: Vec<Pt> = points[..points.len() - 1].to_vec();
            let outline = geom::area2(&contour) < 0;
            if let Some(seam) = seams.and_then(|seams| seams.wall_loop(&contour, outline, l.inset == 0, s)) {
                widths = seam.iter().map(|&p| width_at(&points, &widths, p)).collect();
                points = seam;
            }
        }
        let pts: Vec<crate::arachne::graph::P> = points
            .iter()
            .map(|q| crate::arachne::graph::P { x: i64::from(q.x) * 100, y: i64::from(q.y) * 100 })
            .collect();
        let per_segment = width::per_segment_widths(&widths.iter().map(|w| w * 1e6).collect::<Vec<_>>());
        let pieces = width::thick_polyline_to_multi_path(&pts, &per_segment, h, 0.05 * 1e6, 100.0);
        let count = pieces.len();
        for (k, piece) in pieces.into_iter().enumerate() {
            let points: Vec<Pt> = piece
                .points
                .iter()
                .map(|q| geom::pt((q.x as f64 / 100.0).round() as i32, (q.y as f64 / 100.0).round() as i32))
                .collect();
            let mut p = path(role, points, false, island, first, h, s);
            p.width = piece.width;
            p.mm3_per_mm = Settings::mm3_per_mm(piece.width, h);
            p.speed = p.speed.min(s.speed_cap(p.mm3_per_mm));
            let mut p = match below {
                Some(below) => below.wall(p, overhang, s),
                None => p,
            };
            // A loop stops the seam gap short of where it started, as Orca's walls do.
            if l.closed && k + 1 == count && !clip_end(&mut p.points, &mut p.parts, &mut p.arcs, s.seam_gap) {
                continue;
            }
            if p.points.len() >= 2 {
                out.push(p);
            }
        }
    }
    out
}

/// A line's width (mm) at the point of it nearest `p`, interpolated along its segment.
fn width_at(points: &[Pt], widths: &[f64], p: Pt) -> f64 {
    let mut best = (f64::MAX, widths[0]);
    for k in 0..points.len() - 1 {
        let (a, b) = (points[k], points[k + 1]);
        let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
        let l2 = dx * dx + dy * dy;
        let t =
            if l2 == 0.0 { 0.0 } else { (((p.x - a.x) as f64 * dx + (p.y - a.y) as f64 * dy) / l2).clamp(0.0, 1.0) };
        let d = ((a.x as f64 + t * dx - p.x as f64).powi(2) + (a.y as f64 + t * dy - p.y as f64).powi(2)).sqrt();
        if d < best.0 {
            best = (d, widths[k] + (widths[k + 1] - widths[k]) * t);
        }
    }
    best.1
}

/// A wall loop as printed: counter-clockwise, from the rearmost point (largest y, then smallest x), closed.
fn seam_loop(contour: &Contour, outline: bool) -> Vec<Pt> {
    let mut points: Vec<Pt> = contour.clone();
    // Outlines counter-clockwise, holes clockwise (Orca's `wall_direction` ccw).
    if (geom::area2(&points) < 0) == outline {
        points.reverse();
    }
    let seam = points
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.y.cmp(&b.y).then(b.x.cmp(&a.x)))
        .map(|(i, _)| i)
        .unwrap_or(0);
    points.rotate_left(seam);
    points.push(points[0]);
    points
}

/// Open runs nearest first, each entered from whichever end is nearer.
fn order_runs(runs: &mut Vec<Vec<Pt>>, at: &mut Option<Pt>) {
    if runs.is_empty() {
        return;
    }
    let mut rest = std::mem::take(runs);
    let mut cur = at.unwrap_or(rest[0][0]);
    while !rest.is_empty() {
        let mut best = (0usize, f64::INFINITY, false);
        for (k, r) in rest.iter().enumerate() {
            let d0 = geom::dist(cur, r[0]);
            let d1 = geom::dist(cur, *r.last().unwrap());
            if d0 < best.1 {
                best = (k, d0, false);
            }
            if d1 < best.1 {
                best = (k, d1, true);
            }
        }
        let mut r = rest.swap_remove(best.0);
        if best.2 {
            r.reverse();
        }
        cur = *r.last().unwrap();
        runs.push(r);
    }
    *at = Some(cur);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fmath::Hyp;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64, clockwise: bool) -> Contour {
        let mut c = vec![
            geom::pt(geom::sc(x0), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y1)),
            geom::pt(geom::sc(x0), geom::sc(y1)),
        ];
        if clockwise {
            c.reverse();
        }
        c
    }

    #[test]
    fn walls_go_round_each_hole_and_then_the_outline_deepest_first() {
        // Two walls round a 20 mm square with two holes: depth 0 the outer walls, depth 1 the inner ones.
        let walls = vec![
            vec![
                square(0.0, 0.0, 20.0, 20.0, false),
                square(3.0, 3.0, 7.0, 7.0, true),
                square(13.0, 13.0, 17.0, 17.0, true),
            ],
            vec![
                square(0.5, 0.5, 19.5, 19.5, false),
                square(2.5, 2.5, 7.5, 7.5, true),
                square(12.5, 12.5, 17.5, 17.5, true),
            ],
        ];
        let order = wall_order(&walls, geom::pt(0, 0));
        let got: Vec<(usize, bool)> = order.iter().map(|&(_, depth, outline)| (depth, outline)).collect();
        // Each hole's inner wall, then its outer wall, the nearer hole first; then the outline's, inside out.
        assert_eq!(got, vec![(1, false), (0, false), (1, false), (0, false), (1, true), (0, true)]);
        assert_eq!(order[0].0[0], walls[1][1][0], "the hole nearest the start comes first");
        // Outlines run counter-clockwise, holes clockwise.
        for &(contour, _, outline) in &order {
            assert_eq!(geom::area2(&seam_loop(contour, outline)) > 0, outline);
        }
    }

    #[test]
    fn a_loop_stops_the_seam_gap_short_of_where_it_started() {
        // A 10 mm square from its corner round to it again, its last side a slow overhang stretch.
        let mut points = seam_loop(&square(0.0, 0.0, 10.0, 10.0, false), true);
        let start = points[0];
        let slow = Part { overhang: true, speed: 10.0 };
        let mut parts = vec![Part { overhang: false, speed: 200.0 }; 3];
        parts.push(slow);
        assert!(clip_end(&mut points, &mut parts, &mut Vec::new(), 0.04));
        assert_eq!((points.len(), parts.len()), (5, 4));
        assert!((geom::dist(points[4], start) / geom::SCALE - 0.04).abs() < 1e-3, "{:?}", points[4]);
        assert_eq!(parts[3], slow);
        // A gap past the last corner takes the last side and its part with it.
        let mut points = seam_loop(&square(0.0, 0.0, 10.0, 10.0, false), true);
        let mut parts = vec![Part { overhang: false, speed: 200.0 }; 4];
        assert!(clip_end(&mut points, &mut parts, &mut Vec::new(), 10.5));
        assert_eq!((points.len(), parts.len()), (4, 3));
        // One no longer than the gap is gone.
        let mut points = seam_loop(&square(0.0, 0.0, 0.005, 0.005, false), true);
        assert!(!clip_end(&mut points, &mut Vec::new(), &mut Vec::new(), 0.04));
    }

    /// A circle of radius `r` mm round (100, 100) in `n` points, counter-clockwise from angle 0, closed.
    fn circle(r: f64, n: usize) -> Vec<Pt> {
        (0..=n)
            .map(|k| {
                let a = 2.0 * std::f64::consts::PI * (k % n) as f64 / n as f64;
                geom::pt(geom::sc(100.0 + r * a.cos()), geom::sc(100.0 + r * a.sin()))
            })
            .collect()
    }

    /// Whether every arc of a path starts and ends at its points (to Orca's nanometres on our 0.1 µm), on its circle.
    fn arcs_fit(points: &[Pt], arcs: &[ArcRun]) {
        for run in arcs {
            assert!(run.start < run.end && run.end < points.len(), "{run:?}");
            assert_eq!(from_nm(run.arc.start), points[run.start]);
            assert_eq!(from_nm(run.arc.end), points[run.end]);
            for p in [run.arc.start, run.arc.end] {
                let r = ((p[0] - run.arc.center[0]) as f64).hyp((p[1] - run.arc.center[1]) as f64);
                assert!((r - run.arc.radius).abs() < 100.0, "{r} against {}", run.arc.radius);
            }
        }
        assert!(arcs.windows(2).all(|w| w[0].end <= w[1].start));
    }

    #[test]
    fn a_round_loop_fits_arcs_that_follow_it_backwards_and_round_its_seam_gap() {
        let s = Settings::default();
        assert_eq!(resolution(Role::OuterWall, &s), (s.resolution, true));
        assert_eq!(resolution(Role::SparseInfill, &s), (0.04, true));
        let off = Settings { arc_fitting: ArcFitting::Disabled, ..s.clone() };
        assert_eq!(resolution(Role::SparseInfill, &off), (s.resolution, false));
        let sparse_only = Settings { arc_fitting: ArcFitting::SparseInfill, ..s.clone() };
        assert_eq!(resolution(Role::OuterWall, &sparse_only), (s.resolution, false));
        assert_eq!(resolution(Role::SparseInfill, &sparse_only), (0.04, true));
        let spiral = Settings { spiral_mode: true, ..s.clone() };
        assert_eq!(resolution(Role::OuterWall, &spiral), (s.resolution, false));

        // Without arcs, the path simplified as before; with them, a 10 mm circle in a few arcs, counter-clockwise.
        let raw = circle(10.0, 360);
        assert_eq!(fit(&raw, 0.012, false), (geom::simplify_line(&raw, 0.012), Vec::new()));
        let (points, arcs) = fit(&raw, 0.012, true);
        assert!(!arcs.is_empty() && arcs.len() <= 4, "{}", arcs.len());
        assert!(arcs.iter().all(|a| a.arc.ccw && (a.arc.radius / 1e6 - 10.0).abs() < 0.012));
        let covered: usize = arcs.iter().map(|a| a.end - a.start).sum();
        assert!(covered + 2 >= points.len() - 1, "{covered} of {} segments", points.len() - 1);
        arcs_fit(&points, &arcs);
        let mut path = path(Role::OuterWall, raw.clone(), true, 0, false, 0.2, &s);
        assert_eq!((&path.points, &path.arcs), (&points, &arcs));

        // Backwards: the same arcs the other way round, clockwise.
        let length = |arcs: &[ArcRun]| arcs.iter().map(|a| a.arc.length).sum::<f64>();
        let before = length(&path.arcs);
        path.reverse();
        assert!(path.arcs.iter().all(|a| !a.arc.ccw && a.arc.angle < 0.0));
        arcs_fit(&path.points, &path.arcs);
        assert_eq!(length(&path.arcs), before);

        // The seam gap cuts the loop 0.5 mm short of where it started, its last arc ending on its circle where the
        // cut falls (Orca's `Polyline::clip_end`).
        path.reverse();
        let start = path.points[0];
        // mm the path prints: its arcs, and its segments outside them.
        let printed = |p: &Path| {
            let mut mm = length(&p.arcs) / 1e6;
            for k in 0..p.points.len() - 1 {
                if !p.arcs.iter().any(|a| a.start <= k && k < a.end) {
                    mm += geom::dist(p.points[k], p.points[k + 1]) / geom::SCALE;
                }
            }
            mm
        };
        let whole = printed(&path);
        assert!(clip_end(&mut path.points, &mut path.parts, &mut path.arcs, 0.5));
        arcs_fit(&path.points, &path.arcs);
        let chord = geom::dist(start, path.points[path.points.len() - 1]) / geom::SCALE;
        assert!((chord - 0.5).abs() < 0.01, "{chord}");
        assert!((whole - printed(&path) - 0.5).abs() < 0.01, "{} of {whole} mm", printed(&path));
    }

    /// A region's sparse lines chain one by one with the monotonic solid infill beside them, as Orca's islands take
    /// them: from the walls' end the near sparse line, the solid block (whole, the way it was filled), then the
    /// sparse line beyond it.
    #[test]
    fn sparse_lines_chain_one_by_one_round_a_monotonic_block() {
        let s = Settings::default();
        let mm = |p: (f64, f64)| geom::pt(geom::sc(p.0), geom::sc(p.1));
        let line = |role: Role, a: (f64, f64), b: (f64, f64)| path(role, vec![mm(a), mm(b)], false, 0, false, 0.2, &s);
        let sparse = Group {
            paths: vec![
                line(Role::SparseInfill, (0.0, 0.0), (0.0, 10.0)),
                line(Role::SparseInfill, (30.0, 10.0), (30.0, 0.0)),
            ],
            sortable: true,
        };
        let solid = Group {
            paths: vec![
                line(Role::SolidInfill, (20.0, 10.0), (10.0, 10.0)),
                line(Role::SolidInfill, (10.0, 11.0), (20.0, 11.0)),
            ],
            sortable: false,
        };
        let out = chain_infill(vec![sparse, solid], Some(mm((0.0, -1.0))));
        let starts: Vec<(Role, Pt)> = out.iter().map(|p| (p.role, p.points[0])).collect();
        assert_eq!(
            starts,
            vec![
                (Role::SparseInfill, mm((0.0, 0.0))),
                (Role::SolidInfill, mm((20.0, 10.0))),
                (Role::SolidInfill, mm((10.0, 11.0))),
                (Role::SparseInfill, mm((30.0, 10.0))),
            ]
        );
    }
}
