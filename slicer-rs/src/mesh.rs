//! Triangle meshes: reading STL (binary and ASCII), welding corners into shared vertices (so the slicer can follow
//! edges from triangle to triangle), and laying objects out on the plate the way the app does
//! (`shared/slicing/arrange.ts`: shelves from the back, centred, 6 mm apart).

use crate::Error;
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// One object: shared vertices and triangles indexing them (corners counter-clockwise seen from outside).
#[derive(Clone, Debug, Default)]
pub struct Mesh {
    pub name: String,
    pub vertices: Vec<[f32; 3]>,
    pub triangles: Vec<[u32; 3]>,
}

#[derive(Clone, Copy, Debug)]
pub struct Bounds {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl Mesh {
    /// Builds a mesh from a triangle soup (nine floats a triangle), welding corners that are exactly equal.
    pub fn from_soup(name: &str, soup: &[f32]) -> Mesh {
        Mesh::weld(name, soup.len() / 9, |t, k| [soup[t * 9 + k * 3], soup[t * 9 + k * 3 + 1], soup[t * 9 + k * 3 + 2]])
    }

    /// `count` triangles, corner `k` of triangle `t` at `corner(t, k)`, with corners at the same spot joined into
    /// one vertex (exact float bits; -0 is 0) and triangles that collapse dropped.
    fn weld(name: &str, count: usize, corner: impl Fn(usize, usize) -> [f32; 3]) -> Mesh {
        let mut index: HashMap<[u32; 3], u32, BuildHasherDefault<FastHasher>> =
            HashMap::with_capacity_and_hasher(count / 2 + 16, Default::default());
        let mut vertices = Vec::with_capacity(count / 2 + 16);
        let mut triangles = Vec::with_capacity(count);
        for t in 0..count {
            let mut ids = [0u32; 3];
            for (k, id) in ids.iter_mut().enumerate() {
                let p = corner(t, k);
                let key = [(p[0] + 0.0).to_bits(), (p[1] + 0.0).to_bits(), (p[2] + 0.0).to_bits()];
                *id = *index.entry(key).or_insert_with(|| {
                    vertices.push(p);
                    (vertices.len() - 1) as u32
                });
            }
            // A triangle with two equal corners has no area and no edges worth following.
            if ids[0] != ids[1] && ids[1] != ids[2] && ids[0] != ids[2] {
                triangles.push(ids);
            }
        }
        Mesh { name: name.into(), vertices, triangles }
    }

    /// The same mesh with corners at the same spot joined into one vertex (3MF writers don't always share them),
    /// and triangles that collapse dropped.
    pub fn welded(self) -> Mesh {
        let mut index: HashMap<[u32; 3], u32, BuildHasherDefault<FastHasher>> =
            HashMap::with_capacity_and_hasher(self.vertices.len() + 16, Default::default());
        let mut vertices = Vec::with_capacity(self.vertices.len());
        let remap: Vec<u32> = self
            .vertices
            .iter()
            .map(|p| {
                let key = [(p[0] + 0.0).to_bits(), (p[1] + 0.0).to_bits(), (p[2] + 0.0).to_bits()];
                *index.entry(key).or_insert_with(|| {
                    vertices.push(*p);
                    (vertices.len() - 1) as u32
                })
            })
            .collect();
        let triangles = self
            .triangles
            .iter()
            .map(|t| t.map(|i| remap[i as usize]))
            .filter(|t| t[0] != t[1] && t[1] != t[2] && t[0] != t[2])
            .collect();
        Mesh { name: self.name, vertices, triangles }
    }

    /// The volume the triangles enclose, mm³: negative when the mesh is inside out (wound clockwise seen from
    /// outside).
    pub fn signed_volume(&self) -> f64 {
        let v = |i: u32| self.vertices[i as usize].map(f64::from);
        self.triangles
            .iter()
            .map(|t| {
                let (a, b, c) = (v(t[0]), v(t[1]), v(t[2]));
                (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0])
                    + a[2] * (b[0] * c[1] - b[1] * c[0]))
                    / 6.0
            })
            .sum()
    }

    /// Turns an inside-out mesh right way out (as Orca does): slicing takes the side the triangles face as the
    /// outside.
    pub fn orient(&mut self) {
        if self.signed_volume() < 0.0 {
            for t in &mut self.triangles {
                t.swap(1, 2);
            }
        }
    }

    pub fn bounds(&self) -> Bounds {
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for v in &self.vertices {
            for k in 0..3 {
                min[k] = min[k].min(v[k] as f64);
                max[k] = max[k].max(v[k] as f64);
            }
        }
        Bounds { min, max }
    }

    pub fn translate(&mut self, d: [f64; 3]) {
        for v in &mut self.vertices {
            for k in 0..3 {
                v[k] = (v[k] as f64 + d[k]) as f32;
            }
        }
    }

    /// Applies a 3MF transform: the 3×3 matrix (row vectors) and the translation.
    pub fn transform(&mut self, m: &[f64; 12]) {
        for v in &mut self.vertices {
            let (x, y, z) = (v[0] as f64, v[1] as f64, v[2] as f64);
            v[0] = (x * m[0] + y * m[3] + z * m[6] + m[9]) as f32;
            v[1] = (x * m[1] + y * m[4] + z * m[7] + m[10]) as f32;
            v[2] = (x * m[2] + y * m[5] + z * m[8] + m[11]) as f32;
        }
        // A mirroring transform turns triangles inside out: turn them back.
        let det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6])
            + m[2] * (m[3] * m[7] - m[4] * m[6]);
        if det < 0.0 {
            for t in &mut self.triangles {
                t.swap(1, 2);
            }
        }
    }

    /// Scales about the origin (the app's "Scale to N% and slice").
    pub fn scale(&mut self, factor: f64) {
        for v in &mut self.vertices {
            for c in v.iter_mut() {
                *c = (*c as f64 * factor) as f32;
            }
        }
    }
}

/// Reads an STL, binary or ASCII. A binary file may have a few stray bytes after its triangles, as some exporters
/// write (the app's `parseStl` accepts them too).
pub fn read_stl(name: &str, bytes: &[u8]) -> Result<Mesh, Error> {
    if bytes.len() >= 84 {
        let count = u32::from_le_bytes([bytes[80], bytes[81], bytes[82], bytes[83]]) as usize;
        let needed = 84usize.saturating_add(count.saturating_mul(50));
        let looks_ascii =
            bytes.starts_with(b"solid") && bytes[..bytes.len().min(512)].windows(5).any(|w| w == b"facet");
        if count > 0 && needed <= bytes.len() && bytes.len() - needed < 50 && !(looks_ascii && needed != bytes.len()) {
            // Straight from the file's bytes into the mesh, with no copy of every corner in between.
            let float = |at: usize| f32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]]);
            let corner = |t: usize, k: usize| {
                let o = 84 + t * 50 + 12 + k * 12;
                [float(o), float(o + 4), float(o + 8)]
            };
            let mesh = Mesh::weld(name, count, corner);
            if mesh.vertices.iter().any(|v| !v.iter().all(|c| c.is_finite())) {
                return Err(Error::Unreadable);
            }
            if mesh.triangles.is_empty() {
                return Err(Error::NoModel);
            }
            return Ok(mesh);
        }
    }
    let text = std::str::from_utf8(bytes).map_err(|_| Error::Unreadable)?;
    if !text.trim_start().starts_with("solid") {
        return Err(Error::Unreadable);
    }
    let mut soup = Vec::new();
    let mut words = text.split_ascii_whitespace();
    while let Some(word) = words.next() {
        if word == "vertex" {
            for _ in 0..3 {
                let value: f32 = words.next().and_then(|w| w.parse().ok()).ok_or(Error::Unreadable)?;
                soup.push(value);
            }
        }
    }
    if soup.len() % 9 != 0 {
        return Err(Error::Unreadable);
    }
    finish(name, &soup)
}

fn finish(name: &str, soup: &[f32]) -> Result<Mesh, Error> {
    if soup.iter().any(|v| !v.is_finite()) {
        return Err(Error::Unreadable);
    }
    let mesh = Mesh::from_soup(name, soup);
    if mesh.triangles.is_empty() {
        return Err(Error::NoModel);
    }
    Ok(mesh)
}

/// How far apart objects are put, in mm (the app's ARRANGE_GAP).
pub const ARRANGE_GAP: f64 = 6.0;

/// Lays the objects out on the plate like the app: each on the bed, in rows from the back, centred. Errors when one
/// is too big or too tall, or they don't all fit.
pub fn arrange(meshes: &mut [Mesh], bed: [f64; 2], height: f64) -> Result<(), Error> {
    let boxes: Vec<Bounds> = meshes.iter().map(Mesh::bounds).collect();
    for b in &boxes {
        if b.max[0] - b.min[0] > bed[0] || b.max[1] - b.min[1] > bed[1] {
            return Err(Error::TooBig);
        }
        if b.max[2] - b.min[2] > height {
            return Err(Error::TooTall);
        }
    }
    let mut order: Vec<usize> = (0..meshes.len()).collect();
    // Deepest first, so each row is as shallow as it can be (a stable sort, as the app's).
    order.sort_by(|&a, &b| {
        let da = boxes[a].max[1] - boxes[a].min[1];
        let db = boxes[b].max[1] - boxes[b].min[1];
        db.partial_cmp(&da).unwrap_or(std::cmp::Ordering::Equal)
    });
    struct Row {
        items: Vec<usize>,
        width: f64,
        depth: f64,
    }
    let mut rows: Vec<Row> = Vec::new();
    let mut row = Row { items: vec![], width: 0.0, depth: 0.0 };
    for &i in &order {
        let w = boxes[i].max[0] - boxes[i].min[0];
        let d = boxes[i].max[1] - boxes[i].min[1];
        let gap = if row.items.is_empty() { 0.0 } else { ARRANGE_GAP };
        if !row.items.is_empty() && row.width + gap + w > bed[0] {
            rows.push(std::mem::replace(&mut row, Row { items: vec![], width: 0.0, depth: 0.0 }));
        }
        let gap = if row.items.is_empty() { 0.0 } else { ARRANGE_GAP };
        row.width += gap + w;
        row.depth = row.depth.max(d);
        row.items.push(i);
    }
    rows.push(row);
    let total: f64 = rows.iter().map(|r| r.depth).sum::<f64>() + ARRANGE_GAP * (rows.len() as f64 - 1.0);
    if total > bed[1] {
        return Err(Error::TooMany);
    }
    let centre = [bed[0] / 2.0, bed[1] / 2.0];
    let mut top = centre[1] + total / 2.0;
    for r in &rows {
        let mut x = centre[0] - r.width / 2.0;
        for &i in &r.items {
            let b = boxes[i];
            let w = b.max[0] - b.min[0];
            let d = b.max[1] - b.min[1];
            meshes[i].translate([x - b.min[0], top - (r.depth + d) / 2.0 - b.min[1], -b.min[2]]);
            x += w + ARRANGE_GAP;
        }
        top -= r.depth + ARRANGE_GAP;
    }
    Ok(())
}

/// Puts objects that already sit on the plate down on the bed (a project laid out by its slicer, or files placed
/// for a benchmark): only the lowest point moves to z = 0, nothing else. One that `settle_heights` has put on the
/// bed is on it to a float's step, and stays as Orca has it.
pub fn drop_to_bed(meshes: &mut [Mesh]) {
    for m in meshes {
        let low = m.bounds().min[2];
        if low.is_finite() && low.abs() > ON_BED {
            m.translate([0.0, 0.0, -low]);
        }
    }
}

/// mm: how far above or below the bed an object's lowest corner may be and count as on it.
const ON_BED: f64 = 1e-4;

/// Gives an object's corners the heights Orca slices them at. Orca holds each part of an object (`parts`: its
/// corners' range, and how far the part's transform moves it up, mm) round the middle of its bounding box, moved
/// there in floats (`ModelVolume::center_geometry_after_creation`); it drops the object onto the bed in doubles
/// when `drop` (`ModelObject::ensure_on_bed`, which its command line runs for STL files and other programs' 3MF
/// files); and it moves the corners back in floats when it slices (`make_trafo_for_slicing`). A corner can end a
/// float's step from where the file put it, and a face at a layer's cutting height then lies under or over it as
/// in Orca: the Benchy's lettering, 0.3 mm deep, ends just under the cut at 0.3 mm, so Orca bridges over it on its
/// second layer. Only heights: Orca slices across in its own units.
pub fn settle_heights(vertices: &mut [[f32; 3]], parts: &[(std::ops::Range<usize>, f64)], drop: bool) {
    // Each part round the middle of its box (in floats), and where its transform then puts that middle (doubles).
    let mut moves = Vec::with_capacity(parts.len());
    let mut low = f64::INFINITY;
    for (range, up) in parts {
        let part = &mut vertices[range.clone()];
        let (lo, hi) = part.iter().fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), v| (lo.min(v[2]), hi.max(v[2])));
        if part.is_empty() || !lo.is_finite() || !hi.is_finite() {
            moves.push(0.0);
            continue;
        }
        let middle = (lo as f64 + hi as f64) / 2.0;
        let back = -(middle as f32);
        let mut part_low = f32::INFINITY;
        for v in part.iter_mut() {
            v[2] += back;
            part_low = part_low.min(v[2]);
        }
        let to = middle + up;
        low = low.min(part_low as f64 + to);
        moves.push(to);
    }
    let lift = if drop && low.is_finite() { -low } else { 0.0 };
    for ((range, _), to) in parts.iter().zip(moves) {
        let to = (to + lift) as f32;
        for v in &mut vertices[range.clone()] {
            v[2] += to;
        }
    }
}

/// Where an object stands against the plate, as Orca judges it before slicing (`BuildVolume::object_state`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OnPlate {
    Inside,
    /// Some of it off the plate: Orca won't slice the plate.
    Partly,
    /// All of it off the plate (on a project's other plates, say): Orca leaves it out.
    Outside,
}

/// mm: how far a corner may lie past the plate's edge and still count as on it (Orca's `SceneEpsilon`).
const PLATE_EPSILON: f64 = 1e-4;

/// Where an object stands against a plate `bed` mm wide and deep, by its vertices, as Orca tests a rectangular
/// plate.
pub fn on_plate(m: &Mesh, bed: [f64; 2]) -> OnPlate {
    let on = |v: &[f32; 3]| {
        let (x, y) = (v[0] as f64, v[1] as f64);
        x >= -PLATE_EPSILON && x <= bed[0] + PLATE_EPSILON && y >= -PLATE_EPSILON && y <= bed[1] + PLATE_EPSILON
    };
    let inside = m.vertices.iter().filter(|v| on(v)).count();
    match inside {
        0 => OnPlate::Outside,
        n if n == m.vertices.len() => OnPlate::Inside,
        _ => OnPlate::Partly,
    }
}

/// FxHash-style hashing for the welding map: fast, and plenty for exact float bits.
#[derive(Default)]
pub struct FastHasher(u64);

impl Hasher for FastHasher {
    fn finish(&self) -> u64 {
        self.0
    }
    fn write(&mut self, bytes: &[u8]) {
        for chunk in bytes.chunks(4) {
            let mut word = [0u8; 4];
            word[..chunk.len()].copy_from_slice(chunk);
            self.write_u32(u32::from_le_bytes(word));
        }
    }
    fn write_u32(&mut self, n: u32) {
        self.0 = (self.0.rotate_left(5) ^ n as u64).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
    fn write_u64(&mut self, n: u64) {
        self.0 = (self.0.rotate_left(5) ^ n).wrapping_mul(0x51_7c_c1_b7_27_22_0a_95);
    }
    fn write_usize(&mut self, n: usize) {
        self.write_u64(n as u64);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heights_take_orcas_float_round_trip() {
        // A part 48 mm tall, as the Benchy: its lettering's ceiling at 0.3 mm comes back a float's step under 0.3 mm
        // (where the second layer is cut), a deck at 8.5 mm exactly at 8.5, and its bottom on the bed.
        let mut v = vec![[0.0, 0.0, 0.0], [0.0, 0.0, 0.3], [0.0, 0.0, 8.5], [0.0, 0.0, 48.0]];
        settle_heights(&mut v, &[(0..4, 0.0)], true);
        assert_eq!(v[0][2], 0.0);
        assert!(v[1][2] < 0.3f32 && v[1][2] > 0.29999, "{}", v[1][2]);
        assert_eq!(v[2][2], 8.5);
        assert_eq!(v[3][2], 48.0);
    }

    #[test]
    fn a_floating_part_is_put_on_the_bed_unless_a_project_holds_it_there() {
        let mut v = vec![[0.0, 0.0, 5.0], [0.0, 0.0, 15.0]];
        settle_heights(&mut v, &[(0..2, 0.0)], true);
        assert_eq!((v[0][2], v[1][2]), (0.0, 10.0));
        // Two parts, the second lifted 2 mm by its transform: the object's lowest corner goes to the bed.
        let mut v = vec![[0.0, 0.0, 1.0], [0.0, 0.0, 3.0], [0.0, 0.0, 0.0], [0.0, 0.0, 1.0]];
        settle_heights(&mut v, &[(0..2, 0.0), (2..4, 2.0)], true);
        assert_eq!(v.iter().map(|p| p[2]).collect::<Vec<_>>(), vec![0.0, 2.0, 1.0, 2.0]);
        let mut v = vec![[0.0, 0.0, 5.0], [0.0, 0.0, 15.0]];
        settle_heights(&mut v, &[(0..2, 0.0)], false);
        assert_eq!((v[0][2], v[1][2]), (5.0, 15.0));
    }
}
