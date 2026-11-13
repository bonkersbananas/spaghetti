//! Walls over overhangs, as OrcaSlicer 2.5.0 prints them.
//!
//! A wall loop's stretches that run more than half the nozzle beyond the layer below (beyond its printable part,
//! Orca's `printable_slices`, grown by half the nozzle) print as overhang walls: a bridge line wide, at the bridge's
//! speed and acceleration (`PerimeterGenerator::traverse_loops` with `detect_overhang_wall`). And walls and bridges
//! slow down where they hang over the layer below's outline (`GCode::_extrude` with `enable_overhang_speed`, through
//! `ExtrusionQualityEstimator`): at their own speed while a tenth of the line or less hangs, easing down to
//! `overhang_2_4_speed` where half of it does, `overhang_3_4_speed` at three quarters and `overhang_4_4_speed` at
//! seven eighths, then back up to the bridge speed where nothing holds it. Orca's passes over a path are ported as
//! they are (`estimate_points_properties`): a point where a line crosses the outline below, probes along lines of
//! 2 mm or more where neither end tells what lies between, and cuts that keep a slowdown to the stretch beside the
//! slow end. A path whose speed then varies by more than 1 mm/s prints stretch by stretch.

use crate::config::Settings;
use crate::fill::{self, EdgeGrid};
use crate::geom::{self, Contour, Pt, Shapes};
use crate::plan::{Part, Path};
use crate::region::Role;
use std::cell::RefCell;

/// The layer below one object's layer, as that layer's walls and bridges see it.
pub struct Below {
    outline: Outline,
    /// The object's slice on the layer below, for what holds a wall up where it may overhang.
    lower: Shapes,
    detect: bool,
    /// What holds walls up where it was worked out: the box asked for (units) and what holds them up near it.
    held: RefCell<Vec<([i32; 4], EdgeGrid)>>,
}

impl Below {
    /// `lower`: the object's slice on the layer below (Orca's `lslices`).
    pub fn new(lower: &Shapes, s: &Settings) -> Below {
        Below {
            outline: Outline::new(lower),
            lower: lower.clone(),
            detect: s.detect_overhang_wall,
            held: RefCell::new(Vec::new()),
        }
    }

    /// What holds a wall up within the box `b` (units), kept for other loops asking near it (an island's loops
    /// mostly overhang in the same places).
    fn held_within(&self, b: [i32; 4], s: &Settings) -> std::cell::Ref<'_, EdgeGrid> {
        // Exact a millimetre beyond the box it was asked for.
        let fits = |c: &[i32; 4]| {
            let c = geom::inflate(*c, 1.0);
            c[0] <= b[0] && c[1] <= b[1] && c[2] >= b[2] && c[3] >= b[3]
        };
        let found = self.held.borrow().iter().position(|(c, _)| fits(c));
        let k = match found {
            Some(k) => k,
            None => {
                let grid = self.held_near(b, s);
                let mut held = self.held.borrow_mut();
                held.push((b, grid));
                held.len() - 1
            }
        };
        std::cell::Ref::map(self.held.borrow(), |h| &h[k].1)
    }

    /// What holds a wall up within the box `b` (units): the layer below's printable part (Orca's `printable_slices`,
    /// without what is thinner than a third of the nozzle) grown by half the nozzle, worked out from the layer below
    /// near the box only (nothing further than a millimetre away changes it).
    fn held_near(&self, b: [i32; 4], s: &Settings) -> EdgeGrid {
        let near = geom::clip_box(&self.lower, geom::inflate(b, 2.0));
        let contours: Vec<Contour> = near.into_iter().flatten().collect();
        let near = geom::union_contours(&contours);
        let r = s.nozzle_diameter / 6.0;
        // The opening's growing back and the half nozzle in one go.
        let grown = geom::offset(&geom::offset(&near, -r), r + s.nozzle_diameter / 2.0);
        let contours: Vec<Contour> = grown.into_iter().flatten().collect();
        EdgeGrid::new(&contours, 2.0 * geom::SCALE, 0.0)
    }

    /// Whether any of segment a–b (mm, its ends `sa` and `sb` from the layer below's outline) may lie more than `r`
    /// beyond the layer below: a point's distance changes no faster than the point moves, so a segment whose ends
    /// are near enough or far enough in can't.
    fn may_hang(&self, a: (f64, f64), b: (f64, f64), sa: f64, sb: f64, r: f64) -> bool {
        let mut stack = vec![(a, b, sa, sb)];
        while let Some((a, b, sa, sb)) = stack.pop() {
            if sa > r || sb > r {
                return true;
            }
            let length = (b.0 - a.0).hypot(b.1 - a.1);
            if (sa + sb + length) / 2.0 <= r {
                continue;
            }
            if length < 0.01 {
                return true;
            }
            let m = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
            let sm = self.outline.signed(m.0, m.1);
            stack.push((a, m, sa, sm));
            stack.push((m, b, sm, sb));
        }
        false
    }

    /// A wall loop (closed, from its seam) as it prints over the layer below: its stretches beyond the layer below
    /// as overhang wall (`overhang`: such a wall's width, mm³ per mm, speed and acceleration), and every stretch slowed
    /// where it hangs.
    pub fn wall(&self, mut path: Path, overhang: (f64, f64, f64, f64), s: &Settings) -> Path {
        let n = path.points.len();
        if n < 2 {
            return path;
        }
        let mm: Vec<(f64, f64)> = path.points.iter().map(|q| (geom::unsc(q.x), geom::unsc(q.y))).collect();
        let signed: Vec<f64> = mm.iter().map(|&(x, y)| self.outline.signed(x, y)).collect();
        // A little short of half the nozzle: the exact test below has the final word.
        let r = s.nozzle_diameter / 2.0 - 0.01;
        let candidates: Vec<bool> = if self.detect {
            (0..n - 1).map(|k| self.may_hang(mm[k], mm[k + 1], signed[k], signed[k + 1], r)).collect()
        } else {
            Vec::new()
        };
        if !candidates.contains(&true) {
            // On the layer below all the way round: only its speed may change.
            if let Some((points, speeds)) =
                self.slow(&path.points, Some(&signed), path.role, path.width, path.mm3_per_mm, path.speed, s)
            {
                path.parts = speeds.into_iter().map(|speed| Part { overhang: false, speed }).collect();
                path.points = points;
            }
            return path;
        }
        let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
        for k in (0..n - 1).filter(|&k| candidates[k]) {
            for q in &path.points[k..=k + 1] {
                b = [b[0].min(q.x), b[1].min(q.y), b[2].max(q.x), b[3].max(q.y)];
            }
        }
        let held = self.held_within(b, s);
        // The loop's stretches: a segment that may hang split where it leaves what holds it up, any other held.
        let mut runs: Vec<(Vec<Pt>, bool)> = Vec::new();
        for (segment, &candidate) in path.points.windows(2).zip(&candidates) {
            let pieces = if !candidate {
                vec![(segment.to_vec(), false)]
            } else if held.edges.is_empty() {
                vec![(segment.to_vec(), true)]
            } else {
                split(segment, &held)
            };
            for (points, beyond) in pieces {
                match runs.last_mut() {
                    Some((run, was)) if *was == beyond && run.last() == points.first() => {
                        run.extend_from_slice(&points[1..]);
                    }
                    _ => runs.push((points, beyond)),
                }
            }
        }
        if runs.len() == 1 && !runs[0].1 {
            if let Some((points, speeds)) =
                self.slow(&path.points, Some(&signed), path.role, path.width, path.mm3_per_mm, path.speed, s)
            {
                path.parts = speeds.into_iter().map(|speed| Part { overhang: false, speed }).collect();
                path.points = points;
            }
            return path;
        }
        let mut points: Vec<Pt> = Vec::with_capacity(n + 8);
        let mut parts: Vec<Part> = Vec::with_capacity(n + 8);
        for (run, over) in runs {
            if run.len() < 2 {
                continue;
            }
            let (role, width, mm3_per_mm, speed) = if over {
                (Role::OverhangWall, overhang.0, overhang.1, overhang.2)
            } else {
                (path.role, path.width, path.mm3_per_mm, path.speed)
            };
            let (run, speeds) = match self.slow(&run, None, role, width, mm3_per_mm, speed, s) {
                Some(slowed) => slowed,
                None => {
                    let k = run.len() - 1;
                    (run, vec![speed as f32; k])
                }
            };
            let from = if points.last() == Some(&run[0]) { 1 } else { 0 };
            if from == 0 && !points.is_empty() {
                // Stretches meet end to start; should one not, the gap prints as the stretch it leads to.
                parts.push(Part { overhang: over, speed: speeds[0] });
            }
            points.extend_from_slice(&run[from..]);
            parts.extend(speeds.into_iter().map(|speed| Part { overhang: over, speed }));
        }
        if points.len() >= 2 {
            path.points = points;
            path.parts = parts;
        }
        path
    }

    /// A bridge line, slowed where it hangs (Orca slows bridges as it slows walls).
    pub fn bridge(&self, mut path: Path, s: &Settings) -> Path {
        if let Some((points, speeds)) =
            self.slow(&path.points, None, path.role, path.width, path.mm3_per_mm, path.speed, s)
        {
            path.parts = speeds.into_iter().map(|speed| Part { overhang: false, speed }).collect();
            path.points = points;
        }
        path
    }

    /// Orca's overhang speeds along a path printed as `role` (`signed`: its points' distances from the layer below's
    /// outline, where known): its points, with the points Orca adds, and each segment's speed; None where it prints
    /// at its own speed all along (to within 1 mm/s).
    #[allow(clippy::too_many_arguments)]
    fn slow(
        &self,
        points: &[Pt],
        signed: Option<&[f64]>,
        role: Role,
        width: f64,
        mm3_per_mm: f64,
        speed: f64,
        s: &Settings,
    ) -> Option<(Vec<Pt>, Vec<f32>)> {
        if !s.overhang_speed || points.len() < 2 {
            return None;
        }
        let table = Slowdown::new(role, width, mm3_per_mm, speed, s);
        let input: Vec<(f64, f64)> = points.iter().map(|q| (geom::unsc(q.x), geom::unsc(q.y))).collect();
        let ext = self.properties(&input, signed, &table);
        let n = ext.len();
        // Each point's speed onward and how much of the line rests on the layer below there
        // (`estimate_extrusion_quality`).
        let mut speeds: Vec<f32> = Vec::with_capacity(n);
        let mut overlaps: Vec<f32> = Vec::with_capacity(n);
        let width_inv = 1.0 / table.width;
        for i in 0..n {
            let (curr, next) = (ext[i], ext[(i + 1).min(n - 1)]);
            speeds.push(table.calc(curr.d).min(table.calc(next.d)).min(table.speed));
            overlaps.push((1.0 - curr.d * width_inv).min(1.0 - next.d * width_inv));
        }
        let slows = speeds.iter().any(|&v| (v as f64 - speed).abs() > 1.0);
        let fans = table.fan >= 0.0 && overlaps.windows(2).any(|w| (w[0] <= table.fan) != (w[1] <= table.fan));
        if !slows && !fans {
            return None;
        }
        let points = ext
            .iter()
            .map(|p| geom::pt((p.x * geom::SCALE).round() as i32, (p.y * geom::SCALE).round() as i32))
            .collect();
        speeds.pop();
        Some((points, speeds))
    }

    /// Orca's `estimate_points_properties` (scaled input, crossings added, the layer below's outline offset by half
    /// the line, signed distances, no curvature): the path's points with how far each hangs, plus the points its
    /// passes add.
    fn properties(&self, input: &[(f64, f64)], signed: Option<&[f64]>, table: &Slowdown) -> Vec<Ext> {
        const EPSILON: f64 = 1e-4;
        let flow_width = table.width;
        let min_spacing = flow_width as f64 * 0.25;
        let bo: f32 = 0.5 * flow_width;
        let distance = |x: f64, y: f64| -> f32 { (self.outline.signed(x, y) + bo as f64) as f32 };
        let input_distance = |k: usize| -> f32 {
            match signed {
                Some(known) => (known[k] + bo as f64) as f32,
                None => distance(input[k].0, input[k].1),
            }
        };

        let mut points: Vec<Ext> = Vec::with_capacity(input.len() * 3 / 2 + 2);
        points.push(Ext { x: input[0].0, y: input[0].1, d: input_distance(0) });
        let mut crossings: Vec<(f64, f64, f64)> = Vec::new();
        for (k, &(x, y)) in input.iter().enumerate().skip(1) {
            let next = Ext { x, y, d: input_distance(k) };
            let prev = *points.last().unwrap();
            // Where the line crosses the layer below's outline, a point that hangs half a line.
            if (prev.d as f64 > bo as f64 + EPSILON) != (next.d as f64 > bo as f64 + EPSILON) {
                self.outline.crossings((prev.x, prev.y), (next.x, next.y), &mut crossings);
                for &(_, cx, cy) in &crossings {
                    if (cx - prev.x).hypot(cy - prev.y) > min_spacing && (next.x - cx).hypot(next.y - cy) > min_spacing
                    {
                        points.push(Ext { x: cx, y: cy, d: bo });
                    }
                }
            }
            points.push(next);
        }

        // Probes along long lines, kept where the ends wouldn't tell how the line prints there.
        if table.min_distance > 0.0 || table.fan >= 0.0 {
            let max_probe_spacing = f64::max(2.0, 4.0 * min_spacing);
            const MAX_DEPTH: i32 = 10;
            let mut sampled: Vec<Ext> = Vec::new();
            let mut interior: Vec<(f64, f32)> = Vec::new();
            let mut pending: Vec<(f64, f64, i32)> = Vec::new();
            for idx in 0..points.len() - 1 {
                let (curr, next) = (points[idx], points[idx + 1]);
                let step = (next.x - curr.x, next.y - curr.y);
                let line_len = step.0.hypot(step.1);
                interior.clear();
                if line_len >= max_probe_spacing {
                    pending.push((0.0, 1.0, MAX_DEPTH));
                }
                while let Some((t0, t1, depth)) = pending.pop() {
                    if depth <= 0 || (t1 - t0) * line_len < max_probe_spacing {
                        continue;
                    }
                    let t = 0.5 * (t0 + t1);
                    interior.push((t, distance(curr.x + t * step.0, curr.y + t * step.1)));
                    pending.push((t0, t, depth - 1));
                    pending.push((t, t1, depth - 1));
                }
                if !interior.is_empty() {
                    interior.sort_by(|a, b| a.0.total_cmp(&b.0));
                    let mut kept = 0;
                    for i in 0..interior.len() {
                        let sample = interior[i].1;
                        let at_start = kept == 0;
                        let at_end = i + 1 == interior.len();
                        let before = if at_start { curr.d } else { interior[kept - 1].1 };
                        let after = if at_end { next.d } else { interior[i + 1].1 };
                        let worth_before = !table.same(sample, before) && (!at_start || table.slower(sample, before));
                        let worth_after = !table.same(sample, after) && (!at_end || table.slower(sample, after));
                        if worth_before || worth_after {
                            interior[kept] = interior[i];
                            kept += 1;
                        }
                    }
                    interior.truncate(kept);
                }
                if !interior.is_empty() && sampled.is_empty() {
                    sampled.reserve(points.len() + 8);
                    sampled.extend_from_slice(&points[..=idx]);
                }
                if !sampled.is_empty() {
                    for &(t, d) in &interior {
                        sampled.push(Ext { x: curr.x + t * step.0, y: curr.y + t * step.1, d });
                    }
                    sampled.push(next);
                }
            }
            if !sampled.is_empty() {
                points = sampled;
            }
        }

        // Cuts that keep a slow end's slowdown to the stretch beside it: as long as the end hangs, plus a line and a
        // half.
        let mut out: Vec<Ext> = Vec::with_capacity(points.len() * 2);
        out.push(points[0]);
        let near = |d: f32| d > -bo && d < bo + 2.0;
        for idx in 0..points.len() - 1 {
            let (curr, next) = (points[idx], points[idx + 1]);
            if near(curr.d) || near(next.d) {
                let line_len = (next.x - curr.x).hypot(next.y - curr.y);
                let split = line_len >= 2.0 && (table.slower(curr.d, 0.0) || table.slower(next.d, 0.0));
                if split {
                    let a0 = (((curr.d + 3.0 * bo) as f64) / line_len).clamp(0.0, 1.0);
                    let a1 = (1.0 - ((next.d + 3.0 * bo) as f64) / line_len).clamp(0.0, 1.0);
                    let (t0, t1) = (a0.min(a1), a0.max(a1));
                    let mut cut = [Ext { x: 0.0, y: 0.0, d: 0.0 }; 2];
                    let mut keep = [false; 2];
                    for k in 0..2 {
                        let t = if k == 0 { t0 } else { t1 };
                        if if k == 0 { t >= 1.0 } else { t <= 0.0 } {
                            continue;
                        }
                        let (px, py) = (curr.x + t * (next.x - curr.x), curr.y + t * (next.y - curr.y));
                        cut[k] = Ext { x: px, y: py, d: distance(px, py) };
                        keep[k] = (px - curr.x).hypot(py - curr.y) > min_spacing
                            && (next.x - px).hypot(next.y - py) > min_spacing;
                    }
                    // Only cuts that print otherwise than what is either side of them.
                    if keep[0] {
                        keep[0] = !table.same(cut[0].d, curr.d)
                            || !table.same(cut[0].d, if keep[1] { cut[1].d } else { next.d });
                    }
                    if keep[1] {
                        keep[1] = !table.same(cut[1].d, if keep[0] { cut[0].d } else { curr.d })
                            || !table.same(cut[1].d, next.d);
                    }
                    if keep[0] && keep[1] && (cut[1].x - cut[0].x).hypot(cut[1].y - cut[0].y) <= min_spacing {
                        keep[1] = false;
                    }
                    for k in 0..2 {
                        if keep[k] {
                            out.push(cut[k]);
                        }
                    }
                }
            }
            out.push(next);
        }
        out
    }
}

/// A point of a path (mm) and how far it hangs: its signed distance to the layer below's outline plus half the line
/// (0 for a line wholly on the layer below, the line's width for one wholly beyond it).
#[derive(Clone, Copy, Debug)]
struct Ext {
    x: f64,
    y: f64,
    d: f32,
}

/// How a path's speed follows how far it hangs (`estimate_extrusion_quality`'s speed sections), and the overhang fan.
struct Slowdown {
    width: f32,
    /// The path's own speed, which nothing here exceeds.
    speed: f32,
    /// (how far it hangs, speed), by distance.
    sections: Vec<(f32, f32)>,
    /// The overlap at or under which the overhang fan comes on; below zero where it doesn't apply.
    fan: f32,
    /// The least distance at which the path slows down; below zero where it never does.
    min_distance: f32,
}

impl Slowdown {
    fn new(role: Role, width: f64, mm3_per_mm: f64, speed: f64, s: &Settings) -> Slowdown {
        // Orca's reference: the outer wall's speed for the outer wall, the inner wall's for everything else, within
        // the filament's flow.
        let volumetric = s.max_volumetric_speed;
        let mut reference = if role == Role::OuterWall { s.outer_wall_speed } else { s.inner_wall_speed };
        if reference == 0.0 && mm3_per_mm > 0.0 {
            reference = volumetric / mm3_per_mm;
        }
        if volumetric > 0.0 && mm3_per_mm > 0.0 {
            reference = reference.min(volumetric / mm3_per_mm);
        }
        let share = |v: crate::config::Share| -> f64 {
            let abs = v.of(reference);
            if abs < 0.5 { 100.0 } else { abs * 100.0 / reference }
        };
        let last = if s.slow_for_curls && role != Role::Bridge {
            share(s.overhang_speeds[3])
        } else {
            s.bridge_speed * 100.0 / reference
        };
        let percents = [
            100.0,
            share(s.overhang_speeds[0]),
            share(s.overhang_speeds[1]),
            share(s.overhang_speeds[2]),
            share(s.overhang_speeds[3]),
            last,
        ];
        const OVERLAPS: [f64; 6] = [90.0, 75.0, 50.0, 25.0, 13.0, 0.0];
        let w = width as f32;
        let reference32 = reference as f32;
        let mut sections: Vec<(f32, f32)> = OVERLAPS
            .iter()
            .zip(percents)
            .map(|(&o, p)| ((w as f64 * (1.0 - o / 100.0)) as f32, (reference32 as f64 * p / 100.0) as f32))
            .collect();
        sections.sort_by(|a, b| if a.0 == b.0 { b.1.total_cmp(&a.1) } else { a.0.total_cmp(&b.0) });
        let mut last = (f32::INFINITY, 0.0f32);
        for section in &mut sections {
            if section.0 == last.0 {
                section.1 = last.1;
            } else {
                last = *section;
            }
        }
        let speed = speed as f32;
        let min_distance = sections.iter().filter(|s| s.1 <= speed).map(|s| s.0).fold(f32::INFINITY, f32::min);
        let min_distance = if min_distance.is_finite() { min_distance } else { -1.0 };
        let fan = match role {
            Role::Bridge | Role::OverhangWall => -1.0,
            _ => s.overhang_fan_overlap as f32,
        };
        Slowdown { width: w, speed, sections, fan, min_distance }
    }

    /// The speed where the line hangs `d` (Orca's `calculate_speed`, rounded to whole mm/s).
    fn calc(&self, d: f32) -> f32 {
        let s = &self.sections;
        let last = s[s.len() - 1];
        let v = if d <= s[0].0 {
            self.speed
        } else if d >= last.0 {
            last.1
        } else {
            let mut i = 0;
            while d > s[i + 1].0 {
                i += 1;
            }
            let t = ((d - s[i].0) / (s[i + 1].0 - s[i].0)).clamp(0.0, 1.0);
            (1.0 - t) * s[i].1 + t * s[i + 1].1
        };
        v.round()
    }

    fn effective(&self, d: f32) -> f32 {
        self.calc(d).min(self.speed)
    }

    fn fan_on(&self, d: f32) -> bool {
        self.fan >= 0.0 && 1.0 - d * (1.0 / self.width) <= self.fan
    }

    /// Whether two points hanging `a` and `b` print alike: the same speed to within 1 mm/s, the same fan.
    fn same(&self, a: f32, b: f32) -> bool {
        (self.effective(a) - self.effective(b)).abs() <= 1.0 && self.fan_on(a) == self.fan_on(b)
    }

    /// Whether a point hanging `a` prints slower than one hanging `b` (by more than 1 mm/s), or with the fan on where
    /// that one has it off.
    fn slower(&self, a: f32, b: f32) -> bool {
        self.effective(a) < self.effective(b) - 1.0 || (self.fan_on(a) && !self.fan_on(b))
    }
}

/// A closed wall loop's stretches within the area and beyond it (Clipper's `intersection_pl` and `diff_pl` of the
/// loop as a polyline), in order along it from its first point, each with whether it is beyond.
fn split(line: &[Pt], grid: &EdgeGrid) -> Vec<(Vec<Pt>, bool)> {
    let pts: Vec<(f64, f64)> = line.iter().map(|q| (q.x as f64, q.y as f64)).collect();
    if pts.len() < 2 {
        return vec![(line.to_vec(), false)];
    }
    let mut cuts: Vec<(usize, f64)> = Vec::new();
    let mut ids = Vec::new();
    for s in 0..pts.len() - 1 {
        grid.edges_along(pts[s], pts[s + 1], &mut ids);
        for &id in &ids {
            let (c, d, _, _) = grid.edges[id as usize];
            if let Some((t, _)) = fill::crossing(pts[s], pts[s + 1], c, d) {
                cuts.push((s, t));
            }
        }
    }
    if cuts.is_empty() {
        // Wholly one or the other: one test of a point along it.
        let k = (1..pts.len()).find(|&k| pts[k] != pts[0]).unwrap_or(1);
        let mid = ((pts[0].0 + pts[k].0) / 2.0, (pts[0].1 + pts[k].1) / 2.0);
        return vec![(line.to_vec(), !grid.inside(mid))];
    }
    cuts.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
    let at = |s: usize, t: f64| {
        let (a, b) = (pts[s], pts[s + 1]);
        (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
    };
    let mut stops: Vec<(usize, f64)> = vec![(0, 0.0)];
    stops.extend(cuts);
    stops.push((pts.len() - 2, 1.0));
    let mut out: Vec<(Vec<Pt>, bool)> = Vec::new();
    for w in stops.windows(2) {
        let ((s0, t0), (s1, t1)) = (w[0], w[1]);
        let start = at(s0, t0);
        let mut rest: Vec<(f64, f64)> = (s0 + 1..=s1).map(|v| pts[v]).collect();
        rest.push(at(s1, t1));
        let Some(&next) = rest.iter().find(|q| (q.0 - start.0).hypot(q.1 - start.1) > 1e-6) else { continue };
        let beyond = !grid.inside(((start.0 + next.0) / 2.0, (start.1 + next.1) / 2.0));
        match out.last_mut() {
            Some((points, was)) if *was == beyond => {
                for q in rest {
                    fill::push_point(points, fill::to_pt(q));
                }
            }
            _ => {
                let mut points = vec![fill::to_pt(start)];
                for q in rest {
                    fill::push_point(&mut points, fill::to_pt(q));
                }
                out.push((points, beyond));
            }
        }
    }
    out.retain(|(points, _)| points.len() >= 2);
    out
}

/// The layer below's outline edge by edge, in square cells, for distances to it and crossings with it (Orca's
/// `LinesDistancer` over the lower layer's `lslices`). Each edge has the slice on its left (outlines run
/// counter-clockwise, holes clockwise).
struct Outline {
    x0: f64,
    y0: f64,
    cell: f64,
    nx: i64,
    ny: i64,
    /// Each cell's edges: `ids[start[c]..start[c + 1]]`.
    start: Vec<u32>,
    ids: Vec<u32>,
    edges: Vec<[f64; 4]>,
    /// The edges before and after each one on its contour.
    prev: Vec<u32>,
    next: Vec<u32>,
}

/// mm: the cells' size, and how many rings of them a search looks through before it takes every edge.
const CELL: f64 = 1.0;
const RINGS: i64 = 6;

impl Outline {
    fn new(shapes: &Shapes) -> Outline {
        let mut edges: Vec<[f64; 4]> = Vec::new();
        let (mut prev, mut next) = (Vec::new(), Vec::new());
        for contour in shapes.iter().flatten() {
            let mut pts: Vec<(f64, f64)> = Vec::with_capacity(contour.len());
            for q in contour {
                let p = (geom::unsc(q.x), geom::unsc(q.y));
                if pts.last() != Some(&p) {
                    pts.push(p);
                }
            }
            while pts.len() > 1 && pts.first() == pts.last() {
                pts.pop();
            }
            let n = pts.len();
            if n < 2 {
                continue;
            }
            let base = edges.len() as u32;
            for k in 0..n {
                let (a, b) = (pts[k], pts[(k + 1) % n]);
                edges.push([a.0, a.1, b.0, b.1]);
                prev.push(base + ((k + n - 1) % n) as u32);
                next.push(base + ((k + 1) % n) as u32);
            }
        }
        let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
        for e in &edges {
            b = [
                b[0].min(e[0]).min(e[2]),
                b[1].min(e[1]).min(e[3]),
                b[2].max(e[0]).max(e[2]),
                b[3].max(e[1]).max(e[3]),
            ];
        }
        if edges.is_empty() {
            b = [0.0, 0.0, 0.0, 0.0];
        }
        let (x0, y0) = (b[0] - CELL, b[1] - CELL);
        let nx = (((b[2] + CELL - x0) / CELL).ceil() as i64).max(1);
        let ny = (((b[3] + CELL - y0) / CELL).ceil() as i64).max(1);
        let mut o = Outline { x0, y0, cell: CELL, nx, ny, start: Vec::new(), ids: Vec::new(), edges, prev, next };
        // Each edge in every cell its bounding box touches, counted first and then placed.
        let ncells = (nx * ny) as usize;
        let mut count = vec![0u32; ncells + 1];
        let cells_of = |o: &Outline, e: &[f64; 4]| {
            let (cx0, cy0) = o.cell_of(e[0].min(e[2]), e[1].min(e[3]));
            let (cx1, cy1) = o.cell_of(e[0].max(e[2]), e[1].max(e[3]));
            (cx0.max(0), cy0.max(0), cx1.min(o.nx - 1), cy1.min(o.ny - 1))
        };
        for e in &o.edges {
            let (cx0, cy0, cx1, cy1) = cells_of(&o, e);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    count[(cy * nx + cx) as usize + 1] += 1;
                }
            }
        }
        for c in 0..ncells {
            count[c + 1] += count[c];
        }
        let mut fill_at = count.clone();
        let mut ids = vec![0u32; count[ncells] as usize];
        for (k, e) in o.edges.iter().enumerate() {
            let (cx0, cy0, cx1, cy1) = cells_of(&o, e);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    let c = (cy * nx + cx) as usize;
                    ids[fill_at[c] as usize] = k as u32;
                    fill_at[c] += 1;
                }
            }
        }
        o.start = count;
        o.ids = ids;
        o
    }

    fn cell_of(&self, x: f64, y: f64) -> (i64, i64) {
        (((x - self.x0) / self.cell).floor() as i64, ((y - self.y0) / self.cell).floor() as i64)
    }

    fn cell_edges(&self, cx: i64, cy: i64) -> &[u32] {
        if cx < 0 || cy < 0 || cx >= self.nx || cy >= self.ny {
            return &[];
        }
        let c = (cy * self.nx + cx) as usize;
        &self.ids[self.start[c] as usize..self.start[c + 1] as usize]
    }

    /// The edge nearest to (x, y): its squared distance, the edge and where along it the nearest point is (0 to 1).
    fn nearest(&self, x: f64, y: f64) -> Option<(f64, u32, f64)> {
        if self.edges.is_empty() {
            return None;
        }
        let mut best = (f64::INFINITY, 0u32, 0.0f64);
        let visit = |e: u32, best: &mut (f64, u32, f64)| {
            let [ax, ay, bx, by] = self.edges[e as usize];
            let (dx, dy) = (bx - ax, by - ay);
            let len2 = dx * dx + dy * dy;
            let t = if len2 > 0.0 { (((x - ax) * dx + (y - ay) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
            let (px, py) = (ax + t * dx, ay + t * dy);
            let d2 = (x - px) * (x - px) + (y - py) * (y - py);
            if d2 < best.0 {
                *best = (d2, e, t);
            }
        };
        let (cx, cy) = self.cell_of(x, y);
        for r in 0..=RINGS {
            if r == 0 {
                for &e in self.cell_edges(cx, cy) {
                    visit(e, &mut best);
                }
            } else {
                for ix in cx - r..=cx + r {
                    for &e in self.cell_edges(ix, cy - r).iter().chain(self.cell_edges(ix, cy + r)) {
                        visit(e, &mut best);
                    }
                }
                for iy in cy - r + 1..cy + r {
                    for &e in self.cell_edges(cx - r, iy).iter().chain(self.cell_edges(cx + r, iy)) {
                        visit(e, &mut best);
                    }
                }
            }
            // Every edge nearer than the rings reach is in them.
            let reach = r as f64 * self.cell;
            let covers = cx - r <= 0 && cy - r <= 0 && cx + r >= self.nx - 1 && cy + r >= self.ny - 1;
            if best.0 <= reach * reach || (covers && best.0.is_finite()) {
                return Some(best);
            }
        }
        for e in 0..self.edges.len() as u32 {
            visit(e, &mut best);
        }
        Some(best)
    }

    /// The signed distance (mm) from (x, y) to the outline: negative within the layer below, infinite where there
    /// is nothing below (Orca's `distance_from_lines_extra<true>`). Which side comes from the nearest edge, or at a
    /// corner from its two edges' normals together.
    fn signed(&self, x: f64, y: f64) -> f64 {
        let Some((d2, e, t)) = self.nearest(x, y) else { return f64::INFINITY };
        if d2 <= 0.0 {
            return 0.0;
        }
        let [ax, ay, bx, by] = self.edges[e as usize];
        let inside = if t > 0.0 && t < 1.0 {
            (bx - ax) * (y - ay) - (by - ay) * (x - ax) > 0.0
        } else {
            let (v, e_in, e_out) =
                if t <= 0.0 { ((ax, ay), self.prev[e as usize], e) } else { ((bx, by), e, self.next[e as usize]) };
            let normal = |k: u32| {
                let [ax, ay, bx, by] = self.edges[k as usize];
                let l = (bx - ax).hypot(by - ay);
                if l > 0.0 { ((by - ay) / l, -(bx - ax) / l) } else { (0.0, 0.0) }
            };
            let (n1, n2) = (normal(e_in), normal(e_out));
            (x - v.0) * (n1.0 + n2.0) + (y - v.1) * (n1.1 + n2.1) < 0.0
        };
        let d = d2.sqrt();
        if inside { -d } else { d }
    }

    /// Where segment a–b crosses the outline, nearest a first (Orca's `intersections_with_line<true>`): into `out` as
    /// (distance from a, x, y).
    fn crossings(&self, a: (f64, f64), b: (f64, f64), out: &mut Vec<(f64, f64, f64)>) {
        const EPSILON: f64 = 1e-4;
        out.clear();
        let mut seen: Vec<u32> = Vec::new();
        // The cells along the segment.
        let (ax, ay) = ((a.0 - self.x0) / self.cell, (a.1 - self.y0) / self.cell);
        let (bx, by) = ((b.0 - self.x0) / self.cell, (b.1 - self.y0) / self.cell);
        let (mut ix, mut iy) = (ax.floor() as i64, ay.floor() as i64);
        let (ex, ey) = (bx.floor() as i64, by.floor() as i64);
        let (dx, dy) = (bx - ax, by - ay);
        let (step_x, step_y) = (if dx > 0.0 { 1 } else { -1 }, if dy > 0.0 { 1 } else { -1 });
        let delta_x = if dx != 0.0 { (1.0 / dx).abs() } else { f64::INFINITY };
        let delta_y = if dy != 0.0 { (1.0 / dy).abs() } else { f64::INFINITY };
        let mut max_x = if dx > 0.0 {
            ((ix + 1) as f64 - ax) / dx
        } else if dx < 0.0 {
            (ix as f64 - ax) / dx
        } else {
            f64::INFINITY
        };
        let mut max_y = if dy > 0.0 {
            ((iy + 1) as f64 - ay) / dy
        } else if dy < 0.0 {
            (iy as f64 - ay) / dy
        } else {
            f64::INFINITY
        };
        let steps = (ex - ix).abs() + (ey - iy).abs() + 2;
        for _ in 0..=steps {
            seen.extend_from_slice(self.cell_edges(ix, iy));
            if ix == ex && iy == ey {
                break;
            }
            if max_x < max_y {
                ix += step_x;
                max_x += delta_x;
            } else {
                iy += step_y;
                max_y += delta_y;
            }
        }
        seen.sort_unstable();
        seen.dedup();
        let v1 = (b.0 - a.0, b.1 - a.1);
        for &e in &seen {
            let [cx, cy, dx, dy] = self.edges[e as usize];
            let v2 = (dx - cx, dy - cy);
            let denom = v1.0 * v2.1 - v1.1 * v2.0;
            if denom.abs() < EPSILON {
                continue;
            }
            let v12 = (a.0 - cx, a.1 - cy);
            let t1 = (v2.0 * v12.1 - v2.1 * v12.0) / denom;
            let t2 = (v1.0 * v12.1 - v1.1 * v12.0) / denom;
            if (0.0..=1.0).contains(&t1) && (0.0..=1.0).contains(&t2) {
                let (px, py) = (a.0 + t1 * v1.0, a.1 + t1 * v1.1);
                out.push(((px - a.0).hypot(py - a.1), px, py));
            }
        }
        out.sort_by(|p, q| p.0.total_cmp(&q.0));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Contour {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]
    }

    #[test]
    fn distances_to_the_layer_below_are_signed() {
        let mut hole = square(8.0, 8.0, 12.0, 12.0);
        hole.reverse();
        let o = Outline::new(&vec![vec![square(0.0, 0.0, 20.0, 20.0), hole]]);
        let close = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(close(o.signed(1.0, 10.0), -1.0));
        assert!(close(o.signed(-0.5, 10.0), 0.5));
        assert!(close(o.signed(10.0, 10.0), 2.0), "in the hole: {}", o.signed(10.0, 10.0));
        assert!(close(o.signed(7.0, 10.0), -1.0));
        // Off a corner, outside and in.
        assert!(close(o.signed(-3.0, -4.0), 5.0));
        assert!(close(o.signed(0.5, 0.5), -0.5));
        // Far away: past the rings searched.
        assert!(close(o.signed(60.0, 10.0), 40.0));
        let mut out = Vec::new();
        o.crossings((-1.0, 5.0), (21.0, 5.0), &mut out);
        assert_eq!(out.len(), 2);
        assert!(close(out[0].1, 0.0) && close(out[1].1, 20.0));
    }

    #[test]
    fn a_wall_beyond_the_layer_below_prints_as_overhang_wall() {
        let s = Settings::default();
        // The layer below: 20 mm square. This layer's outer wall runs 3 mm further out on the right.
        let below = Below::new(&vec![vec![square(0.0, 0.0, 20.0, 20.0)]], &s);
        let mut points = square(0.2, 0.2, 23.0, 19.8);
        points.push(points[0]);
        let path = Path {
            role: Role::OuterWall,
            points,
            closed: true,
            width: 0.42,
            mm3_per_mm: Settings::mm3_per_mm(0.42, 0.2),
            speed: 200.0,
            accel: 5000.0,
            island: 0,
            object: 0,
            parts: Vec::new(),
        };
        let wall = below.wall(path, (0.4, Settings::mm3_per_mm(0.4, 0.2), 50.0, 2500.0), &s);
        assert_eq!(wall.parts.len(), wall.points.len() - 1);
        let length = |overhang: bool| -> f64 {
            wall.points
                .windows(2)
                .zip(&wall.parts)
                .filter(|(_, p)| p.overhang == overhang)
                .map(|(w, _)| geom::dist(w[0], w[1]) / geom::SCALE)
                .sum()
        };
        // Beyond x = 20.2: 2.8 mm along the bottom and the top, and the 19.6 mm right side.
        assert!((length(true) - (2.8 + 19.6 + 2.8)).abs() < 1e-3, "{}", length(true));
        // The overhang wall prints at the bridge speed; the outer wall slows down to it near the edge and is at full
        // speed further back.
        assert!(wall.parts.iter().filter(|p| p.overhang).all(|p| p.speed == 50.0));
        assert!(wall.parts.iter().any(|p| !p.overhang && p.speed == 200.0));
        let slowest = wall.parts.iter().filter(|p| !p.overhang).map(|p| p.speed).fold(f32::INFINITY, f32::min);
        assert!(slowest < 200.0, "{slowest}");
    }

    #[test]
    fn a_wall_on_the_layer_below_keeps_its_speed() {
        let s = Settings::default();
        let below = Below::new(&vec![vec![square(0.0, 0.0, 20.0, 20.0)]], &s);
        let mut points = square(0.21, 0.21, 19.79, 19.79);
        points.push(points[0]);
        let path = Path {
            role: Role::OuterWall,
            points: points.clone(),
            closed: true,
            width: 0.42,
            mm3_per_mm: Settings::mm3_per_mm(0.42, 0.2),
            speed: 200.0,
            accel: 5000.0,
            island: 0,
            object: 0,
            parts: Vec::new(),
        };
        let wall = below.wall(path, (0.4, Settings::mm3_per_mm(0.4, 0.2), 50.0, 2500.0), &s);
        assert!(wall.parts.is_empty());
        assert_eq!(wall.points, points);
    }
}
