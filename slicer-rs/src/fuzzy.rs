//! Fuzzy skin, as Orca 2.5.1's `FuzzySkin.cpp` makes it on classic walls: each wall loop it asks for is walked
//! and given new points every three quarters to five quarters of `fuzzy_skin_point_distance`, each moved sideways
//! by the noise times `fuzzy_skin_thickness` (Cura's fuzzy skin), or for ripples resampled every point distance and
//! moved by a sine wave along the loop. Where a wall runs beyond the layer below grown by an outer wall's width and the
//! thickness, it stays smooth: the loop is split there and only its runs over that area are fuzzed, each between its
//! unmoved ends (Orca's `split_line` and `apply_fuzzy_skin`).
//!
//! The noise is libnoise's (`noise.rs`) at the point's place in the object's own coordinates (from the middle of its
//! bounding box) and the layer's slicing height, or for `classic` uniform noise from a random generator. Orca draws
//! that, and the jitter in the points' spacing for every noise but ripples, from `std::mt19937` seeded by the system,
//! so no two of its slices are alike; ours draws from the same generator, seeded by the layer, so the same model
//! gives the same file on any number of threads and in WebAssembly.

use crate::config::{Fuzzy, FuzzyNoise};
use crate::geom::{self, Contour, Pt, Shapes};
use crate::noise::Noise;

/// The 32-bit Mersenne Twister (`std::mt19937`).
pub struct Mt {
    state: [u32; 624],
    index: usize,
}

impl Mt {
    pub fn new(seed: u32) -> Mt {
        let mut state = [0u32; 624];
        state[0] = seed;
        for i in 1..624 {
            state[i] = 1812433253u32.wrapping_mul(state[i - 1] ^ (state[i - 1] >> 30)).wrapping_add(i as u32);
        }
        Mt { state, index: 624 }
    }

    pub fn next_u32(&mut self) -> u32 {
        if self.index >= 624 {
            for i in 0..624 {
                let y = (self.state[i] & 0x8000_0000) | (self.state[(i + 1) % 624] & 0x7fff_ffff);
                let mut v = self.state[(i + 397) % 624] ^ (y >> 1);
                if y & 1 != 0 {
                    v ^= 0x9908_b0df;
                }
                self.state[i] = v;
            }
            self.index = 0;
        }
        let mut y = self.state[self.index];
        self.index += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c_5680;
        y ^= (y << 15) & 0xefc6_0000;
        y ^ (y >> 18)
    }

    /// `std::uniform_real_distribution<double>(0, 1)` as libstdc++ draws it (`generate_canonical` from two draws).
    pub fn unit(&mut self) -> f64 {
        let low = self.next_u32() as f64;
        let high = self.next_u32() as f64;
        let r = (low + high * 4294967296.0) / 18446744073709551616.0;
        if r >= 1.0 { 1.0 - f64::EPSILON / 2.0 } else { r }
    }
}

/// What moves a fuzzy point: libnoise's module, or uniform noise from the generator.
enum Source {
    Uniform,
    Coherent(Noise),
}

/// One layer's fuzzy skin: its settings, its slicing height, Orca's id of the layer and the generator.
pub struct Layer<'a> {
    pub fuzzy: &'a Fuzzy,
    pub slice_z: f64,
    pub layer_id: usize,
    pub rng: Mt,
}

impl<'a> Layer<'a> {
    pub fn new(fuzzy: &'a Fuzzy, slice_z: f64, layer_id: usize) -> Layer<'a> {
        Layer { fuzzy, slice_z, layer_id, rng: Mt::new(5489u32.wrapping_add(layer_id as u32)) }
    }

    fn source(&self) -> Source {
        let f = self.fuzzy;
        let frequency = 1.0 / f.scale;
        match f.noise {
            FuzzyNoise::Perlin => {
                Source::Coherent(Noise::Perlin { frequency, octaves: f.octaves, persistence: f.persistence })
            }
            FuzzyNoise::Billow => {
                Source::Coherent(Noise::Billow { frequency, octaves: f.octaves, persistence: f.persistence })
            }
            FuzzyNoise::RidgedMulti => Source::Coherent(Noise::RidgedMulti { frequency, octaves: f.octaves }),
            FuzzyNoise::Voronoi => Source::Coherent(Noise::Voronoi { frequency }),
            FuzzyNoise::Classic | FuzzyNoise::Ripple => Source::Uniform,
        }
    }

    /// A loop (`contour`, not repeating its first point) at `depth` with fuzzy skin where Orca gives it some:
    /// `supported` is where a wall may be fuzzy (None on the first layer: anywhere), `centre` the object's middle in
    /// plate units.
    pub fn fuzz_loop(
        &mut self,
        contour: &Contour,
        depth: usize,
        supported: Option<&Shapes>,
        centre: (f64, f64),
    ) -> Contour {
        let outline = geom::area2(contour) > 0;
        if contour.len() < 3 || !self.fuzzy.fuzzes(self.layer_id, depth, outline) {
            return contour.clone();
        }
        let Some(area) = supported else {
            let mut out = contour.clone();
            self.polyline(&mut out, true, centre);
            return out;
        };
        let split = split(contour, area);
        if split.is_empty() || split.iter().all(|&(_, inside)| !inside) {
            return contour.clone();
        }
        if split.iter().all(|&(_, inside)| inside) {
            let mut out = contour.clone();
            self.polyline(&mut out, true, centre);
            return out;
        }
        // From a junction outside, each run inside between its ends that stay where they are.
        let first = split.iter().position(|&(_, inside)| !inside).unwrap_or(0);
        let junctions: Vec<(Pt, bool)> = split[first..].iter().chain(&split[..first]).copied().collect();
        let mut out: Contour = Vec::with_capacity(contour.len() * 2);
        let mut segment: Vec<Pt> = Vec::new();
        let finish = |segment: &mut Vec<Pt>, out: &mut Contour, this: &mut Self| {
            out.push(segment[0]);
            let back = segment[segment.len() - 1];
            this.polyline(segment, false, centre);
            out.extend(segment.iter().copied());
            out.push(back);
            segment.clear();
        };
        for &(p, inside) in &junctions {
            if inside {
                segment.push(p);
            } else if segment.is_empty() {
                out.push(p);
            } else {
                segment.push(p);
                finish(&mut segment, &mut out, self);
            }
        }
        if !segment.is_empty() {
            segment.push(junctions[0].0);
            finish(&mut segment, &mut out, self);
        }
        out.dedup();
        while out.len() > 1 && out[0] == out[out.len() - 1] {
            out.pop();
        }
        if out.len() >= 3 { out } else { contour.clone() }
    }

    /// Orca's `fuzzy_polyline`: `poly`'s new points, moved by the noise, when there are at least three (a closed
    /// loop starts with the stretch from its last point to its first; an open line's first point only starts it).
    /// Ripples resample the line as a loop whether or not it is one, as Orca's do.
    fn polyline(&mut self, poly: &mut Vec<Pt>, closed: bool, centre: (f64, f64)) {
        let f = self.fuzzy;
        if f.noise == FuzzyNoise::Ripple {
            if poly.len() >= 3 {
                self.ripple(poly, centre);
            }
            return;
        }
        let source = self.source();
        let scale = geom::SCALE;
        let distance = f.point_distance * scale;
        let thickness = f.thickness * scale;
        if distance.is_nan() || distance <= 0.0 {
            return;
        }
        let min_between = distance * 3.0 / 4.0;
        let range = distance / 2.0;
        let mut left_over = self.rng.unit() * (min_between / 2.0);
        let n = poly.len();
        let mut out: Vec<Pt> = Vec::with_capacity(n * 2);
        let mut p0 = poly[n - 1];
        let mut skip = !closed;
        for &p1 in poly.iter() {
            if skip {
                skip = false;
                p0 = p1;
                continue;
            }
            let (dx, dy) = ((p1.x - p0.x) as f64, (p1.y - p0.y) as f64);
            let size = (dx * dx + dy * dy).sqrt();
            let mut along = left_over;
            while along < size {
                let t = along / size;
                let a = geom::pt(p0.x + (dx * t) as i32, p0.y + (dy * t) as i32);
                let r = match &source {
                    Source::Uniform => self.rng.unit() * 2.0 - 1.0,
                    Source::Coherent(noise) => {
                        let x = (a.x as f64 - centre.0) / scale;
                        let y = (a.y as f64 - centre.1) / scale;
                        noise.value(x, y, self.slice_z)
                    }
                } * thickness;
                // Orca's `perp`, (−y, x), normalised.
                let (px, py) = (-dy / size, dx / size);
                out.push(geom::pt(a.x + (px * r) as i32, a.y + (py * r) as i32));
                along += min_between + self.rng.unit() * range;
            }
            left_over = along - size;
            p0 = p1;
        }
        while out.len() < 3 {
            out.push(poly[n - 2]);
            if n == 2 {
                break;
            }
        }
        if out.len() >= 3 {
            *poly = out;
        }
    }

    /// Orca's `fuzzy_polyline_ripple`: the loop resampled every point distance along it, each point moved by a sine
    /// wave of `fuzzy_skin_ripples_per_layer` waves round the loop, peaking at its leftmost crossing of the object's
    /// middle (y = 0), shifted by the ripple offset every so many layers.
    fn ripple(&mut self, poly: &mut Vec<Pt>, centre: (f64, f64)) {
        let f = self.fuzzy;
        let waves = f.ripples_per_layer as f64;
        let step = f.point_distance;
        if waves <= 0.0 || step < 1e-6 {
            return;
        }
        let scale = geom::SCALE;
        let mm = |p: Pt| ((p.x as f64 - centre.0) / scale, (p.y as f64 - centre.1) / scale);
        let n = poly.len();
        let perimeter: f64 = (0..n)
            .map(|i| {
                let (a, b) = (poly[i], poly[(i + 1) % n]);
                ((b.x - a.x) as f64).hypot((b.y - a.y) as f64) / scale
            })
            .sum();
        if perimeter < 1e-6 {
            return;
        }
        let anchor = ripple_anchor(poly, &mm);
        let shift = if f.ripple_offset == 0.0 || f.layers_between_ripple_offset <= 0 {
            0.0
        } else {
            let period = self.layer_id as i64 / f.layers_between_ripple_offset.max(1);
            (period as f64 * (f.ripple_offset / 100.0) * (2.0 * std::f64::consts::PI)) % (2.0 * std::f64::consts::PI)
        };
        let at_anchor = std::f64::consts::PI * 2.0 + shift;
        let phase = |s: f64| waves * (2.0 * std::f64::consts::PI) * (s - anchor) / perimeter + at_anchor;
        let mut out: Vec<Pt> = Vec::with_capacity((perimeter / step) as usize + n * 2);
        let mut accum = 0.0;
        for i in 0..n {
            let (p0, p1) = (poly[i], poly[(i + 1) % n]);
            let (dx, dy) = ((p1.x - p0.x) as f64, (p1.y - p0.y) as f64);
            let len = (dx * dx + dy * dy).sqrt();
            if len < 1e-4 {
                continue;
            }
            let len_mm = len / scale;
            let (px, py) = (-dy / len, dx / len);
            let end = accum + len_mm;
            let mut s = (accum / step).ceil() * step;
            while s < end {
                let t = (s - accum) / len_mm;
                let d = libm::sin(phase(s)) * f.thickness * scale;
                let base = geom::pt(p0.x + (dx * t) as i32, p0.y + (dy * t) as i32);
                out.push(geom::pt(base.x + (px * d) as i32, base.y + (py * d) as i32));
                s += step;
            }
            accum = end;
        }
        while out.len() < 3 {
            out.push(poly[n - 2]);
        }
        *poly = out;
    }
}

/// mm along the loop to its ripples' anchor: its leftmost crossing of y = 0, else its point nearest that line.
fn ripple_anchor(poly: &[Pt], mm: &dyn Fn(Pt) -> (f64, f64)) -> f64 {
    let n = poly.len();
    let mut anchor = (f64::MAX, f64::MAX);
    let mut found = false;
    for i in 0..n {
        let (a, b) = (mm(poly[i]), mm(poly[(i + 1) % n]));
        if (a.1 <= 0.0 && b.1 >= 0.0) || (a.1 >= 0.0 && b.1 <= 0.0) {
            let t = if (b.1 - a.1).abs() < 1e-9 { 0.0 } else { a.1 / (a.1 - b.1) };
            let x = a.0 + t.clamp(0.0, 1.0) * (b.0 - a.0);
            if !found || x < anchor.0 {
                anchor = (x, 0.0);
                found = true;
            }
        }
    }
    if !found {
        let mut best = f64::MAX;
        for &p in poly {
            let q = mm(p);
            if q.1.abs() < best {
                best = q.1.abs();
                anchor = q;
            }
        }
    }
    let (mut at, mut best, mut accum) = (0.0, f64::MAX, 0.0);
    for i in 0..n {
        let (a, b) = (mm(poly[i]), mm(poly[(i + 1) % n]));
        let (sx, sy) = (b.0 - a.0, b.1 - a.1);
        let len = sx.hypot(sy);
        if len > 1e-9 {
            let t = (((anchor.0 - a.0) * sx + (anchor.1 - a.1) * sy) / (len * len)).clamp(0.0, 1.0);
            let (fx, fy) = (a.0 + sx * t - anchor.0, a.1 + sy * t - anchor.1);
            let d = fx * fx + fy * fy;
            if d < best {
                best = d;
                at = accum + t * len;
            }
        }
        accum += len;
    }
    at
}

fn contour_box(c: &[Pt]) -> [i32; 4] {
    c.iter().fold([i32::MAX, i32::MAX, i32::MIN, i32::MIN], |b, p| {
        [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)]
    })
}

/// A closed loop's junctions along it from its first point, each with whether the stretch from it to the next lies
/// in `area` (Orca's `split_line` on a closed polygon): its own points, and a new one wherever it crosses `area`'s
/// edge.
fn split(contour: &Contour, area: &Shapes) -> Vec<(Pt, bool)> {
    let b = geom::inflate(contour_box(contour), 0.01);
    let near: Vec<&Contour> = area
        .iter()
        .flatten()
        .filter(|c| {
            let cb = contour_box(c);
            cb[0] <= b[2] && cb[2] >= b[0] && cb[1] <= b[3] && cb[3] >= b[1]
        })
        .collect();
    let n = contour.len();
    let inside = |p: (f64, f64)| geom::contains(area, geom::pt(p.0.round() as i32, p.1.round() as i32));
    if near.is_empty() {
        let at = (contour[0].x as f64, contour[0].y as f64);
        return contour.iter().map(|&p| (p, inside(at))).collect();
    }
    let mut out: Vec<(Pt, bool)> = Vec::with_capacity(n);
    let mut cuts: Vec<f64> = Vec::new();
    for i in 0..n {
        let (a, b) = (contour[i], contour[(i + 1) % n]);
        let (fa, fb) = ((a.x as f64, a.y as f64), (b.x as f64, b.y as f64));
        cuts.clear();
        for c in &near {
            let m = c.len();
            for j in 0..m {
                let (c0, c1) = (c[j], c[(j + 1) % m]);
                if c0.x.max(c1.x) < a.x.min(b.x)
                    || c0.x.min(c1.x) > a.x.max(b.x)
                    || c0.y.max(c1.y) < a.y.min(b.y)
                    || c0.y.min(c1.y) > a.y.max(b.y)
                {
                    continue;
                }
                if let Some((t, _)) = crate::fill::crossing(fa, fb, c0, c1) {
                    cuts.push(t);
                }
            }
        }
        cuts.sort_by(f64::total_cmp);
        let at = |t: f64| (fa.0 + (fb.0 - fa.0) * t, fa.1 + (fb.1 - fa.1) * t);
        let mut from = 0.0;
        let mut start = a;
        for &t in cuts.iter().chain(std::iter::once(&1.0)) {
            if t - from > 1e-9 {
                out.push((start, inside(at((from + t) / 2.0))));
            }
            let q = at(t);
            start = geom::pt(q.0.round() as i32, q.1.round() as i32);
            from = t;
        }
    }
    out.dedup_by(|b, a| a.0 == b.0);
    out
}

/// Each island's wall loops with fuzzy skin where Orca gives them some, on object layer `layer` (`layer_id` Orca's id
/// of it, counting a raft's layers) sliced at `slice_z`, over the layer below `lower` (none on the first).
pub fn islands(
    islands: &mut [crate::region::Island],
    centres: &[(f64, f64)],
    lower: Option<&Shapes>,
    slice_z: f64,
    layer_id: usize,
    s: &crate::config::Settings,
) {
    let f = &s.fuzzy;
    if !f.on() || islands.iter().all(|i| i.walls.is_empty()) {
        return;
    }
    // Walls further from the layer below than an outer wall's width and the thickness bridge: they stay smooth.
    let supported = lower.map(|l| geom::offset(l, s.outer_wall_width + f.thickness));
    let mut layer = Layer::new(f, slice_z, layer_id);
    for island in islands {
        let centre = centres.get(island.object as usize).copied().unwrap_or((0.0, 0.0));
        for (depth, loops) in island.walls.iter_mut().enumerate() {
            for contour in loops.iter_mut() {
                *contour = layer.fuzz_loop(contour, depth, supported.as_ref(), centre);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_point_distance_of_nothing_still_ends() {
        // Orca refuses a point distance under 0.01 mm; ours reads one as that, so the walk along a loop ends.
        let s = crate::setup::read(r#"{"process": {"fuzzy_skin": "external", "fuzzy_skin_point_distance": "0"}}"#)
            .unwrap()
            .settings;
        assert_eq!(s.fuzzy.point_distance, 0.01);
        let square: Contour =
            vec![geom::pt(0, 0), geom::pt(100_000, 0), geom::pt(100_000, 100_000), geom::pt(0, 100_000)];
        let fuzzed = Layer::new(&s.fuzzy, 1.0, 1).fuzz_loop(&square, 0, None, (0.0, 0.0));
        assert!(fuzzed.len() > 1000 && fuzzed.len() < 100_000, "{} points", fuzzed.len());
    }

    #[test]
    fn mt19937_gives_the_standard_sequence() {
        // std::mt19937's 10000th output from its default seed, as the standard gives it.
        let mut mt = Mt::new(5489);
        let mut v = 0;
        for _ in 0..10000 {
            v = mt.next_u32();
        }
        assert_eq!(v, 4123659995);
    }
}
