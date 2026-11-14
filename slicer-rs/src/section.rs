//! Cutting meshes into layers. Every triangle is put in the buckets of the layers whose plane crosses it (one pass,
//! no per-layer search), then each layer, on its own thread, cuts its triangles into segments, chains them into
//! loops by the mesh edge each segment starts and ends on (so loops close exactly, whatever the rounding), joins
//! what a broken mesh leaves open, and turns the loops into clean regions (outer outlines and holes).

use crate::geom::{self, Contour, Pt, SCALE, Shapes};
use crate::mesh::{FastHasher, Mesh};
use crate::par;
use std::collections::HashMap;
use std::hash::BuildHasherDefault;

/// The layers of a print: each layer's top (`print_z`) and thickness, in mm.
#[derive(Clone, Debug)]
pub struct Layers {
    pub top: Vec<f64>,
    pub height: Vec<f64>,
    /// Where the object starts: 0 on the plate, above a raft its contact layer and the gap over it (`raft.rs`).
    pub base: f64,
}

impl Layers {
    /// Uniform layers from the first layer's height up to the model's top.
    pub fn plan(model_height: f64, first: f64, height: f64) -> Layers {
        let mut top = vec![first];
        let mut heights = vec![first];
        let mut z = first;
        while z + 1e-6 < model_height {
            z += height;
            top.push(z);
            heights.push(height);
        }
        Layers { top, height: heights, base: 0.0 }
    }

    /// Uniform layers on a raft: from `base`, every one `height` thick (the first too, as Orca's object layers on a
    /// raft are), up to the model's top.
    pub fn on_raft(model_height: f64, height: f64, base: f64) -> Layers {
        let (mut top, mut heights) = (Vec::new(), Vec::new());
        let mut z = 0.0;
        while z + 1e-6 < model_height || top.is_empty() {
            z += height;
            top.push(z + base);
            heights.push(height);
        }
        Layers { top, height: heights, base }
    }

    /// Where each layer is cut: halfway up the layer, as a float, as Orca cuts (its meshes are floats too). A face
    /// at a round height then lies exactly on a plane rather than a hair below it, and belongs to what is under it:
    /// a deck at 8.5 mm is part of the layer cut at 8.5 (the sum of the layers comes to 8.500000000000002). On a
    /// raft, the model's own heights: halfway between the layer's bottom and top above the raft, as Orca keeps them.
    pub fn slice_z(&self) -> Vec<f64> {
        if self.base == 0.0 {
            return self.top.iter().zip(&self.height).map(|(t, h)| (t - h / 2.0) as f32 as f64).collect();
        }
        let mut lo = 0.0;
        self.height
            .iter()
            .map(|h| {
                let hi = lo + h;
                let z = 0.5 * (lo + hi);
                lo = hi;
                z as f32 as f64
            })
            .collect()
    }
}

/// Every object's triangles together, with vertices in f64 for the cutting.
struct Soup<'a> {
    meshes: &'a [Mesh],
    /// The first vertex id of each mesh in the shared numbering.
    vertex_base: Vec<u32>,
}

/// Cuts the meshes at every layer's plane; returns each layer's region (outlines with holes) and for each of its
/// shapes the mesh (object) it is a slice of. Each object's outline is made on its own, as Orca slices each object
/// on its own, and as Orca makes a layer's (`make_expolygons`, then `ExPolygon::simplify`): its loops joined, gaps
/// and notches narrower than twice `closing` mm closed, then simplified to `tolerance` mm. From layer `largest_from`
/// on (a spiral vase's layers above its bottom), each object's outline is its largest loop alone, holes and all
/// filled (Orca's `PositiveLargestContour`).
pub fn slice(
    meshes: &[Mesh],
    layers: &Layers,
    tolerance: f64,
    closing: f64,
    largest_from: usize,
) -> (Vec<Shapes>, Vec<Vec<u32>>) {
    let planes = layers.slice_z();
    let n_layers = planes.len();
    let mut vertex_base = Vec::with_capacity(meshes.len());
    let mut base = 0u32;
    for m in meshes {
        vertex_base.push(base);
        base += m.vertices.len() as u32;
    }
    let soup = Soup { meshes, vertex_base };

    // Bucket the triangles by layer, in compressed rows: count, then fill.
    let ranges: Vec<Vec<(u32, u32)>> =
        meshes.iter().map(|m| m.triangles.iter().map(|t| layer_range(m, t, &planes)).collect()).collect();
    let mut counts = vec![0u32; n_layers + 1];
    for mesh_ranges in &ranges {
        for &(a, b) in mesh_ranges {
            for l in a..b {
                counts[l as usize] += 1;
            }
        }
    }
    let mut starts = vec![0usize; n_layers + 1];
    for l in 0..n_layers {
        starts[l + 1] = starts[l] + counts[l] as usize;
    }
    let mut fill = starts.clone();
    let mut items = vec![(0u32, 0u32); starts[n_layers]];
    for (mi, mesh_ranges) in ranges.iter().enumerate() {
        for (ti, &(a, b)) in mesh_ranges.iter().enumerate() {
            for l in a..b {
                items[fill[l as usize]] = (mi as u32, ti as u32);
                fill[l as usize] += 1;
            }
        }
    }
    drop(ranges);

    par::map_range(n_layers, |l| {
        let triangles = &items[starts[l]..starts[l + 1]];
        cut_layer(&soup, triangles, planes[l], tolerance, closing, l >= largest_from)
    })
    .into_iter()
    .unzip()
}

/// The layers (half-open index range) whose cutting plane crosses the triangle: below the plane means z < plane.
fn layer_range(mesh: &Mesh, t: &[u32; 3], planes: &[f64]) -> (u32, u32) {
    let z = [
        mesh.vertices[t[0] as usize][2] as f64,
        mesh.vertices[t[1] as usize][2] as f64,
        mesh.vertices[t[2] as usize][2] as f64,
    ];
    let lo = z[0].min(z[1]).min(z[2]);
    let hi = z[0].max(z[1]).max(z[2]);
    // Planes p with lo < p <= hi.
    let a = planes.partition_point(|&p| p <= lo);
    let b = planes.partition_point(|&p| p <= hi);
    (a as u32, b as u32)
}

/// One segment of a layer's cut: from the point on edge `from` to the point on edge `to`, solid on its left.
struct Segment {
    from: u64,
    to: u64,
    a: Pt,
    b: Pt,
}

type EdgeMap = HashMap<u64, u32, BuildHasherDefault<FastHasher>>;

fn cut_layer(
    soup: &Soup,
    triangles: &[(u32, u32)],
    plane: f64,
    tolerance: f64,
    closing: f64,
    largest: bool,
) -> (Shapes, Vec<u32>) {
    let mut segments: Vec<Segment> = Vec::with_capacity(triangles.len());
    for &(mi, ti) in triangles {
        let mesh = &soup.meshes[mi as usize];
        let base = soup.vertex_base[mi as usize] as u64;
        let t = mesh.triangles[ti as usize];
        let v = [mesh.vertices[t[0] as usize], mesh.vertices[t[1] as usize], mesh.vertices[t[2] as usize]];
        let below = [(v[0][2] as f64) < plane, (v[1][2] as f64) < plane, (v[2][2] as f64) < plane];
        // The two edges whose ends are on either side of the plane.
        let mut crossing: [(usize, usize); 2] = [(0, 0); 2];
        let mut n = 0;
        for (i, j) in [(0usize, 1usize), (1, 2), (2, 0)] {
            if below[i] != below[j] {
                if n < 2 {
                    crossing[n] = (i, j);
                }
                n += 1;
            }
        }
        if n != 2 {
            continue;
        }
        let mut ends = [(0u64, pt0()); 2];
        for (k, &(i, j)) in crossing.iter().enumerate() {
            // Always from the lower vertex id, so the two triangles sharing an edge compute the same point.
            let (p, q) = if t[i] < t[j] { (i, j) } else { (j, i) };
            let (vp, vq) = (v[p], v[q]);
            let (zp, zq) = (vp[2] as f64, vq[2] as f64);
            let s = (plane - zp) / (zq - zp);
            let x = vp[0] as f64 + (vq[0] as f64 - vp[0] as f64) * s;
            let y = vp[1] as f64 + (vq[1] as f64 - vp[1] as f64) * s;
            let key = ((base + t[p] as u64) << 32) | (base + t[q] as u64);
            ends[k] = (key, geom::pt((x * SCALE).round() as i32, (y * SCALE).round() as i32));
        }
        // Solid on the left: the segment runs along (-ny, nx) of the outward normal.
        let e1 = [v[1][0] as f64 - v[0][0] as f64, v[1][1] as f64 - v[0][1] as f64, v[1][2] as f64 - v[0][2] as f64];
        let e2 = [v[2][0] as f64 - v[0][0] as f64, v[2][1] as f64 - v[0][1] as f64, v[2][2] as f64 - v[0][2] as f64];
        let nx = e1[1] * e2[2] - e1[2] * e2[1];
        let ny = e1[2] * e2[0] - e1[0] * e2[2];
        let (a, b) = (ends[0], ends[1]);
        let dx = (b.1.x - a.1.x) as f64;
        let dy = (b.1.y - a.1.y) as f64;
        let forward = dx * -ny + dy * nx >= 0.0;
        let (start, end) = if forward { (a, b) } else { (b, a) };
        if start.0 == end.0 {
            continue;
        }
        segments.push(Segment { from: start.0, to: end.0, a: start.1, b: end.1 });
    }
    if segments.is_empty() {
        return (Vec::new(), Vec::new());
    }
    // The mesh a segment is cut from, by the shared vertex numbering of the edge it starts on.
    let mesh_of = |edge: u64| (soup.vertex_base.partition_point(|&b| b as u64 <= edge >> 32) - 1) as u32;

    // Chain: each segment continues with the one that starts on the edge it ends on.
    let mut by_start: EdgeMap = HashMap::with_capacity_and_hasher(segments.len() * 2, Default::default());
    for (i, s) in segments.iter().enumerate() {
        by_start.insert(s.from, i as u32);
    }
    let mut used = vec![false; segments.len()];
    // Each loop with the mesh it is cut from.
    let mut closed: Vec<(Contour, u32)> = Vec::new();
    let mut open: Vec<(Contour, u32)> = Vec::new();
    for first in 0..segments.len() {
        if used[first] {
            continue;
        }
        let mut loop_points: Contour = Vec::new();
        let mut i = first;
        let start_edge = segments[first].from;
        let closes = loop {
            used[i] = true;
            loop_points.push(segments[i].a);
            let next_edge = segments[i].to;
            if next_edge == start_edge {
                break true;
            }
            match by_start.get(&next_edge) {
                Some(&j) if !used[j as usize] => i = j as usize,
                _ => {
                    loop_points.push(segments[i].b);
                    break false;
                }
            }
        };
        let mesh = mesh_of(start_edge);
        if closes {
            if loop_points.len() >= 3 {
                closed.push((loop_points, mesh));
            }
        } else {
            open.push((loop_points, mesh));
        }
    }
    if !open.is_empty() {
        close_open_chains(open, &mut closed, (2.0 * SCALE) as i64);
    }
    let mut by_mesh: std::collections::BTreeMap<u32, Vec<Contour>> = std::collections::BTreeMap::new();
    for (contour, mesh) in closed {
        if contour.len() >= 3 {
            by_mesh.entry(mesh).or_default().push(contour);
        }
    }
    let mut shapes = Vec::new();
    let mut owners = Vec::new();
    for (mesh, mut loops) in by_mesh {
        if largest {
            // Every loop counter-clockwise, so that what a loop encloses is filled whichever way it ran.
            for contour in &mut loops {
                if geom::area2(contour) < 0 {
                    contour.reverse();
                }
            }
        }
        let mut made = geom::union_contours(&loops);
        if tolerance > 0.0 {
            // Simplified before the closing too, which then offsets a seventh of the points: Orca closes the loops as
            // they come, which comes to the same within the tolerance and took seven times longer here.
            made = geom::simplify_polygons(&made, tolerance);
        }
        if closing > 0.0 && !made.is_empty() {
            let join = geom::Join::Miter(3.0);
            made = geom::offset_c2(&geom::offset_c2(&made, closing, join), -closing, join);
            if tolerance > 0.0 {
                made = geom::simplify_polygons(&made, tolerance);
            }
        }
        if largest && made.len() > 1 {
            keep_largest(&mut made);
        }
        owners.extend(std::iter::repeat_n(mesh, made.len()));
        shapes.extend(made);
    }
    (shapes, owners)
}

/// Keeps the shape whose outer loop encloses the most (Orca's `keep_largest_contour_only`), with its holes.
pub fn keep_largest(shapes: &mut Shapes) {
    let area = |shape: &geom::Shape| shape.first().map_or(0, |c| geom::area2(c));
    if let Some(k) = (0..shapes.len()).reduce(|best, k| if area(&shapes[k]) > area(&shapes[best]) { k } else { best }) {
        let kept = shapes.swap_remove(k);
        shapes.clear();
        shapes.push(kept);
    }
}

#[inline]
fn pt0() -> Pt {
    geom::pt(0, 0)
}

/// A mesh with holes or broken edges leaves chains that don't close: join each chain's end to the nearest start
/// (within `max_gap`), and keep the loops that close. What can't be closed is dropped.
fn close_open_chains(mut open: Vec<(Contour, u32)>, closed: &mut Vec<(Contour, u32)>, max_gap: i64) {
    let max2 = d2_of(max_gap.unsigned_abs(), 0);
    // Each chain's start by the cell it lies in, of a grid as wide as the largest gap: the starts within reach of a
    // point lie in its cell and the eight round it. (A plate's objects are cut together, and a broken mesh can leave
    // hundreds of chains on a layer: looking at every start for every end took most of the plate's slicing.)
    let cell = max_gap.max(1);
    let cell_of = |p: Pt| (i64::from(p.x).div_euclid(cell), i64::from(p.y).div_euclid(cell));
    let mut starts: HashMap<(i64, i64), Vec<u32>, BuildHasherDefault<FastHasher>> = HashMap::default();
    for (j, (chain, _)) in open.iter().enumerate() {
        if let Some(&p) = chain.first() {
            starts.entry(cell_of(p)).or_default().push(j as u32);
        }
    }
    let mut done = vec![false; open.len()];
    for first in 0..open.len() {
        if done[first] {
            continue;
        }
        done[first] = true;
        let mesh = open[first].1;
        let mut chain = std::mem::take(&mut open[first].0);
        while let (Some(&end), Some(&head)) = (chain.last(), chain.first()) {
            // The nearest start within reach, the first chain of those as near; close the chain on itself when its
            // own start is nearer.
            let mut best: Option<(usize, u128)> = None;
            let (cx, cy) = cell_of(end);
            for at in [-1, 0, 1].into_iter().flat_map(|dx| [-1, 0, 1].map(|dy| (cx + dx, cy + dy))) {
                for &j in starts.get(&at).map_or(&[][..], Vec::as_slice) {
                    let (j, other) = (j as usize, &open[j as usize].0);
                    if done[j] || other.is_empty() {
                        continue;
                    }
                    let d = d2(end, other[0]);
                    if d <= max2 && best.is_none_or(|(bj, bd)| d < bd || (d == bd && j < bj)) {
                        best = Some((j, d));
                    }
                }
            }
            let self_d = d2(end, head);
            match best {
                Some((j, d)) if d < self_d => {
                    done[j] = true;
                    let next = std::mem::take(&mut open[j].0);
                    chain.extend(next);
                }
                _ => {
                    if self_d <= max2 && chain.len() >= 3 {
                        closed.push((chain, mesh));
                    }
                    break;
                }
            }
        }
    }
}

/// The square of the distance from `a` to `b`, exactly.
#[inline]
fn d2(a: Pt, b: Pt) -> u128 {
    d2_of((i64::from(a.x) - i64::from(b.x)).unsigned_abs(), (i64::from(a.y) - i64::from(b.y)).unsigned_abs())
}

/// `dx² + dy²` for sides under 2³² each: their squares in 64 bits, which WebAssembly multiplies itself, rather than
/// in 128 bits, a call into software for each.
#[inline]
fn d2_of(dx: u64, dy: u64) -> u128 {
    u128::from(dx * dx) + u128::from(dy * dy)
}
