//! `only_one_wall_top` on Arachne walls (Orca 2.5.1's `process_arachne`, the "PS: One wall top surface for Arachne"
//! part and its ORCA helpers): where the layer above leaves a top surface uncovered, the island gets its outer wall
//! alone beside it, the inner walls going round the rest of the region, numbered from both edges; the top surface's
//! fill reaches up to the outer wall. An island with no top surface gets its walls as if the feature were off.
//!
//! Not here: the clipping of inner walls over the top with `top_surface_expansion` (`clip_inner_walls_over_top`).

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
    // Onion the region round the top surface (`top_fill_replaces_inner_walls` is off: no clipping).
    let region = off(&geom::difference(&infill, &top), p.wall_0_inset);
    let (mut inner_groups, inner_contour) = generate(&region, p.spacing, p.spacing, p.wall_loops - 1, 0.0);
    if !groups.is_empty() {
        for l in inner_groups.iter_mut().flatten() {
            l.inset += 1;
        }
    }
    if groups.len() == 1 {
        let outer_touch = if p.precise { p.ext_spacing + p.spacing / 2.0 } else { (p.ext_spacing + p.spacing) / 2.0 };
        renumber(&groups[0], &mut inner_groups, outer_touch, p.spacing);
    }
    groups.extend(inner_groups);
    Walls { groups, inner: geom::union(&top, &inner_contour), top }
}
