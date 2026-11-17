//! Concentric fill, as Orca's `FillConcentric::_fill_surface_single` makes it where it does not use Arachne: the
//! region drawn in by one spacing over its density again and again, every outline of each step a loop (the solid
//! surfaces of an Arachne project are Arachne's loops, `solid.rs`). That is sparse concentric infill (a density
//! below 100 %: `use_arachne` only takes a full one) and concentric ironing.
//!
//! Loops are read from the outside in, each followed by those inside it (`union_chained_outside_in`), started at the
//! vertex nearest where the last one started (the first from the plate's origin) and shortened by `loop_clipping`.

use crate::geom::{self, Contour, Pt, SCALE, Shape};

/// Orca's `Fill::_adjust_solid_spacing`: the distance between loops that fits a whole number of them across `width`
/// (nm), widened by at most a fifth.
fn adjusted(width: i64, distance: i64) -> i64 {
    const EPSILON: f64 = 1e-4;
    let intervals = ((width as f64 - EPSILON) / distance as f64) as i64;
    let new = if intervals == 0 { distance } else { ((width as f64 - EPSILON) / intervals as f64) as i64 };
    if new as f64 / distance as f64 > 1.2 { (distance as f64 * 1.2 + 0.5).floor() as i64 } else { new }
}

/// The loops of one region: lines `spacing` mm apart at `density` (0 to 1), clipped by `clip` mm at their end. At
/// full density the distance between loops is adjusted to the region's width (`adjust`), as ironing's is.
pub fn fill(region: &Shape, spacing: f64, density: f64, adjust: bool, clip: f64) -> Vec<Contour> {
    let nm = |mm: f64| (mm * 1e6) as i64;
    let min_spacing = nm(spacing);
    let mut distance = (min_spacing as f64 / density) as i64;
    if min_spacing <= 0 || distance <= 0 || region.first().is_none_or(|c| c.len() < 3) {
        return Vec::new();
    }
    if density > 0.9999 && adjust {
        let b = geom::bbox_of(region);
        let width = ((b[2] - b[0]) as f64 / SCALE * 1e6) as i64;
        distance = adjusted(width, distance);
    }
    let off = |s: &geom::Shapes, d: f64| geom::offset_c2(s, d, geom::Join::Miter(3.0));
    let mut last: geom::Shapes = vec![region.clone()];
    let mut loops: Vec<Contour> = last.iter().flatten().cloned().collect();
    while !last.is_empty() {
        let inner = off(&last, -((distance + min_spacing / 2) as f64) / 1e6);
        last = off(&inner, (min_spacing / 2) as f64 / 1e6);
        loops.extend(last.iter().flatten().cloned());
    }
    let mut out: Vec<Contour> = Vec::new();
    let mut at = geom::pt(0, 0);
    for l in geom::union_chained_outside_in(&loops) {
        if l.is_empty() {
            continue;
        }
        let start = (0..l.len()).min_by(|&a, &b| geom::dist(l[a], at).total_cmp(&geom::dist(l[b], at))).unwrap_or(0);
        let mut line: Vec<Pt> = l[start..].iter().chain(l[..start].iter()).copied().collect();
        line.push(line[0]);
        at = line[0];
        clip_end(&mut line, clip * SCALE);
        if line.len() >= 2 {
            out.push(line);
        }
    }
    out
}

/// `Polyline::clip_end`: the line shortened by `d` units at its end.
fn clip_end(line: &mut Vec<Pt>, mut d: f64) {
    while d > 0.0 {
        let Some(last) = line.pop() else { break };
        let Some(&prev) = line.last() else { break };
        let (vx, vy) = (f64::from(prev.x) - f64::from(last.x), f64::from(prev.y) - f64::from(last.y));
        let l2 = vx * vx + vy * vy;
        if l2 > d * d {
            let f = d / l2.sqrt();
            line.push(geom::pt((f64::from(last.x) + vx * f) as i32, (f64::from(last.y) + vy * f) as i32));
            return;
        }
        d -= l2.sqrt();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::sc;

    fn square(size: f64) -> Shape {
        vec![vec![geom::pt(0, 0), geom::pt(sc(size), 0), geom::pt(sc(size), sc(size)), geom::pt(0, sc(size))]]
    }

    #[test]
    fn loops_are_a_distance_apart_unless_adjusted_to_the_width() {
        // A strip 1.737 mm wide (a Benchy's roof), lines 0.15 mm apart: ironing keeps `FillParams::dont_adjust`'s
        // default, so loops 0.15 mm apart (native Orca 2.5.1: 0.149 mm), seven of them; a full-density sparse fill
        // takes `_adjust_solid_spacing`: 11 intervals of 0.1579 mm, six loops.
        let strip: Shape =
            vec![vec![geom::pt(0, 0), geom::pt(sc(1.737), 0), geom::pt(sc(1.737), sc(7.6)), geom::pt(0, sc(7.6))]];
        let x0 = |l: &Contour| l.iter().map(|p| p.x).min().unwrap();
        let gap = |loops: &[Contour]| f64::from(x0(&loops[1]) - x0(&loops[0])) / SCALE;
        let kept = fill(&strip, 0.15, 1.0, false, 0.0);
        assert_eq!(kept.len(), 6, "{} loops", kept.len());
        assert!((gap(&kept) - 0.15).abs() < 0.001, "{}", gap(&kept));
        let spread = fill(&strip, 0.15, 1.0, true, 0.0);
        assert!((gap(&spread) - 0.1579).abs() < 0.001, "{}", gap(&spread));
    }

    #[test]
    fn a_square_fills_with_nested_loops_a_distance_apart() {
        // 10 mm square, 0.4 mm lines at 20 %: loops 2 mm apart, the outermost on the edge.
        let loops = fill(&square(10.0), 0.4, 0.2, false, 0.0);
        assert!(loops.len() >= 3 && loops.len() <= 4, "{} loops", loops.len());
        let x0 = |l: &Contour| l.iter().map(|p| p.x).min().unwrap();
        assert_eq!(x0(&loops[0]), 0);
        let gap = f64::from(x0(&loops[1]) - x0(&loops[0])) / SCALE;
        assert!((gap - 2.0).abs() < 0.01, "{gap}");
        // Each loop is closed; clipped ones stop short of where they started.
        let clipped = fill(&square(10.0), 0.4, 0.2, false, 0.1);
        assert!(clipped[0].first() != clipped[0].last());
    }
}
