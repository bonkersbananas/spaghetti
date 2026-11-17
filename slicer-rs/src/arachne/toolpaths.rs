//! Orca 2.5.1's `WallToolPaths` (Arachne): an outline turned into lines of beads of varying width, `inset_count`
//! walls deep. The outline is cleaned (offset out and in, simplified, self-intersections nudged apart), the
//! skeletal trapezoidation makes the beads, which are stitched into lines, the short odd ones dropped, the lines
//! round the inner contour (a width of 0) set aside as the contour the infill fills, and each line simplified.
//! Numbers are nanometres as integers where Orca's are; the outline arrives in `geom`'s 0.1 µm and the offsets are
//! `geom::offset_c2`'s (Clipper2, as Orca 2.5's).

use super::beading::{Params, make_strategy};
use super::graph::{P, p};
use super::trapezoidation::{Line as ExtrusionLine, Trapezoidation};
use crate::geom::{self, Join, Shapes};
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay::IntOverlayOptions;
use i_overlay::core::simplify::Simplify;
use std::collections::HashMap;

pub use super::graph::Junction as ExtrusionJunction;

/// `WallToolPathsParams` (millimetres and degrees where Orca's are).
#[derive(Clone, Debug)]
pub struct WallParams {
    pub min_feature_size: f64,
    pub min_length_factor: f32,
    pub min_bead_width: f64,
    pub wall_transition_filter_deviation: f64,
    pub wall_transition_length: f64,
    pub wall_transition_angle: f64,
    pub wall_distribution_count: i32,
    pub is_top_or_bottom_layer: bool,
    /// Nanometres.
    pub wall_maximum_resolution: i64,
    pub wall_maximum_deviation: i64,
}

/// What `WallToolPaths::generate` leaves: lines by inset (outer wall 0 first), and the contour inside the walls.
#[derive(Clone, Debug, Default)]
pub struct WallToolPaths {
    pub toolpaths: Vec<Vec<ExtrusionLine>>,
    pub inner_contour: Shapes,
}

fn scaled(mm: f64) -> i64 {
    (mm * 1_000_000.0) as i64
}

/// Orca's `Flow::rounded_rectangle_extrusion_width_from_spacing`.
pub fn rounded_rectangle_extrusion_width_from_spacing(spacing: f32, height: f32) -> f32 {
    (spacing as f64 + height as f64 * (1.0 - 0.25 * std::f64::consts::PI)) as f32
}

/// `colinear_vertex_tolerance()`: `SCALED_EPSILON`, 1e-4 mm.
const COLINEAR_VERTEX_TOLERANCE: i64 = 100;
const MESHFIX_MAXIMUM_EXTRUSION_AREA_DEVIATION: i64 = 2_000_000;

fn cross(a: P, b: P) -> i64 {
    a.x * b.y - a.y * b.x
}

fn dist_to_infinite(point: P, a: P, b: P) -> f64 {
    graph_dist_sq(point, a, b).sqrt()
}

fn graph_dist_sq(point: P, a: P, b: P) -> f64 {
    super::graph::closest_on_infinite(a, b, point).1
}

/// `Line::intersection_infinite`.
fn intersection_infinite(a0: P, a1: P, b0: P, b1: P) -> Option<P> {
    let v12 = ((b0.x - a0.x) as f64, (b0.y - a0.y) as f64);
    let v1 = ((a1.x - a0.x) as f64, (a1.y - a0.y) as f64);
    let v2 = ((b1.x - b0.x) as f64, (b1.y - b0.y) as f64);
    let denom = v1.0 * v2.1 - v1.1 * v2.0;
    if denom.abs() < 1e-4 {
        return None;
    }
    let t1 = (v12.0 * v2.1 - v12.1 * v2.0) / denom;
    let r = (a0.x as f64 + t1 * v1.0, a0.y as f64 + t1 * v1.1);
    let lim = i64::MAX as f64;
    if r.0 > lim || r.0 < -lim || r.1 > lim || r.1 < -lim {
        return None;
    }
    Some(p(r.0 as i64, r.1 as i64))
}

/// `simplify(Polygon&)`: vertices removed where the polygon stays within `allowed_error_distance_squared` of itself
/// and the vertex's segments are short.
fn simplify_polygon(poly: &mut Vec<P>, smallest_line_segment_squared: i64, allowed_error_distance_squared: i64) {
    if poly.len() < 3 {
        poly.clear();
        return;
    }
    if poly.len() == 3 {
        return;
    }
    let mut new_path: Vec<P> = Vec::new();
    let mut previous = *poly.last().unwrap();
    let mut previous_previous = poly[poly.len() - 2];
    let mut current = poly[0];
    let mut accumulated_area_removed = previous.x * current.y - previous.y * current.x;
    for point_idx in 0..poly.len() {
        current = poly[point_idx];
        let next = if point_idx + 1 < poly.len() {
            poly[point_idx + 1]
        } else if point_idx + 1 == poly.len() && new_path.len() > 1 {
            new_path[0]
        } else {
            poly[(point_idx + 1) % poly.len()]
        };
        let removed_area_next = current.x * next.y - current.y * next.x;
        let negative_area_closing = next.x * previous.y - next.y * previous.x;
        accumulated_area_removed += removed_area_next;
        let length2 = (current - previous).sqnorm();
        if length2 < sqr(scaled(0.005)) {
            continue;
        }
        let area_removed_so_far = accumulated_area_removed + negative_area_closing;
        let base_length_2 = (next - previous).sqnorm();
        if base_length_2 == 0 {
            continue;
        }
        let height_2 = (area_removed_so_far as f64 * area_removed_so_far as f64 / base_length_2 as f64) as i64;
        if height_2 <= sqr(COLINEAR_VERTEX_TOLERANCE)
            && dist_to_infinite(current, previous, next) <= COLINEAR_VERTEX_TOLERANCE as f64
        {
            continue;
        }
        if length2 < smallest_line_segment_squared && height_2 <= allowed_error_distance_squared {
            let next_length2 = (current - next).sqnorm();
            if next_length2 > 4 * smallest_line_segment_squared {
                let intersection = intersection_infinite(previous_previous, previous, current, next);
                let ok = match intersection {
                    None => false,
                    Some(ip) => {
                        !(graph_dist_sq(ip, previous, current) > allowed_error_distance_squared as f64
                            || (ip - previous).sqnorm() > smallest_line_segment_squared
                            || (ip - next).sqnorm() > smallest_line_segment_squared)
                    }
                };
                if ok {
                    current = intersection.unwrap();
                    if !new_path.is_empty() {
                        new_path.pop();
                        previous = previous_previous;
                    }
                }
            } else {
                continue;
            }
        }
        accumulated_area_removed = removed_area_next;
        previous_previous = previous;
        previous = current;
        new_path.push(current);
    }
    *poly = new_path;
}

fn sqr(a: i64) -> i64 {
    a * a
}

/// `simplify(Polygons&)`.
fn simplify_polygons(polys: &mut Vec<Vec<P>>, smallest_line_segment: i64, allowed_error_distance: i64) {
    let allowed2 = allowed_error_distance * allowed_error_distance;
    let smallest2 = smallest_line_segment * smallest_line_segment;
    let mut i = 0;
    while i < polys.len() {
        simplify_polygon(&mut polys[i], smallest2, allowed2);
        if polys[i].len() < 3 {
            polys.remove(i);
        } else {
            i += 1;
        }
    }
}

/// `fixSelfIntersections`: points closer than half an epsilon to a segment they aren't on are moved away from it.
fn fix_self_intersections(epsilon: i64, polys: &mut [Vec<P>]) {
    if epsilon < 1 {
        return;
    }
    let half_epsilon = (epsilon + 1) / 2;
    let grid_size = scaled(2.0);
    let mut grid: HashMap<(i64, i64), Vec<(usize, usize)>> = HashMap::new();
    for (pi, poly) in polys.iter().enumerate() {
        for i in 0..poly.len() {
            let a = poly[i];
            let b = poly[(i + 1) % poly.len()];
            let (x0, x1) = (a.x.min(b.x).div_euclid(grid_size), a.x.max(b.x).div_euclid(grid_size));
            let (y0, y1) = (a.y.min(b.y).div_euclid(grid_size), a.y.max(b.y).div_euclid(grid_size));
            for gx in x0..=x1 {
                for gy in y0..=y1 {
                    grid.entry((gx, gy)).or_default().push((pi, i));
                }
            }
        }
    }
    let move_dist = 2i64.max(half_epsilon - 2);
    let half_epsilon_sqrd = half_epsilon * half_epsilon;
    for poly_idx in 0..polys.len() {
        let pathlen = polys[poly_idx].len();
        for point_idx in 0..pathlen {
            let pt = polys[poly_idx][point_idx];
            let (gx0, gx1) = ((pt.x - epsilon).div_euclid(grid_size), (pt.x + epsilon).div_euclid(grid_size));
            let (gy0, gy1) = ((pt.y - epsilon).div_euclid(grid_size), (pt.y + epsilon).div_euclid(grid_size));
            let mut nearby: Vec<(usize, usize)> = Vec::new();
            for gx in gx0..=gx1 {
                for gy in gy0..=gy1 {
                    if let Some(v) = grid.get(&(gx, gy)) {
                        for &s in v {
                            if !nearby.contains(&s) {
                                nearby.push(s);
                            }
                        }
                    }
                }
            }
            for (lpoly, lidx) in nearby {
                let line_next_idx = (lidx + 1) % polys[lpoly].len();
                if poly_idx == lpoly && (point_idx == lidx || point_idx == line_next_idx) {
                    continue;
                }
                let (sa, sb) = (polys[lpoly][lidx], polys[lpoly][line_next_idx]);
                let pt = polys[poly_idx][point_idx];
                let closest = super::graph::closest_on_segment(sa, sb, pt).0;
                if half_epsilon_sqrd >= (pt - closest).sqnorm() {
                    let other = polys[poly_idx][(point_idx + 1) % pathlen];
                    let left = (sb.x - sa.x) * (other.y - sa.y) - (sb.y - sa.y) * (other.x - sa.x);
                    let vec = if left > 0 { sb - sa } else { sa - sb };
                    let len = vec.norm();
                    if len == 0 {
                        continue;
                    }
                    let q = &mut polys[poly_idx][point_idx];
                    q.x += (-vec.y * move_dist) / len;
                    q.y += (vec.x * move_dist) / len;
                }
            }
        }
    }
}

/// `removeDegenerateVerts`: vertices where the outline turns straight back on itself.
fn remove_degenerate_verts(polys: &mut Vec<Vec<P>>) {
    let mut poly_idx = 0;
    while poly_idx < polys.len() {
        let poly = &polys[poly_idx];
        let mut result: Vec<P> = Vec::new();
        let is_degenerate = |last: P, now: P, next: P| {
            let last_line = now - last;
            let next_line = next - now;
            let dot = last_line.x * next_line.x + last_line.y * next_line.y;
            // `dot == -1 * last_line.norm() * next_line.norm()`, the norms int64 as Eigen's integer `norm()` gives.
            dot == -(last_line.norm() * next_line.norm())
        };
        let mut changed = false;
        for idx in 0..poly.len() {
            let last = if result.is_empty() { *poly.last().unwrap() } else { *result.last().unwrap() };
            if idx + 1 == poly.len() && result.is_empty() {
                break;
            }
            let next = if idx + 1 == poly.len() { result[0] } else { poly[idx + 1] };
            if is_degenerate(last, poly[idx], next) {
                changed = true;
                while result.len() > 1 && is_degenerate(result[result.len() - 2], *result.last().unwrap(), next) {
                    result.pop();
                }
            } else {
                result.push(poly[idx]);
            }
        }
        if changed {
            if result.len() > 2 {
                polys[poly_idx] = result;
            } else {
                polys.remove(poly_idx);
                continue;
            }
        }
        poly_idx += 1;
    }
}

fn poly_area(poly: &[P]) -> f64 {
    let n = poly.len();
    let mut a = 0.0;
    for i in 0..n {
        let (p1, p2) = (poly[i], poly[(i + 1) % n]);
        a += p1.x as f64 * p2.y as f64 - p1.y as f64 * p2.x as f64;
    }
    a * 0.5
}

/// `removeSmallAreas` with `remove_holes` false: outlines under `min_area_size`, and the small holes inside them.
fn remove_small_areas(polys: &mut Vec<Vec<P>>, min_area_size: f64) {
    // Orca moves the small outlines to the end of the vector (swapping) and keeps what is left in that order.
    let mut new_end = polys.len();
    let mut small_holes: Vec<Vec<P>> = Vec::new();
    let mut it = 0;
    while it < new_end {
        let area = poly_area(&polys[it]);
        if area.abs() < min_area_size {
            if area >= 0.0 {
                new_end -= 1;
                if it < new_end {
                    polys.swap(new_end, it);
                    continue;
                } else {
                    break;
                }
            } else {
                small_holes.push(polys[it].clone());
            }
        }
        it += 1;
    }
    let removed_outlines_start = new_end;
    for hole in small_holes.iter().rev() {
        for oi in removed_outlines_start..polys.len() {
            if point_in_polygon(&polys[oi], hole[0]) {
                new_end -= 1;
                // `*hole_it = std::move(*new_end)`: a moved-from hole; what matters is what stays in front of
                // `new_end`, which loses its last polygon in place of the hole's: replicate by swapping the hole
                // out of the kept range.
                if let Some(pos) = polys[..new_end + 1].iter().position(|q| q == hole) {
                    polys.swap(pos, new_end);
                }
                break;
            }
        }
    }
    polys.truncate(new_end);
}

fn point_in_polygon(poly: &[P], q: P) -> bool {
    let mut inside = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a.y > q.y) != (b.y > q.y)
            && (q.x as f64) < (b.x - a.x) as f64 * (q.y - a.y) as f64 / (b.y - a.y) as f64 + a.x as f64
        {
            inside = !inside;
        }
        j = i;
    }
    inside
}

/// `LinearAlg2D::getAngleLeft`.
fn angle_left(a: P, b: P, c: P) -> f32 {
    let ba = a - b;
    let bc = c - b;
    let dott = ba.x * bc.x + ba.y * bc.y;
    let det = cross(ba, bc);
    if det == 0 {
        if (ba.x != 0 && (ba.x > 0) == (bc.x > 0)) || (ba.x == 0 && (ba.y > 0) == (bc.y > 0)) {
            return 0.0;
        } else {
            return std::f32::consts::PI;
        }
    }
    let angle = -libm::atan2(det as f64, dott as f64) as f32;
    if angle >= 0.0 { angle } else { (std::f64::consts::PI * 2.0 + angle as f64) as f32 }
}

/// `removeColinearEdges(Polygon&, max_deviation_angle)`.
fn remove_colinear_edges_poly(poly: &mut Vec<P>, max_deviation_angle: f64) {
    loop {
        let mut num_removed_in_iteration = 0usize;
        let mut process_indices = vec![true; poly.len()];
        let mut go = true;
        while go {
            go = false;
            let pathlen = poly.len();
            if pathlen <= 3 {
                return;
            }
            let mut skip_indices = vec![false; poly.len()];
            let mut new_path: Vec<P> = Vec::new();
            let mut point_idx = 0;
            while point_idx < pathlen {
                if !process_indices[point_idx] {
                    new_path.push(poly[point_idx]);
                    point_idx += 1;
                    continue;
                }
                if point_idx == pathlen - 1 && skip_indices[0] {
                    skip_indices[new_path.len()] = true;
                    go = true;
                    new_path.push(poly[point_idx]);
                    break;
                }
                let prev = poly[(point_idx + pathlen - 1) % pathlen];
                let pt = poly[point_idx];
                let next = poly[(point_idx + 1) % pathlen];
                let mut angle = angle_left(prev, pt, next);
                if angle >= std::f32::consts::PI {
                    angle -= std::f32::consts::PI;
                }
                if angle as f64 > max_deviation_angle && (angle as f64) < std::f64::consts::PI - max_deviation_angle {
                    new_path.push(pt);
                } else if point_idx != pathlen - 1 {
                    skip_indices[new_path.len()] = true;
                    go = true;
                    new_path.push(next);
                    point_idx += 1;
                }
                point_idx += 1;
            }
            num_removed_in_iteration += pathlen - new_path.len();
            *poly = new_path;
            process_indices = skip_indices;
        }
        if num_removed_in_iteration == 0 {
            break;
        }
    }
}

fn remove_colinear_edges(polys: &mut Vec<Vec<P>>, max_deviation_angle: f64) {
    let mut i = 0;
    while i < polys.len() {
        remove_colinear_edges_poly(&mut polys[i], max_deviation_angle);
        if polys[i].len() < 3 {
            polys.remove(i);
        } else {
            i += 1;
        }
    }
}

/// A shape's contours as nanometre polygons.
fn to_polys(shapes: &Shapes) -> Vec<Vec<P>> {
    shapes.iter().flatten().map(|c| c.iter().map(|q| p(q.x as i64 * 100, q.y as i64 * 100)).collect()).collect()
}

fn from_polys(polys: &[Vec<P>]) -> Vec<geom::Contour> {
    polys
        .iter()
        .map(|c| {
            c.iter()
                .map(|q| geom::pt((q.x as f64 / 100.0).round() as i32, (q.y as f64 / 100.0).round() as i32))
                .collect()
        })
        .collect()
}

/// `shorterThan`: whether the closed polygon of the line's points is shorter than `check_length`.
fn shorter_than(line: &ExtrusionLine, check_length: i64) -> bool {
    let Some(last) = line.junctions.last() else { return true };
    let mut p0 = last.p;
    let mut length = 0i64;
    for j in &line.junctions {
        length += (p0 - j.p).norm();
        if length >= check_length {
            return false;
        }
        p0 = j.p;
    }
    true
}

fn polyline_length(line: &ExtrusionLine) -> i64 {
    if line.junctions.is_empty() {
        return 0;
    }
    let mut len = 0;
    let mut prev = line.junctions[0].p;
    for j in &line.junctions {
        len += (j.p - prev).norm();
        prev = j.p;
    }
    if line.is_closed {
        len += (line.junctions[0].p - line.junctions.last().unwrap().p).norm();
    }
    len
}

/// `PolylineStitcher::stitch` for variable-width lines: lines whose ends come within `max_stitch_distance` joined
/// into longer lines and closed polygons. Orca finds ends through a hash grid; this scans them in insertion order,
/// which is the same where no two ends tie.
fn stitch(
    lines: &[ExtrusionLine],
    max_stitch_distance: i64,
    snap_distance: i64,
) -> (Vec<ExtrusionLine>, Vec<ExtrusionLine>) {
    let mut result_lines: Vec<ExtrusionLine> = Vec::new();
    let mut result_polygons: Vec<ExtrusionLine> = Vec::new();
    if lines.is_empty() {
        return (result_lines, result_polygons);
    }
    // Each line's first and last point, in Orca's insertion order.
    let mut ends: Vec<(usize, usize)> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        ends.push((i, 0));
        ends.push((i, l.junctions.len() - 1));
    }
    let mut processed = vec![false; lines.len()];
    for line_idx in 0..lines.len() {
        if processed[line_idx] {
            continue;
        }
        processed[line_idx] = true;
        let line = &lines[line_idx];
        let mut should_close = line.is_odd;
        let mut chain = line.clone();
        let mut closest_is_closing_polygon = false;
        for go_in_reverse_direction in [false, true] {
            if go_in_reverse_direction {
                chain.junctions.reverse();
            }
            let mut chain_length = polyline_length(&chain);
            loop {
                let from = chain.junctions.last().unwrap().p;
                let mut closest: Option<(usize, usize)> = None;
                let mut closest_distance = i64::MAX;
                for &(poly_idx, point_idx) in &ends {
                    let nearby_p = lines[poly_idx].junctions[point_idx].p;
                    let mut is_closing_segment = false;
                    let mut dist = (nearby_p - from).norm();
                    if dist > max_stitch_distance {
                        continue;
                    }
                    if (nearby_p - chain.junctions[0].p).sqnorm() < snap_distance * snap_distance {
                        if chain_length + dist < 3 * max_stitch_distance || chain.junctions.len() <= 2 {
                            continue;
                        }
                        is_closing_segment = true;
                        if !should_close {
                            dist += scaled(0.01);
                        } else {
                            dist -= scaled(0.01);
                        }
                    } else if processed[poly_idx] {
                        continue;
                    }
                    let mut nearby_would_be_reversed = point_idx != 0;
                    nearby_would_be_reversed = nearby_would_be_reversed != go_in_reverse_direction;
                    if !lines[poly_idx].is_odd && nearby_would_be_reversed {
                        continue;
                    }
                    if chain.is_odd != lines[poly_idx].is_odd {
                        continue;
                    }
                    if dist < closest_distance {
                        closest_distance = dist;
                        closest = Some((poly_idx, point_idx));
                        closest_is_closing_polygon = is_closing_segment;
                    }
                    if dist < snap_distance {
                        break;
                    }
                }
                let Some((cpoly, cpoint)) = closest else { break };
                if closest_is_closing_polygon {
                    break;
                }
                let segment_dist = (chain.junctions.last().unwrap().p - lines[cpoly].junctions[cpoint].p).norm();
                let old_size = chain.junctions.len();
                let skip = usize::from(segment_dist < snap_distance);
                if cpoint == 0 {
                    chain.junctions.extend(lines[cpoly].junctions.iter().skip(skip).copied());
                } else {
                    chain.junctions.extend(lines[cpoly].junctions.iter().rev().skip(skip).copied());
                }
                for i in old_size..chain.junctions.len() {
                    chain_length += (chain.junctions[i].p - chain.junctions[i - 1].p).norm();
                }
                should_close = should_close && !lines[cpoly].is_odd;
                processed[cpoly] = true;
            }
            if closest_is_closing_polygon {
                if go_in_reverse_direction {
                    chain.junctions.reverse();
                }
                break;
            }
        }
        if closest_is_closing_polygon {
            result_polygons.push(chain);
        } else {
            if !lines[line_idx].is_odd {
                chain.junctions.reverse();
            }
            result_lines.push(chain);
        }
    }
    (result_lines, result_polygons)
}

/// `stitchToolPaths`.
fn stitch_tool_paths(toolpaths: &mut [Vec<ExtrusionLine>], bead_width_x: i64) {
    let stitch_distance = bead_width_x - 1;
    for wall_lines in toolpaths.iter_mut() {
        let (stitched, closed) = stitch(wall_lines, stitch_distance, scaled(0.01));
        *wall_lines = stitched;
        for mut polygon in closed {
            if polygon.junctions.is_empty() {
                continue;
            }
            let (front, back) = (polygon.junctions[0], *polygon.junctions.last().unwrap());
            if front.p != back.p && ((back.p - front.p).sqnorm() as f64).sqrt() < stitch_distance as f64 {
                polygon.junctions.push(front);
            }
            polygon.is_closed = true;
            wall_lines.push(polygon);
        }
    }
}

/// `removeSmallLines`.
fn remove_small_lines(toolpaths: &mut [Vec<ExtrusionLine>], params: &WallParams) {
    for inset in toolpaths.iter_mut() {
        let mut line_idx = 0;
        while line_idx < inset.len() {
            let line = &inset[line_idx];
            let min_width = line.junctions.iter().map(|j| j.w).min().unwrap_or(i64::MAX);
            let check = if params.is_top_or_bottom_layer {
                min_width / 2
            } else {
                (min_width as f32 * params.min_length_factor) as i64
            };
            if line.is_odd && !line.is_closed && shorter_than(line, check) {
                let last = inset.pop().unwrap();
                if line_idx < inset.len() {
                    inset[line_idx] = last;
                }
            } else {
                line_idx += 1;
            }
        }
    }
}

/// `ExtrusionLine::calculateExtrusionAreaDeviationError`.
fn extrusion_area_deviation_error(a: ExtrusionJunction, b: ExtrusionJunction, c: ExtrusionJunction) -> i64 {
    let ab_length = (b.p - a.p).norm();
    let bc_length = (c.p - b.p).norm();
    let width_diff = (b.w - a.w).abs().max((c.w - b.w).abs());
    if width_diff > 1 {
        let ab_weight = (a.w + b.w) / 2;
        let bc_weight = (b.w + c.w) / 2;
        let weighted_average_width = (ab_length * ab_weight + bc_length * bc_weight) / (ab_length + bc_length);
        let ac_length = (c.p - a.p).norm();
        ((ab_weight * ab_length + bc_weight * bc_length) - (weighted_average_width * ac_length)).abs()
    } else if ab_length > bc_length {
        width_diff * bc_length
    } else {
        width_diff * ab_length
    }
}

/// `ExtrusionLine::simplify`.
fn simplify_line(
    line: &mut ExtrusionLine,
    smallest_line_segment_squared: i64,
    allowed_error_distance_squared: i64,
    maximum_extrusion_area_deviation: i64,
) {
    let min_path_size = if line.is_closed { 3 } else { 2 };
    if line.junctions.len() <= min_path_size {
        return;
    }
    let junctions = line.junctions.clone();
    let mut new_junctions: Vec<ExtrusionJunction> = vec![junctions[0]];
    let mut previous = junctions[0];
    let mut previous_previous = if line.is_closed { junctions[junctions.len() - 2] } else { junctions[0] };
    let initial = junctions[1];
    let mut accumulated_area_removed = previous.p.x * initial.p.y - previous.p.y * initial.p.x;
    let end = junctions.len() - if line.is_closed { 0 } else { 1 };
    let mut point_idx = 1;
    while point_idx < end {
        let is_last = point_idx + 1 == junctions.len();
        let current = if is_last { new_junctions[0] } else { junctions[point_idx] };
        if line.is_closed && new_junctions.len() + (junctions.len() - point_idx) <= 3 {
            new_junctions.push(current);
            point_idx += 1;
            continue;
        }
        let spill_over =
            line.is_closed && point_idx + 2 >= junctions.len() && point_idx + 2 - junctions.len() < new_junctions.len();
        let next = if spill_over { new_junctions[point_idx + 2 - junctions.len()] } else { junctions[point_idx + 1] };
        let removed_area_next = current.p.x * next.p.y - current.p.y * next.p.x;
        let negative_area_closing = next.p.x * previous.p.y - next.p.y * previous.p.x;
        accumulated_area_removed += removed_area_next;
        let length2 = (current.p - previous.p).sqnorm();
        if length2 < sqr(scaled(0.005)) {
            point_idx += 1;
            continue;
        }
        let area_removed_so_far = accumulated_area_removed + negative_area_closing;
        let base_length_2 = (next.p - previous.p).sqnorm();
        if base_length_2 == 0 {
            point_idx += 1;
            continue;
        }
        let height_2 = (area_removed_so_far as f64 * area_removed_so_far as f64 / base_length_2 as f64) as i64;
        let extrusion_area_error = extrusion_area_deviation_error(previous, current, next);
        if height_2 <= sqr(COLINEAR_VERTEX_TOLERANCE)
            && dist_to_infinite(current.p, previous.p, next.p) <= COLINEAR_VERTEX_TOLERANCE as f64
            && extrusion_area_error <= maximum_extrusion_area_deviation
        {
            point_idx += 1;
            continue;
        }
        if length2 < smallest_line_segment_squared && height_2 <= allowed_error_distance_squared {
            let next_length2 = (current.p - next.p).sqnorm();
            if next_length2 > 4 * smallest_line_segment_squared {
                let intersection = intersection_infinite(previous_previous.p, previous.p, current.p, next.p);
                let dist_greater = |p1: P, p2: P, threshold: i64| {
                    let (vx, vy) = ((p1.x - p2.x).unsigned_abs(), (p1.y - p2.y).unsigned_abs());
                    let t = threshold as u64;
                    if vx > t || vy > t {
                        return true;
                    }
                    vx.wrapping_mul(vx).wrapping_add(vy.wrapping_mul(vy)) > t
                };
                let use_it = intersection.filter(|&ip| {
                    !(graph_dist_sq(ip, previous.p, current.p) > allowed_error_distance_squared as f64
                        || dist_greater(ip, previous.p, smallest_line_segment_squared)
                        || dist_greater(ip, current.p, smallest_line_segment_squared))
                });
                if let Some(ip) = use_it {
                    let new_to_add =
                        ExtrusionJunction { p: ip, w: current.w, perimeter_index: current.perimeter_index };
                    if !new_junctions.is_empty() {
                        new_junctions.pop();
                        previous = previous_previous;
                    }
                    accumulated_area_removed = removed_area_next;
                    previous_previous = previous;
                    previous = new_to_add;
                    new_junctions.push(new_to_add);
                    point_idx += 1;
                    continue;
                }
            } else {
                point_idx += 1;
                continue;
            }
        }
        accumulated_area_removed = removed_area_next;
        previous_previous = previous;
        previous = current;
        new_junctions.push(current);
        point_idx += 1;
    }
    if line.is_closed {
        let back = new_junctions.last().unwrap().p;
        new_junctions[0].p = back;
    } else {
        new_junctions.push(*junctions.last().unwrap());
    }
    line.junctions = new_junctions;
}

impl WallToolPaths {
    /// `WallToolPaths::generate`: `outline`'s walls, `inset_count` deep, beads `bead_width_0` wide on the outside and
    /// `bead_width_x` inside (spacings, nanometres), the outer wall `wall_0_inset` further in, layers `layer_height`
    /// mm thick; `min_nozzle` is nothing here, the widths in `params` are already in millimetres.
    #[allow(clippy::too_many_arguments)]
    pub fn generate(
        outline: &Shapes,
        bead_width_0: i64,
        bead_width_x: i64,
        inset_count: usize,
        wall_0_inset: i64,
        layer_height: f64,
        params: &WallParams,
    ) -> WallToolPaths {
        let mut out = WallToolPaths::default();
        if inset_count < 1 {
            return out;
        }
        let min_feature_size = scaled(params.min_feature_size);
        let min_bead_width = scaled(params.min_bead_width);
        let small_area_length = bead_width_0 as f64 / 2.0;
        let wall_transition_filter_deviation = scaled(params.wall_transition_filter_deviation);
        let smallest_segment = params.wall_maximum_resolution;
        let allowed_distance = params.wall_maximum_deviation;
        let epsilon_offset = (allowed_distance / 2) - 1;
        let transitioning_angle = params.wall_transition_angle.to_radians();
        let discretization_step_size = scaled(0.8);

        let eps_mm = epsilon_offset as f64 / 1e6;
        let miter = Join::Miter(3.0);
        let shrunk = geom::offset_c2(outline, -eps_mm, miter);
        let grown = geom::offset_c2(&shrunk, eps_mm * 2.0, miter);
        let prepared = geom::offset_c2(&grown, -eps_mm, miter);
        let mut prepared_outline = to_polys(&prepared);
        simplify_polygons(&mut prepared_outline, smallest_segment, allowed_distance);
        fix_self_intersections(epsilon_offset, &mut prepared_outline);
        remove_degenerate_verts(&mut prepared_outline);
        remove_colinear_edges(&mut prepared_outline, 0.005);
        fix_self_intersections(epsilon_offset, &mut prepared_outline);
        remove_degenerate_verts(&mut prepared_outline);
        remove_small_areas(&mut prepared_outline, small_area_length * small_area_length);
        let unioned = geom::union_nonzero(&from_polys(&prepared_outline));
        if geom::area_mm2(&unioned) <= 0.0 {
            return out;
        }
        let prepared_outline = to_polys(&unioned);

        let external_width =
            rounded_rectangle_extrusion_width_from_spacing(bead_width_0 as f32 / 1e6, layer_height as f32);
        let internal_width =
            rounded_rectangle_extrusion_width_from_spacing(bead_width_x as f32 / 1e6, layer_height as f32);
        let wall_transition_length = scaled(params.wall_transition_length);
        let wall_split_middle_threshold =
            (2.0 * (min_bead_width as f64 / 1e6) / external_width as f64 - 1.0).clamp(0.01, 0.99);
        let wall_add_middle_threshold = ((min_bead_width as f64 / 1e6) / internal_width as f64).clamp(0.01, 0.99);
        let max_bead_count = 2 * inset_count as i64;
        let strategy = make_strategy(&Params {
            preferred_bead_width_outer: bead_width_0,
            preferred_bead_width_inner: bead_width_x,
            preferred_transition_length: wall_transition_length,
            transitioning_angle: transitioning_angle as f32,
            print_thin_walls: true,
            min_bead_width,
            min_feature_size,
            wall_split_middle_threshold,
            wall_add_middle_threshold,
            max_bead_count,
            outer_wall_offset: wall_0_inset,
            inward_distributed_center_wall_count: params.wall_distribution_count,
            minimum_variable_line_ratio: 0.5,
        });
        let Some(mut wall_maker) = Trapezoidation::new(
            &prepared_outline,
            strategy.as_ref(),
            strategy.get_transitioning_angle(),
            discretization_step_size,
            scaled(100.0),
            wall_transition_filter_deviation,
            wall_transition_length,
        ) else {
            return out;
        };
        let mut toolpaths = wall_maker.generate_toolpaths(false);
        stitch_tool_paths(&mut toolpaths, bead_width_x);
        remove_small_lines(&mut toolpaths, params);
        let inner_contour = separate_out_inner_contour(&mut toolpaths);
        let smallest2 = params.wall_maximum_resolution * params.wall_maximum_resolution;
        let allowed2 = params.wall_maximum_deviation * params.wall_maximum_deviation;
        for lines in toolpaths.iter_mut() {
            for line in lines.iter_mut() {
                simplify_line(line, smallest2, allowed2, MESHFIX_MAXIMUM_EXTRUSION_AREA_DEVIATION);
            }
        }
        toolpaths.retain(|l| !l.is_empty());
        out.toolpaths = toolpaths;
        out.inner_contour = inner_contour;
        out
    }
}

/// `separateOutInnerContour`: the insets of zero width (the limited strategy's marker) leave the toolpaths and
/// their closed even lines make the inner contour, as the region the walls leave.
fn separate_out_inner_contour(toolpaths: &mut Vec<Vec<ExtrusionLine>>) -> Shapes {
    let mut actual: Vec<Vec<ExtrusionLine>> = Vec::new();
    let mut contour: Vec<Vec<P>> = Vec::new();
    for inset in toolpaths.iter() {
        if inset.is_empty() {
            continue;
        }
        let mut is_contour = false;
        for line in inset {
            if let Some(j) = line.junctions.first() {
                is_contour = j.w == 0;
            }
        }
        if is_contour {
            for line in inset {
                if line.is_odd {
                    continue;
                } else if line.is_closed {
                    contour.push(line.junctions.iter().map(|j| j.p).collect());
                }
            }
        } else {
            actual.push(inset.clone());
        }
    }
    *toolpaths = actual;
    // `union_(inner_contour, pftEvenOdd)`.
    let paths = from_polys(&contour);
    if paths.is_empty() {
        return Vec::new();
    }
    paths.simplify(FillRule::EvenOdd, IntOverlayOptions::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn app_params() -> WallParams {
        // The app's setup for the 0.4 mm nozzle: min_feature_size 25 %, min_bead_width 85 %, transition length
        // 100 %, filter deviation 25 %, transition angle 10°, wall_maximum_resolution 0.5, deviation 0.025.
        WallParams {
            min_feature_size: 0.25 * 0.4,
            min_length_factor: 0.5,
            min_bead_width: 0.85 * 0.4,
            wall_transition_filter_deviation: 0.25 * 0.4,
            wall_transition_length: 0.4,
            wall_transition_angle: 10.0,
            wall_distribution_count: 1,
            is_top_or_bottom_layer: false,
            wall_maximum_resolution: scaled(0.5),
            wall_maximum_deviation: scaled(0.025),
        }
    }

    fn rect(w: f64, h: f64) -> Shapes {
        let (w, h) = (geom::sc(w), geom::sc(h));
        vec![vec![vec![geom::pt(0, 0), geom::pt(w, 0), geom::pt(w, h), geom::pt(0, h)]]]
    }

    fn generate(outline: &Shapes, walls: usize) -> WallToolPaths {
        WallToolPaths::generate(outline, scaled(0.42), scaled(0.45), walls, 0, 0.2, &app_params())
    }

    #[test]
    fn a_wide_plate_gets_closed_walls_and_an_inner_contour() {
        let t = generate(&rect(20.0, 10.0), 2);
        assert_eq!(t.toolpaths.len(), 2);
        for lines in &t.toolpaths {
            assert_eq!(lines.len(), 1);
            assert!(lines[0].is_closed && !lines[0].is_odd);
        }
        // The walls' beads run 0.21 and 0.21 + 0.435 mm in from the edge; the contour is what they leave.
        let a = geom::area_mm2(&t.inner_contour);
        let inset = 0.21 + 0.435 + 0.45 / 2.0;
        let expect = (20.0 - 2.0 * inset) * (10.0 - 2.0 * inset);
        assert!((a - expect).abs() < 0.02 * expect, "{a} vs {expect}");
    }

    #[test]
    fn a_thin_plate_gets_an_odd_middle_bead() {
        let t = generate(&rect(20.0, 1.2), 2);
        let odd: Vec<_> = t.toolpaths.iter().flatten().filter(|l| l.is_odd).collect();
        assert_eq!(odd.len(), 1);
        assert!(odd[0].junctions.len() >= 2);
        let even_closed = t.toolpaths.iter().flatten().filter(|l| !l.is_odd && l.is_closed).count();
        assert_eq!(even_closed, 1);
    }

    #[test]
    fn a_sliver_gets_one_widened_bead() {
        let t = generate(&rect(20.0, 0.3), 2);
        let lines: Vec<_> = t.toolpaths.iter().flatten().collect();
        assert_eq!(lines.len(), 1);
        assert!(lines[0].junctions.iter().all(|j| j.w >= scaled(0.34)));
    }

    #[test]
    fn a_ring_gets_a_wall_round_each_edge() {
        let (o, i) = (geom::sc(10.0), geom::sc(5.0));
        let outer = vec![geom::pt(-o, -o), geom::pt(o, -o), geom::pt(o, o), geom::pt(-o, o)];
        let hole = vec![geom::pt(-i, -i), geom::pt(-i, i), geom::pt(i, i), geom::pt(i, -i)];
        let t = generate(&vec![vec![outer, hole]], 2);
        assert_eq!(t.toolpaths.len(), 2);
        assert_eq!(t.toolpaths[0].len(), 2);
        assert!(t.toolpaths[0].iter().all(|l| l.is_closed));
        assert_eq!(t.inner_contour.len(), 1);
    }
}

/// Prints the walls of a shape (a JSON list of contours in mm: `[[[x, y], …], …]`, counter-clockwise outlines and
/// clockwise holes) in the app's setup, as `inset odd closed` and then `x y width` for each junction: for comparing
/// with native Orca's G-code (`bench/arachne.py`). Ignored: it takes the shape from `ARACHNE_SHAPE`.
#[cfg(test)]
mod dump {
    use super::*;

    #[test]
    #[ignore]
    fn dump_walls() {
        let path = std::env::var("ARACHNE_SHAPE").expect("ARACHNE_SHAPE");
        let walls: usize = std::env::var("ARACHNE_WALLS").ok().and_then(|w| w.parse().ok()).unwrap_or(2);
        let text = std::fs::read_to_string(path).unwrap();
        // Contours are separated by a line each in the file: read them as lines of "x y x y …".
        let contours: Vec<geom::Contour> = text
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| {
                let v: Vec<f64> = l.split_whitespace().filter_map(|t| t.parse().ok()).collect();
                v.chunks(2).map(|c| geom::pt(geom::sc(c[0]), geom::sc(c[1]))).collect()
            })
            .collect();
        let outline: Shapes = vec![contours];
        let params = WallParams {
            min_feature_size: 0.25 * 0.4,
            min_length_factor: 0.5,
            min_bead_width: 0.85 * 0.4,
            wall_transition_filter_deviation: 0.25 * 0.4,
            wall_transition_length: 0.4,
            wall_transition_angle: 10.0,
            wall_distribution_count: 1,
            is_top_or_bottom_layer: false,
            wall_maximum_resolution: scaled(0.5),
            wall_maximum_deviation: scaled(0.025),
        };
        let t = WallToolPaths::generate(&outline, scaled(0.42), scaled(0.45), walls, 0, 0.2, &params);
        for l in t.toolpaths.iter().flatten() {
            println!("line {} {} {}", l.inset_idx, l.is_odd as u8, l.is_closed as u8);
            for j in &l.junctions {
                println!("{:.4} {:.4} {:.4}", j.p.x as f64 / 1e6, j.p.y as f64 / 1e6, j.w as f64 / 1e6);
            }
        }
    }
}
