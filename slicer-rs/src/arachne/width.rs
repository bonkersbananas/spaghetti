//! Orca 2.5.1's `VariableWidth.cpp`: a line of beads of varying width cut into extrusions of one width each, as G-code
//! can't vary the width within a move. `thick_polyline_to_multi_path` is what the Arachne walls use,
//! `thick_polyline_to_extrusion_paths_2` (through `variable_width`) what the fills use. Points are nanometres, widths
//! the beads' (spacings, nanometres) at each end of each segment; a path's width comes out as an extrusion width, mm.

use super::graph::{P, p};

/// One extrusion: its points and the width (mm) of its extrusion, as `Flow::width()` gives it.
#[derive(Clone, Debug, PartialEq)]
pub struct WidthPath {
    pub points: Vec<P>,
    pub width: f64,
}

/// A segment with a width at each end (`ThickLine`).
#[derive(Clone, Copy, Debug)]
struct ThickLine {
    a: P,
    b: P,
    a_width: f64,
    b_width: f64,
}

impl ThickLine {
    fn length(&self) -> f64 {
        (((self.b.x - self.a.x) as f64).powi(2) + ((self.b.y - self.a.y) as f64).powi(2)).sqrt()
    }
}

/// `ThickPolyline::thicklines`: the points with the width of each at both ends of its segments (`widths[2 i]` and
/// `widths[2 i + 1]` for segment `i`).
fn thick_lines(points: &[P], widths: &[f64]) -> Vec<ThickLine> {
    (0..points.len().saturating_sub(1))
        .map(|i| ThickLine { a: points[i], b: points[i + 1], a_width: widths[2 * i], b_width: widths[2 * i + 1] })
        .collect()
}

/// `to_thick_polyline`: a width per point (junction) becomes two per segment.
pub fn per_segment_widths(widths: &[f64]) -> Vec<f64> {
    let mut out = Vec::new();
    if widths.len() < 2 {
        return out;
    }
    out.push(widths[0]);
    out.push(widths[1]);
    for k in 2..widths.len() {
        out.push(widths[k - 1]);
        out.push(widths[k]);
    }
    out
}

/// Splits a line whose width changes by more than `tolerance` into equal pieces of nearly constant width, as both
/// functions do.
fn split_line(line: &ThickLine, tolerance: f64) -> Vec<ThickLine> {
    let thickness_delta = (line.a_width - line.b_width).abs();
    let line_len = line.length();
    let segments = (thickness_delta / tolerance).ceil() as usize;
    let seg_len = line_len / segments as f64;
    let (dx, dy) = ((line.b.x - line.a.x) as f64 / line_len, (line.b.y - line.a.y) as f64 / line_len);
    let mut pp = vec![line.a];
    let mut width = vec![line.a_width];
    for j in 1..segments {
        pp.push(p(
            (line.a.x as f64 + dx * (j as f64 * seg_len)) as i64,
            (line.a.y as f64 + dy * (j as f64 * seg_len)) as i64,
        ));
        let w = line.a_width + (j as f64 * seg_len) * (line.b_width - line.a_width) / line_len;
        width.push(w);
        width.push(w);
    }
    pp.push(line.b);
    width.push(line.b_width);
    (0..segments)
        .map(|j| ThickLine { a: pp[j], b: pp[j + 1], a_width: width[2 * j], b_width: width[2 * j + 1] })
        .collect()
}

/// A width (nanometres) as an extrusion width (mm) at layer height `h`: `Flow::with_width(unscale(w) + h (1 − π/4))`.
fn extrusion_width(w: f64, h: f64) -> f64 {
    ((w / 1e6) as f32 as f64 + h * (1.0 - 0.25 * std::f64::consts::PI)) as f32 as f64
}

const SCALED_EPSILON: f64 = 100.0;

/// `thick_polyline_to_multi_path` (not for bridges): lines of nearly one width, each cut at the width changes bigger
/// than `tolerance` (nm) into steps, each step an extrusion at the wider end's width, steps whose extrusion widths
/// are within `merge_tolerance` (nm) of the path's first joined.
pub fn thick_polyline_to_multi_path(
    points: &[P],
    widths: &[f64],
    h: f64,
    tolerance: f64,
    merge_tolerance: f64,
) -> Vec<WidthPath> {
    let mut multi: Vec<WidthPath> = Vec::new();
    let mut path: Option<WidthPath> = None;
    let mut lines = thick_lines(points, widths);
    let mut i: i64 = 0;
    while (i as usize) < lines.len() && i >= 0 {
        let line = lines[i as usize];
        let line_len = line.length();
        if line_len < SCALED_EPSILON {
            if let Some(pt) = path.as_mut() {
                *pt.points.last_mut().unwrap() = line.b;
            } else if (i as usize) + 1 < lines.len() {
                lines[i as usize + 1].a = line.a;
            } else if let Some(last) = multi.last_mut() {
                *last.points.last_mut().unwrap() = line.b;
            }
            i += 1;
            continue;
        }
        if (line.a_width - line.b_width).abs() > tolerance {
            let pieces = split_line(&line, tolerance);
            lines.remove(i as usize);
            for (j, l) in pieces.into_iter().enumerate() {
                lines.insert(i as usize + j, l);
            }
            continue;
        }
        let w = line.a_width.max(line.b_width);
        let new_width = extrusion_width(w, h);
        match path.as_mut() {
            None => {
                path = Some(WidthPath { points: vec![line.a, line.b], width: new_width });
            }
            Some(pt) => {
                if (pt.width - new_width).abs() * 1e6 <= merge_tolerance {
                    pt.points.push(line.b);
                } else {
                    multi.push(path.take().unwrap());
                    continue; // The same line again, starting a new path.
                }
            }
        }
        i += 1;
    }
    if let Some(pt) = path
        && pt.points.len() >= 2
    {
        multi.push(pt);
    }
    multi
}

/// `thick_polyline_to_extrusion_paths_2` (what `variable_width` calls): runs of lines whose widths stay within
/// `tolerance` (nm) of each other make one extrusion at their length-weighted mean width.
pub fn thick_polyline_to_extrusion_paths_2(points: &[P], widths: &[f64], h: f64, tolerance: f64) -> Vec<WidthPath> {
    let mut paths: Vec<WidthPath> = Vec::new();
    let mut lines = thick_lines(points, widths);
    let mut start_index = 0usize;
    let (mut max_width, mut min_width) = (0.0f64, 0.0f64);
    let mut i = 0usize;
    while i < lines.len() {
        let line = lines[i];
        if i == 0 {
            max_width = line.a_width;
            min_width = line.a_width;
        }
        let line_len = line.length();
        if line_len < SCALED_EPSILON {
            i += 1;
            continue;
        }
        let thickness_delta = (max_width - line.b_width).abs().max((min_width - line.b_width).abs());
        if thickness_delta > tolerance {
            if start_index != i {
                let mut length = lines[start_index].length();
                let mut sum = length * 0.5 * (lines[start_index].a_width + lines[start_index].b_width);
                let mut pts = vec![lines[start_index].a];
                for l in &lines[start_index + 1..i] {
                    length += l.length();
                    sum += l.length() * 0.5 * (l.a_width + l.b_width);
                    pts.push(l.a);
                }
                pts.push(lines[i].a);
                if length > SCALED_EPSILON {
                    paths.push(WidthPath { points: pts, width: extrusion_width(sum / length, h) });
                }
            }
            start_index = i;
            max_width = line.a_width;
            min_width = line.a_width;
            if (line.a_width - line.b_width).abs() > tolerance {
                let pieces = split_line(&line, tolerance);
                lines.remove(i);
                for (j, l) in pieces.into_iter().enumerate() {
                    lines.insert(i + j, l);
                }
                continue;
            }
        } else {
            max_width = max_width.max(line.a_width.max(line.b_width));
            min_width = min_width.min(line.a_width.min(line.b_width));
        }
        i += 1;
    }
    let final_size = lines.len();
    if start_index < final_size {
        let mut length = lines[start_index].length();
        // Orca weights the last run by each line's first width only.
        let mut sum = length * lines[start_index].a_width;
        let mut pts = vec![lines[start_index].a];
        for l in &lines[start_index + 1..final_size] {
            length += l.length();
            sum += l.length() * l.a_width;
            pts.push(l.a);
        }
        pts.push(lines[final_size - 1].b);
        if length > SCALED_EPSILON {
            paths.push(WidthPath { points: pts, width: extrusion_width(sum / length, h) });
        }
    }
    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(pts: &[(i64, i64)], w: &[f64]) -> (Vec<P>, Vec<f64>) {
        (pts.iter().map(|&(x, y)| p(x, y)).collect(), per_segment_widths(w))
    }

    #[test]
    fn a_constant_width_is_one_path() {
        let (pts, w) = line(&[(0, 0), (5_000_000, 0), (10_000_000, 0)], &[400_000.0; 3]);
        let m = thick_polyline_to_multi_path(&pts, &w, 0.2, 50_000.0, 100.0);
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].points.len(), 3);
        let p2 = thick_polyline_to_extrusion_paths_2(&pts, &w, 0.2, 50_000.0);
        assert_eq!(p2.len(), 1);
        assert!((p2[0].width - m[0].width).abs() < 1e-6);
    }

    #[test]
    fn a_taper_becomes_steps_of_the_tolerance() {
        // 0.3 mm to 0.5 mm over 10 mm: four steps of 0.05 mm, each an extrusion at its wider end.
        let (pts, w) = line(&[(0, 0), (10_000_000, 0)], &[300_000.0, 500_000.0]);
        let m = thick_polyline_to_multi_path(&pts, &w, 0.2, 50_000.0, 100.0);
        assert_eq!(m.len(), 4);
        assert!(m.windows(2).all(|x| x[1].width > x[0].width));
        assert_eq!(m[0].points[0], p(0, 0));
        assert_eq!(m[3].points.last().copied(), Some(p(10_000_000, 0)));
    }
}
