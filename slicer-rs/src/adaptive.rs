//! Adaptive cubic and support cubic sparse infill, as Orca 2.5.1's `FillAdaptive.cpp` makes them (from PrusaSlicer):
//! cubes standing on a corner, from an octree built round the object's surface, small near it and large inside, so the
//! infill is dense only where it holds something up. Each layer cuts the octree's cubes at its top into lines three
//! ways, 120° apart; they are cut to the area, joined to their neighbours where they meet them as a T (Orca's
//! `connect_lines_using_hooks`: a short hook along the other line, or a bridge to the next line's end), and then
//! along the walls as every pattern's are (`fill.rs`).
//!
//! The octree: the object's mesh is turned (Orca's fixed angles) so that the cubes stand on a corner, and every cube
//! a triangle touches is split, down to cubes twice the pattern's line spacing (`sparse_infill_line_width` over a third
//! of the density). Support cubic splits only round the triangles that face up more than 45°, the tops the infill
//! holds up. Both also split round the solid infill that rests on sparse infill (the internal bridges' candidates).

use crate::fill::{End, Piece};
use crate::geom::{self, Pt, Shapes};

/// The octree's turn (Orca's `octree_rot`), radians about x, y and z.
const ROT: [f64; 3] =
    [5.0 * std::f64::consts::PI / 4.0, 215.264 * std::f64::consts::PI / 180.0, std::f64::consts::PI / 6.0];

type V3 = [f64; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn scale(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn abs3(a: V3) -> V3 {
    [a[0].abs(), a[1].abs(), a[2].abs()]
}

/// A quaternion (w, x, y, z), as Eigen composes `AngleAxisd`s.
#[derive(Clone, Copy)]
struct Quat([f64; 4]);

impl Quat {
    fn axis(angle: f64, k: usize) -> Quat {
        let (s, c) = (libm::sin(angle / 2.0), libm::cos(angle / 2.0));
        let mut q = [c, 0.0, 0.0, 0.0];
        q[1 + k] = s;
        Quat(q)
    }
    fn mul(self, o: Quat) -> Quat {
        let [w1, x1, y1, z1] = self.0;
        let [w2, x2, y2, z2] = o.0;
        Quat([
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 + y1 * w2 + z1 * x2 - x1 * z2,
            w1 * z2 + z1 * w2 + x1 * y2 - y1 * x2,
        ])
    }
    /// Eigen's `toRotationMatrix`.
    fn matrix(self) -> [V3; 3] {
        let [w, x, y, z] = self.0;
        let (tx, ty, tz) = (2.0 * x, 2.0 * y, 2.0 * z);
        let (twx, twy, twz) = (tx * w, ty * w, tz * w);
        let (txx, txy, txz) = (tx * x, ty * x, tz * x);
        let (tyy, tyz, tzz) = (ty * y, tz * y, tz * z);
        [
            [1.0 - (tyy + tzz), txy - twz, txz + twy],
            [txy + twz, 1.0 - (txx + tzz), tyz - twx],
            [txz - twy, tyz + twx, 1.0 - (txx + tyy)],
        ]
    }
}

fn apply(m: &[V3; 3], v: V3) -> V3 {
    [dot(m[0], v), dot(m[1], v), dot(m[2], v)]
}

/// Orca's `transform_to_octree` and `transform_to_world`.
fn to_octree() -> [V3; 3] {
    Quat::axis(-ROT[0], 0).mul(Quat::axis(-ROT[1], 1)).mul(Quat::axis(-ROT[2], 2)).matrix()
}
fn to_world() -> [V3; 3] {
    Quat::axis(ROT[2], 2).mul(Quat::axis(ROT[1], 1)).mul(Quat::axis(ROT[0], 0)).matrix()
}

/// mm: a cube's sizes at one depth (Orca's `CubeProperties`).
#[derive(Clone, Copy, Debug)]
struct CubeSize {
    edge: f64,
    height: f64,
    diagonal: f64,
    line_z: f64,
    line_xy: f64,
}

impl CubeSize {
    fn of(edge: f64) -> CubeSize {
        CubeSize {
            edge,
            height: edge * 3f64.sqrt(),
            diagonal: edge * 2f64.sqrt(),
            line_z: edge / 3f64.sqrt(),
            line_xy: edge / 6f64.sqrt(),
        }
    }
}

const NONE: u32 = u32::MAX;

#[derive(Debug)]
struct Cube {
    centre: V3,
    children: [u32; 8],
}

/// An object's octree, its cubes' centres in the object's frame (mm, from the middle of its bounding box).
#[derive(Debug)]
pub struct Octree {
    cubes: Vec<Cube>,
    sizes: Vec<CubeSize>,
}

const CHILD_CENTRES: [V3; 8] = [
    [-1.0, -1.0, -1.0],
    [1.0, -1.0, -1.0],
    [-1.0, 1.0, -1.0],
    [1.0, 1.0, -1.0],
    [-1.0, -1.0, 1.0],
    [1.0, -1.0, 1.0],
    [-1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0],
];

/// The order children are visited in for each of the three line directions, so a line grows monotonically.
const TRAVERSAL: [[usize; 8]; 3] = [[2, 3, 0, 1, 6, 7, 4, 5], [4, 0, 6, 2, 5, 1, 7, 3], [1, 5, 0, 4, 3, 7, 2, 6]];

/// Orca's `EPSILON`.
const EPSILON: f64 = 1e-4;

/// mm between the pattern's lines, Orca's `adaptive_fill_line_spacing`: the line's width over a third of the density.
pub fn line_spacing(width: f64, density: f64) -> f64 {
    // Orca's `0.333333333f`, a float.
    width / (density * (1.0f32 / 3.0f32) as f64)
}

impl Octree {
    /// Built from `triangles` (each three corners, mm, in the object's frame) and the bridge candidates' triangles
    /// `overhangs`, for lines `spacing` mm apart; `support` for support cubic (only triangles facing up count).
    pub fn build(triangles: &[[[f32; 3]; 3]], overhangs: &[[V3; 3]], spacing: f64, support: bool) -> Octree {
        let rot = to_octree();
        // The mesh turned, its corners in floats as Orca keeps them.
        let turned: Vec<[V3; 3]> = triangles
            .iter()
            .map(|t| {
                t.map(|v| {
                    let r = apply(&rot, [v[0] as f64, v[1] as f64, v[2] as f64]);
                    [r[0] as f32 as f64, r[1] as f32 as f64, r[2] as f32 as f64]
                })
            })
            .collect();
        let mut lo = [f32::MAX; 3];
        let mut hi = [f32::MIN; 3];
        for t in &turned {
            for v in t {
                for k in 0..3 {
                    lo[k] = lo[k].min(v[k] as f32);
                    hi[k] = hi[k].max(v[k] as f32);
                }
            }
        }
        let centre: V3 = std::array::from_fn(|k| ((lo[k] + hi[k]) * 0.5) as f64);
        let size = (0..3).map(|k| hi[k] - lo[k]).fold(f32::MIN, f32::max) as f64;
        // Orca's `make_cubes_properties`: from twice the spacing, doubling past the object's size; at least two.
        let mut sizes = Vec::new();
        let mut edge = spacing * 2.0;
        loop {
            sizes.push(CubeSize::of(edge));
            if edge > size + EPSILON {
                break;
            }
            edge *= 2.0;
        }
        if sizes.len() == 1 {
            sizes.push(CubeSize::of(sizes[0].edge * 2.0));
        }
        let mut octree = Octree { cubes: vec![Cube { centre, children: [NONE; 8] }], sizes };
        let half = 0.5 * octree.sizes[octree.sizes.len() - 1].edge;
        let root_box = (sub(centre, [half; 3]), add(centre, [half; 3]));
        let depth = octree.sizes.len() - 1;
        let up = apply(&rot, [0.0, 0.0, 1.0]);
        for t in &turned {
            if !support || {
                let n = cross(sub(t[1], t[0]), sub(t[2], t[1]));
                dot(n, up) > 0.707 * dot(n, n).sqrt()
            } {
                octree.insert(t, 0, root_box, depth);
            }
        }
        for t in overhangs {
            let t = t.map(|v| apply(&rot, v));
            octree.insert(&t, 0, root_box, depth);
        }
        // Into the object's frame, so that lines come straight from the centres.
        let world = to_world();
        for cube in &mut octree.cubes {
            cube.centre = apply(&world, cube.centre);
        }
        octree
    }

    fn insert(&mut self, t: &[V3; 3], cube: usize, bbox: (V3, V3), depth: usize) {
        let depth = depth - 1;
        let centre = self.cubes[cube].centre;
        for (i, dir) in CHILD_CENTRES.iter().enumerate() {
            let mut b = bbox;
            for k in 0..3 {
                if dir[k] == -1.0 {
                    b.1[k] = centre[k] + EPSILON;
                } else {
                    b.0[k] = centre[k] - EPSILON;
                }
            }
            if triangle_box(t, b) {
                if self.cubes[cube].children[i] == NONE {
                    let c = add(centre, scale(*dir, self.sizes[depth].edge / 2.0));
                    self.cubes.push(Cube { centre: c, children: [NONE; 8] });
                    self.cubes[cube].children[i] = (self.cubes.len() - 1) as u32;
                }
                if depth > 0 {
                    let child = self.cubes[cube].children[i] as usize;
                    self.insert(t, child, b, depth);
                }
            }
        }
    }

    /// The lines of the layer whose top is `z` (mm, object frame), in nanometres in the object's frame, as Orca's
    /// three `FillContext`s give them: each way's lines as they end, then those still open.
    pub fn lines(&self, z: f64) -> Vec<[(i64, i64); 2]> {
        let mut out = Vec::new();
        if self.sizes.len() < 2 {
            return out;
        }
        for direction in 0..3 {
            let angle = [0.0, (2.0 * std::f64::consts::PI) / 3.0, -(2.0 * std::f64::consts::PI) / 3.0][direction];
            let mut c = Context {
                z,
                order: TRAVERSAL[direction],
                cos: libm::cos(angle),
                sin: libm::sin(angle),
                temp: vec![None; (1usize << self.sizes.len()) - 1],
                output: Vec::new(),
            };
            self.generate(&mut c, 0, 0, self.sizes.len() - 1);
            out.extend(c.output);
            out.extend(c.temp.into_iter().flatten());
        }
        out
    }

    fn generate(&self, c: &mut Context, cube: usize, mut address: usize, depth: usize) {
        let s = self.sizes[depth];
        let centre = self.cubes[cube].centre;
        let dz = c.z - centre[2];
        if dz.abs() > s.height / 2.0 {
            return;
        }
        if dz.abs() < s.line_z {
            let zd = s.line_z;
            let from = (0.5 * s.diagonal * (zd - dz.abs()) / zd, s.line_xy - (zd + dz) / 2f64.sqrt());
            let to = (-from.0, from.1);
            let turn = |v: (f64, f64)| (c.cos * v.0 - c.sin * v.1 + centre[0], c.sin * v.0 + c.cos * v.1 + centre[1]);
            let nm = |v: (f64, f64)| ((v.0 * 1e6) as i64, (v.1 * 1e6) as i64);
            let (a, b) = (nm(turn(from)), nm(turn(to)));
            match &mut c.temp[address] {
                None => c.temp[address] = Some([a, b]),
                Some(last) => {
                    if (a.0 - last[1].0).abs().max((a.1 - last[1].1).abs()) > 1000 {
                        c.output.push(*last);
                        last[0] = a;
                    }
                    last[1] = b;
                }
            }
        }
        if depth == 0 {
            return;
        }
        address = address * 2 + 1;
        let order = c.order;
        for (i, &k) in order.iter().enumerate() {
            let child = self.cubes[cube].children[k];
            if child != NONE {
                self.generate(c, child as usize, address, depth - 1);
            }
            if i == 3 {
                address += 1;
            }
        }
    }
}

struct Context {
    z: f64,
    order: [usize; 8],
    cos: f64,
    sin: f64,
    temp: Vec<Option<[(i64, i64); 2]>>,
    output: Vec<[(i64, i64); 2]>,
}

/// Orca's `triangle_AABB_intersects` (separating axes).
fn triangle_box(t: &[V3; 3], (min, max): (V3, V3)) -> bool {
    let (a, b, c) = (t[0], t[1], t[2]);
    for k in 0..3 {
        let lo = a[k].min(b[k].min(c[k]));
        let hi = a[k].max(b[k].max(c[k]));
        if lo >= max[k] || hi <= min[k] {
            return false;
        }
    }
    let centre = scale(add(min, max), 0.5);
    let h = sub(max, centre);
    let e = [sub(b, a), sub(c, a), sub(c, b)];
    let ac = sub(a, centre);
    let n = cross(e[0], e[1]);
    let s = dot(n, ac);
    let r = dot(h, abs3(n)).abs();
    if s.abs() >= r {
        return false;
    }
    let at = [abs3(e[0]), abs3(e[1]), abs3(e[2])];
    let bc = sub(b, centre);
    let cc = sub(c, centre);
    // The nine axes, each edge crossed with x, y and z, with the corner Orca projects besides a.
    let other = [cc, bc, bc];
    // Edge × x.
    for i in 0..3 {
        let d1 = e[i][1] * ac[2] - e[i][2] * ac[1];
        let d2 = e[i][1] * other[i][2] - e[i][2] * other[i][1];
        let tc = (d1 + d2) * 0.5;
        let r = (h[1] * at[i][2] + h[2] * at[i][1]).abs();
        if r + (tc - d1).abs() < tc.abs() {
            return false;
        }
    }
    // Edge × y.
    for i in 0..3 {
        let d1 = e[i][2] * ac[0] - e[i][0] * ac[2];
        let d2 = e[i][2] * other[i][0] - e[i][0] * other[i][2];
        let tc = (d1 + d2) * 0.5;
        let r = (h[0] * at[i][2] + h[2] * at[i][0]).abs();
        if r + (tc - d1).abs() < tc.abs() {
            return false;
        }
    }
    // Edge × z.
    for i in 0..3 {
        let d1 = e[i][0] * ac[1] - e[i][1] * ac[0];
        let d2 = e[i][0] * other[i][1] - e[i][1] * other[i][0];
        let tc = (d1 + d2) * 0.5;
        let r = (h[1] * at[i][0] + h[0] * at[i][1]).abs();
        if r + (tc - d1).abs() < tc.abs() {
            return false;
        }
    }
    true
}

/// Triangles covering `shapes` (units on the plate) at height `z`, in the object's frame (mm): trapezoids between
/// consecutive corners' heights, each two triangles. (Orca triangulates them; the octree only asks which cubes the area
/// touches, which any cover of it answers alike.)
pub fn cover(shapes: &Shapes, z: f64, centre: (f64, f64)) -> Vec<[V3; 3]> {
    let mut out = Vec::new();
    let edges: Vec<(Pt, Pt)> =
        shapes.iter().flatten().flat_map(|c| (0..c.len()).map(move |i| (c[i], c[(i + 1) % c.len()]))).collect();
    let mut ys: Vec<i32> = shapes.iter().flatten().flatten().map(|p| p.y).collect();
    ys.sort_unstable();
    ys.dedup();
    let mm = |x: f64, y: f64| [(x - centre.0) / geom::SCALE, (y - centre.1) / geom::SCALE, z];
    for w in ys.windows(2) {
        let (y0, y1) = (w[0] as f64, w[1] as f64);
        let ym = (y0 + y1) / 2.0;
        // The edges crossing the slab, with where they cross its bottom, middle and top, left to right.
        let mut xs: Vec<(f64, f64, f64, i32)> = edges
            .iter()
            .filter(|(a, b)| (a.y as f64 <= ym) != (b.y as f64 <= ym))
            .map(|(a, b)| {
                let at = |y: f64| a.x as f64 + (b.x - a.x) as f64 * (y - a.y as f64) / (b.y - a.y) as f64;
                (at(ym), at(y0), at(y1), if b.y > a.y { 1 } else { -1 })
            })
            .collect();
        xs.sort_by(|p, q| p.0.total_cmp(&q.0));
        let mut winding = 0;
        for k in 0..xs.len() {
            winding += xs[k].3;
            if winding != 0 && k + 1 < xs.len() {
                let (l, r) = (xs[k], xs[k + 1]);
                let (p0, p1, p2, p3) = (mm(l.1, y0), mm(r.1, y0), mm(r.2, y1), mm(l.2, y1));
                out.push([p0, p1, p2]);
                out.push([p0, p2, p3]);
            }
        }
    }
    out
}

// ---- Joining the lines (Orca's `connect_lines_using_hooks`) ----

type F2 = (f64, f64);

fn f2(p: Pt) -> F2 {
    (p.x as f64, p.y as f64)
}
fn cross2(a: F2, b: F2) -> f64 {
    a.0 * b.1 - a.1 * b.0
}
fn norm(a: F2) -> F2 {
    let l = a.0.hypot(a.1);
    (a.0 / l, a.1 / l)
}
fn perp(a: F2) -> F2 {
    (-a.1, a.0)
}
fn to_pt(a: F2) -> Pt {
    geom::pt(a.0 as i32, a.1 as i32)
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Line {
    a: Pt,
    b: Pt,
}

impl Line {
    fn vector(&self) -> F2 {
        ((self.b.x - self.a.x) as f64, (self.b.y - self.a.y) as f64)
    }
    /// Orca's `Line::intersection`: where the two segments cross.
    fn intersection(&self, o: &Line) -> Option<Pt> {
        let (v1, v2) = (self.vector(), o.vector());
        let denom = cross2(v1, v2);
        if denom.abs() < EPSILON {
            return None;
        }
        let v12 = ((self.a.x - o.a.x) as f64, (self.a.y - o.a.y) as f64);
        let (t1, t2) = (cross2(v2, v12) / denom, cross2(v1, v12) / denom);
        ((0.0..=1.0).contains(&t1) && (0.0..=1.0).contains(&t2))
            .then(|| to_pt((self.a.x as f64 + t1 * v1.0, self.a.y as f64 + t1 * v1.1)))
    }
    fn translate(&self, d: Pt) -> Line {
        Line { a: geom::pt(self.a.x + d.x, self.a.y + d.y), b: geom::pt(self.b.x + d.x, self.b.y + d.y) }
    }
    /// Orca's `Line::extend`: both ends pushed out by `d`.
    fn extend(&self, d: f64) -> Line {
        let v = self.vector();
        let l = v.0.hypot(v.1);
        if l == 0.0 {
            return *self;
        }
        let e = (v.0 / l * d, v.1 / l * d);
        Line {
            a: geom::pt(self.a.x - e.0 as i32, self.a.y - e.1 as i32),
            b: geom::pt(self.b.x + e.0 as i32, self.b.y + e.1 as i32),
        }
    }
    fn distance2(&self, p: F2) -> f64 {
        let (a, v) = (f2(self.a), self.vector());
        let l2 = v.0 * v.0 + v.1 * v.1;
        let t = if l2 == 0.0 { 0.0 } else { (((p.0 - a.0) * v.0 + (p.1 - a.1) * v.1) / l2).clamp(0.0, 1.0) };
        let (dx, dy) = (a.0 + v.0 * t - p.0, a.1 + v.1 * t - p.1);
        dx * dx + dy * dy
    }
    /// Whether two segments share a point (Boost's `intersects`).
    fn touches(&self, o: &Line) -> bool {
        let side = |a: Pt, b: Pt, p: Pt| {
            let c = (b.x as i64 - a.x as i64) * (p.y as i64 - a.y as i64)
                - (b.y as i64 - a.y as i64) * (p.x as i64 - a.x as i64);
            c.signum()
        };
        let (d1, d2) = (side(o.a, o.b, self.a), side(o.a, o.b, self.b));
        let (d3, d4) = (side(self.a, self.b, o.a), side(self.a, self.b, o.b));
        if d1 * d2 > 0 || d3 * d4 > 0 {
            return false;
        }
        if d1 == 0 && d2 == 0 && d3 == 0 && d4 == 0 {
            let span = |p: Pt, q: Pt| (p.x.min(q.x), p.x.max(q.x), p.y.min(q.y), p.y.max(q.y));
            let (a, b) = (span(self.a, self.b), span(o.a, o.b));
            return a.0 <= b.1 && b.0 <= a.1 && a.2 <= b.3 && b.2 <= a.3;
        }
        true
    }
}

/// A T-joint: a line's end on another line (Orca's `Intersection`).
struct Joint {
    /// The line it ends on, the line ending there, and the polyline that line is (now) part of.
    closest: usize,
    line: usize,
    polyline: usize,
    point: Pt,
    front: bool,
    left: bool,
    used: bool,
}

/// The segments a hook may not cross: the lines and then the area's edges (Orca's rtree), each with whether it is
/// still in.
struct Segments {
    lines: Vec<(Line, bool)>,
}

impl Segments {
    fn nearest(&self, p: F2, keep: impl Fn(usize) -> bool) -> Option<usize> {
        let mut best: Option<(f64, usize)> = None;
        for (i, (l, alive)) in self.lines.iter().enumerate() {
            if *alive && keep(i) {
                let d = l.distance2(p);
                if best.is_none_or(|(b, _)| d < b) {
                    best = Some((d, i));
                }
            }
        }
        best.map(|(_, i)| i)
    }
    fn touching(&self, l: &Line, keep: impl Fn(usize) -> bool) -> Vec<usize> {
        let (lo_x, hi_x) = (l.a.x.min(l.b.x), l.a.x.max(l.b.x));
        let (lo_y, hi_y) = (l.a.y.min(l.b.y), l.a.y.max(l.b.y));
        self.lines
            .iter()
            .enumerate()
            .filter(|(i, (s, alive))| {
                *alive
                    && s.a.x.max(s.b.x) >= lo_x
                    && s.a.x.min(s.b.x) <= hi_x
                    && s.a.y.max(s.b.y) >= lo_y
                    && s.a.y.min(s.b.y) <= hi_y
                    && keep(*i)
                    && s.touches(l)
            })
            .map(|(i, _)| i)
            .collect()
    }
}

/// `pieces` (each two points: a line of the pattern cut to `area`) joined where they meet as Orca's
/// `connect_lines_using_hooks` joins them, `spacing` the infill's (units), hooks up to `hook` and bridges up to
/// `hook_max` (units) long. Each piece keeps where its ends meet the area's edge, for joining along it after.
pub(crate) fn hooks(mut lines: Vec<Piece>, area: &geom::Shape, spacing: f64, hook: f64, hook_max: f64) -> Vec<Piece> {
    if lines.len() <= 1 {
        return lines;
    }
    let offset = (spacing * 0.81) as f32 as f64;
    let trim = (spacing * 0.5 * 0.75) as f32 as f64;
    let mut segs = Segments { lines: Vec::new() };
    let mut touching: Vec<(usize, usize)> = Vec::new();
    // Units: 1,200 nm and Orca's other nanometre thresholds.
    let r2_close = 12.0f64 * 12.0;
    let line_of = |p: &Piece| Line { a: p.points[0], b: p.points[p.points.len() - 1] };
    for i in 0..lines.len() {
        if i > 0 {
            // Orca's `collinear_segment`, for the front and then the back, both before either is applied.
            let (f, b) = (lines[i].points[0], *lines[i].points.last().unwrap());
            let mut found: [Option<(usize, Pt, Option<End>)>; 2] = [None, None];
            for (side, (pt, other_pt)) in [(f, b), (b, f)].into_iter().enumerate() {
                let Some(o) = segs.nearest(f2(pt), |_| true) else { continue };
                let other = &lines[o];
                if other.points.is_empty() {
                    continue;
                }
                let (of, ob) = (other.points[0], other.points[other.points.len() - 1]);
                let d2 = |a: Pt, b: Pt| ((a.x - b.x) as f64).powi(2) + ((a.y - b.y) as f64).powi(2);
                let (d_front, d_back) = (d2(of, pt), d2(ob, pt));
                let d_min = d_front.min(d_back);
                if d_min >= r2_close || d2(of, other_pt).min(d2(ob, other_pt)) <= d_min {
                    continue;
                }
                let v1 = norm(((other_pt.x - pt.x) as f64, (other_pt.y - pt.y) as f64));
                let v2 = norm(((ob.x - of.x) as f64, (ob.y - of.y) as f64));
                if (v1.0 * v2.0 + v1.1 * v2.1).abs() > 0.99f32 as f64 {
                    // Collinear, split by a dent in the edge: one line again.
                    segs.lines[o].1 = false;
                    found[side] = Some(if d_min == d_front { (o, ob, other.ends[1]) } else { (o, of, other.ends[0]) });
                } else {
                    touching.push((i.min(o), i.max(o)));
                }
            }
            for (side, hit) in found.into_iter().enumerate() {
                if let Some((o, far, end)) = hit {
                    let p = &mut lines[i];
                    let k = if side == 0 { 0 } else { p.points.len() - 1 };
                    p.points[k] = far;
                    p.ends[side] = end;
                    lines[o].points.clear();
                }
            }
        }
        let l = line_of(&lines[i]);
        segs.lines.push((l, true));
    }
    let src: Vec<Line> = lines
        .iter()
        .map(|p| if p.points.is_empty() { Line { a: geom::pt(0, 0), b: geom::pt(0, 0) } } else { line_of(p) })
        .collect();
    touching.sort_unstable();
    touching.dedup();

    let mut joints: Vec<Joint> = Vec::new();
    {
        let cos30 = (std::f64::consts::PI / 6.0).cos();
        let drop_both = offset * (2.0 / cos30 + 0.5) + 1.0;
        let anchor_both = drop_both + offset;
        let drop_single = offset * (1.0 / cos30 + 1.5) + 1.0;
        let anchor_single = drop_single + offset;
        for i in 0..lines.len() {
            if lines[i].points.is_empty() {
                continue;
            }
            let tjoint = |pt: Pt, lines: &Vec<Piece>| -> Option<usize> {
                let keep = |k: usize| {
                    if k == i {
                        return false;
                    }
                    let l = &src[k];
                    let v = l.vector();
                    let va = ((pt.x - l.a.x) as f64, (pt.y - l.a.y) as f64);
                    let l2 = v.0 * v.0 + v.1 * v.1;
                    l2 > 0.0 && {
                        let t = va.0 * v.0 + va.1 * v.1;
                        t > 0.01 && t < l2 - 0.01
                    }
                };
                let k = segs.nearest(f2(pt), keep)?;
                let pl = &lines[k];
                if pl.points.len() >= 2 && line_of(pl).distance2(f2(pt)) <= 100.0 {
                    let (lo, hi) = (i.min(k), i.max(k));
                    (touching.binary_search(&(lo, hi)).is_err()).then_some(k)
                } else {
                    None
                }
            };
            let (front_pt, back_pt) = (lines[i].points[0], *lines[i].points.last().unwrap());
            let (tf, tb) = (tjoint(front_pt, &lines), tjoint(back_pt, &lines));
            let count = tf.is_some() as u32 + tb.is_some() as u32;
            if count == 0 {
                continue;
            }
            let len = crate::geom::dist(front_pt, back_pt);
            let (drop, anchor) = if count == 1 {
                (len < drop_single, len > anchor_single)
            } else {
                (len < drop_both, len > anchor_both)
            };
            if drop {
                lines[i].points.clear();
            } else if anchor {
                for (t, pt, front) in [(tf, front_pt, true), (tb, back_pt, false)] {
                    if let Some(k) = t {
                        let v1 = src[k].vector();
                        let l = &src[i];
                        let v2 = if pt == l.a { l.vector() } else { (-l.vector().0, -l.vector().1) };
                        joints.push(Joint {
                            closest: k,
                            line: i,
                            polyline: i,
                            point: pt,
                            front,
                            left: cross2(v1, v2) > 0.0,
                            used: false,
                        });
                    }
                }
            } else {
                let p = &mut lines[i];
                let n = p.points.len();
                let step = trim * 1.155;
                if tf.is_some() {
                    let d = norm(((back_pt.x - front_pt.x) as f64, (back_pt.y - front_pt.y) as f64));
                    p.points[0] = geom::pt(front_pt.x + (d.0 * step) as i32, front_pt.y + (d.1 * step) as i32);
                }
                if tb.is_some() {
                    let f = p.points[0];
                    let d = norm(((f.x - back_pt.x) as f64, (f.y - back_pt.y) as f64));
                    p.points[n - 1] = geom::pt(back_pt.x + (d.0 * step) as i32, back_pt.y + (d.1 * step) as i32);
                }
            }
        }
        // Orca removes joints onto lines since dropped by swapping in the last.
        let mut k = 0;
        while k < joints.len() {
            if lines[joints[k].closest].points.is_empty() {
                joints.swap_remove(k);
            } else {
                k += 1;
            }
        }
    }
    joints.sort_by(|a, b| a.closest.cmp(&b.closest).then((a.left as u8).cmp(&(b.left as u8))));
    let mut merged_with: Vec<usize> = (0..lines.len()).collect();
    for contour in area {
        let n = contour.len();
        for k in 0..n {
            segs.lines.push((Line { a: contour[(k + n - 1) % n], b: contour[k] }, true));
        }
    }
    let resolve = |merged_with: &mut Vec<usize>, i: usize| -> usize {
        let mut last = i;
        loop {
            let lower = merged_with[last];
            if lower == last {
                merged_with[i] = lower;
                return lower;
            }
            last = lower;
        }
    };
    // Lines touching at their ends merge.
    for &(a, b) in touching.iter().rev() {
        let b = resolve(&mut merged_with, b);
        if a == b || lines[a].points.is_empty() || lines[b].points.is_empty() {
            continue;
        }
        let d2 = |p: Pt, q: Pt| ((p.x - q.x) as f64).powi(2) + ((p.y - q.y) as f64).powi(2);
        let (af, ab) = (lines[a].points[0], *lines[a].points.last().unwrap());
        let (bf, bb) = (lines[b].points[0], *lines[b].points.last().unwrap());
        let (d11, d12, d21, d22) = (d2(af, bf), d2(af, bb), d2(ab, bf), d2(ab, bb));
        let (d1, d2m) = (d11.min(d12), d21.min(d22));
        if d1 < d2m {
            reverse(&mut lines[a]);
            if d12 == d1 {
                reverse(&mut lines[b]);
            }
        } else if d22 == d2m {
            reverse(&mut lines[b]);
        }
        let second = std::mem::take(&mut lines[b]);
        let first = &mut lines[a];
        let last = first.points.len() - 1;
        let (p, q) = (first.points[last], second.points[0]);
        first.points[last] = geom::pt((p.x + q.x) / 2, (p.y + q.y) / 2);
        first.points.extend_from_slice(&second.points[1..]);
        first.ends[1] = second.ends[1];
        merged_with[b] = a;
    }

    let fresh = |j: &Joint, lines: &[Piece]| !j.used && !lines[j.polyline].points.is_empty();
    let update = |j: &mut Joint, lines: &[Piece], merged_with: &mut Vec<usize>| {
        j.polyline = resolve(merged_with, j.polyline);
        if fresh(j, lines) {
            j.front = lines[j.polyline].points[0] == j.point;
        }
    };
    let other_hook = |j: &Joint, lines: &[Piece]| -> Option<Line> {
        let pts = &lines[j.polyline].points;
        (pts.len() >= 3).then(|| {
            if j.front { Line { a: pts[1], b: pts[2] } } else { Line { a: pts[pts.len() - 2], b: pts[pts.len() - 3] } }
        })
    };
    let offset_line = |l: Line, j: &Joint| -> Line {
        let d = norm(src[j.closest].vector());
        let p = perp(d);
        let k = if j.left { offset } else { -offset };
        l.translate(geom::pt((p.0 * k) as i32, (p.1 * k) as i32)).extend(offset * 1.16)
    };
    let mut min_idx = 0;
    while min_idx < joints.len() {
        let dir = src[joints[min_idx].closest].vector();
        let mut max_idx = min_idx;
        let mut along: Vec<(usize, f64)> = Vec::new();
        while max_idx < joints.len()
            && joints[max_idx].closest == joints[min_idx].closest
            && joints[max_idx].left == joints[min_idx].left
        {
            along.push((max_idx, dir.0 * joints[max_idx].point.x as f64 + dir.1 * joints[max_idx].point.y as f64));
            max_idx += 1;
        }
        min_idx = max_idx;
        along.sort_by(|a, b| a.1.total_cmp(&b.1));
        if along.len() == 1 {
            let j = along[0].0;
            update(&mut joints[j], &lines, &mut merged_with);
            if fresh(&joints[j], &lines) {
                let other = other_hook(&joints[j], &lines);
                add_hook(&joints[j], offset, hook, trim, &segs, &src, &mut lines, other);
                joints[j].used = true;
            }
            continue;
        }
        for first_idx in 0..along.len() {
            let fi = along[first_idx].0;
            update(&mut joints[fi], &lines, &mut merged_with);
            if !fresh(&joints[fi], &lines) {
                continue;
            }
            if first_idx > 0 {
                update(&mut joints[along[first_idx - 1].0], &lines, &mut merged_with);
            }
            if first_idx + 1 < along.len() {
                update(&mut joints[along[first_idx + 1].0], &lines, &mut merged_with);
            }
            // The nearer of the joints before and after it on the line, as Orca's `get_nearest_intersection`.
            let take_next = if first_idx == 0 {
                true
            } else if first_idx + 1 == along.len() {
                false
            } else {
                let (prev, this, next) = (along[first_idx - 1], along[first_idx], along[first_idx + 1]);
                let (pf, nf) = (fresh(&joints[prev.0], &lines), fresh(&joints[next.0], &lines));
                if pf && nf { next.1 - this.1 < this.1 - prev.1 } else { nf }
            };
            let ni = along[if take_next { first_idx + 1 } else { first_idx - 1 }].0;
            let bridge = offset_line(Line { a: joints[fi].point, b: joints[ni].point }, &joints[fi]);
            let mut connect = None;
            if fresh(&joints[ni], &lines) {
                connect = src[joints[fi].line]
                    .intersection(&bridge)
                    .and_then(|p| src[joints[ni].line].intersection(&bridge).map(|q| (p, q)));
            }
            if let Some((p, q)) = connect {
                let far = ((q.x - p.x) as f64).powi(2) + ((q.y - p.y) as f64).powi(2) > hook_max * hook_max;
                let (lf, ln) = (joints[fi].line, joints[ni].line);
                let crossed = || !segs.touching(&Line { a: p, b: q }, |k| k != lf && k != ln).is_empty();
                let selfish = || {
                    joints[fi].polyline != joints[ni].polyline && {
                        let l = Line { a: p, b: q };
                        other_hook(&joints[fi], &lines).is_some_and(|h| h.intersection(&l).is_some())
                            || other_hook(&joints[ni], &lines).is_some_and(|h| h.intersection(&l).is_some())
                    }
                };
                if far || crossed() || selfish() {
                    connect = None;
                }
            }
            if let Some((mut p, mut q)) = connect {
                let (fp, np) = (joints[fi].polyline, joints[ni].polyline);
                if fp == np {
                    // A loop closes.
                    if !joints[fi].front {
                        std::mem::swap(&mut p, &mut q);
                    }
                    let pts = &mut lines[fp].points;
                    pts[0] = p;
                    let n = pts.len();
                    pts[n - 1] = q;
                    pts.insert(0, q);
                    lines[fp].ends = [None, None];
                } else {
                    let l = Line { a: p, b: q };
                    let d = perp(norm(src[joints[fi].closest].vector()));
                    let k = if joints[fi].left { trim } else { -trim };
                    let l = l.translate(geom::pt((d.0 * k) as i32, (d.1 * k) as i32));
                    let trim_start = (lines[fp].points.len() == 3)
                        .then(|| other_hook(&joints[fi], &lines).and_then(|h| h.intersection(&l)))
                        .flatten();
                    let trim_end = (lines[np].points.len() == 3)
                        .then(|| other_hook(&joints[ni], &lines).and_then(|h| h.intersection(&l)))
                        .flatten();
                    let mut first = std::mem::take(&mut lines[fp]);
                    let second = std::mem::take(&mut lines[np]);
                    if joints[fi].front {
                        reverse(&mut first);
                    }
                    if let Some(s) = trim_start {
                        first.points[0] = s;
                    }
                    let n = first.points.len();
                    first.points[n - 1] = p;
                    first.points.push(q);
                    let mut rest = second;
                    if !joints[ni].front {
                        reverse(&mut rest);
                    }
                    first.points.extend_from_slice(&rest.points[1..]);
                    first.ends[1] = rest.ends[1];
                    if let Some(e) = trim_end {
                        let n = first.points.len();
                        first.points[n - 1] = e;
                    }
                    if fp < np {
                        lines[fp] = first;
                        merged_with[np] = fp;
                    } else {
                        lines[np] = first;
                        merged_with[fp] = np;
                    }
                }
                joints[ni].used = true;
            } else {
                let other = other_hook(&joints[fi], &lines);
                add_hook(&joints[fi], offset, hook, trim, &segs, &src, &mut lines, other);
            }
            joints[fi].used = true;
        }
    }
    lines.into_iter().filter(|p| !p.points.is_empty()).collect()
}

fn reverse(p: &mut Piece) {
    p.points.reverse();
    p.ends.swap(0, 1);
}

/// Orca's `add_hook`: the line's end at a T-joint turned along the line it meets, as long as the room allows.
#[allow(clippy::too_many_arguments)]
fn add_hook(
    j: &Joint,
    offset: f64,
    hook: f64,
    trim: f64,
    segs: &Segments,
    src: &[Line],
    lines: &mut [Piece],
    other_hook: Option<Line>,
) {
    if hook < 1.0 {
        return;
    }
    let closest = src[j.closest];
    let d = norm(closest.vector());
    let p = perp(d);
    let k = if j.left { offset } else { -offset };
    let shifted = closest.translate(geom::pt((p.0 * k) as i32, (p.1 * k) as i32)).extend(offset * 1.16);
    let Some(start) = src[j.line].intersection(&shifted) else { return };
    let vector = (((hook + 1.16 * trim) * d.0) as i32, ((hook + 1.16 * trim) * d.1) as i32);
    let lines_count = src.len();
    let longest = |sign: f64| -> f64 {
        let dir = (d.0 * sign, d.1 * sign);
        let reach = Line { a: start, b: geom::pt(start.x + vector.0 * sign as i32, start.y + vector.1 * sign as i32) };
        let hits = segs.touching(&reach, |k| k != j.line);
        let mut max = hook;
        let pt = f2(start);
        let shift = |dir2: F2| trim * cross2(dir, norm(dir2)).abs();
        for k in hits {
            let s = segs.lines[k].0;
            let pt2 = f2(s.a);
            let dir2 = s.vector();
            let denom = cross2(dir, dir2);
            if denom.abs() <= EPSILON {
                continue;
            }
            let mut t = cross2((pt2.0 - pt.0, pt2.1 - pt.1), dir2) / denom;
            if k < lines_count {
                t -= shift(dir2);
            }
            max = max.min(t);
        }
        if let Some(h) = other_hook
            && let Some(x) = h.intersection(&reach)
        {
            let t = (x.x as f64 - pt.0) * dir.0 + (x.y as f64 - pt.1) * dir.1 - shift(h.vector());
            max = max.min(t);
        }
        max.max(0.0)
    };
    let forward = longest(1.0);
    let backward = if forward < hook - 1.0 { longest(-1.0) } else { 0.0 };
    let length = if forward > backward { forward } else { -backward };
    let end = geom::pt(start.x + (length * d.0) as i32, start.y + (length * d.1) as i32);
    let pl = &mut lines[j.polyline];
    if j.front {
        pl.points[0] = start;
        pl.points.insert(0, end);
        pl.ends[0] = None;
    } else {
        let n = pl.points.len();
        pl.points[n - 1] = start;
        pl.points.push(end);
        pl.ends[1] = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cube_fills_with_three_ways_of_lines() {
        // A 20 mm cube's twelve triangles, centred on its bounding box.
        let c = |x: f32, y: f32, z: f32| [x * 20.0 - 10.0, y * 20.0 - 10.0, z * 20.0];
        let v = [
            c(0., 0., 0.),
            c(1., 0., 0.),
            c(1., 1., 0.),
            c(0., 1., 0.),
            c(0., 0., 1.),
            c(1., 0., 1.),
            c(1., 1., 1.),
            c(0., 1., 1.),
        ];
        let faces = [
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [1, 2, 6],
            [1, 6, 5],
            [2, 3, 7],
            [2, 7, 6],
            [3, 0, 4],
            [3, 4, 7],
        ];
        let tris: Vec<[[f32; 3]; 3]> = faces.iter().map(|f| f.map(|i| v[i])).collect();
        let octree = Octree::build(&tris, &[], line_spacing(0.45, 0.15), false);
        let lines = octree.lines(10.0);
        // Cubes 18 mm and up (twice the 9 mm line spacing): a few lines across the middle.
        assert!(lines.len() >= 6, "{} lines", lines.len());
        // Three directions, 120° apart.
        let mut ways: Vec<i64> = lines
            .iter()
            .map(|l| {
                let a = ((l[1].1 - l[0].1) as f64).atan2((l[1].0 - l[0].0) as f64).to_degrees();
                (a.rem_euclid(180.0)).round() as i64 % 180
            })
            .collect();
        ways.sort_unstable();
        ways.dedup();
        assert_eq!(ways.len(), 3, "{ways:?}");
    }
}
