//! The medial axis of a narrow region: the line along its middle, with the region's width at each point. It comes
//! from the Voronoi diagram of the region's edges, as in Orca's gap fill (which uses Boost's Voronoi; this uses its
//! Rust port). Gap fill extrudes along Orca's (`gap_fill`), as wide as the region is; the lines along the middle of
//! narrow solid infill take a plainer one (`axis`).

use crate::geom::{self, Pt, Shape, Shapes};
use boostvoronoi::prelude::{Builder, Cell, Line, SourceCategory};
use std::collections::HashMap;

/// A line along the middle of a region, and the region's width (mm) at each of its points.
#[derive(Clone, Debug)]
pub struct ThickLine {
    pub points: Vec<Pt>,
    pub widths: Vec<f64>,
}

impl ThickLine {
    pub fn length_mm(&self) -> f64 {
        geom::length_mm(&self.points, false)
    }
}

/// The middle of `shape` where it is between `min_width` and `max_width` wide (mm), as lines: every edge of the axis
/// but those into a corner, broken at junctions, short whiskers into corners dropped.
pub fn axis(shape: &Shape, min_width: f64, max_width: f64) -> Vec<ThickLine> {
    let segments = segments_of(shape);
    if segments.len() < 3 {
        return Vec::new();
    }
    let built = Builder::<i32>::default().with_segments(segments.iter().map(|s| Line::<i32>::from(*s)));
    let Ok(diagram) = built.and_then(|b| b.build()) else { return Vec::new() };
    let region: Shapes = vec![shape.clone()];
    // Where a diagram comes out broken (its input segments touch or cross somewhere), an edge can lie far outside
    // the region yet on the inner side of its own segment: both ends of every edge kept must be in the region.
    let bb = geom::bbox_of(shape);
    let within = |x: f64, y: f64| {
        let p = geom::pt(x.round() as i32, y.round() as i32);
        p.x >= bb[0] && p.x <= bb[2] && p.y >= bb[1] && p.y <= bb[3] && geom::contains(&region, p)
    };

    // The edges inside the region, each once, with the width at both ends.
    struct Kept {
        v: [usize; 2],
        w: [f64; 2],
    }
    let (min_units, max_units) = (min_width * geom::SCALE, max_width * geom::SCALE);
    let mut kept: Vec<Kept> = Vec::new();
    let vertices = diagram.vertices();
    for edge in diagram.edges() {
        let id = edge.id();
        let Ok(twin) = edge.twin() else { continue };
        if twin.usize() < id.usize() || !edge.is_primary() {
            continue;
        }
        let (Some(v0), Ok(Some(v1))) = (edge.vertex0(), diagram.edge_get_vertex1(id)) else { continue };
        let (a, b) = (&vertices[v0.usize()], &vertices[v1.usize()]);
        let Ok(cell) = edge.cell().and_then(|c| diagram.cell(c)) else { continue };
        // Inside the region: on the solid side of the edge's own segment (contours keep the solid on their left),
        // or, for an edge between two segment ends, by a winding test.
        let mid = ((a.x() + b.x()) / 2.0, (a.y() + b.y()) / 2.0);
        let inside = if cell.source_category() == SourceCategory::Segment {
            let s = segments[cell.source_index().usize()].map(f64::from);
            (s[2] - s[0]) * (mid.1 - s[1]) - (s[3] - s[1]) * (mid.0 - s[0]) > 0.0
        } else {
            geom::contains(&region, geom::pt(mid.0.round() as i32, mid.1.round() as i32))
        };
        if !inside {
            continue;
        }
        let w =
            [2.0 * site_distance(&segments, cell, a.x(), a.y()), 2.0 * site_distance(&segments, cell, b.x(), b.y())];
        if w[0].max(w[1]) < min_units || w[0].min(w[1]) > max_units {
            continue;
        }
        // On the boundary counts: edges into a corner end there.
        let on_or_in = |x: f64, y: f64, w: f64| w < 1.0 || within(x, y);
        if !on_or_in(a.x(), a.y(), w[0]) || !on_or_in(b.x(), b.y(), w[1]) {
            continue;
        }
        // An edge that reaches the boundary runs into a corner. Keep it only where the region narrows to a point
        // between two edges facing each other (as Orca's medial axis does); a corner's bisector is no gap.
        if w[0] < 1.0 || w[1] < 1.0 {
            let Ok(other) = diagram.edge(twin).and_then(|t| t.cell()).and_then(|c| diagram.cell(c)) else { continue };
            if cell.source_category() != SourceCategory::Segment || other.source_category() != SourceCategory::Segment {
                continue;
            }
            let heading = |c: &Cell| {
                let s = segments[c.source_index().usize()].map(f64::from);
                (s[3] - s[1]).atan2(s[2] - s[0])
            };
            let mut angle = (heading(cell) - heading(other)).abs();
            if angle > std::f64::consts::PI {
                angle = 2.0 * std::f64::consts::PI - angle;
            }
            if std::f64::consts::PI - angle > std::f64::consts::PI / 8.0 {
                continue;
            }
        }
        kept.push(Kept { v: [v0.usize(), v1.usize()], w });
    }
    if kept.is_empty() {
        return Vec::new();
    }
    let point = |v: usize| geom::pt(vertices[v].x().round() as i32, vertices[v].y().round() as i32);

    // Chain the edges into lines between ends and junctions, then drop the short whiskers that run from a
    // junction into a corner, and chain again.
    let ends: Vec<([usize; 2], [f64; 2])> = kept.iter().map(|k| (k.v, k.w)).collect();
    let measured = |mut lines: Vec<Chained>| {
        for l in &mut lines {
            l.length = l.vertices.windows(2).map(|w| geom::dist(point(w[0]), point(w[1]))).sum::<f64>();
        }
        lines
    };
    let mut alive = vec![true; kept.len()];
    let mut lines = measured(chain(&ends, &alive));
    let mut degree: HashMap<usize, usize> = HashMap::new();
    for k in &kept {
        *degree.entry(k.v[0]).or_default() += 1;
        *degree.entry(k.v[1]).or_default() += 1;
    }
    let mut pruned = false;
    for line in &lines {
        let (first, last) = (line.vertices[0], *line.vertices.last().unwrap());
        let (d0, d1) = (degree[&first], degree[&last]);
        let whisker = (d0 == 1 && d1 >= 3) || (d1 == 1 && d0 >= 3);
        let widest = line.widths.iter().cloned().fold(0.0, f64::max);
        if whisker && line.length < widest * 1.5 {
            for &e in &line.edges {
                alive[e] = false;
            }
            pruned = true;
        }
    }
    if pruned {
        lines = measured(chain(&ends, &alive));
    }
    lines
        .into_iter()
        .map(|l| ThickLine {
            points: l.vertices.iter().map(|&v| point(v)).collect(),
            widths: l.widths.iter().map(|w| (w / geom::SCALE).clamp(min_width, max_width)).collect(),
        })
        .filter(|l| l.points.len() >= 2 && l.length_mm() >= min_width.max(0.1))
        .collect()
}

/// Orca's medial axis for gap fill (`MedialAxis::build` and `ExPolygon::medial_axis`), ported: the edges of the
/// Voronoi diagram inside the region where it is between `min_width` and `max_width` (mm) wide, less those between
/// two edges of the outline that don't face each other (a corner's bisector) unless shorter than `min_width`;
/// chained into lines as Orca chains them, a line running on through a junction where only one other edge is left;
/// each line's free ends drawn out along their last segment to the outline, at the end's width; then lines with a
/// free end shorter than twice the widest width dropped, and lines that come to meet end to end joined.
pub fn gap_fill(shape: &Shape, min_width: f64, max_width: f64) -> Vec<ThickLine> {
    let segments = segments_of(shape);
    if segments.len() < 3 {
        return Vec::new();
    }
    let built = Builder::<i32>::default().with_segments(segments.iter().map(|s| Line::<i32>::from(*s)));
    let Ok(diagram) = built.and_then(|b| b.build()) else { return Vec::new() };
    let region: Shapes = vec![shape.clone()];
    let bb = geom::bbox_of(shape);
    let within = |x: f64, y: f64| {
        let p = geom::pt(x.round() as i32, y.round() as i32);
        p.x >= bb[0] && p.x <= bb[2] && p.y >= bb[1] && p.y <= bb[3] && geom::contains(&region, p)
    };
    let vertices = diagram.vertices();
    let edges = diagram.edges();
    let cell_of = |id| diagram.edge(id).and_then(|e| e.cell()).and_then(|c| diagram.cell(c)).ok();
    let heading = |c: &Cell| {
        let s = segments[c.source_index().usize()].map(f64::from);
        (s[3] - s[1]).atan2(s[2] - s[0])
    };
    let (min_units, max_units) = (min_width * geom::SCALE, max_width * geom::SCALE);

    // Each pair of half-edges (2k and 2k + 1): whether it is an edge of the axis not chained yet, and the widths
    // (units) at the start and the end of its first half.
    let pairs = edges.len().div_ceil(2);
    let mut active = vec![false; pairs];
    let mut widths = vec![[0.0f64; 2]; pairs];
    for edge in edges.iter().step_by(2) {
        let id = edge.id();
        let Ok(twin) = edge.twin() else { continue };
        if !edge.is_primary() {
            continue;
        }
        let (Some(v0), Ok(Some(v1))) = (edge.vertex0(), diagram.edge_get_vertex1(id)) else { continue };
        let (a, b) = (&vertices[v0.usize()], &vertices[v1.usize()]);
        let (Some(left), Some(right)) = (cell_of(id), cell_of(twin)) else { continue };
        // Inside the region: on the solid side of the edge's own segment, or by a winding test.
        let mid = ((a.x() + b.x()) / 2.0, (a.y() + b.y()) / 2.0);
        let inside = if left.source_category() == SourceCategory::Segment {
            let s = segments[left.source_index().usize()].map(f64::from);
            (s[2] - s[0]) * (mid.1 - s[1]) - (s[3] - s[1]) * (mid.0 - s[0]) > 0.0
        } else {
            geom::contains(&region, geom::pt(mid.0.round() as i32, mid.1.round() as i32))
        };
        if !inside {
            continue;
        }
        // Orca's `validate_edge`: the width at each end, from the site on the other side.
        let w0 = 2.0 * site_distance(&segments, right, a.x(), a.y());
        let w1 = 2.0 * site_distance(&segments, left, b.x(), b.y());
        if !(w0 < 1.0 || within(a.x(), a.y())) || !(w1 < 1.0 || within(b.x(), b.y())) {
            continue;
        }
        let segment = |c: &Cell| c.source_category() == SourceCategory::Segment;
        if segment(left) && segment(right) {
            let mut angle = (heading(right) - heading(left)).abs();
            if angle > std::f64::consts::PI {
                angle = 2.0 * std::f64::consts::PI - angle;
            }
            let length = (b.x() - a.x()).hypot(b.y() - a.y());
            if std::f64::consts::PI - angle > std::f64::consts::PI / 8.0
                && (w0 < 1.0 || w1 < 1.0 || length >= min_units)
            {
                continue;
            }
        } else if w0 < 1.0 || w1 < 1.0 {
            continue;
        }
        if (w0 >= min_units || w1 >= min_units) && (w0 <= max_units || w1 <= max_units) {
            active[id.usize() / 2] = true;
            widths[id.usize() / 2] = [w0, w1];
        }
    }

    let point = |v: usize| geom::pt(vertices[v].x().round() as i32, vertices[v].y().round() as i32);
    // Orca's `process_edge_neighbors`: on from the end of half-edge `e` while exactly one edge of the axis not yet
    // chained leaves where it ends. Whether the line stopped at a free end (none left there).
    let grow = |mut e, active: &mut [bool], points: &mut Vec<Pt>, ws: &mut Vec<f64>| -> bool {
        loop {
            let Ok(twin) = diagram.edge(e).and_then(|x| x.twin()) else { return false };
            let (mut count, mut first) = (0, None);
            let mut next = diagram.edge_rot_next(twin);
            for _ in 0..64 {
                let Some(n) = next.filter(|n| n.usize() != twin.usize()) else { break };
                if active[n.usize() / 2] {
                    first.get_or_insert(n);
                    count += 1;
                }
                next = diagram.edge_rot_next(n);
            }
            match (count, first) {
                (0, _) => return true,
                (1, Some(n)) => {
                    let k = n.usize();
                    let Ok(Some(end)) = diagram.edge_get_vertex1(n) else { return false };
                    active[k / 2] = false;
                    points.push(point(end.usize()));
                    ws.push(widths[k / 2][if k % 2 == 1 { 0 } else { 1 }]);
                    e = n;
                }
                _ => return false,
            }
        }
    };
    let mut lines: Vec<Free> = Vec::new();
    for edge in edges.iter().step_by(2) {
        let id = edge.id();
        let k = id.usize();
        if !active[k / 2] {
            continue;
        }
        active[k / 2] = false;
        let (Some(v0), Ok(Some(v1)), Ok(twin)) = (edge.vertex0(), diagram.edge_get_vertex1(id), edge.twin()) else {
            continue;
        };
        let mut points = vec![point(v0.usize()), point(v1.usize())];
        let mut ws = vec![widths[k / 2][0], widths[k / 2][1]];
        let end = grow(id, &mut active, &mut points, &mut ws);
        let (mut back, mut back_ws) = (Vec::new(), Vec::new());
        let start = grow(twin, &mut active, &mut back, &mut back_ws);
        back.reverse();
        back_ws.reverse();
        back.append(&mut points);
        back_ws.append(&mut ws);
        // A loop has no ends to draw out.
        let free = if back.first() == back.last() { (false, false) } else { (start, end) };
        lines.push(Free { points: back, widths: back_ws, free });
    }
    finish_gap_lines(shape, lines)
        .into_iter()
        .map(|l| ThickLine { points: l.points, widths: l.widths.iter().map(|w| w / geom::SCALE).collect() })
        .collect()
}

/// A line of the axis (widths in units) and whether each of its ends is free: where the axis just stops, not at a
/// junction.
struct Free {
    points: Vec<Pt>,
    widths: Vec<f64>,
    free: (bool, bool),
}

impl Free {
    fn reverse(&mut self) {
        self.points.reverse();
        self.widths.reverse();
        self.free = (self.free.1, self.free.0);
    }
}

/// Orca's `ExPolygon::medial_axis` after the axis is built: each free end not on the outline drawn out along its
/// segment, by the widest width, to where it first crosses the outer contour (as Orca looks for it: the closing edge,
/// then the others in turn); a line with a free end that is then shorter than twice the widest width dropped; and if
/// any was, lines that meet end to end joined.
fn finish_gap_lines(shape: &Shape, mut lines: Vec<Free>) -> Vec<Free> {
    let max_w = lines.iter().flat_map(|l| l.widths.iter().copied()).fold(0.0, f64::max);
    let on_boundary =
        |p: Pt| shape.iter().any(|c| (0..c.len()).any(|i| geom::segment_dist2(p, c[i], c[(i + 1) % c.len()]) < 1.0));
    let outer = &shape[0];
    let reach = |from: [f64; 2], to: [f64; 2]| -> Option<Pt> {
        let line = (geom::pt(from[0] as i32, from[1] as i32), geom::pt(to[0] as i32, to[1] as i32));
        let n = outer.len();
        if n < 2 {
            return None;
        }
        std::iter::once((outer[0], outer[n - 1]))
            .chain((1..n).map(|i| (outer[i - 1], outer[i])))
            .find_map(|edge| crossing(edge, line))
    };
    let f = |p: Pt| [p.x as f64, p.y as f64];
    let mut removed = false;
    let mut i = 0;
    while i < lines.len() {
        let l = &mut lines[i];
        let n = l.points.len();
        let (mut front, mut back) = (l.points[0], l.points[n - 1]);
        if l.free.0 && !on_boundary(front) {
            let p1 = f(l.points[0]);
            let mut p2 = f(l.points[1]);
            // Not as far as the other side.
            if n == 2 {
                p2 = [(p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0];
            }
            let d = unit([p1[0] - p2[0], p1[1] - p2[1]]);
            if let Some(p) = reach([p1[0] + d[0] * max_w, p1[1] + d[1] * max_w], p2) {
                front = p;
            }
        }
        if l.free.1 && !on_boundary(back) {
            let mut p1 = f(l.points[n - 2]);
            let p2 = f(l.points[n - 1]);
            if n == 2 {
                p1 = [(p1[0] + p2[0]) / 2.0, (p1[1] + p2[1]) / 2.0];
            }
            let d = unit([p2[0] - p1[0], p2[1] - p1[1]]);
            if let Some(p) = reach(p1, [p2[0] + d[0] * max_w, p2[1] + d[1] * max_w]) {
                back = p;
            }
        }
        l.points[0] = front;
        l.points[n - 1] = back;
        let length: f64 = l.points.windows(2).map(|w| geom::dist(w[0], w[1])).sum();
        if (l.free.0 || l.free.1) && length < max_w * 2.0 {
            lines.remove(i);
            removed = true;
            continue;
        }
        i += 1;
    }
    if removed {
        let mut i = 0;
        while i < lines.len() {
            if lines[i].free.0 && lines[i].free.1 {
                i += 1;
                continue;
            }
            let mut j = i + 1;
            while j < lines.len() {
                let (first, last) = (lines[i].points[0], *lines[i].points.last().unwrap());
                let (o_first, o_last) = (lines[j].points[0], *lines[j].points.last().unwrap());
                if last == o_last {
                    lines[j].reverse();
                } else if first == o_last {
                    lines[i].reverse();
                    lines[j].reverse();
                } else if first == o_first {
                    lines[i].reverse();
                } else if last != o_first {
                    j += 1;
                    continue;
                }
                let other = lines.remove(j);
                let l = &mut lines[i];
                l.points.extend_from_slice(&other.points[1..]);
                l.widths.extend_from_slice(&other.widths[1..]);
                l.free.1 = other.free.1;
                j = i + 1;
            }
            i += 1;
        }
    }
    lines
}

fn unit(v: [f64; 2]) -> [f64; 2] {
    let l = v[0].hypot(v[1]);
    if l > 0.0 { [v[0] / l, v[1] / l] } else { [0.0, 0.0] }
}

/// Where segment `l` crosses the contour's edge `e`, on the edge, its coordinates cut toward zero (Orca's
/// `line_alg::intersection`); none for parallel ones.
fn crossing(e: (Pt, Pt), l: (Pt, Pt)) -> Option<Pt> {
    let v1 = [(e.1.x - e.0.x) as f64, (e.1.y - e.0.y) as f64];
    let v2 = [(l.1.x - l.0.x) as f64, (l.1.y - l.0.y) as f64];
    let denom = v1[0] * v2[1] - v1[1] * v2[0];
    if denom.abs() < 1e-4 {
        return None;
    }
    let v12 = [(e.0.x - l.0.x) as f64, (e.0.y - l.0.y) as f64];
    let t1 = (v2[0] * v12[1] - v2[1] * v12[0]) / denom;
    let t2 = (v1[0] * v12[1] - v1[1] * v12[0]) / denom;
    ((0.0..=1.0).contains(&t1) && (0.0..=1.0).contains(&t2))
        .then(|| geom::pt((e.0.x as f64 + t1 * v1[0]) as i32, (e.0.y as f64 + t1 * v1[1]) as i32))
}

/// The region's edges as the Voronoi diagram's input segments, contour by contour, each from a point to the next.
fn segments_of(shape: &Shape) -> Vec<[i32; 4]> {
    let mut segments = Vec::new();
    for contour in shape {
        let n = contour.len();
        for i in 0..n {
            let (a, b) = (contour[i], contour[(i + 1) % n]);
            if a != b {
                segments.push([a.x, a.y, b.x, b.y]);
            }
        }
    }
    segments
}

/// How far a point is from the site that made a cell: its segment, or one of the segment's ends.
fn site_distance(segments: &[[i32; 4]], cell: &Cell, x: f64, y: f64) -> f64 {
    let s = segments[cell.source_index().usize()].map(f64::from);
    match cell.source_category() {
        SourceCategory::SegmentStart | SourceCategory::SinglePoint => (x - s[0]).hypot(y - s[1]),
        SourceCategory::SegmentEnd => (x - s[2]).hypot(y - s[3]),
        SourceCategory::Segment => {
            let (dx, dy) = (s[2] - s[0], s[3] - s[1]);
            let len2 = dx * dx + dy * dy;
            let t = if len2 > 0.0 { (((x - s[0]) * dx + (y - s[1]) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
            (x - s[0] - t * dx).hypot(y - s[1] - t * dy)
        }
    }
}

struct Chained {
    vertices: Vec<usize>,
    widths: Vec<f64>,
    edges: Vec<usize>,
    length: f64,
}

/// Lines through the live edges, broken where three or more meet.
fn chain(edges: &[([usize; 2], [f64; 2])], alive: &[bool]) -> Vec<Chained> {
    let mut at: HashMap<usize, Vec<usize>> = HashMap::new();
    for (i, (v, _)) in edges.iter().enumerate() {
        if alive[i] {
            at.entry(v[0]).or_default().push(i);
            at.entry(v[1]).or_default().push(i);
        }
    }
    let mut used = vec![false; edges.len()];
    let mut out = Vec::new();
    // Lines start at ends and junctions; what's left over are loops.
    let mut starts: Vec<usize> = at.iter().filter(|(_, e)| e.len() != 2).map(|(&v, _)| v).collect();
    starts.sort_unstable();
    let mut loops: Vec<usize> = at.keys().copied().collect();
    loops.sort_unstable();
    for start in starts.into_iter().chain(loops) {
        let incident = at[&start].clone();
        for first in incident {
            if used[first] {
                continue;
            }
            let mut line = Chained { vertices: vec![start], widths: vec![], edges: vec![], length: 0.0 };
            let mut v = start;
            let mut e = first;
            loop {
                used[e] = true;
                let (ends, w) = edges[e];
                let (from_w, next, to_w) = if ends[0] == v { (w[0], ends[1], w[1]) } else { (w[1], ends[0], w[0]) };
                if line.widths.is_empty() {
                    line.widths.push(from_w);
                }
                line.vertices.push(next);
                line.widths.push(to_w);
                line.edges.push(e);
                v = next;
                let around = &at[&v];
                if around.len() != 2 {
                    break;
                }
                match around.iter().find(|&&o| !used[o]) {
                    Some(&o) => e = o,
                    None => break,
                }
            }
            out.push(line);
        }
    }
    out
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
    fn a_thin_strip_has_one_line_down_its_middle_as_wide_as_the_strip() {
        let lines = axis(&rect(0.0, 0.0, 10.0, 0.5), 0.05, 0.8);
        assert_eq!(lines.len(), 1, "{lines:?}");
        let line = &lines[0];
        for p in &line.points {
            assert!((p.y - sc(0.25)).abs() <= 2, "off the middle at {p:?}");
        }
        assert!(line.length_mm() > 9.0, "{} mm", line.length_mm());
        let middle = line.widths[line.widths.len() / 2];
        assert!((middle - 0.5).abs() < 0.01, "{middle} mm wide");
    }

    #[test]
    fn gap_fill_runs_out_to_the_ends_of_a_strip_at_its_full_width() {
        // Orca draws a line's free ends out to the outline, at the end's width: the line covers the strip end to end.
        let lines = gap_fill(&rect(0.0, 0.0, 10.0, 0.3), 0.05, 0.8);
        assert_eq!(lines.len(), 1, "{lines:?}");
        let line = &lines[0];
        let xs: Vec<i32> = line.points.iter().map(|p| p.x).collect();
        assert_eq!((*xs.iter().min().unwrap(), *xs.iter().max().unwrap()), (0, sc(10.0)), "{line:?}");
        for (p, w) in line.points.iter().zip(&line.widths) {
            assert!((p.y - sc(0.15)).abs() <= 2, "off the middle at {p:?}");
            assert!((w - 0.3).abs() < 0.01, "{w} mm wide at {p:?}");
        }
    }

    #[test]
    fn gap_fill_turns_a_corner_without_a_branch_into_it() {
        // An L of two arms 0.3 mm wide: one line round the corner, none along the outer corner's bisector.
        let shape: Shape = vec![vec![
            geom::pt(0, 0),
            geom::pt(sc(5.0), 0),
            geom::pt(sc(5.0), sc(0.3)),
            geom::pt(sc(0.3), sc(0.3)),
            geom::pt(sc(0.3), sc(5.0)),
            geom::pt(0, sc(5.0)),
        ]];
        let lines = gap_fill(&shape, 0.05, 0.8);
        assert_eq!(lines.len(), 1, "{lines:?}");
        let length = lines[0].length_mm();
        assert!((length - 9.7).abs() < 0.05, "{length} mm");
    }

    #[test]
    fn a_wide_region_has_no_gap_line() {
        assert!(axis(&rect(0.0, 0.0, 10.0, 5.0), 0.05, 0.8).is_empty());
    }

    #[test]
    fn the_axis_stays_inside_the_region_and_comes_out_the_same_every_time() {
        // A ring with a wavy, finely cut outside around a square hole: narrow everywhere, many segments.
        let outer: Vec<Pt> = (0..400)
            .map(|k| {
                let a = k as f64 / 400.0 * std::f64::consts::TAU;
                let r = 6.0 + 0.3 * (7.0 * a).sin();
                geom::pt(sc(r * a.cos()), sc(r * a.sin()))
            })
            .collect();
        let mut hole = rect(-4.0, -4.0, 4.0, 4.0).remove(0);
        hole.reverse();
        let shape: Shape = vec![outer, hole];
        let region: Shapes = vec![shape.clone()];
        let first = axis(&shape, 0.1, 6.0);
        assert!(!first.is_empty());
        for line in &first {
            for &p in &line.points {
                assert!(geom::contains(&region, p), "{p:?} is outside the ring");
            }
        }
        for _ in 0..20 {
            let again = axis(&shape, 0.1, 6.0);
            assert_eq!(again.len(), first.len());
            for (a, b) in again.iter().zip(&first) {
                assert_eq!(a.points, b.points);
            }
        }
    }
}
