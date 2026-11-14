//! Sparse infill as OrcaSlicer 2.5 draws it (`libslic3r/Fill/`): the crosshatch, gyroid, grid, cubic, honeycomb,
//! triangles, tri-hexagon, quarter cubic and lateral lattice patterns, laid out in the object's own frame (centred on its bounding box, turned by the infill direction), and
//! lightning's trees (grown for the whole object in `lightning.rs`), cut to
//! the area (crosshatch's and gyroid's short bits dropped), then joined along the area's edge as Orca's `connect_infill` joins them: two lines whose ends are close
//! along the edge become one path, and an end that joins nothing hooks a short anchor onto the edge. Lines whose ends
//! lie within two spacings of each other then print as one path (`join_close_ends`).
//!
//! Orca works in nanometres; the patterns are computed in nanometres here too, so they line up where Orca's do.

use crate::geom::{self, Contour, Pt, Shape, Shapes};
use std::f64::consts::{FRAC_PI_2, PI};

/// Orca's `SCALED_EPSILON` (100 nm), in our units.
pub(crate) const EPS: f64 = 1.0;
/// Our units in a nanometre.
const UNITS_PER_NM: f64 = geom::SCALE / 1e6;
/// No contour: a line's end that isn't on the area's edge.
pub(crate) const NONE: usize = usize::MAX;

/// The sparse infill patterns drawn here, by Orca's names.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Pattern {
    Crosshatch,
    Gyroid,
    /// Lines two ways, a quarter turn apart, the same on every layer (`FillGrid`).
    Grid,
    /// Lines three ways, 60° apart, shifted with the height so they build cubes standing on a corner (`FillCubic`).
    Cubic,
    /// Lines three ways, 60° apart, the same on every layer: triangles (`FillTriangles`).
    Triangles,
    /// Lines three ways, 60° apart, the third shifted by one and a half lines' spacing: six-pointed stars between
    /// hexagons (Orca's "tri-hexagon", `FillStars`).
    TriHexagon,
    /// Lines two ways, a quarter turn apart, each way twice, the pairs drawn apart and together with the height so they
    /// build half tetrahedra (`FillQuarterCubic`).
    QuarterCubic,
    /// Lines one way, in two sets that lean either way with the height, each set at its lattice angle from upright, so
    /// the walls cross as a lattice seen from the side (`FillLateralLattice`).
    LateralLattice,
    /// Hexagons, turned by 60° from layer to layer (`FillHoneycomb`).
    Honeycomb,
    /// Trees that hold up the top surfaces from inside and nothing else (`FillLightning`), from `Sparse::trees`.
    Lightning,
}

impl Pattern {
    pub fn of(name: &str) -> Option<Pattern> {
        match name {
            "crosshatch" => Some(Pattern::Crosshatch),
            "gyroid" => Some(Pattern::Gyroid),
            "grid" => Some(Pattern::Grid),
            "cubic" => Some(Pattern::Cubic),
            "triangles" => Some(Pattern::Triangles),
            "tri-hexagon" => Some(Pattern::TriHexagon),
            "quartercubic" => Some(Pattern::QuarterCubic),
            "lateral-lattice" => Some(Pattern::LateralLattice),
            "honeycomb" => Some(Pattern::Honeycomb),
            "lightning" => Some(Pattern::Lightning),
            _ => None,
        }
    }
}

/// What a layer's sparse infill is drawn with.
#[derive(Clone, Debug)]
pub struct Sparse<'a> {
    pub pattern: Pattern,
    /// Where the object's pattern is anchored: the centre of its bounding box on the plate (units).
    pub origin: (f64, f64),
    /// The layer's top, mm.
    pub z: f64,
    /// The layer's number, from 0 (honeycomb turns with it, grid's lines run the other way on odd layers).
    pub layer: usize,
    /// The infill direction, degrees.
    pub angle: f64,
    /// Centre to centre of two touching infill lines at the object's layer height, mm.
    pub spacing: f64,
    /// From 0 to 1.
    pub density: f64,
    /// How far an end that joins nothing follows the edge (Orca's `infill_anchor`), mm.
    pub anchor: f64,
    /// The longest stretch of edge that joins two lines (`infill_anchor_max`), mm.
    pub anchor_max: f64,
    /// Lightning's lines on this layer for the whole object (units), each from a tip towards its tree's root.
    pub trees: &'a [Vec<Pt>],
    /// Lateral lattice's two angles, degrees from upright.
    pub lattice_angles: [f64; 2],
}

/// The infill of `area`, each of its shapes grown by `grow` mm first (Orca's overlap with the walls, less half a
/// spacing: where the lines' middles may go), as polylines each printed in one go.
pub fn sparse(area: &Shapes, grow: f64, p: &Sparse) -> Vec<Contour> {
    let mut out = Vec::new();
    for shape in area {
        let mut lines = Vec::new();
        let one: Shapes = vec![shape.clone()];
        for part in geom::offset(&one, grow) {
            lines.extend(fill_part(&part, p));
        }
        join_close_ends(&mut lines, 2.0 * p.spacing * geom::SCALE);
        out.extend(lines.into_iter().filter(|l| l.len() >= 2));
    }
    out
}

fn fill_part(part: &Shape, p: &Sparse) -> Vec<Vec<Pt>> {
    if part.first().is_none_or(|outer| outer.len() < 3) || p.density <= 0.0 || p.spacing <= 0.0 {
        return Vec::new();
    }
    let lines: Vec<Vec<(f64, f64)>> = match p.pattern {
        Pattern::Crosshatch | Pattern::Gyroid => return waves(part, p),
        Pattern::Grid
        | Pattern::Cubic
        | Pattern::Triangles
        | Pattern::TriHexagon
        | Pattern::QuarterCubic
        | Pattern::LateralLattice => multilines(part, p),
        Pattern::Honeycomb => honeycomb(part, p),
        Pattern::Lightning => {
            p.trees.iter().map(|line| line.iter().map(|q| (q.x as f64, q.y as f64)).collect()).collect()
        }
    };
    let grid = EdgeGrid::new(part, 2.0 * geom::SCALE, 0.0);
    let pieces: Vec<Piece> = clip(&lines, &grid).into_iter().filter(|c| c.points.len() >= 2).collect();
    let mut joined = if pieces.is_empty() {
        Vec::new()
    } else if p.anchor_max < 0.05 {
        pieces.into_iter().map(|c| c.points).collect()
    } else {
        connect(
            pieces,
            part,
            p.spacing * geom::SCALE,
            p.anchor.min(p.anchor_max) * geom::SCALE,
            p.anchor_max * geom::SCALE,
        )
    };
    // Orca's grid and lateral lattice run their lines the other way on odd layers.
    if matches!(p.pattern, Pattern::Grid | Pattern::LateralLattice) && p.layer % 2 == 1 {
        for line in &mut joined {
            line.reverse();
        }
    }
    joined
}

/// Crosshatch and gyroid: their pattern in the object's frame, cut to the part, short bits dropped, joined.
fn waves(part: &Shape, p: &Sparse) -> Vec<Vec<Pt>> {
    // Orca turns the area by minus the angle (a float) about the object's centre; the gyroid by 45° less.
    let angle = match p.pattern {
        Pattern::Gyroid => (p.angle.to_radians() as f32 as f64 + (-45f64).to_radians()) as f32 as f64,
        _ => p.angle.to_radians() as f32 as f64,
    };
    let frame = Frame::new(p.origin, if angle.abs() < 1e-4 { 0.0 } else { angle });
    // The outer contour's bounding box in the frame, nm.
    let mut bb = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    for &q in &part[0] {
        let (x, y) = frame.to(q);
        let (x, y) = (x.round() as i64, y.round() as i64);
        bb = [bb[0].min(x), bb[1].min(y), bb[2].max(x), bb[3].max(y)];
    }
    let pattern = match p.pattern {
        Pattern::Gyroid => gyroid(bb, p.z, p.spacing, p.density),
        _ => crosshatch(bb, p.z, p.spacing, p.density),
    };
    let lines: Vec<Vec<(f64, f64)>> =
        pattern.into_iter().map(|l| l.into_iter().map(|q| frame.from(q)).collect()).collect();
    let grid = EdgeGrid::new(part, 2.0 * geom::SCALE, 0.0);
    let min_length = 0.8 * p.spacing * geom::SCALE;
    let pieces: Vec<Piece> = clip(&lines, &grid).into_iter().filter(|c| length(&c.points) >= min_length).collect();
    if pieces.is_empty() {
        return Vec::new();
    }
    if p.anchor_max < 0.05 {
        return pieces.into_iter().map(|c| c.points).collect();
    }
    connect(pieces, part, p.spacing * geom::SCALE, p.anchor.min(p.anchor_max) * geom::SCALE, p.anchor_max * geom::SCALE)
}

/// The object's frame: centred on it, turned by the angle, in nanometres.
struct Frame {
    origin: (f64, f64),
    cos: f64,
    sin: f64,
}

impl Frame {
    fn new(origin: (f64, f64), angle: f64) -> Frame {
        Frame { origin, cos: angle.cos(), sin: angle.sin() }
    }
    /// From the plate (units) into the frame (nm).
    fn to(&self, q: Pt) -> (f64, f64) {
        let x = (q.x as f64 - self.origin.0) / UNITS_PER_NM;
        let y = (q.y as f64 - self.origin.1) / UNITS_PER_NM;
        (x * self.cos + y * self.sin, -x * self.sin + y * self.cos)
    }
    /// From the frame (nm) onto the plate (units).
    fn from(&self, (x, y): (f64, f64)) -> (f64, f64) {
        (
            self.origin.0 + (x * self.cos - y * self.sin) * UNITS_PER_NM,
            self.origin.1 + (x * self.sin + y * self.cos) * UNITS_PER_NM,
        )
    }
}

/// `v` rounded down to a multiple of `step` (Orca's `align_to_grid`).
fn align(v: i64, step: i64) -> i64 {
    v.div_euclid(step) * step
}

// ---- Grid and cubic (FillRectilinear.cpp, `fill_surface_by_multilines`) ----

/// Grid's and cubic's lines on the plate (units), uncut: for each of the pattern's directions, Orca's `make_fill_lines`
/// in the object's frame turned that way, lines across the part's box as far apart as the density shared between
/// the directions asks, on a grid from the object's centre shifted by the direction's pattern shift.
fn multilines(part: &Shape, p: &Sparse) -> Vec<Vec<(f64, f64)>> {
    // Orca's `_infill_direction` (floats): the infill angle and a quarter turn; no pattern here turns layer by layer.
    let base = p.angle.to_radians() as f32 + std::f32::consts::FRAC_PI_2;
    // Each way's angle from that, and how far it is shifted across (mm): the patterns' `SweepParams`.
    let (third, two_thirds) = (std::f32::consts::FRAC_PI_3, (std::f64::consts::PI * 2.0 / 3.0) as f32);
    let sweeps: Vec<(f32, f32)> = match p.pattern {
        Pattern::Cubic => {
            let dx = ((0.5f64).sqrt() * p.z) as f32;
            vec![(0.0, dx), (third, -dx), (two_thirds, dx)]
        }
        Pattern::Triangles => vec![(0.0, 0.0), (third, 0.0), (two_thirds, 0.0)],
        Pattern::TriHexagon => {
            vec![(0.0, 0.0), (third, 0.0), (two_thirds, ((3.0 / 2.0) * p.spacing / p.density) as f32)]
        }
        Pattern::QuarterCubic => {
            let (dx1, dx2) = quarter_cubic_shifts(p);
            let q = std::f32::consts::FRAC_PI_2;
            vec![(0.0, dx1), (0.0, -dx1), (q, dx2), (q, -dx2)]
        }
        Pattern::LateralLattice => {
            let dx = |deg: f64| (deg.to_radians().tan() * p.z) as f32;
            let q = std::f32::consts::FRAC_PI_2;
            vec![(q, dx(p.lattice_angles[0])), (q, dx(p.lattice_angles[1]))]
        }
        _ => vec![(0.0, 0.0), (std::f32::consts::FRAC_PI_2, 0.0)],
    };
    let density = p.density / sweeps.len() as f64;
    let line_spacing = (p.spacing * 1e6 / density) as i64;
    if line_spacing <= 0 {
        return Vec::new();
    }
    // Orca's lines run as far as the area before it is drawn in by half a spacing, less a spacing and a hair.
    let margin = (p.spacing * 1e6) as i64 + 100;
    let half = (0.5 * p.spacing * 1e6).round() as i64;
    let mut out = Vec::new();
    for (angle_base, shift) in sweeps {
        let angle = (base + angle_base) as f64;
        let frame = Frame::new(p.origin, angle);
        let mut bb = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
        for &q in &part[0] {
            let (x, y) = frame.to(q);
            let (x, y) = (x.round() as i64, y.round() as i64);
            bb = [bb[0].min(x - half), bb[1].min(y - half), bb[2].max(x + half), bb[3].max(y + half)];
        }
        let (x_min, x_max) = (bb[0] + margin, bb[2] - margin);
        // The grid's reference: the object's centre, less the pattern's shift (Orca's `align_to_grid`).
        let shifted = ((shift as f64) * 1e6) as i64 % line_spacing;
        let reference = -(if shifted >= 0 { shifted } else { line_spacing + shifted });
        let x0 = reference + (bb[0] - reference).div_euclid(line_spacing) * line_spacing;
        let n = (bb[2] - x0 + line_spacing - 1) / line_spacing;
        for k in 0..n.max(0) {
            let x = x0 + k * line_spacing;
            if x < x_min {
                continue;
            }
            if x > x_max {
                break;
            }
            let (x, y0, y1) = (x as f64, (bb[1] - 1) as f64, (bb[3] + 1) as f64);
            out.push(vec![frame.from((x, y0)), frame.from((x, y1))]);
        }
    }
    out
}

/// Quarter cubic's two shifts (mm), each half of its tetrahedral fill drawn across by the height within a period of
/// four lines, the second half a period's half behind: Orca's `FillQuarterCubic`, in its integers and floats.
fn quarter_cubic_shifts(p: &Sparse) -> (f32, f32) {
    let line_width = (p.spacing * 1e6) as i64;
    let period = ((p.spacing * 1e6 / p.density) as i64) * 4;
    if period <= 0 {
        return (0.0, 0.0);
    }
    let shift = |pattern_z_shift: f64| {
        let mut shift = (std::f32::consts::FRAC_1_SQRT_2 as f64 * (p.z * 1e6 + pattern_z_shift * period as f64 * 2.0))
            as i64
            % period;
        shift = shift.min(period - shift);
        shift = shift.min(period / 2 - line_width / 2);
        shift = shift.max(line_width / 2);
        (shift as f64 / 1e6) as f32
    };
    (shift(0.0), shift(0.5))
}

// ---- Honeycomb (FillHoneycomb.cpp) ----

/// Orca's honeycomb on the plate (units), uncut: columns of half hexagons drawn as zig-zags, in a frame turned by the
/// infill angle, 60° more each layer and a quarter turn, about the first hexagon's centre, on a grid from the
/// object's centre.
fn honeycomb(part: &Shape, p: &Sparse) -> Vec<Vec<(f64, f64)>> {
    // Orca's `_infill_direction` (floats), with honeycomb's turn of 60° a layer.
    let layer_angle = (std::f64::consts::PI / 3.0) as f32 * (p.layer % 3) as f32;
    let angle = (p.angle.to_radians() as f32 + layer_angle + std::f32::consts::FRAC_PI_2) as f64;
    let min_spacing = (p.spacing * 1e6) as i64;
    let distance = (min_spacing as f64 / p.density) as i64;
    if distance <= 0 {
        return Vec::new();
    }
    let s3 = 3f64.sqrt();
    let hex_side = (distance as f64 / (s3 / 2.0)) as i64;
    let hex_width = distance * 2;
    let pattern_height = hex_side * 2 + hex_side;
    let y_short = (distance as f64 * s3 / 3.0) as i64;
    let x_offset = min_spacing / 2;
    let y_offset = (x_offset as f64 * s3 / 3.0) as i64;
    let centre = ((hex_width / 2) as f64, hex_side as f64);
    // Orca's `Point::rotate` about the centre, rounded to the nanometre.
    let rotate = |(x, y): (f64, f64), a: f64| -> (f64, f64) {
        let (s, c) = a.sin_cos();
        let (dx, dy) = (x - centre.0, y - centre.1);
        ((centre.0 + c * dx - s * dy).round(), (centre.1 + c * dy + s * dx).round())
    };
    // The object's frame, in nanometres from its centre.
    let to_nm = |q: Pt| ((q.x as f64 - p.origin.0) / UNITS_PER_NM, (q.y as f64 - p.origin.1) / UNITS_PER_NM);
    let from_nm = |(x, y): (f64, f64)| (p.origin.0 + x * UNITS_PER_NM, p.origin.1 + y * UNITS_PER_NM);
    // The part's box, turned the other way about the centre, on the pattern's grid.
    let mut bb = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    for &q in &part[0] {
        let (x, y) = to_nm(q);
        let (x, y) = (x.round() as i64, y.round() as i64);
        bb = [bb[0].min(x), bb[1].min(y), bb[2].max(x), bb[3].max(y)];
    }
    let corners = [(bb[0], bb[1]), (bb[2], bb[1]), (bb[2], bb[3]), (bb[0], bb[3])];
    let mut turned = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    for (x, y) in corners {
        let (x, y) = rotate((x as f64, y as f64), angle);
        let (x, y) = (x as i64, y as i64);
        turned = [turned[0].min(x), turned[1].min(y), turned[2].max(x), turned[3].max(y)];
    }
    turned[0] = turned[0].min(align(turned[0], hex_width));
    turned[1] = turned[1].min(align(turned[1], pattern_height));
    let step = y_short + hex_side + y_short + hex_side;
    if step <= 0 {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut x = turned[0];
    while x <= turned[2] {
        let mut line: Vec<(i64, i64)> = Vec::new();
        let mut ax = [x + x_offset, x + distance - x_offset];
        for _ in 0..2 {
            line.reverse();
            let mut y = turned[1];
            while y <= turned[3] {
                line.push((ax[1], y + y_offset));
                line.push((ax[0], y + y_short - y_offset));
                line.push((ax[0], y + y_short + hex_side + y_offset));
                line.push((ax[1], y + y_short + hex_side + y_short - y_offset));
                line.push((ax[1], y + y_short + hex_side + y_short + hex_side + y_offset));
                y += step;
            }
            ax = [ax[1] + distance, ax[0] + distance];
            x += distance;
        }
        out.push(line.into_iter().map(|(x, y)| from_nm(rotate((x as f64, y as f64), -angle))).collect());
    }
    out
}

// ---- Crosshatch (FillCrossHatch.cpp) ----

/// Orca's crosshatch over the box (nm, in the frame): straight lines that turn 90° every few millimetres of height,
/// through layers where they bend from one direction into the other.
fn crosshatch(bb: [i64; 4], z: f64, spacing: f64, density: f64) -> Vec<Vec<(f64, f64)>> {
    let mut line_spacing = (spacing * 1e6 / density) as i64;
    if density < 0.999 {
        line_spacing = (line_spacing as f64 * 1.08) as i64;
    }
    if line_spacing <= 0 {
        return Vec::new();
    }
    let min = (align(bb[0], line_spacing * 4), align(bb[1], line_spacing * 4));
    let (width, height) = ((bb[2] - min.0) as f64, (bb[3] - min.1) as f64);
    let repeat_ratio = if density < 0.3 { (1.0 - (-5.0 * density).exp()).clamp(0.2, 1.0) } else { 1.0 };
    let mut lines = crosshatch_layer(z * 1e6, repeat_ratio, line_spacing as f64, width, height);
    for line in &mut lines {
        for q in line.iter_mut() {
            *q = (q.0 + min.0 as f64, q.1 + min.1 as f64);
        }
    }
    lines
}

fn crosshatch_layer(z: f64, repeat_ratio: f64, grid: f64, width: f64, height: f64) -> Vec<Vec<(f64, f64)>> {
    let trans_size = grid * 0.4;
    let repeat_size = grid * repeat_ratio;
    // Offset to make the first layers stronger.
    let z = z + repeat_size / 2.0 + trans_size;
    let period = trans_size + repeat_size;
    let remains = z - (z / period).floor() * period;
    let trans_z = remains - repeat_size;
    let phase = ((z % (period * 2.0)) - (period - 1.0)) as i32;
    let direction = if phase <= 0 { -1 } else { 1 };
    if trans_z < 0.0 {
        repeat_pattern(direction, grid, width, height)
    } else {
        let progress = (trans_z % trans_size) / trans_size;
        if progress < 0.5 {
            transform_pattern((progress + 0.1) * 2.0, direction, grid, width, height)
        } else {
            transform_pattern((1.1 - progress) * 2.0, -direction, grid, width, height)
        }
    }
}

fn swap_xy(lines: &mut [Vec<(f64, f64)>]) {
    for line in lines {
        for q in line.iter_mut() {
            *q = (q.1, q.0);
        }
    }
}

fn repeat_pattern(direction: i32, grid: f64, width: f64, height: f64) -> Vec<Vec<(f64, f64)>> {
    let (width, height) = if direction < 0 { (height, width) } else { (width, height) };
    let n = (height / grid + 1.0) as i32;
    let mut lines: Vec<Vec<(f64, f64)>> =
        (0..n).map(|i| vec![(0.0, (grid * i as f64).round()), (width.round(), (grid * i as f64).round())]).collect();
    if direction < 0 {
        swap_xy(&mut lines);
    }
    lines
}

fn transform_pattern(progress: f64, direction: i32, grid: f64, width: f64, height: f64) -> Vec<Vec<(f64, f64)>> {
    let grid_size = grid * 2.0;
    let offset = progress / 8.0 * grid_size;
    let cycle = [
        (0.25 * grid_size - offset, offset),
        (0.25 * grid_size + offset, offset),
        (0.75 * grid_size - offset, -offset),
        (0.75 * grid_size + offset, -offset),
    ];
    let (width, height) = if direction < 0 { (height, width) } else { (width, height) };
    let cycles = (width / grid_size + 2.0) as i32;
    let row: Vec<(f64, f64)> = (0..cycles)
        .flat_map(|i| cycle.iter().map(move |&(x, y)| ((x + i as f64 * grid_size).round(), y.round())))
        .collect();
    let rows = (height / grid_size + 2.0) as i32;
    let mut lines: Vec<Vec<(f64, f64)>> = Vec::with_capacity(2 * rows as usize);
    for i in 0..rows {
        let dy = (grid_size * i as f64).round();
        lines.push(row.iter().map(|&(x, y)| (x, y + dy)).collect());
    }
    for i in 0..rows {
        let (dx, dy) = ((-0.5 * grid_size).round(), ((i as f64 + 0.5) * grid_size).round());
        lines.push(row.iter().map(|&(x, y)| (x + dx, y + dy)).collect());
    }
    if direction < 0 {
        swap_xy(&mut lines);
    }
    lines
}

// ---- Gyroid (FillGyroid.cpp) ----

const GYROID_DENSITY_ADJUST: f64 = 2.44;
const GYROID_TOLERANCE: f64 = 0.2;

/// Orca's gyroid over the box (nm, in the frame): waves whose shape shifts with the height.
fn gyroid(bb: [i64; 4], z: f64, spacing: f64, density: f64) -> Vec<Vec<(f64, f64)>> {
    let density_adjusted = (density * GYROID_DENSITY_ADJUST).max(0.0);
    if density_adjusted <= 0.0 {
        return Vec::new();
    }
    let distance = (spacing * 1e6 / density_adjusted) as i64;
    let shift = (10.0 * spacing * 1e6) as i64;
    let cell = (2.0 * PI * distance as f64).round() as i64;
    if cell <= 0 {
        return Vec::new();
    }
    let origin = (align(bb[0], cell) - shift, align(bb[1], cell) - shift);
    let grow = (spacing * 1e6).round() as i64;
    let bb = [bb[0] - grow, bb[1] - grow, bb[2] + grow, bb[3] + grow];
    gyroid_waves(z * 1e6, density_adjusted, spacing, bb, origin)
}

fn gyroid_f(x: f64, z_sin: f64, z_cos: f64, vertical: bool, flip: bool) -> f64 {
    if vertical {
        let phase_offset = (if z_cos < 0.0 { PI } else { 0.0 }) + PI;
        let a = (x + phase_offset).sin();
        let b = -z_cos;
        let res = z_sin * (x + phase_offset + if flip { PI } else { 0.0 }).cos();
        let r = (a * a + b * b).sqrt();
        (a / r).asin() + (res / r).asin() + PI
    } else {
        let phase_offset = if z_sin < 0.0 { PI } else { 0.0 };
        let a = (x + phase_offset).cos();
        let b = -z_sin;
        let res = z_cos * (x + phase_offset + if flip { 0.0 } else { PI }).sin();
        let r = (a * a + b * b).sqrt();
        (a / r).asin() + (res / r).asin() + 0.5 * PI
    }
}

/// One period of a wave, refined until it is within the tolerance.
fn one_period(z_cos: f64, z_sin: f64, vertical: bool, flip: bool, tolerance: f64) -> Vec<(f64, f64)> {
    let limit = 2.0 * PI;
    let mut points = Vec::new();
    let mut x = 0.0;
    while x < limit - 1e-4 {
        points.push((x, gyroid_f(x, z_sin, z_cos, vertical, flip)));
        x += FRAC_PI_2;
    }
    points.push((limit, gyroid_f(limit, z_sin, z_cos, vertical, flip)));
    // Orca adds every middle that strays from its chord, then sorts by x; adding them in place is the same.
    loop {
        let mut refined = Vec::with_capacity(points.len() * 2);
        for i in 1..points.len() {
            let (lp, rp) = (points[i - 1], points[i]);
            refined.push(lp);
            let x = lp.0 + (rp.0 - lp.0) / 2.0;
            let ip = (x, gyroid_f(x, z_sin, z_cos, vertical, flip));
            let (a, b) = ((ip.0 - lp.0, ip.1 - lp.1), (ip.0 - rp.0, ip.1 - rp.1));
            if (a.0 * b.1 - a.1 * b.0).abs() > tolerance * tolerance {
                refined.push(ip);
            }
        }
        refined.push(*points.last().unwrap());
        if refined.len() == points.len() {
            break;
        }
        points = refined;
    }
    points
}

/// Sorts entries by their keys, then by their index. The infill's and the surfaces' only sort: each sort Rust
/// instantiates costs some ten kilobytes of WebAssembly.
pub(crate) fn sort_keyed(entries: &mut [([f64; 4], usize)]) {
    entries.sort_unstable_by(|a, b| {
        for k in 0..4 {
            match a.0[k].total_cmp(&b.0[k]) {
                std::cmp::Ordering::Equal => continue,
                other => return other,
            }
        }
        a.1.cmp(&b.1)
    });
}

fn make_wave(
    period_points: &[(f64, f64)],
    x_min: f64,
    x_max: f64,
    offset: f64,
    scale: f64,
    vertical: bool,
) -> Vec<(f64, f64)> {
    let period = period_points.last().unwrap().0;
    let n = period_points.len() - 1;
    let mut x0 = (x_min / period).floor() * period;
    let mut i = 0;
    while i + 1 < n && x0 + period_points[i + 1].0 <= x_min {
        i += 1;
    }
    let mut out = Vec::new();
    loop {
        let mut q = (x0 + period_points[i].0, period_points[i].1 + offset);
        let last = q.0 >= x_max;
        if vertical {
            q = (q.1, q.0);
        }
        out.push(((q.0 * scale).trunc(), (q.1 * scale).trunc()));
        if last {
            break;
        }
        i += 1;
        if i == n {
            i = 0;
            x0 += period;
        }
    }
    out
}

fn gyroid_waves(
    grid_z: f64,
    density_adjusted: f64,
    spacing: f64,
    bb: [i64; 4],
    origin: (i64, i64),
) -> Vec<Vec<(f64, f64)>> {
    let scale = spacing * 1e6 / density_adjusted;
    let tolerance = (spacing / 2.0).min(GYROID_TOLERANCE) / (scale / 1e6);
    let z = grid_z / scale;
    let (z_sin, z_cos) = (z.sin(), z.cos());
    let vertical = z_sin.abs() <= z_cos.abs();
    let mut lo = ((bb[0] - origin.0) as f64 / scale, (bb[1] - origin.1) as f64 / scale);
    let mut hi = ((bb[2] - origin.0) as f64 / scale, (bb[3] - origin.1) as f64 / scale);
    let mut lower_bound = 0.0;
    let mut flip = true;
    if vertical {
        flip = false;
        lower_bound = -PI;
        lo = (lo.1, lo.0);
        hi = (hi.1, hi.0);
    }
    let odd = one_period(z_cos, z_sin, vertical, flip, tolerance);
    let even = one_period(z_cos, z_sin, vertical, !flip, tolerance);
    let (mut f_min, mut f_max) = (f64::MAX, f64::MIN);
    for q in odd.iter().chain(&even) {
        f_min = f_min.min(q.1);
        f_max = f_max.max(q.1);
    }
    let mut out = Vec::new();
    let mut i = ((lo.1 - f_max - lower_bound) / PI).ceil() as i64;
    while lower_bound + i as f64 * PI + f_min <= hi.1 {
        let wave =
            make_wave(if i % 2 == 0 { &odd } else { &even }, lo.0, hi.0, lower_bound + i as f64 * PI, scale, vertical);
        out.push(wave.into_iter().map(|(x, y)| (x + origin.0 as f64, y + origin.1 as f64)).collect());
        i += 1;
    }
    out
}

// ---- Cutting the pattern to the area ----

/// Contour edges sorted into square cells, to find the edges near a segment.
pub(crate) struct EdgeGrid {
    x0: f64,
    y0: f64,
    cell: f64,
    nx: i64,
    ny: i64,
    cells: Vec<Vec<u32>>,
    /// Each edge: its ends, its contour and the index of its first point there.
    pub(crate) edges: Vec<(Pt, Pt, usize, usize)>,
}

impl EdgeGrid {
    pub(crate) fn new(contours: &[Contour], cell: f64, margin: f64) -> EdgeGrid {
        let mut b = [f64::MAX, f64::MAX, f64::MIN, f64::MIN];
        for c in contours {
            for q in c {
                b = [b[0].min(q.x as f64), b[1].min(q.y as f64), b[2].max(q.x as f64), b[3].max(q.y as f64)];
            }
        }
        let (x0, y0) = (b[0] - margin - cell, b[1] - margin - cell);
        let nx = (((b[2] + margin + cell - x0) / cell).ceil() as i64).max(1);
        let ny = (((b[3] + margin + cell - y0) / cell).ceil() as i64).max(1);
        let mut grid =
            EdgeGrid { x0, y0, cell, nx, ny, cells: vec![Vec::new(); (nx * ny) as usize], edges: Vec::new() };
        for (k, c) in contours.iter().enumerate() {
            let n = c.len();
            for i in 0..n {
                let (a, z) = (c[i], c[(i + 1) % n]);
                let id = grid.edges.len() as u32;
                grid.edges.push((a, z, k, i));
                let (cx0, cy0) = grid.cell_of((a.x.min(z.x) as f64, a.y.min(z.y) as f64));
                let (cx1, cy1) = grid.cell_of((a.x.max(z.x) as f64, a.y.max(z.y) as f64));
                for cy in cy0.max(0)..=cy1.min(ny - 1) {
                    for cx in cx0.max(0)..=cx1.min(nx - 1) {
                        grid.cells[(cy * nx + cx) as usize].push(id);
                    }
                }
            }
        }
        grid
    }

    /// The edges in cell (x, y).
    fn cell_edges(&self, x: i64, y: i64) -> &[u32] {
        &self.cells[(y * self.nx + x) as usize]
    }

    fn cell_of(&self, q: (f64, f64)) -> (i64, i64) {
        (((q.0 - self.x0) / self.cell).floor() as i64, ((q.1 - self.y0) / self.cell).floor() as i64)
    }

    /// The edges in the cells the segment a–b passes through, each once, into `out`.
    pub(crate) fn edges_along(&self, a: (f64, f64), b: (f64, f64), out: &mut Vec<u32>) {
        out.clear();
        let (ax, ay) = ((a.0 - self.x0) / self.cell, (a.1 - self.y0) / self.cell);
        let (bx, by) = ((b.0 - self.x0) / self.cell, (b.1 - self.y0) / self.cell);
        let (mut ix, mut iy) = (ax.floor() as i64, ay.floor() as i64);
        let (ex, ey) = (bx.floor() as i64, by.floor() as i64);
        let (dx, dy) = (bx - ax, by - ay);
        let (step_x, step_y) = (if dx > 0.0 { 1 } else { -1 }, if dy > 0.0 { 1 } else { -1 });
        let delta_x = if dx != 0.0 { (1.0 / dx).abs() } else { f64::INFINITY };
        let delta_y = if dy != 0.0 { (1.0 / dy).abs() } else { f64::INFINITY };
        let mut max_x = if dx > 0.0 {
            ((ix + 1) as f64 - ax) / dx
        } else if dx < 0.0 {
            (ix as f64 - ax) / dx
        } else {
            f64::INFINITY
        };
        let mut max_y = if dy > 0.0 {
            ((iy + 1) as f64 - ay) / dy
        } else if dy < 0.0 {
            (iy as f64 - ay) / dy
        } else {
            f64::INFINITY
        };
        let steps = (ex - ix).abs() + (ey - iy).abs() + 2;
        for _ in 0..=steps {
            if (0..self.nx).contains(&ix) && (0..self.ny).contains(&iy) {
                out.extend_from_slice(self.cell_edges(ix, iy));
            }
            if ix == ex && iy == ey {
                break;
            }
            if max_x < max_y {
                ix += step_x;
                max_x += delta_x;
            } else {
                iy += step_y;
                max_y += delta_y;
            }
        }
        out.sort_unstable();
        out.dedup();
    }

    /// Whether a point is inside the contours (non-zero winding), from the edges to its right.
    pub(crate) fn inside(&self, q: (f64, f64)) -> bool {
        let (cx, cy) = self.cell_of(q);
        if !(0..self.ny).contains(&cy) {
            return false;
        }
        let mut ids: Vec<u32> = Vec::new();
        for x in cx.max(0)..self.nx {
            ids.extend_from_slice(self.cell_edges(x, cy));
        }
        ids.sort_unstable();
        ids.dedup();
        let mut winding = 0;
        for id in ids {
            let (a, b, _, _) = self.edges[id as usize];
            let (ax, ay, bx, by) = (a.x as f64, a.y as f64, b.x as f64, b.y as f64);
            let side = (bx - ax) * (q.1 - ay) - (by - ay) * (q.0 - ax);
            if ay <= q.1 {
                if by > q.1 && side > 0.0 {
                    winding += 1;
                }
            } else if by <= q.1 && side < 0.0 {
                winding -= 1;
            }
        }
        winding != 0
    }
}

/// Where a line's end meets the area's edge: the contour, the edge (by its first point) and how far along it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct End {
    pub(crate) contour: usize,
    pub(crate) edge: usize,
    pub(crate) u: f64,
}

/// A stretch of pattern inside the area, and where each of its ends meets the edge (none if it ends inside).
#[derive(Clone, Debug)]
pub(crate) struct Piece {
    pub(crate) points: Vec<Pt>,
    pub(crate) ends: [Option<End>; 2],
}

/// Where segments a–b and c–d cross: how far along a–b, and along c–d (from c, half open so a corner counts once).
pub(crate) fn crossing(a: (f64, f64), b: (f64, f64), c: Pt, d: Pt) -> Option<(f64, f64)> {
    let (cx, cy, dx, dy) = (c.x as f64, c.y as f64, d.x as f64, d.y as f64);
    let r = (b.0 - a.0, b.1 - a.1);
    let s = (dx - cx, dy - cy);
    let den = r.0 * s.1 - r.1 * s.0;
    if den.abs() <= 1e-12 * (r.0.hypot(r.1) * s.0.hypot(s.1)) || den == 0.0 {
        return None;
    }
    let q = (cx - a.0, cy - a.1);
    let t = (q.0 * s.1 - q.1 * s.0) / den;
    let u = (q.0 * r.1 - q.1 * r.0) / den;
    ((0.0..=1.0).contains(&t) && (0.0..1.0).contains(&u)).then_some((t, u))
}

pub(crate) fn to_pt(q: (f64, f64)) -> Pt {
    geom::pt(q.0.round() as i32, q.1.round() as i32)
}

pub(crate) fn push_point(points: &mut Vec<Pt>, q: Pt) {
    if points.last() != Some(&q) {
        points.push(q);
    }
}

/// The parts of the lines inside the shape (Clipper's `intersection_pl`), each with where it meets the edge.
fn clip(lines: &[Vec<(f64, f64)>], grid: &EdgeGrid) -> Vec<Piece> {
    let mut out = Vec::new();
    let mut ids = Vec::new();
    for line in lines {
        if line.len() < 2 {
            continue;
        }
        // Every crossing with an edge, in order along the line: (segment, t, where).
        let mut cuts: Vec<(usize, f64, End)> = Vec::new();
        for s in 0..line.len() - 1 {
            grid.edges_along(line[s], line[s + 1], &mut ids);
            for &id in &ids {
                let (c, d, contour, edge) = grid.edges[id as usize];
                if let Some((t, u)) = crossing(line[s], line[s + 1], c, d) {
                    cuts.push((s, t, End { contour, edge, u }));
                }
            }
        }
        let mut order: Vec<([f64; 4], usize)> =
            cuts.iter().enumerate().map(|(i, c)| ([c.0 as f64, c.1, 0.0, 0.0], i)).collect();
        sort_keyed(&mut order);
        let cuts: Vec<(usize, f64, End)> = order.iter().map(|&(_, i)| cuts[i]).collect();
        let at = |s: usize, t: f64| {
            let (a, b) = (line[s], line[s + 1]);
            (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)
        };
        // Walk from cut to cut; a stretch is inside when a point just past its start is.
        let mut stops: Vec<(usize, f64, Option<End>)> = vec![(0, 0.0, None)];
        stops.extend(cuts.iter().map(|&(s, t, e)| (s, t, Some(e))));
        stops.push((line.len() - 2, 1.0, None));
        let mut current: Option<Piece> = None;
        for w in stops.windows(2) {
            let ((s0, t0, e0), (s1, t1, e1)) = (w[0], w[1]);
            let start = at(s0, t0);
            // The stretch's points after its start: the corners it passes, then its end.
            let mut rest: Vec<(f64, f64)> = (s0 + 1..=s1).map(|v| line[v]).collect();
            rest.push(at(s1, t1));
            let Some(&next) = rest.iter().find(|q| (q.0 - start.0).hypot(q.1 - start.1) > 1e-6) else { continue };
            if !grid.inside(((start.0 + next.0) / 2.0, (start.1 + next.1) / 2.0)) {
                if let Some(piece) = current.take() {
                    out.push(piece);
                }
                continue;
            }
            // Inside: a new piece, or more of the last one where the line only touched the edge.
            let piece = current.get_or_insert_with(|| Piece { points: vec![to_pt(start)], ends: [e0, None] });
            for q in rest {
                push_point(&mut piece.points, to_pt(q));
            }
            piece.ends[1] = e1;
        }
        if let Some(piece) = current.take() {
            out.push(piece);
        }
    }
    out.retain(|p| p.points.len() >= 2);
    out
}

/// The parts of polylines inside an area (Clipper's `intersection_pl`).
pub fn clip_polylines(lines: &[Vec<Pt>], area: &Shapes) -> Vec<Vec<Pt>> {
    let contours: Vec<Contour> = area.iter().flatten().cloned().collect();
    if contours.is_empty() || lines.is_empty() {
        return Vec::new();
    }
    let grid = EdgeGrid::new(&contours, 2.0 * geom::SCALE, 0.0);
    let lines: Vec<Vec<(f64, f64)>> =
        lines.iter().map(|l| l.iter().map(|q| (q.x as f64, q.y as f64)).collect()).collect();
    clip(&lines, &grid).into_iter().map(|piece| piece.points).collect()
}

fn length(points: &[Pt]) -> f64 {
    points.windows(2).map(|w| geom::dist(w[0], w[1])).sum()
}

// ---- Joining the lines along the edge (FillBase.cpp, connect_infill) ----

/// Where a line's end meets the edge, and what of the edge around it is still free.
#[derive(Clone, Debug)]
pub(crate) struct Joint {
    pub(crate) contour: usize,
    pub(crate) point: usize,
    /// Length along the contour to it from the contour's first point.
    pub(crate) param: f64,
    /// The joints before and after it along the contour (itself when it is the only one).
    pub(crate) prev: usize,
    pub(crate) next: usize,
    /// Edge not yet taken going back and going on.
    pub(crate) free_prev: f64,
    pub(crate) free_next: f64,
    /// Its line has been joined or anchored, or can't be.
    pub(crate) consumed: bool,
    pub(crate) prev_trimmed: bool,
    pub(crate) next_trimmed: bool,
}

pub(crate) struct Graph {
    /// The contours with each line's end inserted as a point.
    pub(crate) boundary: Vec<Vec<Pt>>,
    /// Length along each contour to each of its points; the last is the whole length.
    pub(crate) params: Vec<Vec<f64>>,
    /// Two per line: its first point's joint, then its last's.
    pub(crate) joints: Vec<Joint>,
    /// Each contour's joints, in order along it.
    pub(crate) along: Vec<Vec<usize>>,
}

pub(crate) fn ccw(from: f64, to: f64, length: f64) -> f64 {
    let d = to - from;
    if d < 0.0 { d + length } else { d }
}

pub(crate) fn cw(from: f64, to: f64, length: f64) -> f64 {
    ccw(to, from, length)
}

pub(crate) fn consume_prev(j: &mut [Joint], i: usize) {
    j[i].free_prev = 0.0;
    j[i].prev_trimmed = true;
    j[i].consumed = true;
}

pub(crate) fn consume_next(j: &mut [Joint], i: usize) {
    j[i].free_next = 0.0;
    j[i].next_trimmed = true;
    j[i].consumed = true;
}

pub(crate) fn trim_prev(j: &mut [Joint], i: usize, length: f64) {
    if length < j[i].free_prev {
        j[i].free_prev = length;
        j[i].prev_trimmed = true;
    }
}

pub(crate) fn trim_next(j: &mut [Joint], i: usize, length: f64) {
    if length < j[i].free_next {
        j[i].free_next = length;
        j[i].next_trimmed = true;
    }
}

pub(crate) fn could_take_prev(j: &[Joint], i: usize) -> bool {
    !j[i].consumed && j[i].free_prev > EPS
}

pub(crate) fn could_take_next(j: &[Joint], i: usize) -> bool {
    !j[i].consumed && j[i].free_next > EPS
}

fn could_connect_prev(j: &[Joint], i: usize) -> bool {
    let p = j[i].prev;
    !j[i].consumed && p != i && !j[p].consumed && !j[i].prev_trimmed && !j[p].next_trimmed
}

fn could_connect_next(j: &[Joint], i: usize) -> bool {
    let n = j[i].next;
    !j[i].consumed && n != i && !j[n].consumed && !j[i].next_trimmed && !j[n].prev_trimmed
}

impl Graph {
    pub(crate) fn new(pieces: &[Piece], shape: &Shape, spacing: f64) -> Graph {
        let blank = |i: usize| Joint {
            contour: NONE,
            point: NONE,
            param: 0.0,
            prev: i,
            next: i,
            free_prev: f64::MAX,
            free_next: f64::MAX,
            consumed: false,
            prev_trimmed: false,
            next_trimmed: false,
        };
        let mut joints: Vec<Joint> = (0..pieces.len() * 2).map(blank).collect();
        let mut keyed: Vec<([f64; 4], usize)> = Vec::new();
        for (i, piece) in pieces.iter().enumerate() {
            for (k, end) in piece.ends.iter().enumerate() {
                if let Some(e) = end {
                    keyed.push(([e.contour as f64, e.edge as f64, e.u, 0.0], 2 * i + k));
                }
            }
        }
        sort_keyed(&mut keyed);
        let ends: Vec<(usize, usize, f64, usize)> =
            keyed.iter().map(|&(k, id)| (k[0] as usize, k[1] as usize, k[2], id)).collect();
        let end_point = |id: usize| {
            let points = &pieces[id / 2].points;
            if id.is_multiple_of(2) { points[0] } else { *points.last().unwrap() }
        };
        let mut boundary = Vec::with_capacity(shape.len());
        let mut params = Vec::with_capacity(shape.len());
        let mut along = Vec::with_capacity(shape.len());
        let mut it = 0;
        for (k, src) in shape.iter().enumerate() {
            let mut dst: Vec<Pt> = Vec::with_capacity(src.len());
            let mut on: Vec<usize> = Vec::new();
            for (i, &q) in src.iter().enumerate() {
                push_point(&mut dst, q);
                while it < ends.len() && ends[it].0 == k && ends[it].1 == i {
                    let id = ends[it].3;
                    let q = end_point(id);
                    let mut point = 0;
                    if i + 1 < src.len() || q != dst[0] {
                        push_point(&mut dst, q);
                        point = dst.len() - 1;
                    }
                    joints[id].contour = k;
                    joints[id].point = point;
                    on.push(id);
                    it += 1;
                }
            }
            // An end beyond this contour's edges (none, normally) is left unconnected.
            while it < ends.len() && ends[it].0 == k {
                it += 1;
            }
            let mut ps = vec![0.0; dst.len() + 1];
            for i in 1..dst.len() {
                ps[i] = ps[i - 1] + geom::dist(dst[i - 1], dst[i]);
            }
            if let (Some(&first), Some(&last)) = (dst.first(), dst.last()) {
                ps[dst.len()] = ps[dst.len() - 1] + geom::dist(last, first);
            }
            let total = *ps.last().unwrap();
            for (n, &id) in on.iter().enumerate() {
                joints[id].param = ps[joints[id].point];
                joints[id].prev = on[(n + on.len() - 1) % on.len()];
                joints[id].next = on[(n + 1) % on.len()];
            }
            for &id in &on {
                if joints[id].next == id {
                    joints[id].free_prev = total;
                    joints[id].free_next = total;
                } else {
                    joints[id].free_prev = ccw(joints[joints[id].prev].param, joints[id].param, total);
                    joints[id].free_next = ccw(joints[id].param, joints[joints[id].next].param, total);
                }
            }
            boundary.push(dst);
            params.push(ps);
            along.push(on);
        }
        let mut g = Graph { boundary, params, joints, along };
        let lines: Vec<&[Pt]> = pieces.iter().map(|p| p.points.as_slice()).collect();
        g.mark_touching(&lines, 1.7 * spacing, 0.8 * spacing);
        g
    }

    /// Takes off the edge what runs within `radius` of a line (away from its ends), so no join or anchor goes along
    /// it there (Orca's `mark_boundary_segments_touching_infill`).
    fn mark_touching(&mut self, lines: &[&[Pt]], clip: f64, radius: f64) {
        let grid = EdgeGrid::new(&self.boundary, (2.5 * radius).max(geom::SCALE), radius * 1.43);
        let mut ids = Vec::new();
        for line in lines {
            let points: Vec<(f64, f64)> = line.iter().map(|q| (q.x as f64, q.y as f64)).collect();
            let (Some(start), Some(end)) = (clip_from_start(&points, clip), clip_from_end(&points, clip)) else {
                continue;
            };
            if !(start.0 < end.0 || (start.0 == end.0 && start.1 < end.1)) {
                continue;
            }
            for s in start.0..=end.0 {
                let p1 = if s == start.0 { start.2 } else { points[s] };
                let p2 = if s == end.0 { end.2 } else { points[s + 1] };
                let (vx, vy) = (p2.0 - p1.0, p2.1 - p1.1);
                let l = vx.hypot(vy);
                let (vx, vy) = if l > 0.0 { (vx / l * radius, vy / l * radius) } else { (radius, 0.0) };
                // The cells along both sides of the thick segment.
                let mut found: Vec<u32> = Vec::new();
                for side in [-1.0, 1.0] {
                    let (px, py) = (-vy * side, vx * side);
                    grid.edges_along((p1.0 - vx + px, p1.1 - vy + py), (p2.0 + vx + px, p2.1 + vy + py), &mut ids);
                    found.extend_from_slice(&ids);
                }
                found.sort_unstable();
                found.dedup();
                let bb = [
                    p1.0.min(p2.0) - radius - EPS,
                    p1.1.min(p2.1) - radius - EPS,
                    p1.0.max(p2.0) + radius + EPS,
                    p1.1.max(p2.1) + radius + EPS,
                ];
                for &id in &found {
                    let (a, b, k, j) = grid.edges[id as usize];
                    if self.along[k].is_empty() {
                        continue;
                    }
                    let (ax, ay, bx, by) = (a.x as f64, a.y as f64, b.x as f64, b.y as f64);
                    if ax.max(bx) < bb[0] || ax.min(bx) > bb[2] || ay.max(by) < bb[1] || ay.min(by) > bb[3] {
                        continue;
                    }
                    let Some((lo, hi)) = thick_collision((ax, ay), (bx, by), p1, p2, radius) else { continue };
                    let ps = &self.params[k];
                    let total = *ps.last().unwrap();
                    let (pa, pb) = (ps[j], ps[j + 1]);
                    self.mark(k, pb.min(pa + lo), pb.min(pa + hi), total);
                }
            }
        }
    }

    /// Marks the contour from `o1` to `o2` (lengths along it) as taken.
    fn mark(&mut self, k: usize, o1: f64, o2: f64, total: f64) {
        let on = &self.along[k];
        let j = &mut self.joints;
        let (low, high) = if on.len() == 1 {
            (on[0], on[0])
        } else {
            let il = on.partition_point(|&c| j[c].param < o1);
            let ih = on.partition_point(|&c| j[c].param < o2);
            let mut low = if il == on.len() { on[0] } else { on[il] };
            let high = if ih == on.len() { on[0] } else { on[ih] };
            if j[low].param != o1 {
                low = j[low].prev;
            }
            (low, high)
        };
        if low != high && j[low].next != high {
            let mut c = j[low].next;
            while c != high {
                consume_prev(j, c);
                consume_next(j, c);
                c = j[c].next;
            }
        }
        let t = ccw(j[low].param, o1, total);
        trim_next(j, low, t);
        let t = ccw(o2, j[high].param, total);
        trim_prev(j, high, t);
    }

    pub(crate) fn total(&self, k: usize) -> f64 {
        *self.params[k].last().unwrap()
    }
}

/// The point `distance` along the polyline from its start: (segment, how far along it, the point).
fn clip_from_start(points: &[(f64, f64)], mut distance: f64) -> Option<(usize, f64, (f64, f64))> {
    for i in 1..points.len() {
        let (a, b) = (points[i - 1], points[i]);
        let l = (b.0 - a.0).hypot(b.1 - a.1);
        if l > distance {
            let t = distance / l;
            return Some((i - 1, t, (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t)));
        }
        distance -= l;
    }
    None
}

/// The point `distance` along the polyline back from its end: (segment, how far along it from its start, the point).
fn clip_from_end(points: &[(f64, f64)], mut distance: f64) -> Option<(usize, f64, (f64, f64))> {
    for i in (0..points.len().saturating_sub(1)).rev() {
        let (b, a) = (points[i + 1], points[i]);
        let l = (b.0 - a.0).hypot(b.1 - a.1);
        if l > distance {
            let t = distance / l;
            return Some((i, 1.0 - t, (b.0 + (a.0 - b.0) * t, b.1 + (a.1 - b.1) * t)));
        }
        distance -= l;
    }
    None
}

/// Where the line a–b passes within `offset` of the segment s–t (a capsule): the stretch of the line, as lengths
/// from a (Orca's `line_rounded_thick_segment_collision`).
pub(crate) fn thick_collision(
    a: (f64, f64),
    b: (f64, f64),
    s: (f64, f64),
    t: (f64, f64),
    offset: f64,
) -> Option<(f64, f64)> {
    let v = (b.0 - a.0, b.1 - a.1);
    let lv = v.0 * v.0 + v.1 * v.1;
    let sv = (t.0 - s.0, t.1 - s.1);
    let sl = sv.0.hypot(sv.1);
    let r2 = offset * offset;
    if lv < EPS * EPS {
        let m = ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0);
        let hit = if sl > EPS {
            dist2_to_segment(m, s, t) < r2
        } else {
            let c = ((s.0 + t.0) / 2.0, (s.1 + t.1) / 2.0);
            (c.0 - m.0).powi(2) + (c.1 - m.1).powi(2) < r2
        };
        return hit.then(|| (0.0, lv.sqrt()));
    }
    let (mut tmin, mut tmax) = (f64::MAX, f64::MIN);
    let mut circle = |c: (f64, f64)| {
        let p0 = (a.0 - c.0, a.1 - c.1);
        let bq = 2.0 * (p0.0 * v.0 + p0.1 * v.1);
        let cq = p0.0 * p0.0 + p0.1 * p0.1 - r2;
        let disc = bq * bq - 4.0 * lv * cq;
        if disc >= 0.0 {
            let root = disc.sqrt();
            let (t0, t1) = (((-bq - root) / (2.0 * lv)).max(0.0), ((-bq + root) / (2.0 * lv)).min(1.0));
            if t0 <= t1 {
                tmin = tmin.min(t0);
                tmax = tmax.max(t1);
            }
        }
    };
    if sl > EPS {
        circle(s);
        circle(t);
        let dx = (sv.0 / sl, sv.1 / sl);
        let dy = (-dx.1, dx.0);
        let p0 = (a.0 - s.0, a.1 - s.1);
        let p = (p0.0 * dx.0 + p0.1 * dx.1, p0.0 * dy.0 + p0.1 * dy.1);
        let w = (v.0 * dx.0 + v.1 * dx.1, v.0 * dy.0 + v.1 * dy.1);
        if let Some((t0, t1)) = liang_barsky(p, w, (0.0, -offset), (sl, offset)) {
            tmin = tmin.min(t0);
            tmax = tmax.max(t1);
        }
    } else {
        circle(((s.0 + t.0) / 2.0, (s.1 + t.1) / 2.0));
    }
    (tmin <= tmax).then(|| (tmin * lv.sqrt(), tmax * lv.sqrt()))
}

pub(crate) fn dist2_to_segment(p: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    let (vx, vy) = (b.0 - a.0, b.1 - a.1);
    let l2 = vx * vx + vy * vy;
    let t = if l2 > 0.0 { (((p.0 - a.0) * vx + (p.1 - a.1) * vy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    let (qx, qy) = (a.0 + vx * t - p.0, a.1 + vy * t - p.1);
    qx * qx + qy * qy
}

/// The part of p + t·v, t from 0 to 1, inside the box.
fn liang_barsky(p: (f64, f64), v: (f64, f64), min: (f64, f64), max: (f64, f64)) -> Option<(f64, f64)> {
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    for (q, d, lo, hi) in [(p.0, v.0, min.0, max.0), (p.1, v.1, min.1, max.1)] {
        if d == 0.0 {
            if q < lo || q > hi {
                return None;
            }
            continue;
        }
        let (mut a, mut b) = ((lo - q) / d, (hi - q) / d);
        if a > b {
            std::mem::swap(&mut a, &mut b);
        }
        t0 = t0.max(a);
        t1 = t1.min(b);
        if t0 > t1 {
            return None;
        }
    }
    Some((t0, t1))
}

/// Adds the contour's points after `start` up to and including `end`, going backwards if `clockwise`.
fn take_full(line: &mut Vec<Pt>, contour: &[Pt], start: usize, end: usize, clockwise: bool) {
    let n = contour.len();
    if start == end || n == 0 {
        return;
    }
    let mut i = start;
    loop {
        i = if clockwise { (i + n - 1) % n } else { (i + 1) % n };
        line.push(contour[i]);
        if i == end {
            break;
        }
    }
}

/// Adds the contour's points after `start` towards `end`, but no more than `to_take` of it; returns how much it took.
pub(crate) fn take_part(
    line: &mut Vec<Pt>,
    contour: &[Pt],
    params: &[f64],
    start: usize,
    end: usize,
    to_take: f64,
    clockwise: bool,
) -> f64 {
    let n = contour.len();
    let total = *params.last().unwrap();
    let p0 = params[start];
    let step = |i: usize| if clockwise { (i + n - 1) % n } else { (i + 1) % n };
    let (mut i, mut iprev, mut lprev) = (step(start), start, 0.0);
    for _ in 0..=n {
        let l = if clockwise { cw(p0, params[i], total) } else { ccw(p0, params[i], total) };
        if l >= to_take {
            let t = (to_take - lprev) / (l - lprev);
            let (a, b) = (contour[iprev], contour[i]);
            line.push(geom::pt(
                (a.x as f64 + (b.x - a.x) as f64 * t).round() as i32,
                (a.y as f64 + (b.y - a.y) as f64 * t).round() as i32,
            ));
            return to_take;
        }
        line.push(contour[i]);
        if i == end {
            return l;
        }
        iprev = i;
        lprev = l;
        i = step(i);
    }
    lprev
}

/// Takes the edge from joint `a` to joint `b` for a join: marks it used (Orca's `take` with its joints).
pub(crate) fn take_joints(j: &mut [Joint], mut a: usize, mut b: usize, clockwise: bool) {
    if clockwise {
        std::mem::swap(&mut a, &mut b);
    }
    if j[a].next != b {
        let mut c = j[a].next;
        while j[c].next != b && c != a {
            consume_prev(j, c);
            consume_next(j, c);
            c = j[c].next;
        }
    }
    consume_next(j, a);
    consume_prev(j, b);
}

/// Hooks the line's end at joint `start` onto the edge towards joint `end`, up to `max_length` and never closer than
/// half a line to the next joint (Orca's `take_limited`).
pub(crate) fn take_anchor(
    g: &mut Graph,
    line: &mut Vec<Pt>,
    start: usize,
    end: usize,
    clockwise: bool,
    max_length: f64,
    half_width: f64,
) {
    let j = &mut g.joints;
    if !(if clockwise { could_take_prev(j, start) } else { could_take_next(j, start) }) {
        return;
    }
    let k = j[start].contour;
    let (contour, params) = (&g.boundary[k], &g.params[k]);
    let at_start = line.first() == Some(&contour[j[start].point]);
    let rest = if at_start { std::mem::take(line) } else { Vec::new() };
    let total = *params.last().unwrap();
    let mut to_go = max_length;
    j[start].consumed = true;
    if start == end {
        to_go = to_go.min(total - half_width).max(0.0);
        to_go = to_go.min(if clockwise { j[start].free_prev } else { j[start].free_next });
        consume_prev(j, start);
        consume_next(j, start);
        if to_go > EPS {
            take_part(line, contour, params, j[start].point, j[start].point, to_go, clockwise);
        }
    } else {
        let mut c = start;
        while c != end {
            let other = if clockwise { j[c].prev } else { j[c].next };
            let l =
                if clockwise { cw(j[c].param, j[other].param, total) } else { ccw(j[c].param, j[other].param, total) };
            to_go = to_go.min(if clockwise { j[c].free_prev } else { j[c].free_next });
            to_go = to_go.min(l - half_width).max(0.0);
            if clockwise {
                consume_prev(j, c);
            } else {
                consume_next(j, c);
            }
            if l >= to_go {
                if to_go > EPS {
                    if clockwise {
                        trim_next(j, other, l - to_go);
                    } else {
                        trim_prev(j, other, l - to_go);
                    }
                    take_part(line, contour, params, j[c].point, j[other].point, to_go, clockwise);
                }
                break;
            }
            if clockwise {
                trim_next(j, other, 0.0);
            } else {
                trim_prev(j, other, 0.0);
            }
            take_full(line, contour, j[c].point, j[other].point, clockwise);
            to_go -= l;
            c = other;
        }
    }
    if at_start {
        line.reverse();
        line.extend(rest);
    }
}

/// The line `i` has been merged into (the lowest index of its group), updating the record on the way.
pub(crate) fn merged(merged_with: &mut [usize], i: usize) -> usize {
    let mut last = i;
    loop {
        let lower = merged_with[last];
        if lower == last {
            merged_with[i] = last;
            return last;
        }
        last = lower;
    }
}

/// Orca's `connect_infill`: joins the lines along the edge where their ends are close along it, and anchors the
/// ends that join nothing. Lengths in units.
fn connect(pieces: Vec<Piece>, shape: &Shape, spacing: f64, anchor: f64, anchor_max: f64) -> Vec<Vec<Pt>> {
    let mut g = Graph::new(&pieces, shape, spacing);
    let mut lines: Vec<Vec<Pt>> = pieces.into_iter().map(|p| p.points).collect();
    let n = lines.len();
    let mut merged_with: Vec<usize> = (0..n).collect();
    let half_width = 0.5 * spacing;
    // Two ends whose anchors would meet are joined instead, with about as much wall.
    let join_length = if anchor > EPS { anchor_max.max(2.0 * (anchor + half_width)) } else { anchor_max };
    let mut open_end = vec![true; 2 * n];

    // Every stretch of edge between two neighbouring ends, shortest first.
    let mut arches: Vec<(usize, f64)> = Vec::new();
    for i in 0..g.joints.len() {
        let c = &g.joints[i];
        if c.contour != NONE && c.next != i && could_connect_next(&g.joints, i) {
            arches.push((i, ccw(c.param, g.joints[c.next].param, g.total(c.contour))));
        }
    }
    // Sorted by a key, ties kept in the order they come (as a stable sort keeps them).
    let sorted = |arches: &[(usize, f64)], key: &dyn Fn(&(usize, f64)) -> [f64; 4]| -> Vec<(usize, f64)> {
        let mut keyed: Vec<([f64; 4], usize)> = arches.iter().enumerate().map(|(i, a)| (key(a), i)).collect();
        sort_keyed(&mut keyed);
        keyed.into_iter().map(|(_, i)| arches[i]).collect()
    };
    arches = sorted(&arches, &|a| [a.1, 0.0, 0.0, 0.0]);
    // How many lines the arches would join in this order.
    let count_joins = |order: &[(usize, f64)], g: &Graph| -> usize {
        let j = &g.joints;
        let mut consumed: Vec<bool> = j.iter().map(|c| c.consumed).collect();
        let mut parent: Vec<usize> = (0..n).collect();
        fn find(parent: &mut [usize], mut i: usize) -> usize {
            while parent[i] != i {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            i
        }
        let mut joins = 0;
        for &(e1, length) in order {
            let e2 = j[e1].next;
            if consumed[e1] || consumed[e2] {
                continue;
            }
            let (p1, p2) = (find(&mut parent, e1 / 2), find(&mut parent, e2 / 2));
            if p1 == p2 {
                continue;
            }
            if length < join_length {
                parent[p2] = p1;
                joins += 1;
            } else if anchor <= EPS {
                continue;
            }
            consumed[e1] = true;
            consumed[e2] = true;
        }
        // The last pass joins the open ends next to each other.
        for end in 0..consumed.len() {
            let c = &j[end];
            if consumed[end] || c.contour == NONE {
                continue;
            }
            let total = g.total(c.contour);
            let open = |other: usize, trimmed: bool, consumed: &[bool]| other != end && !consumed[other] && !trimmed;
            let lprev = if open(c.prev, c.prev_trimmed || j[c.prev].next_trimmed, &consumed) {
                ccw(j[c.prev].param, c.param, total)
            } else {
                f64::MAX
            };
            let lnext = if open(c.next, c.next_trimmed || j[c.next].prev_trimmed, &consumed) {
                ccw(c.param, j[c.next].param, total)
            } else {
                f64::MAX
            };
            consumed[end] = anchor > EPS;
            for l in [lprev.min(lnext), lprev.max(lnext)] {
                if l > join_length {
                    break;
                }
                let other = if l == lprev { c.prev } else { c.next };
                let (p1, p2) = (find(&mut parent, end / 2), find(&mut parent, other / 2));
                if p1 == p2 {
                    continue;
                }
                parent[p2] = p1;
                consumed[end] = true;
                consumed[other] = true;
                joins += 1;
                break;
            }
        }
        joins
    };
    // Equal arcs taken along the contour pair a wall in one phase: keep the order that joins the most lines.
    let mut best = count_joins(&arches, &g);
    let bucket = 0.5 * spacing;
    for backwards in [false, true] {
        let order = sorted(&arches, &|a| {
            let j = &g.joints[a.0];
            [(a.1 / bucket).round(), j.contour as f64, if backwards { -j.param } else { j.param }, 0.0]
        });
        let joins = count_joins(&order, &g);
        if joins > best {
            best = joins;
            arches = order;
        }
    }

    for &(c1, length) in &arches {
        let c2 = g.joints[c1].next;
        if g.joints[c1].consumed || g.joints[c2].consumed {
            continue;
        }
        let (i1, i2) = (merged(&mut merged_with, c1 / 2), merged(&mut merged_with, c2 / 2));
        if i1 == i2 {
            continue;
        }
        let k = g.joints[c1].contour;
        if length < join_length {
            let (q1, q2) = (g.boundary[k][g.joints[c1].point], g.boundary[k][g.joints[c2].point]);
            let mut first = std::mem::take(&mut lines[i1]);
            let mut second = std::mem::take(&mut lines[i2]);
            if first.first() == Some(&q1) {
                first.reverse();
            }
            if second.last() == Some(&q2) {
                second.reverse();
            }
            take_full(&mut first, &g.boundary[k], g.joints[c1].point, g.joints[c2].point, false);
            first.extend_from_slice(&second[1..]);
            take_joints(&mut g.joints, c1, c2, false);
            open_end[c1] = false;
            open_end[c2] = false;
            if i2 < i1 {
                lines[i2] = first;
                merged_with[i1] = merged_with[i2];
            } else {
                lines[i1] = first;
                merged_with[i2] = merged_with[i1];
            }
        } else if anchor > EPS {
            let mut line = std::mem::take(&mut lines[i1]);
            take_anchor(&mut g, &mut line, c1, c2, false, anchor, half_width);
            lines[i1] = line;
            let mut line = std::mem::take(&mut lines[i2]);
            take_anchor(&mut g, &mut line, c2, c1, true, anchor, half_width);
            lines[i2] = line;
        }
    }

    // How far along the edge the nearest open end of another line is, within 64 ends.
    let distance_to_open_end =
        |g: &Graph, merged_with: &mut [usize], open_end: &[bool], from: usize, line: usize, backwards: bool| {
            let total = g.total(g.joints[from].contour);
            let mut distance = 0.0;
            let mut c = from;
            for _ in 0..64 {
                let other = if backwards { g.joints[c].prev } else { g.joints[c].next };
                if other == from {
                    break;
                }
                distance += if backwards {
                    cw(g.joints[c].param, g.joints[other].param, total)
                } else {
                    ccw(g.joints[c].param, g.joints[other].param, total)
                };
                if open_end[other] && merged(merged_with, other / 2) != line {
                    return distance;
                }
                c = other;
            }
            f64::MAX
        };

    // Join what is left to a neighbour along the edge if close enough, else anchor it.
    for c in 0..g.joints.len() {
        if g.joints[c].consumed || g.joints[c].contour == NONE {
            continue;
        }
        let k = g.joints[c].contour;
        let total = g.total(k);
        let (prev, next) = (g.joints[c].prev, g.joints[c].next);
        let lprev = if could_connect_prev(&g.joints, c) {
            ccw(g.joints[prev].param, g.joints[c].param, total)
        } else {
            f64::MAX
        };
        let lnext = if could_connect_next(&g.joints, c) {
            ccw(g.joints[c].param, g.joints[next].param, total)
        } else {
            f64::MAX
        };
        let i1 = merged(&mut merged_with, c / 2);
        let mut connected = false;
        for l in [lprev.min(lnext), lprev.max(lnext)] {
            if l == f64::MAX || l > join_length {
                break;
            }
            let reversed = l == lprev;
            let c2 = if reversed { prev } else { next };
            let i2 = merged(&mut merged_with, c2 / 2);
            if i1 == i2 {
                continue;
            }
            let (q1, q2) = (g.boundary[k][g.joints[c].point], g.boundary[k][g.joints[c2].point]);
            let mut first = std::mem::take(&mut lines[i1]);
            let mut second = std::mem::take(&mut lines[i2]);
            if first.first() == Some(&q1) {
                first.reverse();
            }
            if second.last() == Some(&q2) {
                second.reverse();
            }
            take_full(&mut first, &g.boundary[k], g.joints[c].point, g.joints[c2].point, reversed);
            first.extend_from_slice(&second[1..]);
            take_joints(&mut g.joints, c, c2, reversed);
            open_end[c] = false;
            open_end[c2] = false;
            if i1 < i2 {
                merged_with[i2] = i1;
                lines[i1] = first;
            } else {
                merged_with[i1] = i2;
                lines[i2] = first;
            }
            connected = true;
            break;
        }
        if !connected && anchor > EPS {
            // Hook toward the nearest open end of another line, where the next path likely starts.
            let (free_prev, free_next) = (g.joints[c].free_prev, g.joints[c].free_next);
            let to_prev = distance_to_open_end(&g, &mut merged_with, &open_end, c, i1, true);
            let to_next = distance_to_open_end(&g, &mut merged_with, &open_end, c, i1, false);
            let mut backwards = free_prev > free_next;
            if to_prev < to_next && free_prev > EPS {
                backwards = true;
            } else if to_next < to_prev && free_next > EPS {
                backwards = false;
            }
            if (if backwards { free_prev } else { free_next }) > EPS {
                let mut line = std::mem::take(&mut lines[i1]);
                take_anchor(
                    &mut g,
                    &mut line,
                    c,
                    if backwards { prev } else { next },
                    backwards,
                    anchor.max(0.0),
                    half_width,
                );
                lines[i1] = line;
            }
        }
    }
    lines.into_iter().filter(|l| l.len() >= 2).collect()
}

// ---- Joining close ends (FillBase.cpp, join_close_ends) ----

fn cross(o: (f64, f64), a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
}

/// Whether segments a–b and c–d meet, touching included.
fn segments_meet(a: (f64, f64), b: (f64, f64), c: (f64, f64), d: (f64, f64)) -> bool {
    let (d1, d2, d3, d4) = (cross(c, d, a), cross(c, d, b), cross(a, b, c), cross(a, b, d));
    if ((d1 > 0.0 && d2 < 0.0) || (d1 < 0.0 && d2 > 0.0)) && ((d3 > 0.0 && d4 < 0.0) || (d3 < 0.0 && d4 > 0.0)) {
        return true;
    }
    let on = |p: (f64, f64), q: (f64, f64), r: (f64, f64)| {
        r.0 >= p.0.min(q.0) && r.0 <= p.0.max(q.0) && r.1 >= p.1.min(q.1) && r.1 <= p.1.max(q.1)
    };
    (d1 == 0.0 && on(c, d, a)) || (d2 == 0.0 && on(c, d, b)) || (d3 == 0.0 && on(a, b, c)) || (d4 == 0.0 && on(a, b, d))
}

/// Items by the cell they are in, sorted by cell: what a cell holds is a slice.
struct Cells {
    keys: Vec<(i64, i64)>,
    items: Vec<usize>,
}

impl Cells {
    fn new(entries: Vec<((i64, i64), usize)>) -> Cells {
        let mut keyed: Vec<([f64; 4], usize)> =
            entries.iter().enumerate().map(|(i, &(c, item))| ([c.0 as f64, c.1 as f64, item as f64, 0.0], i)).collect();
        sort_keyed(&mut keyed);
        Cells {
            keys: keyed.iter().map(|&(_, i)| entries[i].0).collect(),
            items: keyed.iter().map(|&(_, i)| entries[i].1).collect(),
        }
    }

    fn get(&self, c: (i64, i64)) -> &[usize] {
        let lo = self.keys.partition_point(|k| *k < c);
        let hi = lo + self.keys[lo..].partition_point(|k| *k <= c);
        &self.items[lo..hi]
    }

    /// Each cell with what it holds, in order.
    fn groups(&self) -> impl Iterator<Item = ((i64, i64), &[usize])> + '_ {
        let mut at = 0;
        std::iter::from_fn(move || {
            let c = *self.keys.get(at)?;
            let n = self.keys[at..].partition_point(|k| *k == c);
            let group = &self.items[at..at + n];
            at += n;
            Some((c, group))
        })
    }

    /// The cells, once each, in order.
    fn keys_deduped(mut self) -> Vec<(i64, i64)> {
        self.keys.dedup();
        self.keys
    }
}

/// Joins lines whose ends lie within `max_gap` (units) of each other into one, the nearest first, where the join
/// crosses no line and no other join.
fn join_close_ends(lines: &mut Vec<Vec<Pt>>, max_gap: f64) {
    let n = lines.len();
    if n < 2 || max_gap <= 0.0 {
        return;
    }
    let end_point = |lines: &[Vec<Pt>], e: usize| -> Pt {
        let l = &lines[e >> 1];
        if e & 1 == 1 { *l.last().unwrap() } else { l[0] }
    };
    let cell_of = |p: Pt| ((p.x as f64 / max_gap).floor() as i64, (p.y as f64 / max_gap).floor() as i64);
    let grid = Cells::new(
        (0..2 * n).filter(|&e| lines[e >> 1].len() >= 2).map(|e| (cell_of(end_point(lines, e)), e)).collect(),
    );
    // The end of a line that comes last along its overall direction, taken along the dominant axis.
    let backwards: Vec<bool> = lines
        .iter()
        .map(|l| {
            if l.len() < 2 {
                return false;
            }
            let (dx, dy) = ((l.last().unwrap().x - l[0].x) as f64, (l.last().unwrap().y - l[0].y) as f64);
            if dx.abs() >= dy.abs() { dx < 0.0 } else { dy < 0.0 }
        })
        .collect();
    let trailing = |e: usize| (e & 1 == 1) != backwards[e >> 1];
    let mut gaps: Vec<(bool, bool, f64, usize, usize)> = Vec::new();
    for (c, ends) in grid.groups() {
        for dx in -1..=1 {
            for dy in -1..=1 {
                let others = grid.get((c.0 + dx, c.1 + dy));
                for &a in ends {
                    for &b in others {
                        if a < b && (a >> 1) != (b >> 1) {
                            let d = geom::dist(end_point(lines, a), end_point(lines, b));
                            if d <= max_gap {
                                gaps.push((d > EPS, d > EPS && (trailing(a) || trailing(b)), d, a, b));
                            }
                        }
                    }
                }
            }
        }
    }
    if gaps.is_empty() {
        return;
    }
    let mut keyed: Vec<([f64; 4], usize)> = gaps
        .iter()
        .enumerate()
        .map(|(i, g)| ([f64::from(u8::from(g.0) * 2 + u8::from(g.1)), g.2, g.3 as f64, g.4 as f64], i))
        .collect();
    sort_keyed(&mut keyed);
    let gaps: Vec<(bool, bool, f64, usize, usize)> = keyed.iter().map(|&(_, i)| gaps[i]).collect();

    // The segments that could cross a join: those through the cells around a join's ends.
    let mut wanted: Vec<((i64, i64), usize)> = Vec::new();
    for &(_, _, _, a, b) in &gaps {
        for e in [a, b] {
            let c = cell_of(end_point(lines, e));
            for dx in -1..=1 {
                for dy in -1..=1 {
                    wanted.push(((c.0 + dx, c.1 + dy), 0));
                }
            }
        }
    }
    let wanted = Cells::new(wanted).keys_deduped();
    let mut segments: Vec<(usize, usize)> = Vec::new();
    let mut near: Vec<((i64, i64), usize)> = Vec::new();
    for (li, l) in lines.iter().enumerate() {
        for i in 1..l.len() {
            let (c0, c1) = (cell_of(l[i - 1]), cell_of(l[i]));
            let (lo, hi) = ((c0.0.min(c1.0), c0.1.min(c1.1)), (c0.0.max(c1.0), c0.1.max(c1.1)));
            let id = segments.len();
            let from = wanted.partition_point(|c| c.0 < lo.0);
            for &cell in wanted[from..].iter().take_while(|c| c.0 <= hi.0) {
                if cell.1 >= lo.1 && cell.1 <= hi.1 {
                    near.push((cell, id));
                }
            }
            if near.last().is_some_and(|&(_, last)| last == id) {
                segments.push((li, i));
            }
        }
    }
    let near_cells = Cells::new(near);
    let mut partner = vec![NONE; 2 * n];
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut [usize], mut i: usize) -> usize {
        while parent[i] != i {
            parent[i] = parent[parent[i]];
            i = parent[i];
        }
        i
    }
    let as_f = |p: Pt| (p.x as f64, p.y as f64);
    for &(_, _, _, a, b) in &gaps {
        if partner[a] != NONE || partner[b] != NONE || find(&mut parent, a >> 1) == find(&mut parent, b >> 1) {
            continue;
        }
        let (p, q) = (as_f(end_point(lines, a)), as_f(end_point(lines, b)));
        let length = (q.0 - p.0).hypot(q.1 - p.1);
        let mut crosses = false;
        if length > 2.0 * EPS {
            let dir = ((q.0 - p.0) / length, (q.1 - p.1) / length);
            let (ia, ib) = ((p.0 + EPS * dir.0, p.1 + EPS * dir.1), (q.0 - EPS * dir.0, q.1 - EPS * dir.1));
            let ca = cell_of(end_point(lines, a));
            'cells: for dx in -1..=1 {
                for dy in -1..=1 {
                    for &id in near_cells.get((ca.0 + dx, ca.1 + dy)) {
                        let (li, i) = segments[id];
                        if segments_meet(ia, ib, as_f(lines[li][i - 1]), as_f(lines[li][i])) {
                            crosses = true;
                            break 'cells;
                        }
                    }
                }
            }
            if !crosses {
                'joins: for dx in -3..=3 {
                    for dy in -3..=3 {
                        for &e in grid.get((ca.0 + dx, ca.1 + dy)) {
                            if partner[e] != NONE
                                && segments_meet(ia, ib, as_f(end_point(lines, e)), as_f(end_point(lines, partner[e])))
                            {
                                crosses = true;
                                break 'joins;
                            }
                        }
                    }
                }
            }
        }
        if crosses {
            continue;
        }
        partner[a] = b;
        partner[b] = a;
        let (ra, rb) = (find(&mut parent, a >> 1), find(&mut parent, b >> 1));
        parent[ra] = rb;
    }

    // Walk each group from a line with a free end, entering the next line at the end joined to the last one.
    let mut out: Vec<Vec<Pt>> = Vec::new();
    let mut done = vec![false; n];
    let mut walk = |first_end: usize, lines: &mut Vec<Vec<Pt>>, done: &mut Vec<bool>| {
        let mut joined: Vec<Pt> = Vec::new();
        let mut e = first_end;
        while e != NONE {
            let i = e >> 1;
            done[i] = true;
            let mut l = std::mem::take(&mut lines[i]);
            if e & 1 == 1 {
                l.reverse();
            }
            let skip = usize::from(!joined.is_empty() && joined.last() == l.first());
            joined.extend_from_slice(&l[skip.min(l.len())..]);
            e = partner[e ^ 1];
        }
        out.push(joined);
    };
    for i in 0..n {
        if !done[i] && partner[2 * i] == NONE {
            walk(2 * i, lines, &mut done);
        }
    }
    for i in 0..n {
        if !done[i] && partner[2 * i + 1] == NONE {
            walk(2 * i + 1, lines, &mut done);
        }
    }
    *lines = out;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{pt, sc};

    fn square(size: f64) -> Shapes {
        let s = sc(size);
        vec![vec![vec![pt(0, 0), pt(s, 0), pt(s, s), pt(0, s)]]]
    }

    fn params(pattern: Pattern, z: f64) -> Sparse<'static> {
        Sparse {
            pattern,
            origin: (sc(10.0) as f64, sc(10.0) as f64),
            z,
            layer: 0,
            angle: 45.0,
            spacing: 0.407,
            density: 0.15,
            anchor: 4.0 * 0.407,
            anchor_max: 20.0,
            trees: &[],
            lattice_angles: [-45.0, 45.0],
        }
    }

    /// Every point within the area, grown by a hair.
    fn inside(area: &Shapes, lines: &[Contour]) -> bool {
        let grown = geom::offset(area, 0.001);
        lines.iter().all(|l| l.iter().all(|&q| geom::contains(&grown, q)))
    }

    #[test]
    fn crosshatch_fills_a_square_with_few_paths_all_inside() {
        let area = square(20.0);
        for z in [1.0, 2.0, 3.4, 5.0] {
            let paths = sparse(&area, -0.2, &params(Pattern::Crosshatch, z));
            assert!(!paths.is_empty(), "z {z}");
            assert!(inside(&geom::offset(&area, -0.2), &paths), "z {z}");
            // Joined along the edge: a 20 mm square's lines make one or two paths, not one per line.
            assert!(paths.len() <= 3, "z {z}: {} paths", paths.len());
            let total: f64 = paths.iter().map(|p| length(p)).sum::<f64>() / geom::SCALE;
            // About 15 % of a 20 mm square at 0.41 mm lines: ~140 mm of line, plus the joins along the edge.
            assert!((100.0..260.0).contains(&total), "z {z}: {total} mm");
        }
    }

    #[test]
    fn crosshatch_stacks_and_turns_with_height() {
        let area = square(20.0);
        let p = |z| sparse(&area, -0.2, &params(Pattern::Crosshatch, z));
        // Straight lines repeat from layer to layer within a stretch of height (1.0 and 1.2 mm here)…
        assert_eq!(p(1.0), p(1.2));
        // …and bend into the other direction above it.
        assert_ne!(p(1.0), p(3.0));
    }

    #[test]
    fn straight_crosshatch_lines_lie_on_the_objects_grid() {
        // At 1 mm the crosshatch is straight lines at 45°, Orca's line spacing apart (15 %: 0.407 / 0.15, times 1.08
        // below full density) on a grid from the object's centre, here the middle of the square.
        let area = square(20.0);
        let paths = sparse(&area, -0.2, &params(Pattern::Crosshatch, 1.0));
        let spacing = ((0.407e6 / 0.15) as i64 as f64 * 1.08).trunc() / 1e6;
        let (cx, cy) = (10.0, 10.0);
        let mut lines = 0;
        for path in &paths {
            for w in path.windows(2) {
                let (a, b) = ((geom::unsc(w[0].x), geom::unsc(w[0].y)), (geom::unsc(w[1].x), geom::unsc(w[1].y)));
                if (b.0 - a.0).hypot(b.1 - a.1) < 3.0
                    || ((b.1 - a.1).atan2(b.0 - a.0).to_degrees().rem_euclid(180.0) - 45.0).abs() > 0.1
                {
                    continue;
                }
                let across = -(a.0 - cx) * 45f64.to_radians().sin() + (a.1 - cy) * 45f64.to_radians().cos();
                let off = across.rem_euclid(spacing);
                assert!(off.min(spacing - off) < 0.001, "a line {off} mm off the grid");
                lines += 1;
            }
        }
        assert!(lines >= 5, "{lines} lines");
    }

    #[test]
    fn grid_lines_lie_both_ways_on_the_objects_grid() {
        // Grid: lines at the infill direction's quarter turns (45° and 135°), the density shared between the two
        // ways (0.407 / 0.075 apart), on a grid from the object's centre, the same on every layer.
        let area = square(20.0);
        let spacing = (0.407e6 / 0.075) as i64 as f64 / 1e6;
        let (cx, cy) = (10.0, 10.0);
        let mut lines = [0, 0];
        for z in [0.2, 0.4, 3.0] {
            for path in sparse(&area, -0.2, &params(Pattern::Grid, z)) {
                for w in path.windows(2) {
                    let (a, b) = ((geom::unsc(w[0].x), geom::unsc(w[0].y)), (geom::unsc(w[1].x), geom::unsc(w[1].y)));
                    let heading = (b.1 - a.1).atan2(b.0 - a.0).to_degrees().rem_euclid(180.0);
                    let way = [45.0, 135.0].iter().position(|h: &f64| (heading - h).abs() < 0.1);
                    let Some(way) = way.filter(|_| (b.0 - a.0).hypot(b.1 - a.1) >= 3.0) else { continue };
                    let normal = (heading + 90.0).to_radians();
                    let across = (a.0 - cx) * normal.cos() + (a.1 - cy) * normal.sin();
                    let off = across.rem_euclid(spacing);
                    assert!(off.min(spacing - off) < 0.001, "a line {off} mm off the grid at {z}");
                    lines[way] += 1;
                }
            }
        }
        assert!(lines[0] >= 6 && lines[1] >= 6, "{lines:?}");
    }

    #[test]
    fn cubic_lines_run_three_ways_and_honeycomb_turns_every_layer() {
        let area = square(20.0);
        let headings = |paths: &[Contour]| {
            let mut out: Vec<i64> = Vec::new();
            for path in paths {
                for w in path.windows(2) {
                    if geom::dist(w[0], w[1]) >= sc(3.0) as f64 {
                        let h = ((w[1].y - w[0].y) as f64).atan2((w[1].x - w[0].x) as f64).to_degrees();
                        out.push(h.rem_euclid(180.0).round() as i64 % 180);
                    }
                }
            }
            // Not the joins along the square's sides.
            out.retain(|&h| h != 0 && h != 90);
            out.sort_unstable();
            out.dedup();
            out
        };
        // Cubic: lines across Orca's frames, turned by the infill direction and a quarter turn, then a third and two
        // thirds of a turn more: at 45°, 105° and 165°.
        assert_eq!(headings(&sparse(&area, -0.2, &params(Pattern::Cubic, 1.0))), vec![45, 105, 165]);
        // Honeycomb: a different lattice on each of three layers, then the first again.
        let layer =
            |n: usize| sparse(&area, -0.2, &Sparse { layer: n, ..params(Pattern::Honeycomb, 0.2 * (n + 1) as f64) });
        let (l0, l1, l2, l3) = (layer(0), layer(1), layer(2), layer(3));
        assert!(l0 != l1 && l1 != l2 && l0 != l2);
        assert_eq!(l0, l3);
    }

    #[test]
    fn triangles_tri_hexagon_quarter_cubic_and_lateral_lattice_run_their_ways() {
        let area = square(20.0);
        let at = |pattern: Pattern, z: f64| sparse(&area, -0.2, &params(pattern, z));
        // The ways the lines run, but for the joins along the square's sides.
        let headings = |paths: &[Contour]| {
            let mut out: Vec<i64> = Vec::new();
            for path in paths {
                for w in path.windows(2) {
                    if geom::dist(w[0], w[1]) >= sc(3.0) as f64 {
                        let h = ((w[1].y - w[0].y) as f64).atan2((w[1].x - w[0].x) as f64).to_degrees();
                        out.push(h.rem_euclid(180.0).round() as i64 % 180);
                    }
                }
            }
            out.retain(|&h| h != 0 && h != 90);
            out.sort_unstable();
            out.dedup();
            out
        };
        // Triangles and tri-hexagon three ways, as cubic; quarter cubic two ways, as grid; lateral lattice one way.
        assert_eq!(headings(&at(Pattern::Triangles, 1.0)), vec![45, 105, 165]);
        assert_eq!(headings(&at(Pattern::TriHexagon, 1.0)), vec![45, 105, 165]);
        assert_eq!(headings(&at(Pattern::QuarterCubic, 1.0)), vec![45, 135]);
        assert_eq!(headings(&at(Pattern::LateralLattice, 1.0)), vec![135]);
        // Triangles stay where they are from layer to layer; tri-hexagon shifts their third way; quarter cubic and
        // lateral lattice move with the height.
        assert_eq!(at(Pattern::Triangles, 1.0), at(Pattern::Triangles, 3.0));
        assert_ne!(at(Pattern::Triangles, 1.0), at(Pattern::TriHexagon, 1.0));
        assert_ne!(at(Pattern::QuarterCubic, 1.0), at(Pattern::QuarterCubic, 1.4));
        assert_ne!(at(Pattern::LateralLattice, 1.0), at(Pattern::LateralLattice, 1.4));
    }

    #[test]
    fn a_hole_is_never_crossed() {
        let s = sc(20.0);
        let (h0, h1) = (sc(7.0), sc(13.0));
        let area: Shapes = vec![vec![
            vec![pt(0, 0), pt(s, 0), pt(s, s), pt(0, s)],
            vec![pt(h0, h0), pt(h0, h1), pt(h1, h1), pt(h1, h0)],
        ]];
        for pattern in [Pattern::Crosshatch, Pattern::Gyroid, Pattern::Grid, Pattern::Cubic, Pattern::Honeycomb] {
            for z in [1.0, 2.2, 4.0] {
                let paths = sparse(&area, -0.2, &params(pattern, z));
                assert!(!paths.is_empty());
                assert!(inside(&geom::offset(&area, -0.2), &paths), "{pattern:?} at {z}");
                for l in &paths {
                    for w in l.windows(2) {
                        assert!(
                            geom::segment_inside(&geom::offset(&area, -0.199), w[0], w[1])
                                || geom::dist(w[0], w[1]) < 5.0
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn lightning_lines_are_cut_to_the_area_and_anchored_on_its_edge() {
        let s = sc(20.0);
        let (h0, h1) = (sc(7.0), sc(13.0));
        let area: Shapes = vec![vec![
            vec![pt(0, 0), pt(s, 0), pt(s, s), pt(0, s)],
            vec![pt(h0, h0), pt(h0, h1), pt(h1, h1), pt(h1, h0)],
        ]];
        // Sparse infill on 30 layers under a top; the trees of the topmost.
        let mut areas: Vec<Shapes> = (0..30).map(|_| area.clone()).collect();
        areas.push(Vec::new());
        let p = crate::lightning::Params {
            line_width: 0.45,
            density_percent: 15.0,
            layer_height: 0.2,
            overhang_angle: 45.0,
            prune_angle: 45.0,
            straightening_angle: 45.0,
            junction_gap: 0.2035,
        };
        let trees = crate::lightning::grow(&areas, (sc(10.0) as f64, sc(10.0) as f64), &p);
        let paths = sparse(
            &area,
            -0.2,
            &Sparse { pattern: Pattern::Lightning, trees: &trees[29], ..params(Pattern::Lightning, 6.0) },
        );
        assert!(!paths.is_empty());
        let shrunk = geom::offset(&area, -0.199);
        for l in &paths {
            for w in l.windows(2) {
                assert!(geom::segment_inside(&shrunk, w[0], w[1]) || geom::dist(w[0], w[1]) < 5.0);
            }
        }
        // Lines that reach the edge follow it a little (anchors) or join along it.
        let on_edge = |q: &Pt| {
            shrunk.iter().flatten().any(|c| {
                (0..c.len()).any(|i| geom::segment_dist2(*q, c[i], c[(i + 1) % c.len()]).sqrt() < 0.02 * geom::SCALE)
            })
        };
        assert!(paths.iter().any(|l| l.windows(2).any(|w| on_edge(&w[0]) && on_edge(&w[1]))), "no anchor");
    }

    #[test]
    fn gyroid_waves_fill_a_square() {
        let area = square(20.0);
        let paths = sparse(&area, -0.2, &params(Pattern::Gyroid, 3.0));
        assert!(inside(&geom::offset(&area, -0.2), &paths));
        let total: f64 = paths.iter().map(|p| length(p)).sum::<f64>() / geom::SCALE;
        assert!((100.0..300.0).contains(&total), "{total} mm");
        assert!(paths.len() <= 4, "{} paths", paths.len());
    }

    #[test]
    fn close_ends_join_unless_the_join_crosses_a_line() {
        let a = vec![pt(0, 0), pt(10_000, 0)];
        let b = vec![pt(11_000, 0), pt(20_000, 0)];
        let mut lines = vec![a.clone(), b.clone()];
        join_close_ends(&mut lines, 2000.0);
        assert_eq!(lines, vec![vec![pt(0, 0), pt(10_000, 0), pt(11_000, 0), pt(20_000, 0)]]);
        // A line between the two ends keeps them apart.
        let wall = vec![pt(10_500, -3000), pt(10_500, 3000)];
        let mut lines = vec![a, b, wall];
        join_close_ends(&mut lines, 2000.0);
        assert_eq!(lines.len(), 3);
    }
}
