//! Orca's `FillSupportBase`, which fills normal supports' columns and interfaces: parallel lines on a grid through
//! the object's middle, half a line in from the column's edge, joined along that edge into zig-zags, with caps,
//! arches and short loops where the edge runs away from the lines (Orca's `connect_base_support`, a cousin of the
//! sparse infill's anchoring in `fill.rs`, whose boundary graph it shares). Ported from OrcaSlicer 2.5's
//! `FillRectilinear.cpp` and `FillBase.cpp`; lengths are in our units.

use crate::fill::{
    self, EPS, End, Graph, Piece, ccw, could_take_next, could_take_prev, cw, merged, take_anchor, take_joints,
    take_part, trim_next, trim_prev,
};
use crate::geom::{self, Pt, Shape};
use crate::monotonic;

/// The lines filling `shape` with Orca's support pattern: turned by `angle` (radians, Orca's `_infill_direction`
/// angle: a quarter turn more than the filler's), on a grid through `origin` (units), `spacing` mm wide at
/// `density`. Each line prints from its first point.
pub fn fill(shape: &Shape, angle: f64, origin: (f64, f64), spacing: f64, density: f64) -> Vec<Vec<Pt>> {
    fill_on_grid(shape, angle, origin, None, spacing, density)
}

/// `fill` with its lines on a grid through `grid` (units, before turning) rather than through `origin`, which it is
/// still turned about: Orca's filler with no bounding box set, which lays its lines through the middle of each
/// part's outline (the trees' tips).
pub fn fill_on_grid(
    shape: &Shape,
    angle: f64,
    origin: (f64, f64),
    grid: Option<Pt>,
    spacing: f64,
    density: f64,
) -> Vec<Vec<Pt>> {
    let sp = spacing * geom::SCALE;
    if shape.is_empty() || sp < 1.0 || density <= 0.0 {
        return Vec::new();
    }
    let (s, c) = (-angle).sin_cos();
    let turned: Shape = shape.iter().map(|contour| contour.iter().map(|&q| turn(q, origin, s, c)).collect()).collect();
    // Orca's `ExPolygonWithOffset` with one offset: the outline moved in by half a line, as the lines' ends.
    let src = vec![turned];
    let outer = geom::offset(&src, -0.5 * spacing);
    let boundary: Shape = outer.into_iter().flatten().filter(|c| c.len() >= 3 && geom::area2(c) != 0).collect();
    if boundary.is_empty() {
        return Vec::new();
    }
    let Some(bb) = geom::bbox(&src) else { return Vec::new() };
    // Orca's spacing in whole nanometres (its float spacing over its float density).
    let ls_nm = (spacing * 1e6 / (density as f32 as f64)) as i64;
    let (x_min, x_max) = (bb[0] as i64, bb[2] as i64);
    let grid_x = grid.map_or(origin.0, |g| turn(g, origin, s, c).x as f64);
    let positions = monotonic::grid_lines(x_min, x_max, grid_x, ls_nm);
    let contours: Vec<Vec<(i64, i64)>> =
        boundary.iter().map(|c| c.iter().map(|q| (q.x as i64, q.y as i64)).collect()).collect();
    let Some(lines) = monotonic::vertical_runs(&contours, &positions, x_min, x_max) else { return Vec::new() };
    let pieces: Vec<Piece> = lines
        .into_iter()
        .map(|run| {
            let end = |(contour, segment, _): (usize, usize, i64)| {
                // Where the run's end lies on the edge into `segment` (from the point before it), by x: a vertical
                // line crosses no vertical edge.
                let ring = &contours[contour];
                let n = ring.len();
                let a = ring[(segment + n - 1) % n];
                let b = ring[segment];
                let u = if b.0 != a.0 { (run.x - a.0) as f64 / (b.0 - a.0) as f64 } else { 0.0 };
                End { contour, edge: (segment + n - 1) % n, u: u.clamp(0.0, 1.0) }
            };
            let points = vec![geom::pt(run.x as i32, run.low.2 as i32), geom::pt(run.x as i32, run.high.2 as i32)];
            Piece { points, ends: [Some(end(run.low)), Some(end(run.high))] }
        })
        .filter(|p| p.points[0] != p.points[1])
        .collect();
    let mut out = connect(pieces, &boundary, sp, density as f32 as f64);
    let (s, c) = angle.sin_cos();
    for line in &mut out {
        for q in line.iter_mut() {
            *q = turn(*q, origin, s, c);
        }
        line.dedup();
    }
    out.retain(|l| l.len() >= 2);
    out
}

/// A point turned about `origin` (Orca's `Point::rotate`, which rounds).
fn turn(q: Pt, origin: (f64, f64), s: f64, c: f64) -> Pt {
    let (x, y) = (q.x as f64 - origin.0, q.y as f64 - origin.1);
    geom::pt((origin.0 + c * x - s * y).round() as i32, (origin.1 + c * y + s * x).round() as i32)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Dir {
    Left,
    Right,
    Up,
    Down,
    Taken,
}

fn dir(p1: Pt, p2: Pt) -> Dir {
    if p1.x == p2.x {
        if p1.y < p2.y { Dir::Up } else { Dir::Down }
    } else if p1.x < p2.x {
        Dir::Right
    } else {
        Dir::Left
    }
}

fn vertical(d: Dir) -> bool {
    matches!(d, Dir::Up | Dir::Down)
}

/// The contour's points after `start` up to and including `end`, going back (Orca's `take_cw_full`, which goes all
/// the way round when they are the same point).
fn take_cw_full(line: &mut Vec<Pt>, contour: &[Pt], start: usize, end: usize) {
    let n = contour.len();
    let mut i = if start == 0 { n - 1 } else { start - 1 };
    while i != end {
        line.push(contour[i]);
        i = if i == 0 { n - 1 } else { i - 1 };
    }
    line.push(contour[i]);
}

/// Going on (Orca's `take_ccw_full`).
fn take_ccw_full(line: &mut Vec<Pt>, contour: &[Pt], start: usize, end: usize) {
    let n = contour.len();
    let mut i = (start + 1) % n;
    while i != end {
        line.push(contour[i]);
        i = (i + 1) % n;
    }
    line.push(contour[i]);
}

/// Orca's `Polyline::clip_end`: `distance` off the end (all of it, if it is shorter).
fn clip_end(line: &mut Vec<Pt>, mut distance: f64) {
    while distance > 0.0 {
        let Some(last) = line.pop() else { return };
        let Some(&prev) = line.last() else { return };
        let (vx, vy) = ((prev.x - last.x) as f64, (prev.y - last.y) as f64);
        let l2 = vx * vx + vy * vy;
        if l2 > distance * distance {
            let t = distance / l2.sqrt();
            line.push(geom::pt((last.x as f64 + vx * t) as i32, (last.y as f64 + vy * t) as i32));
            return;
        }
        distance -= l2.sqrt();
    }
}

fn clip_start(line: &mut Vec<Pt>, distance: f64) {
    line.reverse();
    clip_end(line, distance);
    line.reverse();
}

/// How far an arch of the edge strays from the straight line between its ends, or out of their band of heights
/// (Orca's `evaluate_support_arch_cost`): how much it is needed to hold the support up.
fn arch_cost(pl: &[Pt]) -> f64 {
    let (front, back) = (pl[0], pl[pl.len() - 1]);
    let (ymin, ymax) = (front.y.min(back.y), front.y.max(back.y));
    let (a, b) = ((front.x as f64, front.y as f64), (back.x as f64, back.y as f64));
    let mut dmax = 0.0f64;
    for q in pl {
        let d = fill::dist2_to_segment((q.x as f64, q.y as f64), a, b).sqrt();
        dmax = dmax.max(d).max(((q.y - ymax) as f64).max((ymin - q.y) as f64));
    }
    dmax
}

#[derive(Clone, Copy, Default)]
struct Arch {
    self_loop: bool,
    cost: f64,
}

/// Orca's `connect_base_support`, on lines that run straight up (the region turned so), each from its low end to
/// its high end on the boundary. `spacing` in units.
fn connect(pieces: Vec<Piece>, boundary: &Shape, spacing: f64, density: f64) -> Vec<Vec<Pt>> {
    let mut g = Graph::new(&pieces, boundary, spacing);
    let mut lines: Vec<Vec<Pt>> = pieces.into_iter().map(|p| p.points).collect();
    let nj = g.joints.len();
    let half_width = 0.5 * spacing;
    let line_spacing = spacing / density;
    let min_arch_length = 1.3 * line_spacing;
    let trim_length = half_width * 0.3;
    let mut out: Vec<Vec<Pt>> = Vec::new();

    mark_overlapping(&mut g, &lines, spacing);

    // Contours no line ends on print whole, as loops.
    let mut count = vec![0usize; g.boundary.len()];
    for c in &g.joints {
        count[c.contour] += 1;
    }
    for (k, &n) in count.iter().enumerate() {
        if n == 0 && g.total(k) > trim_length + 0.5 * line_spacing {
            let mut pl = g.boundary[k].clone();
            pl.push(pl[0]);
            clip_end(&mut pl, trim_length);
            if pl.len() > 1 {
                out.push(pl);
            }
        }
    }

    // Arches trimmed by the lines at both ends, which leave them somewhere between: what lies in the band between
    // this line and the next prints on its own.
    for cp in 0..nj {
        let next = g.joints[cp].next;
        if g.joints[cp].next_trimmed && g.joints[next].prev_trimmed {
            let first = cp % 2 == 0;
            let x = g.boundary[g.joints[cp].contour][g.joints[cp].point].x as f64;
            let (left, right) = if first {
                ((x + half_width) as i64, (x + line_spacing - half_width) as i64)
            } else {
                ((x - (line_spacing - half_width)) as i64, (x - half_width) as i64)
            };
            let k = g.joints[cp].contour;
            let length = g.total(k);
            let mut start = g.joints[cp].param + g.joints[cp].free_next;
            let mut end = g.joints[next].param - g.joints[next].free_prev;
            if start >= length {
                start -= length;
            }
            if end < 0.0 {
                end += length;
            }
            loops_in_band(left, right, &g.boundary[k], &g.params[k], start, end, 0.5 * line_spacing, &mut out);
        }
    }

    extend_lines(&mut lines, &mut g, line_spacing);

    let n = lines.len();
    let mut merged_with: Vec<usize> = (0..n).collect();
    let take_vertical_prev = |g: &Graph, cp: usize| {
        let c = &g.joints[cp];
        if c.prev_trimmed == c.next_trimmed { c.free_prev > c.free_next } else { !c.prev_trimmed && c.next_trimmed }
    };
    // Joins the line at `cp` to the one at its next joint along the edge (or, `!take_first`, the other way), or
    // where that can't be whole, hooks one end onto the edge as far as it may go.
    let take_next = |g: &mut Graph, lines: &mut [Vec<Pt>], merged_with: &mut [usize], cp: usize, take_first: bool| {
        let (cp1, cp2) = (cp, g.joints[cp].next);
        if if take_first { g.joints[cp1].consumed } else { g.joints[cp2].consumed } {
            return;
        }
        let i1 = merged(merged_with, cp1 / 2);
        let i2 = merged(merged_with, cp2 / 2);
        let k = g.joints[cp1].contour;
        let total = g.total(k);
        let mut trimmed = if take_first { g.joints[cp1].next_trimmed } else { g.joints[cp2].prev_trimmed };
        if !trimmed {
            trimmed = cp1 == cp2
                || i1 == i2
                || if take_first { g.joints[cp2].consumed } else { g.joints[cp1].consumed }
                || cp2 == cp1 ^ 1;
            if trimmed {
                let len = if cp1 == cp2 { total } else { ccw(g.joints[cp1].param, g.joints[cp2].param, total) };
                let keep = (len - trim_length - EPS).max(0.0);
                if take_first {
                    trim_next(&mut g.joints, cp1, keep);
                    trim_prev(&mut g.joints, cp2, 0.0);
                } else {
                    trim_next(&mut g.joints, cp1, 0.0);
                    trim_prev(&mut g.joints, cp2, keep);
                }
            }
        }
        if trimmed {
            if take_first {
                take_anchor(g, &mut lines[i1], cp1, cp2, false, 1e10, half_width);
            } else {
                take_anchor(g, &mut lines[i2], cp2, cp1, true, 1e10, half_width);
            }
        } else if !g.joints[cp1].consumed && !g.joints[cp2].consumed {
            let contour = &g.boundary[k];
            let (p1, p2) = (contour[g.joints[cp1].point], contour[g.joints[cp2].point]);
            if lines[i1].first() == Some(&p1) {
                lines[i1].reverse();
            }
            if lines[i2].last() == Some(&p2) {
                lines[i2].reverse();
            }
            let tail: Vec<Pt> = lines[i2][1..].to_vec();
            let (a, b) = (g.joints[cp1].point, g.joints[cp2].point);
            if a != b {
                take_ccw_full(&mut lines[i1], contour, a, b);
            }
            lines[i1].extend(tail);
            take_joints(&mut g.joints, cp1, cp2, false);
            if i2 < i1 {
                lines[i2] = std::mem::take(&mut lines[i1]);
                merged_with[i1] = merged_with[i2];
            } else {
                lines[i2].clear();
                merged_with[i2] = merged_with[i1];
            }
        }
    };

    // Vertical arches first: an end whose edge runs straight up or down to its neighbour joins it there.
    for cp in 0..nj {
        if g.joints[cp].consumed {
            continue;
        }
        let other = cp ^ 1;
        let (c, prev, next) = (&g.joints[cp], g.joints[cp].prev, g.joints[cp].next);
        let contour = &g.boundary[c.contour];
        let here = contour[c.point];
        let dir_prev =
            if could_take_prev(&g.joints, cp) { dir(here, contour[g.joints[prev].point]) } else { Dir::Taken };
        let dir_next =
            if could_take_next(&g.joints, cp) { dir(here, contour[g.joints[next].point]) } else { Dir::Taken };
        let can_prev = vertical(dir_prev) && !g.joints[prev].consumed && prev != other;
        let can_next = vertical(dir_next) && !g.joints[next].consumed && next != other;
        if can_prev && (!can_next || take_vertical_prev(&g, cp)) {
            if !g.joints[cp].prev_trimmed || g.joints[cp].free_prev > min_arch_length {
                take_next(&mut g, &mut lines, &mut merged_with, prev, false);
            }
        } else if can_next && (!g.joints[cp].next_trimmed || g.joints[cp].free_next > min_arch_length) {
            take_next(&mut g, &mut lines, &mut merged_with, cp, true);
        }
    }

    // What each end's arches back and on would cost to leave out.
    let mut arches = vec![Arch::default(); 2 * nj];
    let mut pl: Vec<Pt> = Vec::new();
    for cp in 0..nj {
        let c = g.joints[cp].clone();
        let other = cp ^ 1;
        arches[2 * cp].self_loop = c.prev == other;
        arches[2 * cp + 1].self_loop = c.next == other;
        let contour = &g.boundary[c.contour];
        let params = &g.params[c.contour];
        if c.free_next > EPS {
            pl.clear();
            pl.push(contour[c.point]);
            if c.next_trimmed {
                take_part(&mut pl, contour, params, c.point, g.joints[c.next].point, c.free_next, false);
            } else {
                take_ccw_full(&mut pl, contour, c.point, g.joints[c.next].point);
            }
            arches[2 * cp + 1].cost = arch_cost(&pl);
        }
        if c.free_prev > EPS {
            pl.clear();
            pl.push(contour[c.point]);
            if c.prev_trimmed {
                take_part(&mut pl, contour, params, c.point, g.joints[c.prev].point, c.free_prev, true);
            } else {
                take_cw_full(&mut pl, contour, c.point, g.joints[c.prev].point);
            }
            arches[2 * cp].cost = arch_cost(&pl);
        }
    }
    let (cost_low, cost_high, cost_very_high) = (line_spacing * 1.3, line_spacing * 2.0, line_spacing * 3.0);
    let by_cost = |list: &mut Vec<usize>, arches: &[Arch]| {
        list.sort_by(|a, b| arches[*b].cost.partial_cmp(&arches[*a].cost).unwrap_or(std::cmp::Ordering::Equal));
    };

    // Arches that stray far, where the other way is much shorter: the longest first.
    let mut selected: Vec<usize> = Vec::new();
    for cp in 0..nj {
        if g.joints[cp].consumed {
            continue;
        }
        let (cost_prev, cost_next) = (arches[2 * cp].cost, arches[2 * cp + 1].cost);
        let (lo, hi) = (cost_prev.min(cost_next), cost_prev.max(cost_next));
        if hi < cost_low || lo > cost_high || (hi - lo) / hi < 0.25 {
            continue;
        }
        if cost_prev > cost_low {
            selected.push(2 * cp);
        }
        if cost_next > cost_low {
            selected.push(2 * cp + 1);
        }
    }
    by_cost(&mut selected, &arches);
    for arc in selected {
        let cp = arc / 2;
        if !g.joints[cp].consumed {
            if arc % 2 == 0 {
                let prev = g.joints[cp].prev;
                take_next(&mut g, &mut lines, &mut merged_with, prev, false);
            } else {
                take_next(&mut g, &mut lines, &mut merged_with, cp, true);
            }
        }
    }

    // The rest as a zig-zag, left to right.
    for cp in 0..nj {
        if g.joints[cp].consumed {
            continue;
        }
        if cp % 2 == 0 {
            let next = g.joints[cp].next;
            if merged(&mut merged_with, cp / 2) != merged(&mut merged_with, next / 2) {
                take_next(&mut g, &mut lines, &mut merged_with, cp, true);
            }
        } else {
            let prev = g.joints[cp].prev;
            if merged(&mut merged_with, cp / 2) != merged(&mut merged_with, prev / 2) {
                take_next(&mut g, &mut lines, &mut merged_with, prev, false);
            }
        }
    }

    // Caps: an arch from a line's end back to its other end.
    for cp in 0..nj {
        let other = cp ^ 1;
        let loop_next = g.joints[cp].next == other;
        let loop_prev = g.joints[other].next == cp;
        if loop_prev && could_take_prev(&g.joints, cp) {
            let prev = g.joints[cp].prev;
            take_next(&mut g, &mut lines, &mut merged_with, prev, false);
        }
        if loop_next && could_take_next(&g.joints, cp) {
            take_next(&mut g, &mut lines, &mut merged_with, cp, true);
        }
    }

    // T-joints along the long arches left.
    let mut candidates: Vec<usize> = Vec::new();
    for cp in 0..nj {
        if could_take_prev(&g.joints, cp) {
            candidates.push(2 * cp);
        }
        if could_take_next(&g.joints, cp) {
            candidates.push(2 * cp + 1);
        }
    }
    by_cost(&mut candidates, &arches);
    for c in candidates {
        let cp = c / 2;
        if c % 2 == 0 {
            let prev = g.joints[cp].prev;
            if could_take_prev(&g.joints, cp)
                && (merged(&mut merged_with, cp / 2) != merged(&mut merged_with, prev / 2)
                    || arches[c].cost > cost_high)
            {
                take_next(&mut g, &mut lines, &mut merged_with, prev, false);
            }
        } else {
            let next = g.joints[cp].next;
            if could_take_next(&g.joints, cp)
                && (merged(&mut merged_with, cp / 2) != merged(&mut merged_with, next / 2)
                    || arches[c].cost > cost_high)
            {
                take_next(&mut g, &mut lines, &mut merged_with, cp, true);
            }
        }
    }

    // Very long arches and caps of a fair length, even where both ends are taken.
    let cap_cost = 0.5 * line_spacing;
    for cp in 0..nj {
        let (prev, next) = (g.joints[cp].prev, g.joints[cp].next);
        let k = g.joints[cp].contour;
        let (cost_prev, cost_next) = (arches[2 * cp], arches[2 * cp + 1]);
        if g.joints[cp].free_prev > EPS
            && (if cost_prev.self_loop { cost_prev.cost > cap_cost } else { cost_prev.cost > cost_very_high })
        {
            let mut pl = vec![g.boundary[k][g.joints[cp].point]];
            if !g.joints[cp].prev_trimmed {
                let keep = g.joints[cp].free_prev - half_width;
                trim_prev(&mut g.joints, cp, keep);
                trim_next(&mut g.joints, prev, 0.0);
            }
            if g.joints[cp].free_prev > EPS {
                let (from, to, take) = (g.joints[cp].point, g.joints[prev].point, g.joints[cp].free_prev);
                take_part(&mut pl, &g.boundary[k], &g.params[k], from, to, take, true);
                trim_prev(&mut g.joints, cp, 0.0);
                clip_start(&mut pl, half_width);
                out.push(pl);
            }
        }
        if g.joints[cp].free_next > EPS
            && (if cost_next.self_loop { cost_next.cost > cap_cost } else { cost_next.cost > cost_very_high })
        {
            let mut pl = vec![g.boundary[k][g.joints[cp].point]];
            if !g.joints[cp].next_trimmed {
                let keep = g.joints[cp].free_next - half_width;
                trim_next(&mut g.joints, cp, keep);
                trim_prev(&mut g.joints, next, 0.0);
            }
            if g.joints[cp].free_next > EPS {
                let (from, to, take) = (g.joints[cp].point, g.joints[next].point, g.joints[cp].free_next);
                take_part(&mut pl, &g.boundary[k], &g.params[k], from, to, take, false);
                trim_next(&mut g.joints, cp, 0.0);
                clip_start(&mut pl, half_width);
                out.push(pl);
            }
        }
    }

    out.extend(lines.into_iter().filter(|l| !l.is_empty()));
    out
}

/// Orca's `mark_boundary_segments_overlapping_infill`: an arch from a line's end that runs within half a line of the
/// line all the way to where it is free is taken off too (the marking of the edge along lines misses short ones).
fn mark_overlapping(g: &mut Graph, lines: &[Vec<Pt>], spacing: f64) {
    let radius = 0.5 * (spacing + EPS);
    for cp in 0..g.joints.len() {
        let k = g.joints[cp].contour;
        let contour = &g.boundary[k];
        let params = &g.params[k];
        let total = *params.last().unwrap();
        let n = contour.len();
        let line = &lines[cp / 2];
        let (la, lb) = ((line[0].x as f64, line[0].y as f64), (line[1].x as f64, line[1].y as f64));
        let at = |q: Pt| (q.x as f64, q.y as f64);
        let point = g.joints[cp].point;
        if could_take_next(&g.joints, cp) {
            let mut inside = true;
            let stop = g.joints[g.joints[cp].next].point;
            let mut i = point;
            while i != stop {
                let j = (i + 1) % n;
                if fill::dist2_to_segment(at(contour[j]), la, lb) >= radius * radius {
                    let out =
                        fill::thick_collision(at(contour[i]), at(contour[j]), la, lb, radius).map_or(0.0, |v| v.1);
                    if ccw(params[point], params[i], total) + out < g.joints[cp].free_next {
                        inside = false;
                        break;
                    }
                }
                if ccw(params[point], params[j], total) >= g.joints[cp].free_next {
                    break;
                }
                i = j;
            }
            if inside {
                if !g.joints[cp].next_trimmed {
                    let next = g.joints[cp].next;
                    trim_prev(&mut g.joints, next, 0.0);
                }
                trim_next(&mut g.joints, cp, 0.0);
            }
        } else {
            trim_next(&mut g.joints, cp, 0.0);
        }
        if could_take_prev(&g.joints, cp) {
            let mut inside = true;
            let stop = g.joints[g.joints[cp].prev].point;
            let mut i = point;
            while i != stop {
                let j = (i + n - 1) % n;
                if fill::dist2_to_segment(at(contour[j]), la, lb) >= radius * radius {
                    let out =
                        fill::thick_collision(at(contour[i]), at(contour[j]), la, lb, radius).map_or(0.0, |v| v.1);
                    if cw(params[point], params[i], total) + out < g.joints[cp].free_prev {
                        inside = false;
                        break;
                    }
                }
                if cw(params[point], params[j], total) >= g.joints[cp].free_prev {
                    break;
                }
                i = j;
            }
            if inside {
                if !g.joints[cp].prev_trimmed {
                    let prev = g.joints[cp].prev;
                    trim_next(&mut g.joints, prev, 0.0);
                }
                trim_prev(&mut g.joints, cp, 0.0);
            }
        } else {
            trim_prev(&mut g.joints, cp, 0.0);
        }
    }
}

/// Orca's `base_support_extend_infill_lines`: a line whose end meets an edge that runs on nearly straight in the
/// line's way follows it, as the line's continuation.
fn extend_lines(lines: &mut [Vec<Pt>], g: &mut Graph, line_spacing: f64) {
    let dist_max_x = (line_spacing * 0.33) as i64;
    let dist_min_y = (line_spacing * 0.5) as i64;
    for cp in 0..g.joints.len() {
        let k = g.joints[cp].contour;
        let n = g.boundary[k].len();
        let total = g.total(k);
        let first = cp % 2 == 0;
        let (prev, next) = (g.joints[cp].prev, g.joints[cp].next);
        let point = g.joints[cp].point;
        let (mut extend_next, mut extend_prev): (Option<usize>, Option<usize>) = (None, None);
        let (mut dy_prev, mut dy_next, mut arc_prev, mut arc_next) = (0i64, 0i64, 0.0, 0.0);
        {
            let contour = &g.boundary[k];
            let params = &g.params[k];
            let pt = contour[point];
            if pt.x != contour[g.joints[next].point].x {
                let mut i = point;
                let mut j = (i + 1) % n;
                while j != g.joints[next].point {
                    if (contour[j].x as i64 - pt.x as i64).abs() > dist_max_x {
                        break;
                    }
                    i = j;
                    j = (j + 1) % n;
                }
                if i != point {
                    let mut dy = contour[i].y as i64 - pt.y as i64;
                    if first {
                        dy = -dy;
                    }
                    if dy > dist_min_y {
                        arc_next = ccw(params[point], params[i], total);
                        if arc_next < g.joints[cp].free_next {
                            extend_next = Some(i);
                            dy_next = dy;
                        }
                    }
                }
            }
            if pt.x != contour[g.joints[prev].point].x {
                let mut i = point;
                let mut j = (i + n - 1) % n;
                while j != g.joints[prev].point {
                    if (contour[j].x as i64 - pt.x as i64).abs() > dist_max_x {
                        break;
                    }
                    i = j;
                    j = (j + n - 1) % n;
                }
                if i != point {
                    let mut dy = contour[i].y as i64 - pt.y as i64;
                    if first {
                        dy = -dy;
                    }
                    if dy > dist_min_y {
                        arc_prev = ccw(params[i], params[point], total);
                        if arc_prev < g.joints[cp].free_prev {
                            extend_prev = Some(i);
                            dy_prev = dy;
                        }
                    }
                }
            }
        }
        if extend_prev.is_some() && extend_next.is_some() {
            if dy_prev < dy_next {
                extend_prev = None;
            } else {
                extend_next = None;
            }
        }
        let line = &mut lines[cp / 2];
        if let Some(to) = extend_prev {
            if first {
                line.reverse();
            }
            take_cw_full(line, &g.boundary[k], point, to);
            if first {
                line.reverse();
            }
            g.joints[cp].point = to;
            if g.joints[cp].prev_trimmed {
                g.joints[cp].free_prev -= arc_prev;
            } else {
                let free = ccw(g.params[k][g.joints[prev].point], g.params[k][to], total);
                g.joints[cp].free_prev = free;
                g.joints[prev].free_next = free;
            }
            trim_next(&mut g.joints, cp, 0.0);
            g.joints[next].prev_trimmed = true;
        } else if let Some(to) = extend_next {
            if first {
                line.reverse();
            }
            take_ccw_full(line, &g.boundary[k], point, to);
            if first {
                line.reverse();
            }
            g.joints[cp].point = to;
            trim_prev(&mut g.joints, cp, 0.0);
            g.joints[prev].next_trimmed = true;
            if g.joints[cp].next_trimmed {
                g.joints[cp].free_next -= arc_next;
            } else {
                let free = ccw(g.params[k][to], g.params[k][g.joints[next].point], total);
                g.joints[cp].free_next = free;
                g.joints[next].free_prev = free;
            }
        }
    }
}

/// Orca's `emit_loops_in_band`: the stretch of contour from `tbegin` to `tend` (lengths along it) cut to the band
/// of x between `left` and `right`, as polylines (joining along the band's sides where it comes back on the same
/// side going the right way), keeping those longer than `min_length`.
#[allow(clippy::too_many_arguments)]
fn loops_in_band(
    left: i64,
    right: i64,
    contour: &[Pt],
    params: &[f64],
    tbegin: f64,
    tend: f64,
    min_length: f64,
    out: &mut Vec<Vec<Pt>>,
) {
    let n = contour.len();
    if left >= right || n < 3 {
        return;
    }
    let find = |t: f64, exact_back: bool| -> usize {
        let mut i = params.partition_point(|&p| p < t);
        if exact_back && (i >= params.len() || params[i] != t) && i > 0 {
            i -= 1;
        }
        if i >= n { 0 } else { i }
    };
    let ibegin = find(tbegin, true);
    let iend = find(tend, false);
    if ibegin == iend {
        return;
    }
    let lerp = |a: Pt, b: Pt, t: f64| {
        geom::pt((a.x as f64 + (b.x - a.x) as f64 * t) as i32, (a.y as f64 + (b.y - a.y) as f64 * t) as i32)
    };
    let pbegin = {
        let (t1, t2) = (params[ibegin], params[ibegin + 1]);
        lerp(contour[ibegin], contour[(ibegin + 1) % n], (tbegin - t1) / (t2 - t1))
    };
    let pend = {
        let t1 = params[iend];
        let (t2, prev) =
            if iend == 0 { (params[n - 1], contour[n - 1]) } else { (params[iend - 1], contour[iend - 1]) };
        // Orca's `prev_value_modulo` takes the last parameter before the first point (the contour's length less
        // its closing segment), as it does here.
        lerp(contour[iend], prev, (tend - t1) / (t2 - t1))
    };
    #[derive(Clone, Copy, PartialEq)]
    enum Side {
        Left,
        Right,
        Mid,
    }
    let side = |p: Pt| {
        let x = p.x as i64;
        if x < left {
            Side::Left
        } else if x > right {
            Side::Right
        } else {
            Side::Mid
        }
    };
    struct State<'o> {
        left: i64,
        right: i64,
        min_length: f64,
        out: &'o mut Vec<Vec<Pt>>,
        line: Vec<Pt>,
        end: usize,
        side1: Side,
    }
    impl State<'_> {
        fn inner(&mut self, p: Pt) {
            self.line.push(p);
        }
        fn outer(&mut self, p: Pt) {
            if self.end > 0 {
                self.line.push(p);
            }
        }
        fn crossing(&mut self, p1: Pt, p2: Pt, side: Side, leaving: bool) {
            let x = if side == Side::Left { self.left } else { self.right };
            let y = p1.y as i64 + ((x - p1.x as i64) as f64 * (p2.y - p1.y) as f64 / (p2.x - p1.x) as f64) as i64;
            let q = geom::pt(x as i32, y as i32);
            if leaving {
                self.end = self.line.len();
                self.line.push(q);
            } else if self.end > 0 {
                if (self.side1 == Side::Left) == (y - (self.line[self.end].y as i64) < 0) {
                    self.line.remove(self.end);
                } else {
                    self.finish();
                    self.line.push(q);
                }
                self.end = 0;
            } else {
                self.line.push(q);
            }
        }
        fn finish(&mut self) {
            // Only what left the band again prints: a stretch that stays inside it is dropped whole.
            self.line.truncate(self.end);
            if !self.line.is_empty() {
                let joined = self.out.last().is_some_and(|last| *last.last().unwrap() == self.line[0]);
                if joined {
                    let rest: Vec<Pt> = self.line[1..].to_vec();
                    self.out.last_mut().unwrap().extend(rest);
                } else if geom::length_mm(&self.line, false) * geom::SCALE > self.min_length {
                    self.out.push(std::mem::take(&mut self.line));
                }
                self.line.clear();
            }
        }
    }
    let mut st = State { left, right, min_length, out, line: Vec::new(), end: 0, side1: side(pbegin) };
    let mut p1 = pbegin;
    if st.side1 == Side::Mid {
        st.inner(p1);
    }
    let mut i = ibegin;
    while i != iend {
        let inext = (i + 1) % n;
        let p2 = if inext == iend { pend } else { contour[inext] };
        let side2 = side(p2);
        if st.side1 == Side::Mid {
            if side2 == Side::Mid {
                st.inner(p2);
            } else {
                st.crossing(p1, p2, side2, true);
                st.outer(p2);
            }
        } else if side2 == Side::Mid {
            st.crossing(p1, p2, st.side1, false);
            st.inner(p2);
        } else if st.side1 != side2 {
            st.crossing(p1, p2, st.side1, false);
            st.crossing(p1, p2, side2, true);
        } else {
            st.outer(p2);
        }
        st.side1 = side2;
        p1 = p2;
        i = inext;
    }
    st.finish();
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        vec![vec![
            geom::pt(geom::sc(x0), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y1)),
            geom::pt(geom::sc(x0), geom::sc(y1)),
        ]]
    }

    #[test]
    fn a_column_fills_with_a_zig_zag_and_a_cap_round_its_edge() {
        // A 10 × 6 mm column: lines along X (Orca's base angle) 2.88 mm apart on the grid through the origin, half a
        // line in from its edge. The two lines join at the right; the band below the first line, 2.7 mm deep, is
        // too far from it to leave, so the edge round it prints as a cap from the first line's end.
        let spacing = 0.377_079_6;
        let density = spacing / (2.5 + spacing);
        let lines = fill(&rect(0.0, 0.0, 10.0, 6.0), std::f32::consts::FRAC_PI_2 as f64, (0.0, 0.0), spacing, density);
        let got: Vec<(f64, f64)> = lines.iter().flatten().map(|q| (geom::unsc(q.x), geom::unsc(q.y))).collect();
        let want = [
            (9.8115, 2.6886),
            (9.8115, 0.1885),
            (0.1885, 0.1885),
            (0.1885, 2.8771),
            (9.8115, 2.8771),
            (9.8115, 5.7542),
            (0.1885, 5.7542),
        ];
        assert_eq!(lines.len(), 1, "{got:?}");
        assert_eq!(got.len(), want.len(), "{got:?}");
        for (g, w) in got.iter().zip(want) {
            assert!((g.0 - w.0).abs() < 2e-4 && (g.1 - w.1).abs() < 2e-4, "{got:?}");
        }
    }
}
