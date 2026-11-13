//! The model as the trees see it: Orca's `TreeModelVolumes`, for each branch radius and layer.
//!
//! - **Collision**: where the centre of a branch of a radius would touch the model on a layer, from the layers within
//!   the support's z gaps, kept the smallest xy gap off it.
//! - **Hole-free collision**: the same for small branches, with the holes and gaps filled that a full branch could
//!   not get out of again.
//! - **Placeable areas**: where a branch fits on top of the model.
//! - **Avoidance**: where a branch's centre must not be to still reach the plate (or the plate or the model's top)
//!   moving at most so far a layer, fast or slow: the collision, plus the avoidance of the layer below shrunk by the
//!   move, layer by layer up from the plate.
//! - **Wall restrictions**: what a branch's area may not cross from one layer to the next.
//!
//! Radii are rounded up to a few keys (0.4, 1.5, 2.6 mm, then half as much again each), and each value is computed
//! once, when first asked for (`OnceLock`), as Orca's caches fill; `precalculate` fills what Orca fills up front,
//! in parallel.

use super::{Config, mm};
use crate::geom::{self, Join, Shapes};
use crate::par;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};

/// How fast a branch moves: Orca's `AvoidanceType`, in its order (the merge takes the smallest).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Hash)]
pub enum Avoid {
    Slow = 0,
    FastSafe = 1,
    Fast = 2,
}

/// One value per layer, each computed on first use.
struct Cells(Vec<OnceLock<Shapes>>);

impl Cells {
    fn new(n: usize) -> Cells {
        Cells((0..n).map(|_| OnceLock::new()).collect())
    }
}

/// The model's volumes, for one object.
pub struct Volumes {
    layers: usize,
    /// Each layer's outline, simplified as Orca simplifies it.
    outlines: Vec<Shapes>,
    max_move: i64,
    max_move_slow: i64,
    min_xy: i64,
    /// `xy_distance − xy_min_distance`: the regular gap's radius on top of the smallest one.
    delta: i64,
    increase_until_radius: i64,
    radius_0: i64,
    resolution: f64,
    z_bottom: usize,
    z_top: usize,
    ignorable: Vec<i64>,
    /// The radius keys, ascending: 0, the delta, then the rounded radii.
    keys: Vec<i64>,
    offsetted: Vec<Cells>,
    collision: Vec<Cells>,
    /// One more than the highest layer each collision key was asked for, 0 for none (Orca's cache holds every
    /// layer up to it).
    collision_top: Vec<AtomicUsize>,
    holefree: Vec<Cells>,
    placeable_0: Cells,
    placeable: Vec<Cells>,
    /// By `Avoid` and whether it may end on the model: `[type as usize + 3 * to_model]`.
    avoidance: [Vec<Cells>; 6],
    wall: Vec<Cells>,
    wall_min: Vec<Cells>,
    /// The plate, in the plate's units.
    pub bed: Shapes,
}

impl Volumes {
    /// The volumes of an object whose layers' slices are `slices` (the first as sliced), on a plate `bed` mm wide.
    pub fn new(slices: &[Shapes], c: &Config, bed: [f64; 2]) -> Volumes {
        let layers = slices.len();
        let resolution = mm(c.resolution as f64);
        let outlines: Vec<Shapes> = par::map_range(layers, |l| geom::simplify_polygons(&slices[l], resolution));
        let mut v = Volumes {
            layers,
            outlines,
            max_move: c.maximum_move_distance - 2,
            max_move_slow: c.maximum_move_distance_slow - 2,
            min_xy: c.xy_min_distance,
            delta: c.xy_distance - c.xy_min_distance,
            increase_until_radius: c.increase_radius_until_radius,
            radius_0: c.radius(0, 0.0),
            resolution,
            z_bottom: c.z_distance_bottom_layers,
            z_top: c.z_distance_top_layers,
            ignorable: Vec::new(),
            keys: Vec::new(),
            offsetted: Vec::new(),
            collision: Vec::new(),
            collision_top: Vec::new(),
            holefree: Vec::new(),
            placeable_0: Cells::new(layers),
            placeable: Vec::new(),
            avoidance: Default::default(),
            wall: Vec::new(),
            wall_min: Vec::new(),
            bed: {
                let (x, y) = (geom::sc(bed[0]), geom::sc(bed[1]));
                vec![vec![vec![geom::pt(0, 0), geom::pt(x, 0), geom::pt(x, y), geom::pt(0, y)]]]
            },
        };
        // Radii between the tip's and the branch's that no tip has are skipped (none for the X2D's).
        let mut tips: Vec<i64> = (0..=c.tip_layers)
            .flat_map(|d| [v.ceil_radius(c.radius(d, 0.0)), v.ceil_radius(c.radius(d, 0.0) + v.delta)])
            .collect();
        tips.sort_unstable();
        tips.dedup();
        let mut ignorable = Vec::new();
        let mut r = v.radius_0;
        while r <= c.branch_radius {
            if tips.binary_search(&r).is_err() {
                ignorable.push(r);
            }
            r = v.ceil_radius(r + 1);
        }
        v.ignorable = ignorable;
        // Keys up to a metre: more than any branch reaches.
        let mut keys = vec![0];
        if v.delta > 0 {
            keys.push(v.delta);
        }
        let mut r = v.radius_0;
        while r < 1_000_000_000 {
            keys.push(r);
            r = v.ceil_radius(r + 1);
        }
        keys.sort_unstable();
        keys.dedup();
        let grid = |n: usize| -> Vec<Cells> { (0..n).map(|_| Cells::new(layers)).collect() };
        let k = keys.len();
        v.offsetted = grid(k);
        v.collision = grid(k);
        v.collision_top = (0..k).map(|_| AtomicUsize::new(0)).collect();
        v.holefree = grid(k);
        v.placeable = grid(k);
        v.avoidance = std::array::from_fn(|_| grid(k));
        v.wall = grid(k);
        v.wall_min = grid(k);
        v.keys = keys;
        v
    }

    pub fn layer_count(&self) -> usize {
        self.layers
    }

    /// Orca's `ceilRadius`: a radius rounded up to its key.
    pub fn ceil_radius(&self, radius: i64) -> i64 {
        if radius == 0 {
            return 0;
        }
        let mut out = self.radius_0;
        if radius > self.radius_0 {
            const THRESHOLD: i64 = 1_500_000;
            const RESOLUTION: i64 = 500_000;
            let ignore = |r: i64| self.ignorable.binary_search(&r).is_ok();
            let initial = THRESHOLD - self.radius_0;
            if initial > RESOLUTION {
                let steps = (initial + THRESHOLD - 1) / THRESHOLD;
                let step = initial / steps;
                out += step;
                for _ in 0..steps {
                    if out >= radius && !ignore(out) {
                        return out;
                    }
                    out += step;
                }
            } else {
                out += RESOLUTION;
            }
            while out < radius || ignore(out) {
                out = (out as f64 * 1.5) as i64;
            }
        }
        out
    }

    /// The key of a radius kept the smallest xy gap off the model (`min_xy`), or the regular one.
    pub fn ceil_radius_xy(&self, radius: i64, min_xy: bool) -> i64 {
        if min_xy {
            self.ceil_radius(radius)
        } else if radius > 0 {
            self.ceil_radius(radius + self.delta)
        } else {
            self.delta
        }
    }

    /// The largest radius that rounds to the same key (`getRadiusNextCeil`).
    pub fn radius_next_ceil(&self, radius: i64, min_xy: bool) -> i64 {
        if min_xy { self.ceil_radius(radius) } else { self.ceil_radius(radius + self.delta) - self.delta }
    }

    fn key(&self, key: i64) -> usize {
        self.keys.binary_search(&key).unwrap_or_else(|_| panic!("{key} is not a radius key"))
    }

    fn outline(&self, l: usize) -> &Shapes {
        &self.outlines[l]
    }

    /// A layer's outline grown by a key's radius and the smallest xy gap.
    fn offsetted(&self, k: usize, l: usize) -> &Shapes {
        self.offsetted[k].0[l].get_or_init(|| {
            let d = self.keys[k] + self.min_xy;
            if d == 0 {
                self.outline(l).clone()
            } else {
                geom::offset_c2(self.outline(l), mm(d as f64), Join::Miter(1.2))
            }
        })
    }

    fn collision_key(&self, k: usize, l: usize) -> &Shapes {
        self.collision_top[k].fetch_max(l + 1, Ordering::Relaxed);
        self.collision[k].0[l].get_or_init(|| {
            let r = self.keys[k];
            let mut parts: Vec<&Shapes> = Vec::new();
            let mut above: Vec<Shapes> = Vec::new();
            for j in l.saturating_sub(self.z_bottom)..=l {
                parts.push(self.offsetted(k, j));
            }
            for i in 1..=self.z_top {
                let j = l + i;
                if j < self.layers {
                    let half = if self.z_top == 1 { 0.5 } else { 0.0 };
                    let range =
                        (self.min_xy as f64 - (i as f64 - half) * self.min_xy as f64 / self.z_top as f64) as i64;
                    above.push(geom::offset_c2(self.outline(j), mm((r + range) as f64), Join::Miter(1.2)));
                }
            }
            parts.extend(above.iter());
            geom::simplify_polygons(&geom::union_all(&parts), self.resolution)
        })
    }

    /// Where the centre of a branch of `radius` would touch the model on `layer` (`getCollision`).
    pub fn collision(&self, radius: i64, layer: usize, min_xy: bool) -> &Shapes {
        self.collision_key(self.key(self.ceil_radius_xy(radius, min_xy)), layer)
    }

    /// The collision with the largest radius key at most `max_radius` that has been asked for on `layer`
    /// (`get_collision_lower_bound_area`), and that key.
    pub fn collision_lower_bound(&self, layer: usize, max_radius: i64) -> Option<(i64, &Shapes)> {
        (0..self.keys.len()).rev().filter(|&k| self.keys[k] <= max_radius).find_map(|k| {
            (self.collision_top[k].load(Ordering::Relaxed) > layer)
                .then(|| (self.keys[k], self.collision_key(k, layer)))
        })
    }

    /// The hole-free collision of a small key (`getCollisionHolefree`).
    fn holefree(&self, k: usize, l: usize) -> &Shapes {
        self.holefree[k].0[l].get_or_init(|| {
            let big = self.ceil_radius_xy(self.increase_until_radius, false);
            let increase = big - self.keys[k];
            let grown = self.collision_key(self.key(big), l);
            geom::simplify_polygons(
                &geom::offset_c2(grown, mm((5 - increase) as f64), Join::Round(self.resolution)),
                self.resolution,
            )
        })
    }

    /// Where a branch's centre can rest on the model's top on `layer` (radius 0), and for a radius.
    fn placeable_zero(&self, l: usize) -> &Shapes {
        self.placeable_0.0[l].get_or_init(|| {
            if l < self.z_bottom + 1 {
                return Vec::new();
            }
            let below = self.outline(l - self.z_bottom - 1);
            let grown = geom::offset_c2(below, mm(self.min_xy as f64), Join::Miter(3.0));
            geom::simplify_polygons(&geom::difference(&grown, self.offsetted(self.key(0), l)), self.resolution)
        })
    }

    /// Where a branch of `radius` fits on top of the model on `layer` (`getPlaceableAreas`).
    pub fn placeable(&self, radius: i64, layer: usize) -> &Shapes {
        let key = self.ceil_radius(radius);
        if key == 0 {
            return self.placeable_zero(layer);
        }
        let k = self.key(key);
        self.placeable[k].0[layer].get_or_init(|| {
            if layer == 0 {
                return Vec::new();
            }
            geom::offset_c2(self.placeable_zero(layer), -mm((key + self.min_xy + self.delta) as f64), Join::Miter(1.2))
        })
    }

    /// Where the centre of a branch of `radius` on `layer` must not be to reach the plate (or, `to_model`, the plate
    /// or the model's top) moving at most so far a layer (`getAvoidance`).
    pub fn avoidance(&self, radius: i64, layer: usize, kind: Avoid, to_model: bool, min_xy: bool) -> &Shapes {
        if layer == 0 {
            return self.collision(radius, 0, min_xy);
        }
        let key = self.ceil_radius_xy(radius, min_xy);
        let kind =
            if kind == Avoid::FastSafe && key >= self.increase_until_radius + self.delta { Avoid::Fast } else { kind };
        self.avoidance_key(kind, to_model, self.key(key), layer)
    }

    fn avoidance_key(&self, kind: Avoid, to_model: bool, k: usize, l: usize) -> &Shapes {
        let cells = &self.avoidance[kind as usize + 3 * to_model as usize][k];
        if let Some(done) = cells.0[l].get() {
            return done;
        }
        // Up from the highest layer already known, as Orca's recurrence goes.
        let mut start = l;
        while start > 1 && cells.0[start - 1].get().is_none() {
            start -= 1;
        }
        for (j, cell) in cells.0.iter().enumerate().take(l + 1).skip(start) {
            cell.get_or_init(|| self.avoidance_step(kind, to_model, k, j));
        }
        cells.0[l].get().expect("filled above")
    }

    fn avoidance_step(&self, kind: Avoid, to_model: bool, k: usize, l: usize) -> Shapes {
        let r = self.keys[k];
        let previous: &Shapes = if l == 1 {
            self.collision_key(k, 0)
        } else {
            self.avoidance[kind as usize + 3 * to_model as usize][k].0[l - 1].get().expect("the layer below first")
        };
        let holefree = matches!(kind, Avoid::Slow | Avoid::FastSafe) && r < self.increase_until_radius + self.delta;
        let here = if holefree { self.holefree(k, l) } else { self.collision_key(k, l) };
        let max_move = if kind == Avoid::Slow { self.max_move_slow } else { self.max_move } as f32;
        let mut step = (1.9 * r.max(self.min_xy) as f64) as f32;
        let mut steps = ((max_move as i32 + step as i32 - 1) / (step as i32).max(1)).max(1);
        let mut last = max_move - (steps - 1) as f32 * step;
        if last < 50_000.0 && steps > 1 {
            steps -= 1;
            step = max_move / steps as f32;
            last = step;
        }
        let mut avoid = previous.clone();
        for i in 0..steps {
            let d = if i + 1 == steps { last } else { step };
            avoid = geom::union(here, &geom::offset_c2(&avoid, -mm(d as f64), Join::Round(self.resolution)));
        }
        if to_model {
            avoid = geom::difference(&avoid, self.placeable(r, l));
        }
        geom::simplify_polygons(&avoid, self.resolution)
    }

    /// What a branch's area may not cross from `layer` to the one below (`getWallRestriction`).
    pub fn wall_restriction(&self, radius: i64, layer: usize, min_xy: bool) -> &Shapes {
        if layer == 0 {
            return self.collision(radius, 0, min_xy);
        }
        let min_xy = min_xy && self.delta > 0;
        let k = self.key(self.ceil_radius(radius));
        let cells = if min_xy { &self.wall_min[k] } else { &self.wall[k] };
        cells.0[layer].get_or_init(|| {
            let here = self.collision(0, layer, min_xy);
            geom::simplify_polygons(&geom::intersection(here, self.collision_key(k, layer - 1)), self.resolution)
        })
    }

    /// Fills what Orca's `precalculate` fills for supports up to `max_layer`, in parallel: the radius keys a
    /// branch may have on each layer (a tip's, a branch's from its tip down, and the foot's near the plate), with
    /// their collisions, hole-free collisions, placeable areas, avoidances and wall restrictions.
    pub fn precalculate(&self, c: &Config, max_layer: usize) {
        let max_layer = max_layer.min(self.layers.saturating_sub(1));
        let mut until: std::collections::BTreeMap<i64, usize> = std::collections::BTreeMap::new();
        for dtt in 0..=max_layer {
            let layer = max_layer - dtt;
            for r in [
                self.ceil_radius(c.radius(dtt, 0.0) + self.delta),
                self.ceil_radius(c.radius(dtt, 0.0)),
                self.ceil_radius(c.recommended_min_radius(layer as i64) + self.delta),
            ] {
                until.entry(r).or_insert(layer);
            }
        }
        let avoidance: Vec<(i64, usize)> = until.iter().map(|(&r, &l)| (r, l)).collect();
        let mut collision = until.clone();
        collision.insert(self.ceil_radius_xy(self.increase_until_radius, false), max_layer);
        collision.insert(0, max_layer);
        if self.delta != 0 {
            collision.insert(self.delta, max_layer);
        }
        // Collisions and the radius-0 placeable areas, layer by layer.
        let cells: Vec<(usize, usize)> = collision
            .iter()
            .flat_map(|(&r, &top)| (0..=top).map(move |l| (r, l)))
            .map(|(r, l)| (self.key(r), l))
            .collect();
        let timing = std::env::var_os("TREE_TIMINGS").is_some();
        let mut t = std::time::Instant::now();
        let mut lap = |what: &str| {
            if timing {
                eprintln!("  volumes {what}: {:.1} ms", t.elapsed().as_secs_f64() * 1e3);
            }
            t = std::time::Instant::now();
        };
        par::map_range(cells.len(), |i| {
            let (k, l) = cells[i];
            self.collision_key(k, l);
            if self.keys[k] == 0 {
                self.placeable_zero(l);
            }
        });
        let small: Vec<(usize, usize)> = avoidance
            .iter()
            .filter(|(r, _)| *r < self.increase_until_radius + self.delta)
            .flat_map(|&(r, top)| (0..=top).map(move |l| (r, l)))
            .map(|(r, l)| (self.key(r), l))
            .collect();
        lap("collisions");
        par::map_range(small.len(), |i| {
            self.holefree(small[i].0, small[i].1);
        });
        lap("hole-free");
        let placeable: Vec<(i64, usize)> =
            avoidance.iter().flat_map(|&(r, top)| (0..=top).map(move |l| (r, l))).collect();
        par::map_range(placeable.len(), |i| {
            self.placeable(placeable[i].0, placeable[i].1);
        });
        lap("placeable");
        // Avoidances (each a recurrence up its layers) and wall restrictions, all at once.
        // Each an avoidance (its kind and whether it may end on the model) or, without one, the wall restrictions.
        type Task = (Option<(Avoid, bool)>, i64, usize);
        let mut tasks: Vec<Task> = Vec::new();
        for &(r, top) in &avoidance {
            for kind in [Avoid::Slow, Avoid::FastSafe, Avoid::Fast] {
                if kind == Avoid::FastSafe && r >= self.increase_until_radius + self.delta {
                    continue;
                }
                for to_model in [false, true] {
                    tasks.push((Some((kind, to_model)), r, top));
                }
            }
            tasks.push((None, r, top));
        }
        par::map_range(tasks.len(), |i| match tasks[i] {
            (Some((kind, to_model)), r, top) if top >= 1 => {
                self.avoidance_key(kind, to_model, self.key(r), top);
            }
            (None, r, top) => {
                for l in 1..=top {
                    self.wall_restriction(r, l, false);
                    if self.delta > 0 {
                        self.wall_restriction(r, l, true);
                    }
                }
            }
            _ => {}
        });
        lap("avoidance");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::Shape;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]]
    }

    #[test]
    fn radius_keys_and_a_pillars_volumes_come_out_as_orcas() {
        let c = Config::new(&super::super::tests::tree_settings());
        let slices: Vec<Shapes> =
            (0..125)
                .map(|l| {
                    if l < 100 {
                        vec![rect(115.0, 123.0, 125.0, 133.0)]
                    } else {
                        vec![rect(100.0, 123.0, 140.0, 133.0)]
                    }
                })
                .collect();
        let v = Volumes::new(&slices, &c, [256.0, 256.0]);
        // Orca's keys (spec A §3.2).
        assert_eq!(&v.keys[..7], &[0, 140_001, 400_000, 1_500_000, 2_600_000, 3_900_000, 5_850_000]);
        assert_eq!(
            (v.ceil_radius(520_000), v.ceil_radius_xy(400_000, false), v.ceil_radius_xy(0, false)),
            (1_500_000, 1_500_000, 140_001)
        );
        assert_eq!(v.radius_next_ceil(400_000, false), 1_500_000 - 140_001);
        // The pillar's collision for a tip on layer 98: grown by the tip and the smallest gap, 0.61 mm.
        let b = geom::bbox(v.collision(400_000, 98, true)).unwrap();
        assert_eq!(
            b,
            [
                geom::sc(115.0 - 0.609999),
                geom::sc(123.0 - 0.609999),
                geom::sc(125.0 + 0.609999),
                geom::sc(133.0 + 0.609999)
            ]
        );
        // Under the slab's first layer the collision reaches the slab, a half gap less (layer 99 is under 100).
        let b = geom::bbox(v.collision(0, 99, true)).unwrap();
        assert_eq!((b[0], b[2]), (geom::sc(100.0 - 0.104999), geom::sc(140.0 + 0.104999)));
        // On the plate a small branch must keep off the pillar only; higher up, also off where it couldn't get down.
        assert_eq!(v.avoidance(400_000, 0, Avoid::Fast, false, true), v.collision(400_000, 0, true));
        let a = geom::area_mm2(v.avoidance(400_000, 50, Avoid::Fast, false, true));
        assert!(a > geom::area_mm2(v.collision(400_000, 50, true)) - 1e-6, "{a}");
        // Nothing to rest on beside a pillar: no placeable area there, but on the slab's top above it.
        assert!(v.placeable(0, 50).is_empty());
        v.precalculate(&c, 99);
        assert!(v.collision_lower_bound(50, 2_000_000).is_some_and(|(k, _)| k == 1_500_000));
    }
}
