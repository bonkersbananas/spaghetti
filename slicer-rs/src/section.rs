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
        Layers { top, height: heights }
    }

    /// Where each layer is cut: halfway up the layer.
    pub fn slice_z(&self) -> Vec<f64> {
        self.top.iter().zip(&self.height).map(|(t, h)| t - h / 2.0).collect()
    }
}

/// Every object's triangles together, with vertices in f64 for the cutting.
struct Soup<'a> {
    meshes: &'a [Mesh],
    /// The first vertex id of each mesh in the shared numbering.
    vertex_base: Vec<u32>,
}

/// Cuts the meshes at every layer's plane; returns each layer's region (outlines with holes), simplified to
/// `resolution` mm.
pub fn slice(meshes: &[Mesh], layers: &Layers, resolution: f64) -> Vec<Shapes> {
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

    let tolerance = (resolution * SCALE / 2.0).max(1.0) as i32;
    par::map_range(n_layers, |l| {
        let triangles = &items[starts[l]..starts[l + 1]];
        cut_layer(&soup, triangles, planes[l], tolerance)
    })
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

fn cut_layer(soup: &Soup, triangles: &[(u32, u32)], plane: f64, tolerance: i32) -> Shapes {
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
        return Vec::new();
    }

    // Chain: each segment continues with the one that starts on the edge it ends on.
    let mut by_start: EdgeMap = HashMap::with_capacity_and_hasher(segments.len() * 2, Default::default());
    for (i, s) in segments.iter().enumerate() {
        by_start.insert(s.from, i as u32);
    }
    let mut used = vec![false; segments.len()];
    let mut closed: Vec<Contour> = Vec::new();
    let mut open: Vec<Contour> = Vec::new();
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
        if closes {
            if loop_points.len() >= 3 {
                closed.push(loop_points);
            }
        } else {
            open.push(loop_points);
        }
    }
    if !open.is_empty() {
        close_open_chains(open, &mut closed, (2.0 * SCALE) as i64);
    }
    let simplified: Vec<Contour> =
        closed.iter().map(|c| geom::simplify_contour(c, tolerance)).filter(|c| c.len() >= 3).collect();
    geom::union_contours(&simplified)
}

#[inline]
fn pt0() -> Pt {
    geom::pt(0, 0)
}

/// A mesh with holes or broken edges leaves chains that don't close: join each chain's end to the nearest start
/// (within `max_gap`), and keep the loops that close. What can't be closed is dropped.
fn close_open_chains(mut open: Vec<Contour>, closed: &mut Vec<Contour>, max_gap: i64) {
    let max2 = (max_gap as i128) * (max_gap as i128);
    let mut done = vec![false; open.len()];
    for first in 0..open.len() {
        if done[first] {
            continue;
        }
        done[first] = true;
        let mut chain = std::mem::take(&mut open[first]);
        while let (Some(&end), Some(&head)) = (chain.last(), chain.first()) {
            // Close the chain on itself when its own start is the nearest.
            let mut best: Option<(usize, i128)> = None;
            for (j, other) in open.iter().enumerate() {
                if done[j] || other.is_empty() {
                    continue;
                }
                let d = d2(end, other[0]);
                if d <= max2 && best.is_none_or(|(_, bd)| d < bd) {
                    best = Some((j, d));
                }
            }
            let self_d = d2(end, head);
            match best {
                Some((j, d)) if d < self_d => {
                    done[j] = true;
                    let next = std::mem::take(&mut open[j]);
                    chain.extend(next);
                }
                _ => {
                    if self_d <= max2 && chain.len() >= 3 {
                        closed.push(chain);
                    }
                    break;
                }
            }
        }
    }
}

#[inline]
fn d2(a: Pt, b: Pt) -> i128 {
    let dx = (a.x - b.x) as i128;
    let dy = (a.y - b.y) as i128;
    dx * dx + dy * dy
}
