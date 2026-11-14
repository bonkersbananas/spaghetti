//! Where each wall loop starts: OrcaSlicer 2.5's seam placer (`GCode/SeamPlacer.cpp`, with `GCode/SeamContour.cpp`),
//! ported for its aligned, aligned-back and back seams.
//!
//! Every vertex of an object's outer walls is a candidate, scored as Orca scores it: how sharply the wall turns there
//! (a concave corner hides a seam best), how visible the surface is there from outside (`seam_mesh.rs`) and how far
//! the wall hangs over the layer below. Each loop takes its best candidate; then, from the best seams down, the seams
//! of loops above and below one another that are nearly as good are strung together layer by layer, and each
//! string of six or more is smoothed by a cubic B-spline fitted through it, each seam moving onto its loop where the
//! curve passes, less so the sharper its corner. As the G-code is written, each loop starts at the seam of the outer
//! wall it goes round; an inner wall at the point of its own loop nearest to that seam, or into the corner when the
//! seam is in a concave one.

use crate::config::Settings;
use crate::geom::{self, Contour, Pt};
use crate::mesh::Mesh;
use crate::region::LayerRegions;
use crate::seam_mesh::Visibility;
use std::collections::HashMap;

const PI: f32 = std::f32::consts::PI;
/// Orca's `sharp_angle_snapping_threshold`: corners this sharp keep their seam where it is.
const SHARP_ANGLE: f32 = 55.0 * PI / 180.0;
/// Orca's `overhang_angle_threshold`, from the vertical.
const OVERHANG_ANGLE: f32 = 45.0 * PI / 180.0;
/// Orca's `angle_importance_aligned`: how much a corner counts against visibility.
const ANGLE_IMPORTANCE: f32 = 0.6;
/// Orca's `seam_align_score_tolerance`: how much worse a seam may be and still join a string.
const SCORE_TOLERANCE: f32 = 0.3;
/// Orca's `seam_align_tolerable_dist_factor`: how far (in outer wall widths) a string looks on the next layer.
const ALIGN_REACH: f32 = 4.0;
/// Orca's `seam_align_minimum_string_seams`.
const MIN_STRING: usize = 6;
/// Orca's `seam_align_mm_per_segment` (an integer there).
const MM_PER_SEGMENT: f32 = 4.0;
/// The square root of two as Orca's `place_seam` writes it, to four places.
#[allow(clippy::approx_constant)]
const ORCA_SQRT_2: f32 = 1.4142;

/// The seam positions this places.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Orca's default: hidden where the model hides them, strung up the print.
    Aligned,
    /// As aligned, with the front of the model counted as more visible.
    AlignedBack,
    /// At the back of each loop, strung up the print.
    Rear,
}

impl Mode {
    /// The mode of a `seam_position`: nearest and random seams (not ported) are placed as aligned ones.
    pub fn of(seam_position: &str) -> Mode {
        match seam_position {
            "aligned_back" => Mode::AlignedBack,
            "back" => Mode::Rear,
            _ => Mode::Aligned,
        }
    }
}

/// A point of an outer wall where its loop might start (Orca's `SeamCandidate`).
#[derive(Clone, Debug)]
struct Candidate {
    /// mm; z the layer's slicing plane.
    position: [f32; 3],
    /// Its loop, an index into the layer's perimeters.
    perimeter: usize,
    visibility: f32,
    /// mm the wall hangs over the layer below, beyond what a 45° slope holds.
    overhang: f32,
    /// Where an object prints as more than one region on the layer: how far inside its whole slice the point is
    /// (negative), plus 0.65 of the wall's width (Orca's `embedded_distance`). A point well inside lies where another
    /// region meets this one, hidden. 0 otherwise.
    embedded: f32,
    /// Radians the wall turns there, counter-clockwise positive (concave corners negative).
    angle: f32,
}

/// One outer wall loop (Orca's `Perimeter`): its candidates are `start..end` of the layer's.
#[derive(Clone, Debug)]
struct Perimeter {
    hole: bool,
    start: usize,
    end: usize,
    /// The chosen candidate.
    seam: usize,
    /// mm: the outer wall's width.
    width: f32,
    /// Placed by a string, at `at`.
    finalized: bool,
    at: [f32; 3],
}

/// One object's outer walls on one layer, and where each loop starts.
#[derive(Clone, Debug, Default)]
pub struct LayerSeams {
    perimeters: Vec<Perimeter>,
    points: Vec<Candidate>,
    cells: Cells,
}

/// Points in square cells, for the nearest one and those within a distance.
#[derive(Clone, Debug, Default)]
struct Cells {
    size: f32,
    map: HashMap<(i32, i32), Vec<u32>>,
}

impl Cells {
    fn new(points: &[Candidate], size: f32) -> Cells {
        let mut map: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        for (k, p) in points.iter().enumerate() {
            map.entry(cell_of(p.position, size)).or_default().push(k as u32);
        }
        Cells { size, map }
    }

    /// Every point closer than `r` (squared distance under `r²` in single precision, as Orca's k-d tree has it), in
    /// order of their index.
    fn within(&self, points: &[Candidate], p: [f32; 3], r: f32) -> Vec<usize> {
        let mut out = Vec::new();
        if self.size <= 0.0 {
            return out;
        }
        let r2 = r * r;
        let reach = (r / self.size).ceil() as i32;
        let c = cell_of(p, self.size);
        for dy in -reach..=reach {
            for dx in -reach..=reach {
                if let Some(ids) = self.map.get(&(c.0 + dx, c.1 + dy)) {
                    for &k in ids {
                        if dist2(points[k as usize].position, p) < r2 {
                            out.push(k as usize);
                        }
                    }
                }
            }
        }
        out.sort_unstable();
        out
    }

    /// The point nearest to `p` (the lower index of equally near ones).
    fn nearest(&self, points: &[Candidate], p: [f32; 3]) -> Option<usize> {
        if points.is_empty() || self.size <= 0.0 {
            return None;
        }
        let c = cell_of(p, self.size);
        let mut best: Option<(f32, usize)> = None;
        let mut ring = 0i32;
        loop {
            for dy in -ring..=ring {
                for dx in -ring..=ring {
                    if dx.abs() != ring && dy.abs() != ring {
                        continue;
                    }
                    if let Some(ids) = self.map.get(&(c.0 + dx, c.1 + dy)) {
                        for &k in ids {
                            let d = dist2(points[k as usize].position, p);
                            if best.is_none_or(|(bd, bk)| d < bd || (d == bd && (k as usize) < bk)) {
                                best = Some((d, k as usize));
                            }
                        }
                    }
                }
            }
            // Every point further out is at least `ring` cells away.
            if let Some((d, k)) = best
                && d.sqrt() <= ring as f32 * self.size
            {
                return Some(k);
            }
            ring += 1;
            if ring > 100_000 {
                return best.map(|b| b.1);
            }
        }
    }
}

fn cell_of(p: [f32; 3], size: f32) -> (i32, i32) {
    ((p[0] / size).floor() as i32, (p[1] / size).floor() as i32)
}

/// Eigen's `normalized()`: unchanged when it has no length.
fn unit(a: [f32; 3]) -> [f32; 3] {
    let n2 = a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    if n2 > 0.0 {
        let n = n2.sqrt();
        [a[0] / n, a[1] / n, a[2] / n]
    } else {
        a
    }
}

fn dist2(a: [f32; 3], b: [f32; 3]) -> f32 {
    let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2]
}

/// Orca's `gauss`: a bump of height `mean_value` at `mean_x`, falling off as fast as `falloff`.
fn gauss(value: f32, mean_x: f32, mean_value: f32, falloff: f32) -> f32 {
    let shifted = value - mean_x;
    let denominator = falloff * shifted * shifted + 1.0;
    let exponent = 1.0 / denominator;
    mean_value * (libm::expf(exponent) - 1.0) / (libm::expf(1.0) - 1.0)
}

/// Orca's `compute_angle_penalty`: a concave corner costs far less than a straight wall or a convex corner.
fn angle_penalty(angle: f32) -> f32 {
    gauss(angle, 0.0, 1.0, 3.0) + 1.0 / (2.0 + libm::expf(-angle))
}

/// The length of (x, y) as Eigen's `norm()` takes it, which Orca measures with: the square root of the sum of the
/// squares (`hypot` rounds differently, and in WebAssembly is a slow library call).
fn norm(x: f64, y: f64) -> f64 {
    (x * x + y * y).sqrt()
}

/// Orca's `SeamComparator` for its aligned, aligned-back and back seams (no painted seams, so every candidate is
/// neutral, and with one region no point hides inside the print).
#[derive(Clone, Copy)]
struct Comparator {
    rear: bool,
}

impl Comparator {
    fn penalty(&self, a: &Candidate) -> f32 {
        a.overhang + a.visibility + ANGLE_IMPORTANCE * angle_penalty(a.angle)
    }

    /// Whether `a` is a better seam than `b` (`is_first_better`).
    fn better(&self, a: &Candidate, b: &Candidate) -> bool {
        if a.overhang > 0.0 || b.overhang > 0.0 {
            return a.overhang < b.overhang;
        }
        if let Some(first) = hidden_first(a, b) {
            return first;
        }
        if self.rear && a.position[1] != b.position[1] {
            return a.position[1] > b.position[1];
        }
        self.penalty(a) < self.penalty(b)
    }

    /// Whether `a` is not much worse a seam than `b` (`is_first_not_much_worse`); `width` is `a`'s loop's.
    fn not_much_worse(&self, a: &Candidate, b: &Candidate, width: f32) -> bool {
        if (a.overhang > 0.0 || b.overhang > 0.0) && (a.overhang - b.overhang).abs() > 0.1 * width {
            return a.overhang < b.overhang;
        }
        if let Some(first) = hidden_first(a, b) {
            return first;
        }
        if self.rear {
            return a.position[1] + SCORE_TOLERANCE * 5.0 > b.position[1];
        }
        let (pa, pb) = (self.penalty(a), self.penalty(b));
        pa <= pb || pa - pb < SCORE_TOLERANCE
    }
}

/// Whether `a` comes before `b` for being hidden in a join between regions (more than half a millimetre inside the
/// object's slice) where only one of them is; None when that doesn't tell them apart.
fn hidden_first(a: &Candidate, b: &Candidate) -> Option<bool> {
    if a.embedded < -0.5 && b.embedded > -0.5 {
        return Some(true);
    }
    if b.embedded < -0.5 && a.embedded > -0.5 {
        return Some(false);
    }
    None
}

/// Orca's `calculate_polygon_angles_at_vertices`: at each vertex, the angle between the arms reaching at least
/// `min_arm` mm back and forward along the loop.
fn angles(points: &[Pt], lengths: &[f32], min_arm: f32) -> Vec<f32> {
    let n = points.len();
    let mut result = vec![0.0f32; n];
    if n <= 1 || lengths.iter().sum::<f32>() <= 0.0 {
        return result;
    }
    let prev_of = |i: usize| if i == 0 { n - 1 } else { i - 1 };
    let (mut prev, mut next) = (0usize, 0usize);
    let (mut to_prev, mut to_next) = (0.0f32, 0.0f32);
    while to_prev < min_arm {
        prev = prev_of(prev);
        to_prev += lengths[prev];
    }
    for curr in 0..n {
        while to_prev - lengths[prev] > min_arm {
            to_prev -= lengths[prev];
            prev = (prev + 1) % n;
        }
        while to_next < min_arm {
            to_next += lengths[next];
            next = (next + 1) % n;
        }
        let (p0, p1, p2) = (points[prev], points[curr], points[next]);
        let v1 = ((p1.x - p0.x) as f64, (p1.y - p0.y) as f64);
        let v2 = ((p2.x - p1.x) as f64, (p2.y - p1.y) as f64);
        result[curr] = libm::atan2(v1.0 * v2.1 - v1.1 * v2.0, v1.0 * v2.0 + v1.1 * v2.1) as f32;
        to_prev += lengths[curr];
        to_next -= lengths[curr];
    }
    result
}

/// The outer wall loops of one object's islands on a layer as candidates (Orca's `process_perimeter_polygon` of each
/// `extract_perimeter_polygons`): each loop as printed, simplified and closed (its first point again at its end, as
/// an extrusion loop's points are), turned counter-clockwise.
fn gather(regions: &LayerRegions, object: u32, z: f32, width: f32, nozzle: f32, s: &Settings) -> LayerSeams {
    let mut out = LayerSeams::default();
    for island in regions.islands.iter().filter(|i| i.group == object) {
        let Some(outer) = island.walls.first() else { continue };
        for contour in outer {
            if contour.len() < 2 {
                continue;
            }
            let mut closed: Vec<Pt> = contour.clone();
            closed.push(contour[0]);
            let mut polygon = geom::simplify_line(&closed, s.resolution);
            let hole = geom::area2(&polygon) < 0;
            if hole {
                polygon.reverse();
            }
            let n = polygon.len();
            let mm = |p: Pt| (geom::unsc(p.x), geom::unsc(p.y));
            let mut lengths: Vec<f32> = (0..n - 1)
                .map(|i| {
                    let (a, b) = (mm(polygon[i]), mm(polygon[i + 1]));
                    norm(a.0 - b.0, a.1 - b.1) as f32
                })
                .collect();
            let (a, b) = (mm(polygon[0]), mm(polygon[n - 1]));
            lengths.push(norm(a.0 - b.0, a.1 - b.1).max(0.1) as f32);
            let turns = angles(&polygon, &lengths, nozzle);
            let index = out.perimeters.len();
            let start = out.points.len();
            for (k, p) in polygon.iter().enumerate() {
                let (x, y) = mm(*p);
                let angle = if hole { -turns[k] } else { turns[k] };
                out.points.push(Candidate {
                    position: [x as f32, y as f32, z],
                    perimeter: index,
                    visibility: 0.0,
                    overhang: 0.0,
                    embedded: 0.0,
                    angle,
                });
            }
            out.perimeters.push(Perimeter {
                hole,
                start,
                end: out.points.len(),
                seam: start,
                width,
                finalized: false,
                at: [0.0; 3],
            });
        }
    }
    out
}

/// The signed distance to an object's slice on a layer (Orca's `LinesDistancer::distance_from_lines<true>`):
/// negative inside.
struct Distancer {
    segments: Vec<[f64; 4]>,
    cell: f64,
    cells: HashMap<(i32, i32), Vec<u32>>,
    /// The segments that cross each row of cells, for the inside test.
    rows: HashMap<i32, Vec<u32>>,
}

impl Distancer {
    fn new(shapes: &[geom::Shape]) -> Distancer {
        let mut segments = Vec::new();
        for contour in shapes.iter().flatten() {
            for i in 0..contour.len() {
                let (a, b) = (contour[i], contour[(i + 1) % contour.len()]);
                segments.push([geom::unsc(a.x), geom::unsc(a.y), geom::unsc(b.x), geom::unsc(b.y)]);
            }
        }
        let cell = 1.0;
        let mut cells: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        let mut rows: HashMap<i32, Vec<u32>> = HashMap::new();
        for (k, s) in segments.iter().enumerate() {
            let (x0, x1) = ((s[0].min(s[2]) / cell).floor() as i32, (s[0].max(s[2]) / cell).floor() as i32);
            let (y0, y1) = ((s[1].min(s[3]) / cell).floor() as i32, (s[1].max(s[3]) / cell).floor() as i32);
            for y in y0..=y1 {
                rows.entry(y).or_default().push(k as u32);
                for x in x0..=x1 {
                    cells.entry((x, y)).or_default().push(k as u32);
                }
            }
        }
        Distancer { segments, cell, cells, rows }
    }

    fn distance(&self, x: f64, y: f64) -> f64 {
        if self.segments.is_empty() {
            return f64::INFINITY;
        }
        let (cx, cy) = ((x / self.cell).floor() as i32, (y / self.cell).floor() as i32);
        let mut best = f64::INFINITY;
        let mut ring = 0i32;
        loop {
            for dy in -ring..=ring {
                for dx in -ring..=ring {
                    if dx.abs() != ring && dy.abs() != ring {
                        continue;
                    }
                    if let Some(ids) = self.cells.get(&(cx + dx, cy + dy)) {
                        for &k in ids {
                            best = best.min(segment_distance2(&self.segments[k as usize], x, y));
                        }
                    }
                }
            }
            if best.sqrt() <= ring as f64 * self.cell || ring > 100_000 {
                break;
            }
            ring += 1;
        }
        let inside = self.rows.get(&cy).is_some_and(|ids| {
            let mut crossings = 0usize;
            for &k in ids {
                let s = &self.segments[k as usize];
                if (s[1] > y) != (s[3] > y) {
                    let at = s[0] + (y - s[1]) * (s[2] - s[0]) / (s[3] - s[1]);
                    if at > x {
                        crossings += 1;
                    }
                }
            }
            crossings % 2 == 1
        });
        if inside { -best.sqrt() } else { best.sqrt() }
    }
}

fn segment_distance2(s: &[f64; 4], x: f64, y: f64) -> f64 {
    let (dx, dy) = (s[2] - s[0], s[3] - s[1]);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((x - s[0]) * dx + (y - s[1]) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    let (px, py) = (s[0] + t * dx - x, s[1] + t * dy - y);
    px * px + py * py
}

/// Places the seams of every object on every layer, into each layer's `seams` (indexed by the islands' group: all of
/// an object's regions together, as Orca places an object's seams). `meshes` are the objects as sliced, one for each
/// group (an object made of parts, all of them), `slice_z` and `heights` each layer's slicing plane and height.
pub fn place(regions: &mut [LayerRegions], meshes: &[&Mesh], slice_z: &[f64], heights: &[f64], s: &Settings) {
    let mode = Mode::of(&s.seam_position);
    let regions_ref: &[LayerRegions] = regions;
    // Each object's on its own: Orca places each object's seams apart from the others'.
    let objects: Vec<Vec<LayerSeams>> = crate::par::map_range(meshes.len(), |o| {
        let object = o as u32;
        if !regions_ref.iter().any(|r| r.islands.iter().any(|i| i.group == object)) {
            return Vec::new();
        }
        object_seams(regions_ref, object, meshes[o], mode, slice_z, heights, s)
    });
    for layer in regions.iter_mut() {
        layer.seams = vec![LayerSeams::default(); meshes.len()];
    }
    for (o, layers) in objects.into_iter().enumerate() {
        for (l, seams) in layers.into_iter().enumerate() {
            regions[l].seams[o] = seams;
        }
    }
}

/// One object's seams on every layer.
fn object_seams(
    regions: &[LayerRegions],
    object: u32,
    mesh: &Mesh,
    mode: Mode,
    slice_z: &[f64],
    heights: &[f64],
    s: &Settings,
) -> Vec<LayerSeams> {
    let comparator = Comparator { rear: mode == Mode::Rear };
    let nozzle = s.nozzle_diameter as f32;
    let mut layers: Vec<LayerSeams> = crate::par::map_range(regions.len(), |l| {
        let width = crate::plan::flow(crate::region::Role::OuterWall, l == 0, heights[l], s).0 as f32;
        let mut seams = gather(&regions[l], object, slice_z[l] as f32, width, nozzle, s);
        // Where the object prints as more than one region with walls on the layer, how far inside its slice each
        // point is (Orca's `calculate_overhangs_and_layer_embedding`).
        let mut walled: Vec<u32> = regions[l]
            .islands
            .iter()
            .filter(|i| i.group == object && i.walls.first().is_some_and(|w| !w.is_empty()))
            .map(|i| i.object)
            .collect();
        walled.sort_unstable();
        walled.dedup();
        if walled.len() > 1 && !seams.points.is_empty() {
            let here = Distancer::new(&regions[l].slice_of(object));
            for p in &mut seams.points {
                let d = here.distance(f64::from(p.position[0]), f64::from(p.position[1]));
                p.embedded = (d + f64::from(0.65 * seams.perimeters[p.perimeter].width)) as f32;
            }
        }
        // How far each point hangs over the layer below (Orca's `calculate_overhangs_and_layer_embedding`).
        if l > 0 && !seams.points.is_empty() {
            let below = Distancer::new(&regions[l - 1].slice_of(object));
            let slope = f64::from(libm::tanf(OVERHANG_ANGLE)) * heights[l];
            for p in &mut seams.points {
                let d = below.distance(f64::from(p.position[0]), f64::from(p.position[1]));
                let w = seams.perimeters[p.perimeter].width;
                let over = (d + f64::from(0.65 * w) - slope) as f32;
                p.overhang = if over < 0.0 { 0.0 } else { over };
            }
        }
        seams
    });
    // How visible each candidate is, from the samples round it.
    if mode != Mode::Rear {
        let v = Visibility::of(mesh, mode == Mode::AlignedBack);
        let seen: Vec<Vec<f32>> =
            crate::par::map_range(layers.len(), |l| layers[l].points.iter().map(|p| v.at(p.position)).collect());
        for (layer, seen) in layers.iter_mut().zip(seen) {
            for (p, v) in layer.points.iter_mut().zip(seen) {
                p.visibility = v;
            }
        }
    }
    for seams in &mut layers {
        // Each loop's best candidate (Orca's `pick_seam_point`).
        for perimeter in &mut seams.perimeters {
            let mut seam = perimeter.start;
            for k in perimeter.start..perimeter.end {
                if comparator.better(&seams.points[k], &seams.points[seam]) {
                    seam = k;
                }
            }
            perimeter.seam = seam;
        }
        seams.cells = Cells::new(&seams.points, 2.0);
    }
    align(&mut layers, comparator, mode, nozzle);
    layers
}

/// One wall loop of the layer below or above, as Orca's `SeamContour` sees it: a loop's candidates, counter-clockwise.
struct Ring {
    points: Vec<[f64; 2]>,
    hole: bool,
    width: f64,
    min: [f64; 2],
    max: [f64; 2],
}

/// Orca's `SeamContour::Resolver`: which loops of the next layer continue a loop where a seam string passes, so that
/// a string doesn't jump to another wall that happens to be near.
struct Resolver {
    layers: Vec<Vec<Ring>>,
    nozzle: f64,
    cache: std::cell::RefCell<HashMap<Query, Resolved>>,
}

/// A resolution asked for: the layer, the loop, its point, which way, and the reach's bits.
type Query = (usize, usize, usize, i32, u64);

/// What a resolution found: the loops a string may continue on (empty: no restriction), and whether it couldn't say.
#[derive(Clone, Debug, Default)]
struct Resolved {
    contours: Vec<usize>,
    uncertain: bool,
}

/// Orca's `SeamContour::Options`.
const BOUNDS_NOZZLE_FACTOR: f64 = 1.25;
const RADIUS_WIDTH_FACTOR: f64 = 4.0;
const NOISE_WIDTH_FACTOR: f64 = 0.125;
const NORMAL_COSINE: f64 = 0.5;
const DOMINANCE_WIDTH_FACTOR: f64 = 0.25;
const DOMINANCE_ANGLE_DEGREES: f64 = 5.0;

struct Foot {
    point: [f64; 2],
    distance: f64,
}

fn box_distance(c: &Ring, p: [f64; 2]) -> f64 {
    let dx = (c.min[0] - p[0]).max(0.0) + (p[0] - c.max[0]).max(0.0);
    let dy = (c.min[1] - p[1]).max(0.0) + (p[1] - c.max[1]).max(0.0);
    norm(dx, dy)
}

/// The point of `c` nearest `p`; with `stop`, any vertex that close will do. With `source_normals`, only the sides
/// whose normal agrees with one of them (a thin loop's near side mustn't hide the side that faces the same way).
fn closest(c: &Ring, p: [f64; 2], stop: f64, source_normals: Option<&[[f64; 2]]>) -> Foot {
    let mut result = Foot { point: [0.0, 0.0], distance: f64::INFINITY };
    if stop >= 0.0 && source_normals.is_none() {
        for v in &c.points {
            let d = norm(v[0] - p[0], v[1] - p[1]);
            if d <= stop {
                return Foot { point: *v, distance: d };
            }
        }
    }
    let n = c.points.len();
    for i in 0..n {
        let a = c.points[i];
        let b = c.points[(i + 1) % n];
        let d = [b[0] - a[0], b[1] - a[1]];
        let length2 = d[0] * d[0] + d[1] * d[1];
        if let Some(normals) = source_normals {
            if length2 <= 1e-18 {
                continue;
            }
            let sign = if c.hole { -1.0 } else { 1.0 };
            let len = length2.sqrt();
            let normal = [sign * d[1] / len, sign * -d[0] / len];
            if !normals.iter().any(|m| m[0] * normal[0] + m[1] * normal[1] >= NORMAL_COSINE) {
                continue;
            }
        }
        let t =
            if length2 > 0.0 { (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / length2).clamp(0.0, 1.0) } else { 0.0 };
        let q = [a[0] + t * d[0], a[1] + t * d[1]];
        let distance = norm(q[0] - p[0], q[1] - p[1]);
        if distance < result.distance {
            result = Foot { point: q, distance };
        }
        if result.distance <= stop {
            break;
        }
    }
    result
}

/// The outward normals of the sides of `c` that `p` lies on.
fn normals(c: &Ring, p: [f64; 2]) -> Vec<[f64; 2]> {
    let mut out = Vec::new();
    let n = c.points.len();
    for i in 0..n {
        let a = c.points[i];
        let b = c.points[(i + 1) % n];
        let d = [b[0] - a[0], b[1] - a[1]];
        let l2 = d[0] * d[0] + d[1] * d[1];
        if l2 <= 1e-18 {
            continue;
        }
        let t = (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2).clamp(0.0, 1.0);
        if norm(a[0] + t * d[0] - p[0], a[1] + t * d[1] - p[1]) <= 1e-6 {
            let len = l2.sqrt();
            let sign = if c.hole { -1.0 } else { 1.0 };
            out.push([sign * d[1] / len, sign * -d[0] / len]);
        }
    }
    out
}

impl Resolver {
    fn new(layers: &[LayerSeams], nozzle: f64) -> Resolver {
        let rings = layers
            .iter()
            .map(|layer| {
                layer
                    .perimeters
                    .iter()
                    .map(|perimeter| {
                        let points: Vec<[f64; 2]> = layer.points[perimeter.start..perimeter.end]
                            .iter()
                            .map(|c| [f64::from(c.position[0]), f64::from(c.position[1])])
                            .collect();
                        let mut min = [f64::INFINITY; 2];
                        let mut max = [f64::NEG_INFINITY; 2];
                        for p in &points {
                            for k in 0..2 {
                                min[k] = min[k].min(p[k]);
                                max[k] = max[k].max(p[k]);
                            }
                        }
                        Ring { points, hole: perimeter.hole, width: f64::from(perimeter.width), min, max }
                    })
                    .collect()
            })
            .collect();
        Resolver { layers: rings, nozzle, cache: Default::default() }
    }

    /// The loops of a layer whose boxes come within `reach` of `p`, by index.
    fn query(&self, layer: usize, p: [f64; 2], reach: f64) -> Vec<usize> {
        self.layers[layer]
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                !c.points.is_empty()
                    && c.min[0] <= p[0] + reach
                    && c.max[0] >= p[0] - reach
                    && c.min[1] <= p[1] + reach
                    && c.max[1] >= p[1] - reach
            })
            .map(|(i, _)| i)
            .collect()
    }

    fn in_material(&self, layer: usize, p: [f64; 2]) -> bool {
        let mut inside = false;
        for i in self.query(layer, p, 0.0) {
            let c = &self.layers[layer][i];
            let n = c.points.len();
            for k in 0..n {
                let (a, b) = (c.points[k], c.points[(k + 1) % n]);
                if (a[1] > p[1]) != (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) {
                    inside = !inside;
                }
            }
        }
        inside
    }

    fn near_boundary(&self, layer: usize, p: [f64; 2], noise: f64) -> bool {
        self.query(layer, p, noise).into_iter().any(|i| {
            let c = &self.layers[layer][i];
            box_distance(c, p) <= noise && closest(c, p, noise, None).distance <= noise
        })
    }

    fn select(
        &self,
        layer: usize,
        contour: usize,
        p: [f64; 2],
        direction: i32,
        radius: f64,
        check_reverse: bool,
    ) -> Resolved {
        let target = (layer as i64 + direction as i64) as usize;
        let source = &self.layers[layer][contour];
        let next = &self.layers[target];
        let bounds = self.nozzle * BOUNDS_NOZZLE_FACTOR;
        let noise = source.width * NOISE_WIDTH_FACTOR;
        let reach = radius.max(bounds).max(noise);
        let candidates = self.query(target, p, reach);
        let mut fast = Vec::new();
        let mut nearby = Vec::new();
        for &i in &candidates {
            let c = &next[i];
            if c.points.len() < 3 {
                continue;
            }
            if box_distance(c, p) <= radius {
                nearby.push(i);
            }
            if c.hole == source.hole
                && (c.min[0] - source.min[0]).abs().max((c.min[1] - source.min[1]).abs()) <= bounds
                && (c.max[0] - source.max[0]).abs().max((c.max[1] - source.max[1]).abs()) <= bounds
            {
                fast.push(i);
            }
        }
        let source_normals = normals(source, p);
        let compatible_foot =
            |c: &Ring| closest(c, p, -1.0, if c.hole == source.hole { Some(&source_normals) } else { None });
        let agreement = |c: &Ring, foot: [f64; 2]| {
            let mut best = -1.0f64;
            for a in &source_normals {
                for b in normals(c, foot) {
                    best = best.max(a[0] * b[0] + a[1] * b[1]);
                }
            }
            best
        };
        if fast.len() == 1 {
            let index = fast[0];
            let foot = compatible_foot(&next[index]);
            if foot.distance <= noise && agreement(&next[index], foot.point) >= NORMAL_COSINE {
                let competing = nearby.iter().any(|&other| {
                    if other == index || box_distance(&next[other], p) > noise {
                        return false;
                    }
                    let alternative = compatible_foot(&next[other]);
                    alternative.distance <= noise && agreement(&next[other], alternative.point) >= NORMAL_COSINE
                });
                if !competing {
                    if !check_reverse {
                        return Resolved { contours: vec![index], uncertain: false };
                    }
                    let back = self.select(target, index, foot.point, -direction, radius, false);
                    if back.uncertain {
                        return back;
                    }
                    if back.contours.contains(&contour) {
                        return Resolved { contours: vec![index], uncertain: false };
                    }
                }
            }
        }
        let mut witnessed: Vec<(usize, f64, f64)> = Vec::new();
        for &i in &nearby {
            let foot = compatible_foot(&next[i]);
            if foot.distance > radius {
                continue;
            }
            let agree = agreement(&next[i], foot.point);
            if agree < NORMAL_COSINE {
                continue;
            }
            let mut band = true;
            if foot.distance > noise {
                for t in [0.25, 0.5, 0.75] {
                    let probe = [p[0] + t * (foot.point[0] - p[0]), p[1] + t * (foot.point[1] - p[1])];
                    if self.in_material(layer, probe) == self.in_material(target, probe)
                        && !self.near_boundary(layer, probe, noise)
                        && !self.near_boundary(target, probe, noise)
                    {
                        band = false;
                        break;
                    }
                }
            }
            if !band {
                continue;
            }
            if check_reverse {
                let back = self.select(target, i, foot.point, -direction, radius, false);
                if back.uncertain {
                    return back;
                }
                if !back.contours.contains(&contour) {
                    continue;
                }
            }
            witnessed.push((i, foot.distance, libm::acos(agree.clamp(-1.0, 1.0)) * 180.0 / libm::acos(-1.0)));
        }
        let distance_margin = (source.width * DOMINANCE_WIDTH_FACTOR).max(1e-6);
        let angle_margin = DOMINANCE_ANGLE_DEGREES.max(1e-6);
        let contours = witnessed
            .iter()
            .filter(|c| !witnessed.iter().any(|o| o.1 + distance_margin <= c.1 && o.2 + angle_margin <= c.2))
            .map(|c| c.0)
            .collect();
        Resolved { contours, uncertain: false }
    }

    fn resolve(&self, layer: usize, contour: usize, vertex: usize, direction: i32, radius: f64) -> Resolved {
        let source = &self.layers[layer][contour];
        let radius = if radius < 0.0 { source.width * RADIUS_WIDTH_FACTOR } else { radius };
        if !radius.is_finite() {
            return Resolved::default();
        }
        let key = (layer, contour, vertex, direction, radius.to_bits());
        if let Some(r) = self.cache.borrow().get(&key) {
            return r.clone();
        }
        let target = layer as i64 + direction as i64;
        let result = if target >= 0 && (target as usize) < self.layers.len() && source.points.len() >= 3 {
            self.select(layer, contour, source.points[vertex], direction, radius, true)
        } else {
            Resolved::default()
        };
        self.cache.borrow_mut().insert(key, result.clone());
        result
    }
}

/// Orca's `find_next_seam_in_layer`: on `layer`, a seam near `at` (within `reach`) that a string from `previous`
/// can go on to: the loop's own seam if it is the nearest point, else the nearest point or the best nearby one if
/// either is not much worse than that loop's seam.
fn next_seam(
    layers: &[LayerSeams],
    at: [f32; 3],
    layer: usize,
    reach: f32,
    comparator: Comparator,
    resolver: &Resolver,
    previous: (usize, usize),
) -> Option<(usize, usize)> {
    let source = &layers[previous.0].points[previous.1];
    let source_perimeter = &layers[previous.0].perimeters[source.perimeter];
    let direction = if layer > previous.0 { 1 } else { -1 };
    let continuation = resolver
        .resolve(previous.0, source.perimeter, previous.1 - source_perimeter.start, direction, f64::from(reach))
        .contours;
    let here = &layers[layer];
    let (mut best, mut nearest): (Option<usize>, Option<usize>) = (None, None);
    for k in here.cells.within(&here.points, at, reach) {
        let point = &here.points[k];
        if !continuation.is_empty() && !continuation.contains(&point.perimeter) {
            continue;
        }
        let (Some(b), Some(n)) = (best, nearest) else {
            best = Some(k);
            nearest = Some(k);
            continue;
        };
        if here.perimeters[point.perimeter].finalized {
            continue;
        }
        if comparator.better(point, &here.points[b]) || here.perimeters[here.points[b].perimeter].finalized {
            best = Some(k);
        }
        if dist2(point.position, at) < dist2(here.points[n].position, at)
            || here.perimeters[here.points[n].perimeter].finalized
        {
            nearest = Some(k);
        }
    }
    let (best, nearest) = (best?, nearest?);
    let nearest_perimeter = &here.perimeters[here.points[nearest].perimeter];
    if nearest_perimeter.finalized {
        return None;
    }
    let seam = &here.points[nearest_perimeter.seam];
    let width = nearest_perimeter.width;
    if comparator.not_much_worse(&here.points[nearest], seam, width) {
        return Some((layer, nearest));
    }
    if comparator.not_much_worse(&here.points[best], seam, here.perimeters[here.points[best].perimeter].width) {
        return Some((layer, best));
    }
    None
}

/// Orca's `find_seam_string`: from a seam, the seams above it layer by layer as long as there are, then those below.
fn seam_string(
    layers: &[LayerSeams],
    start: (usize, usize),
    comparator: Comparator,
    resolver: &Resolver,
) -> Vec<(usize, usize)> {
    let mut string = vec![start];
    let reach = ALIGN_REACH * layers[start.0].perimeters[layers[start.0].points[start.1].perimeter].width;
    for step in [1i64, -1] {
        let mut previous = start;
        let mut layer = start.0 as i64 + step;
        while layer >= 0 && (layer as usize) < layers.len() {
            let mut at = layers[previous.0].points[previous.1].position;
            at[2] = layers[layer as usize].points.first().map_or(at[2], |p| p.position[2]);
            match next_seam(layers, at, layer as usize, reach, comparator, resolver, previous) {
                Some(next) => {
                    string.push(next);
                    previous = next;
                    layer += step;
                }
                None => break,
            }
        }
    }
    string
}

/// The cubic B-spline's weight at `x` segments from a knot.
fn kernel(x: f32) -> f32 {
    let x = x.abs();
    if x >= 2.0 {
        return 0.0;
    }
    if x <= 1.0 {
        let (x2, x3) = (x * x, x * x * x);
        return 4.0 / 6.0 - x2 + 0.5 * x3;
    }
    let x = x - 1.0;
    let (x2, x3) = (x * x, x * x * x);
    1.0 / 6.0 - 0.5 * x + 0.5 * x2 - (1.0 / 6.0) * x3
}

/// A cubic B-spline through weighted points in the plane along z (Orca's `fit_cubic_bspline`, least squares).
struct Curve {
    coefficients: Vec<[f64; 2]>,
    start: f32,
    segment: f32,
}

impl Curve {
    fn fit(observations: &[[f32; 2]], zs: &[f32], weights: &[f32], segments: usize) -> Curve {
        let start = zs[0];
        let segment = (zs[zs.len() - 1] - start) / segments as f32;
        let params = segments + 1;
        let n = zs.len();
        let mut t = vec![vec![0.0f64; params]; n];
        let mut b = vec![[0.0f64; 2]; n];
        for i in 0..n {
            let w = weights[i].sqrt();
            b[i] = [f64::from(observations[i][0] * w), f64::from(observations[i][1] * w)];
            let middle = ((zs[i] - start) / segment).floor() as i64;
            for s in middle - 1..middle + 3 {
                let knot = start + s as f32 * segment;
                let k = kernel((knot - zs[i]) / segment) * w;
                let j = s.clamp(0, params as i64 - 1) as usize;
                t[i][j] += f64::from(k);
            }
        }
        Curve { coefficients: least_squares(t, b, params), start, segment }
    }

    fn at(&self, z: f32) -> [f32; 2] {
        let middle = ((z - self.start) / self.segment).floor() as i64;
        let mut out = [0.0f64; 2];
        for s in middle - 1..middle + 3 {
            let knot = self.start + s as f32 * self.segment;
            let k = f64::from(kernel((knot - z) / self.segment));
            let j = s.clamp(0, self.coefficients.len() as i64 - 1) as usize;
            out[0] += k * self.coefficients[j][0];
            out[1] += k * self.coefficients[j][1];
        }
        [out[0] as f32, out[1] as f32]
    }
}

/// The least-squares solution of `a x = b` (two right-hand sides), by Householder QR with column pivoting; columns
/// that add nothing keep a zero coefficient, as Eigen's pivoting QR leaves them.
fn least_squares(mut a: Vec<Vec<f64>>, mut b: Vec<[f64; 2]>, cols: usize) -> Vec<[f64; 2]> {
    let rows = a.len();
    let mut perm: Vec<usize> = (0..cols).collect();
    let mut norms: Vec<f64> = (0..cols).map(|j| (0..rows).map(|i| a[i][j] * a[i][j]).sum()).collect();
    let largest = norms.iter().cloned().fold(0.0, f64::max).sqrt();
    let mut rank = 0;
    for k in 0..cols.min(rows) {
        // The column with the most left in it.
        let (p, best) = (k..cols).map(|j| (j, norms[j])).fold((k, -1.0), |m, x| if x.1 > m.1 { x } else { m });
        if best.sqrt() <= 1e-9 * largest.max(1e-300) {
            break;
        }
        if p != k {
            for row in a.iter_mut() {
                row.swap(k, p);
            }
            norms.swap(k, p);
            perm.swap(k, p);
        }
        let alpha = {
            let s: f64 = (k..rows).map(|i| a[i][k] * a[i][k]).sum::<f64>().sqrt();
            if a[k][k] > 0.0 { -s } else { s }
        };
        let mut v: Vec<f64> = (k..rows).map(|i| a[i][k]).collect();
        v[0] -= alpha;
        let vv: f64 = v.iter().map(|x| x * x).sum();
        if vv > 0.0 {
            for j in k..cols {
                let d: f64 = (k..rows).map(|i| v[i - k] * a[i][j]).sum();
                let f = 2.0 * d / vv;
                for i in k..rows {
                    a[i][j] -= f * v[i - k];
                }
            }
            for c in 0..2 {
                let d: f64 = (k..rows).map(|i| v[i - k] * b[i][c]).sum();
                let f = 2.0 * d / vv;
                for i in k..rows {
                    b[i][c] -= f * v[i - k];
                }
            }
        }
        for j in k + 1..cols {
            norms[j] = (k + 1..rows).map(|i| a[i][j] * a[i][j]).sum();
        }
        rank = k + 1;
    }
    let mut x = vec![[0.0f64; 2]; cols];
    for k in (0..rank).rev() {
        for c in 0..2 {
            let mut s = b[k][c];
            for j in k + 1..rank {
                s -= a[k][j] * x[j][c];
            }
            x[k][c] = s / a[k][k];
        }
    }
    let mut out = vec![[0.0f64; 2]; cols];
    for k in 0..cols {
        out[perm[k]] = x[k];
    }
    out
}

/// Orca's `place_on_loop`: where on the loop of candidate `index` a seam aimed at `target` lands: the nearest point
/// of the loop whose normal (blended along each side from its corners') passes through the target.
fn place_on_loop(points: &[Candidate], perimeter: &Perimeter, index: usize, target: [f32; 3]) -> [f32; 3] {
    let start = perimeter.start;
    let count = perimeter.end - start;
    if count < 2 {
        return points[index].position;
    }
    let next = |i: usize| start + (i - start + 1) % count;
    let prev = |i: usize| start + (i - start + count - 1) % count;
    let xy = |i: usize| [f64::from(points[i].position[0]), f64::from(points[i].position[1])];
    let distinct = |i: usize, forward: bool| {
        let mut j = i;
        for _ in 1..count {
            j = if forward { next(j) } else { prev(j) };
            if xy(j) != xy(i) {
                return j;
            }
        }
        i
    };
    let edge_normal = |a: [f64; 2], b: [f64; 2]| {
        let d = [b[0] - a[0], b[1] - a[1]];
        let l = norm(d[0], d[1]);
        if l > 0.0 { [-d[1] / l, d[0] / l] } else { [0.0, 0.0] }
    };
    let vertex_normal = |i: usize| {
        let a = edge_normal(xy(distinct(i, false)), xy(i));
        let b = edge_normal(xy(i), xy(distinct(i, true)));
        let sum = [a[0] + b[0], a[1] + b[1]];
        // Eigen's `normalized()`: over the square root of the squared norm, where that isn't 0.
        let n2 = sum[0] * sum[0] + sum[1] * sum[1];
        if n2 > 0.0 {
            let l = n2.sqrt();
            [sum[0] / l, sum[1] / l]
        } else {
            [0.0, 0.0]
        }
    };
    let cross = |a: [f64; 2], b: [f64; 2]| a[0] * b[1] - a[1] * b[0];
    let p = [f64::from(target[0]), f64::from(target[1])];
    let mut best: Option<[f64; 2]> = None;
    let mut best_distance = f64::INFINITY;
    let mut cursor = [index, index];
    let mut arc = [0.0f64, 0.0];
    for _ in 0..count {
        let forward = arc[1] <= arc[0];
        let side = usize::from(forward);
        let i = cursor[side];
        let j = if forward { next(i) } else { prev(i) };
        let (a, b) = if forward { (i, j) } else { (j, i) };
        let d = [xy(b)[0] - xy(a)[0], xy(b)[1] - xy(a)[1]];
        let length = norm(d[0], d[1]);
        let g = [p[0] - xy(a)[0], p[1] - xy(a)[1]];
        let u_closest =
            if length > 0.0 { ((g[0] * d[0] + g[1] * d[1]) / (length * length)).clamp(0.0, 1.0) } else { 0.0 };
        let off = [g[0] - u_closest * d[0], g[1] - u_closest * d[1]];
        if length > 0.0 && off[0] * off[0] + off[1] * off[1] < best_distance {
            let (mut na, mut nb) = (vertex_normal(a), vertex_normal(b));
            if na == [0.0, 0.0] || nb == [0.0, 0.0] {
                na = edge_normal(xy(a), xy(b));
                nb = na;
            }
            let m = [nb[0] - na[0], nb[1] - na[1]];
            let c0 = cross(g, na);
            let c1 = cross(g, m) - cross(d, na);
            let c2 = -cross(d, m);
            let mut consider = |u: f64| {
                if !(0.0..=1.0).contains(&u) {
                    return;
                }
                let q = [g[0] - u * d[0], g[1] - u * d[1]];
                let distance = q[0] * q[0] + q[1] * q[1];
                if distance < best_distance {
                    best = Some([xy(a)[0] + u * d[0], xy(a)[1] + u * d[1]]);
                    best_distance = distance;
                }
            };
            const EPS: f64 = 1e-12;
            if c2.abs() < EPS && c1.abs() < EPS {
                if c0.abs() < EPS {
                    consider(u_closest);
                }
            } else if c2.abs() < EPS {
                consider(-c0 / c1);
            } else {
                let discriminant = c1 * c1 - 4.0 * c2 * c0;
                if discriminant >= 0.0 {
                    let root = discriminant.sqrt();
                    consider((-c1 - root) / (2.0 * c2));
                    consider((-c1 + root) / (2.0 * c2));
                }
            }
        }
        arc[side] += length;
        cursor[side] = j;
    }
    match best {
        Some(q) => [q[0] as f32, q[1] as f32, points[index].position[2]],
        None => points[index].position,
    }
}

/// Orca's `align_seam_points`: from the best seams down, each not yet placed starts a string (the longest of those
/// started from its string's seams), and a string of six or more is smoothed by a fitted curve.
fn align(layers: &mut [LayerSeams], comparator: Comparator, mode: Mode, nozzle: f32) {
    let resolver = Resolver::new(layers, f64::from(nozzle));
    let mut seams: Vec<(usize, usize)> = Vec::new();
    for (l, layer) in layers.iter().enumerate() {
        for perimeter in &layer.perimeters {
            seams.push((l, perimeter.seam));
        }
    }
    seams.sort_by(|a, b| {
        let (pa, pb) = (&layers[a.0].points[a.1], &layers[b.0].points[b.1]);
        if comparator.better(pa, pb) {
            std::cmp::Ordering::Less
        } else if comparator.better(pb, pa) {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    let mut global = 0usize;
    while global < seams.len() {
        let (layer, seam) = seams[global];
        global += 1;
        let perimeter = layers[layer].points[seam].perimeter;
        if layers[layer].perimeters[perimeter].finalized {
            continue;
        }
        let mut string = seam_string(layers, (layer, seam), comparator, &resolver);
        let step = 1 + string.len() / 20;
        let mut alternative = 0;
        while alternative < string.len() {
            let (l, k) = string[alternative];
            let own = layers[l].perimeters[layers[l].points[k].perimeter].seam;
            let other = seam_string(layers, (l, own), comparator, &resolver);
            if other.len() > string.len() {
                string = other;
            }
            alternative += step;
        }
        if string.len() < MIN_STRING {
            continue;
        }
        string.sort_by_key(|s| s.0);
        // The seam that started it comes round again: an alternative string may have left it out.
        global -= 1;
        let mut observations = Vec::with_capacity(string.len());
        let mut zs = Vec::with_capacity(string.len());
        let mut weights = Vec::with_capacity(string.len());
        let mut total = 0.0f32;
        let mut last = layers[string[0].0].points[string[0].1].position;
        for (index, &(l, k)) in string.iter().enumerate() {
            let current = &layers[l].points[k];
            let mut turn = 0.0f32;
            if index > 0 && index < string.len() - 1 {
                // Orca's `angle_3d`: between the unit steps from the seam below and to the seam above.
                let before = layers[string[index - 1].0].points[string[index - 1].1].position;
                let after = layers[string[index + 1].0].points[string[index + 1].1].position;
                let a = unit([
                    current.position[0] - before[0],
                    current.position[1] - before[1],
                    current.position[2] - before[2],
                ]);
                let b = unit([
                    after[0] - current.position[0],
                    after[1] - current.position[1],
                    after[2] - current.position[2],
                ]);
                turn = libm::acosf(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).abs();
            }
            observations.push([current.position[0], current.position[1]]);
            zs.push(current.position[2]);
            weights.push(1.0 / (0.1 + angle_penalty(current.angle)));
            let curling = if turn > 2.0 * current.angle.abs() { -0.8 } else { 1.0 };
            total += curling * dist2(last, current.position).sqrt();
            last = current.position;
        }
        if mode == Mode::Rear {
            total *= 0.3;
        }
        let segments = ((total.max(0.0) / MM_PER_SEGMENT) as usize).max(1);
        let curve = Curve::fit(&observations, &zs, &weights, segments);
        for &(l, k) in &string {
            let candidate = layers[l].points[k].clone();
            let t = libm::powf(candidate.angle.abs() / SHARP_ANGLE, 3.0).min(1.0);
            let fitted = curve.at(candidate.position[2]);
            let target = [
                t * candidate.position[0] + (1.0 - t) * fitted[0],
                t * candidate.position[1] + (1.0 - t) * fitted[1],
                candidate.position[2],
            ];
            let perimeter = layers[l].perimeters[candidate.perimeter].clone();
            let at =
                if t >= 1.0 { candidate.position } else { place_on_loop(&layers[l].points, &perimeter, k, target) };
            let p = &mut layers[l].perimeters[candidate.perimeter];
            p.seam = k;
            p.at = at;
            p.finalized = true;
        }
    }
}

impl LayerSeams {
    /// A wall loop (`contour`, round an outline or a hole, `outer` for the outer wall) as printed: from its seam,
    /// counter-clockwise round an outline and clockwise round a hole, its first point again at its end. None where
    /// the layer has no seams for it.
    pub fn wall_loop(&self, contour: &Contour, outline: bool, outer: bool, s: &Settings) -> Option<Vec<Pt>> {
        if self.perimeters.is_empty() || contour.len() < 2 {
            return None;
        }
        let mut points: Vec<Pt> = contour.clone();
        if (geom::area2(&points) < 0) == outline {
            points.reverse();
        }
        let z = self.points[0].position[2];
        let mm = |p: Pt| [geom::unsc(p.x) as f32, geom::unsc(p.y) as f32, z];
        // The outer wall it goes round: the nearest candidate's loop, once two points of it in a row agree (Orca's
        // `place_seam`, against T-junctions).
        let mut found = None;
        for &p in &points {
            let nearest = self.cells.nearest(&self.points, mm(p))?;
            let perimeter = self.points[nearest].perimeter;
            if found == Some(perimeter) {
                break;
            }
            found = Some(perimeter);
        }
        let perimeter = &self.perimeters[found?];
        let seam_index = perimeter.seam;
        let position = if perimeter.finalized { perimeter.at } else { self.points[seam_index].position };
        let seam = geom::pt(geom::sc(f64::from(position[0])), geom::sc(f64::from(position[1])));
        let mut start = seam;
        if !outer {
            // Into the corner where the outer wall's seam is in a concave one, else the nearest point.
            let candidate = &self.points[seam_index];
            let (foot, _) = closest_on_loop(&points, seam);
            let mut depth = (geom::dist(seam, foot) / geom::SCALE) as f32;
            let beta = libm::cosf(candidate.angle / 2.0);
            let n = perimeter.end - perimeter.start;
            let prev = perimeter.start + (seam_index - perimeter.start + n - 1) % n;
            let next = perimeter.start + (seam_index - perimeter.start + 1) % n;
            let moved = [position[0] - candidate.position[0], position[1] - candidate.position[1]];
            start = foot;
            if moved[0] * moved[0] + moved[1] * moved[1] < depth && candidate.angle < -1e-4 {
                let unit = |a: [f32; 3], b: [f32; 3]| {
                    let d = [a[0] - b[0], a[1] - b[1]];
                    let l = (d[0] * d[0] + d[1] * d[1]).sqrt();
                    if l > 0.0 { [d[0] / l, d[1] / l] } else { d }
                };
                let a = unit(candidate.position, self.points[prev].position);
                let b = unit(candidate.position, self.points[next].position);
                let middle = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
                depth = ORCA_SQRT_2 * depth / beta;
                let target = [candidate.position[0] + depth * middle[0], candidate.position[1] + depth * middle[1]];
                let target = geom::pt(geom::sc(f64::from(target[0])), geom::sc(f64::from(target[1])));
                start = closest_on_loop(&points, target).0;
            } else {
                depth = depth * beta / ORCA_SQRT_2;
            }
            if s.staggered_inner_seams {
                start = stagger(&points, start, depth.max(s.inner_wall_width as f32));
            }
        }
        Some(split_at(points, start))
    }
}

/// The point of a closed loop nearest `p`, and the index of the side it lies on.
fn closest_on_loop(points: &[Pt], p: Pt) -> (Pt, usize) {
    let n = points.len();
    let mut best = (points[0], 0usize, f64::INFINITY);
    for i in 0..n {
        let (a, b) = (points[i], points[(i + 1) % n]);
        let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
        let l2 = dx * dx + dy * dy;
        let t = if l2 > 0.0 { (((p.x - a.x) as f64 * dx + (p.y - a.y) as f64 * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
        let q = geom::pt((a.x as f64 + t * dx).round() as i32, (a.y as f64 + t * dy).round() as i32);
        let d = geom::dist(q, p);
        if d < best.2 {
            best = (q, i, d);
        }
    }
    (best.0, best.1)
}

/// `depth` mm further along the loop from `from` (Orca's staggered inner seams).
fn stagger(points: &[Pt], from: Pt, depth: f32) -> Pt {
    let n = points.len();
    let (_, mut i) = closest_on_loop(points, from);
    let mut at = from;
    let mut left = f64::from(depth) * geom::SCALE;
    for _ in 0..n {
        let b = points[(i + 1) % n];
        let d = geom::dist(at, b);
        if d > left {
            let f = left / d;
            return geom::pt(
                (at.x as f64 + (b.x - at.x) as f64 * f).round() as i32,
                (at.y as f64 + (b.y - at.y) as f64 * f).round() as i32,
            );
        }
        left -= d;
        at = b;
        i = (i + 1) % n;
    }
    at
}

/// The loop from `p`, closed: rotated to the vertex within 1.5 µm of it (Orca's `split_at_vertex`), else with it put
/// in where the loop passes nearest.
fn split_at(mut points: Vec<Pt>, p: Pt) -> Vec<Pt> {
    let eps = 0.0015 * geom::SCALE;
    if let Some(k) = points.iter().position(|&q| geom::dist(q, p) <= eps) {
        points.rotate_left(k);
    } else {
        let (foot, i) = closest_on_loop(&points, p);
        points.insert(i + 1, foot);
        points.rotate_left(i + 1);
    }
    points.push(points[0]);
    points.dedup();
    if points.len() == 1 {
        points.push(points[0]);
    }
    points
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_concave_corner_costs_least_and_a_straight_wall_most() {
        let (concave, straight, convex) = (angle_penalty(-1.5), angle_penalty(0.0), angle_penalty(1.5));
        assert!(concave < convex && convex < straight, "{concave} {convex} {straight}");
    }

    #[test]
    fn a_curve_fitted_to_points_on_a_line_bends_at_its_ends_as_orca_s_does() {
        // Orca's fit (`fit_cubic_bspline` in Geometry/Curves.hpp) folds the parameters past either end into the
        // last ones, so even a straight line comes out bent near its ends: these are its values for this line.
        let zs: Vec<f32> = (0..20).map(|k| 0.2 + k as f32 * 0.2).collect();
        let observations: Vec<[f32; 2]> = zs.iter().map(|z| [10.0 + z, 5.0]).collect();
        let weights = vec![1.0; zs.len()];
        let curve = Curve::fit(&observations, &zs, &weights, 3);
        for (k, x) in [(0, 10.247536), (3, 10.768806), (9, 12.007162), (12, 12.575456), (18, 13.807272)] {
            let p = curve.at(zs[k]);
            assert!((p[0] - x).abs() < 1e-4 && (p[1] - 5.0).abs() < 1e-4, "{}: {p:?} {x}", zs[k]);
        }
    }

    #[test]
    fn angles_turn_left_at_a_square_s_corners() {
        let square: Vec<Pt> = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0)]
            .map(|(x, y)| geom::pt(geom::sc(x), geom::sc(y)))
            .to_vec();
        let lengths = vec![10.0, 10.0, 10.0, 10.0, 0.1];
        let a = angles(&square, &lengths, 0.4);
        for k in 1..4 {
            assert!((a[k] - std::f32::consts::FRAC_PI_2).abs() < 1e-5, "{a:?}");
        }
    }
}
