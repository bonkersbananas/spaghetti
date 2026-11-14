//! Orca 2.5's arc fitting (`ArcFitter` with its `Circle` and `ArcSegment`, after ArcWelder), in Orca's nanometres:
//! which runs of a path's points lie on one circle, to be written as `G2`/`G3`, and the points Orca keeps of the path
//! then (`do_arc_fitting_and_simplify`: Douglas–Peucker within each run, arcs included). Orca's prime tower draws its
//! walls and its brim this way when the process fits arcs, and takes its place on the plate from what's left of its
//! first layer's wall.

use std::f64::consts::PI;

/// A point in nanometres, as Orca's `Point`.
pub type P = [i64; 2];

/// `scale_(2000)`: a circle of a larger radius is a line.
const MAX_RADIUS: f64 = 2000.0 / 1e-6;
/// `DEFAULT_ARC_LENGTH_PERCENT_TOLERANCE`: how far an arc's length may be off the points' path.
const LENGTH_TOLERANCE: f64 = 0.05;
/// `scale_(scale_(Parallel_area_threshold))`: three points this close to a line (twice their triangle's area) make
/// no circle.
const PARALLEL_AREA: f64 = 0.0001 / 1e-6 / 1e-6;
/// `SCALED_EPSILON`, `EPSILON` and `Circle`'s `ZERO_TOLERANCE`.
const SCALED_EPSILON: f64 = 1e-4 / 1e-6;
const EPSILON: f64 = 1e-4;
const ZERO_TOLERANCE: f64 = 0.000005;

/// An arc from `start` to `end` round `center` (`ArcSegment`): `angle` is negative for one clockwise, and the polar
/// angles are in [0, 2π).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Arc {
    pub center: P,
    pub radius: f64,
    pub start: P,
    pub end: P,
    pub ccw: bool,
    pub length: f64,
    pub angle: f64,
    pub start_theta: f64,
    pub end_theta: f64,
}

/// A run of a path's points, `start` to `end` (indexes), as a line through them or as one arc (`PathFittingData`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Run {
    pub start: usize,
    pub end: usize,
    pub arc: Option<Arc>,
}

#[derive(Clone, Copy, Default)]
struct Circle {
    center: P,
    radius: f64,
}

fn is_equal(x: f64, y: f64) -> bool {
    (x - y).abs() < ZERO_TOLERANCE
}

fn norm(dx: f64, dy: f64) -> f64 {
    (dx * dx + dy * dy).sqrt()
}

/// `Circle::try_create_circle` through three points.
fn circle3(p1: P, p2: P, p3: P) -> Option<Circle> {
    let (x1, y1) = (p1[0] as f64, p1[1] as f64);
    let (x2, y2) = (p2[0] as f64, p2[1] as f64);
    let (x3, y3) = (p3[0] as f64, p3[1] as f64);
    if ((y1 - y2) * (x1 - x3) - (y1 - y3) * (x1 - x2)).abs() <= PARALLEL_AREA {
        return None;
    }
    let a = x1 * (y2 - y3) - y1 * (x2 - x3) + x2 * y3 - x3 * y2;
    if a.abs() < SCALED_EPSILON {
        return None;
    }
    let b = (x1 * x1 + y1 * y1) * (y3 - y2) + (x2 * x2 + y2 * y2) * (y1 - y3) + (x3 * x3 + y3 * y3) * (y2 - y1);
    let c = (x1 * x1 + y1 * y1) * (x2 - x3) + (x2 * x2 + y2 * y2) * (x3 - x1) + (x3 * x3 + y3 * y3) * (x1 - x2);
    let (cx, cy) = (-b / (2.0 * a), -c / (2.0 * a));
    let radius = norm(cx - x1, cy - y1);
    if radius > MAX_RADIUS {
        return None;
    }
    Some(Circle { center: [cx.round() as i64, cy.round() as i64], radius })
}

impl Circle {
    fn distance(&self, p: P) -> f64 {
        norm(p[0].wrapping_sub(self.center[0]) as f64, p[1].wrapping_sub(self.center[1]) as f64)
    }

    /// `get_polar_radians`, in [0, 2π).
    fn polar(&self, p: P) -> f64 {
        // The `libm` crate's, as WebAssembly's, so that native and WebAssembly agree to the last bit.
        let a = libm::atan2((p[1] - self.center[1]) as f64, (p[0] - self.center[0]) as f64);
        if a < 0.0 { 2.0 * PI + a } else { a }
    }

    /// `is_over_deviation`: whether a point, or a segment's point nearest the centre, is off the circle by more than
    /// `tolerance`.
    fn over_deviation(&self, points: &[P], tolerance: f64) -> bool {
        for index in 0..points.len() - 1 {
            if index != 0 && (self.distance(points[index]) - self.radius).abs() > tolerance {
                return true;
            }
            if let Some(q) = closest_perpendicular(points[index], points[index + 1], self.center)
                && (self.distance(q) - self.radius).abs() > tolerance
            {
                return true;
            }
        }
        false
    }

    /// `get_deviation_sum_squared`: the points' squared deviations summed, unless one is off by more than `tolerance`.
    fn deviation_sum_squared(&self, points: &[P], tolerance: f64) -> Option<f64> {
        let mut total = 0.0;
        for &p in &points[1..points.len() - 1] {
            let deviation = (self.distance(p) - self.radius).abs();
            total += deviation * deviation;
            if deviation > tolerance {
                return None;
            }
        }
        for index in 0..points.len() - 1 {
            if let Some(q) = closest_perpendicular(points[index], points[index + 1], self.center) {
                let deviation = (self.distance(q) - self.radius).abs();
                total += deviation * deviation;
                if deviation > tolerance {
                    return None;
                }
            }
        }
        Some(total)
    }
}

/// `get_closest_perpendicular_point`: the foot of the perpendicular from `c` to the segment, unless it falls at or
/// beyond an end (truncated to whole nanometres, as Orca assigns it to a `Point`). A segment of no length gives no
/// number, which x86 turns into the least integer: a point no circle passes near.
fn closest_perpendicular(p1: P, p2: P, c: P) -> Option<P> {
    let (x1, y1, x2, y2) = (p1[0] as f64, p1[1] as f64, p2[0] as f64, p2[1] as f64);
    let (xd, yd) = (x2 - x1, y2 - y1);
    let t = ((c[0] as f64 - x1) * xd + (c[1] as f64 - y1) * yd) / (xd * xd + yd * yd);
    if t.is_nan() {
        return Some([i64::MIN, i64::MIN]);
    }
    if t < 0.0 || is_equal(t, 0.0) || t > 1.0 || is_equal(t, 1.0) {
        return None;
    }
    Some([(x1 + t * (x2 - x1)) as i64, (y1 + t * (y2 - y1)) as i64])
}

/// `Circle::try_create_circle` through a run of points: through its ends and its middle, else the one through its
/// ends and another of its points that deviates least.
fn circle_through(points: &[P], tolerance: f64) -> Option<Circle> {
    let count = points.len();
    let middle = count / 2;
    if count == 3 {
        return circle3(points[0], points[middle], points[count - 1]).filter(|c| !c.over_deviation(points, tolerance));
    }
    let (a, b) = if count.is_multiple_of(2) {
        (points[middle], points[middle - 1])
    } else {
        (points[middle - 1], points[middle + 1])
    };
    let mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if let Some(c) = circle3(points[0], mid, points[count - 1])
        && !c.over_deviation(points, tolerance)
    {
        return Some(c);
    }
    let mut best: Option<(f64, Circle)> = None;
    for (index, &p) in points.iter().enumerate().take(count - 1).skip(1) {
        if index == middle {
            continue;
        }
        let Some(c) = circle3(points[0], p, points[count - 1]) else { continue };
        if let Some(deviation) = c.deviation_sum_squared(points, tolerance)
            && best.is_none_or(|(least, _)| deviation < least)
        {
            best = Some((deviation, c));
        }
    }
    best.map(|(_, c)| c)
}

/// `ArcSegment::try_create_arc` on a circle: the arc from `start` past `mid` to `end`, if its length is within 5 % of
/// the points' path (or the other way round the circle's is).
fn arc_on(c: Circle, start: P, mid: P, end: P, approximate_length: f64) -> Option<Arc> {
    let (ps, pm, pe) = (c.polar(start), c.polar(mid), c.polar(end));
    let mut found = None;
    if pe > ps {
        if ps < pm && pm < pe {
            found = Some((true, pe - ps));
        } else if (0.0 <= pm && pm < ps) || (pe < pm && pm < 2.0 * PI) {
            found = Some((false, ps + (2.0 * PI - pe)));
        }
    } else if ps > pe {
        if (ps < pm && pm < 2.0 * PI) || (0.0 < pm && pm < pe) {
            found = Some((true, pe + (2.0 * PI - ps)));
        } else if pe < pm && pm < ps {
            found = Some((false, ps - pe));
        }
    }
    let (mut ccw, mut angle) = found?;
    if angle.abs() < EPSILON {
        return None;
    }
    let mut length = c.radius * angle;
    if ((length - approximate_length) / approximate_length).abs() >= LENGTH_TOLERANCE {
        // The other way round the circle, keeping the angle (as Orca does).
        let other = c.radius * (angle - 2.0 * PI).abs();
        if ((other - approximate_length) / approximate_length).abs() >= LENGTH_TOLERANCE {
            return None;
        }
        length = other;
        ccw = !ccw;
    }
    if !ccw {
        angle = -angle;
    }
    Some(Arc { center: c.center, radius: c.radius, start, end, ccw, length, angle, start_theta: ps, end_theta: pe })
}

/// `ArcSegment::ray_intersects_segment`.
fn ray_hits_segment(origin: P, dir: [f64; 2], a: P, b: P) -> bool {
    let v1 = [(origin[0] - a[0]) as f64, (origin[1] - a[1]) as f64];
    let v2 = [(b[0] - a[0]) as f64, (b[1] - a[1]) as f64];
    let v3 = [-dir[1], dir[0]];
    let dot = v2[0] * v3[0] + v2[1] * v3[1];
    if dot.abs() < SCALED_EPSILON {
        return false;
    }
    let t1 = (v2[0] * v1[1] - v2[1] * v1[0]) / dot;
    let t2 = (v1[0] * v3[0] + v1[1] * v3[1]) / dot;
    t1 >= 0.0 && (0.0..=1.0).contains(&t2)
}

/// `ArcSegment::are_points_within_slice`, which (as Orca's) looks at the run's last two points only: the run grows a
/// point at a time.
fn within_slice(arc: &Arc, points: &[P]) -> bool {
    let n = points.len();
    let circle = Circle { center: arc.center, radius: arc.radius };
    let unit =
        |p: P| [(p[0] as f64 - arc.center[0] as f64) / arc.radius, (p[1] as f64 - arc.center[1] as f64) / arc.radius];
    let (start_norm, end_norm) = (unit(arc.start), unit(arc.end));
    let will_cross_zero = if arc.ccw { arc.start_theta > arc.end_theta } else { arc.start_theta < arc.end_theta };
    let mut crossed_zero = false;
    let mut previous = arc.start_theta;
    for index in n - 2..n {
        let polar = if index < n - 1 { circle.polar(points[index]) } else { arc.end_theta };
        if index < n - 1 {
            let inside = match (arc.ccw, will_cross_zero) {
                (true, true) => polar > arc.start_theta || polar < arc.end_theta,
                (true, false) => arc.start_theta < polar && polar < arc.end_theta,
                (false, true) => polar < arc.start_theta || polar > arc.end_theta,
                (false, false) => arc.start_theta > polar && polar > arc.end_theta,
            };
            if !inside {
                return false;
            }
        }
        let backwards = if arc.ccw { previous > polar } else { previous < polar };
        if backwards {
            if !will_cross_zero || crossed_zero {
                return false;
            }
            crossed_zero = true;
        }
        let (a, b) = (points[index - 1], points[index]);
        if (index != 1 && ray_hits_segment(arc.center, start_norm, a, b))
            || (index != n - 1 && ray_hits_segment(arc.center, end_norm, a, b))
        {
            return false;
        }
        previous = polar;
    }
    will_cross_zero == crossed_zero
}

/// `ArcSegment::try_create_arc` on a run of points.
fn try_arc(points: &[P], approximate_length: f64, tolerance: f64) -> Option<Arc> {
    let c = circle_through(points, tolerance)?;
    let mid = (points.len() - 2) / 2 + 1;
    let arc = arc_on(c, points[0], points[mid], points[points.len() - 1], approximate_length)?;
    within_slice(&arc, points).then_some(arc)
}

/// `Polyline::length`.
fn path_length(points: &[P]) -> f64 {
    points.windows(2).map(|w| norm((w[1][0] - w[0][0]) as f64, (w[1][1] - w[0][1]) as f64)).sum()
}

/// `ArcFitter::do_arc_fitting`: the path's runs, each as long as an arc fits it within `tolerance` nm, lines between.
fn fit(points: &[P], tolerance: f64) -> Vec<Run> {
    let mut result: Vec<Run> = Vec::new();
    if points.len() < 3 {
        result.push(Run { start: 0, end: points.len().saturating_sub(1), arc: None });
        return result;
    }
    let (mut front, mut back) = (0, 0);
    let mut last_arc = Arc::default();
    let mut current: Vec<P> = Vec::with_capacity(points.len());
    let line_to = |result: &mut Vec<Run>, start: usize, end: usize| match result.last_mut() {
        Some(r) if r.arc.is_none() => r.end = end,
        _ => result.push(Run { start, end, arc: None }),
    };
    for (i, &p) in points.iter().enumerate() {
        back = i;
        current.push(p);
        if back - front < 2 {
            continue;
        }
        if let Some(arc) = try_arc(&current, path_length(&current), tolerance) {
            last_arc = arc;
            if back == points.len() - 1 {
                result.push(Run { start: front, end: back, arc: Some(last_arc) });
                front = back;
            }
        } else {
            if back - front > 2 {
                // Without its last point the run fitted: that arc.
                result.push(Run { start: front, end: back - 1, arc: Some(last_arc) });
            } else {
                line_to(&mut result, front, front + 1);
            }
            front = back - 1;
            current.clear();
            current.extend_from_slice(&points[front..=front + 1]);
        }
    }
    if front != back {
        line_to(&mut result, front, back);
    }
    result
}

/// `MultiPoint::_douglas_peucker`, in nanometres.
pub fn douglas_peucker(points: &[P], tolerance: f64) -> Vec<P> {
    let mut out = Vec::with_capacity(points.len());
    let Some(&first) = points.first() else { return out };
    out.push(first);
    if points.len() == 1 {
        return out;
    }
    let tolerance2 = tolerance * tolerance;
    let mut anchor = 0;
    let mut stack = vec![points.len() - 1];
    while let Some(&floater) = stack.last() {
        let (mut furthest, mut most) = (anchor, 0.0);
        for (i, &p) in points.iter().enumerate().take(floater).skip(anchor + 1) {
            let d2 = distance_to_segment2(p, points[anchor], points[floater]);
            if d2 > most {
                most = d2;
                furthest = i;
            }
        }
        if most <= tolerance2 {
            out.push(points[floater]);
            anchor = floater;
            stack.pop();
        } else {
            stack.push(furthest);
        }
    }
    out
}

/// `Line::distance_to_squared`.
fn distance_to_segment2(p: P, a: P, b: P) -> f64 {
    let v = [(b[0] - a[0]) as f64, (b[1] - a[1]) as f64];
    let va = [(p[0] - a[0]) as f64, (p[1] - a[1]) as f64];
    let l2 = v[0] * v[0] + v[1] * v[1];
    if l2 == 0.0 {
        return va[0] * va[0] + va[1] * va[1];
    }
    let t = (va[0] * v[0] + va[1] * v[1]) / l2;
    if t <= 0.0 {
        va[0] * va[0] + va[1] * va[1]
    } else if t >= 1.0 {
        let vb = [(p[0] - b[0]) as f64, (p[1] - b[1]) as f64];
        vb[0] * vb[0] + vb[1] * vb[1]
    } else {
        let d = [t * v[0] - va[0], t * v[1] - va[1]];
        d[0] * d[0] + d[1] * d[1]
    }
}

/// `ArcFitter::do_arc_fitting_and_simplify` (`Polyline::simplify_by_fitting_arc`): the path's runs, its points
/// simplified to within `tolerance` nm run by run (the runs' indexes then point into what's left).
pub fn fit_and_simplify(points: &mut Vec<P>, tolerance: f64) -> Vec<Run> {
    let mut runs = if tolerance.abs() > SCALED_EPSILON {
        fit(points, tolerance)
    } else {
        vec![Run { start: 0, end: points.len().saturating_sub(1), arc: None }]
    };
    if runs.len() == 1 && runs[0].arc.is_none() {
        *points = douglas_peucker(points, tolerance);
        runs[0].end = points.len().saturating_sub(1);
        return runs;
    }
    let mut kept = vec![points[0]];
    let mut dropped = vec![0; runs.len()];
    for (i, run) in runs.iter().enumerate() {
        let part = douglas_peucker(&points[run.start..=run.end], tolerance);
        dropped[i] = run.end - run.start + 1 - part.len();
        kept.extend_from_slice(&part[1..]);
    }
    *points = kept;
    for j in 1..dropped.len() {
        dropped[j] += dropped[j - 1];
    }
    for j in 0..runs.len() {
        runs[j].end -= dropped[j];
        if j + 1 < runs.len() {
            runs[j + 1].start = runs[j].end;
        }
    }
    runs
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Points on a circle of `r` nm round `c`, from `a0` to `a1` radians in `n` steps.
    fn on_circle(c: P, r: f64, a0: f64, a1: f64, n: usize) -> Vec<P> {
        (0..=n)
            .map(|k| {
                let a = a0 + (a1 - a0) * k as f64 / n as f64;
                [c[0] + (r * a.cos()).round() as i64, c[1] + (r * a.sin()).round() as i64]
            })
            .collect()
    }

    #[test]
    fn a_quarter_circle_is_one_arc_and_keeps_its_ends_and_what_simplifying_keeps() {
        let mut points = on_circle([50_000_000, 50_000_000], 2_000_000.0, 0.0, PI / 2.0, 20);
        let runs = fit_and_simplify(&mut points, 100_000.0);
        assert_eq!(runs.len(), 1);
        let arc = runs[0].arc.expect("an arc");
        assert!(arc.ccw);
        // The circle goes through the ends and the middle of the chord between the points either side of the
        // middle one, a little outside the points: within the 0.1 mm tolerance.
        assert!((arc.radius - 2_000_000.0).abs() < 100_000.0, "{}", arc.radius);
        assert!((arc.angle - PI / 2.0).abs() < 0.05, "{}", arc.angle);
        assert_eq!((arc.start, arc.end), ([52_000_000, 50_000_000], [50_000_000, 52_000_000]));
        // Douglas–Peucker to 0.1 mm keeps the ends and the points the chords would cut off more than that.
        assert_eq!((runs[0].start, runs[0].end), (0, points.len() - 1));
        assert_eq!(points.first(), Some(&[52_000_000, 50_000_000]));
        assert_eq!(points.last(), Some(&[50_000_000, 52_000_000]));
        assert!(points.len() > 2 && points.len() < 21, "{}", points.len());
    }

    #[test]
    fn a_line_stays_a_line_and_a_clockwise_turn_after_one_is_a_clockwise_arc() {
        let mut points = vec![[0, 0], [10_000_000, 0], [20_000_000, 0]];
        let runs = fit_and_simplify(&mut points, 100_000.0);
        assert_eq!(runs, vec![Run { start: 0, end: 1, arc: None }]);
        assert_eq!(points, vec![[0, 0], [20_000_000, 0]]);

        // Along y = 0, then a clockwise quarter down round (30, -2) mm. Within 0.1 mm, the last straight piece and
        // the turn's first point make a flat arc of their own (as in Orca).
        let mut points = vec![[0, 0], [10_000_000, 0], [20_000_000, 0], [30_000_000, 0]];
        points.extend(on_circle([30_000_000, -2_000_000], 2_000_000.0, PI / 2.0, 0.0, 20).into_iter().skip(1));
        let runs = fit_and_simplify(&mut points, 100_000.0);
        assert!(runs[0].arc.is_none() && runs[0].start == 0, "{runs:?}");
        assert!(runs.windows(2).all(|w| w[0].end == w[1].start), "{runs:?}");
        let last = runs.last().and_then(|r| r.arc).expect("an arc last");
        assert!(!last.ccw && last.angle < 0.0);
        assert_eq!(last.end, [32_000_000, -2_000_000]);
        assert!((last.radius - 2_000_000.0).abs() < 100_000.0, "{}", last.radius);
        assert_eq!(runs.last().map(|r| r.end), Some(points.len() - 1));
    }

    #[test]
    fn a_repeated_point_fits_no_circle_through_it() {
        let c = Circle { center: [0, 0], radius: 1_000_000.0 };
        assert!(c.over_deviation(&[[1_000_000, 0], [1_000_000, 0], [0, 1_000_000]], 100_000.0));
    }
}
