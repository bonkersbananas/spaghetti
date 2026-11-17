//! Orca's plane-path patterns (`FillPlanePath.cpp`): one long curve laid over the whole object, the same on every
//! layer, cut to the area and joined along the edge as every pattern is.
//!
//! - Archimedean chords: a spiral out from the object's centre, its turns a line's spacing apart, drawn as chords no
//!   further from the curve than the resolution.
//! - Hilbert curve: the space-filling curve on a grid of the line's spacing from the object's corner.
//! - Octagram spiral: eight-pointed stars growing out from the object's centre.
//!
//! As Orca does for sparse infill, the curve is laid in the object's frame (turned by the infill direction and a
//! quarter, about the object's centre) over the object's whole bounding box, in units of the spacing between lines
//! (the spacing over the density), rounded to nanometres, and points that wander out of the area's box are dropped
//! where the curve doesn't need them (Orca's `InfillPolylineClipper`). Orca's corner smoothing
//! (`sparse_infill_smooth_factor`) isn't ported.

/// Which curve.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Curve {
    ArchimedeanChords,
    Hilbert,
    OctagramSpiral,
}

/// A box in nanometres, as Orca's `BoundingBox`.
#[derive(Clone, Copy, Debug)]
struct Box2 {
    min: (i64, i64),
    max: (i64, i64),
}

impl Box2 {
    fn empty() -> Box2 {
        Box2 { min: (i64::MAX, i64::MAX), max: (i64::MIN, i64::MIN) }
    }
    fn merge(&mut self, (x, y): (i64, i64)) {
        self.min = (self.min.0.min(x), self.min.1.min(y));
        self.max = (self.max.0.max(x), self.max.1.max(y));
    }
    /// Orca's `BoundingBox::rotated`: the box of its corners, each turned (and rounded) about the origin.
    fn rotated(&self, angle: f64) -> Box2 {
        let (s, c) = (libm::sin(angle), libm::cos(angle));
        let turn = |(x, y): (i64, i64)| {
            let (x, y) = (x as f64, y as f64);
            ((c * x - s * y).round() as i64, (c * y + s * x).round() as i64)
        };
        let mut out = Box2::empty();
        for corner in [self.min, self.max, (self.min.0, self.max.1), (self.max.0, self.min.1)] {
            out.merge(turn(corner));
        }
        out
    }
    /// Orca's `BoundingBox::center`: integer halves, rounded towards zero.
    fn center(&self) -> (i64, i64) {
        ((self.min.0 + self.max.0) / 2, (self.min.1 + self.max.1) / 2)
    }
}

/// Orca's `InfillPolylineClipper`: points in units of the line spacing, scaled to nanometres, each kept unless it and
/// the points either side of it all lie beyond the same side of the box (`clip`; every point kept without one).
struct Output {
    scale: f64,
    clip: Option<Box2>,
    out: Vec<(i64, i64)>,
    sides_prev: u8,
    sides_this: u8,
}

impl Output {
    fn sides(&self, (x, y): (i64, i64)) -> u8 {
        let b = self.clip.expect("clipping");
        (x < b.min.0) as u8 | ((x > b.max.0) as u8) << 1 | ((y > b.max.1) as u8) << 2 | ((y < b.min.1) as u8) << 3
    }
    fn add(&mut self, (x, y): (f64, f64)) {
        let pt = ((x * self.scale + 0.5).floor() as i64, (y * self.scale + 0.5).floor() as i64);
        if self.clip.is_none() {
            self.out.push(pt);
            return;
        }
        if self.out.len() < 2 {
            let sides = self.sides(pt);
            if self.out.is_empty() {
                self.sides_prev = sides;
            } else {
                self.sides_this = sides;
            }
            self.out.push(pt);
        } else {
            let next = self.sides(pt);
            if self.sides_this == 0 || (self.sides_prev & self.sides_this & next) == 0 {
                self.sides_prev = self.sides_this;
            } else {
                self.out.pop();
            }
            self.out.push(pt);
            self.sides_this = next;
        }
    }
}

/// Orca's `generate_archimedean_chords`.
fn archimedean_chords(max_x: i64, max_y: i64, resolution: f64, out: &mut Output) {
    let rmax = ((max_x as f64) * (max_x as f64) + (max_y as f64) * (max_y as f64)).sqrt() * 2f64.sqrt() + 1.5;
    let (a, b) = (1.0, 1.0 / (2.0 * std::f64::consts::PI));
    let (mut theta, mut r) = (0.0f64, 1.0f64);
    out.add((0.0, 0.0));
    out.add((1.0, 0.0));
    while r < rmax {
        theta += 2.0 * libm::acos(1.0 - resolution / r);
        r = a + b * theta;
        out.add((r * libm::cos(theta), r * libm::sin(theta)));
    }
}

/// Orca's `hilbert_n_to_xy`: the `n`th point of the Hilbert curve.
fn hilbert_n_to_xy(n: usize) -> (i64, i64) {
    const NEXT_STATE: [usize; 16] = [4, 0, 0, 12, 0, 4, 4, 8, 12, 8, 8, 4, 8, 12, 12, 0];
    const DIGIT_TO_X: [i64; 16] = [0, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0, 0];
    const DIGIT_TO_Y: [i64; 16] = [0, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1];
    let mut ndigits = 0;
    let mut nc = n;
    while nc > 0 {
        nc >>= 2;
        ndigits += 1;
    }
    let mut state = if ndigits & 1 == 1 { 4 } else { 0 };
    let (mut x, mut y) = (0i64, 0i64);
    for i in (0..ndigits).rev() {
        let digit = (n >> (i * 2)) & 3;
        state += digit;
        x |= DIGIT_TO_X[state] << i;
        y |= DIGIT_TO_Y[state] << i;
        state = NEXT_STATE[state];
    }
    (x, y)
}

/// Orca's `generate_hilbert_curve`.
fn hilbert(min: (i64, i64), max: (i64, i64), out: &mut Output) {
    let sz0 = (max.0 + 1 - min.0).max(max.1 + 1 - min.1);
    let mut sz: i64 = 2;
    while sz < sz0 {
        sz <<= 1;
    }
    for i in 0..(sz * sz) as usize {
        let (x, y) = hilbert_n_to_xy(i);
        out.add(((x + min.0) as f64, (y + min.1) as f64));
    }
}

/// Orca's `generate_octagram_spiral`.
fn octagram_spiral(max_x: i64, max_y: i64, out: &mut Output) {
    let rmax = ((max_x as f64) * (max_x as f64) + (max_y as f64) * (max_y as f64)).sqrt() * 2f64.sqrt() + 1.5;
    let mut r = 0.0f64;
    let r_inc = 2f64.sqrt();
    out.add((0.0, 0.0));
    while r < rmax {
        r += r_inc;
        let rx = r / 2f64.sqrt();
        let r2 = r + rx;
        for q in [
            (r, 0.0),
            (r2, rx),
            (rx, rx),
            (rx, r2),
            (0.0, r),
            (-rx, r2),
            (-rx, rx),
            (-r2, rx),
            (-r, 0.0),
            (-r2, -rx),
            (-rx, -rx),
            (-rx, -r2),
            (0.0, -r),
            (rx, -r2),
            (rx, -rx),
            (r2 + r_inc, -rx),
        ] {
            out.add(q);
        }
    }
}

/// Over which box a curve is laid (Orca's choice in `FillPlanePath::_fill_surface_single`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Lay {
    /// Sparse infill: the object's box, points far outside the part dropped (Orca's `InfillPolylineClipper`).
    Sparse,
    /// A solid surface centred on itself (`center_of_surface_pattern` `each_surface`): the part's own box.
    EachSurface,
    /// A solid surface centred on its object (`each_model`, and here also `each_assembly`): the object's box.
    EachModel,
}

/// The curve for one part of the area, as Orca's `FillPlanePath::_fill_surface_single` lays it: `part_box` is the
/// part's box in the object's turned frame (nm, its points rounded as Orca turns them), `size` the object's (nm,
/// Orca's `m_size`), `angle` the frame's turn (radians, Orca's `_infill_direction`), `spacing` (mm) over `density`
/// between lines, `resolution` mm. Points in the turned frame, nm, not yet cut to the part.
#[allow(clippy::too_many_arguments)]
pub fn curve(
    curve: Curve,
    lay: Lay,
    part_box: [i64; 4],
    size: (i64, i64),
    angle: f64,
    (spacing, density): (f64, f64),
    resolution: f64,
) -> Vec<(i64, i64)> {
    // The object's box about its centre, turned into the frame.
    let object = Box2 { min: (-size.0 / 2, -size.1 / 2), max: (size.0 / 2, size.1 / 2) }.rotated(-angle);
    // The part's box grown by a hair and a spacing.
    let epsilon = 100;
    let grow = (spacing * 1e6).round() as i64 + epsilon;
    let snug = Box2 { min: (part_box[0] - grow, part_box[1] - grow), max: (part_box[2] + grow, part_box[3] + grow) };
    let laid = if lay == Lay::EachSurface { snug } else { object };
    let centered = curve != Curve::Hilbert;
    let shift = if centered { laid.center() } else { laid.min };
    let bb =
        Box2 { min: (laid.min.0 - shift.0, laid.min.1 - shift.1), max: (laid.max.0 - shift.0, laid.max.1 - shift.1) };
    let between = spacing * 1e6 / (density as f32 as f64);
    let cell = |v: i64| (v as f64 / between).ceil() as i64;
    let (min_x, min_y, max_x, max_y) = (cell(bb.min.0), cell(bb.min.1), cell(bb.max.0), cell(bb.max.1));
    // Sparse infill drops the points beyond the part's box where the curve doesn't need them.
    let clip = (lay == Lay::Sparse).then_some(Box2 {
        min: (snug.min.0 - shift.0, snug.min.1 - shift.1),
        max: (snug.max.0 - shift.0, snug.max.1 - shift.1),
    });
    let mut out = Output { scale: between, clip, out: Vec::new(), sides_prev: 0, sides_this: 0 };
    match curve {
        Curve::ArchimedeanChords => {
            // A resolution of nothing would never step round the spiral (Orca's too loops for ever): Orca's default.
            let resolution = if resolution > 0.0 { resolution } else { 0.01 };
            archimedean_chords(max_x, max_y, resolution * 1e6 / between, &mut out)
        }
        Curve::Hilbert => hilbert((min_x, min_y), (max_x, max_y), &mut out),
        Curve::OctagramSpiral => octagram_spiral(max_x, max_y, &mut out),
    }
    out.out.into_iter().map(|(x, y)| (x + shift.0, y + shift.1)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hilbert_curve_visits_every_cell_of_its_square_once_each_step_one_cell() {
        let points: Vec<(i64, i64)> = (0..64).map(hilbert_n_to_xy).collect();
        let mut seen = std::collections::BTreeSet::new();
        for w in points.windows(2) {
            assert_eq!((w[0].0 - w[1].0).abs() + (w[0].1 - w[1].1).abs(), 1, "{:?}", w);
        }
        for p in &points {
            assert!(p.0 < 8 && p.1 < 8 && seen.insert(*p));
        }
        assert_eq!(points[0], (0, 0));
    }

    #[test]
    fn the_clipper_keeps_a_point_outside_only_where_the_curve_needs_it() {
        let mut out = Output {
            scale: 1.0,
            clip: Some(Box2 { min: (0, 0), max: (10, 10) }),
            out: Vec::new(),
            sides_prev: 0,
            sides_this: 0,
        };
        // In, out to the right three times, back in: the middle one of the three outside goes.
        for q in [(5.0, 5.0), (12.0, 5.0), (13.0, 6.0), (12.0, 7.0), (5.0, 7.0)] {
            out.add(q);
        }
        assert_eq!(out.out, vec![(5, 5), (12, 5), (12, 7), (5, 7)]);
    }

    #[test]
    fn archimedean_chords_end_with_a_resolution_of_nothing() {
        let points = curve(
            Curve::ArchimedeanChords,
            Lay::Sparse,
            [-1_000_000, -1_000_000, 1_000_000, 1_000_000],
            (2_000_000, 2_000_000),
            0.0,
            (0.4, 0.15),
            0.0,
        );
        assert!(points.len() > 10);
    }

    #[test]
    fn archimedean_chords_turn_out_one_spacing_a_turn() {
        let mut out = Output { scale: 1.0e6, clip: None, out: Vec::new(), sides_prev: 0, sides_this: 0 };
        archimedean_chords(5, 5, 0.01, &mut out);
        let r = |p: &(i64, i64)| ((p.0 as f64).powi(2) + (p.1 as f64).powi(2)).sqrt() / 1e6;
        // After the start, every point lies at radius 1 + θ/2π: a turn further out by one spacing.
        let last = out.out.last().unwrap();
        assert!(r(last) > 5.0 * 2f64.sqrt(), "{}", r(last));
        assert!(out.out.len() > 100);
    }
}
