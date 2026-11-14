//! Orca's classic trees (`TreeSupport.cpp`, its older tree code): the slim, strong and hybrid styles of tree
//! support. Contact points are placed under each overhang (its corners, along its outline, and on a grid inside it),
//! dropped layer by layer towards the plate, moving towards their neighbours on a minimum spanning tree and away
//! from the object, merging when they meet; then each node is drawn as a circle (an ellipse when it moves), and
//! the circles printed as walls. Hybrid trees support big overhangs with columns as normal supports do.
//!
//! Positions are Orca's: nanometres, about the middle of the object's bounding box. Shapes are ours (0.1 µm units
//! on the plate) and are converted where the two meet.

pub mod contact;
pub mod data;
pub mod draw;
pub mod drop;
pub mod mst;
pub mod order;

use crate::geom::{Pt, Shape};
use mst::P;
use std::collections::VecDeque;

/// Orca's `EPSILON`.
pub const EPSILON: f64 = 1e-4;
/// mm: Orca's bounds on a branch's radius.
pub const MIN_BRANCH_RADIUS: f64 = 0.4;
pub const MAX_BRANCH_RADIUS: f64 = 10.0;
pub const MIN_BRANCH_RADIUS_FIRST_LAYER: f64 = 2.0;
pub const MAX_BRANCH_RADIUS_FIRST_LAYER: f64 = 12.0;

/// The three classic styles (`support_style`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Style {
    Slim,
    Strong,
    Hybrid,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeType {
    Circle,
    /// A hybrid tree's normal support under a big overhang, drawn as the overhang itself.
    Polygon,
}

/// Orca's `SupportNode`: a branch's point on one support layer. `parent` is the node it came from, a layer up;
/// `child` the one it goes on to, a layer down.
#[derive(Clone, Debug)]
pub struct Node {
    /// Layers to the top of the branch; negative for the gap under the overhang, which isn't printed.
    pub distance_to_top: i32,
    /// mm to the overhang.
    pub dist_mm_to_top: f64,
    pub position: P,
    pub movement: P,
    /// mm.
    pub radius: f64,
    pub max_move_dist: f64,
    pub kind: NodeType,
    pub is_corner: bool,
    pub is_processed: bool,
    pub is_sharp_tail: bool,
    pub valid: bool,
    /// The overhang it holds up (ours, on the plate), for interfaces and hybrid columns.
    pub overhang: Option<std::sync::Arc<Shape>>,
    pub skin_direction: P,
    pub support_roof_layers_below: i32,
    pub obj_layer_nr: usize,
    pub to_buildplate: bool,
    pub parent: Option<usize>,
    pub parents: Vec<usize>,
    pub child: Option<usize>,
    pub merged_neighbours: VecDeque<usize>,
    pub print_z: f64,
    pub height: f64,
}

/// All nodes, by index (Orca's `contact_nodes` owning list).
#[derive(Default)]
pub struct Nodes {
    pub all: Vec<Node>,
    /// Orca's `SupportNode::diameter_angle_scale_factor`.
    pub diameter_angle_scale_factor: f64,
}

/// What a new node starts from (`TreeSupportData::create_node`'s arguments).
pub struct NewNode {
    pub position: P,
    pub distance_to_top: i32,
    pub obj_layer_nr: usize,
    pub support_roof_layers_below: i32,
    pub to_buildplate: bool,
    pub parent: Option<usize>,
    pub print_z: f64,
    pub height: f64,
    pub dist_mm_to_top: f64,
    pub radius: f64,
}

impl Nodes {
    /// Orca's `create_node`: a node below `parent` takes its type, overhang, sharp tail and skin direction, its
    /// distance to the top a layer more, its radius grown with that distance, and becomes the child of the parent
    /// and of every node merged into it.
    pub fn create(&mut self, n: NewNode) -> usize {
        let id = self.all.len();
        let mut node = Node {
            distance_to_top: n.distance_to_top,
            dist_mm_to_top: n.dist_mm_to_top,
            position: n.position,
            movement: (0, 0),
            radius: n.radius,
            max_move_dist: 0.0,
            kind: NodeType::Circle,
            is_corner: false,
            is_processed: false,
            is_sharp_tail: false,
            valid: true,
            overhang: None,
            skin_direction: (0, 0),
            support_roof_layers_below: n.support_roof_layers_below,
            obj_layer_nr: n.obj_layer_nr,
            to_buildplate: n.to_buildplate,
            parent: n.parent,
            parents: Vec::new(),
            child: None,
            merged_neighbours: VecDeque::new(),
            print_z: n.print_z,
            height: n.height,
        };
        if let Some(p) = n.parent {
            let parent = &self.all[p];
            node.parents.push(p);
            node.kind = parent.kind;
            node.overhang = parent.overhang.clone();
            if node.dist_mm_to_top == 0.0 {
                node.dist_mm_to_top = parent.dist_mm_to_top + parent.height;
            }
            if node.radius == 0.0 && parent.radius > 0.0 {
                node.radius =
                    parent.radius + (node.dist_mm_to_top - parent.dist_mm_to_top) * self.diameter_angle_scale_factor;
            }
            node.is_sharp_tail = parent.is_sharp_tail;
            node.skin_direction = parent.skin_direction;
            node.movement = (n.position.0 - parent.position.0, n.position.1 - parent.position.1);
            let merged: Vec<usize> = parent.merged_neighbours.iter().copied().collect();
            self.all[p].child = Some(id);
            for m in merged {
                self.all[m].child = Some(id);
                node.parents.push(m);
            }
        }
        self.all.push(node);
        id
    }
}

/// Converts between Orca's frame (nanometres about the object's middle) and ours (0.1 µm units on the plate).
#[derive(Clone, Copy, Debug)]
pub struct Frame {
    /// nm on the plate of the object frame's origin.
    pub origin: (i64, i64),
}

impl Frame {
    pub fn nm(&self, p: Pt) -> P {
        (p.x as i64 * 100 - self.origin.0, p.y as i64 * 100 - self.origin.1)
    }

    /// A point in plate nanometres (a nanometre shape's) in Orca's frame, and back.
    pub fn from_plate_nm(&self, q: Pt) -> P {
        (q.x as i64 - self.origin.0, q.y as i64 - self.origin.1)
    }

    pub fn plate_nm(&self, p: P) -> Pt {
        crate::geom::pt((p.0 + self.origin.0) as i32, (p.1 + self.origin.1) as i32)
    }

    pub fn units(&self, p: P) -> Pt {
        let r = |v: i64| (v as f64 / 100.0).round() as i32;
        crate::geom::pt(r(p.0 + self.origin.0), r(p.1 + self.origin.1))
    }
}

/// An object's classic trees (slim, strong or hybrid, as its settings ask), as Orca's `TreeSupport::generate` makes
/// them: overhangs found as for the organic trees, contact points under them, the support's layers planned, the
/// nodes dropped and smoothed, drawn, and printed. Nothing where nothing needs support.
pub fn supports(
    o: &crate::support::Object,
    s: &crate::config::Settings,
    params: &crate::support::Params,
) -> Vec<crate::support::Layer> {
    let Some(style) = s.support.classic() else { return Vec::new() };
    let sp = &s.support;
    if o.slices.len() < 2 {
        return Vec::new();
    }
    let config = crate::tree::Config::new(s);
    let found = crate::tree::overhangs::detect(&o.slices, o.height, &config, s);
    if found.iter().all(|layer| layer.is_empty()) {
        return Vec::new();
    }
    // The detected overhangs to the nanometre, which the tips are spaced along.
    let nm_overhangs: Vec<crate::geom::Shapes> = crate::par::map_range(found.len(), |l| {
        if l > 0 && found[l].iter().any(|(_, k)| *k == crate::tree::overhangs::Kind::Detected) {
            crate::tree::overhangs::detected_nm(&o.slices, o.height, &config, s, l)
        } else {
            Vec::new()
        }
    });
    let (min_layer_height, max_layer_height) = params.layer_bounds();
    // Orca keeps the top gap as a float, at least the thinnest layer.
    let mut top_z_distance = sp.top_z_distance as f32;
    if top_z_distance as f64 > EPSILON {
        top_z_distance = top_z_distance.max(min_layer_height as f32);
    }
    let top_z_distance = top_z_distance as f64;
    let base_radius = MIN_BRANCH_RADIUS.max(sp.classic_branch_diameter / 2.0);
    let data = data::Data::new(&o.slices, o.height, sp.xy_distance, sp.classic_branch_angle);
    let frame = Frame { origin: ((o.origin.0 * 100.0).round() as i64, (o.origin.1 * 100.0).round() as i64) };
    let mut nodes = Nodes {
        all: Vec::new(),
        diameter_angle_scale_factor: (sp.tree_branch_diameter_angle * std::f64::consts::PI / 180.0)
            .clamp(0.0, 0.5 * std::f64::consts::PI - EPSILON),
    };
    let object_size = ((o.size.0 / mst::SCALING_FACTOR) as i64, (o.size.1 / mst::SCALING_FACTOR) as i64);
    let contacts = contact::contact_points(
        &found,
        &nm_overhangs,
        &data.outlines_below,
        o.print_z,
        o.height,
        object_size,
        &frame,
        &contact::Params {
            style,
            base_radius,
            branch_distance: sp.classic_branch_distance,
            max_bridge_length: sp.max_bridge_length,
            top_z_distance,
            layer_height: s.layer_height,
            top_interface_layers: sp.top_interface_layers as i32,
        },
        &mut nodes,
    );
    let mut layers = contacts.layers;
    let heights = drop::plan_layer_heights(
        &mut layers,
        &mut nodes,
        o.print_z,
        o.height,
        sp.independent_layer_height,
        min_layer_height,
        max_layer_height,
        top_z_distance,
    );
    drop::drop_nodes(
        &mut layers,
        &mut nodes,
        &heights,
        &data,
        &frame,
        &drop::Params {
            style,
            base_radius,
            support_extrusion_width: sp.line_width,
            layer_height: s.layer_height,
            branch_angle: sp.classic_branch_angle,
            wall_count: sp.wall_count,
            top_interface_layers: sp.top_interface_layers as i32,
        },
    );
    drop::smooth_nodes(&layers, &mut nodes);
    let bed_units = [(s.bed[0] * crate::geom::SCALE) as i32, (s.bed[1] * crate::geom::SCALE) as i32];
    let bed: crate::geom::Shapes = vec![vec![vec![
        crate::geom::pt(0, 0),
        crate::geom::pt(bed_units[0], 0),
        crate::geom::pt(bed_units[0], bed_units[1]),
        crate::geom::pt(0, bed_units[1]),
    ]]];
    let drawn = draw::draw_circles(
        &layers,
        &nodes,
        &heights,
        &data,
        &draw::ObjectLayers { print_z: o.print_z, height: o.height, tops: &o.tops, slices: &o.slices },
        &frame,
        contacts.avg_node_per_layer,
        contacts.nodes_angle,
        &draw::Params {
            style,
            branch_radius: sp.classic_branch_diameter / 2.0,
            top_z_distance,
            bottom_z_distance: sp.bottom_z_distance,
            xy_distance: sp.xy_distance,
            first_layer_gap: sp.first_layer_xy_distance,
            top_interface_layers: sp.top_interface_layers,
            bottom_interface_layers: sp.bottom_interface_layers,
            layer_height: s.layer_height,
            line_width: sp.line_width,
            support_extrusion_width: sp.line_width,
            auto_brim: sp.tree_auto_brim,
            brim_width: sp.tree_brim_width,
            first_layer_expansion: sp.first_layer_expansion,
            gap_xy_first_layer: sp.first_layer_xy_distance,
            first_layer_width: s.first_layer_width,
            with_infill: style == Style::Hybrid && matches!(sp.base_pattern.as_str(), "default" | ""),
            bed,
        },
    );
    crate::support::classic_layers(drawn, o.origin, sp.wall_count.max(0) as usize, params)
}
