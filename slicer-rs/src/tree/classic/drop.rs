//! The classic trees' layers and branches (`TreeSupport::plan_layer_heights`, `drop_nodes`, `smooth_nodes`): the
//! support's own layer heights between the contacts, then each layer's nodes dropped to the layer below: grouped
//! by the part of the object under them, joined by a minimum spanning tree in each group, merged where they are
//! close, and moved towards their neighbours and out of the object's way; last, each branch's path smoothed.

use super::contact::Areas;
use super::data::{Data, offset_ex, scale, union};
use super::mst::{Mst, P, SCALING_FACTOR, vsize2};
use super::order::StdMap;
use super::{EPSILON, Frame, NewNode, NodeType, Nodes, Style};
use crate::geom::Shapes;
use std::collections::{BTreeMap, HashMap};

/// A support layer: its top and thickness (mm), and the object layer it is planned against.
#[derive(Clone, Copy, Debug)]
pub struct LayerHeight {
    pub print_z: f64,
    pub height: f64,
    pub obj_layer_nr: usize,
}

/// A height as a map key, in the order of its value.
#[derive(Clone, Copy, PartialEq, Debug)]
struct Z(f64);
impl Eq for Z {}
impl PartialOrd for Z {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Z {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.0.total_cmp(&other.0)
    }
}

/// Orca's `plan_layer_heights`: with independent support layer heights, layers as thick as they may be between the
/// first layer and each contact's gap; else the object's layers. The contact nodes move to the support layer
/// nearest their height, their gap split into layers when it spans several.
#[allow(clippy::too_many_arguments)]
pub fn plan_layer_heights(
    contacts: &mut Vec<Vec<usize>>,
    nodes: &mut Nodes,
    print_z: &[f64],
    height: &[f64],
    independent: bool,
    min_layer_height: f64,
    max_layer_height: f64,
    top_z_distance: f64,
) -> Vec<LayerHeight> {
    let mut layer_heights: Vec<LayerHeight> = Vec::new();
    if !independent || print_z.is_empty() {
        layer_heights = (0..print_z.len())
            .map(|l| LayerHeight { print_z: print_z[l], height: height[l], obj_layer_nr: l })
            .collect();
    } else {
        let mut z_heights: BTreeMap<Z, f64> = BTreeMap::new();
        let mut bounds: BTreeMap<Z, f64> = BTreeMap::new();
        bounds.insert(Z(print_z[0]), height[0]);
        let obj_layer_zs: Vec<f32> = print_z.iter().map(|&z| z as f32).collect();
        z_heights.insert(Z(print_z[0]), height[0]);
        let min_print_z = print_z[0];
        for layer in contacts.iter().skip(1) {
            if let Some(&first) = layer.first() {
                let (z, h) = (nodes.all[first].print_z, nodes.all[first].height);
                bounds.entry(Z(z)).or_insert(h);
                bounds.entry(Z(min_print_z.max(z - h))).or_insert(0.0);
            }
        }
        let keys: Vec<f64> = bounds.keys().map(|z| z.0).collect();
        let mut z1 = keys[0];
        for &z2 in &keys[1..] {
            let dist = z2 - z1;
            if dist < min_layer_height - EPSILON {
                continue;
            }
            let n_layers_extra = (dist / max_layer_height).ceil() as usize;
            let step = dist / n_layers_extra as f64;
            let mut z = z1 + step;
            for _ in 0..n_layers_extra {
                z_heights.insert(Z(z), step);
                z += step;
            }
            z1 = z2;
        }
        let mut obj_layer_nr = 0usize;
        for (z, &h) in &z_heights {
            while obj_layer_nr < obj_layer_zs.len() && (obj_layer_zs[obj_layer_nr] as f64) < z.0 - h / 2.0 {
                obj_layer_nr += 1;
            }
            layer_heights.push(LayerHeight { print_z: z.0, height: h, obj_layer_nr });
        }
    }

    // The contact nodes onto the support layer nearest them.
    let mut moved: Vec<Vec<usize>> = vec![Vec::new(); layer_heights.len()];
    for layer in contacts.iter() {
        let Some(&first) = layer.first() else { continue };
        let z = nodes.all[first].print_z;
        let mut best = 0;
        for (i, lh) in layer_heights.iter().enumerate().skip(1) {
            if (lh.print_z - z).abs() < (layer_heights[best].print_z - z).abs() {
                best = i;
            }
        }
        moved[best].extend(layer.iter().copied());
    }
    *contacts = moved;

    // A gap thicker than its layer spans several: the contact's distance to the top counts them.
    for layer_nr in 0..contacts.len() {
        let Some(&first) = contacts[layer_nr].first() else { continue };
        let node1 = &nodes.all[first];
        let new_height = layer_heights[layer_nr].height;
        if (node1.height - new_height).abs() < EPSILON || (top_z_distance < EPSILON && node1.height < EPSILON) {
            continue;
        }
        let mut accum = 0.0;
        let mut num_layers = 0;
        for i in (0..=layer_nr).rev() {
            if layer_heights[i].height > EPSILON {
                accum += layer_heights[i].height;
                num_layers += 1;
                if accum > node1.height - EPSILON {
                    break;
                }
            }
        }
        for &id in &contacts[layer_nr] {
            nodes.all[id].height = new_height;
            nodes.all[id].distance_to_top = -num_layers;
        }
    }
    layer_heights
}

/// What dropping the nodes depends on.
pub struct Params {
    pub style: Style,
    /// mm.
    pub base_radius: f64,
    pub support_extrusion_width: f64,
    pub layer_height: f64,
    /// Degrees from vertical a branch may lean (`tree_support_branch_angle`).
    pub branch_angle: f64,
    pub wall_count: i64,
    pub top_interface_layers: i32,
}

impl Params {
    /// Orca's `calc_radius`: a branch's radius `mm_to_top` below its tip, a 45° tip to the base radius, growing by
    /// the diameter angle below it, within Orca's bounds, at least the base radius under interfaces.
    pub fn calc_radius(&self, mm_to_top: f64, diameter_angle_scale_factor: f64) -> f64 {
        let tip_height = self.base_radius;
        let mut radius = if mm_to_top > tip_height {
            self.base_radius + (mm_to_top - tip_height) * diameter_angle_scale_factor
        } else {
            mm_to_top
        };
        radius = radius.clamp(super::MIN_BRANCH_RADIUS, super::MAX_BRANCH_RADIUS);
        if self.top_interface_layers > 0 {
            radius = radius.max(self.base_radius);
        }
        radius
    }
}

/// Orca's `normal`: the vector scaled to `scale` nm long, rounded (none shorter than 100 nm is scaled).
pub fn normal(pt: P, scale_nm: f64) -> P {
    let length = scale(vsize2(pt).sqrt());
    if length < 100.0 {
        return pt;
    }
    mul(pt, scale_nm / length)
}

/// `Point::operator*` on a point that isn't const: rounded.
fn mul(p: P, r: f64) -> P {
    ((p.0 as f64 * r).round() as i64, (p.1 as f64 * r).round() as i64)
}

fn add(a: P, b: P) -> P {
    (a.0 + b.0, a.1 + b.1)
}

fn sub(a: P, b: P) -> P {
    (a.0 - b.0, a.1 - b.1)
}

/// Every contour and hole of shapes in nanometres (Orca's `get_contours_with_holes`).
fn loops_nm(shapes: &Shapes, frame: &Frame) -> Vec<Vec<P>> {
    shapes.iter().flatten().map(|c| c.iter().map(|&q| frame.nm(q)).collect()).collect()
}

/// `Point::projection_onto(Line)`.
fn project_on_segment(p: P, a: P, b: P) -> P {
    if a == b {
        return a;
    }
    let (lx, ly) = ((b.0 - a.0) as f64, (b.1 - a.1) as f64);
    let theta = ((b.0 - p.0) as f64 * lx + (b.1 - p.1) as f64 * ly) / (lx * lx + ly * ly);
    if (0.0..=1.0).contains(&theta) {
        return (
            (theta * a.0 as f64 + (1.0 - theta) * b.0 as f64) as i64,
            (theta * a.1 as f64 + (1.0 - theta) * b.1 as f64) as i64,
        );
    }
    let d2 = |q: P| {
        let (dx, dy) = ((q.0 - p.0) as f64, (q.1 - p.1) as f64);
        dx * dx + dy * dy
    };
    if d2(a) < d2(b) { a } else { b }
}

/// Orca's `projection_onto` of a point onto shapes: the nearest point of their outlines (the origin with none).
pub fn projection_onto(shapes: &Shapes, frame: &Frame, from: P) -> P {
    let mut best = (0, 0);
    let mut min = f64::MAX;
    let norm = |q: P| {
        let (dx, dy) = ((q.0 - from.0) as f64, (q.1 - from.1) as f64);
        (dx * dx + dy * dy).sqrt()
    };
    for contour in shapes.iter().flatten() {
        if contour.is_empty() {
            continue;
        }
        let pts: Vec<P> = contour.iter().map(|&q| frame.nm(q)).collect();
        // `Point::projection_onto(MultiPoint)`: from its first point, the nearest projection on its edges.
        let mut running = pts[0];
        let mut running_min = norm(running);
        for i in 0..pts.len() {
            let q = project_on_segment(from, pts[i], pts[(i + 1) % pts.len()]);
            let d = norm(q);
            if d < running_min {
                running = q;
                running_min = d;
            }
        }
        let d = {
            let (dx, dy) = ((from.0 - running.0) as f64, (from.1 - running.1) as f64);
            dx * dx + dy * dy
        };
        if d < min {
            best = running;
            min = d;
        }
    }
    best
}

/// Orca's `move_out_expolys`: moves `from` out of the shapes grown by `distance` mm, at most `max_move` mm; false
/// when it can't get out of the shapes themselves.
fn move_out(shapes: &Shapes, frame: &Frame, from: &mut P, distance: f64, max_move: f64) -> bool {
    let dilated = union(offset_ex(shapes, scale(distance)));
    let mut pt = projection_onto(&dilated, frame, *from);
    let outward = sub(pt, *from);
    let pt_max = add(*from, normal(outward, scale(max_move)));
    if vsize2(outward) > max_move * max_move {
        pt = pt_max;
    }
    if !Areas::new(&dilated).contain(frame, *from) {
        true
    } else if !Areas::new(shapes).contain(frame, *from) {
        *from = pt;
        true
    } else if !Areas::new(shapes).contain(frame, pt_max) {
        *from = pt_max;
        true
    } else {
        false
    }
}

/// Whether a segment runs through the loops' area (Orca's `intersection_ln` of the line with the layer's contours
/// and holes, non-empty): an end inside, or an edge crossed.
fn cut_by(loops: &[Vec<P>], a: P, b: P) -> bool {
    let inside = |p: P| {
        let mut odd = false;
        for l in loops {
            let n = l.len();
            let mut j = n.wrapping_sub(1);
            let mut in_this = false;
            for i in 0..n {
                let (pa, pb) = (l[j], l[i]);
                if (pa.1 > p.1) != (pb.1 > p.1) {
                    let lhs = (p.0 - pa.0) as i128 * (pb.1 - pa.1) as i128;
                    let rhs = (pb.0 - pa.0) as i128 * (p.1 - pa.1) as i128;
                    if (pb.1 > pa.1 && lhs < rhs) || (pb.1 < pa.1 && lhs > rhs) {
                        in_this = !in_this;
                    }
                }
                j = i;
            }
            if in_this {
                odd = !odd;
            }
        }
        odd
    };
    if inside(a) || inside(b) {
        return true;
    }
    let cross = |o: P, p: P, q: P| -> i128 {
        (p.0 - o.0) as i128 * (q.1 - o.1) as i128 - (p.1 - o.1) as i128 * (q.0 - o.0) as i128
    };
    let (minx, maxx, miny, maxy) = (a.0.min(b.0), a.0.max(b.0), a.1.min(b.1), a.1.max(b.1));
    for l in loops {
        let n = l.len();
        for i in 0..n {
            let (c, d) = (l[i], l[(i + 1) % n]);
            if c.0.max(d.0) < minx || c.0.min(d.0) > maxx || c.1.max(d.1) < miny || c.1.min(d.1) > maxy {
                continue;
            }
            let (d1, d2) = (cross(a, b, c), cross(a, b, d));
            let (d3, d4) = (cross(c, d, a), cross(c, d, b));
            if ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0)) {
                return true;
            }
        }
    }
    false
}

/// A node to make on the layer below once the layer's nodes have all been looked at (Orca's `PendingNode`).
struct Pending {
    position: P,
    distance_to_top: i32,
    support_roof_layers_below: i32,
    to_buildplate: bool,
    parent: usize,
    overhang: Option<std::sync::Arc<crate::geom::Shape>>,
    clamp_radius: Option<(f64, f64)>,
}

/// Orca's `drop_nodes`: each support layer's nodes, from the top down, merged and moved onto the layer below.
pub fn drop_nodes(
    contacts: &mut [Vec<usize>],
    nodes: &mut Nodes,
    layer_heights: &[LayerHeight],
    data: &Data,
    frame: &Frame,
    p: &Params,
) {
    let angle = p.branch_angle * std::f64::consts::PI / 180.0;
    let wall_count = p.wall_count.max(1) as f64;
    let tan_angle = angle.tan();
    let max_move_distance =
        if angle < std::f64::consts::FRAC_PI_2 { tan_angle * p.layer_height * wall_count } else { f64::MAX };
    let max_move_distance2 = max_move_distance * max_move_distance;
    let radius_sample_resolution = super::data::RESOLUTION;
    let dasf = nodes.diameter_angle_scale_factor;
    let do_not_move_under_mm = if p.style == Style::Slim { 0.0 } else { 5.0 };
    let is_strong = p.style == Style::Strong;
    let calc_radius = |mm: f64| p.calc_radius(mm, dasf);
    // `get_max_move_dist`: worked out (with the radius) the first time it is asked for.
    let max_move = |nodes: &mut Nodes, id: usize| -> f64 {
        let node = &mut nodes.all[id];
        if node.max_move_dist == 0.0 {
            if node.radius == 0.0 {
                node.radius = calc_radius(node.dist_mm_to_top);
            }
            node.max_move_dist = (tan_angle * node.height).min(p.support_extrusion_width);
        }
        node.max_move_dist
    };
    if layer_heights.is_empty() {
        return;
    }

    for layer_nr in (1..contacts.len()).rev() {
        if contacts[layer_nr].is_empty() {
            continue;
        }
        let layer_nr_next = layer_nr - 1;
        let print_z_next = layer_heights[layer_nr_next].print_z;
        let height_next = layer_heights[layer_nr_next].height;
        let obj_layer_nr = layer_heights[layer_nr].obj_layer_nr;
        let obj_layer_nr_next = layer_heights[layer_nr_next].obj_layer_nr;
        let layer_contours = loops_nm(&data.outlines[obj_layer_nr], frame);
        let mut cut_cache: HashMap<(P, P), bool> = HashMap::new();
        let mut is_line_cut_by_contour = |a: P, b: P| -> bool {
            if let Some(&c) = cut_cache.get(&(a, b)) {
                return c;
            }
            let c = cut_by(&layer_contours, b, a);
            cut_cache.insert((a, b), c);
            cut_cache.insert((b, a), c);
            c
        };

        // The nodes grouped by the part of the object below them that is nearest (those going to the plate in the
        // first group).
        let parts = &data.outlines_below[obj_layer_nr];
        let part_areas: Vec<Areas> = parts.iter().map(|s| Areas::new(std::slice::from_ref(s))).collect();
        let mut nodes_per_part: Vec<StdMap<usize>> = (0..=parts.len()).map(|_| StdMap::default()).collect();
        for &id in &contacts[layer_nr] {
            let node = &nodes.all[id];
            if node.to_buildplate || parts.is_empty() {
                nodes_per_part[0].put(node.position, id);
                continue;
            }
            let mut closest_part = usize::MAX;
            let mut closest_d2 = f64::MAX;
            for (k, part) in parts.iter().enumerate() {
                if part_areas[k].contain(frame, node.position) {
                    closest_part = k;
                    break;
                }
                // The nearest of the part's points.
                let pos = node.position;
                let mut best = frame.nm(part[0][0]);
                let mut best_d = f64::MAX;
                for &q in &part[0] {
                    let q = frame.nm(q);
                    let (dx, dy) = ((q.0 - pos.0) as f64, (q.1 - pos.1) as f64);
                    let d = (dx * dx + dy * dy).sqrt();
                    if d < best_d {
                        best_d = d;
                        best = q;
                    }
                }
                let d2 = vsize2(sub(pos, best));
                if d2 < closest_d2 {
                    closest_d2 = d2;
                    closest_part = k;
                }
            }
            nodes_per_part[closest_part.wrapping_add(1)].put(node.position, id);
        }
        let trees: Vec<Mst> = nodes_per_part
            .iter()
            .map(|group| Mst::new(&group.iter().map(|(pos, _)| pos).collect::<Vec<P>>()))
            .collect();

        for (group_index, group) in nodes_per_part.iter().enumerate() {
            let mst = &trees[group_index];
            let at = |pos: P| *group.get(pos).expect("a tree's vertex is one of its group's nodes");
            let nodes_vec: Vec<usize> = group.iter().map(|(_, &id)| id).collect();

            // First, merge the nodes that are close together.
            for &id in &nodes_vec {
                if !nodes.all[id].valid {
                    continue;
                }
                let position = nodes.all[id].position;
                let neighbours = mst.adjacent(position);
                if nodes.all[id].kind == NodeType::Polygon {
                    // Circles wholly inside the polygon join it.
                    let overhang = nodes.all[id].overhang.clone();
                    let shapes: Shapes = overhang.iter().map(|s| (**s).clone()).collect();
                    let inside = Areas::new(&shapes);
                    for &neighbour in neighbours {
                        let nb = at(neighbour);
                        if !nodes.all[nb].valid || nodes.all[nb].kind == NodeType::Polygon {
                            continue;
                        }
                        let r = scale(nodes.all[nb].radius) as i64;
                        let probes = [
                            neighbour,
                            add(neighbour, (0, r)),
                            sub(neighbour, (0, r)),
                            sub(neighbour, (r, 0)),
                            add(neighbour, (r, 0)),
                        ];
                        if probes.iter().all(|&q| inside.contain(frame, q)) {
                            let (dtt, roof, dist) = {
                                let n = &nodes.all[nb];
                                (n.distance_to_top, n.support_roof_layers_below, n.dist_mm_to_top)
                            };
                            let theirs: Vec<usize> = nodes.all[nb].merged_neighbours.iter().copied().collect();
                            let node = &mut nodes.all[id];
                            node.distance_to_top = node.distance_to_top.max(dtt);
                            node.support_roof_layers_below = node.support_roof_layers_below.max(roof);
                            node.dist_mm_to_top = node.dist_mm_to_top.max(dist);
                            node.merged_neighbours.push_front(nb);
                            node.merged_neighbours.extend(theirs);
                            nodes.all[nb].valid = false;
                        }
                    }
                } else if neighbours.len() == 1
                    && vsize2(sub(neighbours[0], position)) < max_move(nodes, id).powi(2)
                    && mst.adjacent(neighbours[0]).len() == 1
                    && nodes.all[at(neighbours[0])].kind != NodeType::Polygon
                {
                    // Two nodes left, close together: a new node between them, where both end.
                    let mut next_position = ((position.0 + neighbours[0].0) / 2, (position.1 + neighbours[0].1) / 2);
                    let next_radius = calc_radius(nodes.all[id].dist_mm_to_top + height_next);
                    if group_index == 0 {
                        let avoid = data.avoidance(next_radius, obj_layer_nr_next);
                        let max_move_between_samples = max_move_distance + radius_sample_resolution + EPSILON;
                        move_out(
                            &avoid,
                            frame,
                            &mut next_position,
                            radius_sample_resolution + EPSILON,
                            max_move_between_samples,
                        );
                    }
                    let nb = at(neighbours[0]);
                    let (a, b) = (&nodes.all[id], &nodes.all[nb]);
                    let node_parent = if a.parent.is_some() && b.parent.is_some() {
                        if a.dist_mm_to_top >= b.dist_mm_to_top { id } else { nb }
                    } else if a.parent.is_some() {
                        id
                    } else {
                        nb
                    };
                    let other = if node_parent == id { nb } else { id };
                    nodes.all[node_parent].merged_neighbours.push_front(other);
                    let to_buildplate =
                        !Areas::new(&data.collision(0.0, obj_layer_nr_next)).contain(frame, next_position);
                    let parent = &nodes.all[node_parent];
                    let next = nodes.create(NewNode {
                        position: next_position,
                        distance_to_top: parent.distance_to_top + 1,
                        obj_layer_nr: obj_layer_nr_next,
                        support_roof_layers_below: parent.support_roof_layers_below
                            - i32::from(parent.distance_to_top >= 0),
                        to_buildplate,
                        parent: Some(node_parent),
                        print_z: print_z_next,
                        height: height_next,
                        dist_mm_to_top: 0.0,
                        radius: 0.0,
                    });
                    max_move(nodes, next);
                    contacts[layer_nr_next].push(next);
                    nodes.all[nb].valid = false;
                    nodes.all[id].valid = false;
                } else if neighbours.len() > 1 {
                    // Neighbours within a move join this node, if it is the bigger.
                    for &neighbour in neighbours {
                        if vsize2(sub(neighbour, position)) < max_move(nodes, id).powi(2) {
                            let nb = at(neighbour);
                            if nodes.all[nb].kind == NodeType::Polygon
                                || nodes.all[id].dist_mm_to_top < nodes.all[nb].dist_mm_to_top
                            {
                                continue;
                            }
                            if nodes.all[id].valid {
                                let theirs: Vec<usize> = nodes.all[nb].merged_neighbours.iter().copied().collect();
                                let node = &mut nodes.all[id];
                                node.merged_neighbours.push_front(nb);
                                node.merged_neighbours.extend(theirs);
                                nodes.all[nb].valid = false;
                            }
                        }
                    }
                }
            }

            // Then move every node left: towards its neighbours, out of the object's way.
            let mut pending: Vec<Vec<Pending>> = Vec::with_capacity(nodes_vec.len());
            let mut invalidate: Vec<bool> = vec![false; nodes_vec.len()];
            for (k, &id) in nodes_vec.iter().enumerate() {
                let mut out: Vec<Pending> = Vec::new();
                if !nodes.all[id].valid {
                    pending.push(out);
                    continue;
                }
                if nodes.all[id].kind == NodeType::Polygon {
                    // A polygon doesn't move: what of it the layer below doesn't take goes on down.
                    let node = &nodes.all[id];
                    let shapes: Shapes = node.overhang.iter().map(|s| (**s).clone()).collect();
                    let next = crate::tree::util::diff(&shapes, &data.collision(0.0, obj_layer_nr_next));
                    for overhang in next {
                        let c = centroid(&overhang[0].iter().map(|&q| frame.nm(q)).collect::<Vec<P>>());
                        out.push(Pending {
                            position: c,
                            distance_to_top: node.distance_to_top + 1,
                            support_roof_layers_below: node.support_roof_layers_below
                                - i32::from(node.distance_to_top >= 0),
                            to_buildplate: true,
                            parent: id,
                            overhang: Some(std::sync::Arc::new(overhang)),
                            clamp_radius: None,
                        });
                    }
                    pending.push(out);
                    continue;
                }
                let position = nodes.all[id].position;
                // A branch wholly inside the object's way (but for its edge) ends; one whose link up runs through
                // the object ends too.
                if group_index > 0 {
                    let collision = data.collision(0.0, obj_layer_nr);
                    if Areas::new(&collision).contain(frame, position) {
                        let branch_radius = {
                            let node = &mut nodes.all[id];
                            if node.radius == 0.0 {
                                node.radius = calc_radius(node.dist_mm_to_top);
                            }
                            node.radius
                        };
                        let to_outside = projection_onto(&collision, frame, position);
                        if vsize2(sub(position, to_outside)) >= branch_radius * branch_radius {
                            invalidate[k] = true;
                            pending.push(out);
                            continue;
                        }
                        if let Some(parent) = nodes.all[id].parent
                            && cut_by(&layer_contours, position, nodes.all[parent].position)
                        {
                            invalidate[k] = true;
                            pending.push(out);
                            continue;
                        }
                    }
                }
                let neighbours = mst.adjacent(position);
                let mut move_to_neighbor_center = (0, 0);
                let dist2_to_first_neighbor =
                    if neighbours.is_empty() { 0.0 } else { vsize2(sub(neighbours[0], position)) as f32 };
                if nodes.all[id].print_z > do_not_move_under_mm
                    && (neighbours.len() > 1
                        || (neighbours.len() == 1 && dist2_to_first_neighbor as f64 >= max_move(nodes, id).powi(2)))
                {
                    let mut sum: P = (0, 0);
                    for &neighbour in neighbours {
                        let nb = at(neighbour);
                        if !nodes.all[nb].valid {
                            continue;
                        }
                        let direction = sub(neighbour, position);
                        let dist2_to_neighbor = vsize2(direction) as f32;
                        let (node, other) = (&nodes.all[id], &nodes.all[nb]);
                        let branch_bottom_radius = calc_radius(node.dist_mm_to_top + node.print_z);
                        let neighbour_bottom_radius = calc_radius(other.dist_mm_to_top + other.print_z);
                        let max_converge = tan_angle * (node.print_z - do_not_move_under_mm)
                            + branch_bottom_radius.max(neighbour_bottom_radius);
                        if dist2_to_neighbor as f64 > max_converge * max_converge {
                            continue;
                        }
                        if is_line_cut_by_contour(position, neighbour) {
                            continue;
                        }
                        sum = if is_strong {
                            add(sum, direction)
                        } else {
                            add(sum, mul(direction, (1.0 / dist2_to_neighbor) as f64))
                        };
                    }
                    // Strong trees move at most a move's distance towards them (asked for only then, as Orca asks).
                    move_to_neighbor_center = if !is_strong || vsize2(sum) <= max_move(nodes, id).powi(2) {
                        sum
                    } else {
                        normal(sum, scale(max_move(nodes, id)))
                    };
                }
                let next_radius = calc_radius(nodes.all[id].dist_mm_to_top + height_next);
                let avoidance_next = data.avoidance(next_radius, obj_layer_nr_next);
                let to_outside = projection_onto(&avoidance_next, frame, position);
                let mut direction_to_outer = sub(to_outside, position);
                let mut dist2_to_outer = vsize2(direction_to_outer);
                if is_line_cut_by_contour(position, to_outside)
                    || dist2_to_outer > max_move_distance2 * (obj_layer_nr as f64).powi(2)
                    || !Areas::new(&avoidance_next).contain(frame, position)
                {
                    // Out of the layer below's way instead.
                    let mut candidate = position;
                    let max_move_between_samples = max_move_distance + radius_sample_resolution + EPSILON;
                    let collision = data.collision(next_radius, obj_layer_nr_next);
                    if move_out(&collision, frame, &mut candidate, max_move_between_samples, max_move_between_samples) {
                        direction_to_outer = sub(candidate, position);
                        dist2_to_outer = vsize2(direction_to_outer);
                    } else {
                        direction_to_outer = (0, 0);
                        dist2_to_outer = 0.0;
                    }
                }
                let step = scale(max_move(nodes, id));
                let node = &nodes.all[id];
                let movement = if node.is_sharp_tail && node.dist_mm_to_top < 3.0 {
                    normal(node.skin_direction, step)
                } else if dist2_to_outer > 0.0 {
                    normal(direction_to_outer, step)
                } else {
                    normal(move_to_neighbor_center, step)
                };
                let next_layer_vertex = add(position, movement);
                let next_collision = data.collision(0.0, obj_layer_nr_next);
                let to_buildplate = !Areas::new(&next_collision).contain(frame, next_layer_vertex);
                let to_outside = projection_onto(&next_collision, frame, next_layer_vertex);
                let d = sub(to_outside, position);
                let dist_to_outer = ((d.0 as f64).powi(2) + (d.1 as f64).powi(2)).sqrt() * SCALING_FACTOR;
                out.push(Pending {
                    position: next_layer_vertex,
                    distance_to_top: node.distance_to_top + 1,
                    support_roof_layers_below: node.support_roof_layers_below - i32::from(node.distance_to_top >= 0),
                    to_buildplate,
                    parent: id,
                    overhang: None,
                    clamp_radius: Some((node.radius, dist_to_outer)),
                });
                pending.push(out);
            }
            // The new nodes, in the nodes' order.
            for (k, list) in pending.into_iter().enumerate() {
                for pn in list {
                    let next = nodes.create(NewNode {
                        position: pn.position,
                        distance_to_top: pn.distance_to_top,
                        obj_layer_nr: obj_layer_nr_next,
                        support_roof_layers_below: pn.support_roof_layers_below,
                        to_buildplate: pn.to_buildplate,
                        parent: Some(pn.parent),
                        print_z: print_z_next,
                        height: height_next,
                        dist_mm_to_top: 0.0,
                        radius: 0.0,
                    });
                    if let Some(o) = pn.overhang {
                        nodes.all[next].overhang = Some(o);
                    }
                    if let Some((parent_radius, dist_to_outer)) = pn.clamp_radius {
                        let r = nodes.all[next].radius;
                        nodes.all[next].radius = parent_radius.max(r.min(dist_to_outer));
                        max_move(nodes, next);
                    }
                    contacts[layer_nr_next].push(next);
                }
                if invalidate[k] {
                    nodes.all[nodes_vec[k]].valid = false;
                }
            }
        }
    }
}

/// `Polygon::centroid`, rounded.
fn centroid(points: &[P]) -> P {
    let mut area_sum = 0.0;
    let (mut cx, mut cy) = (0.0, 0.0);
    if points.len() >= 3 {
        let mut p1 = *points.last().unwrap();
        for &p2 in points {
            let (x1, y1, x2, y2) = (p1.0 as f64, p1.1 as f64, p2.0 as f64, p2.1 as f64);
            let a = x1 * y2 - y1 * x2;
            area_sum += a;
            cx += (x1 + x2) * a;
            cy += (y1 + y2) * a;
            p1 = p2;
        }
    }
    ((cx / (3.0 * area_sum)).round() as i64, (cy / (3.0 * area_sum)).round() as i64)
}

/// Orca's `smooth_nodes`: each branch's run of nodes (from the one below its lowest, if any, up to where another
/// branch already smoothed it) averaged with its neighbours a hundred times, its ends fixed.
pub fn smooth_nodes(contacts: &[Vec<usize>], nodes: &mut Nodes) {
    for layer in contacts {
        for &id in layer {
            nodes.all[id].is_processed = false;
        }
    }
    for layer in contacts {
        for &id in layer {
            if nodes.all[id].is_processed {
                continue;
            }
            let mut branch: Vec<usize> = Vec::new();
            if let Some(child) = nodes.all[id].child
                && nodes.all[child].kind != NodeType::Polygon
            {
                branch.push(child);
            }
            let mut p = Some(id);
            while let Some(n) = p {
                branch.push(n);
                p = nodes.all[n].parent;
                if p.is_some_and(|q| nodes.all[q].is_processed) {
                    break;
                }
            }
            if branch.len() < 3 {
                continue;
            }
            let mut pts: Vec<P> = branch.iter().map(|&n| nodes.all[n].position).collect();
            let mut radii: Vec<f64> = branch.iter().map(|&n| nodes.all[n].radius).collect();
            let mut pts1 = pts.clone();
            let mut radii1 = radii.clone();
            const ITERATIONS: usize = 100;
            for k in 0..ITERATIONS {
                for i in 1..pts.len() - 1 {
                    let s = (pts[i - 1].0 + pts[i].0 + pts[i + 1].0, pts[i - 1].1 + pts[i].1 + pts[i + 1].1);
                    let pt = (s.0 / 3, s.1 / 3);
                    pts1[i] = pt;
                    radii1[i] = (radii[i - 1] + radii[i] + radii[i + 1]) / 3.0;
                    if k == ITERATIONS - 1 {
                        let movement = ((pts[i + 1].0 - pts[i - 1].0) / 2, (pts[i + 1].1 - pts[i - 1].1) / 2);
                        let node = &mut nodes.all[branch[i]];
                        node.position = pt;
                        node.radius = radii1[i];
                        node.movement = movement;
                        node.is_processed = true;
                    }
                }
                if k < ITERATIONS - 1 {
                    std::mem::swap(&mut pts, &mut pts1);
                    std::mem::swap(&mut radii, &mut radii1);
                }
            }
        }
    }
}
