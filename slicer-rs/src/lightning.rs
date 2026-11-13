//! Lightning infill as OrcaSlicer 2.5 grows it (`libslic3r/Fill/Lightning/`, ported from CuraEngine): only the
//! infill under a top surface prints, as trees of lines that reach in from the walls just far enough to hold that
//! surface up.
//!
//! A layer's trees start under the part of its infill area that the layer above has no infill over, less the edge
//! the walls hold up themselves (its overhang, Orca's `generateInitialInternalOverhangs`). Points on a grid there,
//! nearest the overhang's edge first, are each joined to the nearest tree or wall, until every point lies within the
//! supporting radius of a branch's tip (`generateNewTrees`). Trees carried down from the layer above are joined to a
//! wall or another tree as well (`reconnectRoots`). Each layer then passes its trees down: tips cut back by the prune
//! length, bends straightened, and what leaves the infill area below cut off (`propagateToNextLayer`); so the trees
//! shrink towards the walls layer by layer until they are gone. A layer prints its trees as lines, each from a tip to
//! the junction it meets and stopping half a line short of the branch there (`convertToLines`).
//!
//! Orca works in nanometres in the object's frame, centred on its bounding box. So does this, with Orca's integer
//! rounding and its order of taking points and nodes, so the trees grow where Orca's do. Where Orca's port misreads
//! its own helpers (the wall crossing nearest a point, `lineSegmentPolygonsIntersection`, passes points where
//! directions belong and compares against a stale point), this does what CuraEngine's original does.

use crate::geom::{self, Pt, Shapes};
use crate::par;
use std::collections::HashMap;
use std::f64::consts::PI;

/// A point in nanometres, in the object's frame.
type P = (i64, i64);

/// No node.
const NONE: usize = usize::MAX;
/// Orca's `locator_cell_size()`: tree nodes are found by 4 mm cells.
const LOCATOR_CELL: i64 = 4_000_000;
/// The overhang's points to support per supporting radius, both ways.
const RADIUS_PER_CELL: i64 = 6;
/// nm a reconnecting root may lie inside the walls' reach and still look for a tree (Orca's
/// `tree_connecting_ignore_offset`).
const CONNECTING_IGNORE_OFFSET: i64 = 100;
/// nm from the line between its neighbours within which straightening drops a node.
const CLOSE_ENOUGH: i64 = 10;

/// What lightning infill is grown with, from the process.
#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// The sparse infill's line width, mm.
    pub line_width: f64,
    /// The sparse infill density in % (10 for 10 %), as Orca reads it.
    pub density_percent: f64,
    /// The object's layer height, mm.
    pub layer_height: f64,
    /// Orca's `lightning_overhang_angle`, degrees: the walls hold up the layer above as far in as a slope this
    /// steep reaches over one layer.
    pub overhang_angle: f64,
    /// `lightning_prune_angle`, degrees: how far each layer cuts the tips back, the same way.
    pub prune_angle: f64,
    /// `lightning_straightening_angle`, degrees: how far a node may move as each layer straightens a tree.
    pub straightening_angle: f64,
    /// mm each line stops short of the branch it meets: half the sparse infill's spacing.
    pub junction_gap: f64,
}

/// Every layer's lightning lines for one object, in plate units, each from a tip towards its tree's root. `areas`
/// holds the object's sparse infill area on each layer, `origin` is the centre of its bounding box (units).
pub fn grow(areas: &[Shapes], origin: (f64, f64), p: &Params) -> Vec<Vec<Vec<Pt>>> {
    let n = areas.len();
    let mut out: Vec<Vec<Vec<Pt>>> = vec![Vec::new(); n];
    // Orca's sizes, nm, rounded as Orca rounds them.
    let width = (p.line_width / 1e-6) as f32 as i64;
    let radius = if p.density_percent > 0.0 { ((width * 100) as f64 / p.density_percent) as i64 } else { 0 };
    if n == 0 || radius < 2 * RADIUS_PER_CELL {
        return out;
    }
    let thickness = p.layer_height / 1e-6;
    let reach = |angle: f64| (thickness * (angle * PI / 180.0).tan()) as i64;
    let (wall_radius, prune, straighten) =
        (reach(p.overhang_angle), reach(p.prune_angle), reach(p.straightening_angle));
    let cell = radius / RADIUS_PER_CELL;
    let gap = (p.junction_gap / 1e-6) as i64;
    let o = ((origin.0 * 100.0).round() as i64, (origin.1 * 100.0).round() as i64);
    let to_nm = |q: &Pt| -> P { (q.x as i64 * 100 - o.0, q.y as i64 * 100 - o.1) };
    let from_nm = |q: P| -> Pt {
        geom::pt(((q.0 + o.0) as f64 / 100.0).round() as i32, ((q.1 + o.1) as f64 / 100.0).round() as i32)
    };
    let rings = |shapes: &Shapes| -> Vec<Vec<P>> {
        shapes.iter().flatten().filter(|c| c.len() >= 3).map(|c| c.iter().map(to_nm).collect()).collect()
    };

    let outlines: Vec<Outline> = par::map_range(n, |l| Outline::new(rings(&areas[l])));
    // The points each layer's trees must reach, in the order they are taken.
    let wall_mm = wall_radius as f64 / 1e6;
    let samples: Vec<Vec<(P, i64)>> = par::map_range(n, |l| {
        if areas[l].is_empty() {
            return Vec::new();
        }
        let shrunk = geom::offset(&areas[l], -wall_mm);
        let overhang = match areas.get(l + 1) {
            Some(above) if !above.is_empty() && !shrunk.is_empty() => geom::difference(&shrunk, above),
            _ => shrunk,
        };
        let Some(b) = geom::bbox(&overhang) else { return Vec::new() };
        let bbox = [b[0] as i64 * 100 - o.0, b[1] as i64 * 100 - o.1, b[2] as i64 * 100 - o.0, b[3] as i64 * 100 - o.1];
        // Parts too thin for a point (Orca drops them so: they would break its sampling).
        let opened = geom::opening(&overhang, (cell / 2) as f64 / 1e6);
        let mut points: Vec<(P, i64)> = Vec::new();
        for shape in &opened {
            let one: Vec<Vec<P>> =
                shape.iter().filter(|c| c.len() >= 3).map(|c| c.iter().map(to_nm).collect()).collect();
            for q in sample_grid(&one, cell, bbox) {
                let mut d2 = f64::MAX;
                for ring in &one {
                    let mut prev = ring[ring.len() - 1];
                    for &next in ring {
                        d2 = d2.min(closest_on_segment(prev, next, q).0);
                        prev = next;
                    }
                }
                points.push((q, d2.sqrt() as i64));
            }
        }
        // Nearest the overhang's edge first; points within a radius of each other in a fixed shuffled order.
        stable_sort_gnu(&mut points, &|a: &(P, i64), b: &(P, i64)| {
            if (b.1 - a.1).abs() > radius { a.1 < b.1 } else { point_hash(a.0) % 191 < point_hash(b.0) % 191 }
        });
        points
    });

    let mut trees = Forest::default();
    for l in (0..n).rev() {
        let outline = &outlines[l];
        let carried = trees.roots.clone();
        if !samples[l].is_empty() {
            let mut field = Field::new(&samples[l], outline.bbox, cell);
            trees.grow_new(&mut field, outline, radius, wall_radius);
        }
        trees.reconnect(&carried, outline, radius, wall_radius);
        // In plate units, without repeated points; a line left without length goes, as Clipper drops it when Orca
        // cuts the lines to the area.
        out[l] = trees
            .lines(gap)
            .into_iter()
            .map(|line| {
                let mut points: Vec<Pt> = line.into_iter().map(from_nm).collect();
                points.dedup();
                points
            })
            .filter(|points| points.len() >= 2)
            .collect();
        if l == 0 {
            break;
        }
        trees = trees.propagate(&outlines[l - 1], prune, straighten, LOCATOR_CELL / 2);
    }
    out
}

/// Orca's `PointHash`.
fn point_hash(p: P) -> u64 {
    ((89 * 31 + p.0).wrapping_mul(31).wrapping_add(p.1)) as u64
}

/// The length of a vector (Eigen's `norm`: the root of the sum of squares, rounded the same everywhere).
fn norm(v: P) -> f64 {
    let (x, y) = (v.0 as f64, v.1 as f64);
    (x * x + y * y).sqrt()
}

/// The length of a vector, truncated to whole nanometres, as Orca's `coord_t(v.cast<double>().norm())`.
fn length(v: P) -> i64 {
    norm(v) as i64
}

fn sub(a: P, b: P) -> P {
    (a.0 - b.0, a.1 - b.1)
}

/// `v` scaled to `magnitude`, each part truncated (Orca's `(v.cast<double>().normalized() * m).cast<coord_t>()`).
fn towards(v: P, magnitude: f64) -> P {
    let len = norm(v);
    if len == 0.0 {
        return (0, 0);
    }
    ((v.0 as f64 / len * magnitude) as i64, (v.1 as f64 / len * magnitude) as i64)
}

/// The squared distance from `p` to the segment a–b and the point of the segment nearest it (Orca's
/// `line_alg::distance_to_squared`, the point truncated).
fn closest_on_segment(a: P, b: P, p: P) -> (f64, P) {
    let v = ((b.0 - a.0) as f64, (b.1 - a.1) as f64);
    let va = ((p.0 - a.0) as f64, (p.1 - a.1) as f64);
    let l2 = v.0 * v.0 + v.1 * v.1;
    if l2 == 0.0 {
        return (va.0 * va.0 + va.1 * va.1, a);
    }
    let t = (va.0 * v.0 + va.1 * v.1) / l2;
    if t <= 0.0 {
        return (va.0 * va.0 + va.1 * va.1, a);
    }
    if t >= 1.0 {
        let w = ((p.0 - b.0) as f64, (p.1 - b.1) as f64);
        return (w.0 * w.0 + w.1 * w.1, b);
    }
    let w = (t * v.0 - va.0, t * v.1 - va.1);
    (w.0 * w.0 + w.1 * w.1, ((a.0 as f64 + t * v.0) as i64, (a.1 as f64 + t * v.1) as i64))
}

// ---- The points to support (DistanceField.cpp, sample_grid_pattern) ----

/// One crossing of a vertical line with a ring's edge: its position as the fraction `p / q`, the ring and edge it
/// comes from, and whether the edge runs to the right.
#[derive(Clone, Copy)]
struct Crossing {
    p: i64,
    q: i64,
    ring: usize,
    right: bool,
}

impl Crossing {
    /// The position rounded to the nearest nanometre, as Orca's `SegmentIntersection::pos`.
    fn pos(&self) -> i64 {
        let half = self.q >> 1;
        (if self.p < 0 { self.p - half } else { self.p + half }) / self.q
    }
}

/// Orca's `sample_grid_pattern`: points `spacing` apart inside a shape (its rings, nm), on vertical lines from the
/// left of `bbox` and at whole multiples of `spacing` up them, each line's points from the bottom up.
fn sample_grid(rings: &[Vec<P>], spacing: i64, bbox: [i64; 4]) -> Vec<P> {
    let x0 = bbox[0];
    let lines = ((bbox[2] - bbox[0] + spacing - 1) / spacing).max(0) as usize;
    let mut crossings: Vec<Vec<Crossing>> = vec![Vec::new(); lines];
    for (k, ring) in rings.iter().enumerate() {
        let m = ring.len();
        if m < 2 {
            continue;
        }
        for i in 0..m {
            let prev = (i + m - 1) % m;
            let (p1, p2) = (ring[prev], ring[i]);
            let (l, r) = (p1.0.min(p2.0), p1.0.max(p2.0));
            let mut il = (l - x0) / spacing;
            while il * spacing + x0 < l {
                il += 1;
            }
            let il = il.max(0);
            let mut ir = (r - x0 + spacing) / spacing;
            while ir * spacing + x0 > r {
                ir -= 1;
            }
            let ir = ir.min(lines as i64 - 1);
            for line in il..=ir {
                let x = x0 + line * spacing;
                let (p, q) = if p1.0 == x {
                    // A vertical edge on the line, or a corner touching it from one side, crosses nothing.
                    if p2.0 == x || (ring[(prev + m - 1) % m].0 - p1.0) * (p2.0 - p1.0) > 0 {
                        continue;
                    }
                    (p1.1, 1)
                } else if p2.0 == x {
                    if (ring[(i + 1) % m].0 - p2.0) * (p1.0 - p2.0) > 0 {
                        continue;
                    }
                    (p2.1, 1)
                } else {
                    let (t, q) = if p2.0 > p1.0 { (x - p1.0, p2.0 - p1.0) } else { (p1.0 - x, p1.0 - p2.0) };
                    (t * (p2.1 - p1.1) + p1.1 * q, q)
                };
                crossings[line as usize].push(Crossing { p, q, ring: k, right: p2.0 > p1.0 });
            }
        }
    }
    let mut out = Vec::new();
    for (line, mut found) in crossings.into_iter().enumerate() {
        found.sort_by(|a, b| (a.p as i128 * b.q as i128).cmp(&(b.p as i128 * a.q as i128)));
        // A corner on the line crosses it once, from either edge; of a stretch of ring along the line, the end
        // that keeps it inside counts.
        let mut kept: Vec<Crossing> = Vec::with_capacity(found.len());
        for c in found {
            if let Some(last) = kept.last_mut()
                && last.ring == c.ring
                && c.q == 1
                && last.q == 1
            {
                if c.p == last.p {
                    continue;
                }
                if c.right == last.right {
                    if !c.right {
                        *last = c;
                    }
                    continue;
                }
            }
            kept.push(c);
        }
        let x = x0 + line as i64 * spacing;
        for pair in kept.as_chunks::<2>().0 {
            let (a, b) = (pair[0].pos(), pair[1].pos());
            let mut y = a - a % spacing - spacing;
            while y < b {
                if y > a {
                    out.push((x, y));
                }
                y += spacing;
            }
        }
    }
    out
}

/// A layer's points still to support (Orca's `DistanceField`), in the order they are taken, with a grid to find
/// those near a new branch.
struct Field<'a> {
    points: &'a [(P, i64)],
    supported: Vec<bool>,
    /// The grid's corner (the infill outline's and the points' bounding box), cell size, and the cells' range.
    min: P,
    cell: i64,
    lo: P,
    nx: i64,
    ny: i64,
    /// The point in each cell, plus one; 0 for none.
    grid: Vec<u32>,
}

impl<'a> Field<'a> {
    fn new(points: &'a [(P, i64)], outline: Option<[i64; 4]>, cell: i64) -> Field<'a> {
        let mut b = outline.unwrap_or([i64::MAX, i64::MAX, i64::MIN, i64::MIN]);
        for &(q, _) in points {
            b = [b[0].min(q.0), b[1].min(q.1), b[2].max(q.0), b[3].max(q.1)];
        }
        let min = (b[0], b[1]);
        let mut lo = (i64::MAX, i64::MAX);
        let mut hi = (i64::MIN, i64::MIN);
        for &(q, _) in points {
            let g = ((q.0 - min.0) / cell, (q.1 - min.1) / cell);
            lo = (lo.0.min(g.0), lo.1.min(g.1));
            hi = (hi.0.max(g.0), hi.1.max(g.1));
        }
        let (nx, ny) = (hi.0 - lo.0 + 1, hi.1 - lo.1 + 1);
        let mut grid = vec![0u32; (nx * ny) as usize];
        for (i, &(q, _)) in points.iter().enumerate() {
            let g = ((q.0 - min.0) / cell - lo.0, (q.1 - min.1) / cell - lo.1);
            grid[(g.1 * nx + g.0) as usize] = i as u32 + 1;
        }
        Field { points, supported: vec![false; points.len()], min, cell, lo, nx, ny, grid }
    }

    /// The first point from `start` on not yet supported.
    fn next(&self, start: usize) -> Option<usize> {
        (start..self.points.len()).find(|&i| !self.supported[i])
    }

    /// Marks the points within `radius` of a new branch's tip supported.
    fn update(&mut self, tip: P, radius: i64) {
        let r2 = radius as i128 * radius as i128;
        let cell_of = |v: i64, min: i64, lo: i64| (v.max(min) - min) / self.cell - lo;
        let (x0, x1) = (cell_of(tip.0 - radius, self.min.0, self.lo.0), cell_of(tip.0 + radius, self.min.0, self.lo.0));
        let (y0, y1) = (cell_of(tip.1 - radius, self.min.1, self.lo.1), cell_of(tip.1 + radius, self.min.1, self.lo.1));
        for gy in y0.max(0)..=y1.min(self.ny - 1) {
            for gx in x0.max(0)..=x1.min(self.nx - 1) {
                let at = self.grid[(gy * self.nx + gx) as usize];
                if at == 0 {
                    continue;
                }
                let i = at as usize - 1;
                let d = sub(self.points[i].0, tip);
                if d.0 as i128 * d.0 as i128 + d.1 as i128 * d.1 as i128 <= r2 {
                    self.supported[i] = true;
                }
            }
        }
    }
}

/// libstdc++'s `std::stable_sort` (with the buffer it gets, half the range): the order of Orca's samples depends on
/// it, as their comparison is not transitive.
fn stable_sort_gnu<T: Copy>(v: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    let len = v.len();
    if len < 2 {
        return;
    }
    let middle = len.div_ceil(2);
    let mut buf: Vec<T> = v[..middle].to_vec();
    merge_sort_with_buffer(&mut v[..middle], &mut buf, less);
    merge_sort_with_buffer(&mut v[middle..], &mut buf, less);
    let (len1, len2) = (middle, len - middle);
    if len1 <= len2 {
        buf[..len1].copy_from_slice(&v[..middle]);
        let (mut i, mut j, mut r) = (0, middle, 0);
        while i < len1 && j < len {
            if less(&v[j], &buf[i]) {
                v[r] = v[j];
                j += 1;
            } else {
                v[r] = buf[i];
                i += 1;
            }
            r += 1;
        }
        v[r..r + len1 - i].copy_from_slice(&buf[i..len1]);
    } else {
        buf[..len2].copy_from_slice(&v[middle..]);
        if len2 == 0 {
            return;
        }
        let (mut l1, mut l2, mut r) = (middle - 1, len2 - 1, len);
        loop {
            if less(&buf[l2], &v[l1]) {
                r -= 1;
                v[r] = v[l1];
                if l1 == 0 {
                    v[r - (l2 + 1)..r].copy_from_slice(&buf[..=l2]);
                    return;
                }
                l1 -= 1;
            } else {
                r -= 1;
                v[r] = buf[l2];
                if l2 == 0 {
                    return;
                }
                l2 -= 1;
            }
        }
    }
}

fn merge_sort_with_buffer<T: Copy>(v: &mut [T], buf: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    const CHUNK: usize = 7;
    let len = v.len();
    let mut start = 0;
    while len - start >= CHUNK {
        insertion_sort(&mut v[start..start + CHUNK], less);
        start += CHUNK;
    }
    insertion_sort(&mut v[start..], less);
    let mut step = CHUNK;
    while step < len {
        merge_sort_loop(v, &mut buf[..len], step, less);
        step *= 2;
        merge_sort_loop(&buf[..len], v, step, less);
        step *= 2;
    }
}

fn insertion_sort<T: Copy>(v: &mut [T], less: &impl Fn(&T, &T) -> bool) {
    for i in 1..v.len() {
        let value = v[i];
        if less(&value, &v[0]) {
            v.copy_within(0..i, 1);
            v[0] = value;
        } else {
            let mut j = i;
            while less(&value, &v[j - 1]) {
                v[j] = v[j - 1];
                j -= 1;
            }
            v[j] = value;
        }
    }
}

fn merge_sort_loop<T: Copy>(from: &[T], to: &mut [T], step: usize, less: &impl Fn(&T, &T) -> bool) {
    let len = from.len();
    let (mut start, mut r) = (0, 0);
    while len - start >= 2 * step {
        r = move_merge(&from[start..start + step], &from[start + step..start + 2 * step], to, r, less);
        start += 2 * step;
    }
    let step = (len - start).min(step);
    move_merge(&from[start..start + step], &from[start + step..len], to, r, less);
}

fn move_merge<T: Copy>(a: &[T], b: &[T], to: &mut [T], mut r: usize, less: &impl Fn(&T, &T) -> bool) -> usize {
    let (mut i, mut j) = (0, 0);
    while i < a.len() && j < b.len() {
        if less(&b[j], &a[i]) {
            to[r] = b[j];
            j += 1;
        } else {
            to[r] = a[i];
            i += 1;
        }
        r += 1;
    }
    for &x in a[i..].iter().chain(&b[j..]) {
        to[r] = x;
        r += 1;
    }
    r
}

// ---- A layer's infill outline (EdgeGrid, as the trees use it) ----

/// A layer's infill outline (nm): its edges in Orca's order (ring by ring, each from its last point round), by cell
/// to find those near a point or a segment, and by row to tell whether a point is inside.
struct Outline {
    edges: Vec<(P, P)>,
    bbox: Option<[i64; 4]>,
    x0: i64,
    y0: i64,
    cell: i64,
    nx: i64,
    ny: i64,
    cells: Vec<Vec<u32>>,
    rows: Vec<Vec<u32>>,
}

impl Outline {
    fn new(rings: Vec<Vec<P>>) -> Outline {
        let mut edges = Vec::new();
        let mut b = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
        for ring in &rings {
            let m = ring.len();
            for i in 0..m {
                let q = ring[i];
                b = [b[0].min(q.0), b[1].min(q.1), b[2].max(q.0), b[3].max(q.1)];
                edges.push((ring[(i + m - 1) % m], q));
            }
        }
        if edges.is_empty() {
            return Outline {
                edges,
                bbox: None,
                x0: 0,
                y0: 0,
                cell: 1,
                nx: 0,
                ny: 0,
                cells: Vec::new(),
                rows: Vec::new(),
            };
        }
        let (w, h) = (b[2] - b[0], b[3] - b[1]);
        let cell = (((w as f64 + 1.0) * (h as f64 + 1.0) / edges.len() as f64).sqrt() as i64).clamp(250_000, 8_000_000);
        let (nx, ny) = (w / cell + 1, h / cell + 1);
        let mut outline = Outline {
            edges,
            bbox: Some(b),
            x0: b[0],
            y0: b[1],
            cell,
            nx,
            ny,
            cells: vec![Vec::new(); (nx * ny) as usize],
            rows: vec![Vec::new(); ny as usize],
        };
        for id in 0..outline.edges.len() {
            let (a, z) = outline.edges[id];
            let (cx0, cy0) = outline.cell_of((a.0.min(z.0), a.1.min(z.1)));
            let (cx1, cy1) = outline.cell_of((a.0.max(z.0), a.1.max(z.1)));
            for cy in cy0..=cy1 {
                outline.rows[cy as usize].push(id as u32);
                for cx in cx0..=cx1 {
                    outline.cells[(cy * nx + cx) as usize].push(id as u32);
                }
            }
        }
        outline
    }

    fn is_empty(&self) -> bool {
        self.edges.is_empty()
    }

    fn cell_of(&self, q: P) -> (i64, i64) {
        ((q.0 - self.x0).div_euclid(self.cell), (q.1 - self.y0).div_euclid(self.cell))
    }

    /// The edges in the cells a box covers (an edge may come more than once).
    fn in_box(&self, a: P, b: P) -> impl Iterator<Item = (P, P)> + '_ {
        let (cx0, cy0) = self.cell_of((a.0.min(b.0), a.1.min(b.1)));
        let (cx1, cy1) = self.cell_of((a.0.max(b.0), a.1.max(b.1)));
        let (cx0, cx1, cy0, cy1) = (cx0.max(0), cx1.min(self.nx - 1), cy0.max(0), cy1.min(self.ny - 1));
        (cy0..=cy1).flat_map(move |cy| {
            (cx0..=cx1)
                .flat_map(move |cx| self.cells[(cy * self.nx + cx) as usize].iter().map(|&id| self.edges[id as usize]))
        })
    }

    /// The point of the outline nearest `u`; of equally near ones, the first in Orca's order.
    fn closest(&self, u: P) -> P {
        if self.edges.is_empty() {
            return (0, 0);
        }
        let (cx, cy) = self.cell_of(u);
        let mut best: (f64, u32, P) = (f64::INFINITY, u32::MAX, (0, 0));
        let last = cx.abs() + cy.abs() + self.nx + self.ny;
        for k in 0..=last {
            if k > 0 {
                let near = ((k - 1) * self.cell) as f64;
                if near * near > best.0 {
                    break;
                }
            }
            for y in (cy - k).max(0)..=(cy + k).min(self.ny - 1) {
                let whole_row = y == cy - k || y == cy + k;
                let mut visit = |x: i64| {
                    if x < 0 || x >= self.nx {
                        return;
                    }
                    for &id in &self.cells[(y * self.nx + x) as usize] {
                        let (a, b) = self.edges[id as usize];
                        let (d, q) = closest_on_segment(a, b, u);
                        if d < best.0 || (d == best.0 && id < best.1) {
                            best = (d, id, q);
                        }
                    }
                };
                if whole_row {
                    for x in cx - k..=cx + k {
                        visit(x);
                    }
                } else {
                    visit(cx - k);
                    if k > 0 {
                        visit(cx + k);
                    }
                }
            }
        }
        best.2
    }

    /// Whether the segment a–b meets the outline (Orca's `polygonCollidesWithLineSegment`).
    fn crosses(&self, a: P, b: P) -> bool {
        self.in_box(a, b).any(|(p, q)| segments_intersect(p, q, a, b))
    }

    /// Where the segment a–b crosses the outline nearest `b`, if that is closer to `b` than `within` (CuraEngine's
    /// `lineSegmentPolygonsIntersection`).
    fn crossing_near(&self, a: P, b: P, within: i64) -> Option<P> {
        let mut best: Option<(f64, (f64, f64))> = None;
        for (p, q) in self.in_box(a, b) {
            if let Some(x) = segment_crossing(p, q, a, b) {
                let (dx, dy) = (x.0 - b.0 as f64, x.1 - b.1 as f64);
                let d = dx * dx + dy * dy;
                if best.is_none_or(|(e, _)| d < e) {
                    best = Some((d, x));
                }
            }
        }
        let (d, x) = best?;
        (d < within as f64 * within as f64).then(|| (x.0.round() as i64, x.1.round() as i64))
    }

    /// Whether `q` is inside the outline or on it (Orca's `contains(polygons, p, true)`: Clipper's point in polygon,
    /// even-odd over the rings).
    fn inside(&self, q: P) -> bool {
        if self.edges.is_empty() {
            return false;
        }
        let cy = (q.1 - self.y0).div_euclid(self.cell);
        if cy < 0 || cy >= self.ny {
            return false;
        }
        let mut odd = false;
        for &id in &self.rows[cy as usize] {
            let (ip, next) = self.edges[id as usize];
            if ip.0.max(next.0) < q.0 {
                continue;
            }
            if next.1 == q.1 && (next.0 == q.0 || (ip.1 == q.1 && ((next.0 > q.0) == (ip.0 < q.0)))) {
                return true;
            }
            if (ip.1 < q.1) != (next.1 < q.1) {
                let side = || (ip.0 - q.0) as f64 * (next.1 - q.1) as f64 - (next.0 - q.0) as f64 * (ip.1 - q.1) as f64;
                if ip.0 >= q.0 {
                    if next.0 > q.0 {
                        odd = !odd;
                    } else {
                        let d = side();
                        if d == 0.0 {
                            return true;
                        }
                        if (d > 0.0) == (next.1 > ip.1) {
                            odd = !odd;
                        }
                    }
                } else if next.0 > q.0 {
                    let d = side();
                    if d == 0.0 {
                        return true;
                    }
                    if (d > 0.0) == (next.1 > ip.1) {
                        odd = !odd;
                    }
                }
            }
        }
        odd
    }
}

fn cross(a: P, b: P) -> i128 {
    a.0 as i128 * b.1 as i128 - a.1 as i128 * b.0 as i128
}

/// Orca's `Geometry::segments_intersect`: whether two segments meet, a touch included unless both only touch at
/// their ends.
fn segments_intersect(ip1: P, ip2: P, jp1: P, jp2: P) -> bool {
    let signs = |a: P, b: P, c: P, d: P| {
        let v = sub(b, a);
        (cross(v, sub(c, a)).signum() as i32, cross(v, sub(d, a)).signum() as i32)
    };
    let (s1, s2) = (signs(ip1, ip2, jp1, jp2), signs(jp1, jp2, ip1, ip2));
    let (t1, t2) = (s1.0 * s1.1, s2.0 * s2.1);
    if t1 > 0 || t2 > 0 {
        return false;
    }
    if t1 != 0 || t2 != 0 {
        return true;
    }
    if s1 != (0, 0) {
        return false;
    }
    // On one line: whether they overlap along it.
    let v = sub(ip2, ip1);
    let along = |p: P| if v.0.abs() > v.1.abs() { p.0 } else { p.1 };
    let (i, j) = (along(ip1).min(along(ip2)), along(ip1).max(along(ip2)));
    let (k, l) = (along(jp1).min(along(jp2)), along(jp1).max(along(jp2)));
    (k >= i && k <= j) || (i >= k && i <= l)
}

/// Where the segments p–q and a–b cross, if they do.
fn segment_crossing(p: P, q: P, a: P, b: P) -> Option<(f64, f64)> {
    let r = ((q.0 - p.0) as f64, (q.1 - p.1) as f64);
    let w = ((b.0 - a.0) as f64, (b.1 - a.1) as f64);
    let denom = r.0 * w.1 - r.1 * w.0;
    if denom == 0.0 {
        return None;
    }
    let ap = ((a.0 - p.0) as f64, (a.1 - p.1) as f64);
    let t = (ap.0 * w.1 - ap.1 * w.0) / denom;
    let s = (ap.0 * r.1 - ap.1 * r.0) / denom;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&s)).then_some((p.0 as f64 + t * r.0, p.1 as f64 + t * r.1))
}

// ---- The trees (TreeNode.cpp, Layer.cpp) ----

/// A tree node (Orca's `Node`): where it is, its parent and children, whether it is a root, and for a root the
/// point it last stood on a wall.
#[derive(Clone, Debug)]
struct Node {
    p: P,
    parent: usize,
    children: Vec<usize>,
    root: bool,
    grounding: Option<P>,
}

/// Tree nodes by 4 mm cell from the outline's corner (Orca's `SparseNodeGrid`, whose cells give their newest node
/// first).
struct Locator {
    min: P,
    cells: HashMap<(i64, i64), Vec<usize>>,
}

impl Locator {
    fn new(outline: &Outline) -> Locator {
        let min = outline.bbox.map_or((0, 0), |b| (b[0], b[1]));
        Locator { min, cells: HashMap::new() }
    }

    fn key(&self, p: P) -> (i64, i64) {
        ((p.0 - self.min.0) / LOCATOR_CELL, (p.1 - self.min.1) / LOCATOR_CELL)
    }

    fn insert(&mut self, p: P, node: usize) {
        self.cells.entry(self.key(p)).or_default().push(node);
    }
}

/// Where an unsupported point is joined: a tree's node, or a point on the wall.
enum Ground {
    Tree(usize),
    Wall(P),
}

/// One layer's trees: every node made for them (some no longer in a tree), and the roots.
#[derive(Default)]
struct Forest {
    nodes: Vec<Node>,
    roots: Vec<usize>,
}

impl Forest {
    fn node(&mut self, p: P, grounding: Option<P>) -> usize {
        self.nodes.push(Node { p, parent: NONE, children: Vec::new(), root: true, grounding });
        self.nodes.len() - 1
    }

    fn add_child(&mut self, parent: usize, child: usize) {
        self.nodes[parent].children.push(child);
        self.nodes[child].parent = parent;
        self.nodes[child].root = false;
    }

    fn add_child_at(&mut self, parent: usize, p: P) -> usize {
        let child = self.node(p, None);
        self.add_child(parent, child);
        child
    }

    /// The nodes of the tree under `n`, `n` first, depth first.
    fn subtree(&self, n: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut stack = vec![n];
        while let Some(m) = stack.pop() {
            out.push(m);
            stack.extend(self.nodes[m].children.iter().rev());
        }
        out
    }

    fn locator(&self, outline: &Outline) -> Locator {
        let mut locator = Locator::new(outline);
        for &r in &self.roots {
            for n in self.subtree(r) {
                locator.insert(self.nodes[n].p, n);
            }
        }
        locator
    }

    /// Orca's `Node::getWeightedDistance`: a node with one to three branches counts as four supporting radii nearer.
    fn weighted_distance(&self, n: usize, u: P, radius: i64) -> i64 {
        let node = &self.nodes[n];
        let valence = usize::from(!node.root) + node.children.len();
        let boost = if valence > 0 && valence < 4 { 4 * radius } else { 0 };
        length(sub(node.p, u)) - boost
    }

    /// Orca's `getBestGroundingLocation`: the nearest point of the wall, unless `u` is far enough from it and a tree
    /// node (not one of `excluded`) is nearer by its weighted distance, with no wall in the way.
    fn best_grounding(
        &self,
        u: P,
        outline: &Outline,
        radius: i64,
        wall_radius: i64,
        locator: &Locator,
        excluded: &[bool],
    ) -> Ground {
        let wall = outline.closest(u);
        let mut best_dist = length(sub(wall, u));
        let mut best = NONE;
        if best_dist >= wall_radius {
            let r = best_dist;
            let lo = locator.key((u.0 - r, u.1 - r));
            let hi = locator.key((u.0 + r + LOCATOR_CELL, u.1 + r + LOCATOR_CELL));
            for gy in lo.1..hi.1 {
                for gx in lo.0..hi.0 {
                    let Some(cell) = locator.cells.get(&(gx, gy)) else { continue };
                    for &n in cell.iter().rev() {
                        if excluded.get(n).copied().unwrap_or(false) {
                            continue;
                        }
                        let d = self.weighted_distance(n, u, radius);
                        if d < best_dist && !outline.crosses(u, self.nodes[n].p) {
                            best_dist = d;
                            best = n;
                        }
                    }
                }
            }
        }
        if best == NONE { Ground::Wall(wall) } else { Ground::Tree(best) }
    }

    /// Orca's `generateNewTrees`: joins each point of the field still unsupported to the nearest tree or wall.
    fn grow_new(&mut self, field: &mut Field, outline: &Outline, radius: i64, wall_radius: i64) {
        let mut locator = self.locator(outline);
        let mut at = 0;
        while let Some(i) = field.next(at) {
            at = i;
            let u = field.points[i].0;
            match self.best_grounding(u, outline, radius, wall_radius, &locator, &[]) {
                Ground::Wall(w) => {
                    let root = self.node(w, Some(w));
                    let child = self.add_child_at(root, u);
                    self.roots.push(root);
                    locator.insert(u, child);
                    locator.insert(w, root);
                }
                Ground::Tree(t) => {
                    let child = self.add_child_at(t, u);
                    locator.insert(u, child);
                }
            }
            field.update(u, radius);
            // The point itself, whatever the grid holds (Orca's loop would never end without it).
            field.supported[i] = true;
        }
    }

    /// Orca's `Node::reroot`: makes `n` its tree's root (or, given a new parent, its child), turning the path to the
    /// old root around.
    fn reroot(&mut self, n: usize, new_parent: usize) {
        if !self.nodes[n].root {
            let old_parent = self.nodes[n].parent;
            self.reroot(old_parent, n);
            self.nodes[n].children.push(old_parent);
        }
        if new_parent != NONE {
            self.nodes[n].children.retain(|&c| c != new_parent);
            self.nodes[n].root = false;
            self.nodes[n].parent = new_parent;
        } else {
            self.nodes[n].root = true;
            self.nodes[n].parent = NONE;
        }
    }

    /// Orca's `Node::closestNode`: the node of the tree under `n` nearest `loc`, the first found of equally near ones.
    fn closest_node(&self, n: usize, loc: P) -> usize {
        let mut result = n;
        let mut best = length(sub(self.nodes[n].p, loc));
        for &c in &self.nodes[n].children {
            let candidate = self.closest_node(c, loc);
            let d = length(sub(self.nodes[candidate].p, loc));
            if d < best {
                best = d;
                result = candidate;
            }
        }
        result
    }

    /// Orca's `reconnectRoots`: joins each tree carried down from the layer above to the wall it stood on, to the
    /// nearest wall, or into another tree.
    fn reconnect(&mut self, carried: &[usize], outline: &Outline, radius: i64, wall_radius: i64) {
        if carried.is_empty() {
            return;
        }
        let mut locator = self.locator(outline);
        let within = 2 * LOCATOR_CELL;
        for &root in carried {
            let Some(at) = self.roots.iter().position(|&r| r == root) else { continue };
            let p = self.nodes[root].p;
            if let Some(ground) = self.nodes[root].grounding
                && ground != p
                && let Some(q) = outline.crossing_near(p, ground, within)
            {
                let new_root = self.node(q, Some(q));
                self.add_child(root, new_root);
                self.reroot(new_root, NONE);
                locator.insert(q, new_root);
                self.roots[at] = new_root;
                continue;
            }
            let mut excluded = vec![false; self.nodes.len()];
            for n in self.subtree(root) {
                excluded[n] = true;
            }
            match self.best_grounding(p, outline, radius, wall_radius - CONNECTING_IGNORE_OFFSET, &locator, &excluded) {
                Ground::Wall(w) => {
                    if w == p {
                        continue;
                    }
                    let new_root = self.node(w, Some(w));
                    let attach = self.closest_node(root, w);
                    self.reroot(attach, NONE);
                    self.add_child(new_root, attach);
                    locator.insert(w, new_root);
                    self.roots[at] = new_root;
                }
                Ground::Tree(t) => {
                    let attach = self.closest_node(root, self.nodes[t].p);
                    self.reroot(attach, NONE);
                    self.add_child(t, attach);
                    self.roots.swap_remove(at);
                }
            }
        }
    }

    /// Orca's `Node::deepCopy`, into another forest: a root keeps where it last stood on a wall, or where it is.
    fn copy_into(&self, n: usize, to: &mut Forest) -> usize {
        let node = &self.nodes[n];
        let copy = to.node(node.p, None);
        to.nodes[copy].root = node.root;
        if node.root {
            to.nodes[copy].grounding = Some(node.grounding.unwrap_or(node.p));
        }
        for &c in &node.children {
            let child = self.copy_into(c, to);
            to.nodes[child].parent = copy;
            to.nodes[copy].children.push(child);
        }
        copy
    }

    /// Orca's `Node::prune`: cuts the tips back by `distance` along the branches; the length cut off below `n`.
    fn prune(&mut self, n: usize, distance: i64) -> i64 {
        if distance <= 0 {
            return 0;
        }
        let mut most = 0;
        let mut k = 0;
        while k < self.nodes[n].children.len() {
            let child = self.nodes[n].children[k];
            let cut = self.prune(child, distance);
            if cut >= distance {
                most = most.max(cut);
                k += 1;
                continue;
            }
            let (a, b) = (self.nodes[n].p, self.nodes[child].p);
            let ba = sub(a, b);
            let ab_len = length(ba);
            if cut + ab_len <= distance {
                most = most.max(cut + ab_len);
                self.nodes[n].children.remove(k);
            } else {
                let step = towards(ba, (distance - cut) as f64);
                most = most.max(distance);
                self.nodes[child].p = (b.0 + step.0, b.1 + step.1);
                k += 1;
            }
        }
        most
    }

    /// Orca's `Node::straighten`, from the root `n`.
    fn straighten(&mut self, n: usize, magnitude: i64, max_remove_colinear: i64) {
        let p = self.nodes[n].p;
        self.straighten_from(n, magnitude, p, 0, max_remove_colinear * max_remove_colinear);
    }

    /// Moves `n` towards the line between the junctions above and below it (a junction a little along its
    /// branches), and drops it where it lies on the line between its neighbours; the distance along the tree from
    /// the junction above to the next one below, and where that is.
    fn straighten_from(&mut self, n: usize, magnitude: i64, above: P, accumulated: i64, max2: i64) -> (i64, P) {
        let junction_magnitude = magnitude * 3 / 4;
        if self.nodes[n].children.len() == 1 {
            let child = self.nodes[n].children[0];
            let child_dist = length(sub(self.nodes[n].p, self.nodes[child].p));
            let below = self.straighten_from(child, magnitude, above, accumulated + child_dist, max2);
            let (a, b) = (above, below.1);
            if a != b {
                let ab = sub(b, a);
                let total = below.0.max(1);
                let destination = (a.0 + ab.0 * accumulated / total, a.1 + ab.1 * accumulated / total);
                let m = self.nodes[n].p;
                let d = sub(destination, m);
                self.nodes[n].p =
                    if d.0 as i128 * d.0 as i128 + d.1 as i128 * d.1 as i128 <= magnitude as i128 * magnitude as i128 {
                        destination
                    } else {
                        let step = towards(d, magnitude as f64);
                        (m.0 + step.0, m.1 + step.1)
                    };
            }
            // Drop the node where it lies on the line between its neighbours.
            let child = self.nodes[n].children[0];
            let parent = self.nodes[n].parent;
            if parent != NONE {
                let (pp, cp, me) = (self.nodes[parent].p, self.nodes[child].p, self.nodes[n].p);
                let span = sub(cp, pp);
                if (span.0 as i128 * span.0 as i128 + span.1 as i128 * span.1 as i128) < max2 as i128
                    && closest_on_segment(pp, cp, me).0 < (CLOSE_ENOUGH * CLOSE_ENOUGH) as f64
                {
                    self.nodes[child].parent = parent;
                    if let Some(slot) = self.nodes[parent].children.iter_mut().find(|c| **c == n) {
                        *slot = child;
                    }
                }
            }
            return below;
        }
        const WEIGHT: f64 = 1000.0;
        let m = self.nodes[n].p;
        let mut moving = towards(sub(above, m), WEIGHT);
        let mut hold = false;
        let children = self.nodes[n].children.clone();
        for &c in &children {
            let child_dist = length(sub(m, self.nodes[c].p));
            let below = self.straighten_from(c, magnitude, m, child_dist, max2);
            let step = towards(sub(below.1, m), WEIGHT);
            moving = (moving.0 + step.0, moving.1 + step.1);
            // A short branch would flip back and forth between straightening and the junction moving.
            if below.0 < magnitude {
                hold = true;
            }
        }
        if moving != (0, 0) && !children.is_empty() && !self.nodes[n].root && !hold {
            let len = (((moving.0 * moving.0 + moving.1 * moving.1) as f64).sqrt()) as i64;
            if len > junction_magnitude {
                moving = (moving.0 * junction_magnitude / len, moving.1 * junction_magnitude / len);
            }
            self.nodes[n].p = (m.0 + moving.0, m.1 + moving.1);
        }
        (accumulated, self.nodes[n].p)
    }

    /// Orca's `Node::realign`: keeps the part of the tree under `n` inside the outline, cutting off a branch that
    /// crosses it near its node, and lifts out as new trees the parts below a node outside; whether `n` stays.
    fn realign(&mut self, n: usize, outline: &Outline, rerooted: &mut Vec<usize>) -> bool {
        if outline.is_empty() {
            return false;
        }
        let children = std::mem::take(&mut self.nodes[n].children);
        if outline.inside(self.nodes[n].p) {
            let mut kept = Vec::with_capacity(children.len());
            let mut reground = false;
            for c in children {
                let connected = self.realign(c, outline, rerooted);
                if connected && outline.crossing_near(self.nodes[c].p, self.nodes[n].p, 2 * LOCATOR_CELL).is_some() {
                    let child = &mut self.nodes[c];
                    child.grounding = None;
                    child.parent = NONE;
                    child.root = true;
                    rerooted.push(c);
                    reground = true;
                } else if connected {
                    kept.push(c);
                }
            }
            self.nodes[n].children = kept;
            if reground {
                self.nodes[n].grounding = None;
            }
            return true;
        }
        let p = self.nodes[n].p;
        for c in children {
            if self.realign(c, outline, rerooted) {
                let child = &mut self.nodes[c];
                child.grounding = Some(p);
                child.parent = NONE;
                child.root = true;
                rerooted.push(c);
            }
        }
        false
    }

    /// Orca's `propagateToNextLayer` for every tree: each copied, pruned, straightened and fitted to the outline
    /// below.
    fn propagate(&self, below: &Outline, prune: i64, straighten: i64, max_remove_colinear: i64) -> Forest {
        let mut next = Forest::default();
        for &r in &self.roots {
            let copy = self.copy_into(r, &mut next);
            next.prune(copy, prune);
            next.straighten(copy, straighten, max_remove_colinear);
            let mut rerooted = Vec::new();
            if next.realign(copy, below, &mut rerooted) {
                rerooted.push(copy);
            }
            next.roots.extend(rerooted);
        }
        next
    }

    /// Orca's `convertToLines` before clipping: each tree as lines from a tip towards the root, one branch going on
    /// through each junction (picked by a generator seeded with the root's position), the others ending there `gap`
    /// short of it.
    fn lines(&self, gap: i64) -> Vec<Vec<P>> {
        let mut out = Vec::new();
        for &r in &self.roots {
            let mut lines: Vec<Vec<P>> = vec![Vec::new()];
            let mut rng = Mt64::new(point_hash(self.nodes[r].p));
            self.lines_from(r, 0, &mut lines, &mut rng);
            stop_short(&mut lines, gap);
            out.extend(lines);
        }
        out
    }

    fn lines_from(&self, n: usize, line: usize, out: &mut Vec<Vec<P>>, rng: &mut Mt64) {
        let node = &self.nodes[n];
        let k = node.children.len();
        if k == 0 {
            out[line].push(node.p);
            return;
        }
        let first = (rng.next() % k as u64) as usize;
        self.lines_from(node.children[first], line, out, rng);
        out[line].push(node.p);
        for offset in 1..k {
            let child = node.children[(first + offset) % k];
            out.push(Vec::new());
            let branch = out.len() - 1;
            self.lines_from(child, branch, out, rng);
            out[branch].push(node.p);
        }
    }
}

/// Orca's `removeJunctionOverlap`: shortens each line at its end by `gap`, dropping those left without length.
fn stop_short(lines: &mut Vec<Vec<P>>, gap: i64) {
    let mut i = 0;
    while i < lines.len() {
        if lines[i].len() <= 1 {
            lines.swap_remove(i);
            continue;
        }
        let line = &mut lines[i];
        let mut left = gap;
        let mut a = line[line.len() - 1];
        for k in (0..line.len() - 1).rev() {
            let b = line[k];
            let ab = sub(b, a);
            let ab_len = length(ab);
            if ab_len >= left {
                if left > 0 {
                    let f = left as f64 / ab_len as f64;
                    let end = line.len() - 1;
                    line[end] = (a.0 + (ab.0 as f64 * f) as i64, a.1 + (ab.1 as f64 * f) as i64);
                }
                break;
            }
            left -= ab_len;
            line.pop();
            a = b;
        }
        if lines[i].len() <= 1 {
            lines.swap_remove(i);
        } else {
            i += 1;
        }
    }
}

/// `std::mt19937_64`, which Orca picks the branch that goes on through a junction with.
struct Mt64 {
    state: [u64; 312],
    at: usize,
}

impl Mt64 {
    fn new(seed: u64) -> Mt64 {
        let mut state = [0u64; 312];
        state[0] = seed;
        for i in 1..312 {
            state[i] =
                6_364_136_223_846_793_005u64.wrapping_mul(state[i - 1] ^ (state[i - 1] >> 62)).wrapping_add(i as u64);
        }
        Mt64 { state, at: 312 }
    }

    fn next(&mut self) -> u64 {
        if self.at >= 312 {
            for i in 0..312 {
                let x = (self.state[i] & 0xFFFF_FFFF_8000_0000) | (self.state[(i + 1) % 312] & 0x7FFF_FFFF);
                let mut xa = x >> 1;
                if x & 1 != 0 {
                    xa ^= 0xB502_6F5A_A966_19E9;
                }
                self.state[i] = self.state[(i + 156) % 312] ^ xa;
            }
            self.at = 0;
        }
        let mut x = self.state[self.at];
        self.at += 1;
        x ^= (x >> 29) & 0x5555_5555_5555_5555;
        x ^= (x << 17) & 0x71D6_7FFF_EDA6_0000;
        x ^= (x << 37) & 0xFFF7_EEE0_0000_0000;
        x ^ (x >> 43)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, size: f64) -> Shapes {
        let s = |v: f64| geom::sc(v);
        vec![vec![vec![
            geom::pt(s(x0), s(y0)),
            geom::pt(s(x0 + size), s(y0)),
            geom::pt(s(x0 + size), s(y0 + size)),
            geom::pt(s(x0), s(y0 + size)),
        ]]]
    }

    fn params() -> Params {
        Params {
            line_width: 0.45,
            density_percent: 10.0,
            layer_height: 0.2,
            overhang_angle: 45.0,
            prune_angle: 45.0,
            straightening_angle: 45.0,
            junction_gap: 0.2035,
        }
    }

    fn mm(lines: &[Vec<Pt>]) -> f64 {
        lines.iter().map(|l| geom::length_mm(l, false)).sum()
    }

    #[test]
    fn mt19937_64_gives_the_standard_sequence() {
        let mut rng = Mt64::new(5489);
        let mut last = 0;
        for _ in 0..10_000 {
            last = rng.next();
        }
        assert_eq!(last, 9_981_545_732_273_789_042);
    }

    #[test]
    fn the_gnu_stable_sort_sorts_and_keeps_equal_ones_in_order() {
        let mut seed = 7u64;
        for len in [0usize, 1, 2, 3, 6, 7, 8, 13, 14, 15, 50, 99, 100, 257] {
            let mut v: Vec<(i64, usize)> = (0..len)
                .map(|i| {
                    seed = seed.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
                    (((seed >> 33) % 10) as i64, i)
                })
                .collect();
            let mut want = v.clone();
            want.sort_by_key(|e| e.0);
            stable_sort_gnu(&mut v, &|a: &(i64, usize), b: &(i64, usize)| a.0 < b.0);
            assert_eq!(v, want, "{len} elements");
        }
    }

    #[test]
    fn samples_lie_on_the_grid_inside_the_shape() {
        let ring: Vec<P> = vec![(0, 0), (10_000_000, 0), (10_000_000, 4_000_000), (0, 4_000_000)];
        let points = sample_grid(&[ring], 1_000_000, [0, 0, 10_000_000, 4_000_000]);
        // Lines at x = 0 … 9 mm; the line on the left edge too, points strictly between the edges.
        assert_eq!(points.len(), 10 * 3);
        assert!(points.iter().all(|&(x, y)| x % 1_000_000 == 0 && y % 1_000_000 == 0 && y > 0 && y < 4_000_000));
    }

    #[test]
    fn the_outline_finds_its_nearest_point_crossings_and_inside() {
        let outer: Vec<P> = vec![(0, 0), (20_000_000, 0), (20_000_000, 20_000_000), (0, 20_000_000)];
        let hole: Vec<P> =
            vec![(8_000_000, 8_000_000), (8_000_000, 12_000_000), (12_000_000, 12_000_000), (12_000_000, 8_000_000)];
        let o = Outline::new(vec![outer, hole]);
        assert_eq!(o.closest((3_000_000, 5_000_000)), (0, 5_000_000));
        assert_eq!(o.closest((10_000_000, 7_000_000)), (10_000_000, 8_000_000));
        assert!(o.inside((1_000_000, 1_000_000)));
        assert!(!o.inside((10_000_000, 10_000_000)));
        assert!(o.inside((0, 7_000_000)), "on the edge counts as inside");
        assert!(!o.inside((-1, 7_000_000)));
        assert!(o.crosses((5_000_000, 10_000_000), (15_000_000, 10_000_000)));
        assert!(!o.crosses((2_000_000, 2_000_000), (6_000_000, 2_000_000)));
        assert_eq!(
            o.crossing_near((5_000_000, 10_000_000), (9_000_000, 10_000_000), 8_000_000),
            Some((8_000_000, 10_000_000))
        );
        assert_eq!(o.crossing_near((5_000_000, 10_000_000), (7_000_000, 10_000_000), 8_000_000), None);
    }

    #[test]
    fn a_top_surface_gets_trees_that_shrink_away_below_it() {
        // A 20 mm box: sparse infill on 80 layers, solid above.
        let mut areas: Vec<Shapes> = (0..80).map(|_| square(0.0, 0.0, 20.0)).collect();
        areas.extend((0..5).map(|_| Vec::new()));
        let lines = grow(&areas, (100_000.0, 100_000.0), &params());
        let top = mm(&lines[79]);
        assert!(top > 20.0, "the top's trees: {top:.1} mm");
        // Every point of the top's overhang lies within the supporting radius (4.5 mm) of a branch, give or take the
        // grid the points are taken on.
        for x in (2..19).map(f64::from) {
            for y in (2..19).map(f64::from) {
                let q = geom::pt(geom::sc(x), geom::sc(y));
                let near = lines[79]
                    .iter()
                    .flat_map(|l| l.windows(2))
                    .any(|w| geom::segment_dist2(q, w[0], w[1]).sqrt() / geom::SCALE < 5.1);
                assert!(near, "({x}, {y}) is far from every branch");
            }
        }
        // Lower down the trees shrink, a fifth of a millimetre a layer at each tip, until the bottom is bare.
        let profile: Vec<f64> = [79, 70, 50, 30, 10].iter().map(|&l| mm(&lines[l])).collect();
        assert!(profile.windows(2).all(|w| w[1] < w[0]), "{profile:?}");
        assert!(lines[0].is_empty(), "{:.1} mm at the bottom", mm(&lines[0]));
        // Inside the box on every layer.
        for layer in &lines {
            for q in layer.iter().flatten() {
                assert!(q.x >= -1 && q.x <= geom::sc(20.0) + 1 && q.y >= -1 && q.y <= geom::sc(20.0) + 1);
            }
        }
    }

    #[test]
    fn trees_grow_round_a_hole_not_across_it() {
        // A 30 mm box with a 10 mm hole through it, a top over both.
        let mut with_hole = square(0.0, 0.0, 30.0);
        let hole = square(10.0, 10.0, 10.0).remove(0).remove(0);
        with_hole[0].push(hole.into_iter().rev().collect());
        let mut areas: Vec<Shapes> = (0..20).map(|_| with_hole.clone()).collect();
        areas.push(Vec::new());
        let lines = grow(&areas, (150_000.0, 150_000.0), &params());
        assert!(mm(&lines[19]) > 30.0);
        let inside_hole =
            |q: &Pt| q.x > geom::sc(10.05) && q.x < geom::sc(19.95) && q.y > geom::sc(10.05) && q.y < geom::sc(19.95);
        for layer in &lines {
            assert!(!layer.iter().flatten().any(inside_hole), "a node in the hole");
        }
    }
}
