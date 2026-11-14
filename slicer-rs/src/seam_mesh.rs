//! How visible each part of an object's surface is, as Orca's seam placer measures it (`compute_global_occlusion` in
//! `GCode/SeamPlacer.cpp`): the mesh is cut down to 16,000 triangles by collapsing its shortest edges
//! (`its_short_edge_collpase`), 30,000 points are sampled on it at random, evenly by area
//! (`sample_its_uniform_parallel`), and from each, 25 rays leave over the half of space its triangle faces; each that
//! meets the model's outside first takes a 25th off the point's visibility (`raycast_visibility`). A point near the
//! surface takes the visibility of the samples round it, weighted by how near (`calculate_point_visibility`).
//!
//! Orca's random numbers come from libstdc++, which native Orca links: a 64-bit Mersenne twister seeded 27644437, its
//! `generate_canonical`, `uniform_int_distribution` and `std::shuffle`, made here as libstdc++ makes them.

use crate::mesh::Mesh;

/// Orca's `raycasting_visibility_samples_count`.
const SAMPLES: usize = 30_000;
/// Orca's `fast_decimation_triangle_count_target`.
const TRIANGLES: usize = 16_000;
/// Orca's `sqr_rays_per_sample_point`: 5 × 5 rays from each sample.
const RAYS: usize = 5;
/// The seed of both of Orca's generators here.
const SEED: u64 = 27_644_437;

/// `std::mt19937_64`.
pub struct Mt64 {
    mt: Box<[u64; 312]>,
    i: usize,
}

impl Mt64 {
    pub fn new(seed: u64) -> Mt64 {
        let mut mt = Box::new([0u64; 312]);
        mt[0] = seed;
        for i in 1..312 {
            mt[i] = 6_364_136_223_846_793_005u64.wrapping_mul(mt[i - 1] ^ (mt[i - 1] >> 62)).wrapping_add(i as u64);
        }
        Mt64 { mt, i: 312 }
    }

    pub fn next_u64(&mut self) -> u64 {
        if self.i >= 312 {
            const UPPER: u64 = 0xFFFF_FFFF_8000_0000;
            const LOWER: u64 = 0x7FFF_FFFF;
            for k in 0..312 {
                let y = (self.mt[k] & UPPER) | (self.mt[(k + 1) % 312] & LOWER);
                let mut v = self.mt[(k + 156) % 312] ^ (y >> 1);
                if y & 1 != 0 {
                    v ^= 0xB502_6F5A_A966_19E9;
                }
                self.mt[k] = v;
            }
            self.i = 0;
        }
        let mut y = self.mt[self.i];
        self.i += 1;
        y ^= (y >> 29) & 0x5555_5555_5555_5555;
        y ^= (y << 17) & 0x71D6_7FFF_EDA6_0000;
        y ^= (y << 37) & 0xFFF7_EEE0_0000_0000;
        y ^ (y >> 43)
    }

    /// libstdc++'s `generate_canonical<double, 53>`, so `uniform_real_distribution<double>` over [0, 1).
    pub fn canonical(&mut self) -> f64 {
        let r = self.next_u64() as f64 / 18_446_744_073_709_551_616.0;
        if r >= 1.0 { 1.0 - f64::EPSILON / 2.0 } else { r }
    }

    /// libstdc++'s `uniform_int_distribution<uint64_t>{0, n - 1}`: Lemire's nearly divisionless method.
    fn below(&mut self, n: u64) -> u64 {
        let mut product = u128::from(self.next_u64()) * u128::from(n);
        let mut low = product as u64;
        if low < n {
            let threshold = n.wrapping_neg() % n;
            while low < threshold {
                product = u128::from(self.next_u64()) * u128::from(n);
                low = product as u64;
            }
        }
        (product >> 64) as u64
    }

    /// libstdc++'s `std::shuffle`: two swaps from each number drawn, the first alone when there is an even count.
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        let n = v.len() as u64;
        if n == 0 {
            return;
        }
        if u64::MAX / n >= n {
            let mut i = 1usize;
            if n.is_multiple_of(2) {
                let j = self.below(2) as usize;
                v.swap(i, j);
                i += 1;
            }
            while i < v.len() {
                let range = i as u64 + 1;
                let x = self.below(range * (range + 1));
                v.swap(i, (x / (range + 1)) as usize);
                v.swap(i + 1, (x % (range + 1)) as usize);
                i += 2;
            }
        } else {
            for i in 1..v.len() {
                let j = self.below(i as u64 + 1) as usize;
                v.swap(i, j);
            }
        }
    }
}

type V3 = [f32; 3];

fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn scale(a: V3, k: f32) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn dot(a: V3, b: V3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn norm(a: V3) -> f32 {
    dot(a, a).sqrt()
}

/// Eigen's `normalized()`: unchanged when it has no length.
fn normalized(a: V3) -> V3 {
    let n2 = dot(a, a);
    if n2 > 0.0 {
        let n = n2.sqrt();
        [a[0] / n, a[1] / n, a[2] / n]
    } else {
        a
    }
}

/// A triangle's unit normal as Orca's `its_face_normal` takes it: (b − a) × (c − b), normalised twice
/// (`face_normal_normalized` normalises `face_normal`'s unit vector again).
fn face_normal(v: &[V3], t: [u32; 3]) -> V3 {
    let (a, b, c) = (v[t[0] as usize], v[t[1] as usize], v[t[2] as usize]);
    normalized(normalized(cross(sub(b, a), sub(c, b))))
}

/// Each triangle's neighbour across each of its edges (the edge from its corner k to the next), −1 where there is
/// none: Orca's `create_face_neighbors_index`, the first later triangle with the edge the other way round.
fn neighbours(n_vertices: usize, indices: &[[u32; 3]]) -> Vec<[i32; 3]> {
    // The triangles round each vertex, in order (Orca's `VertexFaceIndex`): those of vertex v are
    // `around[start[v]..start[v + 1]]`.
    let mut start = vec![0u32; n_vertices + 1];
    for t in indices {
        for &v in t {
            start[v as usize + 1] += 1;
        }
    }
    for v in 0..n_vertices {
        start[v + 1] += start[v];
    }
    let mut fill = start.clone();
    let mut around = vec![0u32; indices.len() * 3];
    for (f, t) in indices.iter().enumerate() {
        for &v in t {
            around[fill[v as usize] as usize] = f as u32;
            fill[v as usize] += 1;
        }
    }
    let mut out = vec![[-1i32; 3]; indices.len()];
    for (index, t) in indices.iter().enumerate() {
        for e in 0..3 {
            if out[index][e] != -1 {
                continue;
            }
            let (a, b) = (t[e], t[(e + 1) % 3]);
            for &other in &around[start[a as usize] as usize..start[a as usize + 1] as usize] {
                let other = other as usize;
                if other <= index {
                    continue;
                }
                let o = indices[other];
                let Some(k) = o.iter().position(|&v| v == b) else { continue };
                // The edge the other way round, and not yet taken by a third triangle.
                if o[(k + 1) % 3] != a || out[other][k] != -1 {
                    continue;
                }
                out[index][e] = other as i32;
                out[other][k] = index as i32;
                break;
            }
        }
    }
    out
}

/// Orca's `its_short_edge_collpase`: edges collapse, shortest allowed first and their faces in Orca's shuffled
/// order, until no more than `target` triangles are left; a collapse keeps the vertex whose faces turn away from
/// its normal the most (it shapes the model more).
fn collapse_short_edges(vertices: &[V3], indices: &[[u32; 3]], target: usize) -> (Vec<V3>, Vec<[u32; 3]>) {
    let mut mapping: Vec<usize> = (0..vertices.len()).collect();
    let final_index = |mapping: &mut Vec<usize>, start: usize| {
        let mut idx = start;
        while mapping[idx] != idx {
            idx = mapping[idx];
        }
        let mut k = start;
        while mapping[k] != k {
            let next = mapping[k];
            mapping[k] = idx;
            k = next;
        }
        idx
    };
    let mut removed = vec![false; indices.len()];
    let mut neighbours = neighbours(vertices.len(), indices);
    // NormalUtils' Nelson-Max weighted vertex normals, divided by the weights (not made unit length).
    let mut min_dot = vec![1.0f32; vertices.len()];
    {
        let face_normals: Vec<V3> = indices.iter().map(|&t| face_normal(vertices, t)).collect();
        let mut normals = vec![[0.0f32; 3]; vertices.len()];
        let mut weights = vec![0.0f32; vertices.len()];
        for t in indices {
            let (v0, v1, v2) = (vertices[t[0] as usize], vertices[t[1] as usize], vertices[t[2] as usize]);
            let normal = normalized(cross(sub(v1, v0), sub(v2, v0)));
            let (e0, e1, e2) = (norm(sub(v0, v1)), norm(sub(v1, v2)), norm(sub(v2, v0)));
            for (k, w) in [e0 * e2, e0 * e1, e1 * e2].into_iter().enumerate() {
                let v = t[k] as usize;
                normals[v] = add(normals[v], scale(normal, w));
                weights[v] += w;
            }
        }
        for (n, w) in normals.iter_mut().zip(&weights) {
            *n = [n[0] / w, n[1] / w, n[2] / w];
        }
        for (f, t) in indices.iter().enumerate() {
            for &v in t {
                let d = dot(face_normals[f], normals[v as usize]);
                // std::min keeps the first when the second isn't smaller (a NaN never is).
                if d < min_dot[v as usize] {
                    min_dot[v as usize] = d;
                }
            }
        }
    }
    let mut generator = Mt64::new(SEED);
    let mut faces: Vec<usize> = (0..indices.len()).collect();
    let mut ratio = 1.0f32;
    let mut edge_len = 0.2f32;
    while faces.len() > target {
        edge_len = (f64::from(edge_len) * (2.0 - f64::from(ratio))) as f32;
        let max_len2 = edge_len * edge_len;
        generator.shuffle(&mut faces);
        let mut allowed = faces.len() as i64 - target as i64;
        for &face in &faces {
            if removed[face] {
                continue;
            }
            for e in 0..3 {
                let mut keep = final_index(&mut mapping, indices[face][e] as usize);
                let mut gone = final_index(&mut mapping, indices[face][(e + 1) % 3] as usize);
                let d = sub(vertices[keep], vertices[gone]);
                if dot(d, d) > max_len2 {
                    continue;
                }
                if min_dot[gone] < min_dot[keep] {
                    std::mem::swap(&mut keep, &mut gone);
                }
                mapping[gone] = mapping[keep];
                let neighbour = neighbours[face][e];
                remove_face(&mut neighbours, &mut removed, face as i32, neighbour);
                remove_face(&mut neighbours, &mut removed, neighbour, face as i32);
                allowed -= 2;
                break;
            }
            if allowed <= 0 {
                break;
            }
        }
        let before = faces.len();
        faces.retain(|&f| !removed[f]);
        ratio = (before - faces.len()) as f32 / before as f32;
    }
    let mut new_index: std::collections::HashMap<usize, u32> = std::collections::HashMap::new();
    let (mut out_v, mut out_t) = (Vec::new(), Vec::with_capacity(faces.len()));
    for &f in &faces {
        let t = [0, 1, 2].map(|k| final_index(&mut mapping, indices[f][k] as usize));
        if t[0] == t[1] || t[1] == t[2] || t[2] == t[0] {
            continue;
        }
        let t = t.map(|v| {
            *new_index.entry(v).or_insert_with(|| {
                out_v.push(vertices[v]);
                (out_v.len() - 1) as u32
            })
        });
        out_t.push(t);
    }
    (out_v, out_t)
}

/// Orca's `remove_face` of the edge collapse: the face goes, and its two other neighbours become each other's.
fn remove_face(neighbours: &mut [[i32; 3]], removed: &mut [bool], face: i32, other: i32) {
    if face < 0 {
        return;
    }
    removed[face as usize] = true;
    let n = neighbours[face as usize];
    let n_a = if n[0] != other { n[0] } else { n[1] };
    let n_b = if n[2] != other { n[2] } else { n[1] };
    // Orca tests > 0, so the first face's neighbours are never updated.
    if n_a > 0
        && let Some(x) = neighbours[n_a as usize].iter_mut().find(|x| **x == face)
    {
        *x = n_b;
    }
    if n_b > 0
        && let Some(x) = neighbours[n_b as usize].iter_mut().find(|x| **x == face)
    {
        *x = n_a;
    }
}

/// Points on the surface, each with its triangle's normal.
struct Samples {
    positions: Vec<V3>,
    normals: Vec<V3>,
    /// The surface's area, mm² (summed in single precision, as Orca sums it).
    area: f32,
}

/// Orca's `sample_its_uniform_parallel`: `count` points at random on the triangles, evenly by area.
fn sample(vertices: &[V3], indices: &[[u32; 3]], count: usize) -> Samples {
    // The running sums of the areas (each triangle's in single precision, summed into a float) and the triangle
    // each ends at; a sum repeated by a triangle with no area belongs to the later one, as in Orca's map.
    let mut sums: Vec<(f64, usize)> = Vec::with_capacity(indices.len());
    let mut area = 0.0f32;
    for (k, t) in indices.iter().enumerate() {
        let (a, b, c) = (vertices[t[0] as usize], vertices[t[1] as usize], vertices[t[2] as usize]);
        let triangle = f64::from(0.5 * norm(cross(sub(b, a), sub(c, a))));
        area = (f64::from(area) + triangle) as f32;
        let key = f64::from(area);
        match sums.last_mut() {
            Some(last) if last.0 == key => last.1 = k,
            _ => sums.push((key, k)),
        }
    }
    let mut generator = Mt64::new(SEED);
    let draws: Vec<[f64; 3]> =
        (0..count).map(|_| [generator.canonical(), generator.canonical(), generator.canonical()]).collect();
    let mut positions = Vec::with_capacity(count);
    let mut normals = Vec::with_capacity(count);
    for r in &draws {
        let at = r[0] * f64::from(area);
        // The first sum past the draw (`upper_bound`).
        let k = sums.partition_point(|&(s, _)| s <= at).min(sums.len() - 1);
        let t = indices[sums[k].1];
        let sq_u = r[1].sqrt();
        let v = r[2];
        let (a, b, c) = (vertices[t[0] as usize], vertices[t[1] as usize], vertices[t[2] as usize]);
        positions.push(add(
            add(scale(a, (1.0 - sq_u) as f32), scale(b, (sq_u * (1.0 - v)) as f32)),
            scale(c, (v * sq_u) as f32),
        ));
        normals.push(normalized(cross(sub(b, a), sub(c, b))));
    }
    Samples { positions, normals, area }
}

/// Each triangle's place in the order of the leaves of Orca's AABB tree (`AABBTreeIndirect::Tree`, built by
/// `build_aabb_tree_over_indexed_triangle_set`): balanced, one triangle a leaf, each level split at the median
/// centroid along its box's longest side by Orca's own quickselect. Orca's tree looks into the left branch first and
/// takes a hit in the right one only where its distance, which it keeps in single precision, is shorter: of the
/// triangles a ray meets at the same such distance (decimation can leave two back to back, one facing each way),
/// the one first in this order counts.
fn leaf_order(vertices: &[V3], indices: &[[u32; 3]]) -> Vec<u32> {
    let third = (1.0f64 / 3.0) as f32;
    let mut input: Vec<Entry> = indices
        .iter()
        .enumerate()
        .map(|(k, t)| {
            let (a, b, c) = (vertices[t[0] as usize], vertices[t[1] as usize], vertices[t[2] as usize]);
            Entry {
                triangle: k as u32,
                min: [0, 1, 2].map(|i| a[i].min(b[i]).min(c[i])),
                max: [0, 1, 2].map(|i| a[i].max(b[i]).max(c[i])),
                centroid: scale(add(add(a, b), c), third),
            }
        })
        .collect();
    if !input.is_empty() {
        let last = input.len() - 1;
        split(&mut input, 0, last);
    }
    let mut rank = vec![0u32; input.len()];
    for (k, e) in input.iter().enumerate() {
        rank[e.triangle as usize] = k as u32;
    }
    rank
}

/// A triangle as Orca's tree is built from it: its box and centroid.
#[derive(Clone, Copy)]
struct Entry {
    triangle: u32,
    min: V3,
    max: V3,
    centroid: V3,
}

/// Orca's `build_recursive` over `input[left..=right]`, its leaves left in order.
fn split(input: &mut [Entry], left: usize, right: usize) {
    if left == right {
        return;
    }
    let (mut min, mut max) = (input[left].min, input[left].max);
    for e in &input[left + 1..=right] {
        for k in 0..3 {
            min[k] = min[k].min(e.min[k]);
            max[k] = max[k].max(e.max[k]);
        }
    }
    // Eigen's maxCoeff: the first of the longest sides.
    let size = sub(max, min);
    let mut dimension = 0;
    for k in 1..3 {
        if size[k] > size[dimension] {
            dimension = k;
        }
    }
    let center = (left + right) / 2;
    partition(input, dimension, left, right, center);
    split(input, left, center);
    split(input, center + 1, right);
}

/// Orca's `partition_input`: quickselect with the median of three, so that `input[k]` is in its sorted place along
/// `dimension`, those before it no greater and those after it no smaller.
fn partition(input: &mut [Entry], dimension: usize, mut left: usize, mut right: usize, k: usize) {
    let value = |input: &[Entry], i: usize| input[i].centroid[dimension];
    while left < right {
        let center = (left + right) / 2;
        let pivot;
        {
            let mut left_value = value(input, left);
            let mut center_value = value(input, center);
            let mut right_value = value(input, right);
            if left_value > center_value {
                input.swap(left, center);
                std::mem::swap(&mut left_value, &mut center_value);
            }
            if left_value > right_value {
                input.swap(left, right);
                right_value = left_value;
            }
            if center_value > right_value {
                input.swap(center, right);
                center_value = right_value;
            }
            pivot = center_value;
        }
        if right <= left + 2 {
            break;
        }
        let mut i = left;
        let mut j = right - 1;
        input.swap(center, j);
        loop {
            i += 1;
            while value(input, i) < pivot {
                i += 1;
            }
            j -= 1;
            while value(input, j) > pivot && i < j {
                j -= 1;
            }
            if i >= j {
                break;
            }
            input.swap(i, j);
        }
        input.swap(i, right - 1);
        match k.cmp(&i) {
            std::cmp::Ordering::Less => right = i - 1,
            std::cmp::Ordering::Equal => break,
            std::cmp::Ordering::Greater => left = i + 1,
        }
    }
}

/// A bounding volume hierarchy over triangles, for the first triangle a ray meets: binned by surface area, at most
/// four triangles a leaf, the nearer child first. Faster than Orca's tree, and as `rank` breaks ties, it finds what
/// Orca's finds.
struct Bvh {
    nodes: Vec<Node>,
    order: Vec<u32>,
    /// The triangles of `order`, each as its first corner and the edges from it to the others, in double precision
    /// (as Orca's ray test takes them).
    corners: Vec<[[f64; 3]; 3]>,
    /// Each triangle's place in Orca's tree (`leaf_order`).
    rank: Vec<u32>,
}

#[derive(Clone, Copy)]
struct Node {
    min: [f64; 3],
    max: [f64; 3],
    /// The first child of an inner node (the other follows it), the first of `order` of a leaf.
    first: u32,
    /// How many triangles a leaf has, 0 for an inner node.
    count: u32,
}

impl Bvh {
    fn build(vertices: &[V3], indices: &[[u32; 3]]) -> Bvh {
        let boxes: Vec<(V3, V3, V3)> = indices
            .iter()
            .map(|t| {
                let p = t.map(|v| vertices[v as usize]);
                let min = [0, 1, 2].map(|k| p[0][k].min(p[1][k]).min(p[2][k]));
                let max = [0, 1, 2].map(|k| p[0][k].max(p[1][k]).max(p[2][k]));
                (min, max, [0, 1, 2].map(|k| (min[k] + max[k]) * 0.5))
            })
            .collect();
        let mut order: Vec<u32> = (0..indices.len() as u32).collect();
        let mut nodes = vec![Node { min: [0.0; 3], max: [0.0; 3], first: 0, count: 0 }];
        let mut stack = vec![(0usize, 0usize, order.len())];
        const BINS: usize = 12;
        let wide = |v: V3| v.map(f64::from);
        while let Some((node, from, to)) = stack.pop() {
            let (mut min, mut max) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
            let (mut cmin, mut cmax) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
            for &t in &order[from..to] {
                let (bmin, bmax, c) = boxes[t as usize];
                for k in 0..3 {
                    min[k] = min[k].min(bmin[k]);
                    max[k] = max[k].max(bmax[k]);
                    cmin[k] = cmin[k].min(c[k]);
                    cmax[k] = cmax[k].max(c[k]);
                }
            }
            nodes[node].min = wide(min);
            nodes[node].max = wide(max);
            if to - from <= 4 {
                nodes[node].first = from as u32;
                nodes[node].count = (to - from) as u32;
                continue;
            }
            let area = |lo: V3, hi: V3| {
                let d = sub(hi, lo);
                d[0] * d[1] + d[1] * d[2] + d[2] * d[0]
            };
            let bin = |c: f32, axis: usize| {
                let b = ((c - cmin[axis]) / (cmax[axis] - cmin[axis]) * BINS as f32) as usize;
                b.min(BINS - 1)
            };
            // The plane between bins that leaves the least surface to look into, on any side.
            let mut best: Option<(usize, usize, f32)> = None;
            for axis in 0..3 {
                if cmax[axis] - cmin[axis] <= 0.0 {
                    continue;
                }
                let mut counts = [0usize; BINS];
                let mut bounds = [([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]); BINS];
                for &t in &order[from..to] {
                    let (bmin, bmax, c) = boxes[t as usize];
                    let b = bin(c[axis], axis);
                    counts[b] += 1;
                    for k in 0..3 {
                        bounds[b].0[k] = bounds[b].0[k].min(bmin[k]);
                        bounds[b].1[k] = bounds[b].1[k].max(bmax[k]);
                    }
                }
                let mut right_area = [0.0f32; BINS];
                let (mut lo, mut hi) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
                let mut right_count = [0usize; BINS];
                let mut n = 0;
                for b in (1..BINS).rev() {
                    for k in 0..3 {
                        lo[k] = lo[k].min(bounds[b].0[k]);
                        hi[k] = hi[k].max(bounds[b].1[k]);
                    }
                    n += counts[b];
                    right_count[b] = n;
                    right_area[b] = if n > 0 { area(lo, hi) } else { 0.0 };
                }
                let (mut lo, mut hi) = ([f32::INFINITY; 3], [f32::NEG_INFINITY; 3]);
                let mut n = 0;
                for b in 0..BINS - 1 {
                    for k in 0..3 {
                        lo[k] = lo[k].min(bounds[b].0[k]);
                        hi[k] = hi[k].max(bounds[b].1[k]);
                    }
                    n += counts[b];
                    if n == 0 || right_count[b + 1] == 0 {
                        continue;
                    }
                    let cost = n as f32 * area(lo, hi) + right_count[b + 1] as f32 * right_area[b + 1];
                    if best.is_none_or(|(_, _, c)| cost < c) {
                        best = Some((axis, b + 1, cost));
                    }
                }
            }
            let mid = match best {
                Some((axis, plane, _)) => {
                    let part = &mut order[from..to];
                    let mut i = 0;
                    for j in 0..part.len() {
                        if bin(boxes[part[j] as usize].2[axis], axis) < plane {
                            part.swap(i, j);
                            i += 1;
                        }
                    }
                    from + i
                }
                // Every centroid at one spot: halves.
                None => (from + to) / 2,
            };
            let left = nodes.len();
            nodes.push(Node { min: [0.0; 3], max: [0.0; 3], first: 0, count: 0 });
            nodes.push(Node { min: [0.0; 3], max: [0.0; 3], first: 0, count: 0 });
            nodes[node].first = left as u32;
            stack.push((left, from, mid));
            stack.push((left + 1, mid, to));
        }
        let corners = order
            .iter()
            .map(|&t| {
                let p = indices[t as usize].map(|v| wide(vertices[v as usize]));
                let edge = |b: [f64; 3]| [b[0] - p[0][0], b[1] - p[0][1], b[2] - p[0][2]];
                [p[0], edge(p[1]), edge(p[2])]
            })
            .collect();
        Bvh { nodes, order, corners, rank: leaf_order(vertices, indices) }
    }

    /// The triangle a ray from `origin` along `dir` meets first (at t > 0), as Orca's `intersect_ray_first_hit` with
    /// its default epsilon finds it: the shortest distance in single precision, ties to the first in Orca's tree.
    fn first_hit(&self, origin: [f64; 3], dir: [f64; 3]) -> Option<u32> {
        let inv = dir.map(|d| 1.0 / d);
        // Where the ray enters a box, if it does by `limit`.
        let enter = |node: &Node, limit: f64| -> Option<f64> {
            let (mut t0, mut t1) = (0.0f64, limit);
            for k in 0..3 {
                let a = (node.min[k] - origin[k]) * inv[k];
                let b = (node.max[k] - origin[k]) * inv[k];
                let (lo, hi) = if a < b { (a, b) } else { (b, a) };
                t0 = if lo > t0 { lo } else { t0 };
                t1 = if hi < t1 { hi } else { t1 };
            }
            (t0 <= t1).then_some(t0)
        };
        // The best hit so far (its distance in single precision, its rank, the triangle), and how far a box may
        // start to hold one as near: up to the next float.
        let mut best: Option<(f32, u32, u32)> = None;
        let mut limit = f64::INFINITY;
        let mut stack: Vec<(u32, f64)> = Vec::with_capacity(64);
        if let Some(t) = enter(&self.nodes[0], limit) {
            stack.push((0, t));
        }
        while let Some((n, t_in)) = stack.pop() {
            if t_in > limit {
                continue;
            }
            let node = &self.nodes[n as usize];
            if node.count > 0 {
                let leaf = node.first as usize..(node.first + node.count) as usize;
                for (&t, corners) in self.order[leaf.clone()].iter().zip(&self.corners[leaf]) {
                    let Some(hit) = intersect(corners, origin, dir) else { continue };
                    if hit <= 0.0 {
                        continue;
                    }
                    let (d, r) = (hit as f32, self.rank[t as usize]);
                    if best.is_none_or(|(bd, br, _)| d < bd || (d == bd && r < br)) {
                        best = Some((d, r, t));
                        limit = f64::from(f32::from_bits(d.to_bits() + 1));
                    }
                }
                continue;
            }
            let (l, r) = (node.first, node.first + 1);
            let tl = enter(&self.nodes[l as usize], limit);
            let tr = enter(&self.nodes[r as usize], limit);
            match (tl, tr) {
                (Some(a), Some(b)) => {
                    if a <= b {
                        stack.push((r, b));
                        stack.push((l, a));
                    } else {
                        stack.push((l, a));
                        stack.push((r, b));
                    }
                }
                (Some(a), None) => stack.push((l, a)),
                (None, Some(b)) => stack.push((r, b)),
                (None, None) => {}
            }
        }
        best.map(|(_, _, t)| t)
    }
}

/// Möller and Trumbore's ray-triangle test (`intersect_triangle1`, both sides), as Orca's AABB tree runs it in
/// double precision with its default epsilon of 1e-6: the ray's parameter where it meets the triangle.
fn intersect(corners: &[[f64; 3]; 3], orig: [f64; 3], dir: [f64; 3]) -> Option<f64> {
    let [p0, e1, e2] = *corners;
    let cross =
        |a: [f64; 3], b: [f64; 3]| [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    let dot = |a: [f64; 3], b: [f64; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let pvec = cross(dir, e2);
    let det = dot(e1, pvec);
    let tvec = [orig[0] - p0[0], orig[1] - p0[1], orig[2] - p0[2]];
    const EPS: f64 = 0.000_001;
    let qvec;
    if det > EPS {
        let u = dot(tvec, pvec);
        if u < 0.0 || u > det {
            return None;
        }
        qvec = cross(tvec, e1);
        let v = dot(dir, qvec);
        if v < 0.0 || u + v > det {
            return None;
        }
    } else if det < -EPS {
        let u = dot(tvec, pvec);
        if u > 0.0 || u < det {
            return None;
        }
        qvec = cross(tvec, e1);
        let v = dot(dir, qvec);
        if v > 0.0 || u + v < det {
            return None;
        }
    } else {
        return None;
    }
    Some(dot(e2, qvec) * (1.0 / det))
}

/// The 25 directions of Orca's rays, round +Z: a 5 × 5 grid on the unit square mapped evenly onto the hemisphere
/// (`sample_hemisphere_uniform`).
fn directions() -> Vec<V3> {
    let step = 1.0f32 / RAYS as f32;
    let mut out = Vec::with_capacity(RAYS * RAYS);
    for x in 0..RAYS {
        let sx = (f64::from(x as f32 * step) + f64::from(step) / 2.0) as f32;
        for y in 0..RAYS {
            let sy = (f64::from(y as f32 * step) + f64::from(step) / 2.0) as f32;
            let term1 = 2.0 * std::f32::consts::PI * sx;
            let term2 = 2.0 * (sy - sy * sy).sqrt();
            out.push([libm::cosf(term1) * term2, libm::sinf(term1) * term2, (1.0 - 2.0 * sy).abs()]);
        }
    }
    out
}

/// How visible an object's surface is, sampled.
pub struct Visibility {
    positions: Vec<V3>,
    normals: Vec<V3>,
    visibility: Vec<f32>,
    /// mm: how far round a point its samples count (`mesh_samples_radius`).
    radius: f32,
    /// The samples in cells `radius` wide.
    grid: Grid,
    /// mm: where the middle of the object is, which the samples are round.
    offset: [f64; 2],
}

impl Visibility {
    /// The visibility of `mesh`'s surface (its vertices in mm, where the object is sliced). With `back`, as Orca's
    /// "aligned back" seams have it: a face that looks to the front counts as less visible the more it does.
    pub fn of(mesh: &Mesh, back: bool) -> Visibility {
        Visibility::near(mesh, back, None)
    }

    /// `of`, measuring only the samples that `at` looks at for `points` (mm, where the object is sliced), when
    /// given: the rest it leaves fully visible, so `at` must be asked about those points alone. Most of a model's
    /// surface is far from where its outer walls could start.
    pub fn near(mesh: &Mesh, back: bool, points: Option<&[V3]>) -> Visibility {
        let (mut vertices, indices) = collapse_short_edges(&mesh.vertices, &mesh.triangles, TRIANGLES);
        // Orca samples the object where it slices it, round the middle of its bounding box (`trafo_centered`, its
        // `m_center_offset` whole nanometres, cut towards zero), which rounds the points' floats as here.
        let bounds = mesh.bounds();
        let offset = [0, 1].map(|k| ((bounds.min[k] + bounds.max[k]) / 2.0 / 1e-6) as i64 as f64 * 1e-6);
        for v in &mut vertices {
            v[0] = (f64::from(v[0]) - offset[0]) as f32;
            v[1] = (f64::from(v[1]) - offset[1]) as f32;
        }
        let samples = sample(&vertices, &indices, SAMPLES);
        // Where the samples are sparse enough that four lie within the radius nine times in ten.
        let density = SAMPLES as f32 / samples.area;
        let search_area = 4.0f32 / (-libm::logf(0.9) * density);
        let radius = (f64::from(search_area) / std::f64::consts::PI).sqrt() as f32;
        let grid = Grid::new(&samples.positions, radius);
        let count = samples.positions.len();
        let mut out = Visibility {
            positions: samples.positions,
            normals: samples.normals,
            visibility: vec![1.0; count],
            radius,
            grid,
            offset,
        };
        let wanted: Vec<u32> = match points {
            None => (0..count as u32).collect(),
            Some(points) => {
                let mut near = vec![false; count];
                for &p in points {
                    out.around(p, |k, _| near[k as usize] = true);
                }
                (0..count as u32).filter(|&k| near[k as usize]).collect()
            }
        };
        let bvh = Bvh::build(&vertices, &indices);
        let dirs = directions();
        let face_normals: Vec<V3> = indices.iter().map(|&t| face_normal(&vertices, t)).collect();
        let step = 1.0f32 / (RAYS * RAYS) as f32;
        let chunk = 256;
        let (positions, normals) = (&out.positions, &out.normals);
        let measured: Vec<f32> = crate::par::map_range(wanted.len().div_ceil(chunk), |c| {
            wanted[c * chunk..((c + 1) * chunk).min(wanted.len())]
                .iter()
                .map(|&s| {
                    let mut v = 1.0f32;
                    let (center, normal) = (positions[s as usize], normals[s as usize]);
                    if back {
                        v += ((dot(normal, [0.0, -1.0, 0.0]) + 1.2) * 0.5).clamp(0.0, 1.0);
                    }
                    // Orca's Frame::set_from_z.
                    let z = normalized(normal);
                    let tmp_x = if z[0].abs() > 0.99 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
                    let y = normalized(cross(z, tmp_x));
                    let x = cross(y, z);
                    let origin = add(center, scale(normal, 0.01)).map(f64::from);
                    for d in &dirs {
                        let world = add(add(scale(x, d[0]), scale(y, d[1])), scale(z, d[2]));
                        if let Some(t) = bvh.first_hit(origin, world.map(f64::from))
                            && dot(face_normals[t as usize], world) <= 0.0
                        {
                            v -= step;
                        }
                    }
                    v
                })
                .collect::<Vec<f32>>()
        })
        .into_iter()
        .flatten()
        .collect();
        for (&k, v) in wanted.iter().zip(measured) {
            out.visibility[k as usize] = v;
        }
        out
    }

    /// Each sample within the radius of `p` (mm, where the object is sliced), with `p` moved round the object's
    /// middle as the samples are, in the order `at` adds them up.
    fn around(&self, p: V3, mut f: impl FnMut(u32, V3)) {
        let p = [(f64::from(p[0]) - self.offset[0]) as f32, (f64::from(p[1]) - self.offset[1]) as f32, p[2]];
        let r2 = self.radius * self.radius;
        let c = cell(p, self.radius);
        for dz in -1..=1 {
            for dy in -1..=1 {
                for dx in -1..=1 {
                    for &k in self.grid.get(c.0 + dx, c.1 + dy, c.2 + dz) {
                        let d = sub(p, self.positions[k as usize]);
                        if d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < r2 {
                            f(k, d);
                        }
                    }
                }
            }
        }
    }

    /// How visible the surface is at `p` (mm): the samples within the radius, each weighted by how close it is and
    /// how close `p` is to its plane; fully visible where there are none.
    pub fn at(&self, p: V3) -> f32 {
        let r = self.radius;
        let (mut total, mut weights) = (0.0f32, 0.0f32);
        let mut any = false;
        self.around(p, |k, d| {
            any = true;
            let mut w = r - dot(d, self.normals[k as usize]).abs();
            w += r - norm(d);
            total += w * self.visibility[k as usize];
            weights += w;
        });
        if any { total / weights } else { 1.0 }
    }
}

/// Points in cubes `size` wide, each cube's in the order of their indices.
#[derive(Default)]
struct Grid {
    /// The first cube, and how many there are each way.
    low: (i32, i32, i32),
    size: (i32, i32, i32),
    /// The points of cube k are `points[start[k]..start[k + 1]]`.
    start: Vec<u32>,
    points: Vec<u32>,
}

impl Grid {
    fn new(points: &[V3], size: f32) -> Grid {
        if points.is_empty() {
            return Grid::default();
        }
        let cells: Vec<(i32, i32, i32)> = points.iter().map(|p| cell(*p, size)).collect();
        let low = cells.iter().fold((i32::MAX, i32::MAX, i32::MAX), |a, c| (a.0.min(c.0), a.1.min(c.1), a.2.min(c.2)));
        let high = cells.iter().fold((i32::MIN, i32::MIN, i32::MIN), |a, c| (a.0.max(c.0), a.1.max(c.1), a.2.max(c.2)));
        let dims = (high.0 - low.0 + 1, high.1 - low.1 + 1, high.2 - low.2 + 1);
        let mut grid = Grid { low, size: dims, start: Vec::new(), points: vec![0; points.len()] };
        let count = (dims.0 as usize) * (dims.1 as usize) * (dims.2 as usize);
        let mut start = vec![0u32; count + 1];
        let index: Vec<usize> = cells.iter().map(|&c| grid.index(c.0, c.1, c.2).unwrap_or(0)).collect();
        for &i in &index {
            start[i + 1] += 1;
        }
        for i in 0..count {
            start[i + 1] += start[i];
        }
        let mut fill = start.clone();
        for (k, &i) in index.iter().enumerate() {
            grid.points[fill[i] as usize] = k as u32;
            fill[i] += 1;
        }
        grid.start = start;
        grid
    }

    fn index(&self, x: i32, y: i32, z: i32) -> Option<usize> {
        let (x, y, z) = (x - self.low.0, y - self.low.1, z - self.low.2);
        if x < 0 || y < 0 || z < 0 || x >= self.size.0 || y >= self.size.1 || z >= self.size.2 {
            return None;
        }
        Some(((z as usize * self.size.1 as usize) + y as usize) * self.size.0 as usize + x as usize)
    }

    /// The points in cube (x, y, z).
    fn get(&self, x: i32, y: i32, z: i32) -> &[u32] {
        match self.index(x, y, z) {
            Some(i) => &self.points[self.start[i] as usize..self.start[i + 1] as usize],
            None => &[],
        }
    }
}

fn cell(p: V3, size: f32) -> (i32, i32, i32) {
    ((p[0] / size).floor() as i32, (p[1] / size).floor() as i32, (p[2] / size).floor() as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_generator_is_libstdcxx_s() {
        // std::mt19937_64's 10000th output from its default seed, as the standard gives it.
        let mut g = Mt64::new(5489);
        let mut x = 0;
        for _ in 0..10_000 {
            x = g.next_u64();
        }
        assert_eq!(x, 9_981_545_732_273_789_042);
    }

    #[test]
    fn a_box_s_sides_are_fully_visible() {
        // A 20 mm cube: every face sees half of space, so its samples are fully visible.
        let c = [[0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [20.0, 20.0, 0.0], [0.0, 20.0, 0.0]];
        let vertices: Vec<[f32; 3]> =
            c.iter().copied().chain(c.iter().map(|p: &[f32; 3]| [p[0], p[1], 20.0])).collect();
        let triangles = vec![
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
        let mesh = Mesh { name: String::new(), vertices, triangles };
        let v = Visibility::of(&mesh, false);
        assert!((v.at([10.0, 0.0, 10.0]) - 1.0).abs() < 1e-6, "{}", v.at([10.0, 0.0, 10.0]));
        assert_eq!(v.positions.len(), SAMPLES);
        assert!(v.radius > 0.1 && v.radius < 1.0, "{}", v.radius);
    }
}

#[cfg(test)]
mod torus {
    use super::*;

    /// A torus round the z axis, 10 mm to the middle of its 4 mm tube, in 180 × 100 quads: 36,000 triangles.
    pub fn torus() -> Mesh {
        let (n, m) = (180usize, 100usize);
        let mut vertices = Vec::with_capacity(n * m);
        for i in 0..n {
            let u = i as f64 / n as f64 * std::f64::consts::TAU;
            for j in 0..m {
                let v = j as f64 / m as f64 * std::f64::consts::TAU;
                let w = 10.0 + 4.0 * libm::cos(v);
                vertices.push([(w * libm::cos(u)) as f32, (w * libm::sin(u)) as f32, (4.0 * libm::sin(v)) as f32]);
            }
        }
        let at = |i: usize, j: usize| ((i % n) * m + j % m) as u32;
        let mut triangles = Vec::with_capacity(2 * n * m);
        for i in 0..n {
            for j in 0..m {
                triangles.push([at(i, j), at(i + 1, j), at(i + 1, j + 1)]);
                triangles.push([at(i, j), at(i + 1, j + 1), at(i, j + 1)]);
            }
        }
        Mesh { name: "torus".into(), vertices, triangles }
    }

    /// The torus's visibility as Orca's own code measures it: the same 30,000 points, each as visible, the
    /// figures from the harness that `write_torus` feeds (its 36,000 triangles cut down to 15,998, the inner
    /// side of the ring in its own shadow).
    #[test]
    fn a_torus_s_visibility_is_orca_s() {
        let v = Visibility::of(&torus(), false);
        assert_eq!(v.radius.to_bits(), 0x3f4d_73dd, "{}", v.radius);
        assert_eq!(v.positions.len(), SAMPLES);
        let visible: f64 = v.visibility.iter().map(|&x| f64::from(x)).sum();
        assert_eq!(visible, 27070.0384484604);
        let at: f64 = v.positions.iter().map(|p| f64::from(p[0]) + f64::from(p[1]) + f64::from(p[2])).sum();
        assert_eq!(at, 521.0006640803767);
        assert_eq!(v.positions[0], [-12.501299, 1.4116337, 3.038413]);
        assert_eq!(v.visibility[1], 0.87999994);
        assert_eq!(v.visibility.iter().filter(|&&x| x < 0.5).count(), 111);
        // Round the outside of the ring the surface sees all of space, round the inside the ring hides some.
        let (outside, inside) = (v.at([14.0, 0.0, 0.0]), v.at([6.0, 0.0, 0.0]));
        assert!(outside > 0.99 && inside < 0.8, "{outside} {inside}");
    }

    /// Writes the torus for Orca's own code to measure (a harness built from Orca 2.5's SeamPlacer.cpp,
    /// ShortEdgeCollapse.cpp, TriangleSetSampling.cpp and AABBTreeIndirect.hpp, without fused multiply-adds).
    #[test]
    #[ignore]
    fn write_torus() {
        let mesh = torus();
        let mut out = Vec::new();
        out.extend((mesh.vertices.len() as u32).to_le_bytes());
        out.extend((mesh.triangles.len() as u32).to_le_bytes());
        for v in &mesh.vertices {
            for x in v {
                out.extend(x.to_le_bytes());
            }
        }
        for t in &mesh.triangles {
            for x in t {
                out.extend(x.to_le_bytes());
            }
        }
        std::fs::write("/tmp/torus.bin", out).unwrap();
    }
}
