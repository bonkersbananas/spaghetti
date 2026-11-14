//! The classic trees drawn (`TreeSupport::draw_circles`): each node a circle of its radius (an ellipse along its
//! movement, a square when there are very many), cut back from the object and kept to its biggest piece; the gap
//! under an overhang and a hybrid tree's columns drawn as the overhang itself. A layer's areas are sorted into
//! roofs (the interface under an overhang, its first layer apart), the gap (which isn't printed but keeps the rest
//! off), and the base, which gets floors (bottom interfaces) where it lands on the object.

use super::data::{Data, offset_ex, scale, union};
use super::drop::LayerHeight;
use super::{EPSILON, Frame, NodeType, Nodes, Style};
use crate::geom::{self, Join, Shape, Shapes};
use crate::tree::util;

/// What a layer's area is printed as.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AreaType {
    Base,
    Roof,
    Floor,
    Roof1stLayer,
}

/// Orca's `SupportLayer::AreaGroup`.
#[derive(Clone, Debug)]
pub struct AreaGroup {
    pub area: Shape,
    pub kind: AreaType,
    /// mm: the farthest any of its nodes is from its overhang.
    pub dist_to_top: f64,
    /// A hybrid tree's column, which is filled.
    pub need_infill: bool,
    /// A branch that moves more than half a line a layer, which gets a second wall.
    pub need_extra_wall: bool,
    pub interface_as_base: bool,
}

/// A support layer as drawn.
#[derive(Clone, Debug)]
pub struct Drawn {
    pub print_z: f64,
    pub height: f64,
    pub groups: Vec<AreaGroup>,
}

pub struct Params {
    pub style: Style,
    /// mm: the branches' radius (`tree_support_branch_diameter` / 2).
    pub branch_radius: f64,
    pub top_z_distance: f64,
    pub bottom_z_distance: f64,
    pub xy_distance: f64,
    pub first_layer_gap: f64,
    pub top_interface_layers: usize,
    pub bottom_interface_layers: usize,
    pub layer_height: f64,
    /// mm: the support line (`support_line_width`) and its extrusion width as `SupportParameters` has it.
    pub line_width: f64,
    pub support_extrusion_width: f64,
    pub auto_brim: bool,
    pub brim_width: f64,
    pub first_layer_expansion: f64,
    pub gap_xy_first_layer: f64,
    /// mm: the first layer's support line width (its flow's scaled width).
    pub first_layer_width: f64,
    pub with_infill: bool,
    /// The bed (ours), which support stays on.
    pub bed: Shapes,
}

/// The object as the drawing needs it: each layer's top and height, its top surfaces and its slices.
pub struct ObjectLayers<'a> {
    pub print_z: &'a [f64],
    pub height: &'a [f64],
    pub tops: &'a [Shapes],
    pub slices: &'a [Shapes],
}

/// Orca's `closing_ex`: grown and shrunk by `nm`.
fn closing(shapes: &Shapes, nm: f64) -> Shapes {
    offset_ex(&union(offset_ex(shapes, nm)), -nm)
}

fn intersection(a: &Shapes, b: &Shapes) -> Shapes {
    util::intersection(a, b)
}

/// Orca's `avoid_object_remove_extra_small_parts`: the circle less what it must avoid, its biggest piece only.
fn avoid_keep_biggest(circle: &Shape, avoid: &Shapes) -> Shapes {
    let pieces = util::diff(&vec![circle.clone()], avoid);
    let mut best: Option<usize> = None;
    let mut max_area = 0.0f32;
    for (i, piece) in pieces.iter().enumerate() {
        let a = geom::shape_area_mm2(piece) * 1e12;
        if a > max_area as f64 {
            max_area = a as f32;
            best = Some(i);
        }
    }
    best.map(|i| vec![pieces[i].clone()]).unwrap_or_default()
}

fn bbox_overlap(a: &Shapes, b: &Shapes) -> bool {
    match (geom::bbox(a), geom::bbox(b)) {
        (Some(x), Some(y)) => !(x[0] > y[2] || y[0] > x[2] || x[1] > y[3] || y[1] > x[3]),
        _ => false,
    }
}

/// Orca's `overlaps`.
fn overlaps(a: &Shapes, b: &Shapes) -> bool {
    bbox_overlap(a, b) && !geom::intersection(a, b).is_empty()
}

/// Each support layer with nodes drawn (layers without any are left out, as Orca drops them), and Orca's count of
/// nodes a layer and their direction, which decide between circles and squares.
#[allow(clippy::too_many_arguments)]
pub fn draw_circles(
    contacts: &[Vec<usize>],
    nodes: &Nodes,
    layer_heights: &[LayerHeight],
    data: &Data,
    object: &ObjectLayers,
    frame: &Frame,
    avg_node_per_layer: usize,
    nodes_angle: f32,
    p: &Params,
) -> Vec<Drawn> {
    let square_support = avg_node_per_layer > 200;
    let circle_resolution = if square_support { 4 } else { 100 };
    let branch_radius_scaled = scale(p.branch_radius);
    let branch_circle: Vec<(i64, i64)> = (0..circle_resolution)
        .map(|i| {
            let angle = if square_support {
                i as f64 / circle_resolution as f64 * std::f64::consts::TAU
                    + std::f64::consts::FRAC_PI_4
                    + nodes_angle as f64
            } else {
                i as f64 / circle_resolution as f64 * std::f64::consts::TAU
            };
            ((angle.cos() * branch_radius_scaled).round() as i64, (angle.sin() * branch_radius_scaled).round() as i64)
        })
        .collect();
    let line_width_scaled = scale(p.line_width);
    let max_move_sq = scale(p.line_width / 2.0).powi(2);
    let top_base_interface_layers = 0usize;

    let drawn: Vec<Option<Drawn>> = crate::par::map_range(layer_heights.len(), |layer_nr| {
        let curr = &contacts[layer_nr];
        if curr.is_empty() {
            return None;
        }
        let lh = layer_heights[layer_nr];
        if lh.height < EPSILON {
            return None;
        }
        let obj_layer_nr = lh.obj_layer_nr;
        // What the support keeps off on this layer: the object grown by the XY gap (the first layer's gap on the
        // first), or by the top gap round sharp tails, and the object's layers within the top gap above.
        let collision_of = |sharp_tail: bool| -> Shapes {
            let d = if sharp_tail {
                scale(p.top_z_distance)
            } else {
                scale(if obj_layer_nr == 0 { p.first_layer_gap } else { p.xy_distance })
            };
            let mut collision = offset_ex(&data.outlines[obj_layer_nr], d);
            if p.top_z_distance > EPSILON {
                let top = p.top_z_distance as f32;
                let mut accum = 0.0f32;
                for layer_id in obj_layer_nr + 1..data.outlines.len() {
                    accum += object.height[layer_id] as f32;
                    if accum > top {
                        break;
                    }
                    let grown = offset_ex(&data.outlines[layer_id], scale(p.top_z_distance));
                    collision = util::union(&collision, &grown);
                }
            }
            collision
        };
        let collision_base = std::cell::OnceCell::new();
        let collision_tails = std::cell::OnceCell::new();
        let collision = |sharp_tail: bool| -> &Shapes {
            if sharp_tail {
                collision_tails.get_or_init(|| collision_of(true))
            } else {
                collision_base.get_or_init(|| collision_of(false))
            }
        };

        let mut base_areas: Shapes = Vec::new();
        let mut roof_areas: Shapes = Vec::new();
        let mut roof_base_areas: Shapes = Vec::new();
        let mut roof_1st_layer: Shapes = Vec::new();
        let mut roof_gap_areas: Shapes = Vec::new();
        let mut area_poly: Shapes = Vec::new();
        let mut extra_wall_areas: Shapes = Vec::new();
        let (mut max_above_base, mut max_above_roof, mut max_above_roof1) = (0.0f64, 0.0f64, 0.0f64);
        let overhang_grown = |o: &Shape| -> Shapes {
            if o[0].len() > 100 || o.len() > 2 {
                vec![o.clone()]
            } else {
                offset_ex(&vec![o.clone()], scale(p.xy_distance))
            }
        };
        for &id in curr {
            let node = &nodes.all[id];
            let mut area: Shapes;
            if node.kind == NodeType::Polygon || (node.distance_to_top < 0 && !node.is_sharp_tail) {
                area = node.overhang.as_ref().map(|o| overhang_grown(o)).unwrap_or_default();
                area = util::diff(&area, collision(node.is_sharp_tail && node.distance_to_top <= 0));
                if node.kind == NodeType::Polygon {
                    area_poly.extend(area.iter().cloned());
                }
            } else {
                let scale_r = node.radius / p.branch_radius;
                let move_x = node.movement.0 as f64 / (scale_r * branch_radius_scaled);
                let move_y = node.movement.1 as f64 / (scale_r * branch_radius_scaled);
                let mut circle: Vec<(i64, i64)> = if !square_support && move_x.abs() > 0.001 && move_y.abs() > 0.001 {
                    // An ellipse along the movement.
                    let vsize_inv = 0.5 / (0.01 + (move_x * move_x + move_y * move_y).sqrt());
                    let m = [
                        scale_r * (1.0 + move_x * move_x * vsize_inv),
                        scale_r * (move_x * move_y * vsize_inv),
                        scale_r * (move_x * move_y * vsize_inv),
                        scale_r * (1.0 + move_y * move_y * vsize_inv),
                    ];
                    branch_circle
                        .iter()
                        .map(|&(x, y)| {
                            let (x, y) = (x as f64, y as f64);
                            let v = ((m[0] * x + m[1] * y).round() as i64, (m[2] * x + m[3] * y).round() as i64);
                            (node.position.0 + v.0, node.position.1 + v.1)
                        })
                        .collect()
                } else {
                    branch_circle
                        .iter()
                        .map(|&(x, y)| {
                            (
                                (x as f64 * scale_r).round() as i64 + node.position.0,
                                (y as f64 * scale_r).round() as i64 + node.position.1,
                            )
                        })
                        .collect()
                };
                let mut shape: Shape = vec![circle.drain(..).map(|q| frame.units(q)).collect()];
                if obj_layer_nr == 0 {
                    // A brim round each branch on the first layer.
                    let brim_width = if !p.auto_brim {
                        p.brim_width
                    } else {
                        super::MIN_BRANCH_RADIUS_FIRST_LAYER.max(
                            (node.radius + node.dist_mm_to_top / (scale_r * p.branch_radius) * 0.5)
                                .min(super::MAX_BRANCH_RADIUS_FIRST_LAYER)
                                - node.radius,
                        )
                    };
                    let grown = geom::offset_c2(
                        &vec![shape.clone()],
                        (scale(brim_width) as f32) as f64 / 1e6,
                        Join::Miter(3.0),
                    );
                    if let Some(first) = grown.into_iter().next() {
                        shape = vec![first[0].clone()];
                    }
                }
                area = avoid_keep_biggest(&shape, collision(node.is_sharp_tail && node.distance_to_top <= 0));
                // Merged with its overhang for a smoother interface.
                if p.top_interface_layers > 0
                    && node.support_roof_layers_below > 0
                    && !node.is_sharp_tail
                    && let Some(o) = &node.overhang
                {
                    area.extend(overhang_grown(o));
                }
            }
            if node.is_processed && (node.movement.0 as f64).powi(2) + (node.movement.1 as f64).powi(2) > max_move_sq {
                extra_wall_areas.extend(area.iter().cloned());
            }
            if obj_layer_nr > 0 && node.distance_to_top < 0 {
                roof_gap_areas.extend(area);
            } else if obj_layer_nr > 0 && node.support_roof_layers_below == 1 && !node.is_sharp_tail {
                roof_1st_layer.extend(area);
                max_above_roof1 = max_above_roof1.max(node.dist_mm_to_top);
            } else if obj_layer_nr > 0 && node.support_roof_layers_below > 1 && !node.is_sharp_tail {
                if node.support_roof_layers_below as usize <= top_base_interface_layers {
                    roof_base_areas.extend(area);
                } else {
                    roof_areas.extend(area);
                }
                max_above_roof = max_above_roof.max(node.dist_mm_to_top);
            } else {
                base_areas.extend(area);
                max_above_base = max_above_base.max(node.dist_mm_to_top);
            }
        }

        // Roofs joined up, kept off the object and on the bed; the base less the roofs and the gap.
        let collision_none = collision(false).clone();
        roof_areas = intersection(&util::diff(&closing(&roof_areas, line_width_scaled), &collision_none), &p.bed);
        roof_base_areas =
            intersection(&util::diff(&closing(&roof_base_areas, line_width_scaled), &collision_none), &p.bed);
        if !roof_base_areas.is_empty() && !roof_areas.is_empty() {
            roof_base_areas = util::diff(&roof_base_areas, &roof_areas);
        }
        let first_base_roof_area = roof_areas.len();
        roof_areas.extend(roof_base_areas);
        roof_1st_layer = util::diff(&closing(&roof_1st_layer, line_width_scaled), &collision_none);
        roof_1st_layer = util::diff(&roof_1st_layer, &roof_areas);
        roof_1st_layer = intersection(&roof_1st_layer, &p.bed);
        let mut roofs = roof_1st_layer.clone();
        roofs.extend(roof_areas.iter().cloned());
        roofs.extend(roof_gap_areas.iter().cloned());
        base_areas = intersection(&util::diff(&union(base_areas), &roofs), &p.bed);
        if square_support {
            base_areas = super::data::simplify(&base_areas, scale(p.line_width / 2.0));
        }

        // Floors: where the base comes down onto the object's top surfaces (or its first layer), a gap and then
        // bottom interface layers.
        let mut floor_areas: Shapes = Vec::new();
        let bottom_gap = p.bottom_z_distance;
        if !base_areas.is_empty() && (bottom_gap > EPSILON || p.bottom_interface_layers > 0) {
            let interface_height =
                if p.bottom_interface_layers > 0 { p.bottom_interface_layers as f64 * p.layer_height } else { 0.0 };
            let (top_z, bottom_z) = (lh.print_z, lh.print_z - lh.height);
            let mut new_base: Shapes = Vec::new();
            for comp in &base_areas {
                let mut comp_poly: Shapes = vec![comp.clone()];
                let mut bands: Vec<(f64, Shapes)> = Vec::new();
                for idx in (0..=obj_layer_nr.min(object.tops.len().saturating_sub(1))).rev() {
                    let mut surfaces = object.tops[idx].clone();
                    if idx == 0 {
                        surfaces.extend(object.slices[0].iter().cloned());
                    }
                    if surfaces.is_empty() || !bbox_overlap(&comp_poly, &surfaces) {
                        continue;
                    }
                    if !geom::intersection(&comp_poly, &surfaces).is_empty() {
                        bands.push((object.print_z[idx], surfaces));
                    }
                }
                if bands.is_empty() {
                    new_base.extend(comp_poly);
                    continue;
                }
                bands.sort_by(|a, b| a.0.total_cmp(&b.0));
                let mut any_gap_cleared = false;
                for (z, surfaces) in &bands {
                    let gap_top = z + bottom_gap;
                    if top_z < z - EPSILON {
                        continue;
                    }
                    if bottom_gap > EPSILON && bottom_z < gap_top - EPSILON {
                        any_gap_cleared = true;
                        comp_poly = geom::difference(&comp_poly, surfaces);
                    }
                    if p.bottom_interface_layers > 0
                        && bottom_z >= gap_top - EPSILON
                        && bottom_z < gap_top + interface_height - EPSILON
                    {
                        let mut band = union(surfaces.clone());
                        if !band.is_empty() {
                            band = intersection(&band, &offset_ex(&comp_poly, scale(p.support_extrusion_width)));
                        }
                        let comp_interface = if band.is_empty() { Vec::new() } else { intersection(&comp_poly, &band) };
                        if !comp_interface.is_empty() {
                            comp_poly = geom::difference(&comp_poly, &offset_ex(&comp_interface, 10.0));
                            floor_areas.extend(comp_interface);
                        }
                    }
                }
                if any_gap_cleared && comp_poly.is_empty() {
                    continue;
                }
                new_base.extend(comp_poly);
            }
            base_areas = new_base;
        }

        // A hybrid tree's columns spread on the first layer, as normal supports' do.
        if layer_nr == 0 && p.style == Style::Hybrid && p.first_layer_expansion > 0.0 {
            let inflate = (scale(p.first_layer_expansion) as f32) as f64;
            let trimming = offset_ex(&object.slices[0], scale(p.gap_xy_first_layer));
            let nsteps = 5i64.max((inflate / scale(p.first_layer_width).trunc()).ceil() as i64);
            let step = (inflate / nsteps as f64) as f32 as f64;
            let mut expanded: Shapes = Vec::new();
            for e in &base_areas {
                let one = vec![e.clone()];
                if overlaps(&one, &area_poly) {
                    let mut grown = one;
                    for _ in 0..nsteps {
                        grown = geom::difference(&offset_ex(&grown, step), &trimming);
                    }
                    expanded.extend(union(grown));
                } else {
                    expanded.push(e.clone());
                }
            }
            base_areas = expanded;
        }

        // The base kept off the object below it by the bottom gap (Orca's `get_trim_support_regions`).
        if !base_areas.is_empty() {
            let trimming = trim_regions(object, data, lh, bottom_gap);
            if !trimming.is_empty() {
                base_areas = geom::difference(&base_areas, &trimming);
            }
        }

        let mut groups: Vec<AreaGroup> = Vec::new();
        for e in base_areas {
            let one = vec![e.clone()];
            let need_infill = overlaps(&one, &area_poly);
            let need_extra_wall = !need_infill && !extra_wall_areas.is_empty() && overlaps(&one, &extra_wall_areas);
            groups.push(AreaGroup {
                area: e,
                kind: AreaType::Base,
                dist_to_top: max_above_base,
                need_infill,
                need_extra_wall,
                interface_as_base: false,
            });
        }
        for (i, e) in roof_areas.into_iter().enumerate() {
            groups.push(AreaGroup {
                area: e,
                kind: AreaType::Roof,
                dist_to_top: max_above_roof,
                need_infill: false,
                need_extra_wall: false,
                interface_as_base: i >= first_base_roof_area,
            });
        }
        for e in floor_areas {
            groups.push(AreaGroup {
                area: e,
                kind: AreaType::Floor,
                dist_to_top: 10000.0,
                need_infill: false,
                need_extra_wall: false,
                interface_as_base: false,
            });
        }
        for e in roof_1st_layer {
            groups.push(AreaGroup {
                area: e,
                kind: AreaType::Roof1stLayer,
                dist_to_top: max_above_roof1,
                need_infill: false,
                need_extra_wall: false,
                interface_as_base: top_base_interface_layers > 0,
            });
        }
        // Holes under 2 mm across are filled in.
        for g in &mut groups {
            let outer = g.area[0].clone();
            let mut kept = vec![outer];
            for hole in g.area.iter().skip(1) {
                let b = geom::bbox(&vec![vec![hole.clone()]]).unwrap_or([0, 0, 0, 0]);
                let small = |d: i32| (d as f64) < 2.0 * geom::SCALE;
                if !(small(b[2] - b[0]) && small(b[3] - b[1])) {
                    kept.push(hole.clone());
                }
            }
            g.area = kept;
        }
        Some(Drawn { print_z: lh.print_z, height: lh.height, groups })
    });
    drawn.into_iter().flatten().collect()
}

/// Orca's `get_trim_support_regions` with no gap above or beside: the object's slices on every layer within the
/// bottom gap below the support layer, those that overlap it in height as they are, the others grown by 0.2 mm.
fn trim_regions(object: &ObjectLayers, data: &Data, lh: LayerHeight, gap_below: f64) -> Shapes {
    let _ = data;
    let bottom_z = lh.print_z - lh.height;
    let threshold = bottom_z - gap_below + EPSILON;
    let first = object.print_z.partition_point(|&z| z < threshold);
    let mut trimming: Shapes = Vec::new();
    for i in first..object.print_z.len() {
        let (oz, oh) = (object.print_z[i], object.height[i]);
        if oz - oh > lh.print_z - EPSILON {
            break;
        }
        let overlap = (lh.print_z - oz).abs() < EPSILON
            || (lh.print_z < oz && lh.print_z > oz - oh)
            || (lh.print_z > oz && bottom_z < oz - EPSILON);
        if overlap {
            trimming.extend(object.slices[i].iter().cloned());
        } else {
            trimming.extend(geom::offset_c2(&object.slices[i], 0.2, Join::Square));
        }
    }
    trimming
}
