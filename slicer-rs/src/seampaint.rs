//! Painted seams, as Orca 2.5.1's seam placer reads them (`SeamPlacer.cpp`: `gather_enforcers_blockers`,
//! `GlobalModelInfo::is_enforced`/`is_blocked`, `PaintedContour`, `exact_painted_intervals`, `fully_enforced_loop`):
//! an object's triangles painted to enforce a seam (state 1) or block one (state 2), their contours, and the other
//! surfaces, which prove that a loop is not painted all round.

use crate::mesh::Mesh;
use crate::paint::Paint;

type Corners = [[f32; 3]; 3];

/// Triangles, each with its box, for "is any within this distance" (Orca's AABB tree's `is_any_triangle_in_radius`),
/// found through a grid of `CELL` mm cubes their boxes meet.
#[derive(Default)]
struct Triangles {
    corners: Vec<Corners>,
    boxes: Vec<[f32; 6]>,
    cells: std::collections::HashMap<[i32; 3], Vec<u32>>,
}

/// mm: the side of the grid's cells.
const CELL: f32 = 2.0;

fn cell(v: f32) -> i32 {
    (v / CELL).floor() as i32
}

impl Triangles {
    fn push(&mut self, c: Corners) {
        let mut b = [f32::MAX, f32::MAX, f32::MAX, f32::MIN, f32::MIN, f32::MIN];
        for p in &c {
            for k in 0..3 {
                b[k] = b[k].min(p[k]);
                b[k + 3] = b[k + 3].max(p[k]);
            }
        }
        let k = self.corners.len() as u32;
        for x in cell(b[0])..=cell(b[3]) {
            for y in cell(b[1])..=cell(b[4]) {
                for z in cell(b[2])..=cell(b[5]) {
                    self.cells.entry([x, y, z]).or_default().push(k);
                }
            }
        }
        self.corners.push(c);
        self.boxes.push(b);
    }

    fn is_empty(&self) -> bool {
        self.corners.is_empty()
    }

    /// Whether a triangle comes within `radius` of `p`.
    fn any_within(&self, p: [f32; 3], radius: f32) -> bool {
        let r2 = radius * radius;
        let near = |k: u32| {
            let (c, b) = (&self.corners[k as usize], &self.boxes[k as usize]);
            let mut d2 = 0.0f32;
            for k in 0..3 {
                let d = (b[k] - p[k]).max(0.0) + (p[k] - b[k + 3]).max(0.0);
                d2 += d * d;
            }
            d2 <= r2 && distance2_to_triangle(p, c) <= r2
        };
        let (lo, hi) = (p.map(|v| cell(v - radius)), p.map(|v| cell(v + radius)));
        // A wide reach (a long edge's oversampling test) looks at every triangle rather than many cells.
        if (0..3).map(|k| i64::from(hi[k] - lo[k] + 1)).product::<i64>() > self.corners.len() as i64 {
            return (0..self.corners.len() as u32).any(near);
        }
        for x in lo[0]..=hi[0] {
            for y in lo[1]..=hi[1] {
                for z in lo[2]..=hi[2] {
                    if self.cells.get(&[x, y, z]).is_some_and(|ks| ks.iter().any(|&k| near(k))) {
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Whether any triangle's box meets the box `lo`..`hi`.
    fn any_in_box(&self, lo: [f32; 3], hi: [f32; 3]) -> bool {
        self.boxes.iter().any(|b| (0..3).all(|k| b[k] <= hi[k] && b[k + 3] >= lo[k]))
    }
}

/// The squared distance from `p` to the triangle `t` (its closest point, Ericson's regions).
fn distance2_to_triangle(p: [f32; 3], t: &Corners) -> f32 {
    let sub = |a: [f32; 3], b: [f32; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let (a, b, c) = (t[0], t[1], t[2]);
    let (ab, ac, ap) = (sub(b, a), sub(c, a), sub(p, a));
    let closest = 'q: {
        let (d1, d2) = (dot(ab, ap), dot(ac, ap));
        if d1 <= 0.0 && d2 <= 0.0 {
            break 'q a;
        }
        let bp = sub(p, b);
        let (d3, d4) = (dot(ab, bp), dot(ac, bp));
        if d3 >= 0.0 && d4 <= d3 {
            break 'q b;
        }
        let vc = d1 * d4 - d3 * d2;
        if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
            let v = d1 / (d1 - d3);
            break 'q [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]];
        }
        let cp = sub(p, c);
        let (d5, d6) = (dot(ab, cp), dot(ac, cp));
        if d6 >= 0.0 && d5 <= d6 {
            break 'q c;
        }
        let vb = d5 * d2 - d1 * d6;
        if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
            let w = d2 / (d2 - d6);
            break 'q [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]];
        }
        let va = d3 * d6 - d5 * d4;
        if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
            let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            break 'q [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
        }
        let denom = 1.0 / (va + vb + vc);
        let (v, w) = (vb * denom, vc * denom);
        [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]
    };
    let d = sub(p, closest);
    dot(d, d)
}

/// The contour of a painted region (Orca's `PaintedContour`): the edges only one painted triangle uses, each with the
/// unit direction from it into the paint.
#[derive(Default)]
struct Contour {
    edges: Vec<[[f64; 3]; 2]>,
    inward: Vec<[f64; 3]>,
}

impl Contour {
    /// Orca's `append_painted_contour`: paint lies to the left of an edge in its triangle's counter-clockwise order.
    /// Leaves meet at shared corners (Orca's `get_facets_strict`), so an edge is known by its two corners.
    fn of(painted: &[Corners]) -> Contour {
        let key = |a: [f32; 3], b: [f32; 3]| {
            let k = |p: [f32; 3]| p.map(f32::to_bits);
            let (a, b) = (k(a), k(b));
            if a <= b { (a, b) } else { (b, a) }
        };
        let mut uses: std::collections::HashMap<_, u32> = std::collections::HashMap::new();
        for t in painted {
            for i in 0..3 {
                *uses.entry(key(t[i], t[(i + 1) % 3])).or_default() += 1;
            }
        }
        let mut out = Contour::default();
        for t in painted {
            let v = t.map(|p| p.map(f64::from));
            let sub = |a: [f64; 3], b: [f64; 3]| [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
            let cross = |a: [f64; 3], b: [f64; 3]| {
                [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
            };
            let normal = cross(sub(v[1], v[0]), sub(v[2], v[0]));
            for i in 0..3 {
                let inward = cross(normal, sub(v[(i + 1) % 3], v[i]));
                let n2 = inward[0] * inward[0] + inward[1] * inward[1] + inward[2] * inward[2];
                if uses[&key(t[i], t[(i + 1) % 3])] == 1 && n2 > 0.0 {
                    let n = n2.sqrt();
                    out.edges.push([v[i], v[(i + 1) % 3]]);
                    out.inward.push([inward[0] / n, inward[1] / n, inward[2] / n]);
                }
            }
        }
        out
    }

    /// Where the contour crosses the plane at `z` within the box `min`..`max`, with its inward direction there (only
    /// x and y: Orca's `head<2>`, not made unit again).
    fn crossings(&self, z: f64, min: [f64; 2], max: [f64; 2]) -> Vec<([f64; 2], [f64; 2])> {
        let mut out = Vec::new();
        for (e, inward) in self.edges.iter().zip(&self.inward) {
            let [a, b] = *e;
            let lo = [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])];
            let hi = [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])];
            if hi[0] < min[0] || lo[0] > max[0] || hi[1] < min[1] || lo[1] > max[1] || hi[2] < z || lo[2] > z {
                continue;
            }
            // Half-open in z counts a contour corner on the plane once.
            if (a[2] < z) != (b[2] < z) {
                // Orca's `Linef3::intersect_plane`.
                let t = (z - a[2]) / (b[2] - a[2]);
                out.push(([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], [inward[0], inward[1]]));
            }
        }
        out
    }
}

/// An object's painted seams.
#[derive(Default)]
pub struct Painted {
    enforcers: Triangles,
    blockers: Triangles,
    /// Everything not painted to enforce: what isn't painted, and what blocks (only kept where something enforces).
    non_enforcers: Triangles,
    enforcer_contour: Contour,
    blocker_contour: Contour,
}

/// A painted stretch of a loop, mm along it from its first point; `end` past the loop's length where the stretch
/// passes its first point.
#[derive(Clone, Copy, Debug)]
pub struct Interval {
    pub begin: f64,
    pub end: f64,
}

/// Two places on a loop closer than this (1 µm) are one, mm.
pub const TOLERANCE: f64 = 1e-3;

impl Painted {
    /// The painted seams of an object made of `parts` (each mesh with its seam paint, if any); None without any.
    pub fn of(parts: &[(&Mesh, Option<&Paint>)]) -> Option<Painted> {
        if parts.iter().all(|(_, p)| p.is_none_or(|p| p.is_empty())) {
            return None;
        }
        let mut out = Painted::default();
        let (mut green, mut red, mut rest) = (Vec::new(), Vec::new(), Vec::new());
        for (mesh, paint) in parts {
            let corners = |t: usize| mesh.triangles[t].map(|v| mesh.vertices[v as usize]);
            let mut painted = vec![false; mesh.triangles.len()];
            for (t, code, turned) in paint.iter().flat_map(|p| p.iter()) {
                let t = t as usize;
                if t >= mesh.triangles.len() {
                    continue;
                }
                painted[t] = true;
                let c = corners(t);
                let c = if turned { [c[0], c[2], c[1]] } else { c };
                let Some(leaves) = crate::paint::leaves(code, c) else {
                    rest.push(corners(t));
                    continue;
                };
                for (l, state) in leaves {
                    let l = if turned { [l[0], l[2], l[1]] } else { l };
                    match state {
                        1 => green.push(l),
                        2 => red.push(l),
                        _ => rest.push(l),
                    }
                }
            }
            rest.extend((0..mesh.triangles.len()).filter(|&t| !painted[t]).map(corners));
        }
        out.enforcer_contour = Contour::of(&green);
        out.blocker_contour = Contour::of(&red);
        if !green.is_empty() {
            for &t in rest.iter().chain(&red) {
                out.non_enforcers.push(t);
            }
        }
        for t in green {
            out.enforcers.push(t);
        }
        for t in red {
            out.blockers.push(t);
        }
        (!out.enforcers.is_empty() || !out.blockers.is_empty()).then_some(out)
    }

    pub fn is_enforced(&self, p: [f32; 3], radius: f32) -> bool {
        !self.enforcers.is_empty() && self.enforcers.any_within(p, radius)
    }

    pub fn is_blocked(&self, p: [f32; 3], radius: f32) -> bool {
        !self.blockers.is_empty() && self.blockers.any_within(p, radius)
    }

    /// Orca's `fully_enforced_loop`: whether paint provably covers the whole loop at `z` within `reach` (mm), with no
    /// other surface near it.
    pub fn fully_enforced(&self, polygon: &[[f64; 2]], z: f64, reach: f64) -> bool {
        if polygon.len() < 3 || self.enforcers.is_empty() {
            return false;
        }
        if self.non_enforcers.is_empty() {
            return true;
        }
        if reach <= TOLERANCE {
            return false;
        }
        let (mut min, mut max) = (polygon[0], polygon[0]);
        for p in polygon {
            min = [min[0].min(p[0]), min[1].min(p[1])];
            max = [max[0].max(p[0]), max[1].max(p[1])];
        }
        let lo = [(min[0] - reach) as f32, (min[1] - reach) as f32, (z - reach) as f32];
        let hi = [(max[0] + reach) as f32, (max[1] + reach) as f32, (z + reach) as f32];
        if self.non_enforcers.any_in_box(lo, hi) {
            return false;
        }
        fn covered(me: &Painted, a: [f64; 3], b: [f64; 3], reach: f64, depth: u32) -> bool {
            let middle = [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])];
            let length = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2) + (b[2] - a[2]).powi(2)).sqrt();
            let radius = reach - 0.5 * length - TOLERANCE;
            if radius > 0.0 && me.is_enforced(middle.map(|v| v as f32), radius as f32) {
                return true;
            }
            if depth == 8 {
                return false;
            }
            covered(me, a, middle, reach, depth + 1) && covered(me, middle, b, reach, depth + 1)
        }
        (0..polygon.len()).all(|i| {
            let (a, b) = (polygon[i], polygon[(i + 1) % polygon.len()]);
            covered(self, [a[0], a[1], z], [b[0], b[1], z], reach, 0)
        })
    }

    /// Orca's `exact_painted_intervals` of the enforcing (`blocked` false) or blocking paint: the painted stretches
    /// of a counter-clockwise loop at `z`, bounded where the paint's contour crosses the layer within `reach` of it.
    /// `arc` is the length from the first point to each, the loop's length last. Empty where the contour doesn't
    /// cross near the loop or its crossings don't pair up.
    pub fn intervals(&self, polygon: &[[f64; 2]], arc: &[f64], z: f64, reach: f64, blocked: bool) -> Vec<Interval> {
        let contour = if blocked { &self.blocker_contour } else { &self.enforcer_contour };
        let count = polygon.len();
        if count < 3 || contour.edges.is_empty() {
            return Vec::new();
        }
        let (mut min, mut max) = (polygon[0], polygon[0]);
        for p in polygon {
            min = [min[0].min(p[0]), min[1].min(p[1])];
            max = [max[0].max(p[0]), max[1].max(p[1])];
        }
        let crossings = contour.crossings(z, [min[0] - reach, min[1] - reach], [max[0] + reach, max[1] + reach]);
        let norm = |d: [f64; 2]| (d[0] * d[0] + d[1] * d[1]).sqrt();
        let direction = |mut i: usize, forward: bool| {
            for _ in 0..count {
                let a = polygon[i];
                let b = polygon[(i + 1) % count];
                let d = [b[0] - a[0], b[1] - a[1]];
                let n = norm(d);
                if n >= TOLERANCE {
                    return [d[0] / n, d[1] / n];
                }
                i = if forward { (i + 1) % count } else { (i + count - 1) % count };
            }
            [0.0, 0.0]
        };
        let mut ends: Vec<(f64, bool)> = Vec::new();
        for (point, inward) in crossings {
            let (mut best, mut position, mut tangent) = (f64::MAX, 0.0, [0.0, 0.0]);
            for i in 0..count {
                let a = polygon[i];
                let b = polygon[(i + 1) % count];
                let ab = [b[0] - a[0], b[1] - a[1]];
                let length2 = ab[0] * ab[0] + ab[1] * ab[1];
                let t = if length2 > 0.0 {
                    (((point[0] - a[0]) * ab[0] + (point[1] - a[1]) * ab[1]) / length2).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let q = [a[0] + t * ab[0] - point[0], a[1] + t * ab[1] - point[1]];
                let distance2 = q[0] * q[0] + q[1] * q[1];
                if distance2 < best {
                    best = distance2;
                    let along = t * (arc[i + 1] - arc[i]);
                    position = arc[i] + along;
                    // At a corner the loop turns, so its direction there is the mean of its two sides'.
                    let vertex = if along < TOLERANCE {
                        i
                    } else if arc[i + 1] - position < TOLERANCE {
                        (i + 1) % count
                    } else {
                        count
                    };
                    tangent = if vertex < count {
                        let (p, n) = (direction((vertex + count - 1) % count, false), direction(vertex, true));
                        [p[0] + n[0], p[1] + n[1]]
                    } else {
                        direction(i, true)
                    };
                }
            }
            if best > reach * reach {
                continue;
            }
            let side = inward[0] * tangent[0] + inward[1] * tangent[1];
            if side.abs() < 1e-6 {
                return Vec::new();
            }
            ends.push((position, side > 0.0));
        }
        if ends.is_empty() || !ends.len().is_multiple_of(2) {
            return Vec::new();
        }
        ends.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        for i in 0..ends.len() {
            if ends[i].1 == ends[(i + 1) % ends.len()].1 {
                return Vec::new();
            }
        }
        let first = if ends[0].1 { 0 } else { 1 };
        let mut out = Vec::new();
        let mut i = first;
        while i < first + ends.len() {
            let begin = ends[i % ends.len()].0;
            let mut end = ends[(i + 1) % ends.len()].0;
            if end < begin {
                end += arc[count];
            }
            out.push(Interval { begin, end });
            i += 2;
        }
        out
    }
}
