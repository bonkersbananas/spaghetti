//! Orca's monotonic fill (`FillRectilinear::fill_surface_by_lines` with `monotonic` set), which prints solid
//! infill, bottom and top surfaces and bridges in this profile: parallel lines, each printed only once every line
//! to its left that it touches is printed, so neighbouring lines always go down in the same order and a surface
//! looks even. Ported from OrcaSlicer 2.5's `FillRectilinear.cpp`, in its steps:
//!
//! 1. Turn the region so the lines are vertical. Its outline moved in by 5 % of a spacing is where a line that
//!    ends free stops; moved in by half a spacing is where lines that join along the edge turn.
//! 2. Cut vertical lines through both, half a spacing in from the region's left edge and a spacing apart. Solid
//!    infill spreads its lines over the region's width, up to 20 % further apart (and prints them as much wider);
//!    bridges keep a grid fixed to the object, so they line up from layer to layer.
//! 3. Link each crossing to the next crossing of the same outline on the line beside it or on its own line, where
//!    the stretch of outline between them is short enough (three spacings for solid infill, any length for
//!    bridges, none for Orca's "monotonic line" tops, whose lines all print separately).
//! 4. Group the runs into monotonic regions (strips where each run has one neighbour on either side), and chain
//!    the regions, each after the regions to its left, in the order an ant colony search finds shortest (Orca's,
//!    with its random generator and seed, so its choices too).
//! 5. Print each region as a zig-zag from left to right, joining runs along the outline where the link allows,
//!    and turn the lines back.

use crate::geom::{self, Pt, Shape};
use std::f64::consts::FRAC_PI_2;

/// What to fill and how.
#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// Radians: the way the lines run.
    pub direction: f64,
    /// mm between lines, before any spreading out.
    pub spacing: f64,
    /// Spread the lines evenly over the region's width (solid infill); else lay them on a grid through `origin`.
    pub adjust: bool,
    /// Whether neighbouring lines may join along the region's edge.
    pub connect: bool,
    /// mm: the longest join along the edge (0: any length).
    pub link_max: f64,
    /// Units: the point the region is turned about, and the grid goes through (the object's centre).
    pub origin: (f64, f64),
}

/// The lines of one region.
#[derive(Clone, Debug, Default)]
pub struct Filled {
    /// Polylines in print order, each printed from its first point.
    pub lines: Vec<Vec<Pt>>,
    /// mm: the spacing the lines were laid at (more than asked for when spread out).
    pub spacing: f64,
}

/// `shape` filled with monotonic lines, or `None` where Orca's checks on the cut lines fail (Orca then leaves the
/// region empty; callers fill it otherwise).
pub fn fill(shape: &Shape, p: &Params) -> Option<Filled> {
    let sp_units = p.spacing * geom::SCALE;
    if shape.is_empty() || sp_units < 1.0 {
        return Some(Filled { lines: Vec::new(), spacing: p.spacing });
    }
    // Into the frame where the lines are vertical: turn by −θ about the origin (Orca turns by its
    // `_infill_direction`, the line's way plus a quarter turn).
    let theta = p.direction + FRAC_PI_2;
    let (ox, oy) = p.origin;
    let (s, c) = (-theta).sin_cos();
    let turn = |q: Pt, s: f64, c: f64| -> Pt {
        let (x, y) = (q.x as f64 - ox, q.y as f64 - oy);
        geom::pt((ox + c * x - s * y).round() as i32, (oy + c * y + s * x).round() as i32)
    };
    let src: Shape = shape.iter().map(|contour| contour.iter().map(|&q| turn(q, s, c)).collect()).collect();
    let src = vec![src];
    let outer = geom::offset(&src, -0.05 * p.spacing);
    let inner = geom::offset(&outer, -0.45 * p.spacing);
    let min_area = 0.01 * (0.5 * sp_units).powi(2) * 2.0;
    let keep = |c: &&Vec<Pt>| c.len() >= 3 && (geom::area2(c).unsigned_abs() as f64) >= min_area;
    let mut contours: Vec<Vec<(i64, i64)>> = Vec::new();
    for shape in &outer {
        contours.extend(shape.iter().filter(keep).map(|c| c.iter().map(|q| (q.x as i64, q.y as i64)).collect()));
    }
    let n_outer = contours.len();
    for shape in &inner {
        contours.extend(shape.iter().filter(keep).map(|c| c.iter().map(|q| (q.x as i64, q.y as i64)).collect()));
    }
    if contours.len() == n_outer {
        // Not a single line fits.
        return Some(Filled { lines: Vec::new(), spacing: p.spacing });
    }

    let Some(bb) = geom::bbox(&src) else { return Some(Filled { lines: Vec::new(), spacing: p.spacing }) };
    let (mut min_x, max_x) = (bb[0] as i64, bb[2] as i64);
    let mut ls = sp_units as i64;
    if p.adjust {
        ls = adjust_solid_spacing(max_x - min_x, ls);
    } else {
        // Extend the box to the grid through the origin, so the lines line up from layer to layer.
        let base = ox.round() as i64;
        min_x = base + (min_x - base).div_euclid(ls) * ls;
    }
    let n_vlines = ((max_x - min_x + ls - 1) / ls).max(0) as usize;
    let x0 = min_x + (ls + 1) / 2;

    let mut segs = slice(&contours, n_outer, n_vlines, x0, ls)?;
    let link_max = (p.link_max * geom::SCALE) as i64;
    connect(&contours, &mut segs, p.connect, link_max);
    pinch(&mut segs);
    let mut regions = monotonic_regions(&mut segs);
    let mut lines: Vec<Vec<Pt>> = Vec::new();
    if !regions.is_empty() {
        connect_regions(&mut regions, &contours, &segs);
        let path = chain(&regions, &segs);
        lines = polylines(&path, &regions, &contours, &segs);
    }

    // Back to the plate.
    let (s, c) = theta.sin_cos();
    for line in &mut lines {
        for q in line.iter_mut() {
            *q = turn(*q, s, c);
        }
        line.dedup();
    }
    lines.retain(|l| l.len() >= 2);
    Some(Filled { lines, spacing: ls as f64 / geom::SCALE })
}

/// Orca's `_adjust_solid_spacing`: the spacing that fits a whole number of lines across `width`, at most 20 % more.
fn adjust_solid_spacing(width: i64, distance: i64) -> i64 {
    let w = width as f64 - 1e-4;
    let n = (w / distance as f64) as i64;
    let mut d = if n == 0 { distance } else { (w / n as f64) as i64 };
    if d as f64 / distance as f64 > 1.2 {
        d = (distance as f64 * 1.2 + 0.5).floor() as i64;
    }
    d
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    OuterLow,
    OuterHigh,
    InnerLow,
    InnerHigh,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Link {
    Horizontal,
    Up,
    Down,
    Phony,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Quality {
    Invalid,
    Valid,
    TooLong,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    Left,
    Right,
}

/// Where a vertical line crosses a contour: `p / q` up the line, exactly.
#[derive(Clone, Copy, Debug)]
struct Isect {
    contour: usize,
    segment: usize,
    p: i64,
    q: i64,
    /// The neighbouring crossing along the contour backwards: on the line to the left, or on this line.
    prev: i32,
    /// Forwards: on the line to the right, or on this line.
    next: i32,
    kind: Kind,
    prev_link: Link,
    next_link: Link,
    prev_quality: Quality,
    next_quality: Quality,
    /// Whether the run up from here belongs to a monotonic region yet.
    consumed: bool,
    /// Rectilinear fill's traversal (`traverse`): whether the run up from here, and the edge from here to the line
    /// on the right, have been printed.
    consumed_vertical_up: bool,
    consumed_perimeter_right: bool,
}

impl Isect {
    fn new(contour: usize, segment: usize) -> Isect {
        Isect {
            contour,
            segment,
            p: 0,
            q: 1,
            prev: 0,
            next: 0,
            kind: Kind::OuterLow,
            prev_link: Link::Horizontal,
            next_link: Link::Horizontal,
            prev_quality: Quality::Valid,
            next_quality: Quality::Valid,
            consumed: false,
            consumed_vertical_up: false,
            consumed_perimeter_right: false,
        }
    }

    fn phony(kind: Kind, pos: i64) -> Isect {
        Isect {
            contour: usize::MAX,
            segment: usize::MAX,
            p: pos,
            q: 1,
            prev: -1,
            next: -1,
            kind,
            prev_link: Link::Phony,
            next_link: Link::Phony,
            prev_quality: Quality::Invalid,
            next_quality: Quality::Invalid,
            consumed: false,
            consumed_vertical_up: false,
            consumed_perimeter_right: false,
        }
    }

    /// The crossing's height, rounded.
    fn pos(&self) -> i64 {
        let half = self.q >> 1;
        let p = if self.p < 0 { self.p - half } else { self.p + half };
        p / self.q
    }

    fn is_inner(&self) -> bool {
        matches!(self.kind, Kind::InnerLow | Kind::InnerHigh)
    }

    fn is_low(&self) -> bool {
        matches!(self.kind, Kind::InnerLow | Kind::OuterLow)
    }

    fn has_left_vertical(&self) -> bool {
        matches!(self.prev_link, Link::Up | Link::Down)
    }

    fn has_right_vertical(&self) -> bool {
        matches!(self.next_link, Link::Up | Link::Down)
    }

    fn left_horizontal(&self) -> i32 {
        if self.prev_link == Link::Horizontal { self.prev } else { -1 }
    }

    fn right_horizontal(&self) -> i32 {
        if self.next_link == Link::Horizontal { self.next } else { -1 }
    }

    fn horizontal(&self, side: Side) -> i32 {
        match side {
            Side::Left => self.left_horizontal(),
            Side::Right => self.right_horizontal(),
        }
    }

    fn vertical_up(&self) -> i32 {
        if self.prev_link == Link::Up {
            self.prev
        } else if self.next_link == Link::Up {
            self.next
        } else {
            -1
        }
    }

    fn vertical_up_quality(&self) -> Quality {
        if self.prev_link == Link::Up { self.prev_quality } else { self.next_quality }
    }

    fn vertical_down(&self) -> i32 {
        if self.prev_link == Link::Down {
            self.prev
        } else if self.next_link == Link::Down {
            self.next
        } else {
            -1
        }
    }

    fn vertical_down_quality(&self) -> Quality {
        if self.prev_link == Link::Down { self.prev_quality } else { self.next_quality }
    }

    /// The link along this line away from the run (down from a low end, up from a high one).
    fn vertical_outside(&self) -> i32 {
        if self.is_low() { self.vertical_down() } else { self.vertical_up() }
    }

    fn vertical_outside_quality(&self) -> Quality {
        if self.is_low() { self.vertical_down_quality() } else { self.vertical_up_quality() }
    }

    /// The link along the contour on this line: up if it is a high end, down if a low one.
    fn left_vertical(&self) -> i32 {
        if self.has_left_vertical() { self.prev } else { -1 }
    }

    fn right_vertical(&self) -> i32 {
        if self.has_right_vertical() { self.next } else { -1 }
    }
}

/// A vertical line at `pos` and where it crosses the contours, upwards.
struct Vline {
    pos: i64,
    its: Vec<Isect>,
}

fn prev_idx(i: usize, n: usize) -> usize {
    if i == 0 { n - 1 } else { i - 1 }
}

/// Orca's `slice_region_by_vertical_lines`: every crossing of the vertical lines with the contours, sorted up each
/// line and typed; `None` if a line's crossings don't pair up as they must (Orca gives up on the region then).
fn slice(contours: &[Vec<(i64, i64)>], n_outer: usize, n_vlines: usize, x0: i64, ls: i64) -> Option<Vec<Vline>> {
    let positions: Vec<i64> = (0..n_vlines).map(|i| x0 + i as i64 * ls).collect();
    slice_at(contours, n_outer, &positions)
}

/// The positions (units) of Orca's vertical lines `ls_nm` nanometres apart on the grid through `origin` (units),
/// from the last line at or before `min` until they cover `max`: worked out in nanometres as Orca works them out
/// (`align_to_grid`), so they don't drift from its lines by a rounded spacing, then each rounded to our units.
pub(crate) fn grid_lines(min: i64, max: i64, origin: f64, ls_nm: i64) -> Vec<i64> {
    if ls_nm <= 0 {
        return Vec::new();
    }
    let base = (origin * 100.0).round() as i64;
    let x0 = base + (min * 100 - base).div_euclid(ls_nm) * ls_nm;
    let n = ((max * 100 - x0 + ls_nm - 1) / ls_nm).max(0);
    (0..n).map(|i| ((x0 + i * ls_nm) as f64 / 100.0).round() as i64).collect()
}

/// `slice` with the lines at `positions` (increasing).
fn slice_at(contours: &[Vec<(i64, i64)>], n_outer: usize, positions: &[i64]) -> Option<Vec<Vline>> {
    let mut segs: Vec<Vline> = positions.iter().map(|&pos| Vline { pos, its: Vec::new() }).collect();
    if segs.is_empty() {
        return Some(segs);
    }
    for (ci, contour) in contours.iter().enumerate() {
        let n = contour.len();
        if n < 2 {
            continue;
        }
        for si in 0..n {
            let ip = prev_idx(si, n);
            let (p1, p2) = (contour[ip], contour[si]);
            let (l, r) = if p1.0 <= p2.0 { (p1.0, p2.0) } else { (p2.0, p1.0) };
            let (il, ir) = (positions.partition_point(|&x| x < l), positions.partition_point(|&x| x <= r));
            for seg in &mut segs[il..ir] {
                let this_x = seg.pos;
                let mut is = Isect::new(ci, si);
                if p1.0 == this_x {
                    if p2.0 == this_x {
                        // Strictly vertical edges don't count.
                        continue;
                    }
                    let p0 = contour[prev_idx(ip, n)];
                    if (p0.0 - p1.0) * (p2.0 - p1.0) > 0 {
                        // A corner touching the line from one side.
                        continue;
                    }
                    is.p = p1.1;
                } else if p2.0 == this_x {
                    let p3 = contour[(si + 1) % n];
                    if (p3.0 - p2.0) * (p1.0 - p2.0) > 0 {
                        continue;
                    }
                    is.p = p2.1;
                } else {
                    let (pp, qq) =
                        if p2.0 > p1.0 { (this_x - p1.0, p2.0 - p1.0) } else { (p1.0 - this_x, p1.0 - p2.0) };
                    is.p = pp * (p2.1 - p1.1) + p1.1 * qq;
                    is.q = qq;
                }
                seg.its.push(is);
            }
        }
    }

    let mut keyed: Vec<([f64; 4], usize)> = Vec::new();
    for v in &mut segs {
        // Up the line, exactly (a ratio of integers below 2^53 converts exactly, and equal ratios divide equally).
        keyed.clear();
        keyed.extend(v.its.iter().enumerate().map(|(k, is)| ([is.p as f64 / is.q as f64, 0.0, 0.0, 0.0], k)));
        crate::fill::sort_keyed(&mut keyed);
        let sorted: Vec<Isect> = keyed.iter().map(|&(_, k)| v.its[k]).collect();
        v.its = sorted;
        // Type each crossing by the way its edge runs, and drop the doubles where a corner lies on the line.
        let mut j = 0;
        for i in 0..v.its.len() {
            let mut is = v.its[i];
            let contour = &contours[is.contour];
            let n = contour.len();
            let low = contour[is.segment].0 - contour[prev_idx(is.segment, n)].0 > 0;
            is.kind = match (is.contour < n_outer, low) {
                (true, true) => Kind::OuterLow,
                (true, false) => Kind::OuterHigh,
                (false, true) => Kind::InnerLow,
                (false, false) => Kind::InnerHigh,
            };
            v.its[i] = is;
            let mut take = true;
            if j > 0 {
                let is2 = v.its[j - 1];
                if is.contour == is2.contour && is.q == 1 && is2.q == 1 {
                    if is.p == is2.p {
                        // Two edges meeting on the line: keep one crossing.
                        take = false;
                    } else if is.kind == is2.kind {
                        // A Z whose middle runs along the line: keep the longer run.
                        if !low {
                            v.its[j - 1] = v.its[i];
                        }
                        take = false;
                    }
                }
            }
            if take {
                if j < i {
                    v.its[j] = v.its[i];
                }
                j += 1;
            }
        }
        v.its.truncate(j);
    }

    for v in &segs {
        let its = &v.its;
        if its.len() % 2 != 0 {
            return None;
        }
        let mut i = 0;
        while i < its.len() {
            if its[i].kind != Kind::OuterLow {
                return None;
            }
            let mut j = i + 1;
            if j >= its.len() || !matches!(its[j].kind, Kind::InnerLow | Kind::OuterHigh) {
                return None;
            }
            while j < its.len() && its[j].is_inner() {
                j += 1;
            }
            if j >= its.len() || j & 1 != 1 || its[j].kind != Kind::OuterHigh {
                return None;
            }
            if !(i + 1 == j || its[j - 1].kind == Kind::InnerHigh) {
                return None;
            }
            i = j + 1;
        }
    }
    Some(segs)
}

/// How many edges on from `seg1` to `seg2`, forwards or backwards along the contour.
fn distance_of_segments(n: usize, seg1: usize, seg2: usize, forward: bool) -> i64 {
    let mut d = seg2 as i64 - seg1 as i64;
    if !forward {
        d = -d;
    }
    if d < 0 {
        d += n as i64;
    }
    d
}

/// The length of a contour from `p1` on the edge ending at `seg1` forwards to `p2` on the edge ending at `seg2`.
fn segment_length(poly: &[(i64, i64)], seg1: usize, p1: (i64, i64), seg2: usize, p2: (i64, i64)) -> f64 {
    let d = |a: (i64, i64), b: (i64, i64)| ((a.0 - b.0) as f64).hypot((a.1 - b.1) as f64);
    let mut prev = p1;
    let mut len = 0.0;
    let mut step = |i: usize, prev: &mut (i64, i64)| {
        len += d(*prev, poly[i]);
        *prev = poly[i];
    };
    if seg1 <= seg2 {
        for i in seg1..seg2 {
            step(i, &mut prev);
        }
    } else {
        for i in seg1..poly.len() {
            step(i, &mut prev);
        }
        for i in 0..seg2 {
            step(i, &mut prev);
        }
    }
    len + d(prev, p2)
}

/// The length of the contour between crossing `i1` on line `v` and crossing `i2` on the line to its right.
fn horizontal_link_length(contours: &[Vec<(i64, i64)>], segs: &[Vline], v: usize, i1: usize, i2: usize) -> f64 {
    let (vl, vr) = (&segs[v], &segs[v + 1]);
    let (a, b) = (&vl.its[i1], &vr.its[i2]);
    let poly = &contours[a.contour];
    let (p1, p2) = ((vl.pos, a.pos()), (vr.pos, b.pos()));
    if a.is_low() {
        segment_length(poly, a.segment, p1, b.segment, p2)
    } else {
        segment_length(poly, b.segment, p2, a.segment, p1)
    }
}

/// The length of the contour between two crossings on the same line.
fn vertical_link_length(
    contours: &[Vec<(i64, i64)>],
    segs: &[Vline],
    v: usize,
    i1: usize,
    i2: usize,
    forward: bool,
) -> f64 {
    let vl = &segs[v];
    let (a, b) = (&vl.its[i1], &vl.its[i2]);
    let poly = &contours[a.contour];
    let (p1, p2) = ((vl.pos, a.pos()), (vl.pos, b.pos()));
    if forward {
        segment_length(poly, a.segment, p1, b.segment, p2)
    } else {
        segment_length(poly, b.segment, p2, a.segment, p1)
    }
}

/// Appends the contour's points from edge `seg1` forwards to (not including) the end of edge `seg2`.
fn append_forward(out: &mut Vec<Pt>, poly: &[(i64, i64)], seg1: usize, seg2: usize) {
    let push = |out: &mut Vec<Pt>, i: usize| out.push(geom::pt(poly[i].0 as i32, poly[i].1 as i32));
    if seg1 < seg2 {
        for i in seg1..seg2 {
            push(out, i);
        }
    } else if seg1 > seg2 {
        for i in seg1..poly.len() {
            push(out, i);
        }
        for i in 0..seg2 {
            push(out, i);
        }
    }
}

/// The same backwards (the whole loop when `seg1 == seg2`... as Orca, only when seg1 < seg2 wraps).
fn append_backward(out: &mut Vec<Pt>, poly: &[(i64, i64)], seg1: usize, seg2: usize) {
    let push = |out: &mut Vec<Pt>, i: usize| out.push(geom::pt(poly[i].0 as i32, poly[i].1 as i32));
    if seg1 >= seg2 {
        for i in (seg2 + 1..=seg1).rev() {
            push(out, i - 1);
        }
    } else {
        for i in (1..=seg1).rev() {
            push(out, i - 1);
        }
        for i in (seg2 + 1..=poly.len()).rev() {
            push(out, i - 1);
        }
    }
}

/// Orca's `connect_segment_intersections_by_contours`: for each crossing, the nearest crossing of its contour
/// backwards and forwards (on the lines beside it, or on its own line), and whether the stretch between may be
/// printed as a join.
fn connect(contours: &[Vec<(i64, i64)>], segs: &mut [Vline], may_connect: bool, link_max: i64) {
    for v in 0..segs.len() {
        for ii in 0..segs[v].its.len() {
            let it = segs[v].its[ii];
            let n = contours[it.contour].len();
            let forward = it.is_low();
            let (mut iprev, mut d_prev) = (-1i32, i64::MAX);
            if v > 0 {
                for (i, it2) in segs[v - 1].its.iter().enumerate() {
                    if it.contour == it2.contour && it.kind == it2.kind {
                        let d = distance_of_segments(n, it2.segment, it.segment, forward);
                        if d < d_prev {
                            iprev = i as i32;
                            d_prev = d;
                        }
                    }
                }
            }
            let (mut inext, mut d_next) = (-1i32, i64::MAX);
            if v + 1 < segs.len() {
                for (i, it2) in segs[v + 1].its.iter().enumerate() {
                    if it.contour == it2.contour && it.kind == it2.kind {
                        let d = distance_of_segments(n, it.segment, it2.segment, forward);
                        if d < d_next {
                            inext = i as i32;
                            d_next = d;
                        }
                    }
                }
            }
            let (mut same_prev, mut same_next) = (false, false);
            for (i, it2) in segs[v].its.iter().enumerate() {
                if i != ii && it2.contour == it.contour && it2.kind != it.kind {
                    let d = distance_of_segments(n, it2.segment, it.segment, forward);
                    if d < d_prev {
                        iprev = i as i32;
                        d_prev = d;
                        same_prev = true;
                    }
                    let d = distance_of_segments(n, it.segment, it2.segment, forward);
                    if d < d_next {
                        inext = i as i32;
                        d_next = d;
                        same_next = true;
                    }
                }
            }
            let mut x = it;
            x.prev = iprev;
            x.prev_link =
                if same_prev { if (iprev as usize) < ii { Link::Down } else { Link::Up } } else { Link::Horizontal };
            x.next = inext;
            x.next_link =
                if same_next { if (inext as usize) < ii { Link::Down } else { Link::Up } } else { Link::Horizontal };
            let its = &segs[v].its;
            // A link along this line may only skip outer crossings.
            let skips_inner = |other: i32| -> bool {
                let (a, b) = if (other as usize) < ii { (other as usize, ii) } else { (ii, other as usize) };
                its[a + 1..b].iter().any(Isect::is_inner)
            };
            if same_prev && iprev >= 0 && skips_inner(iprev) {
                x.prev_quality = Quality::Invalid;
            }
            if same_next && inext >= 0 && skips_inner(inext) {
                x.next_quality = Quality::Invalid;
            }
            if same_prev && same_next && ((iprev as usize > ii) == (inext as usize > ii)) {
                // Both neighbours on this line on the same side: the contour doesn't reach the lines beside it.
                x.prev_quality = Quality::Invalid;
                x.next_quality = Quality::Invalid;
            }
            if !may_connect {
                if x.prev_quality == Quality::Valid {
                    x.prev_quality = Quality::TooLong;
                }
                if x.next_quality == Quality::Valid {
                    x.next_quality = Quality::TooLong;
                }
            }
            segs[v].its[ii] = x;
            if may_connect && link_max > 0 {
                let lm = link_max as f64;
                if x.prev_quality == Quality::Valid && iprev >= 0 {
                    let len = if same_prev {
                        vertical_link_length(contours, segs, v, iprev as usize, ii, forward)
                    } else if v > 0 {
                        horizontal_link_length(contours, segs, v - 1, iprev as usize, ii)
                    } else {
                        0.0
                    };
                    if len > lm {
                        segs[v].its[ii].prev_quality = Quality::TooLong;
                    }
                }
                if x.next_quality == Quality::Valid && inext >= 0 {
                    let len = if same_next {
                        vertical_link_length(contours, segs, v, ii, inext as usize, forward)
                    } else if v + 1 < segs.len() {
                        horizontal_link_length(contours, segs, v, ii, inext as usize)
                    } else {
                        0.0
                    };
                    if len > lm {
                        segs[v].its[ii].next_quality = Quality::TooLong;
                    }
                }
            }
        }
        // An invalid link along the line is invalid both ways.
        for ii in 0..segs[v].its.len() {
            let it = segs[v].its[ii];
            if it.has_left_vertical() && it.prev_quality == Quality::Invalid {
                let o = it.left_vertical() as usize;
                segs[v].its[o].prev_quality = Quality::Invalid;
            }
            if it.has_right_vertical() && it.next_quality == Quality::Invalid {
                let o = it.right_vertical() as usize;
                segs[v].its[o].next_quality = Quality::Invalid;
            }
        }
    }
}

/// Orca's `pinch_contours_insert_phony_outer_intersections`: where the outer contour squeezes the inner one into
/// two loops along a line, a phony outer pair between them keeps the runs apart.
fn pinch(segs: &mut [Vline]) {
    for v in 1..segs.len() {
        let mut insert_after: Vec<usize> = Vec::new();
        {
            let its = &segs[v].its;
            if its.len() < 2 {
                continue;
            }
            let end = its.len() - 1;
            let mut it = 1;
            while it < end {
                if its[it].kind == Kind::OuterHigh {
                    it += 2;
                } else {
                    let hi = it + 1;
                    it += 2;
                    let lo2 = it;
                    if lo2 < its.len() && its[lo2].kind == Kind::InnerLow {
                        let up = its[hi].vertical_up();
                        let dn = its[lo2].vertical_down();
                        if dn + 1 != up {
                            insert_after.push(hi);
                        }
                    }
                }
            }
        }
        if insert_after.is_empty() {
            continue;
        }
        let old = std::mem::take(&mut segs[v].its);
        let mut map: Vec<i32> = Vec::with_capacity(old.len());
        let mut its: Vec<Isect> = Vec::with_capacity(old.len() + 2 * insert_after.len());
        let mut i = 0;
        for &after in &insert_after {
            while i <= after {
                map.push(its.len() as i32);
                its.push(old[i]);
                i += 1;
            }
            let pos = (its.last().unwrap().pos() + old[i].pos()) / 2;
            its.push(Isect::phony(Kind::OuterHigh, pos));
            its.push(Isect::phony(Kind::OuterLow, pos));
        }
        while i < old.len() {
            map.push(its.len() as i32);
            its.push(old[i]);
            i += 1;
        }
        for ip in &mut its {
            if ip.has_left_vertical() {
                ip.prev = map[ip.prev as usize];
            }
            if ip.has_right_vertical() {
                ip.next = map[ip.next as usize];
            }
        }
        segs[v].its = its;
        for ip in &mut segs[v - 1].its {
            if ip.right_horizontal() >= 0 {
                ip.next = map[ip.next as usize];
            }
        }
        if v + 1 < segs.len() {
            for ip in &mut segs[v + 1].its {
                if ip.left_horizontal() >= 0 {
                    ip.prev = map[ip.prev as usize];
                }
            }
        }
    }
}

/// The last inner high crossing of the run up from `start` (an inner low), before its outer high one.
fn end_of_run_raw(its: &[Isect], start: usize) -> usize {
    let mut it = start;
    loop {
        it += 1;
        if it + 1 >= its.len() || its[it].kind == Kind::OuterHigh {
            break;
        }
    }
    if its[it - 1].is_inner() {
        it -= 1;
    }
    it
}

/// The same, following valid links up along the contour.
fn end_of_run(its: &[Isect], start: usize) -> usize {
    let mut end = end_of_run_raw(its, start);
    loop {
        let up = its[end].vertical_up();
        if up < 0 || its[end].vertical_up_quality() != Quality::Valid {
            break;
        }
        end = end_of_run_raw(its, up as usize);
    }
    end
}

fn run_bottom(its: &[Isect], start: usize) -> usize {
    let mut it = start;
    loop {
        while its[it].kind != Kind::InnerLow {
            it -= 1;
        }
        if its[it - 1].kind == Kind::InnerHigh {
            it -= 1;
        } else {
            let down = its[it].vertical_down();
            if down < 0 || its[it].vertical_down_quality() != Quality::Valid {
                break;
            }
            it = down as usize;
        }
    }
    it
}

fn run_top(its: &[Isect], start: usize) -> usize {
    let mut it = start;
    loop {
        while its[it].kind != Kind::InnerHigh {
            it += 1;
        }
        if its[it + 1].kind == Kind::InnerLow {
            it += 1;
        } else {
            let up = its[it].vertical_up();
            if up < 0 || its[it].vertical_up_quality() != Quality::Valid {
                break;
            }
            it = up as usize;
        }
    }
    it
}

/// The bottom of the run on the neighbouring line that the run `start..=end` on `this` links to first, going up.
fn overlap_bottom(this: &[Isect], other: &[Isect], start: usize, end: usize, side: Side) -> Option<usize> {
    let mut found = None;
    let mut it = start;
    loop {
        if this[it].is_inner() {
            let i = this[it].horizontal(side);
            if i >= 0 {
                found = Some(i as usize);
                break;
            }
            if it == end {
                break;
            }
        }
        if this[it].kind != Kind::InnerHigh || this[it + 1].kind == Kind::InnerLow {
            it += 1;
        } else {
            let up = this[it].vertical_up();
            if up < 0 || this[it].vertical_up_quality() != Quality::Valid {
                break;
            }
            it = up as usize;
        }
    }
    found.map(|o| run_bottom(other, o))
}

fn overlap_top(this: &[Isect], other: &[Isect], start: usize, end: usize, side: Side) -> Option<usize> {
    let mut found = None;
    let mut it = end;
    loop {
        if this[it].is_inner() {
            let i = this[it].horizontal(side);
            if i >= 0 {
                found = Some(i as usize);
                break;
            }
            if it == start {
                break;
            }
        }
        if this[it].kind != Kind::InnerLow || this[it - 1].kind == Kind::InnerHigh {
            it -= 1;
        } else {
            let down = this[it].vertical_down();
            if down < 0 || this[it].vertical_down_quality() != Quality::Valid {
                break;
            }
            it = down as usize;
        }
    }
    found.map(|o| run_top(other, o))
}

/// The span of runs on the neighbouring line that the run `start..=end` overlaps.
fn overlap(this: &[Isect], other: &[Isect], (start, end): (usize, usize), side: Side) -> Option<(usize, usize)> {
    let bottom = overlap_bottom(this, other, start, end, side)?;
    let top = overlap_top(this, other, start, end, side)?;
    Some((bottom, top))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Boundary {
    vline: usize,
    low: usize,
    high: usize,
}

#[derive(Clone, Debug)]
struct Region {
    left: Boundary,
    right: Boundary,
    /// Extra length when starting at the left's low end, or at its high end (the shorter one is 0).
    len1: f32,
    len2: f32,
    /// Whether it ends on the other side (low or high) than it starts.
    flips: bool,
    left_neighbors: Vec<usize>,
    right_neighbors: Vec<usize>,
}

impl Region {
    fn length(&self, flipped: bool) -> f32 {
        if flipped { self.len2 } else { self.len1 }
    }

    fn left_point(&self, flipped: bool) -> usize {
        if flipped { self.left.high } else { self.left.low }
    }

    fn right_point(&self, flipped: bool) -> usize {
        if flipped == self.flips { self.right.low } else { self.right.high }
    }
}

/// Orca's `generate_montonous_regions`: strips of runs, one per line, each overlapping only the next.
fn monotonic_regions(segs: &mut [Vline]) -> Vec<Region> {
    let mut out = Vec::new();
    for seed in 0..segs.len() {
        let mut i = 1usize;
        while i + 1 < segs[seed].its.len() {
            while i < segs[seed].its.len() && segs[seed].its[i].kind != Kind::InnerLow {
                i += 1;
            }
            if i == segs[seed].its.len() {
                break;
            }
            let start = i;
            let end = end_of_run(&segs[seed].its, start);
            if !segs[seed].its[start].consumed {
                let mut left = (start, end);
                let mut region = Region {
                    left: Boundary { vline: seed, low: start, high: end },
                    right: Boundary { vline: seed, low: start, high: end },
                    len1: 0.0,
                    len2: 0.0,
                    flips: false,
                    left_neighbors: Vec::new(),
                    right_neighbors: Vec::new(),
                };
                segs[seed].its[start].consumed = true;
                let mut lines = 1;
                let mut v = seed + 1;
                while v < segs.len() {
                    let (l, r) = (&segs[v - 1].its, &segs[v].its);
                    let Some(right) = overlap(l, r, left, Side::Right) else { break };
                    if run_top(r, right.0) != right.1 {
                        // It overlaps more than one run on the right.
                        break;
                    }
                    if overlap(r, l, right, Side::Left) != Some(left) {
                        // The run on the right overlaps more than this one on its left.
                        break;
                    }
                    region.right = Boundary { vline: v, low: right.0, high: right.1 };
                    segs[v].its[right.0].consumed = true;
                    lines += 1;
                    left = right;
                    v += 1;
                }
                // An odd number of lines ends on the other side than it starts.
                region.flips = lines % 2 == 1;
                out.push(region);
            }
            i = end + 1;
        }
    }
    out
}

/// Orca's `montonous_region_path_length`: how far printing a region from one side takes, counting joins along
/// the contour at half their length and the moves between runs that don't join.
fn region_length(region: &Region, flipped: bool, contours: &[Vec<(i64, i64)>], segs: &[Vline]) -> f32 {
    let mut ii = region.left_point(flipped);
    let mut v = region.left.vline;
    let mut total = 0.0f64;
    let mut no_perimeter = false;
    let mut last = (0.0f64, 0.0f64);
    loop {
        let its = &segs[v].its;
        let mut it = ii;
        let going_up = its[it].is_low();
        if no_perimeter {
            let other = if going_up { it - 1 } else { it + 1 };
            total += (last.0 - segs[v].pos as f64).hypot(last.1 - its[other].pos() as f64);
        }
        let mut iright = its[it].right_horizontal();
        if going_up {
            loop {
                loop {
                    it += 1;
                    iright = iright.max(its[it].right_horizontal());
                    if its[it].kind == Kind::InnerHigh && its[it + 1].kind == Kind::OuterHigh {
                        break;
                    }
                }
                let up = its[it].vertical_up();
                if up < 0 || its[it].vertical_up_quality() != Quality::Valid {
                    break;
                }
                it = up as usize;
            }
        } else {
            loop {
                loop {
                    it -= 1;
                    let r = its[it].right_horizontal();
                    if r >= 0 {
                        iright = r;
                    }
                    if its[it].kind == Kind::InnerLow && its[it - 1].kind == Kind::OuterLow {
                        break;
                    }
                }
                let down = its[it].vertical_down();
                if down < 0 || its[it].vertical_down_quality() != Quality::Valid {
                    break;
                }
                it = down as usize;
            }
        }
        if v == region.right.vline || iright < 0 {
            break;
        }
        let inext = its[it].right_horizontal();
        let right = &segs[v + 1].its;
        let r = if going_up { run_top(right, iright as usize) } else { run_bottom(right, iright as usize) };
        ii = r;
        if inext == r as i32 && its[it].next_quality == Quality::Valid {
            total += 0.5 * horizontal_link_length(contours, segs, v, it, inext as usize);
            no_perimeter = false;
        } else {
            let o = if going_up { it + 1 } else { it - 1 };
            last = (segs[v].pos as f64, its[o].pos() as f64);
            no_perimeter = true;
        }
        v += 1;
    }
    (total / geom::SCALE) as f32
}

/// Orca's `connect_monotonic_regions`: each region's neighbours to the left (which print before it) and right.
fn connect_regions(regions: &mut [Region], contours: &[Vec<(i64, i64)>], segs: &[Vline]) {
    // Which region starts, and which ends, at each crossing of each line.
    let mut starts: Vec<Vec<usize>> = segs.iter().map(|v| vec![usize::MAX; v.its.len()]).collect();
    let mut ends: Vec<Vec<usize>> = starts.clone();
    for (k, r) in regions.iter().enumerate() {
        starts[r.left.vline][r.left.low] = k;
        ends[r.right.vline][r.right.low] = k;
    }
    let found = |map: &[Vec<usize>], v: usize, i: usize| map[v].get(i).copied().filter(|&k| k != usize::MAX);
    let mut left_of: Vec<(usize, usize)> = Vec::new(); // (region, its right neighbour)
    for (k, r) in regions.iter().enumerate() {
        if r.left.vline > 0 {
            let (this, left) = (&segs[r.left.vline].its, &segs[r.left.vline - 1].its);
            if let Some((mut lbegin, lend)) = overlap(this, left, (r.left.low, r.left.high), Side::Left) {
                loop {
                    if let Some(o) = found(&ends, r.left.vline - 1, lbegin) {
                        left_of.push((o, k));
                    }
                    let mut lnext = run_top(left, lbegin);
                    if lnext == lend {
                        break;
                    }
                    while left[lnext].kind != Kind::InnerLow {
                        lnext += 1;
                    }
                    lbegin = lnext;
                }
            }
        }
        if r.right.vline + 1 < segs.len() {
            let (this, right) = (&segs[r.right.vline].its, &segs[r.right.vline + 1].its);
            if let Some((mut rbegin, rend)) = overlap(this, right, (r.right.low, r.right.high), Side::Right) {
                loop {
                    if let Some(o) = found(&starts, r.right.vline + 1, rbegin) {
                        left_of.push((k, o));
                    }
                    let mut rnext = run_top(right, rbegin);
                    if rnext == rend {
                        break;
                    }
                    while right[rnext].kind != Kind::InnerLow {
                        rnext += 1;
                    }
                    rbegin = rnext;
                }
            }
        }
    }
    for (l, r) in left_of {
        regions[l].right_neighbors.push(r);
        regions[r].left_neighbors.push(l);
    }
    for r in regions.iter_mut() {
        r.left_neighbors.sort_unstable();
        r.left_neighbors.dedup();
        r.right_neighbors.sort_unstable();
        r.right_neighbors.dedup();
    }
    for r in regions.iter_mut() {
        let (len1, len2) = (region_length(r, false, contours, segs), region_length(r, true, contours, segs));
        if len1 > len2 {
            r.len1 = len1 - len2;
            r.len2 = 0.0;
        } else {
            r.len2 = len2 - len1;
            r.len1 = 0.0;
        }
    }
}

/// Orca's random generator for the ant colony: the 64-bit Mersenne Twister (`std::mt19937_64`), default seed.
struct Mt64 {
    mt: [u64; 312],
    index: usize,
}

impl Mt64 {
    fn new() -> Mt64 {
        let mut mt = [0u64; 312];
        mt[0] = 5489;
        for i in 1..312 {
            mt[i] = 6364136223846793005u64.wrapping_mul(mt[i - 1] ^ (mt[i - 1] >> 62)).wrapping_add(i as u64);
        }
        Mt64 { mt, index: 312 }
    }

    fn next(&mut self) -> u64 {
        if self.index >= 312 {
            for i in 0..312 {
                let x = (self.mt[i] & 0xFFFF_FFFF_8000_0000) | (self.mt[(i + 1) % 312] & 0x7FFF_FFFF);
                let mut xa = x >> 1;
                if x & 1 != 0 {
                    xa ^= 0xB502_6F5A_A966_19E9;
                }
                self.mt[i] = self.mt[(i + 156) % 312] ^ xa;
            }
            self.index = 0;
        }
        let mut x = self.mt[self.index];
        self.index += 1;
        x ^= (x >> 29) & 0x5555_5555_5555_5555;
        x ^= (x << 17) & 0x71D6_7FFF_EDA6_0000;
        x ^= (x << 37) & 0xFFF7_EEE0_0000_0000;
        x ^ (x >> 43)
    }

    /// A number below `n`, as libstdc++'s `uniform_int_distribution` draws it (Lemire's method).
    fn below(&mut self, n: u64) -> u64 {
        let mut product = self.next() as u128 * n as u128;
        let mut low = product as u64;
        if low < n {
            let threshold = n.wrapping_neg() % n;
            while low < threshold {
                product = self.next() as u128 * n as u128;
                low = product as u64;
            }
        }
        (product >> 64) as u64
    }

    /// `float(rng()) / float(rng.max())`.
    fn unit(&mut self) -> f32 {
        self.next() as f32 / u64::MAX as f32
    }
}

/// A region in the chain, whether it is printed from its left high end, and the ants' link on to the next one.
#[derive(Clone, Copy, Debug)]
struct Step {
    region: usize,
    flipped: bool,
    link: usize,
}

impl Step {
    fn new(region: usize, flipped: bool) -> Step {
        Step { region, flipped, link: usize::MAX }
    }
}

/// The ants' memory of a move from one region's end to another's start.
struct Ants {
    n: usize,
    pheromone: Vec<f32>,
}

impl Ants {
    fn index(&self, from: usize, from_flipped: bool, to: usize, to_flipped: bool) -> usize {
        let row = 2 * from + from_flipped as usize;
        let col = 2 * to + to_flipped as usize;
        row * self.n * 2 + col
    }
}

/// The move from `from`'s end to `to`'s start: straight, mm (Orca measures it so; its contour branch never runs).
fn move_length(regions: &[Region], segs: &[Vline], from: Step, to: Step) -> f32 {
    let (a, b) = (&regions[from.region], &regions[to.region]);
    let (va, vb) = (&segs[a.right.vline], &segs[b.left.vline]);
    let ya = va.its[a.right_point(from.flipped)].pos();
    let yb = vb.its[b.left_point(to.flipped)].pos();
    let (dx, dy) = ((vb.pos - va.pos) as f32 / geom::SCALE as f32, (yb - ya) as f32 / geom::SCALE as f32);
    (dx * dx + dy * dy).sqrt()
}

fn visibility(length: f32) -> f32 {
    1.0 / (length + 1e-4)
}

/// Orca's `chain_monotonic_regions`: an order of the regions, each after its left neighbours, that is short. A
/// greedy chain first, then up to 25 rounds of 10 ants; regions beyond a few hundred keep the greedy chain.
fn chain(regions: &[Region], segs: &[Vline]) -> Vec<Step> {
    let n = regions.len();
    let mut unprocessed_initial: Vec<i32> = vec![1; n];
    let mut queue_initial: Vec<usize> = Vec::new();
    for (k, r) in regions.iter().enumerate() {
        if r.left_neighbors.is_empty() {
            queue_initial.push(k);
        } else {
            unprocessed_initial[k] += r.left_neighbors.len() as i32;
        }
    }
    if queue_initial.is_empty() {
        // A cycle of neighbours (it shouldn't happen): print them in order.
        return (0..n).map(|region| Step::new(region, false)).collect();
    }

    // The greedy chain: from the last free region, always the most visible next one.
    let mut queue = queue_initial.clone();
    let mut unprocessed = unprocessed_initial.clone();
    let mut greedy: Vec<Step> = Vec::with_capacity(n);
    let first = queue.pop().unwrap();
    unprocessed[first] -= 1;
    greedy.push(Step::new(first, false));
    let mut total = regions[first].length(false);
    while !queue.is_empty() || !regions[greedy.last().unwrap().region].right_neighbors.is_empty() {
        let end = *greedy.last().unwrap();
        let region = &regions[end.region];
        let mut best: Option<(Step, f32)> = None;
        let consider = |next: usize, best: &mut Option<(Step, f32)>| {
            for flipped in [false, true] {
                let to = Step::new(next, flipped);
                let vis = visibility(move_length(regions, segs, end, to));
                if vis > best.map_or(0.0, |b| b.1) {
                    *best = Some((to, vis));
                }
            }
        };
        for &next in &region.right_neighbors {
            if unprocessed[next] == 2 {
                consider(next, &mut best);
            }
        }
        let from_queue = best.is_none();
        if from_queue {
            for &next in &queue {
                consider(next, &mut best);
            }
        }
        for &next in &region.right_neighbors {
            unprocessed[next] -= 1;
            if unprocessed[next] == 1 && best.is_none_or(|b| b.0.region != next) {
                queue.push(next);
            }
        }
        let Some((next, _)) = best else { break };
        if from_queue && let Some(at) = queue.iter().position(|&q| q == next.region) {
            queue.swap_remove(at);
        }
        total += regions[next.region].length(next.flipped) + move_length(regions, segs, end, next);
        unprocessed[next.region] = 0;
        greedy.push(next);
    }
    if greedy.len() != n || n > 256 {
        if greedy.len() != n {
            // Some regions were never reached (inconsistent neighbours): append them.
            let mut seen = vec![false; n];
            for s in &greedy {
                seen[s.region] = true;
            }
            greedy.extend((0..n).filter(|&k| !seen[k]).map(|region| Step::new(region, false)));
        }
        return greedy;
    }

    const ROUNDS: usize = 25;
    const ROUNDS_NO_CHANGE_EXIT: usize = 8;
    const EVAPORATION: f32 = 0.1;
    const DIVERSIFICATION: f32 = 0.1;
    const TAKE_BEST: f32 = 0.9;
    let num_ants = n.min(10);
    let initial = 0.1 / total;
    let mut ants = Ants { n, pheromone: vec![initial; 4 * n * n] };
    let mut rng = Mt64::new();
    let mut best_path: Vec<Step> = Vec::new();
    let mut best_length = f32::MAX;
    let mut path: Vec<Step> = Vec::with_capacity(n);
    struct Candidate {
        to: Step,
        link: usize,
        probability: f32,
    }
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut no_change = 0;
    'rounds: for _ in 0..ROUNDS {
        if no_change >= ROUNDS_NO_CHANGE_EXIT {
            break;
        }
        let mut improved = false;
        for _ in 0..num_ants {
            path.clear();
            let mut queue = queue_initial.clone();
            let mut unprocessed = unprocessed_initial.clone();
            let first_idx = rng.below(queue.len() as u64) as usize;
            let flipped = rng.next() > u64::MAX / 2;
            path.push(Step::new(queue[first_idx], flipped));
            queue.swap_remove(first_idx);
            unprocessed[path[0].region] -= 1;
            while !queue.is_empty() || !regions[path.last().unwrap().region].right_neighbors.is_empty() {
                let end = *path.last().unwrap();
                let region = &regions[end.region];
                candidates.clear();
                let add = |next: usize, candidates: &mut Vec<Candidate>| {
                    for flipped in [false, true] {
                        let to = Step::new(next, flipped);
                        let link = ants.index(end.region, end.flipped, next, flipped);
                        let vis = visibility(move_length(regions, segs, end, to));
                        candidates.push(Candidate { to, link, probability: ants.pheromone[link] * vis * vis });
                    }
                };
                for &next in &region.right_neighbors {
                    unprocessed[next] -= 1;
                    if unprocessed[next] == 1 {
                        add(next, &mut candidates);
                    }
                }
                let direct = candidates.len();
                if direct == 0 {
                    for &next in &queue {
                        add(next, &mut candidates);
                    }
                }
                if candidates.is_empty() {
                    break;
                }
                let dice = rng.unit();
                let take = if dice < TAKE_BEST {
                    let mut best = 0;
                    for (k, c) in candidates.iter().enumerate() {
                        if c.probability > candidates[best].probability {
                            best = k;
                        }
                    }
                    best
                } else {
                    let total_p: f32 = candidates.iter().map(|c| c.probability).sum();
                    let mut threshold = rng.next() as f32 * total_p / u64::MAX as f32;
                    let mut take = candidates.len() - 1;
                    for (k, c) in candidates.iter().enumerate() {
                        threshold -= c.probability;
                        if threshold <= 0.0 {
                            take = k;
                            break;
                        }
                    }
                    take
                };
                let taken = candidates[take].to.region;
                for c in &candidates[..direct] {
                    if queue.last() != Some(&c.to.region) && c.to.region != taken {
                        queue.push(c.to.region);
                    }
                }
                if take >= direct
                    && let Some(at) = queue.iter().position(|&q| q == taken)
                {
                    queue.swap_remove(at);
                }
                let link = candidates[take].link;
                path.last_mut().unwrap().link = link;
                path.push(candidates[take].to);
                unprocessed[taken] = 0;
                ants.pheromone[link] = (1.0 - DIVERSIFICATION) * ants.pheromone[link] + DIVERSIFICATION * initial;
            }
            if path.len() != n {
                continue;
            }
            let mut length = regions[path[n - 1].region].length(path[n - 1].flipped);
            for w in path.windows(2) {
                length += regions[w[0].region].length(w[0].flipped) + move_length(regions, segs, w[0], w[1]);
            }
            if length < best_length {
                best_length = length;
                std::mem::swap(&mut best_path, &mut path);
                if length == 0.0 {
                    break 'rounds;
                }
                improved = true;
            }
        }
        // Orca reinforces the links of `path` as it is after the round: the previous best if the last ant
        // improved on it, else the last ant's.
        let total_cost = best_length + 1e-4;
        for step in path.iter().take(path.len().saturating_sub(1)) {
            if step.link != usize::MAX {
                ants.pheromone[step.link] = (1.0 - EVAPORATION) * ants.pheromone[step.link] + EVAPORATION / total_cost;
            }
        }
        if improved {
            no_change = 0;
        } else {
            no_change += 1;
        }
    }
    if best_path.len() == n { best_path } else { greedy }
}

/// Orca's `polylines_from_paths`: the regions in chain order as zig-zags, runs joined along the inner contour
/// where their link is valid, free ends taken out to the outer contour.
fn polylines(path: &[Step], regions: &[Region], contours: &[Vec<(i64, i64)>], segs: &[Vline]) -> Vec<Vec<Pt>> {
    let mut out: Vec<Vec<Pt>> = Vec::new();
    let mut open = false;
    let p = |x: i64, y: i64| geom::pt(x as i32, y as i32);
    let finish = |out: &mut Vec<Vec<Pt>>| {
        let Some(mut line) = out.pop() else { return };
        line.dedup();
        let tiny = line.len() == 2 && (line[0].x - line[1].x).abs() < 1 && (line[0].y - line[1].y).abs() < 1;
        if line.len() <= 1 || tiny {
            return;
        }
        if let Some(prev) = out.last_mut() {
            let (a, b) = (*prev.last().unwrap(), line[0]);
            if (a.x - b.x).abs() < 1 && (a.y - b.y).abs() < 1 {
                // A run split by a phony pair: one polyline again.
                *prev.last_mut().unwrap() = geom::pt((a.x + b.x) / 2, (a.y + b.y) / 2);
                prev.extend_from_slice(&line[1..]);
                return;
            }
        }
        out.push(line);
    };
    for (k, step) in path.iter().enumerate() {
        let region = &regions[step.region];
        let mut ii = region.left_point(step.flipped);
        let mut v = region.left.vline;
        if open && k > 0 {
            let prev_step = path[k - 1];
            let prev_region = &regions[prev_step.region];
            let vp = prev_region.right.vline;
            let ip = prev_region.right_point(prev_step.flipped);
            let it_prev = &segs[vp].its[ip];
            let mut extended = false;
            if vp + 1 == v && it_prev.right_horizontal() == ii as i32 && it_prev.next_quality == Quality::Valid {
                let line = out.last_mut().unwrap();
                let poly = &contours[it_prev.contour];
                let other = &segs[v].its[ii];
                if it_prev.is_low() {
                    append_forward(line, poly, it_prev.segment, other.segment);
                } else {
                    append_backward(line, poly, it_prev.segment, other.segment);
                }
                line.push(p(segs[v].pos, other.pos()));
                extended = true;
            }
            if !extended {
                let o = if it_prev.is_low() { ip - 1 } else { ip + 1 };
                let line = out.last_mut().unwrap();
                *line.last_mut().unwrap() = p(segs[vp].pos, segs[vp].its[o].pos());
                finish(&mut out);
                open = false;
            }
        }
        loop {
            let its = &segs[v].its;
            let mut it = ii;
            let going_up = its[it].is_low();
            if !open {
                // A new line starts at the outer contour.
                let o = if going_up { it - 1 } else { it + 1 };
                out.push(vec![p(segs[v].pos, its[o].pos())]);
                open = true;
            } else {
                out.last_mut().unwrap().push(p(segs[v].pos, its[it].pos()));
            }
            let mut iright = its[it].right_horizontal();
            let line = out.last_mut().unwrap();
            if going_up {
                loop {
                    loop {
                        it += 1;
                        iright = iright.max(its[it].right_horizontal());
                        if its[it].kind == Kind::InnerHigh && its[it + 1].kind == Kind::OuterHigh {
                            break;
                        }
                    }
                    line.push(p(segs[v].pos, its[it].pos()));
                    let up = its[it].vertical_up();
                    if up < 0 || its[it].vertical_up_quality() != Quality::Valid {
                        break;
                    }
                    let forward = its[it].prev_link == Link::Up;
                    let poly = &contours[its[it].contour];
                    let up = up as usize;
                    if forward {
                        append_forward(line, poly, its[it].segment, its[up].segment);
                    } else {
                        append_backward(line, poly, its[it].segment, its[up].segment);
                    }
                    line.push(p(segs[v].pos, its[up].pos()));
                    it = up;
                }
            } else {
                loop {
                    loop {
                        it -= 1;
                        let r = its[it].right_horizontal();
                        if r >= 0 {
                            iright = r;
                        }
                        if its[it].kind == Kind::InnerLow && its[it - 1].kind == Kind::OuterLow {
                            break;
                        }
                    }
                    line.push(p(segs[v].pos, its[it].pos()));
                    let down = its[it].vertical_down();
                    if down < 0 || its[it].vertical_down_quality() != Quality::Valid {
                        break;
                    }
                    let forward = its[it].next_link == Link::Down;
                    let poly = &contours[its[it].contour];
                    let down = down as usize;
                    if forward {
                        append_forward(line, poly, its[it].segment, its[down].segment);
                    } else {
                        append_backward(line, poly, its[it].segment, its[down].segment);
                    }
                    line.push(p(segs[v].pos, its[down].pos()));
                    it = down;
                }
            }
            if v == region.right.vline || iright < 0 {
                break;
            }
            let inext = its[it].right_horizontal();
            let right = &segs[v + 1].its;
            let r = if going_up { run_top(right, iright as usize) } else { run_bottom(right, iright as usize) };
            ii = r;
            if inext == r as i32 && its[it].next_quality == Quality::Valid {
                let poly = &contours[its[it].contour];
                if its[it].is_low() {
                    append_forward(line, poly, its[it].segment, right[r].segment);
                } else {
                    append_backward(line, poly, its[it].segment, right[r].segment);
                }
                line.push(p(segs[v + 1].pos, right[r].pos()));
            } else {
                let o = if going_up { it + 1 } else { it - 1 };
                *line.last_mut().unwrap() = p(segs[v].pos, its[o].pos());
                finish(&mut out);
                open = false;
            }
            v += 1;
        }
    }
    if open && let Some(last) = path.last() {
        let region = &regions[last.region];
        let vl = &segs[region.right.vline];
        let ip = region.right_point(last.flipped);
        let o = if vl.its[ip].is_low() { ip - 1 } else { ip + 1 };
        *out.last_mut().unwrap().last_mut().unwrap() = p(vl.pos, vl.its[o].pos());
        finish(&mut out);
    }
    out
}

/// A run of a vertical line inside the contours: its x, and where it starts and ends (the contour, the edge it
/// crosses by the edge's end point, and the height).
pub(crate) struct Run {
    pub(crate) x: i64,
    pub(crate) low: (usize, usize, i64),
    pub(crate) high: (usize, usize, i64),
}

/// Orca's `make_fill_lines` on contours that are all outer ones: the runs of the vertical lines `x0 + i·ls` (those
/// from `x_min` to `x_max`) inside them, line by line, each from the bottom up. `None` where Orca's checks on the
/// crossings fail (it then fills nothing).
pub(crate) fn vertical_runs(
    contours: &[Vec<(i64, i64)>],
    positions: &[i64],
    x_min: i64,
    x_max: i64,
) -> Option<Vec<Run>> {
    let segs = slice_at(contours, contours.len(), positions)?;
    let mut out = Vec::new();
    for v in &segs {
        if v.pos < x_min {
            continue;
        }
        if v.pos > x_max {
            break;
        }
        let its = &v.its;
        let mut k = 0;
        while k < its.len() {
            let low = its[k];
            k += 1;
            if low.kind != Kind::OuterLow {
                continue;
            }
            if k < its.len() && its[k].kind == Kind::OuterHigh {
                let high = its[k];
                out.push(Run {
                    x: v.pos,
                    low: (low.contour, low.segment, low.pos()),
                    high: (high.contour, high.segment, high.pos()),
                });
                k += 1;
            }
        }
    }
    Some(out)
}

/// Orca's rectilinear fill below full density (`FillRectilinear::fill_surface_by_lines` without `monotonic`), as
/// normal supports' first layer prints: lines on a grid through `origin` (units), the region turned by `angle`
/// (radians, Orca's `_infill_direction` angle), `spacing` mm wide at `density`, joined along the edge where they
/// can in Orca's sweep from left to right (`traverse_graph_generate_polylines`), and printed in that order.
pub fn rectilinear(shape: &Shape, angle: f64, origin: (f64, f64), spacing: f64, density: f64) -> Vec<Vec<Pt>> {
    let sp_units = spacing * geom::SCALE;
    if shape.is_empty() || sp_units < 1.0 || density <= 0.0 {
        return Vec::new();
    }
    let (ox, oy) = origin;
    let turn = |q: Pt, s: f64, c: f64| -> Pt {
        let (x, y) = (q.x as f64 - ox, q.y as f64 - oy);
        geom::pt((ox + c * x - s * y).round() as i32, (oy + c * y + s * x).round() as i32)
    };
    let (s, c) = (-angle).sin_cos();
    let src: Shape = shape.iter().map(|contour| contour.iter().map(|&q| turn(q, s, c)).collect()).collect();
    let src = vec![src];
    let outer = geom::offset(&src, -0.05 * spacing);
    let inner = geom::offset(&outer, -0.45 * spacing);
    let min_area = 0.01 * (0.5 * sp_units).powi(2) * 2.0;
    let keep = |c: &&Vec<Pt>| c.len() >= 3 && (geom::area2(c).unsigned_abs() as f64) >= min_area;
    let mut contours: Vec<Vec<(i64, i64)>> = Vec::new();
    for shape in &outer {
        contours.extend(shape.iter().filter(keep).map(|c| c.iter().map(|q| (q.x as i64, q.y as i64)).collect()));
    }
    let n_outer = contours.len();
    for shape in &inner {
        contours.extend(shape.iter().filter(keep).map(|c| c.iter().map(|q| (q.x as i64, q.y as i64)).collect()));
    }
    if contours.len() == n_outer {
        return Vec::new();
    }
    let Some(bb) = geom::bbox(&src) else { return Vec::new() };
    // Orca's spacing in whole nanometres (its float spacing over its float density).
    let ls_nm = (spacing * 1e6 / (density as f32 as f64)) as i64;
    let positions = grid_lines(bb[0] as i64, bb[2] as i64, ox, ls_nm);
    let Some(mut segs) = slice_at(&contours, n_outer, &positions) else { return Vec::new() };
    connect(&contours, &mut segs, true, 0);
    let mut lines = traverse(&contours, &mut segs);
    let (s, c) = angle.sin_cos();
    for line in &mut lines {
        for q in line.iter_mut() {
            *q = turn(*q, s, c);
        }
        line.dedup();
    }
    lines.retain(|l| l.len() >= 2);
    lines
}

/// Whether the edge from crossing `i` on line `v` to the line on `side` may be followed (Orca's
/// `intersection_on_prev_next_vertical_line_valid`): it starts no run along the line, ends at the end of a run there
/// that is still to print, is a valid link, and hasn't been printed.
fn side_valid(segs: &[Vline], v: usize, i: usize, side: Side) -> bool {
    let it = &segs[v].its[i];
    let has_vertical = match side {
        Side::Left => it.has_left_vertical(),
        Side::Right => it.has_right_vertical(),
    };
    if has_vertical {
        return false;
    }
    let other = it.horizontal(side);
    if other < 0 {
        return false;
    }
    let other = other as usize;
    let vo = match side {
        Side::Left => &segs[v - 1],
        Side::Right => &segs[v + 1],
    };
    let ito = &vo.its[other];
    let ito2 = &vo.its[if ito.is_low() { other - 1 } else { other + 1 }];
    if ito2.is_inner() {
        return false;
    }
    let quality = match side {
        Side::Left => it.prev_quality,
        Side::Right => it.next_quality,
    };
    if quality != Quality::Valid {
        return false;
    }
    if match side {
        Side::Right => it.consumed_perimeter_right,
        Side::Left => ito.consumed_perimeter_right,
    } {
        return false;
    }
    !(if ito.is_low() { ito.consumed_vertical_up } else { vo.its[other - 1].consumed_vertical_up })
}

/// Orca's `traverse_graph_generate_polylines`: from the leftmost run not yet printed, up or down it, then along the
/// edge to the next line (or the one before) where that is allowed, the shorter way when both are, or along the edge
/// to the next run of the same line, until no way goes on; then the next leftmost run.
fn traverse(contours: &[Vec<(i64, i64)>], segs: &mut [Vline]) -> Vec<Vec<Pt>> {
    for v in segs.iter_mut() {
        for i in 0..v.its.len().saturating_sub(1) {
            if v.its[i].kind == Kind::OuterLow && v.its[i + 1].kind == Kind::OuterHigh {
                v.its[i].consumed_vertical_up = true;
            }
        }
    }
    let p = |x: i64, y: i64| geom::pt(x as i32, y as i32);
    let mut out: Vec<Vec<Pt>> = Vec::new();
    let mut v = 0usize;
    let mut at: Option<usize> = None;
    loop {
        if at.is_none() {
            let mut found = None;
            'search: for (v2, line) in segs.iter().enumerate() {
                for (k, it) in line.its.iter().enumerate() {
                    if !it.is_inner() {
                        let consumed =
                            if it.is_low() { it.consumed_vertical_up } else { line.its[k - 1].consumed_vertical_up };
                        if !consumed {
                            found = Some((v2, k));
                            break 'search;
                        }
                    }
                }
            }
            let Some((v2, k)) = found else { break };
            v = v2;
            at = Some(k);
            out.push(vec![p(segs[v].pos, segs[v].its[k].pos())]);
        }
        let cur = out.len() - 1;
        let mut it = at.unwrap();
        let pos = segs[v].pos;
        let going_up = segs[v].its[it].is_low();
        let mut try_connect = false;
        if going_up {
            if segs[v].its[it].is_inner() {
                it -= 1;
            }
            loop {
                segs[v].its[it].consumed_vertical_up = true;
                it += 1;
                if segs[v].its[it].kind == Kind::OuterHigh {
                    break;
                }
            }
            if segs[v].its[it - 1].is_inner() {
                it -= 1;
                try_connect = true;
            }
        } else {
            if segs[v].its[it].is_inner() {
                segs[v].its[it].consumed_vertical_up = true;
            }
            loop {
                it -= 1;
                segs[v].its[it].consumed_vertical_up = true;
                if segs[v].its[it].kind == Kind::OuterLow {
                    break;
                }
            }
            if segs[v].its[it + 1].is_inner() {
                it += 1;
                try_connect = true;
            }
        }
        if try_connect {
            let i_prev = segs[v].its[it].left_horizontal();
            let i_next = segs[v].its[it].right_horizontal();
            let prev_valid = side_valid(segs, v, it, Side::Left);
            let next_valid = side_valid(segs, v, it, Side::Right);
            if i_prev != -1 {
                segs[v - 1].its[i_prev as usize].consumed_perimeter_right = true;
            }
            if i_next != -1 {
                segs[v].its[it].consumed_perimeter_right = true;
            }
            if prev_valid || next_valid {
                let mut take_next = next_valid;
                if prev_valid && next_valid {
                    let dist_prev = horizontal_link_length(contours, segs, v - 1, i_prev as usize, it);
                    let dist_next = horizontal_link_length(contours, segs, v, it, i_next as usize);
                    take_next = dist_next < dist_prev;
                }
                out[cur].push(p(pos, segs[v].its[it].pos()));
                let (v2, i2) = if take_next { (v + 1, i_next as usize) } else { (v - 1, i_prev as usize) };
                let a = segs[v].its[it];
                let b = segs[v2].its[i2];
                let poly = &contours[a.contour];
                if a.is_low() == take_next {
                    append_forward(&mut out[cur], poly, a.segment, b.segment);
                } else {
                    append_backward(&mut out[cur], poly, a.segment, b.segment);
                }
                out[cur].push(p(segs[v2].pos, b.pos()));
                v = v2;
                at = Some(i2);
                continue;
            }
            let i_vertical = segs[v].its[it].vertical_outside();
            let quality = if i_vertical == -1
                || segs[v].its[(i_vertical + if going_up { 0 } else { -1 }) as usize].consumed_vertical_up
            {
                Quality::Invalid
            } else {
                segs[v].its[it].vertical_outside_quality()
            };
            if quality != Quality::Invalid {
                let iv = i_vertical as usize;
                out[cur].push(p(pos, segs[v].its[it].pos()));
                if quality == Quality::Valid {
                    let a = segs[v].its[it];
                    let b = segs[v].its[iv];
                    let forward = if going_up { a.prev_link == Link::Up } else { a.next_link == Link::Down };
                    let poly = &contours[a.contour];
                    if forward {
                        append_forward(&mut out[cur], poly, a.segment, b.segment);
                    } else {
                        append_backward(&mut out[cur], poly, a.segment, b.segment);
                    }
                    out[cur].push(p(pos, b.pos()));
                } else {
                    out.push(vec![p(pos, segs[v].its[iv].pos())]);
                }
                let run = if going_up { it..iv } else { iv..it };
                for is in &mut segs[v].its[run] {
                    is.consumed_vertical_up = true;
                }
                segs[v].its[it].consumed_perimeter_right = true;
                let beside = if going_up { it + 1 } else { it - 1 };
                segs[v].its[beside].consumed_perimeter_right = true;
                at = Some(iv);
                continue;
            }
            if going_up {
                it += 1;
            } else {
                it -= 1;
            }
        }
        let cur = out.len() - 1;
        out[cur].push(p(pos, segs[v].its[it].pos()));
        out[cur].dedup();
        let line = &out[cur];
        if line.len() <= 1
            || (line.len() == 2 && (line[0].x - line[1].x).abs() < 1 && (line[0].y - line[1].y).abs() < 1)
        {
            out.pop();
        }
        at = None;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        vec![vec![
            geom::pt(geom::sc(x0), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y1)),
            geom::pt(geom::sc(x0), geom::sc(y1)),
        ]]
    }

    fn params(direction_deg: f64) -> Params {
        Params {
            direction: direction_deg.to_radians(),
            spacing: 0.4,
            adjust: true,
            connect: true,
            link_max: 1.2,
            origin: (0.0, 0.0),
        }
    }

    #[test]
    fn the_generator_is_the_standard_mersenne_twister() {
        let mut rng = Mt64::new();
        let mut last = 0;
        for _ in 0..10_000 {
            last = rng.next();
        }
        assert_eq!(last, 9_981_545_732_273_789_042);
    }

    #[test]
    fn a_square_fills_as_one_zig_zag_of_evenly_spread_lines() {
        let filled = fill(&square(0.0, 0.0, 10.0, 10.0), &params(90.0)).unwrap();
        // As Orca, 10 mm takes 24 lines (an exact multiple counts one interval less), 10/24 mm apart; one
        // polyline, joined along the edge.
        assert_eq!(filled.lines.len(), 1, "{:?}", filled.lines.len());
        assert!((filled.spacing - 10.0 / 24.0).abs() < 1e-3, "{}", filled.spacing);
        let line = &filled.lines[0];
        // Every line is vertical (the way asked) and the zig-zag goes one way across (for lines at 90°, Orca's
        // quarter turn makes that right to left).
        let xs: Vec<i32> = line.iter().map(|q| q.x).collect();
        assert!(xs.windows(2).all(|w| w[1] <= w[0] + 1), "{xs:?}");
        let length = geom::length_mm(line, false);
        assert!((length - 24.0 * 9.6).abs() < 15.0, "{length}");
    }

    #[test]
    fn narrow_regions_spread_their_lines_up_to_a_fifth() {
        // 1 mm wide: two lines at 0.48 mm (0.4 × 1.2), not three.
        let filled = fill(&square(0.0, 0.0, 1.0, 10.0), &params(90.0)).unwrap();
        assert!((filled.spacing - 0.48).abs() < 1e-3, "{}", filled.spacing);
        let runs: usize = filled.lines.iter().map(|l| l.len() / 2).sum();
        assert_eq!(runs, 2, "{:?}", filled.lines);
    }

    #[test]
    fn without_joins_every_line_prints_alone_and_one_way_after_the_other() {
        let mut p = params(90.0);
        p.connect = false;
        let filled = fill(&square(0.0, 0.0, 4.0, 4.0), &p).unwrap();
        assert_eq!(filled.lines.len(), 9);
        assert!(filled.lines.iter().all(|l| l.len() == 2));
        // One after the other across.
        let xs: Vec<i32> = filled.lines.iter().map(|l| l[0].x).collect();
        assert!(xs.windows(2).all(|w| w[1] < w[0]), "{xs:?}");
        // Free ends reach 5 % of a spacing from the edge.
        let ys: Vec<i32> = filled.lines[0].iter().map(|q| q.y).collect();
        let (lo, hi) = (*ys.iter().min().unwrap(), *ys.iter().max().unwrap());
        assert!((geom::unsc(lo) - 0.02).abs() < 0.002 && (geom::unsc(hi) - 3.98).abs() < 0.002, "{ys:?}");
    }

    #[test]
    fn a_ring_prints_left_before_right_where_it_splits() {
        // A square with a hole: the lines split around it, and no line prints before one to its left that it
        // touches.
        let mut shape = square(0.0, 0.0, 8.0, 8.0);
        let mut hole = square(3.0, 3.0, 5.0, 5.0).remove(0);
        hole.reverse();
        shape.push(hole);
        let filled = fill(&shape, &params(90.0)).unwrap();
        let total: f64 = filled.lines.iter().map(|l| geom::length_mm(l, false)).sum();
        // About 20 lines of 7.6 mm, less the hole's 5 lines of 2 mm, plus the joins.
        assert!((total - (20.0 * 7.6 - 5.0 * 2.4)).abs() < 20.0, "{total}");
        assert!(filled.lines.len() <= 4, "{}", filled.lines.len());
    }
}
