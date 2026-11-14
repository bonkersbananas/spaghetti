//! Where the classic trees start (`TreeSupport::generate_contact_points`): under each overhang, a node at each of
//! its sharper corners, one every branch distance along its outline, and one on each point of a grid (turned 22°)
//! that lies a branch's radius inside it. Hybrid trees hold up a big overhang's part far from the object below with
//! one node that is the overhang itself.

use super::data::{offset_ex, scale};
use super::mst::{P, SCALING_FACTOR};
use super::{Frame, NewNode, NodeType, Nodes, Style};
use crate::geom::{self, Shape, Shapes};
use crate::tree::overhangs::{Kind, Overhangs};
use std::collections::HashSet;
use std::sync::Arc;

/// What the contact points depend on.
pub struct Params {
    pub style: Style,
    /// mm: the branches' radius (half `tree_support_branch_diameter`, at least 0.4).
    pub base_radius: f64,
    /// mm: `tree_support_branch_distance` and `max_bridge_length`.
    pub branch_distance: f64,
    pub max_bridge_length: f64,
    /// mm: the gap under the overhang (`support_top_z_distance`, at least the thinnest layer).
    pub top_z_distance: f64,
    pub layer_height: f64,
    pub top_interface_layers: i32,
}

/// libnest2d's `EdgeCache` of one closed loop: its edges and their running lengths, for points a share of the way
/// round it.
struct EdgeCache {
    edges: Vec<(P, P)>,
    distances: Vec<f64>,
    full: f64,
}

impl EdgeCache {
    /// The loop's points with the first repeated at the end (Orca closes its copy of the overhang so).
    fn new(points: &[P]) -> EdgeCache {
        let mut edges = Vec::with_capacity(points.len());
        let mut distances = Vec::with_capacity(points.len());
        let mut full = 0.0;
        for w in points.windows(2) {
            let (dx, dy) = ((w[1].0 - w[0].0) as f64, (w[1].1 - w[0].1) as f64);
            full += (dx * dx + dy * dy).sqrt();
            edges.push((w[0], w[1]));
            distances.push(full);
        }
        EdgeCache { edges, distances, full }
    }

    /// The point `distance` (0 to 1) of the way round, on its edge at the edge's angle, rounded to nanometres.
    fn coords(&self, distance: f64) -> P {
        if self.distances.is_empty() {
            return (0, 0);
        }
        let d = distance * self.full;
        let idx = self.distances.partition_point(|&x| x < d).min(self.edges.len() - 1);
        let (a, b) = self.edges[idx];
        let ed = d - if idx > 0 { self.distances[idx - 1] } else { 0.0 };
        // libnest2d's `angleToXaxis`, in [0, 2π).
        let mut angle = ((b.1 - a.1) as f64).atan2((b.0 - a.0) as f64);
        if angle.is_sign_negative() {
            angle += 2.0 * std::f64::consts::PI;
        }
        (a.0 + (ed * angle.cos()).round() as i64, a.1 + (ed * angle.sin()).round() as i64)
    }
}

/// Orca's `BoundingBox` of points: min and max.
fn bbox(points: &[P]) -> (P, P) {
    let mut min = (i64::MAX, i64::MAX);
    let mut max = (i64::MIN, i64::MIN);
    for p in points {
        min = (min.0.min(p.0), min.1.min(p.1));
        max = (max.0.max(p.0), max.1.max(p.1));
    }
    (min, max)
}

/// Half its diagonal, nm (`BoundingBox::radius`).
fn bbox_radius(b: (P, P)) -> f64 {
    let (dx, dy) = ((b.1.0 - b.0.0) as f64, (b.1.1 - b.0.1) as f64);
    0.5 * (dx * dx + dy * dy).sqrt()
}

fn bbox_contains(b: (P, P), p: P) -> bool {
    p.0 >= b.0.0 && p.0 <= b.1.0 && p.1 >= b.0.1 && p.1 <= b.1.1
}

/// Shapes with their bounding boxes, for Orca's `is_inside_ex` of a point: in a contour and not in its holes, edges
/// in (the point rounded to our units).
pub struct Areas<'a> {
    shapes: &'a [Shape],
    boxes: Vec<[i32; 4]>,
}

impl<'a> Areas<'a> {
    pub fn new(shapes: &'a [Shape]) -> Areas<'a> {
        let boxes = shapes
            .iter()
            .map(|s| {
                let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
                for q in &s[0] {
                    b = [b[0].min(q.x), b[1].min(q.y), b[2].max(q.x), b[3].max(q.y)];
                }
                b
            })
            .collect();
        Areas { shapes, boxes }
    }

    pub fn contain(&self, frame: &Frame, p: P) -> bool {
        let u = frame.units(p);
        self.shapes.iter().zip(&self.boxes).any(|(s, b)| {
            u.x >= b[0]
                && u.x <= b[2]
                && u.y >= b[1]
                && u.y <= b[3]
                && crate::tree::util::contains(std::slice::from_ref(s), u)
        })
    }
}

/// The grid points the overhangs' insides are held up at: every `step` across the object's bounding box, turned
/// 22° about its middle, those inside the box.
fn grid_points(object_size: P, step: f64) -> Vec<P> {
    let min = (-object_size.0 / 2, -object_size.1 / 2);
    let max = (object_size.0 / 2, object_size.1 / 2);
    let size = (max.0 - min.0, max.1 - min.1);
    let rotate_angle = 22.0 / 180.0 * std::f64::consts::PI;
    let center = ((max.0 + min.0) / 2, (max.1 + min.1) / 2);
    let (sin_a, cos_a) = (rotate_angle.sin(), rotate_angle.cos());
    // `Point(double, double)` rounds; `/ 2` is the integer division.
    let rotated = (
        (size.0 as f64 * cos_a + size.1 as f64 * sin_a).round() as i64 / 2,
        (size.0 as f64 * sin_a + size.1 as f64 * cos_a).round() as i64 / 2,
    );
    let mut out = Vec::new();
    let mut x = -rotated.0;
    while x < rotated.0 {
        let mut y = -rotated.1;
        while y < rotated.1 {
            let (cx, cy) = (x as f64, y as f64);
            let p = (
                (cos_a * cx - sin_a * cy).round() as i64 + center.0,
                (cos_a * cy + sin_a * cx).round() as i64 + center.1,
            );
            if bbox_contains((min, max), p) {
                out.push(p);
            }
            y = (y as f64 + step) as i64;
        }
        x = (x as f64 + step) as i64;
    }
    out
}

/// The contact nodes under each object layer's overhangs (`contact_nodes[l]` for the overhangs of layer `l + 1`),
/// and Orca's average count of nodes on a layer that has any and the direction they line up in (for square
/// branches).
pub struct Contacts {
    pub layers: Vec<Vec<usize>>,
    pub avg_node_per_layer: usize,
    pub nodes_angle: f32,
}

/// `print_z` and `height` are the object layers' (mm); `object_size` the object's size in nm.
#[allow(clippy::too_many_arguments)]
pub fn contact_points(
    overhangs: &Overhangs,
    outlines_below: &[Shapes],
    print_z: &[f64],
    height: &[f64],
    object_size: P,
    frame: &Frame,
    p: &Params,
    nodes: &mut Nodes,
) -> Contacts {
    let n = overhangs.len();
    let mut layers: Vec<Vec<usize>> = vec![Vec::new(); n];
    let point_spread = scale(p.branch_distance);
    let radius_scaled = scale(p.base_radius) as i64;
    let z_distance_top_layers =
        ((scale(p.top_z_distance) + scale(p.layer_height) - 1.0) / scale(p.layer_height) + 1.0) as i64;
    let gap_layers = if p.top_z_distance == 0.0 { 0 } else { 1 };
    if n as i64 <= z_distance_top_layers + 1 {
        return Contacts { layers, avg_node_per_layer: 0, nodes_angle: 0.0 };
    }
    let grid = grid_points(object_size, point_spread.max(scale(p.max_bridge_length) / 2.0));
    let thresh_big_overhang = scale(10.0) * scale(10.0);
    let minimum_roof_area = scale(1.0) * scale(1.0);

    // Each layer's nodes on their own (Orca makes them in parallel), then numbered in layer order.
    let made: Vec<Vec<NewContact>> = crate::par::map_range(n, |layer_nr| {
        if layer_nr == 0 {
            return Vec::new();
        }
        let mut curr: Vec<NewContact> = Vec::new();
        let mut already_inserted: HashSet<P> = HashSet::new();
        let mut insert_point = |curr: &mut Vec<NewContact>,
                                pt: P,
                                overhang: &Arc<Shape>,
                                radius: f64,
                                force_add: bool,
                                add_interface: bool,
                                is_sharp_tail: bool|
         -> Option<usize> {
            let hash_pos = (pt.0 / (radius_scaled + 1), pt.1 / (radius_scaled + 1));
            if force_add || !already_inserted.contains(&hash_pos) {
                already_inserted.insert(hash_pos);
                curr.push(NewContact {
                    position: pt,
                    roof_layers: if add_interface { p.top_interface_layers } else { 0 },
                    radius,
                    overhang: overhang.clone(),
                    is_sharp_tail,
                    is_corner: false,
                    polygon: false,
                });
                Some(curr.len() - 1)
            } else {
                None
            }
        };
        for (part, kind) in &overhangs[layer_nr] {
            let is_sharp_tail = *kind == Kind::SharpTail;
            let part_area = geom::shape_area_mm2(part) * 1e12;
            let mut regular: Shapes = vec![part.clone()];
            if p.style == Style::Hybrid && part_area > thresh_big_overhang && !is_sharp_tail {
                let held = geom::intersection(&vec![part.clone()], &outlines_below[layer_nr - 1]);
                let near = offset_ex(&held, radius_scaled as f64);
                let normal = geom::difference(&vec![part.clone()], &near);
                if geom::area_mm2(&normal) * 1e12 > thresh_big_overhang {
                    regular = near;
                    for overhang in normal {
                        let pts: Vec<P> = overhang[0].iter().map(|&q| frame.nm(q)).collect();
                        let b = bbox(&pts);
                        let radius = bbox_radius(b) * SCALING_FACTOR;
                        let candidate = ((b.0.0 + b.1.0) / 2, (b.0.1 + b.1.1) / 2);
                        let overhang = Arc::new(overhang);
                        if let Some(i) =
                            insert_point(&mut curr, candidate, &overhang, radius, true, true, is_sharp_tail)
                        {
                            curr[i].polygon = true;
                        }
                    }
                }
            }
            for overhang in regular {
                let add_interface = geom::shape_area_mm2(&overhang) * 1e12 > minimum_roof_area && !is_sharp_tail;
                let contour: Vec<P> = overhang[0].iter().map(|&q| frame.nm(q)).collect();
                let bounds = bbox(&contour);
                let radius = (bbox_radius(bounds) * SCALING_FACTOR).clamp(super::MIN_BRANCH_RADIUS, p.base_radius);
                let overhang = Arc::new(overhang);
                // The corners sharper than 135°.
                let m = contour.len();
                for i in 0..m {
                    let pt = contour[i];
                    let unit = |v: (i64, i64)| {
                        let (x, y) = (v.0 as f64, v.1 as f64);
                        let len = (x * x + y * y).sqrt();
                        if len > 0.0 { (x / len, y / len) } else { (x, y) }
                    };
                    let prev = contour[(i + m - 1) % m];
                    let next = contour[(i + 1) % m];
                    let v1 = unit((pt.0 - prev.0, pt.1 - prev.1));
                    let v2 = unit((pt.0 - next.0, pt.1 - next.1));
                    if v1.0 * v2.0 + v1.1 * v2.1 > -0.7
                        && let Some(k) =
                            insert_point(&mut curr, pt, &overhang, radius, false, add_interface, is_sharp_tail)
                    {
                        curr[k].is_corner = true;
                    }
                }
                // Along the outline and the holes', a branch distance apart.
                for (c, loop_) in overhang.iter().enumerate() {
                    let mut pts: Vec<P> =
                        if c == 0 { contour.clone() } else { loop_.iter().map(|&q| frame.nm(q)).collect() };
                    if pts.len() > 1 {
                        pts.push(pts[0]);
                    }
                    let cache = EdgeCache::new(&pts);
                    let step = point_spread / cache.full;
                    let mut distance = 0.0;
                    while distance < 1.0 {
                        let pt = cache.coords(distance);
                        insert_point(&mut curr, pt, &overhang, radius, false, add_interface, is_sharp_tail);
                        distance += step;
                    }
                }
                if is_sharp_tail {
                    continue;
                }
                // Inside it, on the grid.
                let inner = offset_ex(&vec![(*overhang).clone()], -(radius_scaled as f64));
                let inner = Areas::new(&inner);
                for &candidate in &grid {
                    if bbox_contains(bounds, candidate) && inner.contain(frame, candidate) {
                        insert_point(&mut curr, candidate, &overhang, radius, false, add_interface, is_sharp_tail);
                    }
                }
            }
        }
        curr
    });

    let mut nonempty_layers = 0usize;
    let mut all: Vec<(f32, f32)> = Vec::new();
    for (layer_nr, contacts) in made.into_iter().enumerate() {
        if contacts.is_empty() {
            continue;
        }
        nonempty_layers += 1;
        let bottom_z = print_z[layer_nr] - height[layer_nr];
        for c in contacts {
            let id = nodes.create(NewNode {
                position: c.position,
                distance_to_top: -gap_layers,
                obj_layer_nr: layer_nr - 1,
                support_roof_layers_below: c.roof_layers,
                to_buildplate: true,
                parent: None,
                print_z: bottom_z,
                height: p.top_z_distance,
                dist_mm_to_top: 0.0,
                radius: c.radius,
            });
            let node = &mut nodes.all[id];
            node.overhang = Some(c.overhang);
            node.is_sharp_tail = c.is_sharp_tail;
            node.is_corner = c.is_corner;
            if c.polygon {
                node.kind = NodeType::Polygon;
            }
            // Orca lists a polygon node twice on its layer (once as it is made, once as it becomes a polygon).
            for _ in 0..if c.polygon { 2 } else { 1 } {
                all.push((c.position.0 as f32, c.position.1 as f32));
                layers[layer_nr - 1].push(id);
            }
        }
    }
    let (mut avg_node_per_layer, mut nodes_angle) = (0, 0.0f32);
    if !all.is_empty() {
        avg_node_per_layer = all.len() / nonempty_layers;
        let (mut mx, mut my, mut mxy, mut mx2) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
        for &(px, py) in &all {
            let x = (px as f64 * SCALING_FACTOR) as f32;
            let y = (py as f64 * SCALING_FACTOR) as f32;
            mx += x;
            my += y;
            mxy += x * y;
            mx2 += x * x;
        }
        let nn = all.len() as f32;
        nodes_angle = (nn * mxy - mx * my).atan2(nn * mx2 - mx * mx);
    }
    Contacts { layers, avg_node_per_layer, nodes_angle }
}

/// A contact node as a layer makes it, before it is numbered.
#[derive(Clone)]
struct NewContact {
    position: P,
    roof_layers: i32,
    radius: f64,
    overhang: Arc<Shape>,
    is_sharp_tail: bool,
    is_corner: bool,
    polygon: bool,
}
