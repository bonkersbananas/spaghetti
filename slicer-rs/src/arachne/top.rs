//! `only_one_wall_top` on Arachne walls (Orca 2.5.1's `process_arachne`, the "PS: One wall top surface for Arachne"
//! part and its ORCA helpers): where the layer above leaves a top surface uncovered, the island gets its outer wall
//! alone beside it, the inner walls going round the rest of the region, numbered from both edges; the top surface's
//! fill reaches up to the outer wall. An island with no top surface gets its walls as if the feature were off.
//!
//! With `top_surface_expansion` the inner walls are made round the whole region and cut where they run over the top
//! surface (`clip_inner_walls_over_top`), the top fill taking their place.

use crate::arachne::ioi::lines_touch;
use crate::geom::{self, Join, Pt, SCALE, Shapes};
use crate::region::{ArachneLine, Around};

/// Walls as `WallToolPaths` makes them: by inset, each with its lines.
pub type Groups = Vec<Vec<ArachneLine>>;

/// The numbers `process_arachne` has at hand (mm).
pub struct Params {
    pub ext_spacing: f64,
    pub spacing: f64,
    /// The inner wall's line width (`perimeter_flow.width`).
    pub width: f64,
    /// `wall_0_inset` (negative with `precise_outer_wall`, else 0).
    pub wall_0_inset: f64,
    pub precise: bool,
    /// `min_width_top_surface` in mm.
    pub min_width_top: f64,
    pub wall_loops: usize,
    /// `top_fill_replaces_inner_walls`: the top fill grows over the inner walls (`top_surface_expansion` and
    /// `top_surface_density` above zero).
    pub clip_over_top: bool,
}

/// What the walls leave: lines by inset, what is inside them (infill's area, not yet drawn in) and the top surface
/// whose fill reaches the outer wall (empty where there is none).
pub struct Walls {
    pub groups: Groups,
    pub inner: Shapes,
    pub top: Shapes,
}

/// `generate(outline, bead_width_0, bead_width_x, inset_count, wall_0_inset)`: `WallToolPaths` on an outline (mm).
pub type Generate<'a> = dyn Fn(&Shapes, f64, f64, usize, f64) -> (Groups, Shapes) + 'a;

fn off(shapes: &Shapes, delta: f64) -> Shapes {
    geom::offset_c2(shapes, delta, Join::Miter(3.0))
}

fn widest(groups: &Groups) -> f64 {
    groups.iter().flatten().flat_map(|l| l.widths.iter().copied()).fold(0.0, f64::max)
}

/// A line's bounding box grown by its widest bead.
fn grown_box(l: &ArachneLine) -> [i32; 4] {
    let (mut b, mut w) = ([i32::MAX, i32::MAX, i32::MIN, i32::MIN], 0.0f64);
    for (p, &width) in l.points.iter().zip(&l.widths) {
        b = [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)];
        w = w.max(width);
    }
    let g = (w * SCALE) as i32;
    [b[0] - g, b[1] - g, b[2] + g, b[3] + g]
}

fn boxes_meet(a: [i32; 4], b: [i32; 4]) -> bool {
    !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
}

fn touches(a: &ArachneLine, b: &ArachneLine, threshold: f64) -> bool {
    lines_touch((&a.points, &a.widths), (&b.points, &b.widths), threshold)
}

/// `renumber_inner_walls_by_depth`: the inner walls (already numbered from 1) numbered by how many walls lie between
/// them and the outer wall: those chained from the outer walls (inset 1 touching one, inset k touching inset k - 1)
/// keep their inset, any other takes one more than the deepest wall it touches, if any.
fn renumber(outer: &[ArachneLine], inner: &mut Groups, outer_touch: f64, inner_touch: f64) {
    let mut lines: Vec<ArachneLine> =
        inner.iter_mut().flat_map(std::mem::take).filter(|l| !l.points.is_empty()).collect();
    if lines.is_empty() {
        return;
    }
    let rounding = 0.001;
    let (outer_threshold, inner_threshold) = (outer_touch + rounding, inner_touch + rounding);
    let boxes: Vec<[i32; 4]> = lines.iter().map(grown_box).collect();
    let n = lines.len();
    let touch = |a: usize, b: usize| boxes_meet(boxes[a], boxes[b]) && touches(&lines[a], &lines[b], inner_threshold);
    // Walls numbered from the outer walls.
    let mut depth = vec![0usize; n];
    let mut frontier: Vec<usize> = Vec::new();
    for o in outer {
        let ob = grown_box(o);
        for i in 0..n {
            if depth[i] == 0
                && lines[i].inset == 1
                && boxes_meet(ob, boxes[i])
                && touches(o, &lines[i], outer_threshold)
            {
                depth[i] = 1;
                frontier.push(i);
            }
        }
    }
    let mut numbered = frontier.clone();
    let mut level = 1;
    while !frontier.is_empty() {
        let mut next = Vec::new();
        for i in 0..n {
            if depth[i] == 0 && lines[i].inset == level + 1 && frontier.iter().any(|&f| touch(f, i)) {
                depth[i] = level + 1;
                next.push(i);
            }
        }
        numbered.extend(&next);
        frontier = next;
        level += 1;
    }
    // The other walls, working away from those.
    frontier = numbered;
    while !frontier.is_empty() {
        let mut next = Vec::new();
        for i in 0..n {
            if depth[i] != 0 {
                continue;
            }
            let deepest = frontier.iter().filter(|&&f| touch(f, i)).map(|&f| depth[f]).max().unwrap_or(0);
            if deepest > 0 {
                depth[i] = deepest + 1;
                next.push(i);
            }
        }
        frontier = next;
    }
    // Group g holds the walls of inset g + 1.
    let all: Vec<(usize, ArachneLine)> = lines.drain(..).enumerate().collect();
    inner.clear();
    for (i, mut l) in all {
        if depth[i] > 0 {
            l.inset = depth[i];
        }
        while inner.len() < l.inset {
            inner.push(Vec::new());
        }
        inner[l.inset - 1].push(l);
    }
}

/// `length_off_reference`: how much of `walls`' centre lines lies further than `tolerance` from the `reference`
/// walls' and outside `excluded`.
fn length_off_reference(groups: &Groups, reference: &[ArachneLine], excluded: &Shapes, tolerance: f64) -> f64 {
    let lines = |ls: &mut dyn Iterator<Item = &ArachneLine>| -> Vec<Vec<Pt>> {
        ls.filter(|l| l.points.len() >= 2).map(|l| l.points.clone()).collect()
    };
    let walls = lines(&mut groups.iter().flatten());
    let reference = lines(&mut reference.iter());
    let grown: Vec<Shapes> = reference.iter().map(|r| geom::offset_open(r, tolerance)).collect();
    let refs: Vec<&Shapes> = grown.iter().collect();
    let mut away = geom::difference_open(&walls, &geom::union_all(&refs));
    if !excluded.is_empty() {
        away = geom::difference_open(&away, excluded);
    }
    away.iter().map(|l| geom::length_mm(l, false)).sum()
}

/// `walls_footprint`: the area covered by the walls at their local widths.
fn footprint(walls: &[ArachneLine]) -> Shapes {
    let mut pieces: Vec<Shapes> = Vec::new();
    for l in walls {
        for k in 1..l.points.len() {
            let width = l.widths[k - 1].max(l.widths[k]);
            if width > 0.0 {
                pieces.push(geom::offset_open(&[l.points[k - 1], l.points[k]], width / 2.0));
            }
        }
    }
    let refs: Vec<&Shapes> = pieces.iter().collect();
    geom::union_all(&refs)
}

/// `clip_inner_walls_over_top`: cuts out of the inner walls the parts running over the top surface, so geometry that
/// continues upward keeps its walls. A wall with next to nothing over the top (less than two widths) stays whole, its
/// footprint added to `kept` for the top fill to go round. `width` is the inner wall's line width (mm).
fn clip_over_top(groups: &mut Groups, top: &Shapes, width: f64, kept: &mut Vec<Shapes>) {
    let Some(b) = geom::bbox(top) else { return };
    let b = geom::inflate(b, 1e-4);
    let inside = |p: Pt| p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] && geom::contains(top, p);
    // Pulled back by half a wall width: the clip severs the centre line, but the bead's end reaches half a width past.
    let area = off(top, width / 2.0);
    let same = |p: Pt, q: Pt| (p.x - q.x).abs() <= 1 && (p.y - q.y).abs() <= 1;
    for group in groups.iter_mut() {
        let mut keep: Vec<ArachneLine> = Vec::with_capacity(group.len());
        for line in std::mem::take(group) {
            if line.points.is_empty() {
                continue;
            }
            let over = line.points.iter().filter(|&&p| inside(p)).count();
            if over == 0 {
                keep.push(line);
                continue;
            }
            if over == line.points.len() {
                continue;
            }
            let mut pieces: Vec<Vec<(Pt, f64)>> = geom::difference_open(std::slice::from_ref(&line.points), &area)
                .into_iter()
                .map(|piece| piece.into_iter().map(|p| (p, width_at(&line, p))).collect())
                .collect();
            // Clipper cuts a closed loop at its start and may turn pieces round: pieces sharing an end are joined.
            for i in 0..pieces.len() {
                let mut j = i + 1;
                while j < pieces.len() {
                    let a_first = pieces[i][0].0;
                    let (b_first, b_last) = (pieces[j][0].0, pieces[j][pieces[j].len() - 1].0);
                    if same(a_first, b_first) || same(a_first, b_last) {
                        pieces[i].reverse();
                    }
                    if same(pieces[i][pieces[i].len() - 1].0, b_last) {
                        pieces[j].reverse();
                    }
                    if same(pieces[i][pieces[i].len() - 1].0, pieces[j][0].0) {
                        let tail: Vec<(Pt, f64)> = pieces[j][1..].to_vec();
                        pieces[i].extend(tail);
                        pieces.remove(j);
                        j = i + 1;
                    } else {
                        j += 1;
                    }
                }
            }
            let length = |points: &[Pt]| geom::length_mm(points, false);
            let kept_length: f64 = pieces.iter().map(|p| length(&p.iter().map(|q| q.0).collect::<Vec<_>>())).sum();
            if length(&line.points) - kept_length < 2.0 * width {
                let w = line.widths.iter().copied().fold(0.0, f64::max);
                kept.push(geom::offset_open(&line.points, w / 2.0));
                keep.push(line);
                continue;
            }
            for piece in pieces {
                let points: Vec<Pt> = piece.iter().map(|q| q.0).collect();
                // Tiny leftovers would print as zits.
                if points.len() >= 2 && length(&points) >= width {
                    keep.push(ArachneLine {
                        inset: line.inset,
                        odd: line.odd,
                        closed: false,
                        widths: piece.iter().map(|q| q.1).collect(),
                        points,
                    });
                }
            }
        }
        *group = keep;
    }
}

/// The width a clipped line has at `p`: that of the vertex it is, else interpolated along the segment it lies on as
/// Orca's `clip_extrusion` does (the ratio of the distances, the width truncated to a nanometre).
fn width_at(line: &ArachneLine, p: Pt) -> f64 {
    if let Some(k) = line.points.iter().position(|&q| q == p) {
        return line.widths[k];
    }
    let mut best = (f64::MAX, 0usize);
    for k in 1..line.points.len() {
        let (a, b) = (line.points[k - 1], line.points[k]);
        let (dx, dy) = (f64::from(b.x - a.x), f64::from(b.y - a.y));
        let len2 = dx * dx + dy * dy;
        let t = if len2 == 0.0 {
            0.0
        } else {
            ((f64::from(p.x - a.x) * dx + f64::from(p.y - a.y) * dy) / len2).clamp(0.0, 1.0)
        };
        let d2 =
            (f64::from(a.x) + t * dx - f64::from(p.x)).powi(2) + (f64::from(a.y) + t * dy - f64::from(p.y)).powi(2);
        if d2 < best.0 {
            best = (d2, k);
        }
    }
    let k = best.1.max(1);
    let (a, b) = (line.points[k - 1], line.points[k]);
    let len = (f64::from(b.x - a.x)).hypot(f64::from(b.y - a.y));
    let dist = (f64::from(p.x - a.x)).hypot(f64::from(p.y - a.y));
    let t = if len == 0.0 { 0.0 } else { dist / len };
    let (w0, w1) = (line.widths[k - 1], line.widths[k]);
    w0 + ((w1 - w0) * t * 1e6).trunc() / 1e6
}

/// The walls of an island with `only_one_wall_top`: `last` is its outline drawn in as the walls start from it,
/// `generate` makes `WallToolPaths` for an outline.
pub fn walls(last: &Shapes, p: &Params, around: &Around, generate: &Generate) -> Walls {
    let tolerance = p.ext_spacing / 10.0;
    let safety = 1.0 / SCALE;
    // `get_top_expolygons`: what the layer above leaves of `contour`, less bridges and too thin parts, and whether
    // it leaves anything at all.
    let top_of = |contour: &Shapes| -> (Shapes, bool) {
        let Some(b) = geom::bbox(contour) else { return (Vec::new(), false) };
        let b = geom::inflate(b, 1e-4);
        let upper = around.upper.map(|u| geom::near(u, b)).unwrap_or_default();
        let mut top = geom::difference(contour, &upper);
        let uncovered = !top.is_empty();
        if !uncovered {
            return (top, false);
        }
        if let Some(lower) = around.lower {
            let bridges = off(&geom::difference(&top, &geom::near(lower, b)), p.ext_spacing.max(p.width));
            top = geom::difference(&top, &bridges);
        }
        let shrink = (p.ext_spacing / 4.0 + 0.00001).max(p.min_width_top / 4.0);
        top = off(&off(&top, -shrink), shrink + p.width * 0.85);
        (geom::intersection(&top, contour), true)
    };
    // Where the layer above covers all of the region (the usual case), nothing is uncovered anywhere inside it
    // (the single wall's inner contour and the nominal contour lie within it): the walls are the full ones.
    let covered = geom::bbox(last).is_some_and(|b| {
        let upper = around.upper.map(|u| geom::near(u, geom::inflate(b, 0.02))).unwrap_or_default();
        geom::difference(&off(last, 0.01), &upper).is_empty()
    });
    if covered {
        let (groups, inner) = generate(last, p.ext_spacing, p.spacing, p.wall_loops, p.wall_0_inset);
        return Walls { groups, inner, top: Vec::new() };
    }
    let (mut groups, inner) = generate(last, p.ext_spacing, p.spacing, 1, p.wall_0_inset);
    let mut infill = inner;
    let mut full: Option<(Groups, Shapes)> = None;
    let full_walls = |full: &mut Option<(Groups, Shapes)>| {
        full.get_or_insert_with(|| generate(last, p.ext_spacing, p.spacing, p.wall_loops, p.wall_0_inset)).clone()
    };
    // The single wall pass lets Arachne put two beads across a wall narrower than three outer walls, widening both;
    // over the top surface that is the intent, elsewhere it leaves no room for the inner walls. Where its outer walls
    // run away from the full pass's, outside the top surface, the full pass's outer walls and what is inside them
    // are taken.
    if widest(&groups) > p.ext_spacing + 2.0 * tolerance {
        let nominal = off(last, -(p.ext_spacing + p.wall_0_inset));
        let (top, uncovered) = top_of(&nominal);
        let zone = off(&top, p.ext_spacing);
        if uncovered {
            let (full_groups, _) = full_walls(&mut full);
            if let Some(front) = full_groups.first()
                && !front.is_empty()
                && length_off_reference(&groups, front, &zone, tolerance) > p.width
            {
                infill = geom::difference(&nominal, &off(&footprint(front), safety));
                groups = vec![front.clone()];
            }
        }
    }
    let (top, uncovered) = top_of(&infill);
    if !uncovered {
        let (full_groups, full_inner) = full_walls(&mut full);
        return Walls { groups: full_groups, inner: full_inner, top: Vec::new() };
    }
    // Onion the region inside the outer wall, and where the top fill replaces inner walls cut them off over the top
    // surface; else onion what is round it.
    let mut top = top;
    let region = if p.clip_over_top {
        off(&infill, p.wall_0_inset)
    } else {
        off(&geom::difference(&infill, &top), p.wall_0_inset)
    };
    let (mut inner_groups, inner_contour) = generate(&region, p.spacing, p.spacing, p.wall_loops - 1, 0.0);
    if p.clip_over_top {
        let mut kept = Vec::new();
        clip_over_top(&mut inner_groups, &top, p.width, &mut kept);
        // The top fill goes round the walls kept despite grazing the top.
        if !kept.is_empty() {
            let refs: Vec<&Shapes> = kept.iter().collect();
            top = geom::difference(&top, &geom::union_all(&refs));
        }
    }
    if !groups.is_empty() {
        for l in inner_groups.iter_mut().flatten() {
            l.inset += 1;
        }
    }
    if !p.clip_over_top && groups.len() == 1 {
        let outer_touch = if p.precise { p.ext_spacing + p.spacing / 2.0 } else { (p.ext_spacing + p.spacing) / 2.0 };
        renumber(&groups[0], &mut inner_groups, outer_touch, p.spacing);
    }
    groups.extend(inner_groups);
    Walls { groups, inner: geom::union(&top, &inner_contour), top }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn p(x: f64, y: f64) -> Pt {
        geom::pt(geom::sc(x), geom::sc(y))
    }

    fn line(points: &[(f64, f64)], closed: bool) -> ArachneLine {
        ArachneLine {
            inset: 2,
            odd: false,
            closed,
            points: points.iter().map(|&(x, y)| p(x, y)).collect(),
            widths: vec![0.45; points.len()],
        }
    }

    #[test]
    fn inner_walls_are_cut_where_they_run_over_the_top_surface() {
        // A top surface on the right half of a 20 mm square.
        let top: Shapes = vec![vec![vec![p(10.0, 0.0), p(20.0, 0.0), p(20.0, 20.0), p(10.0, 20.0)]]];
        let square = [(1.0, 1.0), (19.0, 1.0), (19.0, 19.0), (1.0, 19.0), (1.0, 1.0)];
        let beside = [(1.0, 5.0), (8.0, 5.0)];
        let over = [(12.0, 5.0), (18.0, 5.0)];
        // A wall that touches the top with less than two widths of it: kept whole.
        let grazing = [(1.0, 9.0), (10.3, 9.0)];
        let mut groups: Groups =
            vec![vec![line(&square, true), line(&beside, false), line(&over, false), line(&grazing, false)]];
        let mut kept = Vec::new();
        clip_over_top(&mut groups, &top, 0.45, &mut kept);
        let lines = &groups[0];
        // The loop is cut open (the top's edge pulled back by half a width: ends at 10 - 0.225), its left half stays
        // as one piece running from the bottom's cut round to the top's; the line beside it is whole; the line over
        // the top is gone; the grazing one stays and says where.
        assert_eq!(lines.len(), 3, "{}", lines.len());
        let piece = &lines[0];
        assert!(!piece.closed);
        let xs: Vec<f64> = piece.points.iter().map(|q| geom::unsc(q.x)).collect();
        assert!(xs.iter().all(|&x| x < 10.0 - 0.2), "{xs:?}");
        assert!(piece.widths.iter().all(|&w| (w - 0.45).abs() < 1e-9));
        assert_eq!(lines[1].points.len(), 2);
        assert_eq!(lines[2].points.last().copied(), Some(p(10.3, 9.0)));
        assert_eq!(kept.len(), 1);
    }
}
