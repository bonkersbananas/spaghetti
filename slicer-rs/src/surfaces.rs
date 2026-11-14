//! The last word on what a layer's infill area prints as, after the shells (Orca's
//! `LayerRegion::process_external_surfaces`, growing regions as its `Algorithm::RegionExpansion` does): every bridge,
//! bottom and top surface grows into the solid and the sparse infill beside it, about one and a half walls' width
//! into solid infill and one wall's spacing into sparse, by waves that stay inside the region they grow into, so
//! they go round corners rather than through walls. Bridges whose growth meets become one bridge, which spans the
//! way its first part spans best. Sparse infill left in small pieces turns solid.

use crate::geom::{self, Pt, Shape, Shapes};
use std::f64::consts::PI;

/// mm: how far a wave's outline may stray from the exact offset.
const RESOLUTION: f64 = 0.0125;

/// How far a surface grows into one kind of region (Orca's `RegionExpansionParameters`): it first reaches `tiny`
/// past its edge, which finds where it touches the region, then `first`, then `more` waves of `step` each.
#[derive(Clone, Copy, Debug)]
pub struct Reach {
    tiny: f64,
    first: f64,
    step: f64,
    more: usize,
}

impl Reach {
    /// Orca's `RegionExpansionParameters::build`: `full` mm in waves of about `step`, at most `max_steps` of them.
    pub fn new(full: f64, step: f64, max_steps: usize) -> Reach {
        let mut tiny = (0.25 * full).min(0.05);
        let mut steps = (((full - tiny) / step).ceil().max(1.0) as usize).min(max_steps.max(1));
        let mut first = (full - tiny) / steps as f64;
        if steps > 1 && 0.25 * first < tiny {
            steps = (((full - tiny) / (4.0 * tiny)).floor() as usize).max(1);
            first = (full - tiny) / steps as f64;
        }
        if 0.25 * first < tiny || steps == 1 {
            tiny = 0.2 * full;
            first = 0.8 * full;
        }
        Reach { tiny, first, step: first, more: steps - 1 }
    }
}

/// What the surfaces of one layer's island print as: each kind's area, and each bridge's direction (degrees, the
/// way its lines run).
#[derive(Clone, Debug, Default)]
pub struct Surfaces {
    pub top: Shapes,
    pub bottom: Shapes,
    pub bridge: Shapes,
    pub bridge_angles: Vec<f64>,
    pub solid: Shapes,
    pub sparse: Shapes,
}

/// How the surfaces grow on a layer, from its flows (Orca's numbers).
#[derive(Clone, Copy, Debug)]
pub struct Growth {
    /// mm into solid infill (and, for bridges, into top surfaces): the walls' width, times √2.
    pub into_solid: f64,
    /// mm into sparse infill: one inner wall's spacing.
    pub into_sparse: f64,
    /// mm: gaps narrower than twice this between what grew close up.
    pub closing: f64,
    /// mm²: sparse infill in a smaller piece prints solid (none when the infill has no density).
    pub min_sparse_area: Option<f64>,
}

/// Orca's `process_external_surfaces` for one island, its surfaces as the shells left them: bridges grow first (into
/// solid infill, sparse infill and top surfaces), then bottoms, then tops (into solid and sparse infill).
pub fn grow_surfaces(
    top: Shapes,
    bottom: Shapes,
    bridge: Shapes,
    solid: Shapes,
    sparse: Shapes,
    g: &Growth,
    walls: Option<(&Shapes, f64)>,
) -> Surfaces {
    let into_solid = Reach::new(g.into_solid, 0.1, 5);
    let into_sparse = Reach::new(g.into_sparse, 0.1, 5);
    let mut zones: Vec<(Shapes, Reach)> =
        vec![(geom::union_all(&[&solid]), into_solid), (geom::union_all(&[&sparse]), into_sparse), (top, into_solid)];
    let bridges = if bridge.is_empty() { Vec::new() } else { grow_bridges(&bridge, &mut zones, g.closing) };
    let top = zones.pop().map(|(shapes, _)| shapes).unwrap_or_default();
    let bottom = grow(&bottom, &mut zones, g.closing);
    let top = grow(&top, &mut zones, g.closing);
    let mut sparse = std::mem::take(&mut zones[1].0);
    let mut solid = std::mem::take(&mut zones[0].0);
    if let Some(min) = g.min_sparse_area
        && sparse.iter().any(|shape| geom::shape_area_mm2(shape) <= min)
    {
        let (small, big): (Shapes, Shapes) = sparse.into_iter().partition(|shape| orca_area(shape, walls) <= min);
        sparse = big;
        solid = geom::union(&solid, &small);
    }
    let (bridge, bridge_angles) = bridges.into_iter().unzip();
    Surfaces { top, bottom, bridge, bridge_angles, solid, sparse }
}

/// mm²: a sparse piece's area as Orca measures it, its infill area reaching into the walls it touches by the overlap
/// (`walls`: the island's infill area and the overlap), which ours leaves to the planner. Only a piece near the
/// smallest sparse area needs it.
fn orca_area(shape: &geom::Shape, walls: Option<(&Shapes, f64)>) -> f64 {
    let area = geom::shape_area_mm2(shape);
    let Some((inner, overlap)) = walls.filter(|&(_, overlap)| overlap > 0.0) else { return area };
    let one = vec![shape.clone()];
    let grown = geom::offset(&one, overlap);
    let Some(b) = geom::bbox(&grown) else { return area };
    // Grown into the walls only: not into the rest of the infill area beside it.
    let others = geom::difference(&geom::clip_box(&geom::local(inner, b), b), &one);
    geom::area_mm2(&geom::difference(&grown, &others))
}

fn boxes_meet(a: [i32; 4], b: [i32; 4]) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/// Where `src` grows within one region (Orca's `wave_seeds` and `propagate_waves`): for each source shape and each
/// of the region's shapes it touches (its edge, pushed out by `tiny`, gets into it), what of that shape the waves
/// reach: the first one as far as `tiny + first` from the source, each next one `step` further, all of it kept
/// inside that shape. As (source, region shape, reached).
fn waves(src: &Shapes, zone: &Shapes, r: &Reach) -> Vec<(usize, usize, Shapes)> {
    let mut out = Vec::new();
    if zone.is_empty() {
        return out;
    }
    let zone_boxes: Vec<[i32; 4]> = zone.iter().map(geom::bbox_of).collect();
    for (j, shape) in src.iter().enumerate() {
        let one = vec![shape.clone()];
        let touch = geom::offset_bevel(&one, r.tiny);
        let Some(tb) = geom::bbox(&touch) else { continue };
        // As far as the waves can reach: each zone shape with only its holes there.
        let reach = geom::inflate(tb, (r.first + r.step * r.more as f64) * 1.1);
        let mut first: Option<Shapes> = None;
        for (k, z) in zone.iter().enumerate() {
            if !boxes_meet(zone_boxes[k], tb) {
                continue;
            }
            let zk = geom::clip_box(&geom::local(&vec![z.clone()], reach), reach);
            if geom::intersection(&touch, &zk).is_empty() {
                continue;
            }
            // Each wave is simplified as Orca's paths are (to its resolution): offsets of fine curves otherwise
            // double their corners at every step.
            let first = first
                .get_or_insert_with(|| geom::simplify_shapes(&geom::offset_bevel(&one, r.tiny + r.first), RESOLUTION));
            let mut wave = geom::intersection(first, &zk);
            for _ in 0..r.more {
                if wave.is_empty() {
                    break;
                }
                let grown = geom::simplify_shapes(&geom::offset_bevel(&wave, r.step), RESOLUTION);
                wave = geom::intersection(&grown, &zk);
            }
            if !wave.is_empty() {
                out.push((j, k, wave));
            }
        }
    }
    out
}

/// Orca's `expand_merge_surfaces`: each of `src` grown into the regions (each by its own reach) and joined to what
/// it reached, then all of it closed; the regions lose what was taken.
fn grow(src: &Shapes, zones: &mut [(Shapes, Reach)], closing: f64) -> Shapes {
    if src.is_empty() {
        return Vec::new();
    }
    let mut reached: Vec<Vec<Shapes>> = vec![Vec::new(); src.len()];
    let mut into = vec![false; zones.len()];
    for (z, (shapes, reach)) in zones.iter().enumerate() {
        for (j, _, wave) in waves(src, shapes, reach) {
            reached[j].push(wave);
            into[z] = true;
        }
    }
    let mut grown: Shapes = Vec::new();
    for (shape, reached) in src.iter().zip(&reached) {
        grown.extend(join(shape, reached));
    }
    let grown = geom::closing(&grown, closing);
    for (z, (shapes, _)) in zones.iter_mut().enumerate() {
        if into[z] {
            *shapes = geom::difference(shapes, &grown);
        }
    }
    grown
}

/// A shape joined to what it grew into: the piece of the union that holds the shape (Orca's
/// `merge_expansions_into_expolygons`).
fn join(shape: &Shape, reached: &[Shapes]) -> Shapes {
    let one = vec![shape.clone()];
    if reached.is_empty() {
        return one;
    }
    let mut all: Vec<&Shapes> = reached.iter().collect();
    all.push(&one);
    let union = geom::union_all(&all);
    if union.len() <= 1 {
        return union;
    }
    let Some(&p) = shape.first().and_then(|c| c.first()) else { return union };
    // The shape's first corner lies on the union's edge: the piece that holds it is the one whose box holds it and
    // that holds a point just inside the shape near it.
    let inside = inner_point(shape).unwrap_or(p);
    union.into_iter().filter(|piece| geom::shape_contains(piece, inside)).take(1).collect()
}

/// A point inside a shape, a hair in from the middle of its first edge.
fn inner_point(shape: &Shape) -> Option<Pt> {
    let outer = shape.first()?;
    let n = outer.len();
    for i in 0..n {
        let (a, b) = (outer[i], outer[(i + 1) % n]);
        let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
        let len = dx.hypot(dy);
        if len < 4.0 {
            continue;
        }
        // Counter-clockwise outer contours have their inside on the left.
        let (mx, my) = ((a.x as f64 + b.x as f64) / 2.0, (a.y as f64 + b.y as f64) / 2.0);
        let q = geom::pt((mx - dy / len * 2.0).round() as i32, (my + dx / len * 2.0).round() as i32);
        if geom::shape_contains(shape, q) {
            return Some(q);
        }
        let q = geom::pt((mx + dy / len * 2.0).round() as i32, (my - dx / len * 2.0).round() as i32);
        if geom::shape_contains(shape, q) {
            return Some(q);
        }
    }
    None
}

/// Orca's `expand_bridges_detect_orientations`: the bridges grown into the regions; bridges whose growth meets in a
/// region become one (Orca's groups), closed up, spanning the way the group's first bridge spans best. The regions
/// lose what the bridges took. Each bridge with its direction (degrees).
fn grow_bridges(bridges: &Shapes, zones: &mut [(Shapes, Reach)], closing: f64) -> Vec<(Shape, f64)> {
    // What each bridge reached, by region shape (numbered across all the regions), and where each one touches.
    let mut reached: Vec<(usize, usize, Shapes)> = Vec::new();
    let mut into = vec![false; zones.len()];
    let mut base = 0;
    let mut anchor_shapes: Vec<&Shape> = Vec::new();
    for (z, (shapes, reach)) in zones.iter().enumerate() {
        for (j, k, wave) in waves(bridges, shapes, reach) {
            reached.push((j, base + k, wave));
            into[z] = true;
        }
        anchor_shapes.extend(shapes.iter());
        base += shapes.len();
    }
    // Groups: two bridges are one where what they reached in the same region shape overlaps.
    let mut group: Vec<usize> = (0..bridges.len()).collect();
    fn root(group: &mut [usize], mut i: usize) -> usize {
        while group[i] != i {
            group[i] = group[group[i]];
            i = group[i];
        }
        i
    }
    let outers: Vec<Shapes> = reached.iter().map(|(_, _, w)| w.iter().map(|s| vec![s[0].clone()]).collect()).collect();
    let boxes: Vec<Option<[i32; 4]>> = reached.iter().map(|(_, _, w)| geom::bbox(w)).collect();
    for a in 0..reached.len() {
        for b in a + 1..reached.len() {
            let ((ja, ka, _), (jb, kb, _)) = (&reached[a], &reached[b]);
            if ka != kb || ja == jb {
                continue;
            }
            let (Some(ba), Some(bb)) = (boxes[a], boxes[b]) else { continue };
            if !boxes_meet(ba, bb) || geom::intersection(&outers[a], &outers[b]).is_empty() {
                continue;
            }
            let (ra, rb) = (root(&mut group, *ja), root(&mut group, *jb));
            if ra < rb {
                group[rb] = ra;
            } else {
                group[ra] = rb;
            }
        }
    }
    // Each group's direction is its first bridge's: across the edges that hang free, anchored where it meets the
    // regions it grew into.
    let mut out: Vec<(Shape, f64)> = Vec::new();
    let mut taken: Shapes = Vec::new();
    for first in 0..bridges.len() {
        if root(&mut group, first) != first {
            continue;
        }
        let anchors: Shapes = {
            let mut ks: Vec<usize> = reached.iter().filter(|(j, _, _)| *j == first).map(|(_, k, _)| *k).collect();
            ks.dedup();
            ks.into_iter().map(|k| anchor_shapes[k].clone()).collect()
        };
        let angle = bridge_angle(&bridges[first], &anchors);
        let mut parts: Shapes = Vec::new();
        for (j, bridge) in bridges.iter().enumerate() {
            if root(&mut group, j) != first {
                continue;
            }
            parts.push(bridge.clone());
            for (_, _, wave) in reached.iter().filter(|(jj, _, _)| *jj == j) {
                parts.extend(wave.iter().cloned());
            }
        }
        let closed = geom::closing(&geom::union_all(&[&parts]), closing);
        for shape in closed {
            taken.push(shape.clone());
            out.push((shape, angle));
        }
    }
    for (z, (shapes, _)) in zones.iter_mut().enumerate() {
        if into[z] {
            *shapes = geom::difference(shapes, &taken);
        }
    }
    out
}

/// The way a bridge's lines run, in degrees (Orca's `detect_bridging_direction`): of the directions across its
/// free edges (those not on the regions it is anchored to), the one along which those edges are shortest; with no
/// free edge, along the shape's narrow axis.
fn bridge_angle(bridge: &Shape, anchors: &Shapes) -> f64 {
    // An edge is held where just past its middle, outside the bridge, an anchoring region lies.
    let one = vec![bridge.clone()];
    let anchors = match geom::bbox(&one) {
        Some(b) => geom::local(anchors, geom::inflate(b, 0.01)),
        None => Vec::new(),
    };
    let mut free: Vec<(Pt, Pt)> = Vec::new();
    for contour in bridge {
        let n = contour.len();
        for i in 0..n {
            let (a, b) = (contour[i], contour[(i + 1) % n]);
            if a == b {
                continue;
            }
            let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
            let len = dx.hypot(dy);
            let (mx, my) = ((a.x as f64 + b.x as f64) / 2.0, (a.y as f64 + b.y as f64) / 2.0);
            let off = |side: f64| {
                let e = 10.0 * side / len;
                geom::pt((mx + dy * e).round() as i32, (my - dx * e).round() as i32)
            };
            // The side away from the bridge.
            let outside = if geom::shape_contains(bridge, off(1.0)) { off(-1.0) } else { off(1.0) };
            if !geom::contains(&anchors, outside) {
                free.push((a, b));
            }
        }
    }
    let dir = if free.is_empty() {
        narrow_axis(bridge).unwrap_or((1.0, 0.0))
    } else {
        // Each free edge's normal, by its angle in thousandths of a radian (the first of each kept), costed by how
        // long the free edges are along it.
        let mut normals: Vec<(i64, (f64, f64))> = Vec::new();
        for &(a, b) in &free {
            let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
            let len = dx.hypot(dy);
            let normal = (dy / len, -dx / len);
            let key = (normal.1.atan2(normal.0) * 1000.0).ceil() as i64;
            if !normals.iter().any(|(k, _)| *k == key) {
                normals.push((key, normal));
            }
        }
        // The cheapest, the one with the smallest angle among equals.
        let mut best = (f64::MAX, i64::MAX, (1.0, 1.0));
        for &(key, d) in &normals {
            let cost: f64 =
                free.iter().map(|&(a, b)| ((b.x - a.x) as f64 * d.0 + (b.y - a.y) as f64 * d.1).abs()).sum();
            if cost < best.0 || (cost == best.0 && key < best.1) {
                best = (cost, key, (d.1, -d.0));
            }
        }
        best.2
    };
    (PI + dir.1.atan2(dir.0)).to_degrees()
}

/// The direction a shape is narrowest in, from its second moments of area (Orca's `compute_principal_components`,
/// the second component): none for a shape too small to tell.
fn narrow_axis(shape: &Shape) -> Option<(f64, f64)> {
    let (mut area, mut cx, mut cy, mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    for contour in shape {
        let mm = |p: Pt| (geom::unsc(p.x), geom::unsc(p.y));
        let Some(&p0) = contour.first() else { continue };
        let a = mm(p0);
        for w in contour.windows(2).skip(1) {
            let (b, c) = (mm(w[0]), mm(w[1]));
            let cross = (b.0 - a.0) * (c.1 - a.1) - (c.0 - a.0) * (b.1 - a.1);
            let sign = if (b.0 - a.0) * (c.1 - b.1) - (b.1 - a.1) * (c.0 - b.0) > 0.0 { 1.0 } else { -1.0 };
            let j = cross.abs();
            area += sign * j * 0.5;
            cx += sign * j * (a.0 + b.0 + c.0) / 6.0;
            cy += sign * j * (a.1 + b.1 + c.1) / 6.0;
            sxx += sign * j * (a.0 * a.0 + b.0 * b.0 + b.0 * c.0 + c.0 * c.0 + a.0 * (b.0 + c.0)) / 12.0;
            syy += sign * j * (a.1 * a.1 + b.1 * b.1 + b.1 * c.1 + c.1 * c.1 + a.1 * (b.1 + c.1)) / 12.0;
            sxy += sign
                * j
                * (a.1 * (b.0 + c.0)
                    + a.0 * (2.0 * a.1 + b.1 + c.1)
                    + b.1 * c.0
                    + b.0 * c.1
                    + 2.0 * b.0 * b.1
                    + 2.0 * c.0 * c.1)
                / 24.0;
        }
    }
    if area <= 0.0 {
        return None;
    }
    let (mx, my) = (cx / area, cy / area);
    let (vx, vy) = (sxx / area - mx * mx, syy / area - my * my);
    let cov = sxy / area - mx * my;
    if cov.abs() < 1e-4 {
        let (second, size) = if vy > vx { ((1.0, 0.0), vx) } else { ((0.0, 1.0), vy) };
        return (size != 0.0).then_some(second);
    }
    let root = ((vx - vy) * (vx - vy) + 4.0 * cov * cov).sqrt();
    let (ea, eb) = (0.5 * (vx + vy + root), 0.5 * (vx + vy - root));
    let small = if ea > eb { eb } else { ea };
    let v = ((small - vy) / cov, 1.0);
    let len = v.0.hypot(v.1);
    Some((v.0 / len, v.1 / len))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]]
    }

    #[test]
    fn reach_takes_orcas_steps() {
        // 1.4 mm in five waves after a 0.05 mm touch; 0.4 mm in one go after a fifth of it.
        let r = Reach::new(1.4, 0.1, 5);
        assert!((r.tiny - 0.05).abs() < 1e-9 && (r.first - 0.27).abs() < 1e-9 && r.more == 4);
        let r = Reach::new(0.4, 0.1, 5);
        assert!((r.tiny - 0.08).abs() < 1e-9 && (r.first - 0.32).abs() < 1e-9 && r.more == 0);
    }

    #[test]
    fn a_top_grows_into_the_solid_beside_it_but_not_past_a_gap() {
        // A top surface with solid infill along one side, and sparse infill beyond that.
        let top = vec![rect(0.0, 0.0, 10.0, 10.0)];
        let solid = vec![rect(10.0, 0.0, 13.0, 10.0)];
        let sparse = vec![rect(13.0, 0.0, 30.0, 10.0)];
        let g = Growth { into_solid: 1.4, into_sparse: 0.4, closing: 0.15, min_sparse_area: Some(15.0) };
        let out = grow_surfaces(top, Vec::new(), Vec::new(), solid, sparse, &g, None);
        let top_area: f64 = out.top.iter().map(geom::shape_area_mm2).sum();
        // It took 1.4 mm of the solid infill (10 mm long), and none of the sparse infill 3 mm away.
        assert!((top_area - 114.0).abs() < 0.5, "{top_area}");
        let sparse_area: f64 = out.sparse.iter().map(geom::shape_area_mm2).sum();
        assert!((sparse_area - 170.0).abs() < 0.01, "{sparse_area}");
    }

    #[test]
    fn a_bridge_over_a_slot_spans_it_the_short_way() {
        // A slot 2 mm wide and 12 mm long bridged, with solid infill all round it: lines across the slot.
        let bridge = vec![rect(0.0, 0.0, 12.0, 2.0)];
        let solid = geom::difference(&vec![rect(-3.0, -3.0, 15.0, 5.0)], &bridge);
        let g = Growth { into_solid: 1.4, into_sparse: 0.4, closing: 0.15, min_sparse_area: Some(15.0) };
        let out = grow_surfaces(Vec::new(), Vec::new(), bridge, solid, Vec::new(), &g, None);
        assert_eq!(out.bridge.len(), 1);
        let angle = out.bridge_angles[0].rem_euclid(180.0);
        assert!((angle - 90.0).abs() < 1.0, "{angle}");
        // And it grew into the solid infill round it.
        let area: f64 = out.bridge.iter().map(geom::shape_area_mm2).sum();
        assert!(area > 24.0 + 30.0, "{area}");
    }

    #[test]
    fn a_ledge_runs_along_the_side_it_is_held_by() {
        // A bridge held by solid infill along its left side only.
        let bridge = vec![rect(0.0, 0.0, 3.0, 10.0)];
        let solid = vec![rect(-5.0, 0.0, 0.0, 10.0)];
        let g = Growth { into_solid: 1.4, into_sparse: 0.4, closing: 0.15, min_sparse_area: Some(15.0) };
        let out = grow_surfaces(Vec::new(), Vec::new(), bridge, solid, Vec::new(), &g, None);
        let angle = out.bridge_angles[0].rem_euclid(180.0);
        // Its free edges are the right side (10 mm) and the ends (3 mm each). They are shortest across the right
        // side's normal (6 mm, against 10 across the ends'), and Orca's lines then run square to that normal: along
        // the held side, each line resting on the one before it.
        assert!((angle - 90.0).abs() < 1.0, "{angle}");
    }

    #[test]
    fn bridges_whose_growth_meets_become_one() {
        // Two slots 1 mm apart in solid infill: their growth meets, so they print as one bridge.
        let a = rect(0.0, 0.0, 10.0, 2.0);
        let b = rect(0.0, 3.0, 10.0, 5.0);
        let bridge = vec![a.clone(), b.clone()];
        let solid = geom::difference(&vec![rect(-3.0, -3.0, 13.0, 8.0)], &bridge);
        let g = Growth { into_solid: 1.4, into_sparse: 0.4, closing: 0.15, min_sparse_area: Some(15.0) };
        let out = grow_surfaces(Vec::new(), Vec::new(), bridge, solid, Vec::new(), &g, None);
        assert_eq!(out.bridge.len(), 1);
        assert_eq!(out.bridge_angles.len(), 1);
    }
}
