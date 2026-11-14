//! How solid infill fills a region, as Orca's `detect_narrow_internal_solid_infill` does: lines where they run
//! long enough, loops where the region is a narrow band (along a sloping wall, say), so the band prints as a few
//! long strokes instead of many short ones that make the printer shake.
//!
//! `split_narrow` ports Orca's `split_solid_surface` for line patterns: lines a spacing apart, at the infill's
//! angle, through the region's core (what remains of the parts at least four spacings wide, grown back by three);
//! runs of short lines that would only zig-zag are dropped (PrusaSlicer's filter against vibrating extrusions,
//! which Orca took over); the strips the remaining lines cover are lines, the rest of the region loops.
//!
//! `narrow_loops` stands in for Orca's Arachne fill of the narrow parts (`FillConcentricInternal`), with Arachne's
//! bead counts and widths but not its skeleton: a band holds as many beads, a solid line's spacing wide, as
//! Arachne's thresholds give (measured against the line's width, as Arachne measures them), and the middle one or
//! two take up what is left. So a band too thin for two beads is one line along its middle, as wide as the band (at
//! least 85 % of the nozzle); one that holds two is a loop of two half-bands; a wider one gets a loop half a bead in
//! from its edge, and so on inwards. The odd middle beads run along the region's medial axis, which also gives each
//! loop the band's width beside it.

use crate::geom::{self, Pt, Shape, Shapes};
use crate::medial;

/// mm: lines longer than this never shake the printer (PrusaSlicer's `MAX_LINE_LENGTH_TO_FILTER`).
const MAX_LINE_LENGTH_TO_FILTER: f64 = 4.0;
/// How many long lines a run of short ones may pass through and still be filtered.
const MAX_SKIPS_ALLOWED: i32 = 2;
/// How many short lines in a row are filtered whatever their neighbours.
const MIN_DEPTH_FOR_LINE_REMOVING: i32 = 5;

/// A region split into where lines go and where loops go (the lines' part overlaps the loops' by half a spacing,
/// as Orca's does, so nothing is left between them); `None` when it is all lines.
pub fn split_narrow(area: &Shape, spacing: f64, direction: f64) -> Option<(Shapes, Shapes)> {
    let sp = spacing * geom::SCALE;
    let bb = geom::bbox_of(area);
    let centre = ((bb[0] as f64 + bb[2] as f64) / 2.0, (bb[1] as f64 + bb[3] as f64) / 2.0);
    // Turn so the lines are vertical (Orca turns by π minus its fill angle, the line's way plus a quarter turn).
    let angle = std::f64::consts::FRAC_PI_2 - direction;
    let turn = |q: Pt, angle: f64| -> Pt {
        let (s, c) = angle.sin_cos();
        let (x, y) = (q.x as f64 - centre.0, q.y as f64 - centre.1);
        geom::pt((centre.0 + c * x - s * y).round() as i32, (centre.1 + c * y + s * x).round() as i32)
    };
    let filled: Shapes = vec![area.iter().map(|c| c.iter().map(|&q| turn(q, angle)).collect()).collect()];
    let fb = geom::bbox(&filled)?;
    let eroded = if max_inradius(area) < 2.0 * sp { Vec::new() } else { geom::offset(&filled, -2.0 * spacing) };
    if eroded.is_empty() {
        // No core at all: the whole region loops.
        return Some((Vec::new(), vec![area.clone()]));
    }
    let core = geom::intersection(&filled, &geom::offset(&eroded, 3.0 * spacing));
    let core = geom::offset(&core, -0.5 * spacing);

    // Sections of the vertical lines through the core longer than a spacing.
    let n_vlines = ((fb[2] as f64 - fb[0] as f64 + sp - 1.0) / sp).floor().max(0.0) as usize;
    let mut sections: Vec<Vec<(f64, f64, f64)>> = vec![Vec::new(); n_vlines];
    let mut ys: Vec<f64> = Vec::new();
    for (i, section) in sections.iter_mut().enumerate() {
        let x = fb[0] as f64 + i as f64 * sp;
        ys.clear();
        for shape in &core {
            for contour in shape {
                let n = contour.len();
                for k in 0..n {
                    let (a, b) = (contour[k], contour[(k + 1) % n]);
                    let (ax, bx) = (a.x as f64, b.x as f64);
                    if (ax <= x && x < bx) || (bx <= x && x < ax) {
                        ys.push(a.y as f64 + (x - ax) * (b.y as f64 - a.y as f64) / (bx - ax));
                    }
                }
            }
        }
        ys.sort_by(f64::total_cmp);
        for pair in ys.as_chunks::<2>().0 {
            if pair[1] - pair[0] > sp {
                section.push((x, pair[0], pair[1]));
            }
        }
    }
    let sections = filter_vibrating(&sections, MAX_LINE_LENGTH_TO_FILTER * geom::SCALE);
    let normal = reconstruct(&sections, sp);
    if normal.is_empty() && sections.iter().all(Vec::is_empty) {
        // No core at all: the whole region loops.
        return Some((Vec::new(), vec![area.clone()]));
    }
    let normal: Vec<geom::Contour> =
        normal.into_iter().map(|c| c.into_iter().map(|q| turn(q, -angle)).collect()).collect();
    let mut normal = geom::union_contours(&normal);
    let region: Shapes = vec![area.clone()];
    let mut narrow = geom::difference(&region, &normal);
    // Bits narrower than a line that touch the lines' part go with it.
    let mut merged = false;
    narrow.retain(|piece| {
        let one: Shapes = vec![piece.clone()];
        if max_inradius(piece) >= 0.5 * sp && !geom::offset(&one, -0.5 * spacing).is_empty() {
            return true;
        }
        let grown = geom::offset(&one, 0.3 * spacing);
        let near = geom::near(&normal, geom::inflate(geom::bbox_of(piece), 0.3 * spacing));
        if geom::intersection(&near, &grown).is_empty() {
            return true;
        }
        merged = true;
        normal.push(piece.clone());
        false
    });
    if narrow.is_empty() {
        return None;
    }
    if merged {
        normal = geom::union_contours(&normal.concat());
    }
    let normal = geom::intersection(&geom::offset(&normal, 0.5 * spacing), &region);
    Some((normal, narrow))
}

/// At least the radius of the largest disc inside the shape (units): twice its area over its perimeter.
fn max_inradius(shape: &Shape) -> f64 {
    let area: f64 = shape.iter().map(|c| geom::area2(c) as f64 / 2.0).sum();
    let perimeter: f64 = shape.iter().map(|c| geom::length_mm(c, true) * geom::SCALE).sum();
    if perimeter > 0.0 { 2.0 * area.max(0.0) / perimeter } else { 0.0 }
}

/// A section of a vertical line in the core, with what the filter knows of it.
struct Node {
    x: f64,
    lo: f64,
    hi: f64,
    prev: Vec<usize>,
    next: Vec<usize>,
    removed: bool,
    min_skips: i32,
    short_lines: i32,
    touches_long: bool,
    initialized: bool,
}

impl Node {
    fn length(&self) -> f64 {
        self.hi - self.lo
    }

    fn reset(&mut self) {
        self.min_skips = 0;
        self.short_lines = 0;
        self.touches_long = false;
        self.initialized = false;
    }
}

/// PrusaSlicer's `filter_vibrating_extrusions` (as Orca has it): drops runs of short sections that zig-zag from
/// line to line, keeping those that lead on to long ones.
fn filter_vibrating(sections: &[Vec<(f64, f64, f64)>], max_len: f64) -> Vec<Vec<(f64, f64, f64)>> {
    let mut nodes: Vec<Node> = Vec::new();
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::new();
    for section in sections {
        let start = nodes.len();
        nodes.extend(section.iter().map(|&(x, lo, hi)| Node {
            x,
            lo,
            hi,
            prev: Vec::new(),
            next: Vec::new(),
            removed: false,
            min_skips: 0,
            short_lines: 0,
            touches_long: false,
            initialized: false,
        }));
        ranges.push(start..nodes.len());
    }
    let overlapping = |a: &Node, b: &Node| {
        (b.lo <= a.lo && a.lo <= b.hi)
            || (b.lo <= a.hi && a.hi <= b.hi)
            || (a.lo <= b.lo && b.lo <= a.hi)
            || (a.lo <= b.hi && b.hi <= a.hi)
    };
    for s in 1..ranges.len() {
        for i in ranges[s].clone() {
            for j in ranges[s - 1].clone() {
                if overlapping(&nodes[i], &nodes[j]) {
                    nodes[i].prev.push(j);
                    nodes[j].next.push(i);
                }
            }
        }
    }
    let is_short = |n: &Node| n.length() < max_len;
    let touching_long_before =
        |nodes: &[Node], i: usize| nodes[i].prev.iter().any(|&p| !nodes[p].removed && !is_short(&nodes[p]));
    let can_remove = |nodes: &[Node], i: usize| {
        let n = &nodes[i];
        let initial_touches = n.prev.iter().any(|&p| nodes[p].touches_long);
        let has_next = n.next.iter().any(|&q| !nodes[q].removed);
        is_short(n) && (n.short_lines > MIN_DEPTH_FOR_LINE_REMOVING || (!initial_touches && !has_next))
    };
    // First in, first out: `queue[head..]` is waiting.
    let mut queue: Vec<usize> = Vec::new();
    for initial in 0..ranges.len() {
        for i in ranges[initial].clone() {
            if nodes[i].removed || !is_short(&nodes[i]) {
                continue;
            }
            nodes[i].reset();
            nodes[i].short_lines = 1;
            nodes[i].touches_long = touching_long_before(&nodes, i);
            nodes[i].initialized = true;
        }
        for s in initial..ranges.len() {
            if s + 1 < ranges.len() {
                for i in ranges[s + 1].clone() {
                    nodes[i].reset();
                }
            }
            for i in ranges[s].clone() {
                if nodes[i].removed || !nodes[i].initialized {
                    continue;
                }
                for k in 0..nodes[i].next.len() {
                    let nb = nodes[i].next[k];
                    if nodes[nb].removed {
                        continue;
                    }
                    let short = is_short(&nodes[nb]);
                    let skip_allowed = nodes[i].min_skips < MAX_SKIPS_ALLOWED;
                    if !short && !skip_allowed {
                        continue;
                    }
                    let total = nodes[i].short_lines + short as i32;
                    let skips = nodes[i].min_skips + !short as i32;
                    let touches = nodes[i].touches_long;
                    let n = &mut nodes[nb];
                    if n.initialized {
                        n.min_skips = n.min_skips.max(total).min(skips);
                        if n.touches_long {
                            n.touches_long = touches;
                        }
                    } else {
                        n.short_lines = total;
                        n.min_skips = skips;
                        n.touches_long = touches;
                        n.initialized = true;
                    }
                }
                if can_remove(&nodes, i) {
                    nodes[i].removed = true;
                    queue.clear();
                    queue.extend(nodes[i].prev.iter().copied().filter(|&p| !nodes[p].removed));
                    let mut head = 0;
                    while head < queue.len() {
                        let p = queue[head];
                        head += 1;
                        if can_remove(&nodes, p) {
                            nodes[p].removed = true;
                            let more: Vec<usize> =
                                nodes[p].prev.iter().copied().filter(|&q| !nodes[q].removed).collect();
                            queue.extend(more);
                        }
                    }
                }
            }
        }
    }
    ranges.iter().map(|r| nodes[r.clone()].iter().filter(|n| !n.removed).map(|n| (n.x, n.lo, n.hi)).collect()).collect()
}

/// Orca's reconstruction of the area the kept sections cover: each section grown half a spacing along its line,
/// traced from line to line into polygons (a strip ends where its section has no single successor).
fn reconstruct(sections: &[Vec<(f64, f64, f64)>], sp: f64) -> Vec<geom::Contour> {
    struct Traced {
        lows: Vec<(f64, f64)>,
        highs: Vec<(f64, f64)>,
    }
    let half = sp / 2.0;
    let limit2 = (2.0 * sp) * (2.0 * sp);
    let d2 = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2);
    let mut out: Vec<geom::Contour> = Vec::new();
    let close = |t: &mut Traced, out: &mut Vec<geom::Contour>| {
        let mut points: Vec<Pt> = t.lows.iter().map(|&(x, y)| geom::pt(x.round() as i32, y.round() as i32)).collect();
        points.extend(t.highs.iter().rev().map(|&(x, y)| geom::pt(x.round() as i32, y.round() as i32)));
        if points.len() >= 3 {
            // Lows left to right, then highs back: counter-clockwise.
            out.push(points);
        }
        t.lows.clear();
        t.highs.clear();
    };
    let mut traced: Vec<Traced> = Vec::new();
    for slice in sections {
        let segs: Vec<((f64, f64), (f64, f64))> =
            slice.iter().map(|&(x, lo, hi)| ((x, lo - half), (x, hi + half))).collect();
        let mut used = vec![false; segs.len()];
        for t in traced.iter_mut() {
            let low = *t.lows.last().unwrap();
            let high = *t.highs.last().unwrap();
            let begin = segs.partition_point(|s| s.1.1 <= low.1);
            let end = segs.partition_point(|s| s.0.1 <= high.1);
            let mut added = false;
            let mut c = begin;
            while c < end && !added {
                if used[c] {
                    c += 1;
                    continue;
                }
                // As Orca: the first candidate's ends, whichever candidate is free.
                let (a, b) = segs[begin];
                if d2(low, a) < limit2 {
                    t.lows.push(a);
                } else {
                    t.lows.push((low.0 + half, low.1));
                    t.lows.push((a.0 - half, a.1));
                    t.lows.push(a);
                }
                if d2(high, b) < limit2 {
                    t.highs.push(b);
                } else {
                    t.highs.push((high.0 + half, high.1));
                    t.highs.push((b.0 - half, b.1));
                    t.highs.push(b);
                }
                added = true;
                used[begin] = true;
                c += 1;
            }
            if !added {
                t.lows.push((low.0 + half, low.1));
                t.highs.push((high.0 + half, high.1));
                close(t, &mut out);
            }
        }
        traced.retain(|t| !t.lows.is_empty());
        for (k, s) in segs.iter().enumerate() {
            if !used[k] {
                traced.push(Traced { lows: vec![(s.0.0 - half, s.0.1), s.0], highs: vec![(s.1.0 - half, s.1.1), s.1] });
            }
        }
    }
    for t in traced.iter_mut() {
        close(t, &mut out);
    }
    out
}

/// A line of varying width: Arachne's widths, each bead's share of the band, so it takes `width × height` mm³ a mm.
#[derive(Clone, Debug)]
pub struct ThickPath {
    pub points: Vec<Pt>,
    pub widths: Vec<f64>,
}

/// Arachne's beads for the narrow fill (`FillConcentricInternal`'s strategy: `DistributedBeadingStrategy` with one
/// centre bead, under `RedistributeBeadingStrategy` and `WideningBeadingStrategy`): how many beads a band holds, all a
/// solid line's spacing wide but the middle one or two, which take up what is left.
struct Beading {
    /// The beads' width, mm: the solid line's spacing.
    s: f64,
    min_bead: f64,
    min_feature: f64,
    /// Arachne's `wall_split_middle_threshold` and `wall_add_middle_threshold`, of a bead's width.
    split: f64,
    add: f64,
    /// How far a bead's width may stray to keep a bead count along a band (`wall_transition_filter_deviation`), mm.
    deviation: f64,
}

impl Beading {
    fn new(s: f64, nozzle: f64, h: f64) -> Beading {
        // WallToolPaths measures both thresholds against the line's width, not its spacing.
        let width = s + h * (1.0 - std::f64::consts::FRAC_PI_4);
        let min_bead = 0.85 * nozzle;
        Beading {
            s,
            min_bead,
            min_feature: 0.25 * nozzle,
            split: (2.0 * min_bead / width - 1.0).clamp(0.01, 0.99),
            add: (min_bead / width).clamp(0.01, 0.99),
            deviation: 0.25 * nozzle,
        }
    }

    /// How many beads fill a band `t` mm wide (`getOptimalBeadCount`).
    fn count(&self, t: f64) -> usize {
        if t < self.min_feature {
            return 0;
        }
        if t <= 2.0 * self.s {
            return if t > self.two() { 2 } else { 1 };
        }
        let inner = t - 2.0 * self.s;
        let naive = (inner / self.s).floor();
        let threshold = self.s * if naive as usize % 2 == 1 { self.split } else { self.add };
        2 + naive as usize + usize::from(inner - naive * self.s >= threshold)
    }

    /// The width from which a band holds two beads, mm (and, deeper in, two more).
    fn two(&self) -> f64 {
        (1.0 + self.split) * self.s
    }

    /// How far Arachne's transition from `lower` beads to one more reaches to the side with more beads (`upper`) or
    /// fewer, from where the band is as wide as the change takes (`getTransitionAnchorPos`), mm.
    fn half_transition(&self, lower: usize, upper: bool) -> f64 {
        // From no bead to one, the transition is a hundredth of a millimetre (`getTransitioningLength`).
        let length = if lower == 0 { 0.01 } else { TRANSITION_LENGTH };
        let past = if lower % 2 == 1 { self.split } else { self.add };
        length * if upper { past } else { 1.0 - past }
    }

    /// The width from which a band holds `n` beads or more, mm.
    fn threshold(&self, n: usize) -> f64 {
        match n {
            0 | 1 => self.min_feature,
            _ if n.is_multiple_of(2) => (n as f64 - 1.0 + self.split) * self.s,
            _ => (n as f64 - 1.0 + self.add) * self.s,
        }
    }
}

/// A middle line cut where its band's bead count changes (at the width where it does), each run with its count.
fn cut_by_count(line: &medial::ThickLine, beading: &Beading) -> Vec<(ThickPath, usize)> {
    let mut runs: Vec<(ThickPath, usize)> = Vec::new();
    let mut count = beading.count(line.widths[0]);
    let mut run = ThickPath { points: vec![line.points[0]], widths: vec![line.widths[0]] };
    for k in 1..line.points.len() {
        let (p, q) = (line.points[k - 1], line.points[k]);
        let (tp, tq) = (line.widths[k - 1], line.widths[k]);
        let target = beading.count(tq);
        while count != target {
            let next = if target > count { count + 1 } else { count - 1 };
            let t = beading.threshold(count.max(next));
            let f = if tq != tp { ((t - tp) / (tq - tp)).clamp(0.0, 1.0) } else { 0.0 };
            let x = geom::pt(
                (p.x as f64 + (q.x - p.x) as f64 * f).round() as i32,
                (p.y as f64 + (q.y - p.y) as f64 * f).round() as i32,
            );
            run.points.push(x);
            run.widths.push(t);
            let done = std::mem::replace(&mut run, ThickPath { points: vec![x], widths: vec![t] });
            runs.push((done, count));
            count = next;
        }
        run.points.push(q);
        run.widths.push(tq);
    }
    runs.push((run, count));
    runs
}

/// mm: how long Arachne's transition between two bead counts is (`wall_transition_length`, as
/// `FillConcentricInternal` sets it).
const TRANSITION_LENGTH: f64 = 0.4;

/// Arachne's filter on where a band's bead count changes (`filterTransitionMids`): where a bead (or a pair of them)
/// starts and soon stops again and the band stays within the allowed deviation of the width where it would, the
/// stretch keeps the count round it, its beads that much wider (the deviation counted in the bead it changes: all of
/// it in one middle bead, half in each of two); Arachne tries that first, and then the other way round, where a bead
/// stops and soon starts again. A stretch at a free end of the middle shorter than its half of the transition takes
/// the count beside it (`filterEndOfCentralTransition`), unless it would take a pair of beads the loops can't reach.
/// The runs of a ring (`closed`) go round: its last run lies before its first.
fn settle(runs: &mut Vec<(ThickPath, usize)>, beading: &Beading, free: [bool; 2], closed: bool) {
    loop {
        let n = runs.len();
        let mut changed = false;
        for bumps in [true, false] {
            let (from, to) = if closed && n >= 2 { (0, n) } else { (1, n.saturating_sub(1)) };
            for k in from..to {
                let (before, here, after) = (runs[(k + n - 1) % n].1, runs[k].1, runs[(k + 1) % n].1);
                if before != after || before.abs_diff(here) != 1 || (here > before) != bumps {
                    continue;
                }
                let t = beading.threshold(before.max(here));
                let off = runs[k].0.widths.iter().fold(0.0f64, |m, &w| m.max((w - t).abs()));
                if (if before % 2 == 1 { off } else { off / 2.0 }) <= beading.deviation {
                    runs[k].1 = before;
                    changed = true;
                }
            }
            if changed {
                break;
            }
        }
        for (end, next, is_free) in [(0, 1, free[0]), (n.wrapping_sub(1), n.wrapping_sub(2), free[1])] {
            if !is_free || closed || n < 2 {
                continue;
            }
            let (a, b) = (runs[end].1, runs[next].1);
            if a.abs_diff(b) != 1 || a.min(b) == 0 || (b.is_multiple_of(2) && b > a) {
                continue;
            }
            if geom::length_mm(&runs[end].0.points, false) < beading.half_transition(a.min(b), a > b) {
                runs[end].1 = runs[next].1;
                changed = true;
            }
        }
        if !changed {
            return;
        }
        // Runs that now hold the same count are one.
        let mut merged: Vec<(ThickPath, usize)> = Vec::with_capacity(runs.len());
        for (run, count) in runs.drain(..) {
            match merged.last_mut() {
                Some(last) if last.1 == count => join(&mut last.0, run),
                _ => merged.push((run, count)),
            }
        }
        if closed && merged.len() > 1 && merged[0].1 == merged[merged.len() - 1].1 {
            let (first, _) = merged.remove(0);
            join(&mut merged.last_mut().unwrap().0, first);
        }
        *runs = merged;
    }
}

/// `b` added to the end of `a`, which ends where it starts.
fn join(a: &mut ThickPath, b: ThickPath) {
    a.points.extend(b.points.into_iter().skip(1));
    a.widths.extend(b.widths.into_iter().skip(1));
}

/// A ring's runs, cut where its points happen to start and end, start instead where one run ends and the next
/// begins: the run across its first point is one.
fn ring_runs(mut runs: Vec<(ThickPath, usize)>) -> Vec<(ThickPath, usize)> {
    if runs.len() > 1 && runs[0].1 == runs[runs.len() - 1].1 {
        let (first, _) = runs.remove(0);
        join(&mut runs.last_mut().unwrap().0, first);
    }
    runs
}

/// mm: the shortest segment Arachne's simplification keeps in a line (`meshfix_maximum_resolution`).
const ARACHNE_RESOLUTION: f64 = 0.5;

/// The middle of a narrow region and its width there: where the odd beads run, and how wide the band is beside a
/// loop.
struct Axis {
    /// The middle lines, each cut where its bead count changes, with the count of each run, and whether it is a ring.
    runs: Vec<(Vec<(ThickPath, usize)>, bool)>,
    /// Each segment of the runs (units) with the band's width at its ends (mm) and its run's bead count.
    segments: Vec<(Pt, Pt, f64, f64, usize)>,
    cell: f64,
    origin: (f64, f64),
    size: (i64, i64),
    /// The segments in each cell, as offsets into `ids`.
    start: Vec<usize>,
    ids: Vec<usize>,
}

impl Axis {
    fn new(region: &Shapes, beading: &Beading, cell: f64) -> Axis {
        let mut lines = Vec::new();
        for shape in region {
            // Nowhere as wide as the narrowest feature: no line (and no Voronoi diagram to pay for).
            if max_inradius(shape) < beading.min_feature / 2.0 * geom::SCALE {
                continue;
            }
            lines.extend(medial::axis(shape, beading.min_feature, 1e3));
        }
        // A line's end that no other line shares ends the middle there; the others meet at junctions.
        let mut ends: std::collections::HashMap<(i32, i32), u32> = std::collections::HashMap::new();
        for line in &lines {
            for p in [line.points[0], *line.points.last().unwrap()] {
                *ends.entry((p.x, p.y)).or_default() += 1;
            }
        }
        let free = |p: Pt| ends.get(&(p.x, p.y)).copied() == Some(1);
        let runs: Vec<(Vec<(ThickPath, usize)>, bool)> = lines
            .iter()
            .map(|line| {
                let (first, last) = (line.points[0], *line.points.last().unwrap());
                let closed = line.points.len() > 2 && first == last;
                let mut runs = cut_by_count(line, beading);
                if closed {
                    runs = ring_runs(runs);
                }
                settle(&mut runs, beading, [free(first), free(last)], closed);
                (runs, closed)
            })
            .collect();
        let mut segments = Vec::new();
        for (run, count) in runs.iter().flat_map(|(runs, _)| runs) {
            for k in 1..run.points.len() {
                segments.push((run.points[k - 1], run.points[k], run.widths[k - 1], run.widths[k], *count));
            }
        }
        let cell = cell * geom::SCALE;
        let bb = geom::bbox(region).unwrap_or([0, 0, 0, 0]);
        let origin = (bb[0] as f64, bb[1] as f64);
        let size =
            (((bb[2] - bb[0]) as f64 / cell).floor() as i64 + 1, ((bb[3] - bb[1]) as f64 / cell).floor() as i64 + 1);
        let cells_of = |a: Pt, b: Pt| {
            let c = |v: i32, o: f64, n: i64| (((v as f64 - o) / cell).floor() as i64).clamp(0, n - 1);
            (
                c(a.x.min(b.x), origin.0, size.0),
                c(a.y.min(b.y), origin.1, size.1),
                c(a.x.max(b.x), origin.0, size.0),
                c(a.y.max(b.y), origin.1, size.1),
            )
        };
        let ncells = (size.0 * size.1) as usize;
        let mut start = vec![0usize; ncells + 1];
        for &(a, b, _, _, _) in &segments {
            let (x0, y0, x1, y1) = cells_of(a, b);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    start[(y * size.0 + x) as usize + 1] += 1;
                }
            }
        }
        for c in 0..ncells {
            start[c + 1] += start[c];
        }
        let mut at = start.clone();
        let mut ids = vec![0usize; start[ncells]];
        for (k, &(a, b, _, _, _)) in segments.iter().enumerate() {
            let (x0, y0, x1, y1) = cells_of(a, b);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let c = (y * size.0 + x) as usize;
                    ids[at[c]] = k;
                    at[c] += 1;
                }
            }
        }
        Axis { runs, segments, cell, origin, size, start, ids }
    }

    /// Arachne's odd beads: along the middle, wherever the band holds an odd number of beads, the middle one, as
    /// wide as the beads round it leave the band (at least the narrowest bead where it is the only one). Each stops
    /// half of two beads' width short of where the band holds one bead more (the loop round that part curls round
    /// there), and those shorter than half their narrowest width are left out (`removeSmallLines`).
    fn odd_beads(&self, beading: &Beading) -> Vec<ThickPath> {
        let trim = beading.two() / 2.0 * geom::SCALE;
        let mut out = Vec::new();
        for (runs, closed) in &self.runs {
            let len = runs.len();
            for k in 0..len {
                let n = runs[k].1;
                if n.is_multiple_of(2) {
                    continue;
                }
                let m = (n - 1) / 2;
                let (points, band) = (&runs[k].0.points, &runs[k].0.widths);
                let widths = band
                    .iter()
                    .map(|&t| if m == 0 { t.max(beading.min_bead) } else { t - 2.0 * m as f64 * beading.s })
                    .collect();
                let mut path = ThickPath { points: points.clone(), widths };
                let next = if k + 1 < len {
                    Some(k + 1)
                } else if *closed && len > 1 {
                    Some(0)
                } else {
                    None
                };
                let before = if k > 0 {
                    Some(k - 1)
                } else if *closed && len > 1 {
                    Some(len - 1)
                } else {
                    None
                };
                // A step from one bead fewer to one more that lies wholly within the two transitions: Arachne's middle
                // bead is odd only outside a transition, and within one it is part of the loop round the pair.
                let counts = (before.map(|j| runs[j].1), next.map(|j| runs[j].1));
                if (counts == (Some(n - 1), Some(n + 1)) || counts == (Some(n + 1), Some(n - 1)))
                    && geom::length_mm(points, false)
                        < beading.half_transition(n, false) + beading.half_transition(n - 1, true)
                {
                    continue;
                }
                if next.is_some_and(|j| runs[j].1 > n) {
                    clip_end(&mut path, trim);
                }
                if before.is_some_and(|j| runs[j].1 > n) {
                    path.points.reverse();
                    path.widths.reverse();
                    clip_end(&mut path, trim);
                    path.points.reverse();
                    path.widths.reverse();
                }
                let narrowest = path.widths.iter().cloned().fold(f64::INFINITY, f64::min);
                if path.points.len() >= 2 && geom::length_mm(&path.points, false) >= narrowest / 2.0 {
                    out.push((path, n));
                }
            }
        }
        stitch(out, beading.s)
    }

    /// Where Arachne's filter filled a gap in the `level`th pair of beads (the band narrower there than the pair
    /// takes), a thread along the middle of the run that now holds the pair, to join the loops either side of it.
    fn gaps(&self, level: usize, beading: &Beading) -> Shapes {
        let need = 2 * level + 2;
        let t = beading.threshold(need);
        let threads: Vec<Shape> = self
            .runs
            .iter()
            .flat_map(|(runs, _)| runs)
            .filter(|(run, count)| *count >= need && run.widths.iter().any(|&w| w < t - 1e-6))
            .flat_map(|(run, _)| geom::offset_open(&run.points, THREAD))
            .collect();
        if threads.len() > 1 { geom::union_all(&[&threads]) } else { threads }
    }

    /// The width of the band (mm) at the point of its middle nearest `p`, how far that is (mm) and how many beads
    /// the band holds there, looking no further than `reach` mm.
    fn width_near(&self, p: Pt, reach: f64) -> Option<(f64, f64, usize)> {
        if self.segments.is_empty() {
            return None;
        }
        let (x, y) = (p.x as f64, p.y as f64);
        let (cx, cy) =
            (((x - self.origin.0) / self.cell).floor() as i64, ((y - self.origin.1) / self.cell).floor() as i64);
        let mut best: Option<(f64, f64, usize)> = None;
        let mut best_d2 = f64::INFINITY;
        let rings = (reach * geom::SCALE / self.cell).ceil() as i64 + 1;
        for r in 0..=rings {
            for iy in cy - r..=cy + r {
                for ix in cx - r..=cx + r {
                    if (iy - cy).abs() != r && (ix - cx).abs() != r {
                        continue;
                    }
                    if ix < 0 || iy < 0 || ix >= self.size.0 || iy >= self.size.1 {
                        continue;
                    }
                    let c = (iy * self.size.0 + ix) as usize;
                    for &k in &self.ids[self.start[c]..self.start[c + 1]] {
                        let (a, b, wa, wb, count) = self.segments[k];
                        let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
                        let len2 = dx * dx + dy * dy;
                        let t = if len2 > 0.0 {
                            (((x - a.x as f64) * dx + (y - a.y as f64) * dy) / len2).clamp(0.0, 1.0)
                        } else {
                            0.0
                        };
                        let (px, py) = (a.x as f64 + t * dx, a.y as f64 + t * dy);
                        let d2 = (x - px) * (x - px) + (y - py) * (y - py);
                        if d2 < best_d2 {
                            best_d2 = d2;
                            best = Some((wa + (wb - wa) * t, d2.sqrt() / geom::SCALE, count));
                        }
                    }
                }
            }
            // Every segment nearer than the rings reach is in them.
            if best_d2.sqrt() <= r as f64 * self.cell {
                break;
            }
        }
        best.filter(|&(_, d, _)| d <= reach)
    }
}

/// mm: half the width of the thread that joins the loops across a gap Arachne's filter filled.
const THREAD: f64 = 0.005;

/// Arachne's stitching (`stitchToolPaths`): middle lines of the same bead (`count`) whose ends lie within a bead's
/// width `s` of each other are one line, joined end to end from the first line on, each time with the nearest end
/// within reach; one that comes back to where it began is a loop.
fn stitch(lines: Vec<(ThickPath, usize)>, s: f64) -> Vec<ThickPath> {
    let reach = s * geom::SCALE - 1.0;
    let mut lines: Vec<Option<(ThickPath, usize)>> = lines.into_iter().map(Some).collect();
    let mut out = Vec::new();
    for i in 0..lines.len() {
        let Some((mut chain, count)) = lines[i].take() else { continue };
        if chain.points.len() > 2 && chain.points[0] == *chain.points.last().unwrap() {
            out.push(chain);
            continue;
        }
        for side in 0..2 {
            if side == 1 {
                chain.points.reverse();
                chain.widths.reverse();
            }
            loop {
                let end = *chain.points.last().unwrap();
                let mut best: Option<(f64, usize, bool)> = None;
                for (j, line) in lines.iter().enumerate() {
                    let Some((line, c)) = line else { continue };
                    if *c != count {
                        continue;
                    }
                    for (back, p) in [(false, line.points[0]), (true, *line.points.last().unwrap())] {
                        let d = geom::dist(end, p);
                        if d <= reach && best.is_none_or(|b| d < b.0) {
                            best = Some((d, j, back));
                        }
                    }
                }
                let Some((d, j, back)) = best else { break };
                let (mut next, _) = lines[j].take().unwrap();
                if back {
                    next.points.reverse();
                    next.widths.reverse();
                }
                let skip = usize::from(d < 1.0);
                chain.points.extend(next.points.into_iter().skip(skip));
                chain.widths.extend(next.widths.into_iter().skip(skip));
            }
        }
        // Back where it began: a loop.
        let (first, last) = (chain.points[0], *chain.points.last().unwrap());
        if first != last
            && geom::dist(first, last) <= reach
            && geom::length_mm(&chain.points, false) * geom::SCALE > 3.0 * reach
        {
            chain.points.push(first);
            chain.widths.push(chain.widths[0]);
        }
        out.push(chain);
    }
    out
}

/// The narrow region filled with beads `w` mm apart (the solid line's spacing, at layers `h` mm high; `nozzle` sets
/// Arachne's narrowest bead and feature), in print order from `at`: loops half a bead in from the edge where two
/// beads fit and lines along the middle of what is too thin for that, each as wide as Arachne makes it there. Each
/// ends a tenth of the nozzle short of where it started (Orca's seam gap), as Orca's.
pub fn narrow_loops(region: &Shapes, w: f64, nozzle: f64, h: f64, at: Pt) -> Vec<ThickPath> {
    let beading = Beading::new(w, nozzle, h);
    let two = beading.two();
    // Arachne simplifies its outline first (to 0.025 mm; this to 0.05, as the Voronoi diagram costs by the edge
    // and the lines hardly move), and leaves out pieces smaller than half a bead squared (`removeSmallAreas`).
    let mut rest = geom::simplify_shapes(region, 0.05);
    let smallest = (w / 2.0 * geom::SCALE).powi(2) * 2.0;
    rest.retain(|shape| shape.first().is_some_and(|outer| geom::area2(outer).abs() as f64 >= smallest));
    // The odd beads run along the middle; the loops go round it, a bead's width apart, as long as two more fit.
    let axis = Axis::new(&rest, &beading, 2.0 * two);
    let mut paths = axis.odd_beads(&beading);
    for level in 0..1000 {
        if rest.is_empty() || rest.iter().all(|shape| max_inradius(shape) < two / 2.0 * geom::SCALE) {
            break;
        }
        // Where two beads fit: what is left of the region shrunk by two beads' half width, but where Arachne's filter
        // left out the pair.
        let mut core = geom::offset(&rest, -two / 2.0);
        core.retain(|shape| holds_pair(shape, level, &beading, &axis));
        if core.is_empty() {
            break;
        }
        // Where the filter filled a gap in the pair, the loop runs on through it.
        let threads = axis.gaps(level, &beading);
        if !threads.is_empty() {
            core = geom::union(&core, &threads);
        }
        // The loop runs half a bead in from the edge, where the region is two beads wide.
        for shape in &geom::offset(&core, (two - w) / 2.0) {
            for contour in shape {
                if contour.len() >= 3 {
                    paths.push(bead(contour, level, &beading, &axis));
                }
            }
        }
        rest = geom::offset(&core, two / 2.0 - w);
    }

    // Loops start nearest where the nozzle is; every path ends short by the seam gap.
    let clip = 0.1 * nozzle * geom::SCALE;
    for p in &mut paths {
        if p.points.len() > 2 && p.points[0] == *p.points.last().unwrap() {
            p.points.pop();
            p.widths.pop();
            let k = (0..p.points.len())
                .min_by(|&a, &b| geom::dist(p.points[a], at).total_cmp(&geom::dist(p.points[b], at)))
                .unwrap_or(0);
            p.points.rotate_left(k);
            p.widths.rotate_left(k);
            p.points.push(p.points[0]);
            p.widths.push(p.widths[0]);
        }
        clip_end(p, clip);
    }
    paths.retain(|p| p.points.len() >= 2);
    // Nearest first.
    let mut ordered = Vec::with_capacity(paths.len());
    let mut cur = at;
    while !paths.is_empty() {
        let k = (0..paths.len())
            .min_by(|&a, &b| geom::dist(paths[a].points[0], cur).total_cmp(&geom::dist(paths[b].points[0], cur)))
            .unwrap();
        let p = paths.swap_remove(k);
        cur = *p.points.last().unwrap();
        ordered.push(p);
    }
    ordered
}

/// Whether a piece of the region, two beads' half width in from its edge (where the `level`th pair of beads goes),
/// holds that pair: not where the middle beside every point of it holds fewer beads, as there Arachne's filter left the
/// pair out.
fn holds_pair(shape: &Shape, level: usize, beading: &Beading, axis: &Axis) -> bool {
    let mut fewer = false;
    for &p in shape.iter().flatten() {
        match axis.width_near(p, beading.s) {
            Some((_, _, count)) if count < 2 * level + 2 => fewer = true,
            _ => return true,
        }
    }
    !fewer
}

/// A loop of the `level`th pair of beads in from the region's edge, closed: a bead's width where more beads lie
/// inside it, else (the innermost pair) half of what is left of the band, laid in the middle of its half as Arachne
/// lays it. Along a side over which the band's width changes, points are added where the width bends, so that it
/// follows the band rather than run straight from corner to corner.
fn bead(contour: &[Pt], level: usize, beading: &Beading, axis: &Axis) -> ThickPath {
    let s = beading.s;
    // How deep the loop runs, mm from the region's edge.
    let depth = (level as f64 + 0.5) * s;
    // The bead's width at a point of the loop, and how far in from the loop it goes, mm.
    let look = |p: Pt| {
        if let Some((t, d, count)) = axis.width_near(p, depth + 2.0 * s)
            && (d - (t / 2.0 - depth)).abs() <= s
            && count < 2 * level + 3
        {
            let left = t - 2.0 * level as f64 * s;
            if count == 2 * level + 2 && left < beading.two() {
                // A gap in the pair that Arachne's filter filled: each bead half of what is left, its middle a quarter
                // of that from the band's (the loop runs along a thread there, not half a bead in from the edge).
                return (left / 2.0, d - left / 4.0);
            }
            // What is left of the band, no narrower than two beads take and no wider than takes two more.
            let left = left.clamp(beading.two(), (3.0 + beading.split) * s);
            return (left / 2.0, (left / 2.0 - s) / 2.0);
        }
        (s, 0.0)
    };
    let n = contour.len();
    let mut path = ThickPath { points: Vec::with_capacity(n + 1), widths: Vec::with_capacity(n + 1) };
    let looked: Vec<(f64, f64)> = contour.iter().map(|&p| look(p)).collect();
    for i in 0..n {
        let (width, shift) = looked[i];
        path.points.push(if shift.abs() * geom::SCALE >= 1.0 { moved(contour, i, shift) } else { contour[i] });
        path.widths.push(width);
        let j = (i + 1) % n;
        along(&mut path, (contour[i], looked[i]), (contour[j], looked[j]), &look, s, 0);
    }
    path.points.push(path.points[0]);
    path.widths.push(path.widths[0]);
    path
}

/// The points between `a` and `b` (each with its bead's width and shift) where the width bends away from a straight
/// run between theirs by more than a twentieth of a bead, found by halving the side, moved in as the bead goes; no
/// closer together than Arachne's simplification leaves its lines' points (`ARACHNE_RESOLUTION`).
fn along(
    path: &mut ThickPath,
    a: (Pt, (f64, f64)),
    b: (Pt, (f64, f64)),
    look: &dyn Fn(Pt) -> (f64, f64),
    s: f64,
    deep: u32,
) {
    if deep >= 6 || geom::dist(a.0, b.0) < (2.0 * ARACHNE_RESOLUTION).max(s) * geom::SCALE {
        return;
    }
    let m = geom::pt(((a.0.x as i64 + b.0.x as i64) / 2) as i32, ((a.0.y as i64 + b.0.y as i64) / 2) as i32);
    let at_m = look(m);
    if (at_m.0 - (a.1.0 + b.1.0) / 2.0).abs() <= 0.05 * s {
        return;
    }
    along(path, a, (m, at_m), look, s, deep + 1);
    // On the side, in along its normal (to its left, into the solid).
    let (dx, dy) = ((b.0.x - a.0.x) as f64, (b.0.y - a.0.y) as f64);
    let len = dx.hypot(dy);
    let reach = at_m.1 * geom::SCALE;
    path.points
        .push(geom::pt((m.x as f64 - dy / len * reach).round() as i32, (m.y as f64 + dx / len * reach).round() as i32));
    path.widths.push(at_m.0);
    along(path, (m, at_m), b, look, s, deep + 1);
}

/// The `i`th point of a closed contour moved `d` mm to its left (into the solid, which contours keep on their left),
/// along the bisector of its two edges' normals.
fn moved(contour: &[Pt], i: usize, d: f64) -> Pt {
    let n = contour.len();
    let (a, p, b) = (contour[(i + n - 1) % n], contour[i], contour[(i + 1) % n]);
    let unit = |u: Pt, v: Pt| {
        let (dx, dy) = ((v.x - u.x) as f64, (v.y - u.y) as f64);
        let len = dx.hypot(dy);
        if len > 0.0 { (-dy / len, dx / len) } else { (0.0, 0.0) }
    };
    let (n0, n1) = (unit(a, p), unit(p, b));
    let (mx, my) = (n0.0 + n1.0, n0.1 + n1.1);
    let len = mx.hypot(my);
    if len < 1e-6 {
        return p;
    }
    // Along the bisector, as far as keeps both edges `d` away (a mitre), at most twice `d`.
    let reach = d * (2.0 / len).min(2.0) * geom::SCALE;
    let (dx, dy) = (mx / len * reach, my / len * reach);
    geom::pt((p.x as f64 + dx).round() as i32, (p.y as f64 + dy).round() as i32)
}

/// Shortens a path by `d` units at its end.
fn clip_end(p: &mut ThickPath, mut d: f64) {
    while p.points.len() >= 2 && d > 0.0 {
        let n = p.points.len();
        let (a, b) = (p.points[n - 2], p.points[n - 1]);
        let len = geom::dist(a, b);
        if len > d {
            let t = (len - d) / len;
            p.points[n - 1] = geom::pt(
                (a.x as f64 + (b.x - a.x) as f64 * t).round() as i32,
                (a.y as f64 + (b.y - a.y) as f64 * t).round() as i32,
            );
            p.widths[n - 1] = p.widths[n - 2] + (p.widths[n - 1] - p.widths[n - 2]) * t;
            return;
        }
        d -= len;
        p.points.pop();
        p.widths.pop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::sc;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        vec![vec![
            geom::pt(sc(x0), sc(y0)),
            geom::pt(sc(x1), sc(y0)),
            geom::pt(sc(x1), sc(y1)),
            geom::pt(sc(x0), sc(y1)),
        ]]
    }

    #[test]
    fn a_wide_region_is_all_lines() {
        assert!(split_narrow(&rect(0.0, 0.0, 20.0, 20.0), 0.4, 90f64.to_radians()).is_none());
    }

    #[test]
    fn corners_where_lines_get_short_loop() {
        // Across a square at 45°, the lines shorten below 4 mm in the two corners they cut across: those zig-zags
        // would shake the printer, so the corners loop.
        let (normal, narrow) = split_narrow(&rect(0.0, 0.0, 20.0, 20.0), 0.4, 45f64.to_radians()).unwrap();
        let (a_normal, a_narrow) = (geom::area_mm2(&normal), geom::area_mm2(&narrow));
        assert_eq!(narrow.len(), 2, "{narrow:?}");
        for piece in &narrow {
            let b = geom::bbox_of(piece);
            let top_left = b[0] == 0 && b[3] == geom::sc(20.0);
            let bottom_right = b[2] == geom::sc(20.0) && b[1] == 0;
            assert!(top_left || bottom_right, "{b:?}");
        }
        assert!(a_narrow > 0.2 && a_narrow < 8.0, "{a_narrow}");
        assert!(a_normal > 390.0, "{a_normal}");
    }

    #[test]
    fn a_band_too_narrow_for_a_core_is_all_loops() {
        let (normal, narrow) = split_narrow(&rect(0.0, 0.0, 20.0, 1.0), 0.4, 45f64.to_radians()).unwrap();
        assert!(normal.is_empty());
        assert!((geom::area_mm2(&narrow) - 20.0).abs() < 0.1);
    }

    #[test]
    fn a_band_beside_a_wide_part_loops_but_the_part_does_not() {
        // A 20 mm square with a 1 mm band 20 mm long off its side: the band loops.
        let shape = geom::union(&vec![rect(0.0, 0.0, 20.0, 20.0)], &vec![rect(20.0, 0.0, 40.0, 1.0)]);
        let (normal, narrow) = split_narrow(&shape[0], 0.4, 0.0).unwrap();
        let (a_normal, a_narrow) = (geom::area_mm2(&normal), geom::area_mm2(&narrow));
        assert!(a_normal > 390.0 && a_normal < 410.0, "{a_normal}");
        // The band, and as in Orca the strip the last line leaves along the square's side it joins.
        assert!(a_narrow > 19.0 && a_narrow < 29.0, "{a_narrow}");
    }

    #[test]
    fn a_thin_band_is_one_line_along_its_middle() {
        let paths = narrow_loops(&vec![rect(0.0, 0.0, 20.0, 0.5)], 0.38, 0.4, 0.2, geom::pt(0, 0));
        assert_eq!(paths.len(), 1, "{paths:?}");
        assert!(paths[0].widths.iter().all(|&w| (w - 0.5).abs() < 0.01), "{:?}", paths[0].widths);
    }

    /// What paths lay for each mm of layer height: their lengths times their widths, mm².
    fn laid(paths: &[ThickPath]) -> f64 {
        let piece = |p: &ThickPath, k: usize| {
            geom::dist(p.points[k - 1], p.points[k]) / geom::SCALE * (p.widths[k - 1] + p.widths[k]) / 2.0
        };
        paths.iter().map(|p| (1..p.points.len()).map(|k| piece(p, k)).sum::<f64>()).sum()
    }

    /// A loop (its ends a seam gap apart) rather than a line.
    fn is_loop(p: &ThickPath) -> bool {
        geom::dist(p.points[0], *p.points.last().unwrap()) < 0.1 * geom::SCALE
    }

    #[test]
    fn bead_counts_change_where_their_thresholds_say() {
        // The X2D's 0.2, 0.4 and 0.8 mm nozzles' solid lines at their layer heights.
        for (s, nozzle, h) in [(0.19854, 0.2, 0.1), (0.38, 0.4, 0.2), (0.73416, 0.8, 0.4)] {
            let b = Beading::new(s, nozzle, h);
            for n in 1..12 {
                let t = b.threshold(n);
                assert!(b.count(t - 1e-9) < n && b.count(t + 1e-9) >= n, "{s} mm beads, {n} from {t} mm");
            }
            // Never fewer beads in a wider band.
            let counts: Vec<usize> = (0..5000).map(|k| b.count(k as f64 * 0.001)).collect();
            assert!(counts.windows(2).all(|w| w[0] <= w[1]), "{s}");
        }
        // On the 0.2 mm nozzle: one bead from 0.05 mm, two from 0.31 mm, three from 0.55, four from 0.70, five from
        // 0.95 (Arachne's thresholds measured against the 0.22 mm line, not its 0.199 mm spacing).
        let b = Beading::new(0.19854, 0.2, 0.1);
        assert_eq!([0.04, 0.3, 0.4, 0.6, 0.8, 1.0].map(|t| b.count(t)), [0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn a_band_two_beads_wide_is_one_loop_of_half_bands() {
        let paths = narrow_loops(&vec![rect(0.0, 0.0, 20.0, 0.8)], 0.38, 0.4, 0.2, geom::pt(0, 0));
        assert_eq!(paths.len(), 1, "{paths:?}");
        // Two beads of half the band each, a quarter of the band in from its edges.
        assert!(paths[0].widths.iter().all(|&w| (w - 0.4).abs() < 0.01), "{:?}", paths[0].widths);
        let b = geom::bbox_of(&vec![paths[0].points.clone()]);
        for (got, want) in b.iter().zip([0.2, 0.2, 19.8, 0.6]) {
            assert!((geom::unsc(*got) - want).abs() < 0.015, "{b:?}");
        }
        let length = geom::length_mm(&paths[0].points, false);
        // Round a strip 0.4 mm wide, less the seam gap.
        assert!((length - 2.0 * (19.6 + 0.4) + 0.04).abs() < 0.2, "{length}");
    }

    #[test]
    fn a_band_three_beads_wide_is_a_loop_and_a_line_down_its_middle() {
        // 1.2 mm holds three 0.38 mm beads: a loop a bead wide half a bead in, and what is left down the middle.
        let paths = narrow_loops(&vec![rect(0.0, 0.0, 20.0, 1.2)], 0.38, 0.4, 0.2, geom::pt(0, 0));
        assert_eq!(paths.len(), 2, "{paths:?}");
        let (loops, lines): (Vec<&ThickPath>, Vec<&ThickPath>) = paths.iter().partition(|p| is_loop(p));
        assert_eq!((loops.len(), lines.len()), (1, 1));
        assert!(loops[0].widths.iter().all(|&w| (w - 0.38).abs() < 1e-9), "{:?}", loops[0].widths);
        let b = geom::bbox_of(&vec![loops[0].points.clone()]);
        for (got, want) in b.iter().zip([0.19, 0.19, 19.81, 1.01]) {
            assert!((geom::unsc(*got) - want).abs() < 0.015, "{b:?}");
        }
        assert!(lines[0].widths.iter().all(|&w| (w - 0.44).abs() < 0.01), "{:?}", lines[0].widths);
        assert!(lines[0].points.iter().all(|p| (geom::unsc(p.y) - 0.6).abs() < 0.01));
        // The middle runs from where the corners' bisectors meet, less the seam gap.
        let length = geom::length_mm(&lines[0].points, false);
        assert!((length - 18.76).abs() < 0.1, "{length}");
        let area = 20.0 * 1.2;
        assert!((laid(&paths) / area - 1.0).abs() < 0.03, "{} of {area}", laid(&paths));
    }

    /// A run of the middle from `a` to `b` (mm along x), the band `w` mm wide all along it, holding `count` beads.
    fn run(a: f64, b: f64, w: f64, count: usize) -> (ThickPath, usize) {
        (ThickPath { points: vec![geom::pt(sc(a), 0), geom::pt(sc(b), 0)], widths: vec![w, w] }, count)
    }

    fn counts(runs: &[(ThickPath, usize)]) -> Vec<usize> {
        runs.iter().map(|r| r.1).collect()
    }

    #[test]
    fn the_filter_keeps_a_count_through_a_short_change_within_the_deviation() {
        // 0.38 mm beads from a 0.4 mm nozzle: two beads from 0.61 mm, a bead's width allowed to stray 0.1 mm.
        let b = Beading::new(0.38, 0.4, 0.2);
        let two = b.two();
        // A pair that starts and stops again within the deviation goes: one bead, wider there.
        let mut runs = vec![run(0.0, 5.0, two - 0.1, 1), run(5.0, 6.0, two + 0.08, 2), run(6.0, 9.0, two - 0.1, 1)];
        settle(&mut runs, &b, [true, true], false);
        assert_eq!(counts(&runs), [1]);
        assert_eq!(runs[0].0.points.len(), 4, "the runs are one");
        // Beyond the deviation, it stays.
        let mut runs = vec![run(0.0, 5.0, two - 0.1, 1), run(5.0, 6.0, two + 0.12, 2), run(6.0, 9.0, two - 0.1, 1)];
        settle(&mut runs, &b, [true, true], false);
        assert_eq!(counts(&runs), [1, 2, 1]);
        // A pair that stops and starts again: the deviation is shared by two beads, so twice as much may go.
        let mut runs = vec![run(0.0, 5.0, two + 0.1, 2), run(5.0, 6.0, two - 0.18, 1), run(6.0, 9.0, two + 0.1, 2)];
        settle(&mut runs, &b, [true, true], false);
        assert_eq!(counts(&runs), [2]);
    }

    #[test]
    fn the_filter_goes_round_a_ring_through_where_its_points_start() {
        // A ring's points start in the middle of a stretch a little too wide for one bead: that stretch is one run,
        // and between the ends of the one-bead run round the rest of the ring the filter takes the pair out.
        let b = Beading::new(0.38, 0.4, 0.2);
        let two = b.two();
        let at = |x: f64, y: f64| geom::pt(sc(x), sc(y));
        let path = |points: Vec<Pt>, w: f64| ThickPath { widths: vec![w; points.len()], points };
        let runs = vec![
            (path(vec![at(0.0, 0.0), at(1.0, 0.0)], two + 0.05), 2),
            (path(vec![at(1.0, 0.0), at(10.0, 0.0), at(10.0, 10.0), at(0.0, 10.0)], two - 0.1), 1),
            (path(vec![at(0.0, 10.0), at(0.0, 0.0)], two + 0.05), 2),
        ];
        let mut runs = ring_runs(runs);
        assert_eq!(counts(&runs), [1, 2]);
        assert_eq!(runs[1].0.points, [at(0.0, 10.0), at(0.0, 0.0), at(1.0, 0.0)]);
        settle(&mut runs, &b, [false, false], true);
        assert_eq!(counts(&runs), [1]);
        assert_eq!(runs[0].0.points.first(), runs[0].0.points.last(), "still a ring");
    }

    #[test]
    fn a_band_a_little_too_wide_for_one_bead_in_places_is_still_one_line() {
        // 0.58 mm wide, 0.03 mm under where two 0.38 mm beads fit, but 0.65 mm over a mm or two in two places: within
        // the deviation, so one line all along rather than a loop round each bulge.
        let mut top = Vec::new();
        for (x, y) in [(20.0, 0.58), (13.0, 0.58), (12.0, 0.65), (10.0, 0.65), (9.0, 0.58), (7.0, 0.58), (6.0, 0.65)]
            .into_iter()
            .chain([(5.0, 0.65), (4.0, 0.58), (0.0, 0.58)])
        {
            top.push(geom::pt(sc(x), sc(y)));
        }
        let mut band = vec![geom::pt(0, 0), geom::pt(sc(20.0), 0)];
        band.extend(top);
        let paths = narrow_loops(&vec![vec![band.clone()]], 0.38, 0.4, 0.2, geom::pt(0, 0));
        assert_eq!(paths.len(), 1, "{paths:?}");
        assert!(!is_loop(&paths[0]));
        assert!(paths[0].widths.iter().all(|&w| (0.57..0.66).contains(&w)), "{:?}", paths[0].widths);
        let area = geom::area_mm2(&vec![vec![band]]);
        assert!((laid(&paths) / area - 1.0).abs() < 0.03, "{} of {area}", laid(&paths));
    }

    #[test]
    fn a_band_two_beads_wide_narrowing_for_a_moment_is_still_one_loop() {
        // 0.75 mm wide but 0.58 mm over a mm in the middle, less than two 0.38 mm beads take: within the deviation,
        // so the loop runs on through the narrowing, its beads narrower there, rather than stop either side of it.
        let band = vec![
            geom::pt(0, 0),
            geom::pt(sc(20.0), 0),
            geom::pt(sc(20.0), sc(0.75)),
            geom::pt(sc(11.0), sc(0.75)),
            geom::pt(sc(10.5), sc(0.58)),
            geom::pt(sc(9.5), sc(0.58)),
            geom::pt(sc(9.0), sc(0.75)),
            geom::pt(0, sc(0.75)),
        ];
        let paths = narrow_loops(&vec![vec![band.clone()]], 0.38, 0.4, 0.2, geom::pt(0, 0));
        assert_eq!(paths.len(), 1, "{paths:?}");
        assert!(is_loop(&paths[0]));
        let narrowest = paths[0].widths.iter().cloned().fold(f64::INFINITY, f64::min);
        assert!((narrowest - 0.29).abs() < 0.01, "{narrowest}");
        let area = geom::area_mm2(&vec![vec![band]]);
        assert!((laid(&paths) / area - 1.0).abs() < 0.03, "{} of {area}", laid(&paths));
    }

    #[test]
    fn a_tapering_band_changes_its_bead_count_along_it_and_fills_itself() {
        // From 0.3 to 1.3 mm wide over 20 mm, at 0.38 mm beads: one bead until 0.61 mm (about 6.2 mm along), two
        // until 1.07 mm (about 15.3 mm along), then three.
        let band = vec![vec![geom::pt(0, 0), geom::pt(sc(20.0), 0), geom::pt(sc(20.0), sc(1.3)), geom::pt(0, sc(0.3))]];
        let paths = narrow_loops(&vec![band.clone()], 0.38, 0.4, 0.2, geom::pt(0, 0));
        let (loops, lines): (Vec<&ThickPath>, Vec<&ThickPath>) = paths.iter().partition(|p| is_loop(p));
        assert_eq!((loops.len(), lines.len()), (1, 2), "{paths:?}");
        let span = |p: &ThickPath| {
            let xs: Vec<f64> = p.points.iter().map(|q| geom::unsc(q.x)).collect();
            (xs.iter().cloned().fold(f64::INFINITY, f64::min), xs.iter().cloned().fold(f64::NEG_INFINITY, f64::max))
        };
        let (thin, thick) =
            if span(lines[0]).0 < span(lines[1]).0 { (lines[0], lines[1]) } else { (lines[1], lines[0]) };
        // The one bead: as wide as the band, at least the narrowest bead, and stopping short of the loop's end.
        assert!(thin.widths.iter().all(|&w| (0.34..0.62).contains(&w)), "{:?}", thin.widths);
        let (_, end) = span(thin);
        assert!(end > 5.0 && end < 6.2, "{end}");
        // The middle of three: what the loop leaves, from where three fit to the far end.
        assert!(thick.widths.iter().all(|&w| (0.3..0.55).contains(&w)), "{:?}", thick.widths);
        let (start, _) = span(thick);
        assert!(start > 14.5 && start < 16.0, "{start}");
        let area = geom::area_mm2(&vec![band]);
        assert!((laid(&paths) / area - 1.0).abs() < 0.05, "{} of {area}", laid(&paths));
    }
}
