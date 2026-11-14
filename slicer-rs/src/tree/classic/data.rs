//! Orca's `TreeSupportData` for the classic trees: each layer's outline, simplified, and everything below it; the
//! areas a branch of some radius would run into on a layer (its collision), and those it has to keep out of on its
//! way down to still reach the plate (its avoidance).

use crate::geom::{self, Join, Shapes};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// mm: the step radii are rounded up to, and the tolerance outlines are simplified to (Orca's
/// `g_config_tree_support_collision_resolution`, a float).
pub const RESOLUTION: f64 = 0.2f32 as f64;

/// Orca's `scale_`: millimetres to nanometres (a division, as Orca's macro has it).
pub fn scale(mm: f64) -> f64 {
    mm / 0.000_001
}

/// Orca's default offset of a whole set (`offset_ex`, mitred with a limit of 3) by `nm`, which it takes as a float.
pub fn offset_ex(shapes: &Shapes, nm: f64) -> Shapes {
    if shapes.is_empty() { Vec::new() } else { geom::offset_c2(shapes, (nm as f32) as f64 / 1e6, Join::Miter(3.0)) }
}

/// Orca's `expolygons_simplify`: each shape's contours simplified as closed lines (Douglas–Peucker) to `nm`, and the
/// shape made clean again, one shape at a time.
pub fn simplify(shapes: &Shapes, nm: f64) -> Shapes {
    let mut out = Vec::with_capacity(shapes.len());
    for shape in shapes {
        out.extend(geom::simplify_polygons(&vec![shape.clone()], nm / 1e6));
    }
    out
}

/// Orca's `union_ex`.
pub fn union(shapes: Shapes) -> Shapes {
    if shapes.is_empty() { shapes } else { geom::union_all(&[&shapes]) }
}

type Cache = Mutex<HashMap<(u64, usize), Arc<Shapes>>>;
/// Collision (`false`) or avoidance (`true`) areas grown by a distance: keyed by those, the radius and the layer.
type GrownCache = Mutex<HashMap<(bool, u64, usize, u64), Arc<Shapes>>>;

pub struct Data {
    /// Each object layer's slices, simplified (`m_layer_outlines`), and those of it and every layer below
    /// (`m_layer_outlines_below`).
    pub outlines: Vec<Shapes>,
    pub outlines_below: Vec<Shapes>,
    /// mm: how far a branch may move sideways from each layer to the next (`m_max_move_distances`).
    pub max_move: Vec<f64>,
    /// mm: the gap kept beside the object.
    xy_distance: f64,
    collision: Cache,
    avoidance: Cache,
    grown: GrownCache,
}

impl Data {
    /// From the object's slices and its layers' heights (mm), with branches leaning at most `branch_angle` degrees.
    pub fn new(slices: &[Shapes], heights: &[f64], xy_distance: f64, branch_angle: f64) -> Data {
        let scale_factor = (branch_angle * std::f64::consts::PI / 180.0).tan();
        let outlines: Vec<Shapes> = crate::par::map_range(slices.len(), |l| simplify(&slices[l], scale(RESOLUTION)));
        let mut outlines_below: Vec<Shapes> = Vec::with_capacity(outlines.len());
        for (l, outline) in outlines.iter().enumerate() {
            let below = if l == 0 {
                outline.clone()
            } else {
                let mut all = outlines_below[l - 1].clone();
                all.extend(outline.iter().cloned());
                union(all)
            };
            outlines_below.push(below);
        }
        Data {
            outlines,
            outlines_below,
            max_move: heights.iter().map(|h| h * scale_factor).collect(),
            xy_distance,
            collision: Mutex::new(HashMap::new()),
            avoidance: Mutex::new(HashMap::new()),
            grown: Mutex::new(HashMap::new()),
        }
    }

    /// Orca's `ceil_radius`: a radius rounded up to the resolution's next step (nothing within 0.1 µm of one).
    pub fn ceil_radius(radius: f64) -> f64 {
        let factor = (radius / RESOLUTION) as usize;
        let remains = radius - RESOLUTION * factor as f64;
        if remains > super::EPSILON { radius + RESOLUTION - remains } else { radius }
    }

    /// The outlines on layer `l` grown by the radius (rounded up) and the XY gap, simplified: where a branch's middle
    /// mustn't be.
    pub fn collision(&self, radius: f64, l: usize) -> Arc<Shapes> {
        let r = Self::ceil_radius(radius);
        let key = (r.to_bits(), l);
        if let Some(c) = self.collision.lock().unwrap().get(&key) {
            return c.clone();
        }
        let grown = offset_ex(&self.outlines[l], scale(r + self.xy_distance));
        let c = Arc::new(simplify(&grown, scale(RESOLUTION)));
        self.collision.lock().unwrap().entry(key).or_insert(c).clone()
    }

    /// Where a branch of the radius on layer `l` couldn't get away from the object on its way down: the layer's
    /// collision, and the avoidance below less a layer's move.
    pub fn avoidance(&self, radius: f64, l: usize) -> Arc<Shapes> {
        let r = Self::ceil_radius(radius);
        let key = |l: usize| (r.to_bits(), l);
        // From the highest layer already known below, up.
        let (mut from, mut below) = {
            let cache = self.avoidance.lock().unwrap();
            if let Some(a) = cache.get(&key(l)) {
                return a.clone();
            }
            let mut k = l;
            loop {
                if k == 0 {
                    break (0, None);
                }
                k -= 1;
                if let Some(a) = cache.get(&key(k)) {
                    break (k + 1, Some(a.clone()));
                }
            }
        };
        let mut result = Arc::new(Vec::new());
        while from <= l {
            let mut areas = match &below {
                Some(b) if from > 0 => offset_ex(b, scale(-self.max_move[from - 1])),
                _ => Vec::new(),
            };
            areas.extend(self.collision(r, from).iter().cloned());
            result = Arc::new(union(areas));
            self.avoidance.lock().unwrap().entry(key(from)).or_insert_with(|| result.clone());
            below = Some(result.clone());
            from += 1;
        }
        result
    }
}

impl Data {
    /// A layer's collision (`avoidance` false) or avoidance areas for the radius, grown by `distance` mm as a branch
    /// moving out of them grows them (Orca's `move_out_expolys`, which grows them each time it is asked).
    pub fn grown(&self, avoidance: bool, radius: f64, l: usize, distance: f64) -> Arc<Shapes> {
        let r = Self::ceil_radius(radius);
        let key = (avoidance, r.to_bits(), l, distance.to_bits());
        if let Some(g) = self.grown.lock().unwrap().get(&key) {
            return g.clone();
        }
        let shapes = if avoidance { self.avoidance(r, l) } else { self.collision(r, l) };
        let g = Arc::new(union(offset_ex(&shapes, scale(distance))));
        self.grown.lock().unwrap().entry(key).or_insert(g).clone()
    }

    /// Works out ahead, on every core, the avoidance and collision areas the branches are likely to ask for (Orca's
    /// "precalculate avoidance of all possible radii"): for each radius in `wanted` (layer, radii), the collisions of
    /// every layer up to the highest it is wanted on, then its avoidances layer after layer, each radius at once;
    /// and each wanted layer's collision for a radius of nothing. They come out the same as worked out when asked.
    #[cfg(feature = "parallel")]
    pub fn precompute(&self, wanted: &[(usize, Vec<f64>)]) {
        let mut highest: HashMap<u64, usize> = HashMap::new();
        for (l, radii) in wanted {
            for &r in radii {
                let top = highest.entry(Self::ceil_radius(r).to_bits()).or_insert(*l);
                *top = (*top).max(*l);
            }
        }
        let mut chains: Vec<(f64, usize)> = highest.into_iter().map(|(r, l)| (f64::from_bits(r), l)).collect();
        chains.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut collisions: Vec<(f64, usize)> =
            chains.iter().flat_map(|&(r, top)| (0..=top).map(move |l| (r, l))).collect();
        collisions.extend(wanted.iter().map(|(l, _)| (0.0, *l)));
        crate::par::map_range(collisions.len(), |k| {
            self.collision(collisions[k].0, collisions[k].1);
        });
        crate::par::map_range(chains.len(), |k| {
            self.avoidance(chains[k].0, chains[k].1);
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn radii_round_up_to_the_resolution_as_orcas_do() {
        // Orca's resolution is the float 0.2, a little over 0.2: 1 mm is 4.99999… steps, so it rounds up to just
        // over 1 mm; 0 stays 0.
        assert_eq!(Data::ceil_radius(0.0), 0.0);
        assert!((Data::ceil_radius(1.0) - 1.0000000149).abs() < 1e-9);
        assert!((Data::ceil_radius(0.45) - 0.6000000089).abs() < 1e-9);
    }
}
