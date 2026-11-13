//! The medial axis of a narrow region: the line along its middle, with the region's width at each point. It comes
//! from the Voronoi diagram of the region's edges, as in Orca's gap fill (which uses Boost's Voronoi; this uses its
//! Rust port). Gap fill extrudes along it, as wide as the region is.

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

/// The middle of `shape` where it is between `min_width` and `max_width` wide (mm), as lines.
pub fn axis(shape: &Shape, min_width: f64, max_width: f64) -> Vec<ThickLine> {
    let mut segments: Vec<[i32; 4]> = Vec::new();
    for contour in shape {
        let n = contour.len();
        for i in 0..n {
            let (a, b) = (contour[i], contour[(i + 1) % n]);
            if a != b {
                segments.push([a.x, a.y, b.x, b.y]);
            }
        }
    }
    if segments.len() < 3 {
        return Vec::new();
    }
    let built = Builder::<i32>::default().with_segments(segments.iter().map(|s| Line::<i32>::from(*s)));
    let Ok(diagram) = built.and_then(|b| b.build()) else { return Vec::new() };
    let region: Shapes = vec![shape.clone()];

    // How far a point is from the site that made a cell: its segment, or one of the segment's ends.
    let distance = |cell: &Cell, x: f64, y: f64| -> f64 {
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
        let w = [2.0 * distance(cell, a.x(), a.y()), 2.0 * distance(cell, b.x(), b.y())];
        if w[0].max(w[1]) < min_units || w[0].min(w[1]) > max_units {
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
    fn a_wide_region_has_no_gap_line() {
        assert!(axis(&rect(0.0, 0.0, 10.0, 5.0), 0.05, 0.8).is_empty());
    }
}
