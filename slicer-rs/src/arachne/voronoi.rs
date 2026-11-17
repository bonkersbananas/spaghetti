//! The Voronoi diagram of an outline's segments as Arachne reads it (Orca 2.5.1's `Geometry::VoronoiDiagram` and
//! `VoronoiUtils`): Boost's, which `boostvoronoi` ports, with Orca's helpers that find a cell's own edges and
//! discretise a parabola. Coordinates are nanometres, as integers (`i32`, as Boost takes them).

use super::graph::{P, p};
use boostvoronoi::prelude::{Builder, Line, SourceCategory};

pub struct VdEdge {
    pub cell: usize,
    pub v0: Option<usize>,
    pub v1: Option<usize>,
    pub twin: usize,
    pub next: usize,
    pub secondary: bool,
    pub finite: bool,
}

pub struct VdCell {
    pub contains_point: bool,
    pub category: SourceCategory,
    pub source_index: usize,
    pub incident_edge: Option<usize>,
}

pub struct Vd {
    pub edges: Vec<VdEdge>,
    pub cells: Vec<VdCell>,
    pub vertices: Vec<(f64, f64)>,
}

/// An outline segment: the polygon it is in, its start and end, and the polygon's points for the corner round it.
#[derive(Clone, Copy)]
pub struct Segment {
    pub poly: usize,
    pub idx: usize,
    pub from: P,
    pub to: P,
}

/// The polygons' segments in Orca's order: each polygon's points in turn, each to the next.
pub fn segments_of(polys: &[Vec<P>]) -> Vec<Segment> {
    let mut out = Vec::new();
    for (pi, poly) in polys.iter().enumerate() {
        for (i, &a) in poly.iter().enumerate() {
            out.push(Segment { poly: pi, idx: i, from: a, to: poly[(i + 1) % poly.len()] });
        }
    }
    out
}

pub fn build(segments: &[Segment]) -> Option<Vd> {
    let lines =
        segments.iter().map(|s| Line::<i32>::from([s.from.x as i32, s.from.y as i32, s.to.x as i32, s.to.y as i32]));
    let diagram = Builder::<i32>::default().with_segments(lines).ok()?.build().ok()?;
    let edges = diagram
        .edges()
        .iter()
        .map(|e| {
            let id = e.id();
            VdEdge {
                cell: e.cell().map(|c| c.usize()).unwrap_or(usize::MAX),
                v0: e.vertex0().map(|v| v.usize()),
                v1: diagram.edge_get_vertex1(id).ok().flatten().map(|v| v.usize()),
                twin: e.twin().map(|t| t.usize()).unwrap_or(usize::MAX),
                next: e.next().map(|t| t.usize()).unwrap_or(usize::MAX),
                secondary: e.is_secondary(),
                finite: diagram.edge_is_finite(id).unwrap_or(false),
            }
        })
        .collect();
    let cells = diagram
        .cells()
        .iter()
        .map(|c| VdCell {
            contains_point: c.contains_point(),
            category: c.source_category(),
            source_index: c.source_index().usize(),
            incident_edge: c.get_incident_edge().map(|e| e.usize()),
        })
        .collect();
    let vertices = diagram.vertices().iter().map(|v| (v.x(), v.y())).collect();
    Some(Vd { edges, cells, vertices })
}

impl Vd {
    /// `VoronoiUtils::to_point`: a vertex rounded to integers.
    pub fn point(&self, v: usize) -> P {
        p(self.vertices[v].0.round() as i64, self.vertices[v].1.round() as i64)
    }

    /// `is_in_range<coord_t>`: the edge's ends are finite (every coordinate fits).
    pub fn in_range(&self, e: usize) -> bool {
        let edge = &self.edges[e];
        let ok = |v: Option<usize>| {
            v.is_some_and(|v| {
                let (x, y) = self.vertices[v];
                x.is_finite() && y.is_finite()
            })
        };
        ok(edge.v0) && ok(edge.v1)
    }

    /// `get_source_point`: the point a point cell stands for.
    pub fn source_point(&self, cell: usize, segments: &[Segment]) -> P {
        let c = &self.cells[cell];
        match c.category {
            SourceCategory::SegmentStart => segments[c.source_index].from,
            _ => segments[c.source_index].to,
        }
    }

    pub fn source_segment<'a>(&self, cell: usize, segments: &'a [Segment]) -> &'a Segment {
        &segments[self.cells[cell].source_index]
    }
}

/// A segment cell's edges that lie inside the polygon, from the one that starts at the segment's end to the one
/// that ends at its start (`compute_segment_cell_range`).
pub struct SegmentCellRange {
    /// The segment's end, which Orca's `SegmentCellRange(to, from)` calls its source segment's start point,
    pub start_point: P,
    /// and the segment's start, its end point.
    pub end_point: P,
    pub edge_begin: Option<usize>,
    pub edge_end: Option<usize>,
}

pub fn segment_cell_range(vd: &Vd, cell: usize, segments: &[Segment]) -> SegmentCellRange {
    let seg = vd.source_segment(cell, segments);
    let (from, to) = (seg.from, seg.to);
    let mut range = SegmentCellRange { start_point: to, end_point: from, edge_begin: None, edge_end: None };
    let start = vd.cells[cell].incident_edge.expect("cell has an edge");
    let mut seen_possible_start = false;
    let mut after_start = false;
    let mut ending_edge_is_set_before_start = false;
    let mut edge = start;
    loop {
        let e = &vd.edges[edge];
        if e.finite {
            let (v0, v1) = (vd.point(e.v0.unwrap()), vd.point(e.v1.unwrap()));
            if v0 == to && !after_start {
                range.edge_begin = Some(edge);
                seen_possible_start = true;
            } else if seen_possible_start {
                after_start = true;
            }
            if v1 == from && (range.edge_end.is_none() || ending_edge_is_set_before_start) {
                ending_edge_is_set_before_start = !after_start;
                range.edge_end = Some(edge);
            }
        }
        edge = e.next;
        if edge == start {
            break;
        }
    }
    range
}

/// A point cell's range, if its first edge lies inside the polygon's corner (`compute_point_cell_range`).
pub struct PointCellRange {
    pub source_point: P,
    pub edge_begin: Option<usize>,
    pub edge_end: Option<usize>,
}

pub fn point_cell_range(vd: &Vd, cell: usize, segments: &[Segment], polys: &[Vec<P>]) -> PointCellRange {
    let source_point = vd.source_point(cell, segments);
    let mut range = PointCellRange { source_point, edge_begin: None, edge_end: None };
    let start = vd.cells[cell].incident_edge.expect("cell has an edge");
    let e0 = &vd.edges[start];
    if !e0.finite || !vd.in_range(start) {
        return range;
    }
    // The point's own polygon corner: the segment it starts or ends.
    let c = &vd.cells[cell];
    let seg = segments[c.source_index];
    let idx = if c.category == SourceCategory::SegmentStart { seg.idx } else { (seg.idx + 1) % polys[seg.poly].len() };
    let poly = &polys[seg.poly];
    let n = poly.len();
    let (prev, cur, next) = (poly[(idx + n - 1) % n], poly[idx], poly[(idx + 1) % n]);
    let (v0, v1) = (vd.point(e0.v0.unwrap()), vd.point(e0.v1.unwrap()));
    let query = if v0 == source_point { v1 } else { v0 };
    if !inside_corner(prev, cur, next, query) {
        return range;
    }
    let mut edge = start;
    loop {
        let e = &vd.edges[edge];
        if let Some(v) = e.v1
            && vd.point(v) == source_point
        {
            range.edge_begin = Some(e.next);
            range.edge_end = Some(edge);
        }
        edge = e.next;
        if edge == start {
            break;
        }
    }
    range
}

/// `Geometry::is_point_inside_polygon_corner`: whether `q` lies inside the corner a–b–c of a counter-clockwise
/// contour.
pub fn inside_corner(a: P, b: P, c: P, q: P) -> bool {
    let norm = |v: P| {
        let (x, y) = (v.x as f64, v.y as f64);
        let n = (x * x + y * y).sqrt();
        if n > 0.0 { (x / n, y / n) } else { (x, y) }
    };
    let ba = norm(a - b);
    let bc = norm(c - b);
    let bq = norm(q - b);
    let bq_left = (-bq.1, bq.0);
    let dot = |u: (f64, f64), v: (f64, f64)| u.0 * v.0 + u.1 * v.1;
    let pa_n = dot(ba, bq_left);
    let pc_n = dot(bc, bq_left);
    if (pa_n > 0.0 && pc_n <= 0.0) || (pa_n <= 0.0 && pc_n > 0.0) {
        return pa_n > 0.0;
    }
    let pa = dot(ba, bq);
    let pc = dot(bc, bq);
    (pa_n > 0.0 && pc < pa) || (pa_n <= 0.0 && pc >= pa)
}

fn rotated(pt: P, cos_a: f64, sin_a: f64) -> P {
    let (x, y) = (pt.x as f64, pt.y as f64);
    p((cos_a * x - sin_a * y).round() as i64, (cos_a * y + sin_a * x).round() as i64)
}

/// `VoronoiUtils::discretize_parabola`: the parabola between a point and a segment, from `start` to `end`, as
/// points about `step` apart, with extra points where it is as steep as the transitioning angle and at its apex.
pub fn discretize_parabola(
    source_point: P,
    a: P,
    b: P,
    start: P,
    end: P,
    step: i64,
    transitioning_angle: f32,
) -> Vec<P> {
    let ab = b - a;
    let as_ = start - a;
    let ae = end - a;
    let ab_size = ab.norm();
    let dot = |u: P, v: P| u.x * v.x + u.y * v.y;
    let sx = dot(as_, ab) / ab_size;
    let ex = dot(ae, ab) / ab_size;
    let sxex = ex - sx;
    let ap = source_point - a;
    let px = dot(ap, ab) / ab_size;
    let pxx = super::graph::closest_on_infinite(a, b, source_point).0;
    let ppxx = pxx - source_point;
    let d = ppxx.norm();
    let n = (ppxx.sqnorm() as f64).sqrt();
    let perp = (-(ppxx.y as f64), ppxx.x as f64);
    let (rot_cos, rot_sin) = if n > 0.0 { (perp.0 / n, perp.1 / n) } else { perp };
    if d == 0 {
        return vec![start, end];
    }
    let marking_bound = libm::atan(transitioning_angle as f64 * 0.5);
    let mut msx = (-marking_bound * d as f64) as i64;
    let mut mex = (marking_bound * d as f64) as i64;
    let marking_start_end_h = msx * msx / (2 * d) + d / 2;
    let mut marking_start = rotated(p(msx, marking_start_end_h), rot_cos, rot_sin) + pxx;
    let mut marking_end = rotated(p(mex, marking_start_end_h), rot_cos, rot_sin) + pxx;
    let dir: i64 = if sx > ex { -1 } else { 1 };
    if dir < 0 {
        std::mem::swap(&mut marking_start, &mut marking_end);
        std::mem::swap(&mut msx, &mut mex);
    }
    let mut add_marking_start = msx * dir > (sx - px) * dir && msx * dir < (ex - px) * dir;
    let mut add_marking_end = mex * dir > (sx - px) * dir && mex * dir < (ex - px) * dir;
    let apex = rotated(p(0, d / 2), rot_cos, rot_sin) + pxx;
    let mut add_apex = (sx - px) * dir < 0 && (ex - px) * dir > 0;
    if add_marking_start && add_marking_end && !add_apex {
        // Orca asserts that the apex is added when both markings are.
        add_apex = false;
    }
    let step_count = ((ex - sx).abs() as f64 / step as f64).round() as i64;
    let mut out = vec![start];
    for s in 1..step_count {
        let x = sx + sxex * s / step_count - px;
        let y = x * x / (2 * d) + d / 2;
        if add_marking_start && msx * dir < x * dir {
            out.push(marking_start);
            add_marking_start = false;
        }
        if add_apex && x * dir > 0 {
            out.push(apex);
            add_apex = false;
        }
        if add_marking_end && mex * dir < x * dir {
            out.push(marking_end);
            add_marking_end = false;
        }
        out.push(rotated(p(x, y), rot_cos, rot_sin) + pxx);
    }
    if add_apex {
        out.push(apex);
    }
    if add_marking_end {
        out.push(marking_end);
    }
    out.push(end);
    out
}
