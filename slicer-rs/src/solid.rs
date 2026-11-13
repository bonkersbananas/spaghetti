//! How solid infill fills a region, as Orca's `detect_narrow_internal_solid_infill` does: lines where they run
//! long enough, loops where the region is a narrow band (along a sloping wall, say), so the band prints as a few
//! long strokes instead of many short ones that make the printer shake.
//!
//! `split_narrow` ports Orca's `split_solid_surface` for line patterns: lines a spacing apart, at the infill's
//! angle, through the region's core (what remains of the parts at least four spacings wide, grown back by three);
//! runs of short lines that would only zig-zag are dropped (PrusaSlicer's filter against vibrating extrusions,
//! which Orca took over); the strips the remaining lines cover are lines, the rest of the region loops.
//!
//! `narrow_loops` stands in for Orca's Arachne fill of the narrow parts (`FillConcentricInternal`): beads a solid
//! line's spacing wide, as many as the band's width holds by Arachne's rules, so a band thinner than two beads is
//! one line along its middle, as wide as the band (at least 85 % of the nozzle); a wider one gets a loop half a
//! bead in from its edge, and so on inwards. Each bead fills its share of the band exactly.

use crate::geom::{self, Pt, Shape, Shapes};
use crate::medial;

/// mm: lines longer than this never shake the printer (PrusaSlicer's `MAX_LINE_LENGTH_TO_FILTER`).
const MAX_LINE_LENGTH_TO_FILTER: f64 = 4.0;
/// How many long lines a run of short ones may pass through and still be filtered.
const MAX_SKIPS_ALLOWED: i32 = 2;
/// How many short lines in a row are filtered whatever their neighbours.
const MIN_DEPTH_FOR_LINE_REMOVING: i32 = 5;

/// A region split into where lines go and where loops go (the lines' part overlaps the loops' by half a spacing,
/// as Orca's does, so nothing is left between them); `None` when it is all lines.
pub fn split_narrow(area: &Shape, spacing: f64, direction: f64) -> Option<(Shapes, Shapes)> {
    let sp = spacing * geom::SCALE;
    let bb = geom::bbox_of(area);
    let centre = ((bb[0] as f64 + bb[2] as f64) / 2.0, (bb[1] as f64 + bb[3] as f64) / 2.0);
    // Turn so the lines are vertical (Orca turns by π minus its fill angle, the line's way plus a quarter turn).
    let angle = std::f64::consts::FRAC_PI_2 - direction;
    let turn = |q: Pt, angle: f64| -> Pt {
        let (s, c) = angle.sin_cos();
        let (x, y) = (q.x as f64 - centre.0, q.y as f64 - centre.1);
        geom::pt((centre.0 + c * x - s * y).round() as i32, (centre.1 + c * y + s * x).round() as i32)
    };
    let filled: Shapes = vec![area.iter().map(|c| c.iter().map(|&q| turn(q, angle)).collect()).collect()];
    let fb = geom::bbox(&filled)?;
    let eroded = if max_inradius(area) < 2.0 * sp { Vec::new() } else { geom::offset(&filled, -2.0 * spacing) };
    if eroded.is_empty() {
        // No core at all: the whole region loops.
        return Some((Vec::new(), vec![area.clone()]));
    }
    let core = geom::intersection(&filled, &geom::offset(&eroded, 3.0 * spacing));
    let core = geom::offset(&core, -0.5 * spacing);

    // Sections of the vertical lines through the core longer than a spacing.
    let n_vlines = ((fb[2] as f64 - fb[0] as f64 + sp - 1.0) / sp).floor().max(0.0) as usize;
    let mut sections: Vec<Vec<(f64, f64, f64)>> = vec![Vec::new(); n_vlines];
    let mut ys: Vec<f64> = Vec::new();
    for (i, section) in sections.iter_mut().enumerate() {
        let x = fb[0] as f64 + i as f64 * sp;
        ys.clear();
        for shape in &core {
            for contour in shape {
                let n = contour.len();
                for k in 0..n {
                    let (a, b) = (contour[k], contour[(k + 1) % n]);
                    let (ax, bx) = (a.x as f64, b.x as f64);
                    if (ax <= x && x < bx) || (bx <= x && x < ax) {
                        ys.push(a.y as f64 + (x - ax) * (b.y as f64 - a.y as f64) / (bx - ax));
                    }
                }
            }
        }
        ys.sort_by(f64::total_cmp);
        for pair in ys.as_chunks::<2>().0 {
            if pair[1] - pair[0] > sp {
                section.push((x, pair[0], pair[1]));
            }
        }
    }
    let sections = filter_vibrating(&sections, MAX_LINE_LENGTH_TO_FILTER * geom::SCALE);
    let normal = reconstruct(&sections, sp);
    if normal.is_empty() && sections.iter().all(Vec::is_empty) {
        // No core at all: the whole region loops.
        return Some((Vec::new(), vec![area.clone()]));
    }
    let normal: Vec<geom::Contour> =
        normal.into_iter().map(|c| c.into_iter().map(|q| turn(q, -angle)).collect()).collect();
    let mut normal = geom::union_contours(&normal);
    let region: Shapes = vec![area.clone()];
    let mut narrow = geom::difference(&region, &normal);
    // Bits narrower than a line that touch the lines' part go with it.
    let mut merged = false;
    narrow.retain(|piece| {
        let one: Shapes = vec![piece.clone()];
        if max_inradius(piece) >= 0.5 * sp && !geom::offset(&one, -0.5 * spacing).is_empty() {
            return true;
        }
        let grown = geom::offset(&one, 0.3 * spacing);
        let near = geom::near(&normal, geom::inflate(geom::bbox_of(piece), 0.3 * spacing));
        if geom::intersection(&near, &grown).is_empty() {
            return true;
        }
        merged = true;
        normal.push(piece.clone());
        false
    });
    if narrow.is_empty() {
        return None;
    }
    if merged {
        normal = geom::union_contours(&normal.concat());
    }
    let normal = geom::intersection(&geom::offset(&normal, 0.5 * spacing), &region);
    Some((normal, narrow))
}

/// At least the radius of the largest disc inside the shape (units): twice its area over its perimeter.
fn max_inradius(shape: &Shape) -> f64 {
    let area: f64 = shape.iter().map(|c| geom::area2(c) as f64 / 2.0).sum();
    let perimeter: f64 = shape.iter().map(|c| geom::length_mm(c, true) * geom::SCALE).sum();
    if perimeter > 0.0 { 2.0 * area.max(0.0) / perimeter } else { 0.0 }
}

/// A section of a vertical line in the core, with what the filter knows of it.
struct Node {
    x: f64,
    lo: f64,
    hi: f64,
    prev: Vec<usize>,
    next: Vec<usize>,
    removed: bool,
    min_skips: i32,
    short_lines: i32,
    touches_long: bool,
    initialized: bool,
}

impl Node {
    fn length(&self) -> f64 {
        self.hi - self.lo
    }

    fn reset(&mut self) {
        self.min_skips = 0;
        self.short_lines = 0;
        self.touches_long = false;
        self.initialized = false;
    }
}

/// PrusaSlicer's `filter_vibrating_extrusions` (as Orca has it): drops runs of short sections that zig-zag from
/// line to line, keeping those that lead on to long ones.
fn filter_vibrating(sections: &[Vec<(f64, f64, f64)>], max_len: f64) -> Vec<Vec<(f64, f64, f64)>> {
    let mut nodes: Vec<Node> = Vec::new();
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::new();
    for section in sections {
        let start = nodes.len();
        nodes.extend(section.iter().map(|&(x, lo, hi)| Node {
            x,
            lo,
            hi,
            prev: Vec::new(),
            next: Vec::new(),
            removed: false,
            min_skips: 0,
            short_lines: 0,
            touches_long: false,
            initialized: false,
        }));
        ranges.push(start..nodes.len());
    }
    let overlapping = |a: &Node, b: &Node| {
        (b.lo <= a.lo && a.lo <= b.hi)
            || (b.lo <= a.hi && a.hi <= b.hi)
            || (a.lo <= b.lo && b.lo <= a.hi)
            || (a.lo <= b.hi && b.hi <= a.hi)
    };
    for s in 1..ranges.len() {
        for i in ranges[s].clone() {
            for j in ranges[s - 1].clone() {
                if overlapping(&nodes[i], &nodes[j]) {
                    nodes[i].prev.push(j);
                    nodes[j].next.push(i);
                }
            }
        }
    }
    let is_short = |n: &Node| n.length() < max_len;
    let touching_long_before =
        |nodes: &[Node], i: usize| nodes[i].prev.iter().any(|&p| !nodes[p].removed && !is_short(&nodes[p]));
    let can_remove = |nodes: &[Node], i: usize| {
        let n = &nodes[i];
        let initial_touches = n.prev.iter().any(|&p| nodes[p].touches_long);
        let has_next = n.next.iter().any(|&q| !nodes[q].removed);
        is_short(n) && (n.short_lines > MIN_DEPTH_FOR_LINE_REMOVING || (!initial_touches && !has_next))
    };
    // First in, first out: `queue[head..]` is waiting.
    let mut queue: Vec<usize> = Vec::new();
    for initial in 0..ranges.len() {
        for i in ranges[initial].clone() {
            if nodes[i].removed || !is_short(&nodes[i]) {
                continue;
            }
            nodes[i].reset();
            nodes[i].short_lines = 1;
            nodes[i].touches_long = touching_long_before(&nodes, i);
            nodes[i].initialized = true;
        }
        for s in initial..ranges.len() {
            if s + 1 < ranges.len() {
                for i in ranges[s + 1].clone() {
                    nodes[i].reset();
                }
            }
            for i in ranges[s].clone() {
                if nodes[i].removed || !nodes[i].initialized {
                    continue;
                }
                for k in 0..nodes[i].next.len() {
                    let nb = nodes[i].next[k];
                    if nodes[nb].removed {
                        continue;
                    }
                    let short = is_short(&nodes[nb]);
                    let skip_allowed = nodes[i].min_skips < MAX_SKIPS_ALLOWED;
                    if !short && !skip_allowed {
                        continue;
                    }
                    let total = nodes[i].short_lines + short as i32;
                    let skips = nodes[i].min_skips + !short as i32;
                    let touches = nodes[i].touches_long;
                    let n = &mut nodes[nb];
                    if n.initialized {
                        n.min_skips = n.min_skips.max(total).min(skips);
                        if n.touches_long {
                            n.touches_long = touches;
                        }
                    } else {
                        n.short_lines = total;
                        n.min_skips = skips;
                        n.touches_long = touches;
                        n.initialized = true;
                    }
                }
                if can_remove(&nodes, i) {
                    nodes[i].removed = true;
                    queue.clear();
                    queue.extend(nodes[i].prev.iter().copied().filter(|&p| !nodes[p].removed));
                    let mut head = 0;
                    while head < queue.len() {
                        let p = queue[head];
                        head += 1;
                        if can_remove(&nodes, p) {
                            nodes[p].removed = true;
                            let more: Vec<usize> =
                                nodes[p].prev.iter().copied().filter(|&q| !nodes[q].removed).collect();
                            queue.extend(more);
                        }
                    }
                }
            }
        }
    }
    ranges.iter().map(|r| nodes[r.clone()].iter().filter(|n| !n.removed).map(|n| (n.x, n.lo, n.hi)).collect()).collect()
}

/// Orca's reconstruction of the area the kept sections cover: each section grown half a spacing along its line,
/// traced from line to line into polygons (a strip ends where its section has no single successor).
fn reconstruct(sections: &[Vec<(f64, f64, f64)>], sp: f64) -> Vec<geom::Contour> {
    struct Traced {
        lows: Vec<(f64, f64)>,
        highs: Vec<(f64, f64)>,
    }
    let half = sp / 2.0;
    let limit2 = (2.0 * sp) * (2.0 * sp);
    let d2 = |a: (f64, f64), b: (f64, f64)| (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2);
    let mut out: Vec<geom::Contour> = Vec::new();
    let close = |t: &mut Traced, out: &mut Vec<geom::Contour>| {
        let mut points: Vec<Pt> = t.lows.iter().map(|&(x, y)| geom::pt(x.round() as i32, y.round() as i32)).collect();
        points.extend(t.highs.iter().rev().map(|&(x, y)| geom::pt(x.round() as i32, y.round() as i32)));
        if points.len() >= 3 {
            // Lows left to right, then highs back: counter-clockwise.
            out.push(points);
        }
        t.lows.clear();
        t.highs.clear();
    };
    let mut traced: Vec<Traced> = Vec::new();
    for slice in sections {
        let segs: Vec<((f64, f64), (f64, f64))> =
            slice.iter().map(|&(x, lo, hi)| ((x, lo - half), (x, hi + half))).collect();
        let mut used = vec![false; segs.len()];
        for t in traced.iter_mut() {
            let low = *t.lows.last().unwrap();
            let high = *t.highs.last().unwrap();
            let begin = segs.partition_point(|s| s.1.1 <= low.1);
            let end = segs.partition_point(|s| s.0.1 <= high.1);
            let mut added = false;
            let mut c = begin;
            while c < end && !added {
                if used[c] {
                    c += 1;
                    continue;
                }
                // As Orca: the first candidate's ends, whichever candidate is free.
                let (a, b) = segs[begin];
                if d2(low, a) < limit2 {
                    t.lows.push(a);
                } else {
                    t.lows.push((low.0 + half, low.1));
                    t.lows.push((a.0 - half, a.1));
                    t.lows.push(a);
                }
                if d2(high, b) < limit2 {
                    t.highs.push(b);
                } else {
                    t.highs.push((high.0 + half, high.1));
                    t.highs.push((b.0 - half, b.1));
                    t.highs.push(b);
                }
                added = true;
                used[begin] = true;
                c += 1;
            }
            if !added {
                t.lows.push((low.0 + half, low.1));
                t.highs.push((high.0 + half, high.1));
                close(t, &mut out);
            }
        }
        traced.retain(|t| !t.lows.is_empty());
        for (k, s) in segs.iter().enumerate() {
            if !used[k] {
                traced.push(Traced { lows: vec![(s.0.0 - half, s.0.1), s.0], highs: vec![(s.1.0 - half, s.1.1), s.1] });
            }
        }
    }
    for t in traced.iter_mut() {
        close(t, &mut out);
    }
    out
}

/// A line of varying width: Arachne's widths, each bead's share of the band, so it takes `width × height` mm³ a mm.
#[derive(Clone, Debug)]
pub struct ThickPath {
    pub points: Vec<Pt>,
    pub widths: Vec<f64>,
}

/// The narrow region filled with beads `w` mm apart (`nozzle` sets Arachne's narrowest bead and feature), in print
/// order from `at`: loops half a bead in from the edge where two more beads fit, lines along the middle of what
/// is too thin for that. Each ends a tenth of the nozzle short of where it started (Orca's seam gap), as Orca's.
pub fn narrow_loops(region: &Shapes, w: f64, nozzle: f64, at: Pt) -> Vec<ThickPath> {
    let min_bead = 0.85 * nozzle;
    let min_feature = 0.25 * nozzle;
    // Arachne's width for two beads: one bead plus as much as splitting the middle bead needs.
    let split_middle = (2.0 * min_bead / w - 1.0).clamp(0.01, 0.99);
    let two_beads = w * (1.0 + split_middle);
    let safety = 2.0 / geom::SCALE;
    let mut paths: Vec<ThickPath> = Vec::new();
    let centre_lines = |shapes: &Shapes, paths: &mut Vec<ThickPath>| {
        for shape in shapes {
            // Nowhere as wide as the narrowest feature: no line (and no Voronoi diagram to pay for).
            if max_inradius(shape) < min_feature / 2.0 * geom::SCALE {
                continue;
            }
            for line in medial::axis(shape, min_feature, 2.0 * two_beads) {
                let widths = line.widths.iter().map(|&t| t.max(min_bead)).collect();
                paths.push(ThickPath { points: line.points, widths });
            }
        }
    };
    // Arachne simplifies its outline first (to 0.025 mm; this to 0.05, as the Voronoi diagram costs by the edge
    // and the lines hardly move).
    let mut rest = geom::simplify_shapes(region, 0.05);
    for _ in 0..1000 {
        if rest.is_empty() {
            break;
        }
        // Where two beads fit: what is left of the region shrunk by two beads' half width. Nowhere: only lines
        // along the middle.
        if rest.iter().all(|shape| max_inradius(shape) < two_beads / 2.0 * geom::SCALE) {
            break;
        }
        let core = geom::offset(&rest, -two_beads / 2.0);
        if core.is_empty() {
            break;
        }
        // The loop runs half a bead in from the edge, where the region is two beads wide.
        let ring = geom::offset(&core, (two_beads - w) / 2.0);
        let reached = geom::offset(&core, two_beads / 2.0 + safety);
        let thin = geom::difference(&rest, &reached);
        centre_lines(&thin, &mut paths);
        for shape in &ring {
            for contour in shape {
                if contour.len() >= 3 {
                    let mut points = contour.clone();
                    points.push(points[0]);
                    paths.push(ThickPath { widths: vec![w; points.len()], points });
                }
            }
        }
        rest = geom::offset(&core, two_beads / 2.0 - w);
    }
    centre_lines(&rest, &mut paths);

    // Loops start nearest where the nozzle is; every path ends short by the seam gap.
    let clip = 0.1 * nozzle * geom::SCALE;
    for p in &mut paths {
        if p.points.len() > 2 && p.points[0] == *p.points.last().unwrap() {
            p.points.pop();
            p.widths.pop();
            let k = (0..p.points.len())
                .min_by(|&a, &b| geom::dist(p.points[a], at).total_cmp(&geom::dist(p.points[b], at)))
                .unwrap_or(0);
            p.points.rotate_left(k);
            p.widths.rotate_left(k);
            p.points.push(p.points[0]);
            p.widths.push(p.widths[0]);
        }
        clip_end(p, clip);
    }
    paths.retain(|p| p.points.len() >= 2);
    // Nearest first.
    let mut ordered = Vec::with_capacity(paths.len());
    let mut cur = at;
    while !paths.is_empty() {
        let k = (0..paths.len())
            .min_by(|&a, &b| geom::dist(paths[a].points[0], cur).total_cmp(&geom::dist(paths[b].points[0], cur)))
            .unwrap();
        let p = paths.swap_remove(k);
        cur = *p.points.last().unwrap();
        ordered.push(p);
    }
    ordered
}

/// Shortens a path by `d` units at its end.
fn clip_end(p: &mut ThickPath, mut d: f64) {
    while p.points.len() >= 2 && d > 0.0 {
        let n = p.points.len();
        let (a, b) = (p.points[n - 2], p.points[n - 1]);
        let len = geom::dist(a, b);
        if len > d {
            let t = (len - d) / len;
            p.points[n - 1] = geom::pt(
                (a.x as f64 + (b.x - a.x) as f64 * t).round() as i32,
                (a.y as f64 + (b.y - a.y) as f64 * t).round() as i32,
            );
            p.widths[n - 1] = p.widths[n - 2] + (p.widths[n - 1] - p.widths[n - 2]) * t;
            return;
        }
        d -= len;
        p.points.pop();
        p.widths.pop();
    }
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
    fn a_wide_region_is_all_lines() {
        assert!(split_narrow(&rect(0.0, 0.0, 20.0, 20.0), 0.4, 90f64.to_radians()).is_none());
    }

    #[test]
    fn corners_where_lines_get_short_loop() {
        // Across a square at 45°, the lines shorten below 4 mm in the two corners they cut across: those zig-zags
        // would shake the printer, so the corners loop.
        let (normal, narrow) = split_narrow(&rect(0.0, 0.0, 20.0, 20.0), 0.4, 45f64.to_radians()).unwrap();
        let (a_normal, a_narrow) = (geom::area_mm2(&normal), geom::area_mm2(&narrow));
        assert_eq!(narrow.len(), 2, "{narrow:?}");
        for piece in &narrow {
            let b = geom::bbox_of(piece);
            let top_left = b[0] == 0 && b[3] == geom::sc(20.0);
            let bottom_right = b[2] == geom::sc(20.0) && b[1] == 0;
            assert!(top_left || bottom_right, "{b:?}");
        }
        assert!(a_narrow > 0.2 && a_narrow < 8.0, "{a_narrow}");
        assert!(a_normal > 390.0, "{a_normal}");
    }

    #[test]
    fn a_band_too_narrow_for_a_core_is_all_loops() {
        let (normal, narrow) = split_narrow(&rect(0.0, 0.0, 20.0, 1.0), 0.4, 45f64.to_radians()).unwrap();
        assert!(normal.is_empty());
        assert!((geom::area_mm2(&narrow) - 20.0).abs() < 0.1);
    }

    #[test]
    fn a_band_beside_a_wide_part_loops_but_the_part_does_not() {
        // A 20 mm square with a 1 mm band 20 mm long off its side: the band loops.
        let shape = geom::union(&vec![rect(0.0, 0.0, 20.0, 20.0)], &vec![rect(20.0, 0.0, 40.0, 1.0)]);
        let (normal, narrow) = split_narrow(&shape[0], 0.4, 0.0).unwrap();
        let (a_normal, a_narrow) = (geom::area_mm2(&normal), geom::area_mm2(&narrow));
        assert!(a_normal > 390.0 && a_normal < 410.0, "{a_normal}");
        // The band, and as in Orca the strip the last line leaves along the square's side it joins.
        assert!(a_narrow > 19.0 && a_narrow < 29.0, "{a_narrow}");
    }

    #[test]
    fn a_thin_band_is_one_line_along_its_middle() {
        let paths = narrow_loops(&vec![rect(0.0, 0.0, 20.0, 0.5)], 0.38, 0.4, geom::pt(0, 0));
        assert_eq!(paths.len(), 1, "{paths:?}");
        assert!(paths[0].widths.iter().all(|&w| (w - 0.5).abs() < 0.01), "{:?}", paths[0].widths);
    }

    #[test]
    fn a_band_two_beads_wide_is_one_loop() {
        let paths = narrow_loops(&vec![rect(0.0, 0.0, 20.0, 0.8)], 0.38, 0.4, geom::pt(0, 0));
        assert_eq!(paths.len(), 1, "{paths:?}");
        let length = geom::length_mm(&paths[0].points, false);
        // Around a strip 0.42 mm wide, less the seam gap.
        assert!((length - 2.0 * (19.62 + 0.42) + 0.04).abs() < 0.2, "{length}");
    }
}
