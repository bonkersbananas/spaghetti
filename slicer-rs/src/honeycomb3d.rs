//! Orca's 3D honeycomb (`Fill3DHoneycomb.cpp`, after David Eccles): the edges of a space-filling stack of truncated
//! octahedra, their square faces flat, cut at the layer's height. Each layer is zig-zags one way across the object
//! (along X on some layers, along Y on others, as the octahedra's slices turn), their kinks tracing the cells' edges,
//! and short end pieces closing the cells at the area's box. The pattern is laid in the object's frame (turned by the
//! infill direction alone, never alternated), over the area's box grown by five spacings and aligned to a grid of two
//! cells, then cut to the area, its pieces under 0.8 spacings dropped, and joined along the walls as every pattern's
//! are.
//!
//! Ported as Orca 2.5.1 computes it, its floats included: `triWave` takes its phase as a `float`, and every point is
//! rounded to whole nanometres as Orca's `Point` rounds it. Orca's top caps (`infill_complete_top`, off in the
//! presets), multiline infill and corner smoothing aren't ported.

const EPSILON: f64 = 1e-4;
/// Orca's `SCALING_FACTOR`: nanometres are millimetres divided by it.
const SCALING_FACTOR: f64 = 0.000001;

fn sgn(v: f64) -> f64 {
    ((0.0 < v) as i32 - (v < 0.0) as i32) as f64
}

/// Orca's `Point(double, double)`: each coordinate rounded half away from zero.
fn pt(x: f64, y: f64) -> (i64, i64) {
    (x.round() as i64, y.round() as i64)
}

/// A triangle wave of period twice the grid, from 0 to half the grid (Orca's `triWave`, its phase a `float`).
fn tri_wave(pos: f64, grid: f64) -> f64 {
    let t = ((pos / (grid * 2.0)) + 0.25) as f32;
    let t = t - (t as i32) as f32;
    (1.0 - (t as f64 * 8.0 - 4.0).abs()) * (grid / 4.0) + (grid / 4.0)
}

/// The truncated octahedron's slice at height `z`: the triangle wave clipped to the layer's cross-section (Orca's
/// `troctWave`).
fn troct_wave(pos: f64, grid: f64, z: f64) -> f64 {
    let perp = tri_wave(z, grid) / 2.0;
    let y = tri_wave(pos, grid);
    if y.abs() > perp.abs() { sgn(y) * perp } else { y * sgn(perp) }
}

/// Where the clipped wave turns (Orca's `getCriticalPoints`): none where the slice is a point.
fn critical_points(z: f64, grid: f64) -> Vec<f64> {
    let perp = (tri_wave(z, grid) / 2.0).abs();
    let n = perp / grid;
    if n > 0.0 { vec![grid * n, grid * (1.0 - n), grid * (1.0 + n), grid * (2.0 - n)] } else { Vec::new() }
}

/// Where in its cycle height `z` is, from 0 to 1 (Orca's `zCycle`; Rust's `%` on floats is C's `fmod`).
fn z_cycle(z: f64, grid: f64) -> f64 {
    ((z + grid / 2.0) % (grid * 2.0)) / (grid * 2.0)
}

/// One zig-zag along a line of cells (Orca's `patternPoints` for a single line, whose offsets are all 0).
fn pattern_points(z: f64, grid: f64, crit: &[f64], length: f64, perp_dir: f64, print_dir: i32) -> Vec<(i64, i64)> {
    let mut line = vec![(0, 0)];
    let grid_max = ((length - EPSILON) / grid).ceil() * grid;
    let mut c = 0.0;
    let mut pi_ofs = 0usize;
    while c < grid_max {
        for &at in &crit[pi_ofs..pi_ofs + 2] {
            let offset = troct_wave(at, grid, z);
            let along = c - (pi_ofs as f64 * grid / 2.0) + at;
            let pos_perp = offset * perp_dir;
            line.push(if print_dir == 1 { pt(pos_perp, along) } else { pt(along, pos_perp) });
        }
        c += grid;
        pi_ofs = (pi_ofs + 2) % 4;
    }
    line.push(if print_dir == 1 { pt(0.0, grid_max) } else { pt(grid_max, 0.0) });
    line
}

/// The zig-zags across the box (Orca's `makeZigZag`, one line each).
fn zig_zag(z: f64, grid: f64, crit: &[f64], (lx, ly): (f64, f64)) -> Vec<Vec<(i64, i64)>> {
    let vert = z_cycle(z, grid) < 0.5;
    let mut out = Vec::new();
    let mut perp_dir = -1;
    let mut pattern_dir = -1.0;
    let grid_max = (((if vert { lx } else { ly }) - EPSILON) / grid).ceil() * grid;
    let mut p = 0.0;
    while p < grid_max {
        let mut line =
            pattern_points(z, grid, crit, if vert { ly } else { lx }, pattern_dir, if vert { 1 } else { -1 });
        if perp_dir == 1 {
            line.reverse();
        }
        let (dx, dy) = if vert { pt(p, 0.0) } else { pt(0.0, p) };
        for q in &mut line {
            *q = (q.0 + dx, q.1 + dy);
        }
        out.push(line);
        perp_dir = -perp_dir;
        p += grid;
        pattern_dir = -pattern_dir;
    }
    out
}

/// The pieces closing the cells at the box's two ends (Orca's `makeEndPoints`, one line each).
fn end_points(z: f64, grid: f64, crit: &[f64], (lx, ly): (f64, f64)) -> Vec<Vec<(i64, i64)>> {
    let cycle = z_cycle(z, grid);
    let vert = cycle < 0.5;
    let horiz = !vert;
    let flip_offset = if (sgn(cycle % 0.5 - 0.25) > 0.0) == vert { 0.0 } else { 1.0 };
    let mut start = vec![(0, 0)];
    let mut end = vec![(0, 0)];
    for &c in &crit[..2] {
        let troct = troct_wave(c, grid, z).abs();
        start.push(if horiz { pt(-troct, c) } else { pt(c, -troct) });
        end.push(if horiz { pt(troct, c) } else { pt(c, troct) });
    }
    start.push(if horiz { pt(0.0, grid) } else { pt(grid, 0.0) });
    end.push(if horiz { pt(0.0, grid) } else { pt(grid, 0.0) });
    let grid_max_x = ((lx - EPSILON) / grid).ceil() * grid;
    let grid_max_y = ((ly - EPSILON) / grid).ceil() * grid;
    let mut out = Vec::new();
    let mut c = flip_offset * grid;
    while c < (if horiz { grid_max_y } else { grid_max_x }) - EPSILON {
        let (sx, sy) = if vert { pt(c, 0.0) } else { pt(0.0, c) };
        let (ex, ey) = if vert { pt(c, grid_max_y) } else { pt(grid_max_x, c) };
        out.push(start.iter().map(|q| (q.0 + sx, q.1 + sy)).collect());
        out.push(end.iter().map(|q| (q.0 + ex, q.1 + ey)).collect());
        c += grid * 2.0;
    }
    out
}

/// The pattern on a layer whose top is `z` mm and height `h` mm, for an area whose outline's box in the object's
/// turned frame is `bb` (nm, its points rounded), lines `spacing` mm wide at `density`: polylines in that frame, nm.
pub fn lines(bb: [i64; 4], z: f64, h: f64, spacing: f64, density: f64) -> Vec<Vec<(i64, i64)>> {
    let density = density as f32 as f64;
    let expand = (5.0 * (spacing / SCALING_FACTOR)) as i64;
    let (mut min, max) = ((bb[0] - expand, bb[1] - expand), (bb[2] + expand, bb[3] + expand));
    let mut z_scale = 2f64.sqrt();
    let mut grid = (spacing / SCALING_FACTOR) * ((z_scale + 1.0) / 2.0) * 1.0 / density;
    let layer_height = h / SCALING_FACTOR;
    let per_module = ((grid * 2.0) / (z_scale * layer_height) + 0.05).floor();
    if density > 0.42 || per_module < 2.0 {
        grid = (spacing / SCALING_FACTOR) * 1.1 * 1.0 / density;
        z_scale = (grid * 2.0) / (2.0 * layer_height);
    }
    // The box's corner aligned down to a grid of two cells (Orca's `align_to_grid`).
    let step = (grid * 2.0).round() as i64;
    if step <= 0 {
        return Vec::new();
    }
    min = (min.0.min(min.0.div_euclid(step) * step), min.1.min(min.1.div_euclid(step) * step));
    let size = ((max.0 - min.0) as f64, (max.1 - min.1) as f64);
    let start = grid / 2.0 + (h / 2.0) / SCALING_FACTOR;
    let zs = (z / SCALING_FACTOR) * z_scale + start;
    let crit = critical_points(zs, grid);
    if crit.len() < 4 {
        return Vec::new();
    }
    let mut out = zig_zag(zs, grid, &crit, size);
    out.extend(end_points(zs, grid, &crit, size));
    for line in &mut out {
        for q in line.iter_mut() {
            *q = (q.0 + min.0, q.1 + min.1);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_triangle_wave_swings_half_a_grid_either_way_over_two_cells() {
        let grid = 1000.0;
        assert_eq!(tri_wave(-500.0, grid), -500.0);
        assert_eq!(tri_wave(0.0, grid), 0.0);
        assert_eq!(tri_wave(500.0, grid), 500.0);
        assert_eq!(tri_wave(1500.0, grid), -500.0);
    }

    #[test]
    fn a_layer_is_zig_zags_one_way_across_the_box_and_end_pieces() {
        // A 20 mm box at 15 %, 0.45 mm lines at 0.2 mm, at a layer 5 mm up.
        let lines = lines([-10_000_000, -10_000_000, 10_000_000, 10_000_000], 5.0, 0.2, 0.42, 0.15);
        assert!(lines.len() > 4, "{}", lines.len());
        // The zig-zags all run one way: their ends share one coordinate's spread, the other's barely.
        let zig = &lines[0];
        let (a, b) = (zig[0], zig[zig.len() - 1]);
        assert!((a.0 - b.0).abs() < 1_000_000 || (a.1 - b.1).abs() < 1_000_000, "{a:?} {b:?}");
    }
}
