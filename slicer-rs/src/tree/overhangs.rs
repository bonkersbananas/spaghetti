//! Where the trees hold the model up: Orca's own overhang detection for its trees (`TreeSupport::detect_overhangs`,
//! TreeSupport.cpp), which differs from normal supports'. A layer's overhang is what reaches more than the support
//! angle beyond the layer below, square-offset, with nothing added back. Clusters of overhang that grow up over a few
//! layers are dropped while small (under 1.68 mm across), unless they start in the air ("sharp tails", any size
//! here) or reach far from what holds them ("cantilevers"). A sharp tail is held up on its first layer and every
//! half millimetre or so above, as far as it hangs out over the layer below. With supports only where needed
//! (`support_critical_regions_only`), only cantilevers and sharp tails are held up.

use super::{Config, mm};
use crate::geom::{self, Join, Shape, Shapes};
use crate::par;

/// What an overhang is to the trees.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Detected,
    SharpTail,
}

/// Each layer's overhangs, in Orca's order: the detected ones by the cluster they belong to, then the sharp tails.
pub type Overhangs = Vec<Vec<(Shape, Kind)>>;

/// nm: Orca's `scale_` of the process's line width, which detection measures in.
fn extrusion_width(s: &crate::config::Settings) -> f64 {
    s.line_width * 1e6
}

fn one(shape: &Shape) -> Shapes {
    vec![shape.clone()]
}

/// Orca's `overlaps`: whether two sets of areas share some area.
pub(crate) fn overlaps(a: &Shapes, b: &Shapes) -> bool {
    let (Some(ba), Some(bb)) = (geom::bbox(a), geom::bbox(b)) else { return false };
    if ba[0] > bb[2] || bb[0] > ba[2] || ba[1] > bb[3] || bb[1] > ba[3] {
        return false;
    }
    let near_b = geom::near(b, ba);
    !near_b.is_empty() && !geom::intersection(&geom::near(a, bb), &near_b).is_empty()
}

/// A bounding box's size in nm, (0, 0) for nothing (Orca's `get_extents` of an empty set).
fn size_nm(shapes: &Shapes) -> (f64, f64) {
    geom::bbox(shapes).map_or((0.0, 0.0), |b| ((b[2] - b[0]) as f64 * 100.0, (b[3] - b[1]) as f64 * 100.0))
}

/// Orca's default offset (`jtMiter` with a limit of 3), by nanometres.
fn grow(shapes: &Shapes, nm: f64) -> Shapes {
    if shapes.is_empty() { Vec::new() } else { geom::offset_c2(shapes, mm(nm), Join::Miter(3.0)) }
}

struct Cluster {
    /// The one overhang recorded for each layer (Orca's `std::map::emplace` keeps the first).
    layers: std::collections::BTreeMap<usize, usize>,
    merged: Shapes,
    bbox: [i32; 4],
    min_layer: usize,
    max_layer: usize,
    cantilever: bool,
}

/// Each layer's overhangs, from the object's slices (the first layer as sliced) and its layers' heights (mm).
pub fn detect(slices: &[Shapes], heights: &[f64], c: &Config, s: &crate::config::Settings) -> Overhangs {
    let n = slices.len();
    let ews = extrusion_width(s);
    // The slices with what is too thin to print taken out (`lslices_extrudable`).
    let extrudable: Vec<Shapes> = par::map_range(n, |l| {
        let opened = grow(&grow(&slices[l], (-ews / 2.0) as f32 as f64), ews as f32 as f64);
        geom::intersection(&slices[l], &opened)
    });
    let threshold = c.threshold_degrees.to_radians();
    struct Found {
        overhangs: Shapes,
        tails: Vec<(Shape, f32)>,
        cantilevers: Shapes,
        crowded: bool,
    }
    let found: Vec<Found> = par::map_range(n, |l| {
        let mut f = Found { overhangs: Vec::new(), tails: Vec::new(), cantilevers: Vec::new(), crowded: false };
        if l == 0 {
            // Small islands of the first layer are sharp tails.
            for island in &extrudable[0] {
                let (w, h) = size_nm(&one(island));
                if !(w > 6e6 && h > 6e6) {
                    f.tails.push((island.clone(), heights[0] as f32));
                }
            }
            return f;
        }
        let llo = heights[l - 1] as f32 as f64 / threshold.tan();
        let lower_offset = geom::offset_c2(&extrudable[l - 1], mm((llo * 1e6) as f32 as f64), Join::Square);
        f.overhangs = geom::difference(&extrudable[l], &lower_offset);
        if f.overhangs.len() > 100 {
            f.crowded = true;
            return f;
        }
        // Islands with nothing under them.
        for island in &extrudable[l] {
            let expanded = grow(&one(island), 0.1 * ews);
            if !overlaps(&expanded, &extrudable[l - 1]) && !grow(&one(island), -0.1 * ews).is_empty() {
                f.tails.push((island.clone(), 0.0));
            }
        }
        // Overhangs that reach more than 3 mm from what holds them.
        let reach = ((((s.line_width - llo).max(0.0) + 0.1) * 1e6) as f32) as f64;
        let held = grow(&lower_offset, reach);
        for poly in &f.overhangs {
            let boundary = geom::intersection(&one(poly), &held);
            if boundary.is_empty() {
                continue;
            }
            let vertices: Vec<geom::Pt> = boundary.iter().flatten().flatten().copied().collect();
            let far = poly[0]
                .iter()
                .map(|p| vertices.iter().map(|q| geom::dist(*p, *q)).fold(f64::MAX, f64::min))
                .fold(0.0, f64::max);
            if far * 100.0 > 3e6 {
                f.cantilevers.push(poly.clone());
            }
        }
        f
    });
    // A layer with over a hundred overhangs turns off sharp tails and the small overhangs' removal (Orca's guard,
    // which also stops at 30 s: there it depends on which layers were done first; here it holds for all).
    let crowded = found.iter().any(|f| f.crowded);
    let mut tails: Vec<Vec<(Shape, f32)>> =
        found.iter().map(|f| if crowded { Vec::new() } else { f.tails.clone() }).collect();
    if crowded {
        tails[0] = found[0].tails.clone();
    }
    // Sharp tails grown upwards: an island resting on one below, as long as it stays small and under 16 mm.
    if !crowded {
        for l in 1..n {
            let (below, above) = tails.split_at_mut(l);
            let lower = &below[l - 1];
            if lower.is_empty() {
                continue;
            }
            let lower_shapes: Shapes = lower.iter().map(|(t, _)| t.clone()).collect();
            let lower_size = size_nm(&lower_shapes);
            for island in &extrudable[l] {
                let supported = geom::intersection(&one(island), &lower_shapes);
                if supported.is_empty() {
                    continue;
                }
                let (w, h) = size_nm(&supported);
                if w > 6e6 && h > 6e6 {
                    continue;
                }
                let mut acc = heights[l] as f32;
                if let Some((_, h)) = lower.iter().find(|(t, _)| overlaps(&one(t), &one(island))) {
                    acc += *h;
                }
                if acc > 16.0 {
                    continue;
                }
                let new = geom::difference(&one(island), &lower_shapes);
                let (nw, nh) = size_nm(&new);
                if (nw - lower_size.0 > 5e6 && nh - lower_size.1 > 5e6) || !grow(&new, -5.0 * ews).is_empty() {
                    continue;
                }
                above[0].push((island.clone(), acc));
            }
        }
    }
    // Clusters of overhang that grow up together, layer by layer.
    let mut clusters: Vec<Cluster> = Vec::new();
    for l in 0..n {
        for (i, o) in found[l].overhangs.iter().enumerate() {
            let mut joined = None;
            for (k, cluster) in clusters.iter_mut().enumerate() {
                let Some(&below) = l.checked_sub(1).and_then(|b| cluster.layers.get(&b)) else { continue };
                let dilated = grow(&one(o), ews);
                let Some(b) = geom::bbox(&dilated) else { continue };
                let m = cluster.bbox;
                if b[2] < m[0] || b[0] > m[2] || b[3] < m[1] || b[1] > m[3] {
                    continue;
                }
                if !overlaps(&one(&found[l - 1].overhangs[below]), &dilated) {
                    continue;
                }
                cluster.layers.entry(l).or_insert(i);
                cluster.merged = geom::union(&cluster.merged, &dilated);
                cluster.min_layer = cluster.min_layer.min(l);
                cluster.max_layer = cluster.max_layer.max(l);
                cluster.bbox = [m[0].min(b[0]), m[1].min(b[1]), m[2].max(b[2]), m[3].max(b[3])];
                joined = Some(k);
                break;
            }
            let k = joined.unwrap_or_else(|| {
                let merged = one(o);
                let bbox = geom::bbox(&merged).unwrap_or([0; 4]);
                clusters.push(Cluster {
                    layers: [(l, i)].into_iter().collect(),
                    merged,
                    bbox,
                    min_layer: l,
                    max_layer: l,
                    cantilever: false,
                });
                clusters.len() - 1
            });
            if overlaps(&one(o), &found[l].cantilevers) {
                clusters[k].cantilever = true;
            }
        }
    }
    // Small clusters go, unless they hold up a sharp tail or a cantilever.
    let remove_small = c.remove_small_overhangs && !crowded;
    let mut out: Overhangs = vec![Vec::new(); n];
    for cluster in &clusters {
        if remove_small {
            let tail = (cluster.min_layer..=cluster.max_layer).any(|l| {
                let shapes: Shapes = tails[l].iter().map(|(t, _)| t.clone()).collect();
                overlaps(&shapes, &cluster.merged)
            });
            if !tail && !cluster.cantilever {
                let eroded = grow(&cluster.merged, -ews);
                let (w, h) = size_nm(&eroded);
                if w < 2.0 * ews || h < 2.0 * ews {
                    continue;
                }
            }
        }
        for (&l, &i) in &cluster.layers {
            out[l].push((found[l].overhangs[i].clone(), Kind::Detected));
        }
    }
    // Supports only where needed: of the overhangs, only those that reach far from what holds them.
    if c.critical_regions_only {
        for (layer, f) in out.iter_mut().zip(&found) {
            *layer = f.cantilevers.iter().map(|o| (o.clone(), Kind::Detected)).collect();
        }
    }
    // Sharp tails: on their first layer whole, then where they hang out over the layer below, every so often.
    for l in 0..n {
        if l == 0 {
            for (t, _) in &tails[0] {
                out[0].push((t.clone(), Kind::SharpTail));
            }
            continue;
        }
        if tails[l].is_empty() {
            continue;
        }
        let lower = grow(&extrudable[l - 1], 12_500.0);
        for (t, h) in &tails[l] {
            let areas = geom::difference(&one(t), &lower);
            if !areas.is_empty() && ((h * 10.0) as i32) % 5 == 0 {
                out[l].extend(areas.into_iter().map(|a| (a, Kind::SharpTail)));
            }
        }
    }
    out
}

/// The areas the trees grow from on each layer: each overhang's outline, a sharp tail's grown by 0.2 mm, not
/// combined (`generate_support_areas`).
pub fn areas(overhangs: &Overhangs) -> Vec<Shapes> {
    overhangs
        .iter()
        .map(|layer| {
            layer
                .iter()
                .flat_map(|(shape, kind)| match kind {
                    Kind::Detected => vec![shape.clone()],
                    Kind::SharpTail => grow(&one(shape), 200_000.0),
                })
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::pt;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        let p = |x: f64, y: f64| pt(geom::sc(x), geom::sc(y));
        vec![vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]]
    }

    #[test]
    fn a_ts_arms_are_its_overhangs_and_nothing_else() {
        // The T of the normal supports' test: a 10 mm pillar 20 mm tall under a slab 40 mm wide.
        let s = super::super::tests::tree_settings();
        let c = Config::new(&s);
        let n = 125;
        let slices: Vec<Shapes> =
            (0..n)
                .map(|l| {
                    if l < 100 {
                        vec![rect(115.0, 123.0, 125.0, 133.0)]
                    } else {
                        vec![rect(100.0, 123.0, 140.0, 133.0)]
                    }
                })
                .collect();
        let heights = vec![0.2; n];
        let found = detect(&slices, &heights, &c, &s);
        for (l, layer) in found.iter().enumerate() {
            if l == 100 {
                // The two arms beyond the pillar grown square by 0.333 mm (spec A §2.11).
                assert_eq!(layer.len(), 2);
                let mut xs: Vec<(i32, i32)> = layer
                    .iter()
                    .map(|(shape, kind)| {
                        assert_eq!(*kind, Kind::Detected);
                        let b = geom::bbox_of(shape);
                        (b[0], b[2])
                    })
                    .collect();
                xs.sort();
                assert_eq!(xs, [(geom::sc(100.0), 1_146_671), (1_253_329, geom::sc(140.0))]);
            } else {
                assert!(layer.is_empty(), "layer {l}: {layer:?}");
            }
        }
    }

    #[test]
    fn where_needed_holds_up_only_what_reaches_far() {
        // A slab over a pillar, reaching 15 mm beyond it on one side and 2.5 mm on the other. Both arms are
        // overhangs; only the long one reaches more than 3 mm from what holds it, the one overhang the trees hold up
        // with supports only where needed (`support_critical_regions_only`).
        let mut s = super::super::tests::tree_settings();
        let n = 125;
        let slices: Vec<Shapes> =
            (0..n)
                .map(|l| {
                    if l < 100 {
                        vec![rect(115.0, 123.0, 125.0, 133.0)]
                    } else {
                        vec![rect(100.0, 123.0, 127.5, 133.0)]
                    }
                })
                .collect();
        let heights = vec![0.2; n];
        let arms = |s: &crate::config::Settings| -> Vec<(i32, i32)> {
            let found = detect(&slices, &heights, &Config::new(s), s);
            assert!(found.iter().enumerate().all(|(l, layer)| l == 100 || layer.is_empty()));
            let mut xs: Vec<(i32, i32)> = found[100]
                .iter()
                .map(|(shape, _)| {
                    let b = geom::bbox_of(shape);
                    (b[0], b[2])
                })
                .collect();
            xs.sort();
            xs
        };
        assert_eq!(arms(&s), [(geom::sc(100.0), 1_146_671), (1_253_329, geom::sc(127.5))]);
        s.support.critical_regions_only = true;
        assert_eq!(arms(&s), [(geom::sc(100.0), 1_146_671)]);
    }
}
