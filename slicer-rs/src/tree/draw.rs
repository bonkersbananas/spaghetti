//! Drawing the trees (Orca's `organic_draw_branches`): the placed branches smoothed and nudged off the model, split
//! into trees and branches, each branch made a round tube (a mesh: a ring round each node, a hemisphere or a flat
//! foot at its ends) and cut into the support's layers; then each layer's tubes joined, rounded off and kept clear
//! of the roofs. Where a branch rests on the model, its foot is a bottom contact.
//!
//! Smoothing and meshing work in float millimetres in the object's frame (its bounding box's middle at 0), as
//! Orca's do, so that their rounding comes out alike.

use super::grow::Element;
use super::volumes::Volumes;
use super::{Config, smooth, util};
use crate::geom::{self, Contour, Pt, SCALE, Shapes};
use crate::par;
use std::collections::HashMap;

/// What drawing hands on, for each support layer: the branches' area (Orca's base layers) and the bottom contacts
/// where branches rest on the model.
pub struct Drawn {
    pub base: Vec<Shapes>,
    pub bottom_contacts: Vec<Shapes>,
}

/// The object's frame: units on the plate to and from millimetres about the object's middle.
#[derive(Clone, Copy)]
struct Frame {
    origin: (f64, f64),
}

impl Frame {
    fn mm(&self, p: Pt) -> (f64, f64) {
        ((p.x as f64 - self.origin.0) / SCALE, (p.y as f64 - self.origin.1) / SCALE)
    }

    fn pt(&self, x: f64, y: f64) -> Pt {
        geom::pt((x * SCALE + self.origin.0).round() as i32, (y * SCALE + self.origin.1).round() as i32)
    }
}

/// nm²: a polygon smaller than a micrometre squared is dropped (`tiny_area_threshold`).
const TINY_MM2: f64 = 1e-6;

/// Draws the placed branches of `layers` (`organic_draw_branches`); `contacts` are the roofs' contact layers, which
/// the branches stay out of.
pub fn draw(c: &Config, v: &Volumes, layers: &mut [Vec<Element>], contacts: &[Shapes], origin: (f64, f64)) -> Drawn {
    let frame = Frame { origin };
    let n = layers.len();
    smooth_branches(c, v, layers, frame);
    for e in layers.iter_mut().flatten() {
        e.state.marked = false;
    }
    let trees = trees(layers);
    let layers = &*layers;
    // Each tree's branches, cut into layers.
    let drawn: Vec<Vec<Drawing>> =
        par::map_range(trees.len(), |t| trees[t].iter().filter_map(|b| draw_branch(c, v, layers, b, frame)).collect());
    let mut base: Vec<Shapes> = vec![Vec::new(); n];
    let mut bottoms: Vec<Shapes> = vec![Vec::new(); n];
    for (first, slices, bottom) in drawn.into_iter().flatten() {
        for (k, slice) in slices.into_iter().enumerate() {
            if let Some(layer) = base.get_mut(first + k) {
                layer.extend(slice);
            }
        }
        if let (Some(bottom), Some(layer)) = (bottom, bottoms.get_mut(first)) {
            layer.extend(bottom);
        }
    }
    let lw = c.support_line_width;
    let tolerance = super::mm((30_000.0f64).min(c.resolution as f64));
    let finished: Vec<(Shapes, Shapes)> = par::map_range(n, |l| {
        let mut b = if base[l].is_empty() { Vec::new() } else { geom::union_nonzero(&contours(&base[l])) };
        let mut bottom = if bottoms[l].is_empty() { Vec::new() } else { geom::union_nonzero(&contours(&bottoms[l])) };
        if !b.is_empty() {
            b = smooth::smooth_outward(&b, lw);
            b = geom::simplify_polygons(&b, tolerance);
        }
        let top = contacts.get(l).filter(|t| !t.is_empty()).map(|t| geom::union_nonzero(&contours(t)));
        if let Some(top) = top.filter(|_| !b.is_empty()) {
            b = geom::difference(&b, &top);
            if !bottom.is_empty() {
                bottom = geom::difference(&bottom, &top);
            }
        }
        if !bottom.is_empty() {
            b = geom::difference(&b, &bottom);
        }
        (b, bottom)
    });
    let (base, bottom_contacts) = finished.into_iter().unzip();
    Drawn { base, bottom_contacts }
}

/// A branch cut into layers: its first layer, its slices from there up, and its bottom contact on the first.
type Drawing = (usize, Vec<Shapes>, Option<Shapes>);

/// Every contour of the shapes, as Orca's flat `Polygons`.
fn contours(shapes: &Shapes) -> Vec<Contour> {
    shapes.iter().flatten().cloned().collect()
}

/// Shapes without the polygons (outlines or holes) smaller than a micrometre squared (`remove_small`).
fn remove_small(shapes: Shapes) -> Shapes {
    shapes
        .into_iter()
        .filter(|s| {
            s.first().is_some_and(|outer| (geom::area2(outer) as f64 / 2.0).abs() / (SCALE * SCALE) >= TINY_MM2)
        })
        .map(|s| {
            let mut kept = vec![s[0].clone()];
            kept.extend(
                s[1..].iter().filter(|h| (geom::area2(h) as f64 / 2.0).abs() / (SCALE * SCALE) >= TINY_MM2).cloned(),
            );
            kept
        })
        .collect()
}

// --- Smoothing ---------------------------------------------------------------------------------------------------

/// A layer's collision outline as segments (mm, object frame), bucketed in a grid for the nearest-segment search.
struct Segments {
    lines: Vec<[f64; 4]>,
    min: (f64, f64),
    cell: f64,
    cols: usize,
    rows: usize,
    cells: Vec<Vec<u32>>,
}

impl Segments {
    fn new(shapes: &Shapes, frame: Frame) -> Segments {
        let mut lines = Vec::new();
        for contour in shapes.iter().flatten() {
            for k in 0..contour.len() {
                let (a, b) = (frame.mm(contour[k]), frame.mm(contour[(k + 1) % contour.len()]));
                lines.push([a.0, a.1, b.0, b.1]);
            }
        }
        let cell = 2.0;
        if lines.is_empty() {
            return Segments { lines, min: (0.0, 0.0), cell, cols: 0, rows: 0, cells: Vec::new() };
        }
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for l in &lines {
            x0 = x0.min(l[0].min(l[2]));
            y0 = y0.min(l[1].min(l[3]));
            x1 = x1.max(l[0].max(l[2]));
            y1 = y1.max(l[1].max(l[3]));
        }
        let cols = ((x1 - x0) / cell) as usize + 1;
        let rows = ((y1 - y0) / cell) as usize + 1;
        let mut cells = vec![Vec::new(); cols * rows];
        for (i, l) in lines.iter().enumerate() {
            let (c0, c1) = (((l[0].min(l[2]) - x0) / cell) as usize, ((l[0].max(l[2]) - x0) / cell) as usize);
            let (r0, r1) = (((l[1].min(l[3]) - y0) / cell) as usize, ((l[1].max(l[3]) - y0) / cell) as usize);
            for r in r0..=r1.min(rows - 1) {
                for c in c0..=c1.min(cols - 1) {
                    cells[r * cols + c].push(i as u32);
                }
            }
        }
        Segments { lines, min: (x0, y0), cell, cols, rows, cells }
    }

    fn is_empty(&self) -> bool {
        self.lines.is_empty()
    }

    /// The squared distance from `p` to the nearest segment closer than `sqrt(limit)`, with the point on it, or
    /// `limit` and none (AABBTreeLines' `squared_distance_to_indexed_lines`).
    fn nearest(&self, p: (f64, f64), limit: f64) -> (f64, Option<(f64, f64)>) {
        let r = limit.sqrt();
        let mut best = (limit, None);
        let span = |v: f64, lo: f64, n: usize| -> Option<usize> {
            let k = ((v - lo) / self.cell).floor();
            if k < 0.0 {
                Some(0)
            } else if k as usize >= n {
                None
            } else {
                Some(k as usize)
            }
        };
        let (Some(c0), Some(r0)) = (span(p.0 - r, self.min.0, self.cols), span(p.1 - r, self.min.1, self.rows)) else {
            return best;
        };
        if p.0 + r < self.min.0 || p.1 + r < self.min.1 {
            return best;
        }
        let c1 = span(p.0 + r, self.min.0, self.cols).unwrap_or(self.cols - 1);
        let r1 = span(p.1 + r, self.min.1, self.rows).unwrap_or(self.rows - 1);
        for row in r0..=r1 {
            for col in c0..=c1 {
                for &i in &self.cells[row * self.cols + col] {
                    let l = self.lines[i as usize];
                    let (vx, vy) = (l[2] - l[0], l[3] - l[1]);
                    let l2 = vx * vx + vy * vy;
                    let t =
                        if l2 == 0.0 { 0.0 } else { (((p.0 - l[0]) * vx + (p.1 - l[1]) * vy) / l2).clamp(0.0, 1.0) };
                    let q = (l[0] + vx * t, l[1] + vy * t);
                    let d2 = (q.0 - p.0).powi(2) + (q.1 - p.1).powi(2);
                    if d2 < best.0 {
                        best = (d2, Some(q));
                    }
                }
            }
        }
        best
    }
}

/// One node as the smoothing sees it (`CollisionSphere`).
struct Sphere {
    layer: usize,
    index: usize,
    /// The flat index of the node below, if any.
    below: Option<usize>,
    locked: bool,
    radius: f32,
    position: [f32; 3],
    min_z: f32,
    max_z: f32,
    layer_begin: usize,
    layer_end: usize,
}

/// Moves each node towards the middle of its neighbours above and below and away from the model where it would
/// touch it, as far as its links allow, until nothing touches (`organic_smooth_branches_avoid_collisions`).
fn smooth_branches(c: &Config, v: &Volumes, layers: &mut [Vec<Element>], frame: Frame) {
    let n = layers.len();
    // The nodes in one list, layer by layer, each with the node below it.
    let mut offsets = vec![0usize];
    let mut spheres: Vec<Sphere> = Vec::new();
    let mut below_of: Vec<Option<usize>> = Vec::new();
    for l in 0..n {
        let mut next: Vec<Option<usize>> = vec![None; layers.get(l + 1).map_or(0, Vec::len)];
        for (i, e) in layers[l].iter().enumerate() {
            let below = if l > 0 { below_of.get(i).copied().flatten() } else { None };
            if let Some(above) = layers.get(l + 1) {
                for &p in &e.parents {
                    if above[p].state.result_on_layer.is_some() && next[p].is_none() {
                        next[p] = Some(i);
                    }
                }
            }
            let (x, y) = frame.mm(e.state.result_on_layer.unwrap_or(e.state.next_position));
            let radius = c.element_radius(&e.state) as f32 * 1e-6f32;
            let z = c.layer_z(l) as f32;
            spheres.push(Sphere {
                layer: l,
                index: i,
                below: below.map(|b| offsets[l - 1] + b),
                locked: e.parents.is_empty() || (below.is_none() && l > 0),
                radius,
                position: [x as f32, y as f32, z],
                min_z: -f32::MAX,
                max_z: f32::MAX,
                layer_begin: 0,
                layer_end: 0,
            });
        }
        below_of = next;
        offsets.push(spheres.len());
    }
    if spheres.is_empty() {
        return;
    }
    for k in 0..spheres.len() {
        spheres[k].min_z = match spheres[k].below {
            Some(b) => spheres[b].min_z,
            None => spheres[k].position[2],
        };
    }
    for k in (0..spheres.len()).rev() {
        let (l, i) = (spheres[k].layer, spheres[k].index);
        let parents = &layers[l][i].parents;
        if parents.is_empty() {
            spheres[k].max_z = spheres[k].position[2];
        } else {
            for &p in parents {
                let z = spheres[offsets[l + 1] + p].max_z;
                spheres[k].max_z = spheres[k].max_z.min(z);
            }
        }
    }
    let cache_len = spheres.iter().map(|s| s.layer).max().unwrap_or(0) + 1;
    let first_z = c.layer_z(0);
    let layer_ceil = |z: f64| ((z - first_z) / c.layer_height_mm).ceil().max(0.0) as usize;
    let layer_floor = |z: f64| ((z - first_z) / c.layer_height_mm).floor().max(0.0) as usize;
    for s in &mut spheres {
        s.min_z = s.min_z.max(s.position[2] - s.radius);
        s.max_z = s.max_z.min(s.position[2] + s.radius);
        s.layer_begin = s.layer.min(layer_ceil(s.min_z as f64));
        s.layer_end = cache_len.min(s.layer.max(layer_floor(s.max_z as f64)) + 1);
    }
    let mut has = vec![false; cache_len];
    for s in &spheres {
        has[s.layer] = true;
    }
    let outlines: Vec<Segments> = par::map_range(cache_len, |l| {
        let shapes = if has[l] { v.collision_lower_bound(l, 0).map(|(_, s)| s) } else { None };
        shapes.map_or_else(|| Segments::new(&Vec::new(), frame), |s| Segments::new(s, frame))
    });
    let radius_nm: Vec<f64> =
        spheres.iter().map(|s| c.element_radius(&layers[s.layer][s.index].state) as f64).collect();
    let slow = c.maximum_move_distance_slow as f64;
    for _ in 0..100 {
        let prev: Vec<[f32; 3]> = spheres.iter().map(|s| s.position).collect();
        let xy = |k: usize| (prev[k][0] as f64, prev[k][1] as f64);
        // Keeps a candidate within reach of the nodes it links to (`limit_candidate_to_linked_layers`).
        let limit = |k: usize, mut candidate: (f64, f64), current: (f64, f64)| -> (f64, f64) {
            let constrain = |candidate: (f64, f64), anchor: (f64, f64), allowed: f64| {
                let delta = (candidate.0 - anchor.0, candidate.1 - anchor.1);
                let dist = delta.0.hypot(delta.1);
                let allowed = allowed.max((current.0 - anchor.0).hypot(current.1 - anchor.1));
                if dist > allowed && dist > 1e-4 {
                    (anchor.0 + delta.0 * (allowed / dist), anchor.1 + delta.1 * (allowed / dist))
                } else {
                    candidate
                }
            };
            let s = &spheres[k];
            let r = radius_nm[k];
            if let Some(b) = s.below.filter(|_| s.layer > 0) {
                candidate = constrain(candidate, xy(b), super::mm((radius_nm[b] - r).max(0.0) + slow));
            }
            if s.layer + 1 < n {
                for &p in &layers[s.layer][s.index].parents {
                    let u = offsets[s.layer + 1] + p;
                    if u < spheres.len() {
                        candidate = constrain(candidate, xy(u), super::mm((r - radius_nm[u]).max(0.0) + slow));
                    }
                }
            }
            candidate
        };
        let moved: Vec<Option<([f32; 2], bool)>> = par::map_range(spheres.len(), |k| {
            let s = &spheres[k];
            if s.locked {
                return None;
            }
            let mut pos = [s.position[0], s.position[1]];
            // The deepest collision of the layers the node's ball reaches, at and above its own (Orca's unsigned
            // layer difference skips those below).
            let mut depth = -f64::MAX;
            let mut hit = [0f32; 2];
            let first = s.layer_begin.max(s.layer);
            for (layer, outline) in outlines.iter().enumerate().take(s.layer_end).skip(first) {
                let dz = (layer - s.layer) as f64 * c.layer_height_mm;
                let r2 = (s.radius * s.radius) as f64 - dz * dz;
                if r2 > 0.0 && !outline.is_empty() {
                    let (d2, at) = outline.nearest((pos[0] as f64, pos[1] as f64), r2);
                    let d = r2.sqrt() - d2.sqrt();
                    if d > depth {
                        depth = d;
                        if let Some(at) = at {
                            hit = [at.0 as f32, at.1 as f32];
                        }
                    }
                }
            }
            let mut moved = false;
            if depth > 0.0 {
                moved = depth > 1e-4;
                let nudge = (depth + 0.1).clamp(0.0, 0.5);
                let (dx, dy) = ((pos[0] - hit[0]) as f64, (pos[1] - hit[1]) as f64);
                let len = dx.hypot(dy);
                let dir = if len > 0.0 { (dx / len, dy / len) } else { (0.0, 0.0) };
                // As Orca writes it, the nudge goes its distance squared.
                let current = (pos[0] as f64, pos[1] as f64);
                let candidate = (current.0 + dir.0 * nudge * nudge, current.1 + dir.1 * nudge * nudge);
                let candidate = limit(k, candidate, current);
                pos = [candidate.0 as f32, candidate.1 as f32];
            }
            // Towards the middle of the nodes above (weighted by this one's radius) and the one below (as much as all
            // of those above).
            let (mut ax, mut ay, mut weight) = (0.0, 0.0, 0.0);
            let parents = &layers[s.layer][s.index].parents;
            for &p in parents {
                let w = s.radius as f64;
                let q = xy(offsets[s.layer + 1] + p);
                ax += w * q.0;
                ay += w * q.1;
                weight += w;
            }
            if let Some(b) = s.below {
                let w = weight;
                let q = xy(b);
                ax += w * q.0;
                ay += w * q.1;
                weight += w;
            }
            let (ax, ay) = (ax / weight, ay / weight);
            let old = (pos[0] as f64, pos[1] as f64);
            let shift = (0.5 * old.0 + 0.5 * ax - old.0, 0.5 * old.1 + 0.5 * ay - old.1);
            let dmax = shift.0.hypot(shift.1);
            let d = dmax.clamp(0.0, 0.2);
            if d > 0.0 {
                let candidate = (old.0 + shift.0 * (d / dmax), old.1 + shift.1 * (d / dmax));
                let candidate = limit(k, candidate, old);
                pos = [candidate.0 as f32, candidate.1 as f32];
            }
            Some((pos, moved))
        });
        let mut any = false;
        for (k, m) in moved.into_iter().enumerate() {
            if let Some((pos, moved)) = m {
                spheres[k].position[0] = pos[0];
                spheres[k].position[1] = pos[1];
                any |= moved;
            }
        }
        if !any {
            break;
        }
    }
    // Back to whole nanometres through float, as Orca's `scaled<coord_t>` of a float vector.
    for s in &spheres {
        let nm = |v: f32| (v / 1e-6f32) as i64 as f64 / 1e6;
        layers[s.layer][s.index].state.result_on_layer = Some(frame.pt(nm(s.position[0]), nm(s.position[1])));
    }
}

// --- Trees and branches ------------------------------------------------------------------------------------------

/// A run of nodes from one layer to the next: from a root or a fork up to a tip or the next fork.
struct Branch {
    path: Vec<(usize, usize)>,
    has_root: bool,
    has_tip: bool,
}

/// The trees, each as its branches depth first from its root (`TreeVisitor::visit_recursive`).
fn trees(layers: &mut [Vec<Element>]) -> Vec<Vec<Branch>> {
    let mut out = Vec::new();
    for l in 0..layers.len().saturating_sub(1) {
        for i in 0..layers[l].len() {
            let e = &layers[l][i];
            if e.state.marked || e.parents.is_empty() {
                continue;
            }
            let mut branches = Vec::new();
            visit(layers, (l, i), &mut branches);
            out.push(branches);
        }
    }
    out
}

/// The branches from `start` up, each fork's branches before the next of `start`'s (as Orca's recursion, with an
/// explicit stack).
fn visit(layers: &mut [Vec<Element>], start: (usize, usize), out: &mut Vec<Branch>) {
    layers[start.0][start.1].state.marked = true;
    // Each fork with how many of its parents it has gone up, and whether its branches start at the root.
    let mut stack: Vec<((usize, usize), usize, bool)> = vec![(start, 0, out.is_empty())];
    while let Some(top) = stack.last_mut() {
        let ((l, i), k, root) = *top;
        let Some(&p) = layers[l][i].parents.get(k) else {
            stack.pop();
            continue;
        };
        top.1 += 1;
        let mut path = vec![(l, i), (l + 1, p)];
        let first = (l + 1, p);
        let count = layers[first.0][first.1].parents.len();
        if count < 2 {
            layers[first.0][first.1].state.marked = true;
        }
        let mut next_branch = None;
        if count == 1 {
            let mut at = first;
            loop {
                let next = (at.0 + 1, layers[at.0][at.1].parents[0]);
                path.push(next);
                let count = layers[next.0][next.1].parents.len();
                if count > 1 {
                    next_branch = Some(next);
                    break;
                }
                layers[next.0][next.1].state.marked = true;
                if count == 0 {
                    break;
                }
                at = next;
            }
        } else if count > 1 {
            next_branch = Some(first);
        }
        out.push(Branch { path, has_root: root, has_tip: next_branch.is_none() });
        if let Some(fork) = next_branch {
            layers[fork.0][fork.1].state.marked = true;
            stack.push((fork, 0, false));
        }
    }
}

// --- One branch --------------------------------------------------------------------------------------------------

/// A branch's mesh: float vertices (mm, object frame) and outward-facing triangles.
#[derive(Default)]
struct Tube {
    vertices: Vec<[f32; 3]>,
    faces: Vec<[u32; 3]>,
}

const EPS: f32 = 0.015;

fn sub3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale3(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn normalized3(a: [f64; 3]) -> [f64; 3] {
    let n = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    if n > 0.0 { scale3(a, 1.0 / n) } else { a }
}

fn f32s(a: [f64; 3]) -> [f32; 3] {
    [a[0] as f32, a[1] as f32, a[2] as f32]
}

fn normalized_f(a: [f32; 3]) -> [f32; 3] {
    let n = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    if n > 0.0 { [a[0] / n, a[1] / n, a[2] / n] } else { a }
}

fn cross_f(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

/// The steps of an arc whose chords stray at most `EPS` from a circle of `radius` (float, as Orca's).
fn angle_step(radius: f32) -> f32 {
    (2.0 * (1.0 - (EPS / radius) as f64).acos()) as f32
}

/// A ring of points round `center` across `normal` (`discretize_circle`): from the side `normal × −y`,
/// anticlockwise about `normal`. Its range of vertices.
fn ring(tube: &mut Tube, center: [f32; 3], normal: [f32; 3], radius: f32) -> (usize, usize) {
    let step = angle_step(radius);
    let steps = ((2.0 * std::f64::consts::PI / step as f64).ceil() as usize).max(3);
    let step = (2.0 * std::f64::consts::PI / steps as f64) as f32;
    let x = normalized_f(cross_f(normal, [0.0, -1.0, 0.0]));
    let y = normalized_f(cross_f(normal, x));
    let (x, y) = (x.map(|v| v * radius), y.map(|v| v * radius));
    let begin = tube.vertices.len();
    let mut angle = 0f32;
    for _ in 0..steps {
        let (c, s) = (angle.cos(), angle.sin());
        tube.vertices.push([
            center[0] + x[0] * c + y[0] * s,
            center[1] + x[1] * c + y[1] * s,
            center[2] + x[2] * c + y[2] * s,
        ]);
        angle += step;
    }
    (begin, tube.vertices.len())
}

/// Triangles from `apex` to each side of a ring (`triangulate_fan`), facing back when `flip`.
fn fan(tube: &mut Tube, apex: usize, (b, e): (usize, usize), flip: bool) {
    let mut u = e.saturating_sub(1);
    for v in b..e {
        tube.faces.push(if flip { [apex as u32, u as u32, v as u32] } else { [apex as u32, v as u32, u as u32] });
        u = v;
    }
}

/// Triangles between two rings (`triangulate_strip`): from the upper ring's point nearest the lower's first, each
/// step along whichever ring makes the shorter diagonal.
fn strip(tube: &mut Tube, (b1, e1): (usize, usize), (b2, e2): (usize, usize)) {
    if b1 == e1 {
        // (A hemisphere too small to have a ring: Orca's strip from an empty range is a fan from vertex 0.)
        fan(tube, b1, (b2, e2), true);
        return;
    }
    let d2 = |a: [f32; 3], b: [f32; 3]| {
        let d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
    };
    let p1 = tube.vertices[b1];
    let mut start2 = b2;
    let mut best = f32::MAX;
    for (i, &q) in tube.vertices.iter().enumerate().take(e2).skip(b2) {
        let d = d2(q, p1);
        if d < best {
            best = d;
            start2 = i;
        }
    }
    let (mut n1, mut n2) = (e1 - b1, e2 - b2);
    let (mut u, mut v) = (b1, start2);
    while n1 > 0 || n2 > 0 {
        let u2 = if u + 1 == e1 { b1 } else { u + 1 };
        let v2 = if v + 1 == e2 { b2 } else { v + 1 };
        let take_first = if n1 == 0 {
            false
        } else if n2 == 0 {
            true
        } else {
            d2(tube.vertices[u2], tube.vertices[v]) < d2(tube.vertices[v2], tube.vertices[u])
        };
        if take_first {
            tube.faces.push([u as u32, u2 as u32, v as u32]);
            n1 -= 1;
            u = u2;
        } else {
            tube.faces.push([u as u32, v2 as u32, v as u32]);
            n2 -= 1;
            v = v2;
        }
    }
}

/// A branch's tube (`extrude_branch`): a ring round each node across the branch's direction, a hemisphere at either
/// end, or a flat foot on the plate. Its lowest and highest z.
fn extrude_branch(c: &Config, layers: &[Vec<Element>], b: &Branch, frame: Frame, tube: &mut Tube) -> (f32, f32) {
    let point = |(l, i): (usize, usize)| -> [f64; 3] {
        let (x, y) = frame.mm(layers[l][i].state.result_on_layer.unwrap_or(layers[l][i].state.next_position));
        [x, y, c.layer_z(l)]
    };
    let radius = |(l, i): (usize, usize)| c.element_radius(&layers[l][i].state) as f32 * 1e-6f32;
    let half_pi = std::f64::consts::FRAC_PI_2;
    let mut prev = (0, 0);
    let (mut zmin, mut zmax) = (0f32, 0f32);
    for k in 1..b.path.len() {
        let (p1, p2) = (point(b.path[k - 1]), point(b.path[k]));
        let v1 = normalized3(sub3(p2, p1));
        if k == 1 {
            let nprev = v1;
            let r = radius(b.path[0]);
            if b.has_root && b.path[0].0 == 0 {
                // A flat foot on the plate.
                let normal = [0f32, 0.0, 1.0];
                let bottom = [p1[0] as f32, p1[1] as f32, 0.0];
                let top = [p1[0] as f32, p1[1] as f32, p1[2] as f32];
                let apex = tube.vertices.len();
                tube.vertices.push(bottom);
                let foot = ring(tube, bottom, normal, r);
                fan(tube, apex, foot, false);
                prev = ring(tube, top, normal, r);
                strip(tube, foot, prev);
                zmin = 0.0;
            } else {
                // A hemisphere under the first node, without the ring at its equator.
                let steps = (std::f64::consts::PI / (2.0 * angle_step(r) as f64)).ceil() as usize;
                let step = (std::f64::consts::PI / (2.0 * steps as f64)) as f32;
                let apex = tube.vertices.len();
                let bottom = f32s(sub3(p1, scale3(nprev, r as f64)));
                tube.vertices.push(bottom);
                zmin = bottom[2];
                prev = (apex, apex);
                let mut angle = step;
                for i in 1..steps {
                    let center = f32s(sub3(p1, scale3(nprev, r as f64 * angle.cos() as f64)));
                    let next = ring(tube, center, f32s(nprev), r * angle.sin());
                    if i == 1 {
                        fan(tube, apex, next, false);
                    } else {
                        strip(tube, prev, next);
                    }
                    prev = next;
                    angle += step;
                }
            }
        }
        if k + 1 == b.path.len() {
            // A hemisphere over the last node, from its equator up.
            let ncurrent = v1;
            let r = radius(b.path[k]);
            let steps = (std::f64::consts::PI / (2.0 * angle_step(r) as f64)).ceil() as usize;
            let step = (std::f64::consts::PI / (2.0 * steps as f64)) as f32;
            let mut angle = half_pi as f32;
            for _ in 0..steps {
                let center = f32s(add3(p2, scale3(ncurrent, r as f64 * angle.cos() as f64)));
                let next = ring(tube, center, f32s(ncurrent), r * angle.sin());
                strip(tube, prev, next);
                prev = next;
                angle -= step;
            }
            let apex = tube.vertices.len();
            let top = f32s(add3(p2, scale3(ncurrent, r as f64)));
            tube.vertices.push(top);
            zmax = top[2];
            fan(tube, apex, prev, true);
        } else {
            let p3 = point(b.path[k + 1]);
            let v2 = normalized3(sub3(p3, p2));
            let ncurrent = normalized3(add3(v1, v2));
            let next = ring(tube, f32s(p2), f32s(ncurrent), radius(b.path[k]));
            strip(tube, prev, next);
            prev = next;
        }
    }
    (zmin, zmax)
}

/// A cut through one face: from the edge it goes down through (a key of its two vertices) to the edge it comes up
/// through, from the point on the first.
type Segment = (u64, u64, (f64, f64));

/// The tube cut at each height of `zs` (ascending): its loops made anticlockwise and joined, every point any loop
/// winds round (Orca's `slice_mesh` in its Positive mode, then a NonZero union).
fn cut(tube: &Tube, zs: &[f32], frame: Frame) -> Vec<Shapes> {
    // Each plane's segments: from the edge where the face goes down through the plane to the edge where it comes
    // up, which on an outward-facing mesh runs anticlockwise round the solid.
    let mut segments: Vec<Vec<Segment>> = vec![Vec::new(); zs.len()];
    for f in &tube.faces {
        let v = [tube.vertices[f[0] as usize], tube.vertices[f[1] as usize], tube.vertices[f[2] as usize]];
        let lo = v[0][2].min(v[1][2]).min(v[2][2]);
        let hi = v[0][2].max(v[1][2]).max(v[2][2]);
        let (a, b) = (zs.partition_point(|&z| z < lo), zs.partition_point(|&z| z <= hi));
        for (k, &z) in zs.iter().enumerate().take(b).skip(a) {
            let below = [v[0][2] < z, v[1][2] < z, v[2][2] < z];
            if below[0] == below[1] && below[1] == below[2] {
                continue;
            }
            let (mut down, mut up) = (None, None);
            for (i, j) in [(0usize, 1usize), (1, 2), (2, 0)] {
                if below[i] != below[j] {
                    // The point on the edge, from its higher-numbered end (Orca's order).
                    let (lo_i, hi_i) = if f[i] < f[j] { (i, j) } else { (j, i) };
                    let (pa, pb) = (v[lo_i], v[hi_i]);
                    let t = (z as f64 - pb[2] as f64) / (pa[2] as f64 - pb[2] as f64);
                    let x = pb[0] as f64 + (pa[0] as f64 - pb[0] as f64) * t;
                    let y = pb[1] as f64 + (pa[1] as f64 - pb[1] as f64) * t;
                    let key = ((f[lo_i] as u64) << 32) | f[hi_i] as u64;
                    if below[j] {
                        down = Some((key, (x, y)));
                    } else {
                        up = Some((key, (x, y)));
                    }
                }
            }
            if let (Some(d), Some(u)) = (down, up) {
                segments[k].push((d.0, u.0, d.1));
            }
        }
    }
    segments
        .into_iter()
        .map(|segs| {
            let by_start: HashMap<u64, usize> = segs.iter().enumerate().map(|(i, s)| (s.0, i)).collect();
            let mut used = vec![false; segs.len()];
            let mut loops: Vec<Contour> = Vec::new();
            for first in 0..segs.len() {
                if used[first] {
                    continue;
                }
                let mut points: Contour = Vec::new();
                let mut i = first;
                let closed = loop {
                    used[i] = true;
                    let p = frame.pt(segs[i].2.0, segs[i].2.1);
                    if points.last() != Some(&p) {
                        points.push(p);
                    }
                    if segs[i].1 == segs[first].0 {
                        break true;
                    }
                    match by_start.get(&segs[i].1) {
                        Some(&j) if !used[j] => i = j,
                        _ => break false,
                    }
                };
                if closed && points.len() >= 3 {
                    if geom::area2(&points) < 0 {
                        points.reverse();
                    }
                    loops.push(points);
                }
            }
            geom::union_nonzero(&loops)
        })
        .collect()
}

/// One branch drawn: its first layer, its slices from there up (cut, kept off the model and on the plate), and its
/// bottom contact on the first layer where it rests on the model.
fn draw_branch(c: &Config, v: &Volumes, layers: &[Vec<Element>], b: &Branch, frame: Frame) -> Option<Drawing> {
    let mut tube = Tube::default();
    let (zmin, zmax) = extrude_branch(c, layers, b, frame, &mut tube);
    let first_z = c.layer_z(0);
    let front = &layers[b.path[0].0][b.path[0].1];
    let back = b.path[b.path.len() - 1];
    let mut begin = if b.has_root {
        b.path[0].0
    } else {
        b.path[0].0.min(((zmin as f64 - first_z) / c.layer_height_mm).ceil().max(0.0) as usize)
    };
    let end = if b.has_tip {
        back.0
    } else {
        back.0.max(((zmax as f64 - first_z) / c.layer_height_mm).floor().max(0.0) as usize)
    } + 1;
    // Nothing above the support's layers is printed.
    let end = end.min(layers.len());
    if begin >= end {
        return None;
    }
    let zs: Vec<f32> = (begin..end)
        .map(|l| {
            let bottom = if l > 0 { c.layer_z(l - 1) } else { 0.0 };
            (0.5 * (bottom + c.layer_z(l))) as f32
        })
        .collect();
    let bed = &v.bed;
    let mut slices: Vec<Shapes> = cut(&tube, &zs, frame)
        .into_iter()
        .enumerate()
        .map(|(k, slice)| {
            if slice.is_empty() {
                return slice;
            }
            let kept = util::diff(&slice, v.collision(0, begin + k, true));
            let kept = if bed.is_empty() { kept } else { geom::intersection(&kept, bed) };
            remove_small(kept)
        })
        .collect();
    let empty = slices.iter().take_while(|s| s.is_empty()).count();
    if empty >= slices.len() {
        return None;
    }
    slices.drain(..empty);
    begin += empty;
    let front_contact = slices[0].clone();
    let mut bottom: Option<Shapes> = None;
    let rests = c.support_rests_on_model;
    let floors = c.support_floor_layers > 0;
    let gap = c.z_distance_bottom_layers > 0;
    let placeable = |layer: usize, area: &Shapes| remove_small(util::intersection(area, v.placeable(0, layer)));
    if b.has_root {
        if front.state.to_model_gracious {
            if floors {
                let mut contacts = if rests && gap && begin > 0 {
                    remove_small(front_contact.clone())
                } else {
                    placeable(begin, &front_contact)
                };
                if contacts.is_empty() && rests && begin > 0 && !front_contact.is_empty() {
                    contacts = front_contact.clone();
                }
                if !contacts.is_empty() {
                    bottom = Some(contacts);
                }
            }
        } else if begin > 0 {
            // A branch ending on the model unplaced: its foot carried down as far as it keeps enough area.
            let r0 = c.element_radius(&front.state);
            let max_layers = (5 * r0 / c.layer_height) as usize;
            let lowest = if front.state.verylost { 0 } else { begin.saturating_sub(max_layers) };
            let pi = std::f64::consts::PI;
            let stop_mm2 = (0.2 * pi * (r0 as f64).powi(2)).max(0.5 * pi * (c.branch_radius as f64).powi(2)) / 1e12;
            let mut extra: Vec<Shapes> = Vec::new();
            let mut rest: Shapes = Vec::new();
            for layer in (lowest..begin).rev() {
                let collision_layer = if layer + 1 == begin { begin } else { layer };
                let from = if rest.is_empty() { &front_contact } else { &rest };
                rest = remove_small(util::diff(from, v.collision(0, collision_layer, false)));
                if geom::area_mm2(&rest) < stop_mm2 {
                    break;
                }
                extra.push(rest.clone());
            }
            if floors {
                let source = extra.last().unwrap_or(&front_contact);
                let contacts = if rests && gap && begin > 0 {
                    if extra.is_empty() {
                        remove_small(front_contact.clone())
                    } else if bed.is_empty() {
                        remove_small(source.clone())
                    } else {
                        remove_small(geom::intersection(source, bed))
                    }
                } else {
                    placeable(begin, source)
                };
                if !contacts.is_empty() {
                    bottom = Some(contacts);
                }
                if bottom.is_none() && rests && begin > 0 && !front_contact.is_empty() {
                    bottom = Some(front_contact.clone());
                }
            }
            begin -= extra.len();
            let mut grown: Vec<Shapes> = extra.into_iter().rev().collect();
            grown.append(&mut slices);
            slices = grown;
        }
        if rests && b.path[0].0 > 0 && floors && gap && bottom.is_none() && !front_contact.is_empty() {
            bottom = Some(front_contact);
        }
    }
    while slices.last().is_some_and(|s| s.is_empty()) {
        slices.pop();
    }
    (!slices.is_empty()).then_some((begin, slices, bottom))
}
