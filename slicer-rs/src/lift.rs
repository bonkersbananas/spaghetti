//! Orca's Auto Lift, the X2D's way of lifting the nozzle for its generic filaments (`z_hop_types` "Auto Lift"; Bambu
//! PLA lifts in spirals): a travel that retracts lifts along the travel slope as it sets off, or in a spiral where it
//! sets off over an overhang of the last 0.4 mm of layers, where a slope could catch an edge that curled up
//! (`GCode::needs_retraction`'s `is_through_overhang`). The overhangs are what `PrintObject::detect_overhangs_for_lift`
//! finds on each layer: what of an object's slice lies more than 0.3 line widths beyond its slice on the layer below,
//! less what is thinner than a fifth of a line.

use crate::geom::{self, Pt, Shape, Shapes};
use crate::par;

/// How far below the layer Orca looks for overhangs, mm.
const PROTECT_Z: f32 = 0.4;
/// Share of the line width a layer may reach beyond the one below before it overhangs.
const MIN_OVERHANG: f64 = 0.3;

/// Each object layer's overhangs for lifts, with each shape's bounding box, and the layers' tops.
#[derive(Default)]
pub struct Overhangs {
    tops: Vec<f64>,
    layers: Vec<Vec<(Shape, [i32; 4])>>,
}

impl Overhangs {
    /// Finds them on every layer from the second: `slices` are each layer's shapes, `owners` the object of each,
    /// `tops` each layer's top, mm.
    pub fn find(slices: &[Shapes], owners: &[Vec<u32>], tops: &[f64], line_width: f64) -> Overhangs {
        // Object `o`'s shapes on layer `l`.
        let of = |l: usize, o: u32| -> Shapes {
            slices[l].iter().zip(&owners[l]).filter(|&(_, &w)| w == o).map(|(s, _)| s.clone()).collect()
        };
        let layers = par::map_range(slices.len(), |l| {
            if l == 0 {
                return Vec::new();
            }
            let mut objects: Vec<u32> = Vec::new();
            for &o in &owners[l] {
                if !objects.contains(&o) {
                    objects.push(o);
                }
            }
            // Clipper's mitred offsets, as Orca's `offset_ex` and `offset2_ex` (and several times quicker here than
            // `geom::offset`'s).
            let join = geom::Join::Miter(3.0);
            let mut found = Vec::new();
            for o in objects {
                let under = geom::offset_c2(&of(l - 1, o), MIN_OVERHANG * line_width, join);
                let over = geom::difference(&of(l, o), &under);
                if over.is_empty() {
                    continue;
                }
                let opened = geom::offset_c2(&geom::offset_c2(&over, -0.1 * line_width, join), 0.1 * line_width, join);
                found.extend(opened.into_iter().map(|s| {
                    let bbox = geom::bbox_of(&s);
                    (s, bbox)
                }));
            }
            found
        });
        Overhangs { tops: tops.to_vec(), layers }
    }

    /// Whether a travel from `a` toward `b`, on the layer whose top is at `z`, sets off over an overhang: whether its
    /// first `reach` mm cross one on a layer whose top lies within 0.4 mm below `z` (`z` included), as Orca works
    /// the range out in single precision.
    pub fn sets_off_over(&self, z: f64, a: Pt, b: Pt, reach: f64) -> bool {
        let end = z as f32;
        let start = (end - PROTECT_Z).max(0.0);
        let d = geom::dist(a, b);
        if d <= 0.0 {
            return false;
        }
        let reach = geom::sc(reach) as f64;
        let b = if d > reach {
            let t = reach / d;
            geom::pt(a.x + ((b.x - a.x) as f64 * t) as i32, a.y + ((b.y - a.y) as f64 * t) as i32)
        } else {
            b
        };
        let (lo, hi) = ((a.x.min(b.x), a.y.min(b.y)), (a.x.max(b.x), a.y.max(b.y)));
        let first = self.tops.partition_point(|&t| t < start as f64);
        let last = self.tops.partition_point(|&t| t <= end as f64 + 1e-4);
        self.layers[first..last.max(first)].iter().flatten().any(|(shape, bb)| {
            bb[0] <= hi.0 && bb[2] >= lo.0 && bb[1] <= hi.1 && bb[3] >= lo.1 && {
                let one = std::slice::from_ref(shape);
                geom::contains(one, a) || geom::contains(one, b) || geom::segment_crosses(one, a, b)
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]]
    }

    /// A 10 mm block on layers 0–2 and, from layer 3, a slab that reaches 6 mm beyond it on the right.
    fn ledge() -> Overhangs {
        let block = square(0.0, 0.0, 10.0, 10.0);
        let slab = square(0.0, 0.0, 16.0, 10.0);
        let slices: Vec<Shapes> = (0..6).map(|l| vec![if l < 3 { block.clone() } else { slab.clone() }]).collect();
        let owners = vec![vec![0]; 6];
        let tops: Vec<f64> = (1..=6).map(|l| l as f64 * 0.2).collect();
        Overhangs::find(&slices, &owners, &tops, 0.42)
    }

    #[test]
    fn a_layer_reaching_beyond_the_one_below_overhangs_there() {
        let o = ledge();
        assert!(o.layers[..3].iter().all(Vec::is_empty) && o.layers[4..].iter().all(Vec::is_empty));
        // Layer 3: from 0.3 line widths beyond the block's edge to the slab's.
        let [x0, y0, x1, y1] = o.layers[3][0].1;
        assert!((geom::unsc(x0) - 10.126).abs() < 0.01 && (geom::unsc(x1) - 16.0).abs() < 0.01, "{x0} {x1}");
        assert!(geom::unsc(y0).abs() < 0.01 && (geom::unsc(y1) - 10.0).abs() < 0.01);
    }

    #[test]
    fn a_travel_setting_off_over_an_overhang_of_the_last_layers_is_caught() {
        let o = ledge();
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        let reach = 0.4 / 3f64.to_radians().tan();
        // From over the ledge, on its layer and the next, not once it lies more than 0.4 mm below.
        assert!(o.sets_off_over(0.8, p(14.0, 5.0), p(40.0, 5.0), reach));
        assert!(o.sets_off_over(1.0, p(14.0, 5.0), p(40.0, 5.0), reach));
        assert!(!o.sets_off_over(1.3, p(14.0, 5.0), p(40.0, 5.0), reach));
        // Toward it, when it lies within the reach of where the travel sets off, and not beyond it.
        assert!(o.sets_off_over(0.8, p(5.0, 5.0), p(40.0, 5.0), reach));
        assert!(o.sets_off_over(0.8, p(20.0, 5.0), p(0.0, 5.0), reach));
        assert!(!o.sets_off_over(0.8, p(25.0, 5.0), p(0.0, 5.0), reach));
        assert!(!o.sets_off_over(0.8, p(5.0, 5.0), p(5.0, 40.0), reach));
    }
}
