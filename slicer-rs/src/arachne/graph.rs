//! The skeletal trapezoidation's half-edge graph (Orca 2.5.1's `SkeletalTrapezoidationGraph`, `STHalfEdge`,
//! `STHalfEdgeNode`, `HalfEdgeGraph`), with nodes and edges in arenas and indices for pointers. Points are in
//! nanometres as Orca scales them (a millimetre is 1,000,000), as integers, so the arithmetic is Orca's.
//!
//! Orca keeps nodes and edges in `std::list`s that it appends to at the front while it builds the graph from the
//! Voronoi diagram and at the back after; its loops walk the lists in that order, so [`Graph::edge_order`] and
//! [`Graph::node_order`] hold it (what a loop does can depend on it where several choices tie), and a loop that
//! appends to the list as it goes (`generateExtraRibs`, `applyTransitions`) walks the new elements too.

/// A point in nanometres.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Default, Hash)]
pub struct P {
    pub x: i64,
    pub y: i64,
}

pub fn p(x: i64, y: i64) -> P {
    P { x, y }
}

impl std::ops::Sub for P {
    type Output = P;
    fn sub(self, o: P) -> P {
        p(self.x - o.x, self.y - o.y)
    }
}

impl std::ops::Add for P {
    type Output = P;
    fn add(self, o: P) -> P {
        p(self.x + o.x, self.y + o.y)
    }
}

impl P {
    pub fn sqnorm(self) -> i64 {
        self.x * self.x + self.y * self.y
    }

    /// Eigen's `norm()` of an integer vector: the square root of the squared norm, as a double, truncated.
    pub fn norm(self) -> i64 {
        (self.sqnorm() as f64).sqrt() as i64
    }
}

/// Orca's `shorter_then`: whether the vector is at most `len` long.
pub fn shorter_then(v: P, len: i64) -> bool {
    if v.x > len || v.x < -len || v.y > len || v.y < -len {
        return false;
    }
    v.sqnorm() <= len * len
}

/// Where along an edge the bead count changes (`TransitionMiddle`), measured from the edge's `from`.
#[derive(Clone, Copy, Debug)]
pub struct TransitionMiddle {
    pub id: u32,
    pub pos: i64,
    pub lower_bead_count: i64,
    pub feature_radius: i64,
}

/// An end of a transition's ramp (`TransitionEnd`), on the edge that runs from lower to higher radius.
#[derive(Clone, Copy, Debug)]
pub struct TransitionEnd {
    pub pos: i64,
    pub lower_bead_count: i64,
    pub is_lower_end: bool,
}

/// A bead's junction on a skeleton edge (`ExtrusionJunction`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Junction {
    pub p: P,
    pub w: i64,
    pub perimeter_index: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EdgeType {
    Normal,
    ExtraVd,
    TransitionEnd,
}

#[derive(Clone, Debug)]
pub struct Edge {
    pub from: usize,
    pub to: usize,
    pub twin: Option<usize>,
    pub next: Option<usize>,
    pub prev: Option<usize>,
    pub kind: EdgeType,
    pub central: Option<bool>,
    pub transitions: Vec<TransitionMiddle>,
    pub transition_ends: Vec<TransitionEnd>,
    pub junctions: Vec<Junction>,
    pub alive: bool,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub p: P,
    pub incident_edge: Option<usize>,
    pub distance_to_boundary: i64,
    pub bead_count: i64,
    pub transition_ratio: f32,
    /// The index of the node's beading in the trapezoidation's list (`BeadingPropagation`).
    pub beading: Option<usize>,
    pub alive: bool,
}

#[derive(Default)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    front_nodes: Vec<usize>,
    back_nodes: Vec<usize>,
    front_edges: Vec<usize>,
    back_edges: Vec<usize>,
    /// The lists in Orca's order, once [`Graph::order`] has been called.
    node_order: Vec<usize>,
    edge_order: Vec<usize>,
    ordered: bool,
}

impl Edge {
    fn new(kind: EdgeType) -> Edge {
        Edge {
            from: usize::MAX,
            to: usize::MAX,
            twin: None,
            next: None,
            prev: None,
            kind,
            central: None,
            transitions: Vec::new(),
            transition_ends: Vec::new(),
            junctions: Vec::new(),
            alive: true,
        }
    }
}

impl Graph {
    /// `nodes.emplace_front` while the graph is built, `emplace_back` after.
    pub fn add_node(&mut self, p: P, front: bool) -> usize {
        let id = self.nodes.len();
        self.nodes.push(Node {
            p,
            incident_edge: None,
            distance_to_boundary: -1,
            bead_count: -1,
            transition_ratio: 0.0,
            beading: None,
            alive: true,
        });
        if self.ordered {
            self.node_order.push(id);
        } else if front {
            self.front_nodes.push(id);
        } else {
            self.back_nodes.push(id);
        }
        id
    }

    pub fn add_edge(&mut self, kind: EdgeType, front: bool) -> usize {
        let id = self.edges.len();
        self.edges.push(Edge::new(kind));
        if self.ordered {
            self.edge_order.push(id);
        } else if front {
            self.front_edges.push(id);
        } else {
            self.back_edges.push(id);
        }
        id
    }

    /// Fixes Orca's list order: what was added at the front, newest first, then what was added at the back.
    pub fn order(&mut self) {
        self.node_order = self.front_nodes.iter().rev().chain(self.back_nodes.iter()).copied().collect();
        self.edge_order = self.front_edges.iter().rev().chain(self.back_edges.iter()).copied().collect();
        self.ordered = true;
    }

    /// The live edges in Orca's order (as the list stands now).
    pub fn edge_ids(&self) -> Vec<usize> {
        self.edge_order.iter().copied().filter(|&e| self.edges[e].alive).collect()
    }

    pub fn node_ids(&self) -> Vec<usize> {
        self.node_order.iter().copied().filter(|&n| self.nodes[n].alive).collect()
    }

    /// The length of the edge's list now: loops that walk by position pick up what is appended.
    pub fn edge_order_len(&self) -> usize {
        self.edge_order.len()
    }

    pub fn edge_at(&self, pos: usize) -> usize {
        self.edge_order[pos]
    }

    pub fn edge_len(&self, e: usize) -> i64 {
        (self.nodes[self.edges[e].to].p - self.nodes[self.edges[e].from].p).norm()
    }

    pub fn central(&self, e: usize) -> bool {
        self.edges[e].central.expect("edge's centrality is set")
    }

    fn twin(&self, e: usize) -> usize {
        self.edges[e].twin.expect("edge has a twin")
    }

    /// `edge->twin->next`: the next edge out of the same node.
    pub fn around(&self, e: usize) -> Option<usize> {
        self.edges[self.twin(e)].next
    }

    // ---- STHalfEdge ----

    pub fn can_go_up(&self, e: usize, strict: bool) -> bool {
        let (from, to) = (self.edges[e].from, self.edges[e].to);
        let (df, dt) = (self.nodes[from].distance_to_boundary, self.nodes[to].distance_to_boundary);
        if dt > df {
            return true;
        }
        if dt < df || strict {
            return false;
        }
        let twin = self.edges[e].twin;
        let mut outgoing = self.edges[e].next;
        while outgoing != twin {
            let Some(o) = outgoing else { break };
            if self.can_go_up(o, false) {
                return true;
            }
            outgoing = self.around(o);
        }
        false
    }

    pub fn dist_to_go_up(&self, e: usize) -> Option<i64> {
        let (from, to) = (self.edges[e].from, self.edges[e].to);
        let (df, dt) = (self.nodes[from].distance_to_boundary, self.nodes[to].distance_to_boundary);
        if dt > df {
            return Some(0);
        }
        if dt < df {
            return None;
        }
        let mut ret: Option<i64> = None;
        let twin = self.edges[e].twin;
        let mut outgoing = self.edges[e].next;
        while outgoing != twin {
            let Some(o) = outgoing else { break };
            if let Some(d) = self.dist_to_go_up(o) {
                ret = Some(ret.map_or(d, |r| r.min(d)));
            }
            outgoing = self.around(o);
        }
        ret.map(|r| r + (self.nodes[to].p - self.nodes[from].p).norm())
    }

    pub fn is_upward(&self, e: usize) -> bool {
        let (from, to) = (self.edges[e].from, self.edges[e].to);
        let (df, dt) = (self.nodes[from].distance_to_boundary, self.nodes[to].distance_to_boundary);
        if dt > df {
            return true;
        }
        if dt < df {
            return false;
        }
        let forward = self.dist_to_go_up(e);
        let backward = self.dist_to_go_up(self.twin(e));
        match (forward, backward) {
            (Some(f), Some(b)) => f < b,
            (Some(_), None) => true,
            (None, Some(_)) => false,
            (None, None) => self.nodes[to].p < self.nodes[from].p,
        }
    }

    /// `getNextUnconnected`: the twin of the last edge of the quad `e` starts, or nothing if the quads loop.
    pub fn next_unconnected(&self, e: usize) -> Option<usize> {
        let mut result = e;
        while let Some(n) = self.edges[result].next {
            result = n;
            if result == e {
                return None;
            }
        }
        self.edges[result].twin
    }

    // ---- STHalfEdgeNode ----

    pub fn is_multi_intersection(&self, n: usize) -> bool {
        let Some(start) = self.nodes[n].incident_edge else { return false };
        let mut count = 0;
        let mut outgoing = start;
        loop {
            if self.central(outgoing) {
                count += 1;
            }
            match self.around(outgoing) {
                Some(o) if o != start => outgoing = o,
                Some(_) => break,
                None => return false,
            }
        }
        count > 2
    }

    pub fn node_is_central(&self, n: usize) -> bool {
        let Some(start) = self.nodes[n].incident_edge else { return false };
        let mut edge = start;
        loop {
            if self.central(edge) {
                return true;
            }
            match self.around(edge) {
                Some(o) if o != start => edge = o,
                _ => return false,
            }
        }
    }

    pub fn is_local_maximum(&self, n: usize, strict: bool) -> bool {
        if self.nodes[n].distance_to_boundary == 0 {
            return false;
        }
        let Some(start) = self.nodes[n].incident_edge else { return false };
        let mut edge = start;
        loop {
            if self.can_go_up(edge, strict) {
                return false;
            }
            let tw = self.twin(edge);
            if self.edges[tw].next.is_none() {
                return false; // On the boundary.
            }
            edge = self.edges[tw].next.unwrap();
            if edge == start {
                return true;
            }
        }
    }

    // ---- SkeletalTrapezoidationGraph ----

    /// `makeRib`: the edge from the quad's last node to its source segment, where the distance to the boundary of
    /// that node is set, and `prev_edge` becomes the rib's way back.
    pub fn make_rib(&mut self, prev_edge: &mut usize, start_source: P, end_source: P) {
        let to = self.edges[*prev_edge].to;
        let to_p = self.nodes[to].p;
        let q = closest_on_infinite(start_source, end_source, to_p).0;
        let dist = (to_p - q).norm();
        self.nodes[to].distance_to_boundary = dist;
        let node = self.add_node(q, true);
        self.nodes[node].distance_to_boundary = 0;
        let forth = self.add_edge(EdgeType::ExtraVd, true);
        let back = self.add_edge(EdgeType::ExtraVd, true);
        self.edges[*prev_edge].next = Some(forth);
        self.edges[forth].prev = Some(*prev_edge);
        self.edges[forth].from = to;
        self.edges[forth].to = node;
        self.edges[forth].twin = Some(back);
        self.edges[back].twin = Some(forth);
        self.edges[back].from = node;
        self.edges[back].to = to;
        self.nodes[node].incident_edge = Some(back);
        *prev_edge = back;
    }

    fn get_source(&self, e: usize) -> (P, P) {
        let mut from = e;
        while let Some(p) = self.edges[from].prev {
            from = p;
        }
        let mut to = e;
        while let Some(n) = self.edges[to].next {
            to = n;
        }
        (self.nodes[self.edges[from].from].p, self.nodes[self.edges[to].to].p)
    }

    /// `insertRib`: splits `edge` at `mid_node` and gives the node a rib to the edge's source segment.
    pub fn insert_rib(&mut self, edge: usize, mid_node: usize) -> (usize, usize) {
        let edge_before = self.edges[edge].prev;
        let edge_after = self.edges[edge].next;
        let node_before = self.edges[edge].from;
        let node_after = self.edges[edge].to;
        let pm = self.nodes[mid_node].p;
        let (sa, sb) = self.get_source(edge);
        let (px, _) = closest_on_segment(sa, sb, pm);
        let dist = (pm - px).norm();
        self.nodes[mid_node].distance_to_boundary = dist;
        self.nodes[mid_node].transition_ratio = 0.0;
        let source_node = self.add_node(px, false);
        self.nodes[source_node].distance_to_boundary = 0;
        let first = edge;
        let second = self.add_edge(EdgeType::Normal, false);
        let outward = self.add_edge(EdgeType::TransitionEnd, false);
        let inward = self.add_edge(EdgeType::TransitionEnd, false);
        if let Some(b) = edge_before {
            self.edges[b].next = Some(first);
        }
        self.edges[first].next = Some(outward);
        self.edges[outward].next = None;
        self.edges[inward].next = Some(second);
        self.edges[second].next = edge_after;
        if let Some(a) = edge_after {
            self.edges[a].prev = Some(second);
        }
        self.edges[second].prev = Some(inward);
        self.edges[inward].prev = None;
        self.edges[outward].prev = Some(first);
        self.edges[first].prev = edge_before;
        self.edges[first].to = mid_node;
        self.edges[outward].to = source_node;
        self.edges[inward].to = mid_node;
        self.edges[second].to = node_after;
        self.edges[first].from = node_before;
        self.edges[outward].from = mid_node;
        self.edges[inward].from = source_node;
        self.edges[second].from = mid_node;
        self.nodes[node_before].incident_edge = Some(first);
        self.nodes[mid_node].incident_edge = Some(outward);
        self.nodes[source_node].incident_edge = Some(inward);
        if let Some(a) = edge_after {
            self.nodes[node_after].incident_edge = Some(a);
        }
        self.edges[first].central = Some(true);
        self.edges[outward].central = Some(false);
        self.edges[inward].central = Some(false);
        self.edges[second].central = Some(true);
        self.edges[outward].twin = Some(inward);
        self.edges[inward].twin = Some(outward);
        self.edges[first].twin = None;
        self.edges[second].twin = None;
        (first, second)
    }

    /// `insertNode`: a node at `mid` on `edge` (and its twin), with ribs to the sources; returns the last edge
    /// that replaces `edge`.
    pub fn insert_node(&mut self, edge: usize, mid: P, bead_count: i64) -> usize {
        let mid_node = self.add_node(mid, false);
        let twin = self.twin(edge);
        self.edges[edge].twin = None;
        self.edges[twin].twin = None;
        let left = self.insert_rib(edge, mid_node);
        let right = self.insert_rib(twin, mid_node);
        let first_input = left.0;
        let last_input = left.1;
        let first_twin = right.0;
        let last_twin = right.1;
        self.edges[first_input].twin = Some(last_twin);
        self.edges[last_twin].twin = Some(first_input);
        self.edges[last_input].twin = Some(first_twin);
        self.edges[first_twin].twin = Some(last_input);
        self.nodes[mid_node].bead_count = bead_count;
        last_input
    }

    /// `collapseSmallEdges`: the middle edge of a quad shorter than `snap_dist` collapses its ends into one node,
    /// and a quad whose ends are both that short disappears.
    pub fn collapse_small_edges(&mut self, snap_dist: i64) {
        let should_collapse = |g: &Graph, a: usize, b: usize| shorter_then(g.nodes[a].p - g.nodes[b].p, snap_dist);
        let mut pos = 0;
        while pos < self.edge_order.len() {
            let e = self.edge_order[pos];
            pos += 1;
            if !self.edges[e].alive || self.edges[e].prev.is_some() {
                continue;
            }
            let quad_start = e;
            let mut quad_end = quad_start;
            while let Some(n) = self.edges[quad_end].next {
                quad_end = n;
            }
            let quad_mid =
                if self.edges[quad_start].next == Some(quad_end) { None } else { self.edges[quad_start].next };
            if let Some(mid) = quad_mid
                && should_collapse(self, self.edges[mid].from, self.edges[mid].to)
            {
                let Some(mid_twin) = self.edges[mid].twin else { continue };
                let mut count = 0;
                let mut edge_from_3 = Some(quad_end);
                while let Some(ef) = edge_from_3 {
                    if ef == mid_twin {
                        break;
                    }
                    let mid_from = self.edges[mid].from;
                    self.edges[ef].from = mid_from;
                    let t = self.twin(ef);
                    self.edges[t].to = mid_from;
                    count += 1;
                    if count > 1000 {
                        break;
                    }
                    edge_from_3 = self.around(ef);
                }
                let mid_from = self.edges[mid].from;
                if self.nodes[mid_from].incident_edge == Some(mid) {
                    self.nodes[mid_from].incident_edge = if let Some(n) = self.edges[mid_twin].next {
                        Some(n)
                    } else {
                        self.edges[self.edges[mid].prev.unwrap()].twin
                    };
                }
                let mid_to = self.edges[mid].to;
                self.nodes[mid_to].alive = false;
                let (mp, mn) = (self.edges[mid].prev.unwrap(), self.edges[mid].next.unwrap());
                self.edges[mp].next = Some(mn);
                self.edges[mn].prev = Some(mp);
                let (tn, tp) = (self.edges[mid_twin].next.unwrap(), self.edges[mid_twin].prev.unwrap());
                self.edges[tn].prev = Some(tp);
                self.edges[tp].next = Some(tn);
                self.edges[mid_twin].alive = false;
                self.edges[mid].alive = false;
            }
            if self.edges[quad_start].alive
                && should_collapse(self, self.edges[quad_start].from, self.edges[quad_end].to)
                && should_collapse(self, self.edges[quad_start].to, self.edges[quad_end].from)
            {
                // Collapse start and end edges and remove the whole cell.
                let qs_twin = self.twin(quad_start);
                let qe_to = self.edges[quad_end].to;
                let qe_twin = self.twin(quad_end);
                self.edges[qs_twin].to = qe_to;
                self.nodes[qe_to].incident_edge = Some(qe_twin);
                let qe_from = self.edges[quad_end].from;
                if self.nodes[qe_from].incident_edge == Some(quad_end) {
                    self.nodes[qe_from].incident_edge = if let Some(n) = self.edges[qe_twin].next {
                        Some(n)
                    } else {
                        self.edges[self.edges[quad_end].prev.unwrap()].twin
                    };
                }
                let qs_from = self.edges[quad_start].from;
                self.nodes[qs_from].alive = false;
                self.edges[qs_twin].twin = Some(qe_twin);
                self.edges[qe_twin].twin = Some(qs_twin);
                self.edges[quad_start].alive = false;
                self.edges[quad_end].alive = false;
            }
        }
    }
}

/// `line_alg::distance_to_infinite_squared`'s closest point: where the infinite line `a`–`b` is nearest `point`,
/// truncated to integers, and the squared distance.
pub fn closest_on_infinite(a: P, b: P, point: P) -> (P, f64) {
    let v = ((b.x - a.x) as f64, (b.y - a.y) as f64);
    let va = ((point.x - a.x) as f64, (point.y - a.y) as f64);
    let l2 = v.0 * v.0 + v.1 * v.1;
    if l2 == 0.0 {
        return (a, va.0 * va.0 + va.1 * va.1);
    }
    let t = (va.0 * v.0 + va.1 * v.1) / l2;
    let closest = p((a.x as f64 + t * v.0) as i64, (a.y as f64 + t * v.1) as i64);
    let d = (t * v.0 - va.0, t * v.1 - va.1);
    (closest, d.0 * d.0 + d.1 * d.1)
}

/// `line_alg::distance_to_squared`'s closest point on the segment `a`–`b`, and the squared distance.
pub fn closest_on_segment(a: P, b: P, point: P) -> (P, f64) {
    let v = ((b.x - a.x) as f64, (b.y - a.y) as f64);
    let va = ((point.x - a.x) as f64, (point.y - a.y) as f64);
    let l2 = v.0 * v.0 + v.1 * v.1;
    if l2 == 0.0 {
        return (a, va.0 * va.0 + va.1 * va.1);
    }
    let t = (va.0 * v.0 + va.1 * v.1) / l2;
    if t <= 0.0 {
        return (a, va.0 * va.0 + va.1 * va.1);
    }
    if t >= 1.0 {
        let d = ((point.x - b.x) as f64, (point.y - b.y) as f64);
        return (b, d.0 * d.0 + d.1 * d.1);
    }
    let closest = p((a.x as f64 + t * v.0) as i64, (a.y as f64 + t * v.1) as i64);
    let d = (t * v.0 - va.0, t * v.1 - va.1);
    (closest, d.0 * d.0 + d.1 * d.1)
}
