//! Elephant's foot compensation as OrcaSlicer 2.5 makes it (`ElephantFootCompensation.cpp`): the first layer, which
//! the plate squashes wider than the rest, is pulled in by `elefant_foot_compensation` where a shape is wide enough,
//! by less where it narrows, and not at all where it is too narrow for its outer wall and the compensation on both
//! sides, so that thin features keep a first layer.
//!
//! Each contour is resampled every half millimetre. At each point the shape's width is the distance to the nearest
//! other part of the shape on its inner side: of its own contour, only what lies far enough along it and round the
//! inside of a bend. The width gives how far the point moves in, smoothed along the contour, and the contour is
//! offset by each point's own amount: Orca's mitred variable offset, resolved by Clipper2 as Orca resolves it.

use crate::geom::{self, Contour, Pt, Shape, Shapes};
use std::f64::consts::PI;

/// Orca's `SCALED_EPSILON`, 0.1 µm, in units.
const EPSILON: f64 = 1e-4 * geom::SCALE;
/// How far apart the points are at which the width is measured, mm (Orca's `resample_interval`).
const RESAMPLE: f64 = 0.5;

/// A first layer's shapes pulled in against elephant's foot, each on its own and then together (Orca's `union_ex` of
/// `elephant_foot_compensation`): by `compensation` mm where a shape is wide enough for `min_width` mm and the
/// compensation on both sides. Orca's `min_width` is the first layer's outer wall line width plus its spacing.
pub fn compensate_shapes(shapes: &Shapes, min_width: f64, compensation: f64) -> Shapes {
    let contours: Vec<Contour> = shapes.iter().flat_map(|shape| compensate(shape, min_width, compensation)).collect();
    geom::union_clipper2(&contours)
}

/// One shape pulled in (`elephant_foot_compensation` of one ExPolygon). A shape too small to correct is left as it
/// is, and so is one that pulling in would part.
pub fn compensate(shape: &Shape, min_width: f64, compensation: f64) -> Shape {
    if shape.is_empty() || compensation <= 0.0 {
        return shape.clone();
    }
    let comp = compensation * geom::SCALE;
    let min_width = min_width * geom::SCALE;
    let min_width_compensated = min_width + 2.0 * comp;
    // A little wider than the widest width that matters.
    let search_radius = min_width_compensated + min_width * 0.5;
    let b = geom::bbox_of(shape);
    let area = shape.iter().map(|c| geom::area2(c) as f64).sum::<f64>() / 2.0;
    if f64::from(b[2] - b[0]) < min_width_compensated + EPSILON
        || f64::from(b[3] - b[1]) < min_width_compensated + EPSILON
        || area < min_width_compensated * min_width_compensated * 5.0
    {
        return shape.clone();
    }
    let Some(simplified) = simplified(shape) else { return shape.clone() };
    let grid = Grid::new(&simplified, 0.7 * search_radius);
    let mut resampled: Shape = Vec::with_capacity(simplified.len());
    let mut deltas: Vec<Vec<f64>> = Vec::with_capacity(simplified.len());
    for k in 0..simplified.len() {
        let r = resample(&simplified[k], RESAMPLE * geom::SCALE);
        let mut d = widths(&grid, &simplified, k, &r, comp, search_radius);
        for w in &mut d {
            // The width a point has, as how far it may move in.
            *w = if *w < min_width {
                0.0
            } else if *w > min_width_compensated {
                -comp
            } else {
                -(*w - min_width) / 2.0
            };
        }
        smooth(&r.points, 0.8 * RESAMPLE * geom::SCALE, &mut d, 0.3, 3);
        resampled.push(r.points);
        deltas.push(d);
    }
    let mut out = variable_offset_inner(&resampled, &deltas, 2.0);
    if out.len() == 1 { out.pop().unwrap_or_default() } else { shape.clone() }
}

/// The shape simplified to 0.1 µm and made clean again (`ExPolygon::simplify(SCALED_EPSILON)`), the first shape of
/// that; `None` if nothing is left.
fn simplified(shape: &Shape) -> Option<Shape> {
    let contours: Vec<Contour> = shape
        .iter()
        .filter(|c| c.len() >= 3)
        .filter_map(|c| {
            let mut closed = c.clone();
            closed.push(c[0]);
            let mut s = geom::simplify_line(&closed, EPSILON / geom::SCALE);
            s.pop();
            (s.len() >= 3).then_some(s)
        })
        .collect();
    geom::union_clipper2(&contours).into_iter().next().filter(|s| s.iter().all(|c| c.len() >= 3))
}

/// A contour with points added along each edge at most a step apart (`resample_polygon`): its points, how far along
/// the contour each is (from the start of the edge that closes it, as Orca measures), and how far along each of the
/// contour's own points is.
struct Resampled {
    points: Contour,
    along: Vec<f64>,
    at_point: Vec<f64>,
}

fn resample(contour: &[Pt], step: f64) -> Resampled {
    let n = contour.len();
    let mut out =
        Resampled { points: Vec::with_capacity(n), along: Vec::with_capacity(n), at_point: Vec::with_capacity(n) };
    let mut prev = contour[n - 1];
    let mut total = 0.0;
    for &p in contour {
        let (vx, vy) = (f64::from(p.x - prev.x), f64::from(p.y - prev.y));
        let l = (vx * vx + vy * vy).sqrt();
        let k = (l / step).ceil() as usize;
        let l_step = if k > 0 { l / k as f64 } else { 0.0 };
        for i in 1..k {
            let t = i as f64 / k as f64;
            // Truncated, as Eigen's cast to coord_t.
            out.points.push(geom::pt((f64::from(prev.x) + vx * t) as i32, (f64::from(prev.y) + vy * t) as i32));
            total += l_step;
            out.along.push(total);
        }
        out.points.push(p);
        total += l_step;
        out.along.push(total);
        out.at_point.push(total);
        prev = p;
    }
    out
}

/// The shape's width at each point of its contour `k`, resampled (`contour_distance2`): the distance to the nearest
/// point of the shape on the point's inner side, at most `search_radius` (units). Of the point's own contour, a part
/// counts only if it lies more than a quarter circle of the compensation along the contour from the point; and if it
/// lies within the search radius, only if it is round the inside of a bend and the way along the contour is more than
/// 0.6 of the half circle across, so that a bulge doesn't measure itself.
fn widths(grid: &Grid, shape: &Shape, k: usize, r: &Resampled, comp: f64, search_radius: f64) -> Vec<f64> {
    let accept_along = 0.5 * comp * PI;
    let end = r.along.last().copied().unwrap_or(0.0);
    let n = r.points.len();
    let mut seen = vec![usize::MAX; grid.segments];
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let p = r.points[i];
        let (a, c) = (r.points[(i + n - 1) % n], r.points[(i + 1) % n]);
        let (v1x, v1y) = (f64::from(p.x - a.x), f64::from(p.y - a.y));
        let (v2x, v2y) = (f64::from(c.x - p.x), f64::from(c.y - p.y));
        // Into the shape: the left of the contour's way round (outer contours run anticlockwise, holes clockwise).
        let (ix, iy) = (-v1y - v2y, v1x + v2x);
        let mut best: Option<f64> = None;
        grid.visit(p, search_radius, |id, ci, s| {
            if seen[id] == i {
                return;
            }
            seen[id] = i;
            let contour = &shape[ci];
            let m = contour.len();
            let (s0, s1) = (contour[s], contour[(s + 1) % m]);
            let (vx, vy) = (f64::from(s1.x - s0.x), f64::from(s1.y - s0.y));
            let (ax, ay) = (f64::from(p.x - s0.x), f64::from(p.y - s0.y));
            let l2 = vx * vx + vy * vy;
            let t = if l2 == 0.0 { 0.0 } else { ((ax * vx + ay * vy) / l2).clamp(0.0, 1.0) };
            let (bx, by) = (f64::from(s0.x) + t * vx - f64::from(p.x), f64::from(s0.y) + t * vy - f64::from(p.y));
            let dist = (bx * bx + by * by).sqrt();
            if best.is_some_and(|b| dist >= b) || ix * bx + iy * by <= 0.0 {
                return;
            }
            if ci == k {
                let mut lo = r.along[i];
                let mut hi = t * l2.sqrt() + if s + 1 < m { r.at_point[s] } else { 0.0 };
                if lo > hi {
                    std::mem::swap(&mut lo, &mut hi);
                }
                let along = (hi - lo).min(lo + end - hi);
                if along < accept_along {
                    return;
                }
                if dist < search_radius + EPSILON {
                    let inside = if t == 0.0 {
                        inside_corner(contour, s, p)
                    } else if t == 1.0 {
                        inside_corner(contour, (s + 1) % m, p)
                    } else {
                        left_of(contour, s, p)
                    };
                    if !(inside && along > 0.6 * PI * dist) {
                        return;
                    }
                }
            }
            best = Some(dist);
        });
        out.push(best.map_or(search_radius, |d| d.min(search_radius)));
    }
    out
}

fn cross(ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
    ax * by - ay * bx
}

/// Whether `p` lies inside the corner at point `i` of a contour: left of both its edges where the corner turns left,
/// of either where it turns right.
fn inside_corner(contour: &[Pt], i: usize, p: Pt) -> bool {
    let m = contour.len();
    let (prev, this, next) = (contour[(i + m - 1) % m], contour[i], contour[(i + 1) % m]);
    let (v1x, v1y) = (f64::from(this.x - prev.x), f64::from(this.y - prev.y));
    let (v2x, v2y) = (f64::from(next.x - this.x), f64::from(next.y - this.y));
    let left_of_v1 = cross(v1x, v1y, f64::from(p.x - prev.x), f64::from(p.y - prev.y)) > 0.0;
    let left_of_v2 = cross(v2x, v2y, f64::from(p.x - this.x), f64::from(p.y - this.y)) > 0.0;
    if cross(v1x, v1y, v2x, v2y) > 0.0 { left_of_v1 && left_of_v2 } else { left_of_v1 || left_of_v2 }
}

/// Whether `p` lies left of edge `i` of a contour.
fn left_of(contour: &[Pt], i: usize, p: Pt) -> bool {
    let (a, b) = (contour[i], contour[(i + 1) % contour.len()]);
    cross(f64::from(b.x - a.x), f64::from(b.y - a.y), f64::from(p.x - a.x), f64::from(p.y - a.y)) > 0.0
}

/// The compensation at each point smoothed along the contour (`smooth_compensation_banded`): `iterations` times, each
/// point moves `strength` of the way to the mean of the values `band` units either side of it along the contour, but
/// only ever to less compensation.
fn smooth(points: &[Pt], band: f64, compensation: &mut Vec<f64>, strength: f64, iterations: usize) {
    let n = points.len();
    let at = |i: usize| (f64::from(points[i].x), f64::from(points[i].y));
    let dist = |a: (f64, f64), b: (f64, f64)| ((a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1)).sqrt();
    let lerp = |a: f64, b: f64, t: f64| (1.0 - t) * a + t * b;
    // The value `band` along the contour from point `i`, one way round (`step` the next index that way).
    let banded = |c: &[f64], i: usize, step: &dyn Fn(usize) -> usize| -> f64 {
        let this = at(i);
        let mut j = step(i);
        let mut pprev = at(j);
        let mut value = c[j];
        let l0 = dist(this, pprev);
        if l0 < band {
            let mut l = l0;
            let mut jprev = j;
            j = step(j);
            while j != i {
                let pp = at(j);
                let lthis = dist(pp, pprev);
                let lnext = l + lthis;
                if lnext > band {
                    value = lerp(c[jprev], c[j], (band - l) / lthis);
                    break;
                }
                value = c[j];
                pprev = pp;
                l = lnext;
                jprev = j;
                j = step(j);
            }
        }
        value
    };
    let back = |i: usize| (i + n - 1) % n;
    let forth = |i: usize| (i + 1) % n;
    let mut out = compensation.clone();
    for _ in 0..iterations {
        for i in 0..n {
            let prev = banded(&compensation[..], i, &back);
            let next = banded(&compensation[..], i, &forth);
            let laplacian = compensation[i] * (1.0 - strength) + 0.5 * strength * (prev + next);
            // The compensations are negative: only ever less of it.
            out[i] = laplacian.max(compensation[i]);
        }
        std::mem::swap(&mut out, compensation);
    }
}

/// The resampled shape moved in by each point's own amount (`variable_offset_inner_ex`, mitre limit `miter_limit`):
/// its outer contour's offset where it winds positively, less each hole's where it winds negatively, as Clipper2
/// resolves them.
fn variable_offset_inner(shape: &Shape, deltas: &[Vec<f64>], miter_limit: f64) -> Shapes {
    use clipper2_rs::{ClipType, FillRule};
    let outer =
        geom::clip_clipper2(ClipType::Union, FillRule::Positive, &[mitred(&shape[0], &deltas[0], miter_limit)], &[]);
    let mut holes = Vec::new();
    for (hole, d) in shape[1..].iter().zip(&deltas[1..]) {
        holes.extend(geom::clip_clipper2(ClipType::Union, FillRule::Negative, &[mitred(hole, d, miter_limit)], &[]));
    }
    geom::clip_clipper2_shapes(ClipType::Difference, FillRule::NonZero, &outer, &holes)
}

/// A closed contour offset by a distance of its own at each point, all of one sign (`mittered_offset_path_scaled`):
/// Clipper's mitred offset, edges shorter than a two-hundredth of the largest distance merged into the next, corners
/// the offset goes into looped through the point (for the union to take out), corners it goes round mitred, or
/// squared off past the mitre limit (at most 2).
fn mitred(contour: &[Pt], deltas: &[f64], miter_limit: f64) -> Contour {
    let mut out = Vec::new();
    let n = contour.len();
    if deltas.len() <= 2 || n != deltas.len() {
        return out;
    }
    out.reserve(n * 2);
    let miter_limit = if miter_limit > 2.0 { 2.0 / (miter_limit * miter_limit) } else { 0.5 };
    let perp = |v: (f64, f64)| (v.1, -v.0);
    let normalized = |v: (f64, f64)| {
        let l = (v.0 * v.0 + v.1 * v.1).sqrt();
        if l == 0.0 { v } else { (v.0 / l, v.1 / l) }
    };
    let at = |i: usize| (f64::from(contour[i].x), f64::from(contour[i].y));
    let sub = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0, a.1 - b.1);
    let d2 = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0) * (a.0 - b.0) + (a.1 - b.1) * (a.1 - b.1);
    // Rounded half away from zero.
    let round = |p: (f64, f64)| {
        let x = p.0 + if p.0 < 0.0 { -0.5 } else { 0.5 };
        let y = p.1 + if p.1 < 0.0 { -0.5 } else { 0.5 };
        geom::pt(x as i32, y as i32)
    };
    let lmin = deltas.iter().copied().fold(f64::NEG_INFINITY, f64::max) * 0.005;
    let l2min = lmin * lmin;
    // Clipper's: only exactly parallel edges count as parallel.
    let sin_min_parallel = 1.0;
    let mut pt = at(0);
    let mut iprev = n - 1;
    let mut ptprev = (0.0, 0.0);
    while iprev > 0 {
        ptprev = at(iprev);
        if d2(ptprev, pt) > l2min {
            break;
        }
        iprev -= 1;
    }
    if iprev == 0 {
        return out;
    }
    let ilast = iprev;
    let mut nprev = normalized(perp(sub(pt, ptprev)));
    let mut i = 0;
    loop {
        let mut j = i + 1;
        let mut ptnext = (0.0, 0.0);
        while j <= ilast {
            ptnext = at(j);
            if d2(ptnext, pt) > l2min {
                break;
            }
            j += 1;
        }
        if j > ilast {
            // The last edge too short: merged into the one before.
            i = ilast;
            ptnext = at(0);
        }
        let nnext = normalized(perp(sub(ptnext, pt)));
        let delta = deltas[i];
        let sin_a = (nprev.0 * nnext.1 - nprev.1 * nnext.0).clamp(-1.0, 1.0);
        let convex = sin_a * delta;
        if convex <= -sin_min_parallel {
            out.push(round((pt.0 + nprev.0 * delta, pt.1 + nprev.1 * delta)));
            out.push(round(pt));
            out.push(round((pt.0 + nnext.0 * delta, pt.1 + nnext.1 * delta)));
        } else {
            let dot = nprev.0 * nnext.0 + nprev.1 * nnext.1;
            if convex < sin_min_parallel && dot > 0.0 {
                out.push(round((pt.0 + nprev.0 * delta, pt.1 + nprev.1 * delta)));
            } else {
                let r = 1.0 + dot;
                if r >= miter_limit {
                    out.push(round((pt.0 + (nprev.0 + nnext.0) * delta / r, pt.1 + (nprev.1 + nnext.1) * delta / r)));
                } else {
                    let dx = (sin_a.atan2(dot) / 4.0).tan();
                    let (pp, pn) = (perp(nprev), perp(nnext));
                    out.push(round((pt.0 + (nprev.0 - pp.0 * dx) * delta, pt.1 + (nprev.1 - pp.1 * dx) * delta)));
                    out.push(round((pt.0 + (nnext.0 + pn.0 * dx) * delta, pt.1 + (nnext.1 + pn.1 * dx) * delta)));
                }
            }
        }
        if i == ilast {
            break;
        }
        nprev = nnext;
        pt = ptnext;
        i = j;
    }
    out
}

/// The segments of a shape's contours by the grid cells their bounding boxes cover, for the nearest ones to a point.
struct Grid {
    x0: i64,
    y0: i64,
    cell: f64,
    cols: usize,
    rows: usize,
    /// Where each cell's segments start in `items`, cell by cell, row by row (one more at the end).
    start: Vec<u32>,
    /// (segment id, contour, segment index) of each cell's segments.
    items: Vec<(u32, u32, u32)>,
    segments: usize,
}

impl Grid {
    fn new(shape: &Shape, cell: f64) -> Grid {
        let cell = cell.max(1.0);
        let mut b = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
        for p in shape.iter().flatten() {
            b = [
                b[0].min(i64::from(p.x)),
                b[1].min(i64::from(p.y)),
                b[2].max(i64::from(p.x)),
                b[3].max(i64::from(p.y)),
            ];
        }
        let cols = (((b[2] - b[0]) as f64 / cell) as usize + 1).max(1);
        let rows = (((b[3] - b[1]) as f64 / cell) as usize + 1).max(1);
        let span = |lo: i64, hi: i64, origin: i64, count: usize| {
            let a = (((lo - origin) as f64 / cell) as usize).min(count - 1);
            let z = (((hi - origin) as f64 / cell) as usize).min(count - 1);
            (a, z)
        };
        let mut grid = Grid {
            x0: b[0],
            y0: b[1],
            cell,
            cols,
            rows,
            start: vec![0; cols * rows + 1],
            items: Vec::new(),
            segments: 0,
        };
        // Twice over the segments: count each cell's, then place them.
        for pass in 0..2 {
            let mut id = 0u32;
            for (ci, contour) in shape.iter().enumerate() {
                let m = contour.len();
                for s in 0..m {
                    let (a, z) = (contour[s], contour[(s + 1) % m]);
                    let (c0, c1) = span(i64::from(a.x.min(z.x)), i64::from(a.x.max(z.x)), grid.x0, cols);
                    let (r0, r1) = span(i64::from(a.y.min(z.y)), i64::from(a.y.max(z.y)), grid.y0, rows);
                    for row in r0..=r1 {
                        for col in c0..=c1 {
                            let at = row * cols + col;
                            if pass == 0 {
                                grid.start[at + 1] += 1;
                            } else {
                                let k = grid.start[at] as usize;
                                grid.items[k] = (id, ci as u32, s as u32);
                                grid.start[at] += 1;
                            }
                        }
                    }
                    id += 1;
                }
            }
            grid.segments = id as usize;
            if pass == 0 {
                for at in 0..cols * rows {
                    grid.start[at + 1] += grid.start[at];
                }
                grid.items = vec![(0, 0, 0); grid.start[cols * rows] as usize];
            } else {
                // Each cell's start moved to its end, which is the next cell's start: back by one cell.
                for at in (1..=cols * rows).rev() {
                    grid.start[at] = grid.start[at - 1];
                }
                grid.start[0] = 0;
            }
        }
        grid
    }

    /// Calls `f(segment id, contour, segment)` for each segment in a cell that meets the square `radius` round `p`
    /// (a segment can come more than once).
    fn visit(&self, p: Pt, radius: f64, mut f: impl FnMut(usize, usize, usize)) {
        let cell_of = |v: f64, origin: i64, count: usize| -> usize {
            let c = (v - origin as f64) / self.cell;
            if c <= 0.0 { 0 } else { (c as usize).min(count - 1) }
        };
        let (c0, c1) = (
            cell_of(f64::from(p.x) - radius, self.x0, self.cols),
            cell_of(f64::from(p.x) + radius, self.x0, self.cols),
        );
        let (r0, r1) = (
            cell_of(f64::from(p.y) - radius, self.y0, self.rows),
            cell_of(f64::from(p.y) + radius, self.y0, self.rows),
        );
        for row in r0..=r1 {
            for col in c0..=c1 {
                let at = row * self.cols + col;
                for &(id, ci, s) in &self.items[self.start[at] as usize..self.start[at + 1] as usize] {
                    f(id as usize, ci as usize, s as usize);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Contour {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]
    }

    fn area(shape: &Shape) -> f64 {
        shape.iter().map(|c| geom::area2(c) as f64).sum::<f64>() / 2.0 / (geom::SCALE * geom::SCALE)
    }

    // The X2D's first layer: a 0.5 mm outer wall 0.2 mm high, so 0.957 mm for it and its spacing, and 0.15 mm.
    const MIN_WIDTH: f64 = 0.5 + 0.5 - 0.2 * (1.0 - PI / 4.0);
    const COMPENSATION: f64 = 0.15;

    #[test]
    fn a_thin_rib_keeps_its_whole_first_layer() {
        for w in [0.45, 0.6, 0.7, 1.2] {
            let rib = vec![rect(0.0, 0.0, w, 5.0)];
            assert_eq!(compensate(&rib, MIN_WIDTH, COMPENSATION), rib, "{w} mm");
        }
    }

    #[test]
    fn a_wide_square_comes_in_all_round() {
        let square = vec![rect(0.0, 0.0, 10.0, 10.0)];
        let out = compensate(&square, MIN_WIDTH, COMPENSATION);
        let a = area(&out);
        // 9.7 mm square.
        assert!((a - 9.7 * 9.7).abs() < 0.01, "{a}");
    }

    #[test]
    fn a_hole_grows_as_the_shape_comes_in() {
        let mut ring = vec![rect(0.0, 0.0, 20.0, 20.0)];
        let mut hole = rect(5.0, 5.0, 15.0, 15.0);
        hole.reverse();
        ring.push(hole);
        let out = compensate(&ring, MIN_WIDTH, COMPENSATION);
        assert_eq!(out.len(), 2);
        // 19.7 mm outside, a 10.3 mm hole.
        let a = area(&out);
        assert!((a - (19.7 * 19.7 - 10.3 * 10.3)).abs() < 0.02, "{a}");
    }

    #[test]
    fn a_thin_fin_on_a_block_keeps_its_width_and_the_block_comes_in() {
        // A 10 mm block with a 0.6 mm fin 6 mm long out of one side, one shape.
        let shapes = geom::union_contours(&[rect(0.0, 0.0, 10.0, 10.0), rect(9.9, 4.7, 16.0, 5.3)]);
        assert_eq!(shapes.len(), 1);
        let out = compensate_shapes(&shapes, MIN_WIDTH, COMPENSATION);
        assert_eq!(out.len(), 1);
        let b = geom::bbox_of(&out[0]);
        let mm = |v: i32| f64::from(v) / geom::SCALE;
        // The block's far sides come in the whole 0.15 mm.
        assert!((mm(b[0]) - 0.15).abs() < 0.01 && (mm(b[1]) - 0.15).abs() < 0.01, "{b:?}");
        // The fin keeps its width along its length; only its tip, which measures nothing across it, comes in a little.
        let fin = geom::intersection(&out, &vec![vec![rect(11.0, 0.0, 15.0, 10.0)]]);
        let fin_area: f64 = fin.iter().map(area).sum();
        assert!((fin_area - 4.0 * 0.6).abs() < 0.01, "{fin_area}");
        assert!(mm(b[2]) > 15.8 && mm(b[2]) <= 16.0, "{b:?}");
    }

    #[test]
    fn a_narrow_neck_is_kept_and_the_shape_stays_whole() {
        // Two 10 mm blocks joined by a 0.25 mm neck 3 mm long: an inset of 0.15 mm would part them.
        let shapes = geom::union_contours(&[
            rect(0.0, 0.0, 10.0, 10.0),
            rect(9.9, 4.875, 13.1, 5.125),
            rect(13.0, 0.0, 23.0, 10.0),
        ]);
        assert_eq!(shapes.len(), 1);
        assert_eq!(geom::offset(&shapes, -COMPENSATION).len(), 2);
        let out = compensate_shapes(&shapes, MIN_WIDTH, COMPENSATION);
        assert_eq!(out.len(), 1);
        let neck = geom::intersection(&out, &vec![vec![rect(11.0, 0.0, 12.0, 10.0)]]);
        let a: f64 = neck.iter().map(area).sum();
        assert!((a - 0.25).abs() < 0.005, "{a}");
        let b = geom::bbox_of(&out[0]);
        assert!(
            (f64::from(b[0]) / geom::SCALE - 0.15).abs() < 0.01 && (f64::from(b[2]) / geom::SCALE - 22.85).abs() < 0.01
        );
    }

    #[test]
    fn a_ring_too_narrow_to_compensate_keeps_its_walls() {
        // A 0.8 mm wall round a 20 mm square: narrower than the outer wall and the compensation either side, so its
        // sides stay; only its corners, a little wider across, come in a hair.
        let mut ring = vec![rect(0.0, 0.0, 20.0, 20.0)];
        let mut hole = rect(0.8, 0.8, 19.2, 19.2);
        hole.reverse();
        ring.push(hole);
        let out = compensate(&ring, MIN_WIDTH, COMPENSATION);
        assert_eq!(out.len(), 2);
        let side = geom::intersection(&vec![out], &vec![vec![rect(5.0, -1.0, 15.0, 2.0)]]);
        let a: f64 = side.iter().map(area).sum();
        assert!((a - 10.0 * 0.8).abs() < 0.005, "{a}");
    }
}
