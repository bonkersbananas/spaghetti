//! Orca 2.5.1's `SkeletalTrapezoidation` (Arachne): the Voronoi diagram of an outline turned into a half-edge
//! graph whose edges carry the distance to the outline, the central ones (where the outline is narrow enough that
//! beads run along it) given bead counts, the transitions between counts placed and smoothed, and the beadings
//! propagated over the whole graph, from which the junctions where each bead crosses an edge and then the lines
//! of beads come. Every function here is Orca's, in its order and in its integer and float arithmetic (the
//! float parts are f32 where Orca's are `float`); a function's doc comment names the Orca function it ports.

use super::beading::{Beading, BeadingStrategy};
use super::graph::{EdgeType, Graph, Junction, P, TransitionEnd, TransitionMiddle, p, shorter_then};
use super::voronoi::{self, Segment, Vd};
use std::collections::{BTreeSet, BinaryHeap, HashMap, HashSet};

/// `BeadingPropagation`.
#[derive(Clone, Debug)]
struct Propagation {
    beading: Beading,
    dist_to_bottom_source: i64,
    dist_from_top_source: i64,
    is_upward_propagated_only: bool,
}

impl Propagation {
    fn new(beading: Beading) -> Propagation {
        Propagation { beading, dist_to_bottom_source: 0, dist_from_top_source: 0, is_upward_propagated_only: false }
    }
}

/// `ExtrusionLine`: a bead's path, as junctions with a width each.
#[derive(Clone, Debug)]
pub struct Line {
    pub inset_idx: usize,
    pub is_odd: bool,
    pub is_closed: bool,
    pub junctions: Vec<Junction>,
}

const BEAD_SEARCH_MAX: usize = 1000;

fn scaled(mm: f64) -> i64 {
    (mm * 1_000_000.0) as i64
}

pub struct Trapezoidation<'a> {
    pub graph: Graph,
    strategy: &'a dyn BeadingStrategy,
    transitioning_angle: f64,
    discretization_step_size: i64,
    transition_filter_dist: i64,
    allowed_filter_deviation: i64,
    beading_propagation_transition_dist: i64,
    beadings: Vec<Propagation>,
    next_transition_id: u32,
    toolpaths: Vec<Vec<Line>>,
}

impl<'a> Trapezoidation<'a> {
    fn snap_dist(&self) -> i64 {
        scaled(0.02)
    }

    /// `SkeletalTrapezoidation::SkeletalTrapezoidation`: the graph of `polys` (contours counter-clockwise, holes
    /// clockwise, in nanometres). `None` where the Voronoi diagram can't be built.
    pub fn new(
        polys: &[Vec<P>],
        strategy: &'a dyn BeadingStrategy,
        transitioning_angle: f64,
        discretization_step_size: i64,
        transition_filter_dist: i64,
        allowed_filter_deviation: i64,
        beading_propagation_transition_dist: i64,
    ) -> Option<Trapezoidation<'a>> {
        let mut t = Trapezoidation {
            graph: Graph::default(),
            strategy,
            transitioning_angle,
            discretization_step_size,
            transition_filter_dist,
            allowed_filter_deviation,
            beading_propagation_transition_dist,
            beadings: Vec::new(),
            next_transition_id: 0,
            toolpaths: Vec::new(),
        };
        t.construct_from_polygons(polys)?;
        Some(t)
    }

    // ---- Initialisation ----

    fn make_node(&mut self, map: &mut HashMap<usize, usize>, vd_vertex: usize, pt: P) -> usize {
        *map.entry(vd_vertex).or_insert_with(|| self.graph.add_node(pt, true))
    }

    /// `discretize`.
    fn discretize(&self, vd: &Vd, vd_edge: usize, segments: &[Segment]) -> Vec<P> {
        let e = &vd.edges[vd_edge];
        let (left_cell, right_cell) = (e.cell, vd.edges[e.twin].cell);
        let start = vd.point(e.v0.unwrap());
        let end = vd.point(e.v1.unwrap());
        let point_left = vd.cells[left_cell].contains_point;
        let point_right = vd.cells[right_cell].contains_point;
        if (!point_left && !point_right) || e.secondary {
            return vec![start, end];
        }
        if point_left != point_right {
            let pt = vd.source_point(if point_left { left_cell } else { right_cell }, segments);
            let s = vd.source_segment(if point_left { right_cell } else { left_cell }, segments);
            return voronoi::discretize_parabola(
                pt,
                s.from,
                s.to,
                start,
                end,
                self.discretization_step_size,
                self.transitioning_angle as f32,
            );
        }
        // A straight edge between two points, still discretised since the part narrows between them.
        let left_point = vd.source_point(left_cell, segments);
        let right_point = vd.source_point(right_cell, segments);
        let d = (right_point - left_point).norm();
        let middle = p((left_point.x + right_point.x) / 2, (left_point.y + right_point.y) / 2);
        let rl = right_point - left_point;
        let x_axis_dir = p(-rl.y, rl.x);
        let x_axis_length = x_axis_dir.norm();
        let projected_x = |from: P| {
            let vec = from - middle;
            (vec.x * x_axis_dir.x + vec.y * x_axis_dir.y) / x_axis_length
        };
        let start_x = projected_x(start);
        let end_x = projected_x(end);
        let bound: f32 = (0.5 / libm::tan((std::f64::consts::PI - self.transitioning_angle) * 0.5)) as f32;
        let mut marking_start_x = ((-(d as f32)) * bound) as i64;
        let mut marking_end_x = ((d as f32) * bound) as i64;
        let along = |x: i64| p(x_axis_dir.x * x / x_axis_length, x_axis_dir.y * x / x_axis_length);
        let mut marking_start = middle + along(marking_start_x);
        let mut marking_end = middle + along(marking_end_x);
        let mut direction: i64 = 1;
        if start_x > end_x {
            direction = -1;
            std::mem::swap(&mut marking_start, &mut marking_end);
            std::mem::swap(&mut marking_start_x, &mut marking_end_x);
        }
        let (a, b) = (start, end);
        let mut ret = vec![a];
        let mut add_marking_start = marking_start_x * direction > start_x * direction;
        let mut add_marking_end = marking_end_x * direction > start_x * direction;
        let ab = b - a;
        let ab_size = ab.norm();
        let mut step_count = (ab_size + self.discretization_step_size / 2) / self.discretization_step_size;
        if step_count % 2 == 1 {
            step_count += 1;
        }
        for step in 1..step_count {
            let here = a + p(ab.x * step / step_count, ab.y * step / step_count);
            let x_here = projected_x(here);
            if add_marking_start && marking_start_x * direction < x_here * direction {
                ret.push(marking_start);
                add_marking_start = false;
            }
            if add_marking_end && marking_end_x * direction < x_here * direction {
                ret.push(marking_end);
                add_marking_end = false;
            }
            ret.push(here);
        }
        if add_marking_end && marking_end_x * direction < end_x * direction {
            ret.push(marking_end);
        }
        ret.push(b);
        ret
    }

    /// `transferEdge`.
    #[allow(clippy::too_many_arguments)]
    fn transfer_edge(
        &mut self,
        vd: &Vd,
        edge_map: &mut HashMap<usize, usize>,
        node_map: &mut HashMap<usize, usize>,
        from: P,
        to: P,
        vd_edge: usize,
        prev_edge: &mut Option<usize>,
        start_source: P,
        end_source: P,
        segments: &[Segment],
    ) {
        let twin_key = vd.edges[vd_edge].twin;
        if let Some(&source_twin) = edge_map.get(&twin_key) {
            let Some(&end_node) = node_map.get(&vd.edges[vd_edge].v1.unwrap()) else { return };
            let mut twin = source_twin;
            loop {
                let edge = self.graph.add_edge(EdgeType::Normal, true);
                self.graph.edges[edge].from = self.graph.edges[twin].to;
                self.graph.edges[edge].to = self.graph.edges[twin].from;
                self.graph.edges[edge].twin = Some(twin);
                self.graph.edges[twin].twin = Some(edge);
                let from_node = self.graph.edges[edge].from;
                self.graph.nodes[from_node].incident_edge = Some(edge);
                if let Some(pe) = *prev_edge {
                    self.graph.edges[edge].prev = Some(pe);
                    self.graph.edges[pe].next = Some(edge);
                }
                *prev_edge = Some(edge);
                if self.graph.edges[edge].to == end_node {
                    return;
                }
                let Some(tp) = self.graph.edges[twin].prev else { return };
                let Some(tpt) = self.graph.edges[tp].twin else { return };
                let Some(tptp) = self.graph.edges[tpt].prev else { return };
                let mut pe = edge;
                self.graph.make_rib(&mut pe, start_source, end_source);
                *prev_edge = Some(pe);
                twin = tptp;
            }
        }
        let discretized = self.discretize(vd, vd_edge, segments);
        let v0_node = match *prev_edge {
            Some(pe) => self.graph.edges[pe].to,
            None => self.make_node(node_map, vd.edges[vd_edge].v0.unwrap(), from),
        };
        let mut v0 = v0_node;
        for p1_idx in 1..discretized.len() {
            let p1 = discretized[p1_idx];
            let v1 = if p1_idx < discretized.len() - 1 {
                self.graph.add_node(p1, true)
            } else {
                self.make_node(node_map, vd.edges[vd_edge].v1.unwrap(), to)
            };
            let edge = self.graph.add_edge(EdgeType::Normal, true);
            self.graph.edges[edge].from = v0;
            self.graph.edges[edge].to = v1;
            self.graph.nodes[v0].incident_edge = Some(edge);
            if let Some(pe) = *prev_edge {
                self.graph.edges[edge].prev = Some(pe);
                self.graph.edges[pe].next = Some(edge);
            }
            *prev_edge = Some(edge);
            v0 = v1;
            if p1_idx < discretized.len() - 1 {
                let mut pe = edge;
                self.graph.make_rib(&mut pe, start_source, end_source);
                *prev_edge = Some(pe);
            }
        }
        if let Some(pe) = *prev_edge {
            edge_map.insert(vd_edge, pe);
        }
    }

    /// `constructFromPolygons`.
    fn construct_from_polygons(&mut self, polys: &[Vec<P>]) -> Option<()> {
        let segments = voronoi::segments_of(polys);
        let vd = voronoi::build(&segments)?;
        let mut edge_map: HashMap<usize, usize> = HashMap::new();
        let mut node_map: HashMap<usize, usize> = HashMap::new();
        for cell in 0..vd.cells.len() {
            if vd.cells[cell].incident_edge.is_none() {
                continue;
            }
            let (start_source, end_source, starting, ending);
            if vd.cells[cell].contains_point {
                let r = voronoi::point_cell_range(&vd, cell, &segments, polys);
                start_source = r.source_point;
                end_source = r.source_point;
                starting = r.edge_begin;
                ending = r.edge_end;
                if starting.is_none() || ending.is_none() {
                    continue;
                }
            } else {
                let r = voronoi::segment_cell_range(&vd, cell, &segments);
                start_source = r.start_point;
                end_source = r.end_point;
                starting = r.edge_begin;
                ending = r.edge_end;
            }
            let (Some(starting), Some(ending)) = (starting, ending) else { continue };
            let mut prev_edge: Option<usize> = None;
            let v1 = vd.point(vd.edges[starting].v1?);
            self.transfer_edge(
                &vd,
                &mut edge_map,
                &mut node_map,
                start_source,
                v1,
                starting,
                &mut prev_edge,
                start_source,
                end_source,
                &segments,
            );
            let starting_node = node_map[&vd.edges[starting].v0?];
            self.graph.nodes[starting_node].distance_to_boundary = 0;
            let mut pe = prev_edge?;
            self.graph.make_rib(&mut pe, start_source, end_source);
            prev_edge = Some(pe);
            let mut vd_edge = vd.edges[starting].next;
            while vd_edge != ending {
                let e = &vd.edges[vd_edge];
                let (v1p, v2p) = (vd.point(e.v0?), vd.point(e.v1?));
                self.transfer_edge(
                    &vd,
                    &mut edge_map,
                    &mut node_map,
                    v1p,
                    v2p,
                    vd_edge,
                    &mut prev_edge,
                    start_source,
                    end_source,
                    &segments,
                );
                let mut pe = prev_edge?;
                self.graph.make_rib(&mut pe, start_source, end_source);
                prev_edge = Some(pe);
                vd_edge = vd.edges[vd_edge].next;
            }
            let v0 = vd.point(vd.edges[ending].v0?);
            self.transfer_edge(
                &vd,
                &mut edge_map,
                &mut node_map,
                v0,
                end_source,
                ending,
                &mut prev_edge,
                start_source,
                end_source,
                &segments,
            );
            let last = prev_edge?;
            let to = self.graph.edges[last].to;
            self.graph.nodes[to].distance_to_boundary = 0;
        }
        self.graph.order();
        self.separate_pointy_quad_end_nodes();
        self.graph.collapse_small_edges(5);
        // Make the first possible edge each node's incident edge, so every reachable edge can be reached from it
        // without going backward.
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].prev.is_none() {
                let from = self.graph.edges[e].from;
                self.graph.nodes[from].incident_edge = Some(e);
            }
        }
        Some(())
    }

    /// `separatePointyQuadEndNodes`.
    fn separate_pointy_quad_end_nodes(&mut self) {
        let mut visited: HashSet<usize> = HashSet::new();
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].prev.is_some() {
                continue;
            }
            let from = self.graph.edges[e].from;
            if visited.insert(from) {
                continue;
            }
            let copy = self.graph.nodes[from].clone();
            let new_node = self.graph.add_node(copy.p, false);
            let mut n = copy;
            n.incident_edge = Some(e);
            self.graph.nodes[new_node] = n;
            self.graph.edges[e].from = new_node;
            let twin = self.graph.edges[e].twin.unwrap();
            self.graph.edges[twin].to = new_node;
        }
    }

    // ---- Transitioning ----

    /// `generateToolpaths`: marks the central edges, their bead counts and transitions, then makes the lines.
    pub fn generate_toolpaths(&mut self, filter_outermost_central_edges: bool) -> Vec<Vec<Line>> {
        self.toolpaths = Vec::new();
        self.update_is_central();
        // `filterCentral(central_filter_dist())` looks for `isLocalMaximum() && !isLocalMaximum()`: it never acts.
        if filter_outermost_central_edges {
            self.filter_outer_central();
        }
        self.update_bead_count();
        self.filter_noncentral_regions();
        self.generate_transitioning_ribs();
        self.generate_extra_ribs();
        self.generate_segments();
        std::mem::take(&mut self.toolpaths)
    }

    /// `updateIsCentral`.
    fn update_is_central(&mut self) {
        let outer_edge_filter_length = self.strategy.get_transition_thickness(0) / 2;
        let cap = libm::sin(self.strategy.get_transitioning_angle() * 0.5) as f32;
        for e in self.graph.edge_ids() {
            let twin = self.graph.edges[e].twin.expect("edge has a twin");
            let g = &self.graph;
            let (from, to) = (g.edges[e].from, g.edges[e].to);
            let central = if let Some(tc) = g.edges[twin].central {
                tc
            } else if g.edges[e].kind == EdgeType::ExtraVd
                || g.nodes[from].distance_to_boundary.max(g.nodes[to].distance_to_boundary) < outer_edge_filter_length
            {
                false
            } else {
                let ab = g.nodes[to].p - g.nodes[from].p;
                let d_r = (g.nodes[to].distance_to_boundary - g.nodes[from].distance_to_boundary).abs();
                let d_d = ab.norm();
                (d_r as f32) < (d_d as f32) * cap
            };
            self.graph.edges[e].central = Some(central);
        }
    }

    /// `filterOuterCentral`.
    fn filter_outer_central(&mut self) {
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].prev.is_none() {
                self.graph.edges[e].central = Some(false);
                let twin = self.graph.edges[e].twin.unwrap();
                self.graph.edges[twin].central = Some(false);
            }
        }
    }

    /// `updateBeadCount`.
    fn update_bead_count(&mut self) {
        for e in self.graph.edge_ids() {
            if self.graph.central(e) {
                let to = self.graph.edges[e].to;
                self.graph.nodes[to].bead_count =
                    self.strategy.get_optimal_bead_count(self.graph.nodes[to].distance_to_boundary * 2);
            }
        }
        for n in self.graph.node_ids() {
            if self.graph.is_local_maximum(n, false) {
                if self.graph.nodes[n].distance_to_boundary < 0 {
                    let mut dist = i64::MAX;
                    let start = self.graph.nodes[n].incident_edge.unwrap();
                    let mut edge = start;
                    loop {
                        let to = self.graph.edges[edge].to;
                        dist = dist.min(self.graph.nodes[to].distance_to_boundary + self.graph.edge_len(edge));
                        edge = self.graph.around(edge).unwrap();
                        if edge == start {
                            break;
                        }
                    }
                    self.graph.nodes[n].distance_to_boundary = dist;
                }
                let bead_count = self.strategy.get_optimal_bead_count(self.graph.nodes[n].distance_to_boundary * 2);
                self.graph.nodes[n].bead_count = bead_count;
            }
        }
    }

    /// `isEndOfCentral`.
    fn is_end_of_central(&self, edge_to: usize) -> bool {
        if !self.graph.central(edge_to) {
            return false;
        }
        if self.graph.edges[edge_to].next.is_none() {
            return true;
        }
        let twin = self.graph.edges[edge_to].twin;
        let mut edge = self.graph.edges[edge_to].next;
        while let Some(e) = edge {
            if Some(e) == twin {
                break;
            }
            if self.graph.central(e) {
                return false;
            }
            edge = self.graph.around(e);
        }
        true
    }

    /// `filterNoncentralRegions`.
    fn filter_noncentral_regions(&mut self) {
        for e in self.graph.edge_ids() {
            if !self.is_end_of_central(e) {
                continue;
            }
            let to = self.graph.edges[e].to;
            let bead_count = self.graph.nodes[to].bead_count;
            self.filter_noncentral_regions_from(e, bead_count, 0, scaled(0.4));
        }
    }

    fn filter_noncentral_regions_from(
        &mut self,
        to_edge: usize,
        bead_count: i64,
        traveled_dist: i64,
        max_dist: i64,
    ) -> bool {
        let to_node = self.graph.edges[to_edge].to;
        let r = self.graph.nodes[to_node].distance_to_boundary;
        let twin = self.graph.edges[to_edge].twin;
        let mut next_edge = self.graph.edges[to_edge].next;
        while let Some(ne) = next_edge {
            if Some(ne) == twin {
                break;
            }
            let (nf, nt) = (self.graph.edges[ne].from, self.graph.edges[ne].to);
            if self.graph.nodes[nt].distance_to_boundary >= r
                || shorter_then(self.graph.nodes[nt].p - self.graph.nodes[nf].p, scaled(0.01))
            {
                break;
            }
            next_edge = self.graph.around(ne);
        }
        let Some(next_edge) = next_edge else { return false };
        if Some(next_edge) == twin {
            return false;
        }
        let length = self.graph.edge_len(next_edge);
        let nt = self.graph.edges[next_edge].to;
        let nbc = self.graph.nodes[nt].bead_count;
        let dissolve = if nbc == bead_count {
            true
        } else if nbc < 0 {
            self.filter_noncentral_regions_from(next_edge, bead_count, traveled_dist + length, max_dist)
        } else {
            traveled_dist + length < max_dist && (nbc - bead_count).abs() == 1
        };
        if dissolve {
            self.graph.edges[next_edge].central = Some(true);
            let t = self.graph.edges[next_edge].twin.unwrap();
            self.graph.edges[t].central = Some(true);
            self.graph.nodes[nt].bead_count =
                self.strategy.get_optimal_bead_count(self.graph.nodes[nt].distance_to_boundary * 2);
            self.graph.nodes[nt].transition_ratio = 0.0;
        }
        dissolve
    }

    /// `generateTransitioningRibs`.
    fn generate_transitioning_ribs(&mut self) {
        self.generate_transition_mids();
        self.filter_transition_mids();
        self.generate_all_transition_ends();
        self.apply_transitions();
        // The transitions' storage goes out of scope in Orca, and with it what the edges point to.
        for e in 0..self.graph.edges.len() {
            self.graph.edges[e].transitions.clear();
            self.graph.edges[e].transition_ends.clear();
        }
    }

    /// `generateTransitionMids`.
    fn generate_transition_mids(&mut self) {
        for e in self.graph.edge_ids() {
            if !self.graph.central(e) {
                continue;
            }
            let (from, to) = (self.graph.edges[e].from, self.graph.edges[e].to);
            let start_r = self.graph.nodes[from].distance_to_boundary;
            let end_r = self.graph.nodes[to].distance_to_boundary;
            let start_bead_count = self.graph.nodes[from].bead_count;
            let end_bead_count = self.graph.nodes[to].bead_count;
            if start_r >= end_r {
                continue;
            }
            if start_bead_count == end_bead_count {
                continue;
            }
            let edge_size = self.graph.edge_len(e);
            let mut lower = start_bead_count;
            while lower < end_bead_count {
                let mut mid_r = self.strategy.get_transition_thickness(lower) / 2;
                if mid_r > end_r {
                    mid_r = end_r;
                }
                if mid_r < start_r {
                    mid_r = start_r;
                }
                let mid_pos = edge_size * (mid_r - start_r) / (end_r - start_r);
                let id = self.next_transition_id;
                self.next_transition_id += 1;
                self.graph.edges[e].transitions.push(TransitionMiddle {
                    id,
                    pos: mid_pos,
                    lower_bead_count: lower,
                    feature_radius: mid_r,
                });
                lower += 1;
            }
        }
    }

    /// `filterTransitionMids`.
    fn filter_transition_mids(&mut self) {
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].transitions.is_empty() {
                continue;
            }
            let ab_size = self.graph.edge_len(e);
            let back = *self.graph.edges[e].transitions.last().unwrap();
            let refs = self.dissolve_nearby_transitions(e, back, ab_size - back.pos, self.transition_filter_dist, true);
            let mut should_dissolve_back = !refs.is_empty();
            for (re, id) in refs {
                let Some(back) = self.graph.edges[e].transitions.last().copied() else { break };
                self.dissolve_bead_count_region(e, back.lower_bead_count + 1, back.lower_bead_count);
                self.graph.edges[re].transitions.retain(|t| t.id != id);
            }
            if let Some(back) = self.graph.edges[e].transitions.last().copied() {
                let trans_bead_count = back.lower_bead_count;
                let upper_half = ((1.0 - self.strategy.get_transition_anchor_pos(trans_bead_count) as f64)
                    * self.strategy.get_transitioning_length(trans_bead_count) as f64)
                    as i64;
                should_dissolve_back |=
                    self.filter_end_of_central_transition(e, ab_size - back.pos, upper_half, trans_bead_count);
            }
            if should_dissolve_back {
                self.graph.edges[e].transitions.pop();
            }
            if self.graph.edges[e].transitions.is_empty() {
                continue;
            }
            let twin = self.graph.edges[e].twin.unwrap();
            let front = self.graph.edges[e].transitions[0];
            let refs = self.dissolve_nearby_transitions(twin, front, front.pos, self.transition_filter_dist, false);
            let mut should_dissolve_front = !refs.is_empty();
            for (re, id) in refs {
                let Some(front) = self.graph.edges[e].transitions.first().copied() else { break };
                self.dissolve_bead_count_region(twin, front.lower_bead_count, front.lower_bead_count + 1);
                self.graph.edges[re].transitions.retain(|t| t.id != id);
            }
            if let Some(front) = self.graph.edges[e].transitions.first().copied() {
                let trans_bead_count = front.lower_bead_count;
                let lower_half = (self.strategy.get_transition_anchor_pos(trans_bead_count)
                    * self.strategy.get_transitioning_length(trans_bead_count) as f32)
                    as i64;
                should_dissolve_front |=
                    self.filter_end_of_central_transition(twin, front.pos, lower_half, trans_bead_count + 1);
            }
            if should_dissolve_front && !self.graph.edges[e].transitions.is_empty() {
                self.graph.edges[e].transitions.remove(0);
            }
        }
    }

    /// `dissolveNearbyTransitions`: the transitions (edge, id) within `max_dist` of `origin` that dissolve with it.
    fn dissolve_nearby_transitions(
        &self,
        edge_to_start: usize,
        origin: TransitionMiddle,
        traveled_dist: i64,
        max_dist: i64,
        going_up: bool,
    ) -> Vec<(usize, u32)> {
        let mut to_be_dissolved: Vec<(usize, u32)> = Vec::new();
        if traveled_dist > max_dist {
            return to_be_dissolved;
        }
        let mut should_dissolve = true;
        let twin = self.graph.edges[edge_to_start].twin;
        let mut edge = self.graph.edges[edge_to_start].next;
        while let Some(e) = edge {
            if Some(e) == twin {
                break;
            }
            let next = self.graph.around(e);
            if !self.graph.central(e) {
                edge = next;
                continue;
            }
            let ab_size = self.graph.edge_len(e);
            let is_aligned = self.graph.is_upward(e);
            let aligned_edge = if is_aligned { e } else { self.graph.edges[e].twin.unwrap() };
            let mut seen_transition_on_this_edge = false;
            let origin_radius = origin.feature_radius;
            let radius_here = self.graph.nodes[self.graph.edges[e].from].distance_to_boundary;
            let dissolve_result_is_odd = (origin.lower_bead_count % 2 != 0) == going_up;
            let width_deviation = (origin_radius - radius_here).abs() * 2;
            let line_width_deviation = if dissolve_result_is_odd { width_deviation } else { width_deviation / 2 };
            if line_width_deviation > self.allowed_filter_deviation {
                should_dissolve = false;
            }
            if should_dissolve {
                for t in &self.graph.edges[aligned_edge].transitions {
                    let pos = if is_aligned { t.pos } else { ab_size - t.pos };
                    if traveled_dist + pos < max_dist && t.lower_bead_count == origin.lower_bead_count {
                        to_be_dissolved.push((aligned_edge, t.id));
                        seen_transition_on_this_edge = true;
                    }
                }
            }
            if should_dissolve && !seen_transition_on_this_edge {
                let here = self.dissolve_nearby_transitions(e, origin, traveled_dist + ab_size, max_dist, going_up);
                if here.is_empty() {
                    return Vec::new();
                }
                to_be_dissolved.extend(here);
                should_dissolve = should_dissolve && !to_be_dissolved.is_empty();
            }
            edge = next;
        }
        if !should_dissolve {
            to_be_dissolved.clear();
        }
        to_be_dissolved
    }

    /// `dissolveBeadCountRegion`.
    fn dissolve_bead_count_region(&mut self, edge_to_start: usize, from_bead_count: i64, to_bead_count: i64) {
        let to = self.graph.edges[edge_to_start].to;
        if self.graph.nodes[to].bead_count != from_bead_count {
            return;
        }
        self.graph.nodes[to].bead_count = to_bead_count;
        let twin = self.graph.edges[edge_to_start].twin;
        let mut edge = self.graph.edges[edge_to_start].next;
        while let Some(e) = edge {
            if Some(e) == twin {
                break;
            }
            let next = self.graph.around(e);
            if self.graph.central(e) {
                self.dissolve_bead_count_region(e, from_bead_count, to_bead_count);
            }
            edge = next;
        }
    }

    /// `filterEndOfCentralTransition`.
    fn filter_end_of_central_transition(
        &mut self,
        edge_to_start: usize,
        traveled_dist: i64,
        max_dist: i64,
        replacing_bead_count: i64,
    ) -> bool {
        if traveled_dist > max_dist {
            return false;
        }
        let mut is_end_of_central = true;
        let mut should_dissolve = false;
        let twin = self.graph.edges[edge_to_start].twin;
        let mut next_edge = self.graph.edges[edge_to_start].next;
        while let Some(ne) = next_edge {
            if Some(ne) == twin {
                break;
            }
            let next = self.graph.around(ne);
            if self.graph.central(ne) {
                let length = self.graph.edge_len(ne);
                should_dissolve |=
                    self.filter_end_of_central_transition(ne, traveled_dist + length, max_dist, replacing_bead_count);
                is_end_of_central = false;
            }
            next_edge = next;
        }
        if is_end_of_central && traveled_dist < max_dist {
            should_dissolve = true;
        }
        if should_dissolve {
            let to = self.graph.edges[edge_to_start].to;
            self.graph.nodes[to].bead_count = replacing_bead_count;
        }
        should_dissolve
    }

    /// `generateAllTransitionEnds`.
    fn generate_all_transition_ends(&mut self) {
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].transitions.is_empty() {
                continue;
            }
            let list: Vec<TransitionMiddle> = self.graph.edges[e].transitions.clone();
            for m in list {
                self.generate_transition_ends(e, m.pos, m.lower_bead_count);
            }
        }
    }

    /// `generateTransitionEnds`.
    fn generate_transition_ends(&mut self, edge: usize, mid_pos: i64, lower_bead_count: i64) {
        let ab_size = self.graph.edge_len(edge);
        let transition_length = self.strategy.get_transitioning_length(lower_bead_count);
        let transition_mid_position: f32 = self.strategy.get_transition_anchor_pos(lower_bead_count);
        let inner_ratio: f32 = 1.0;
        let start_rest: f64 = 0.0;
        let mid_rest: f32 = transition_mid_position * inner_ratio;
        let end_rest: f32 = inner_ratio;
        {
            // The lower bead count's end.
            let start_pos = ab_size - mid_pos;
            let half = (transition_mid_position * transition_length as f32) as i64;
            let end_pos = start_pos + half;
            let twin = self.graph.edges[edge].twin.unwrap();
            self.generate_transition_end(twin, start_pos, end_pos, half, mid_rest as f64, start_rest, lower_bead_count);
        }
        {
            // The upper bead count's end.
            let start_pos = mid_pos;
            let half = ((1.0 - transition_mid_position as f64) * transition_length as f64) as i64;
            let end_pos = mid_pos + half;
            self.generate_transition_end(
                edge,
                start_pos,
                end_pos,
                half,
                mid_rest as f64,
                end_rest as f64,
                lower_bead_count,
            );
        }
    }

    /// `generateTransitionEnd`.
    #[allow(clippy::too_many_arguments)]
    fn generate_transition_end(
        &mut self,
        edge: usize,
        start_pos: i64,
        end_pos: i64,
        transition_half_length: i64,
        start_rest: f64,
        end_rest: f64,
        lower_bead_count: i64,
    ) -> bool {
        let ab_size = self.graph.edge_len(edge);
        let going_up = end_rest > start_rest;
        if !self.graph.central(edge) {
            return false;
        }
        if end_pos > ab_size {
            // Recurse on all further edges.
            let rest: f32 =
                (end_rest - (start_rest - end_rest) * (end_pos - ab_size) as f64 / (start_pos - end_pos) as f64) as f32;
            let twin = self.graph.edges[edge].twin;
            let mut central_edge_count = 0;
            let mut outgoing = self.graph.edges[edge].next;
            while let Some(o) = outgoing {
                if Some(o) == twin {
                    break;
                }
                if self.graph.central(o) {
                    central_edge_count += 1;
                }
                outgoing = self.graph.around(o);
            }
            let mut is_only_going_down = true;
            let mut has_recursed = false;
            let mut outgoing = self.graph.edges[edge].next;
            while let Some(o) = outgoing {
                if Some(o) == twin {
                    break;
                }
                let next = self.graph.around(o);
                if !self.graph.central(o) {
                    outgoing = next;
                    continue;
                }
                if central_edge_count > 1
                    && going_up
                    && self.is_going_down(o, 0, end_pos - ab_size + transition_half_length, lower_bead_count)
                {
                    outgoing = next;
                    continue;
                }
                let is_going_down = self.generate_transition_end(
                    o,
                    0,
                    end_pos - ab_size,
                    transition_half_length,
                    rest as f64,
                    end_rest,
                    lower_bead_count,
                );
                is_only_going_down &= is_going_down;
                outgoing = next;
                has_recursed = true;
            }
            if !going_up || (has_recursed && !is_only_going_down) {
                let to = self.graph.edges[edge].to;
                self.graph.nodes[to].transition_ratio = rest;
                self.graph.nodes[to].bead_count = lower_bead_count;
            }
            is_only_going_down
        } else {
            // Add the transition's end here.
            let is_lower_end = end_rest == 0.0;
            let (upward_edge, pos) = if self.graph.is_upward(edge) {
                (edge, end_pos)
            } else {
                (self.graph.edges[edge].twin.unwrap(), ab_size - end_pos)
            };
            let ends = &mut self.graph.edges[upward_edge].transition_ends;
            let te = TransitionEnd { pos, lower_bead_count, is_lower_end };
            if ends.is_empty() || pos < ends[0].pos {
                ends.insert(0, te);
            } else {
                ends.push(te);
            }
            false
        }
    }

    /// `isGoingDown`.
    fn is_going_down(&self, outgoing: usize, traveled_dist: i64, max_dist: i64, lower_bead_count: i64) -> bool {
        let (from, to) = (self.graph.edges[outgoing].from, self.graph.edges[outgoing].to);
        if self.graph.nodes[to].distance_to_boundary == 0 {
            return true;
        }
        let is_upward = self.graph.nodes[to].distance_to_boundary >= self.graph.nodes[from].distance_to_boundary;
        let upward_edge = if is_upward { outgoing } else { self.graph.edges[outgoing].twin.unwrap() };
        if self.graph.nodes[to].bead_count > lower_bead_count + 1 {
            return false;
        }
        let length = self.graph.edge_len(outgoing);
        let mids = &self.graph.edges[upward_edge].transitions;
        if !mids.is_empty() {
            let mid = if is_upward { mids[0] } else { *mids.last().unwrap() };
            if mid.lower_bead_count == lower_bead_count
                && ((is_upward && mid.pos + traveled_dist < max_dist)
                    || (!is_upward && length - mid.pos + traveled_dist < max_dist))
            {
                return true;
            }
        }
        if traveled_dist + length > max_dist {
            return false;
        }
        let node = &self.graph.nodes[to];
        if node.bead_count <= lower_bead_count && !(node.bead_count == lower_bead_count && node.transition_ratio > 0.0)
        {
            return true;
        }
        let mut is_only_going_down = true;
        let mut has_recursed = false;
        let twin = self.graph.edges[outgoing].twin;
        let mut next = self.graph.edges[outgoing].next;
        while let Some(n) = next {
            if Some(n) == twin {
                break;
            }
            if self.graph.central(n) {
                let going_down = self.is_going_down(n, traveled_dist + length, max_dist, lower_bead_count);
                is_only_going_down &= going_down;
                has_recursed = true;
            }
            next = self.graph.around(n);
        }
        has_recursed && is_only_going_down
    }

    /// `applyTransitions`: puts a node at each transition end.
    fn apply_transitions(&mut self) {
        let snap = self.snap_dist();
        let mut pos = 0;
        while pos < self.graph.edge_order_len() {
            let e = self.graph.edge_at(pos);
            pos += 1;
            if !self.graph.edges[e].alive {
                continue;
            }
            let twin = self.graph.edges[e].twin.unwrap();
            if !self.graph.edges[twin].transition_ends.is_empty() {
                let length = self.graph.edge_len(e);
                let moved = std::mem::take(&mut self.graph.edges[twin].transition_ends);
                for end in moved {
                    self.graph.edges[e].transition_ends.push(TransitionEnd { pos: length - end.pos, ..end });
                }
            }
        }
        let mut pos = 0;
        while pos < self.graph.edge_order_len() {
            let e = self.graph.edge_at(pos);
            pos += 1;
            if !self.graph.edges[e].alive || self.graph.edges[e].transition_ends.is_empty() {
                continue;
            }
            let mut ends = self.graph.edges[e].transition_ends.clone();
            ends.sort_by_key(|e| e.pos);
            let (from, to) = (self.graph.edges[e].from, self.graph.edges[e].to);
            let a = self.graph.nodes[from].p;
            let b = self.graph.nodes[to].p;
            let ab = b - a;
            let ab_size = ab.norm();
            let mut last_edge_replacing_input = e;
            for end in ends {
                let new_node_bead_count =
                    if end.is_lower_end { end.lower_bead_count } else { end.lower_bead_count + 1 };
                let end_pos = end.pos;
                let close_node = if end_pos < ab_size / 2 { from } else { to };
                if (end_pos < snap || end_pos > ab_size - snap)
                    && self.graph.nodes[close_node].bead_count == new_node_bead_count
                {
                    self.graph.nodes[close_node].transition_ratio = 0.0;
                    continue;
                }
                let mid = a + normal(ab, end_pos);
                last_edge_replacing_input = self.graph.insert_node(last_edge_replacing_input, mid, new_node_bead_count);
            }
        }
    }

    /// `generateExtraRibs`: nodes where a beading's widths bend.
    fn generate_extra_ribs(&mut self) {
        let snap = self.snap_dist();
        let mut pos = 0;
        while pos < self.graph.edge_order_len() {
            let e = self.graph.edge_at(pos);
            pos += 1;
            if !self.graph.edges[e].alive {
                continue;
            }
            let (from, to) = (self.graph.edges[e].from, self.graph.edges[e].to);
            if !self.graph.central(e)
                || shorter_then(self.graph.nodes[to].p - self.graph.nodes[from].p, self.discretization_step_size)
                || self.graph.nodes[from].distance_to_boundary >= self.graph.nodes[to].distance_to_boundary
            {
                continue;
            }
            let rib_thicknesses = self.strategy.get_nonlinear_thicknesses(self.graph.nodes[from].bead_count);
            if rib_thicknesses.is_empty() {
                continue;
            }
            let a = self.graph.nodes[from].p;
            let b = self.graph.nodes[to].p;
            let ab = b - a;
            let ab_size = ab.norm();
            let a_r = self.graph.nodes[from].distance_to_boundary;
            let b_r = self.graph.nodes[to].distance_to_boundary;
            let mut last_edge_replacing_input = e;
            for rib_thickness in rib_thicknesses {
                if rib_thickness / 2 <= a_r {
                    continue;
                }
                if rib_thickness / 2 >= b_r {
                    break;
                }
                let new_node_bead_count = self.graph.nodes[from].bead_count.min(self.graph.nodes[to].bead_count);
                let end_pos = ab_size * (rib_thickness / 2 - a_r) / (b_r - a_r);
                let close_node = if end_pos < ab_size / 2 { from } else { to };
                if (end_pos < snap || end_pos > ab_size - snap)
                    && self.graph.nodes[close_node].bead_count == new_node_bead_count
                {
                    self.graph.nodes[close_node].transition_ratio = 0.0;
                    continue;
                }
                let mid = a + normal(ab, end_pos);
                last_edge_replacing_input = self.graph.insert_node(last_edge_replacing_input, mid, new_node_bead_count);
            }
        }
    }

    // ---- Beadings ----

    /// `generateSegments`: beadings at every node, propagated over the rest, then junctions and lines.
    fn generate_segments(&mut self) {
        let mut upward_quad_mids: Vec<usize> = Vec::new();
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].prev.is_some() && self.graph.edges[e].next.is_some() && self.graph.is_upward(e) {
                upward_quad_mids.push(e);
            }
        }
        let g = &self.graph;
        let less = |a: usize, b: usize| -> bool {
            let (at, af) = (g.nodes[g.edges[a].to].distance_to_boundary, g.nodes[g.edges[a].from].distance_to_boundary);
            let (bt, bf) = (g.nodes[g.edges[b].to].distance_to_boundary, g.nodes[g.edges[b].from].distance_to_boundary);
            if at == bt {
                if af == at && bf == bt {
                    let max = i64::MAX;
                    let from_up = |e: usize| {
                        let t = g.edges[e].twin.unwrap();
                        g.dist_to_go_up(e).unwrap_or(max).min(g.dist_to_go_up(t).unwrap_or(max)) - g.edge_len(e)
                    };
                    return from_up(a) < from_up(b);
                } else if af == at {
                    return true;
                } else if bf == bt {
                    return false;
                }
            }
            at > bt
        };
        merge_sort(&mut upward_quad_mids, &less);

        self.beadings.clear();
        for n in self.graph.node_ids() {
            let node = &self.graph.nodes[n];
            if node.bead_count <= 0 {
                continue;
            }
            let (d, bc, ratio) = (node.distance_to_boundary, node.bead_count, node.transition_ratio);
            let beading = if ratio == 0.0 {
                self.strategy.compute(d * 2, bc)
            } else {
                let low = self.strategy.compute(d * 2, bc);
                let high = self.strategy.compute(d * 2, bc + 1);
                interpolate(&low, 1.0 - ratio as f64, &high)
            };
            self.beadings.push(Propagation::new(beading));
            self.graph.nodes[n].beading = Some(self.beadings.len() - 1);
        }
        self.propagate_beadings_upward(&upward_quad_mids);
        self.propagate_beadings_downward_all(&upward_quad_mids);
        self.generate_junctions();
        self.connect_junctions();
        self.generate_local_maxima_single_beads();
    }

    /// `propagateBeadingsUpward`.
    fn propagate_beadings_upward(&mut self, upward_quad_mids: &[usize]) {
        for &ue in upward_quad_mids.iter().rev() {
            let (from, to) = (self.graph.edges[ue].from, self.graph.edges[ue].to);
            if self.graph.nodes[to].bead_count >= 0 {
                continue;
            }
            let Some(lower) = self.graph.nodes[from].beading else { continue };
            if self.graph.nodes[to].beading.is_some() {
                continue;
            }
            let length = self.graph.edge_len(ue);
            let mut upper = self.beadings[lower].clone();
            upper.dist_to_bottom_source += length;
            upper.is_upward_propagated_only = true;
            self.beadings.push(upper);
            self.graph.nodes[to].beading = Some(self.beadings.len() - 1);
        }
    }

    /// `propagateBeadingsDownward`: over the quads' upward edges.
    fn propagate_beadings_downward_all(&mut self, upward_quad_mids: &[usize]) {
        for &um in upward_quad_mids {
            if !self.graph.central(um) {
                let (from, to) = (self.graph.edges[um].from, self.graph.edges[um].to);
                if self.graph.nodes[from].distance_to_boundary == self.graph.nodes[to].distance_to_boundary
                    && self.graph.nodes[from].beading.is_some()
                    && self.graph.nodes[to].beading.is_none()
                {
                    let t = self.graph.edges[um].twin.unwrap();
                    self.propagate_beadings_downward(t);
                } else {
                    self.propagate_beadings_downward(um);
                }
            }
        }
    }

    fn propagate_beadings_downward(&mut self, edge_to_peak: usize) {
        let length = self.graph.edge_len(edge_to_peak);
        let (from, to) = (self.graph.edges[edge_to_peak].from, self.graph.edges[edge_to_peak].to);
        let top_idx = self.get_or_create_beading(to);
        let top = self.beadings[top_idx].clone();
        match self.graph.nodes[from].beading {
            None => {
                let mut propagated = top;
                propagated.dist_from_top_source += length;
                self.beadings.push(propagated);
                self.graph.nodes[from].beading = Some(self.beadings.len() - 1);
            }
            Some(bottom_idx) => {
                let bottom = self.beadings[bottom_idx].clone();
                let total_dist = top.dist_from_top_source + length + bottom.dist_to_bottom_source;
                let mut ratio_of_top = (bottom.dist_to_bottom_source as f32
                    / total_dist.min(self.beading_propagation_transition_dist) as f32)
                    as f64;
                ratio_of_top = ratio_of_top.max(0.0);
                if ratio_of_top >= 1.0 {
                    let mut b = top;
                    b.dist_from_top_source += length;
                    self.beadings[bottom_idx] = b;
                } else {
                    let merged = interpolate_switching(
                        &top.beading,
                        ratio_of_top,
                        &bottom.beading,
                        self.graph.nodes[from].distance_to_boundary,
                    );
                    let mut b = Propagation::new(merged);
                    b.is_upward_propagated_only = false;
                    self.beadings[bottom_idx] = b;
                }
            }
        }
    }

    /// `getOrCreateBeading`.
    fn get_or_create_beading(&mut self, node: usize) -> usize {
        if let Some(b) = self.graph.nodes[node].beading {
            return b;
        }
        if self.graph.nodes[node].bead_count == -1 {
            if let Some(b) = self.get_nearest_beading(node, scaled(0.1)) {
                return b;
            }
            let mut dist = i64::MAX;
            if let Some(start) = self.graph.nodes[node].incident_edge {
                let mut edge = start;
                loop {
                    let to = self.graph.edges[edge].to;
                    dist = dist.min(self.graph.nodes[to].distance_to_boundary + self.graph.edge_len(edge));
                    match self.graph.around(edge) {
                        Some(n) if n != start => edge = n,
                        _ => break,
                    }
                }
            }
            self.graph.nodes[node].bead_count = self.strategy.get_optimal_bead_count(dist.saturating_mul(2));
        }
        let b =
            self.strategy.compute(self.graph.nodes[node].distance_to_boundary * 2, self.graph.nodes[node].bead_count);
        self.beadings.push(Propagation::new(b));
        let idx = self.beadings.len() - 1;
        self.graph.nodes[node].beading = Some(idx);
        idx
    }

    /// `getNearestBeading`: the beading of the nearest node within `max_dist` that has one.
    fn get_nearest_beading(&self, node: usize, max_dist: i64) -> Option<usize> {
        #[derive(PartialEq, Eq)]
        struct DistEdge {
            dist: i64,
            seq: u64,
            edge: usize,
        }
        impl Ord for DistEdge {
            fn cmp(&self, o: &Self) -> std::cmp::Ordering {
                // The smallest distance first (Orca's priority queue compares `l.dist > r.dist`).
                o.dist.cmp(&self.dist).then(o.seq.cmp(&self.seq))
            }
        }
        impl PartialOrd for DistEdge {
            fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
                Some(self.cmp(o))
            }
        }
        let mut further: BinaryHeap<DistEdge> = BinaryHeap::new();
        let mut seq = 0u64;
        let start = self.graph.nodes[node].incident_edge?;
        let mut outgoing = start;
        loop {
            further.push(DistEdge { dist: self.graph.edge_len(outgoing), seq, edge: outgoing });
            seq += 1;
            match self.graph.around(outgoing) {
                Some(n) if n != start => outgoing = n,
                _ => break,
            }
        }
        for _ in 0..BEAD_SEARCH_MAX {
            let here = further.pop()?;
            if here.dist > max_dist {
                return None;
            }
            let to = self.graph.edges[here.edge].to;
            if let Some(b) = self.graph.nodes[to].beading {
                return Some(b);
            }
            let twin = self.graph.edges[here.edge].twin;
            let mut f = self.graph.edges[here.edge].next;
            while let Some(fe) = f {
                if Some(fe) == twin {
                    break;
                }
                further.push(DistEdge { dist: here.dist + self.graph.edge_len(fe), seq, edge: fe });
                seq += 1;
                f = self.graph.around(fe);
            }
        }
        None
    }

    /// `generateJunctions`: where each bead crosses each upward edge, from high radius to low.
    fn generate_junctions(&mut self) {
        for e in self.graph.edge_ids() {
            let (from, to) = (self.graph.edges[e].from, self.graph.edges[e].to);
            if self.graph.nodes[from].distance_to_boundary > self.graph.nodes[to].distance_to_boundary {
                continue;
            }
            let start_r = self.graph.nodes[to].distance_to_boundary;
            let end_r = self.graph.nodes[from].distance_to_boundary;
            if (self.graph.nodes[from].bead_count == self.graph.nodes[to].bead_count
                && self.graph.nodes[from].bead_count >= 0)
                || end_r >= start_r
            {
                continue;
            }
            let bidx = self.get_or_create_beading(to);
            let beading = self.beadings[bidx].beading.clone();
            let a = self.graph.nodes[to].p;
            let b = self.graph.nodes[from].p;
            let ab = b - a;
            let num = beading.toolpath_locations.len() as i64;
            let mut idx: i64 = (num.max(1) - 1) / 2;
            while idx >= 0 && idx < num {
                if beading.toolpath_locations[idx as usize] <= start_r + 1 {
                    break;
                }
                idx -= 1;
            }
            // `junction_idx` is a `size_t`: it underflows to a huge value, which ends the loops.
            if idx >= 0
                && idx + 1 < num
                && beading.toolpath_locations[(idx + 1) as usize] <= start_r + scaled(0.005)
                && beading.total_thickness < start_r + scaled(0.005)
            {
                idx += 1;
            }
            let mut ret: Vec<Junction> = Vec::new();
            while idx >= 0 && idx < num {
                let bead_r = beading.toolpath_locations[idx as usize];
                if bead_r < end_r {
                    break;
                }
                let mut junction =
                    a + p(ab.x * (bead_r - start_r) / (end_r - start_r), ab.y * (bead_r - start_r) / (end_r - start_r));
                if bead_r > start_r - scaled(0.005) {
                    junction = a;
                }
                ret.push(Junction { p: junction, w: beading.bead_widths[idx as usize], perimeter_index: idx as usize });
                idx -= 1;
            }
            self.graph.edges[e].junctions = ret;
        }
    }

    /// `getQuadMaxRedgeTo`.
    fn quad_max_r_edge_to(&self, quad_start: usize) -> usize {
        let mut max_r = -1;
        let mut ret = quad_start;
        let mut edge = Some(quad_start);
        while let Some(e) = edge {
            let r = self.graph.nodes[self.graph.edges[e].to].distance_to_boundary;
            if r > max_r {
                max_r = r;
                ret = e;
            }
            edge = self.graph.edges[e].next;
        }
        let (from, to) = (self.graph.edges[ret].from, self.graph.edges[ret].to);
        if self.graph.edges[ret].next.is_none()
            && self.graph.nodes[to].distance_to_boundary - scaled(0.005) < self.graph.nodes[from].distance_to_boundary
        {
            ret = self.graph.edges[ret].prev.unwrap();
        }
        ret
    }

    /// `addToolpathSegment`.
    fn add_toolpath_segment(
        &mut self,
        from: Junction,
        to: Junction,
        is_odd: bool,
        force_new_path: bool,
        from_is_3way: bool,
        to_is_3way: bool,
    ) {
        if from == to {
            return;
        }
        let inset_idx = from.perimeter_index;
        if inset_idx >= self.toolpaths.len() {
            self.toolpaths.resize_with(inset_idx + 1, Vec::new);
        }
        let mut force_new_path = force_new_path;
        {
            let lines = &self.toolpaths[inset_idx];
            if lines.is_empty()
                || lines.last().unwrap().is_odd != is_odd
                || lines.last().unwrap().junctions.last().unwrap().perimeter_index != inset_idx
            {
                force_new_path = true;
            }
        }
        let lines = &mut self.toolpaths[inset_idx];
        if !force_new_path {
            let last = *lines.last().unwrap().junctions.last().unwrap();
            if shorter_then(last.p - from.p, scaled(0.010)) && (last.w - from.w).abs() < scaled(0.010) && !from_is_3way
            {
                lines.last_mut().unwrap().junctions.push(to);
                return;
            } else if shorter_then(last.p - to.p, scaled(0.010)) && (last.w - to.w).abs() < scaled(0.010) && !to_is_3way
            {
                lines.last_mut().unwrap().junctions.push(from);
                return;
            }
        }
        lines.push(Line { inset_idx, is_odd, is_closed: false, junctions: vec![from, to] });
    }

    /// `connectJunctions`: the junctions of the two sides of each quad joined, bead by bead.
    fn connect_junctions(&mut self) {
        let mut unprocessed: BTreeSet<usize> = BTreeSet::new();
        for e in self.graph.edge_ids() {
            if self.graph.edges[e].prev.is_none() {
                unprocessed.insert(e);
            }
        }
        let mut passed_odd_edges: HashSet<usize> = HashSet::new();
        while let Some(&poly_domain_start) = unprocessed.iter().next() {
            let mut quad_start = poly_domain_start;
            let mut new_domain_start = true;
            loop {
                let mut quad_end = quad_start;
                while let Some(n) = self.graph.edges[quad_end].next {
                    quad_end = n;
                }
                let edge_to_peak = self.quad_max_r_edge_to(quad_start);
                let Some(edge_from_peak) = self.graph.edges[edge_to_peak].next else { break };
                unprocessed.remove(&quad_start);
                let mut from_junctions = self.graph.edges[edge_to_peak].junctions.clone();
                let fp_twin = self.graph.edges[edge_from_peak].twin.unwrap();
                let mut to_junctions = self.graph.edges[fp_twin].junctions.clone();
                if let Some(prev) = self.graph.edges[edge_to_peak].prev {
                    let from_prev = self.graph.edges[prev].junctions.clone();
                    while !from_junctions.is_empty()
                        && !from_prev.is_empty()
                        && from_junctions.last().unwrap().perimeter_index <= from_prev[0].perimeter_index
                    {
                        from_junctions.pop();
                    }
                    from_junctions.extend(from_prev);
                }
                if let Some(next) = self.graph.edges[edge_from_peak].next {
                    let nt = self.graph.edges[next].twin.unwrap();
                    let to_next = self.graph.edges[nt].junctions.clone();
                    while !to_junctions.is_empty()
                        && !to_next.is_empty()
                        && to_junctions.last().unwrap().perimeter_index <= to_next[0].perimeter_index
                    {
                        to_junctions.pop();
                    }
                    to_junctions.extend(to_next);
                }
                let segment_count = from_junctions.len().min(to_junctions.len());
                let qs_to = self.graph.edges[quad_start].to;
                let qe_from = self.graph.edges[quad_end].from;
                for rev in 0..segment_count {
                    let from = from_junctions[from_junctions.len() - 1 - rev];
                    let to = to_junctions[to_junctions.len() - 1 - rev];
                    let qs = &self.graph.nodes[qs_to];
                    let qe = &self.graph.nodes[qe_from];
                    let from_is_odd = qs.bead_count > 0
                        && qs.bead_count % 2 == 1
                        && qs.transition_ratio == 0.0
                        && rev == segment_count - 1
                        && shorter_then(from.p - qs.p, scaled(0.005));
                    let to_is_odd = qe.bead_count > 0
                        && qe.bead_count % 2 == 1
                        && qe.transition_ratio == 0.0
                        && rev == segment_count - 1
                        && shorter_then(to.p - qe.p, scaled(0.005));
                    let is_odd_segment = from_is_odd && to_is_odd;
                    let qs_next = self.graph.edges[quad_start].next.unwrap();
                    let qs_next_twin = self.graph.edges[qs_next].twin.unwrap();
                    if is_odd_segment && passed_odd_edges.contains(&qs_next_twin) {
                        continue;
                    }
                    let from_is_3way = from_is_odd && self.graph.is_multi_intersection(qs_to);
                    let to_is_3way = to_is_odd && self.graph.is_multi_intersection(qe_from);
                    passed_odd_edges.insert(qs_next);
                    self.add_toolpath_segment(from, to, is_odd_segment, new_domain_start, from_is_3way, to_is_3way);
                }
                new_domain_start = false;
                match self.graph.next_unconnected(quad_start) {
                    Some(n) if n != poly_domain_start => quad_start = n,
                    _ => break,
                }
            }
            unprocessed.remove(&poly_domain_start);
        }
    }

    /// `generateLocalMaximaSingleBeads`: a small loop where a part ends in a single bead at its widest.
    fn generate_local_maxima_single_beads(&mut self) {
        for n in self.graph.node_ids() {
            let Some(b) = self.graph.nodes[n].beading else { continue };
            let beading = &self.beadings[b].beading;
            if beading.bead_widths.len() % 2 == 1
                && self.graph.is_local_maximum(n, true)
                && !self.graph.node_is_central(n)
            {
                let inset_index = beading.bead_widths.len() / 2;
                if inset_index >= self.toolpaths.len() {
                    self.toolpaths.resize_with(inset_index + 1, Vec::new);
                }
                let width = beading.bead_widths[inset_index];
                let r = width / 8;
                let n_segments = 6;
                let np = self.graph.nodes[n].p;
                let mut line = Line { inset_idx: inset_index, is_odd: true, is_closed: false, junctions: Vec::new() };
                for segment in 0..n_segments {
                    let a: f32 = (2.0 * std::f64::consts::PI / n_segments as f64 * segment as f64) as f32;
                    let dx = (r as f32 * libm::cosf(a)) as i64;
                    let dy = (r as f32 * libm::sinf(a)) as i64;
                    line.junctions.push(Junction {
                        p: p(np.x + dx, np.y + dy),
                        w: width,
                        perimeter_index: inset_index,
                    });
                }
                self.toolpaths[inset_index].push(line);
            }
        }
    }
}

/// Orca's `normal(p0, len)`: `p0` scaled to length `len`.
fn normal(p0: P, len: i64) -> P {
    let l = p0.norm();
    if l < 1 {
        return p(len, 0);
    }
    p(p0.x * len / l, p0.y * len / l)
}

/// `interpolate(left, ratio_left_to_whole, right)`.
fn interpolate(left: &Beading, ratio_left_to_whole: f64, right: &Beading) -> Beading {
    let ratio_right_to_whole: f32 = (1.0 - ratio_left_to_whole) as f32;
    let mut ret = if left.total_thickness > right.total_thickness { left.clone() } else { right.clone() };
    for i in 0..left.bead_widths.len().min(right.bead_widths.len()) {
        if left.bead_widths[i] == 0 || right.bead_widths[i] == 0 {
            ret.bead_widths[i] = 0;
        } else {
            ret.bead_widths[i] = (ratio_left_to_whole * left.bead_widths[i] as f64
                + (ratio_right_to_whole * right.bead_widths[i] as f32) as f64) as i64;
        }
        ret.toolpath_locations[i] = (ratio_left_to_whole * left.toolpath_locations[i] as f64
            + (ratio_right_to_whole * right.toolpath_locations[i] as f32) as f64)
            as i64;
    }
    ret
}

/// `interpolate(left, ratio, right, switching_radius)`: as above, drawn back where an inset disappeared.
fn interpolate_switching(left: &Beading, ratio_left_to_whole: f64, right: &Beading, switching_radius: i64) -> Beading {
    let ret = interpolate(left, ratio_left_to_whole, right);
    let mut next_inset_idx: i64 = left.toolpath_locations.len() as i64 - 1;
    while next_inset_idx >= 0 {
        if switching_radius > left.toolpath_locations[next_inset_idx as usize] {
            break;
        }
        next_inset_idx -= 1;
    }
    if next_inset_idx < 0 {
        return ret;
    }
    if next_inset_idx + 1 == left.toolpath_locations.len() as i64 {
        return ret;
    }
    if next_inset_idx >= ret.toolpath_locations.len() as i64 {
        return ret;
    }
    let i = next_inset_idx as usize;
    if ret.toolpath_locations[i] > switching_radius {
        let new_ratio: f32 = (switching_radius - right.toolpath_locations[i]) as f32
            / (left.toolpath_locations[i] - right.toolpath_locations[i]) as f32;
        let new_ratio = 1.0f64.min(new_ratio as f64 + 0.1);
        return interpolate(left, new_ratio, right);
    }
    ret
}

/// A stable merge sort with a "less than" predicate that need not be a strict weak order (Rust's own sorts may
/// panic on one; Orca's `std::sort` doesn't).
fn merge_sort<F: Fn(usize, usize) -> bool>(v: &mut Vec<usize>, less: &F) {
    if v.len() < 2 {
        return;
    }
    let mut right = v.split_off(v.len() / 2);
    merge_sort(v, less);
    merge_sort(&mut right, less);
    let left = std::mem::take(v);
    let (mut i, mut j) = (0, 0);
    while i < left.len() && j < right.len() {
        if less(right[j], left[i]) {
            v.push(right[j]);
            j += 1;
        } else {
            v.push(left[i]);
            i += 1;
        }
    }
    v.extend_from_slice(&left[i..]);
    v.extend_from_slice(&right[j..]);
}

#[cfg(test)]
mod tests {
    use super::super::beading::{Params, make_strategy, scaled as bscaled};
    use super::*;

    fn poly(mm: &[(f64, f64)]) -> Vec<P> {
        mm.iter().map(|&(x, y)| p((x * 1e6) as i64, (y * 1e6) as i64)).collect()
    }

    fn params(max: i64) -> Params {
        let (w0, wx, nozzle) = (0.42, 0.45, 0.4);
        let min_bead = 0.85 * nozzle;
        Params {
            preferred_bead_width_outer: bscaled(w0),
            preferred_bead_width_inner: bscaled(wx),
            preferred_transition_length: bscaled(nozzle),
            transitioning_angle: (10.0f64 * std::f64::consts::PI / 180.0) as f32,
            print_thin_walls: true,
            min_bead_width: bscaled(min_bead),
            min_feature_size: bscaled(0.25 * nozzle),
            wall_split_middle_threshold: (2.0 * min_bead / w0 - 1.0f64).clamp(0.01, 0.99),
            wall_add_middle_threshold: (min_bead / wx).clamp(0.01, 0.99),
            max_bead_count: max,
            outer_wall_offset: 0,
            inward_distributed_center_wall_count: 2,
            minimum_variable_line_ratio: 0.5,
        }
    }

    fn lines_of(shape: &[Vec<P>], max: i64) -> Vec<Vec<Line>> {
        let strategy = make_strategy(&params(max));
        let mut t = Trapezoidation::new(
            shape,
            strategy.as_ref(),
            10.0f64.to_radians(),
            scaled(0.8),
            scaled(1.0),
            scaled(0.1),
            scaled(0.4),
        )
        .expect("diagram");
        t.generate_toolpaths(false)
    }

    /// The area of a shape (mm²): contours counter-clockwise, holes clockwise.
    fn area(shape: &[Vec<P>]) -> f64 {
        shape
            .iter()
            .map(|c| {
                let n = c.len();
                (0..n)
                    .map(|i| (c[i].x as f64) * (c[(i + 1) % n].y as f64) - (c[(i + 1) % n].x as f64) * (c[i].y as f64))
                    .sum::<f64>()
                    / 2.0
                    / 1e12
            })
            .sum()
    }

    /// The area the lines' beads cover (mm²), each segment by its length and mean width.
    fn plastic(lines: &[Vec<Line>]) -> f64 {
        lines
            .iter()
            .flatten()
            .map(|l| {
                l.junctions
                    .windows(2)
                    .map(|j| ((j[1].p - j[0].p).norm() as f64) * (j[0].w + j[1].w) as f64 / 2.0 / 1e12)
                    .sum::<f64>()
            })
            .sum()
    }

    fn circle(cx: f64, cy: f64, r: f64, n: usize, ccw: bool) -> Vec<P> {
        let mut pts: Vec<P> = (0..n)
            .map(|i| {
                let a = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
                p(((cx + r * a.cos()) * 1e6).round() as i64, ((cy + r * a.sin()) * 1e6).round() as i64)
            })
            .collect();
        if !ccw {
            pts.reverse();
        }
        pts
    }

    /// Shapes with narrow parts, thick parts, holes and sharp corners: every one gets lines inside it that cover
    /// about as much as it does, the same on every run.
    #[test]
    fn shapes_get_beads_that_cover_them() {
        let shapes: Vec<(&str, Vec<Vec<P>>)> = vec![
            ("bar 10x1.2", vec![poly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 1.2), (0.0, 1.2)])]),
            ("bar 10x0.3", vec![poly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 0.3), (0.0, 0.3)])]),
            ("bar 10x5", vec![poly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (0.0, 5.0)])]),
            ("wedge", vec![poly(&[(0.0, 0.0), (20.0, 0.0), (20.0, 3.0)])]),
            ("sliver", vec![poly(&[(0.0, 0.0), (20.0, 0.0), (20.0, 0.6)])]),
            ("L", vec![poly(&[(0.0, 0.0), (10.0, 0.0), (10.0, 1.0), (1.0, 1.0), (1.0, 10.0), (0.0, 10.0)])]),
            (
                "T",
                vec![poly(&[
                    (0.0, 0.0),
                    (1.0, 0.0),
                    (1.0, 6.0),
                    (4.0, 6.0),
                    (4.0, 7.2),
                    (-3.0, 7.2),
                    (-3.0, 6.0),
                    (0.0, 6.0),
                ])],
            ),
            ("ring", vec![circle(0.0, 0.0, 10.0, 96, true), circle(0.0, 0.0, 8.8, 96, false)]),
            ("thin ring", vec![circle(0.0, 0.0, 10.0, 96, true), circle(0.0, 0.0, 9.4, 96, false)]),
            ("disc", vec![circle(0.0, 0.0, 6.0, 96, true)]),
            ("tiny disc", vec![circle(0.0, 0.0, 0.5, 24, true)]),
        ];
        for (name, shape) in shapes {
            let lines = lines_of(&shape, 20);
            let again = lines_of(&shape, 20);
            type Key = Vec<Vec<(usize, bool, Vec<(i64, i64, i64)>)>>;
            let key = |l: &[Vec<Line>]| -> Key {
                l.iter()
                    .map(|v| {
                        v.iter()
                            .map(|l| (l.inset_idx, l.is_odd, l.junctions.iter().map(|j| (j.p.x, j.p.y, j.w)).collect()))
                            .collect()
                    })
                    .collect()
            };
            assert_eq!(key(&lines), key(&again), "{name}: not deterministic");
            let a = area(&shape);
            let pl = plastic(&lines);
            eprintln!("{name}: {} lines, {pl:.3} of {a:.3} mm²", lines.iter().map(|l| l.len()).sum::<usize>());
            assert!(pl > 0.0, "{name}: no lines");
            assert!(pl > 0.6 * a && pl < 1.4 * a, "{name}: lines cover {pl} of {a} mm²");
            for l in lines.iter().flatten() {
                // Only the limited strategy's marker beads, one past the last bead, have no width.
                for j in &l.junctions {
                    assert!(j.w > 0 || l.inset_idx == 10, "{name}: a bead without width, inset {}", l.inset_idx);
                }
            }
        }
    }

    #[test]
    fn a_bar_gets_beads() {
        for (w, h) in [(10.0, 1.2), (10.0, 0.8), (10.0, 0.4), (10.0, 2.0), (10.0, 5.0)] {
            let shape = vec![poly(&[(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)])];
            let lines = lines_of(&shape, 2 * 10);
            let n: usize = lines.iter().map(|l| l.len()).sum();
            assert!(n > 0);
            assert!(plastic(&lines) > 0.9 * w * h, "{}", plastic(&lines));
        }
    }
}
