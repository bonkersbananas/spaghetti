//! Brims as OrcaSlicer 2.5 makes them (`Brim.cpp`): loops round each object's first layer that hold it to the
//! plate.
//!
//! Orca's auto brim, the X2D's default, gives an object one only where it may come loose: its width grows with the
//! object's height over how stiff its footprint is (the footprint's second moment of area), with how fast the
//! printer moves and with how far the material curls, up to 18 mm, and anything under 5 mm is dropped. A tall
//! object's island too thin to hold on its own (less area than 1.1 mm times its outline) gets a 5 mm brim anyway, as
//! wide at most as the island. A brim people turn on is the process's width round every island. Either is a band
//! from `brim_object_gap` off the island's outline, cut where another object (or the edge of a hole in one) is, where
//! an earlier object's brim already lies and where the supports' lowest layers print, and dropped where it would not
//! touch its object. Loops fill it a line apart from the outside in, an even number of them.

use crate::config::Settings;
use crate::geom::{self, Contour, Pt, Shape, Shapes};

/// mm: Orca's `RESOLUTION`, to which the brim's band is simplified and its corners rounded.
const RESOLUTION: f64 = 0.0125;

/// Orca's materials (`MaterialType.cpp`): how well each holds to the plate and its thermal length (mm), the
/// footprint over which it starts to curl.
const MATERIALS: [(&str, f64, f64); 75] = [
    ("ABS", 1.0, 100.0),
    ("ABS-CF", 1.0, 100.0),
    ("ABS-GF", 1.0, 100.0),
    ("ASA", 1.0, 100.0),
    ("ASA-CF", 1.0, 100.0),
    ("ASA-GF", 1.0, 100.0),
    ("ASA-AERO", 1.0, 100.0),
    ("BVOH", 1.0, 200.0),
    ("CoPE", 1.0, 200.0),
    ("EVA", 1.0, 200.0),
    ("FLEX", 0.5, 1000.0),
    ("HIPS", 1.0, 200.0),
    ("PA", 1.0, 100.0),
    ("PA-CF", 1.0, 100.0),
    ("PA-GF", 1.0, 100.0),
    ("PA6", 1.0, 100.0),
    ("PA6-CF", 1.0, 100.0),
    ("PA6-GF", 1.0, 100.0),
    ("PA11", 1.0, 100.0),
    ("PA11-CF", 1.0, 100.0),
    ("PA11-GF", 1.0, 100.0),
    ("PA12", 1.0, 100.0),
    ("PA12-CF", 1.0, 100.0),
    ("PA12-GF", 1.0, 100.0),
    ("PAHT", 1.0, 200.0),
    ("PAHT-CF", 1.0, 200.0),
    ("PAHT-GF", 1.0, 200.0),
    ("PC", 1.0, 40.0),
    ("PC-ABS", 1.0, 80.0),
    ("PC-CF", 1.0, 80.0),
    ("PC-PBT", 1.0, 40.0),
    ("PCL", 1.0, 200.0),
    ("PCTG", 2.0, 200.0),
    ("PE", 1.0, 200.0),
    ("PE-CF", 1.0, 200.0),
    ("PE-GF", 1.0, 200.0),
    ("PEI-1010", 1.0, 200.0),
    ("PEI-1010-CF", 1.0, 200.0),
    ("PEI-1010-GF", 1.0, 200.0),
    ("PEI-9085", 1.0, 200.0),
    ("PEI-9085-CF", 1.0, 200.0),
    ("PEI-9085-GF", 1.0, 200.0),
    ("PEEK", 1.0, 200.0),
    ("PEEK-CF", 1.0, 200.0),
    ("PEEK-GF", 1.0, 200.0),
    ("PEKK", 1.0, 200.0),
    ("PEKK-CF", 1.0, 200.0),
    ("PES", 1.0, 200.0),
    ("PET", 2.0, 100.0),
    ("PET-CF", 2.0, 100.0),
    ("PET-GF", 2.0, 100.0),
    ("PETG", 2.0, 100.0),
    ("PETG-CF", 1.0, 100.0),
    ("PETG-GF", 1.0, 100.0),
    ("PHA", 1.0, 200.0),
    ("PI", 1.0, 200.0),
    ("PLA", 1.0, 200.0),
    ("PLA-AERO", 1.0, 200.0),
    ("PLA-CF", 1.0, 200.0),
    ("POM", 1.0, 200.0),
    ("PP", 1.0, 200.0),
    ("PP-CF", 1.0, 200.0),
    ("PP-GF", 1.0, 200.0),
    ("PPA-CF", 1.0, 200.0),
    ("PPA-GF", 1.0, 200.0),
    ("PPS", 1.0, 200.0),
    ("PPS-CF", 1.0, 200.0),
    ("PPSU", 1.0, 200.0),
    ("PSU", 1.0, 200.0),
    ("PVA", 1.0, 200.0),
    ("PVB", 1.0, 200.0),
    ("PVDF", 1.0, 200.0),
    ("SBS", 1.0, 200.0),
    ("TPI", 1.0, 200.0),
    ("TPU", 0.5, 1000.0),
];

/// A material's adhesion coefficient and thermal length (Orca's defaults, 1 and 200 mm, for one it doesn't know).
fn material(name: &str) -> (f64, f64) {
    MATERIALS.iter().find(|(n, _, _)| *n == name).map_or((1.0, 200.0), |&(_, adhesion, thermal)| (adhesion, thermal))
}

/// The plate's brims.
#[derive(Clone, Debug, Default)]
pub struct Brims {
    /// Each object's loops (plate units), outermost first, counter-clockwise: none for an object without a brim.
    pub loops: Vec<Vec<Contour>>,
    /// Where they lie, all of them.
    pub area: Shapes,
}

impl Brims {
    /// mm² their lines cover (their length times their spacing), which Orca counts in the first layer's area.
    pub fn covered_mm2(&self, s: &Settings) -> f64 {
        let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
        self.loops.iter().flatten().map(|c| geom::length_mm(c, true)).sum::<f64>() * spacing
    }
}

/// Each object's brim. `first` is the first layer's islands as sliced (before elephant's foot pulls them in, as Orca
/// keeps them), `owners` the object each belongs to, `heights` each object's height (mm), `support` what the
/// supports' lowest layers print (`support::cover`), where no brim goes.
pub fn brims(first: &Shapes, owners: &[u32], heights: &[f64], support: &Shapes, s: &Settings) -> Brims {
    let objects = heights.len();
    let mut out = Brims { loops: vec![Vec::new(); objects], area: Vec::new() };
    let auto = s.brim_type == "auto_brim";
    if !auto && s.brim_type != "outer_only" {
        return out;
    }
    let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
    if spacing <= 0.0 {
        return out;
    }
    // Brims come an even number of lines wide.
    let even = |w: f64| (w / spacing / 2.0).floor() * spacing * 2.0;
    let gap = s.brim_object_gap;
    let (adhesion, thermal) = material(&s.filament_type);
    // Orca weighs the fastest of the speeds it reads from the process for this.
    let fastest = [
        s.inner_wall_speed,
        s.outer_wall_speed,
        s.sparse_infill_speed,
        s.solid_infill_speed,
        s.top_surface_speed,
        s.support_speed,
    ]
    .into_iter()
    .fold(0.0, f64::max);
    let fastest = if fastest > 0.0 { fastest } else { 250.0 };

    // Each object's band: from the gap off each island's outline to the brim's width beyond.
    let islands_of = |o: usize| -> Shapes {
        first.iter().zip(owners).filter(|&(_, &k)| k as usize == o).map(|(shape, _)| shape.clone()).collect()
    };
    let mut bands: Vec<Shapes> = vec![Vec::new(); objects];
    for (o, band) in bands.iter_mut().enumerate() {
        let islands = islands_of(o);
        if islands.is_empty() {
            continue;
        }
        let height = heights[o];
        let width =
            if auto { even(auto_width(&islands, height, adhesion, fastest, thermal)) } else { even(s.brim_width) };
        for island in &islands {
            let mut w = width;
            if auto {
                // A tall object's island too thin to hold on its own.
                if width < 5.0 && height > 10.0 && width < spacing && thin(island) {
                    w = width + even(5.0);
                }
                let b = geom::bbox_of(island);
                w = w.min(geom::unsc(b[2] - b[0]).max(geom::unsc(b[3] - b[1])));
            }
            let w = even(w);
            if w > 0.0 {
                let inner = geom::offset_round(&vec![vec![island[0].clone()]], gap, RESOLUTION);
                let outer = geom::offset_round(&inner, w, RESOLUTION);
                band.extend(geom::difference(&outer, &inner));
            }
        }
    }
    if bands.iter().all(Vec::is_empty) {
        return out;
    }
    // Near each band: every object's islands grown by the gap, where no brim may go nor one need reach to stay, a
    // line's width in from the edge of each of their holes, and what the supports' lowest layers print, where no brim
    // may go either. What lies further off can't change a boolean with the band (`geom::local`), so only the islands
    // near it are grown.
    let reach = 2.0 * spacing;
    let (bx, by) = (geom::sc(s.bed[0]), geom::sc(s.bed[1]));
    let bed: Shapes = vec![vec![vec![geom::pt(0, 0), geom::pt(bx, 0), geom::pt(bx, by), geom::pt(0, by)]]];
    let mut grown: Vec<Shapes> = vec![Vec::new(); objects];
    for (band, grown) in bands.iter_mut().zip(&mut grown) {
        let Some(b) = geom::bbox(band) else { continue };
        let near = geom::local(first, geom::inflate(b, reach + gap + spacing));
        *grown = geom::union_all(&[&geom::offset_round(&near, gap, RESOLUTION)]);
        let mut keep_out = grown.clone();
        for hole in near.iter().flat_map(|island| &island[1..]) {
            let mut ring = hole.clone();
            if geom::area2(&ring) < 0 {
                ring.reverse();
            }
            let area: Shapes = vec![vec![ring]];
            keep_out.extend(geom::difference(&area, &geom::offset(&area, -spacing)));
        }
        keep_out.extend(geom::local(support, b));
        // Nothing where another island or a hole's edge is, nor off the plate.
        *band = geom::intersection(&geom::difference(&geom::union_all(&[&*band]), &keep_out), &bed);
    }
    // A piece of brim stays where it touches an object, more of its brim or another's.
    let kept: Vec<Shapes> = (0..objects)
        .map(|o| {
            bands[o]
                .iter()
                .enumerate()
                .filter(|&(i, piece)| {
                    let near = geom::offset_round(&vec![piece.clone()], reach, RESOLUTION);
                    let Some(b) = geom::bbox(&near) else { return false };
                    let rest: Shapes =
                        bands[o].iter().enumerate().filter(|&(j, _)| j != i).map(|(_, p)| p.clone()).collect();
                    let others: Shapes =
                        (0..objects).filter(|&k| k != o).flat_map(|k| geom::near(&bands[k], b)).collect();
                    [geom::local(&grown[o], b), geom::near(&rest, b), others]
                        .iter()
                        .any(|set| !set.is_empty() && !geom::intersection(&near, set).is_empty())
                })
                .map(|(_, piece)| piece.clone())
                .collect()
        })
        .collect();
    // Each object keeps what an earlier one hasn't taken (Orca's brims aren't combined).
    let mut taken: Shapes = Vec::new();
    for (o, band) in kept.into_iter().enumerate() {
        if band.is_empty() {
            continue;
        }
        let band = if taken.is_empty() { band } else { geom::difference(&band, &taken) };
        taken.extend(band.iter().cloned());
        out.loops[o] = loops(&band, spacing);
    }
    out.area = taken;
    out
}

/// Orca's auto brim width (mm) for an object `height` mm tall on these islands (`configBrimWidthByVolumeGroups`).
fn auto_width(islands: &Shapes, height: f64, adhesion: f64, fastest: f64, thermal: f64) -> f64 {
    let (ixx, iyy) = second_moments(islands).unwrap_or((-1e30, -1e30));
    let Some(b) = geom::bbox(islands) else { return 0.0 };
    let (bx, by) = (geom::unsc(b[2] - b[0]), geom::unsc(b[3] - b[1]));
    let footprint = (bx * bx + by * by).sqrt();
    let thermal = thermal.min(1250.0);
    let height_to_area = (height / ixx * by).max(height / iyy * bx) * height / 1920.0;
    let width = adhesion
        * (height_to_area * fastest)
            .max(footprint * 8.0 / thermal * height.min(30.0) / 30.0)
            .min(18.0)
            .min(1.5 * footprint);
    if width < 5.0 && width < 1.5 * footprint {
        return 0.0;
    }
    width.min(18.0)
}

/// Whether an island has less area than 1.1 mm times its outline: too thin to hold on its own.
fn thin(island: &Shape) -> bool {
    let area = geom::shape_area_mm2(island);
    let outline = geom::length_mm(&island[0], true);
    outline > 0.0 && area / outline < 1.1
}

/// A ring's or an island's area (mm²), centroid and second moments of area about the axes through it, x then y
/// (mm⁴): Orca's `ExPolyProp`.
struct Props {
    area: f64,
    centroid: (f64, f64),
    moments: (f64, f64),
}

/// A ring's area (signed: positive counter-clockwise), centroid and second moments about the plate's axes, as if it
/// ran counter-clockwise (Orca's `compSecondMoment` of a polygon).
fn ring(c: &Contour) -> Props {
    let pts: Vec<(f64, f64)> = c.iter().map(|q| (geom::unsc(q.x), geom::unsc(q.y))).collect();
    let n = pts.len();
    let (mut a2, mut cx, mut cy, mut sx, mut sy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for i in 0..n {
        let (p1, p2) = (pts[(i + n - 1) % n], pts[i]);
        let cr = p1.0 * p2.1 - p2.0 * p1.1;
        a2 += cr;
        cx += (p1.0 + p2.0) * cr;
        cy += (p1.1 + p2.1) * cr;
        sx += (p1.1 * p1.1 + p1.1 * p2.1 + p2.1 * p2.1) * cr;
        sy += (p1.0 * p1.0 + p1.0 * p2.0 + p2.0 * p2.0) * cr;
    }
    let centroid = if a2 != 0.0 { (cx / (3.0 * a2), cy / (3.0 * a2)) } else { (0.0, 0.0) };
    let sign = if a2 < 0.0 { -1.0 } else { 1.0 };
    Props { area: a2 / 2.0, centroid, moments: (sign * sx / 12.0, sign * sy / 12.0) }
}

/// The islands' second moments of area about their common centroid's axes, mm⁴: `(Ixx, Iyy)` (Orca's
/// `compSecondMoment` of expolygons).
fn second_moments(islands: &Shapes) -> Option<(f64, f64)> {
    let mut props: Vec<Props> = Vec::new();
    for island in islands {
        if island[0].len() < 3 {
            continue;
        }
        let outer = ring(&island[0]);
        let mut area = outer.area.abs();
        let mut sum = (outer.centroid.0 * area, outer.centroid.1 * area);
        let mut moments = outer.moments;
        for hole in island[1..].iter().filter(|h| h.len() >= 3) {
            let h = ring(hole);
            let a = -h.area.abs();
            area += a;
            sum = (sum.0 + h.centroid.0 * a, sum.1 + h.centroid.1 * a);
            moments = (moments.0 - h.moments.0, moments.1 - h.moments.1);
        }
        if area <= 0.0 {
            continue;
        }
        let c = (sum.0 / area, sum.1 / area);
        props.push(Props { area, centroid: c, moments: (moments.0 - c.1 * c.1 * area, moments.1 - c.0 * c.0 * area) });
    }
    if props.is_empty() {
        return None;
    }
    let total: f64 = props.iter().map(|p| p.area).sum();
    let cx = props.iter().map(|p| p.centroid.0 * p.area).sum::<f64>() / total;
    let cy = props.iter().map(|p| p.centroid.1 * p.area).sum::<f64>() / total;
    let ixx = props.iter().map(|p| p.moments.0 + p.area * (p.centroid.1 - cy) * (p.centroid.1 - cy)).sum();
    let iyy = props.iter().map(|p| p.moments.1 + p.area * (p.centroid.0 - cx) * (p.centroid.0 - cx)).sum();
    Some((ixx, iyy))
}

/// The loops that fill a brim's band, a line apart, outermost first and counter-clockwise (Orca's
/// `tryExPolygonOffset` and `union_pt_chained_outside_in`).
fn loops(band: &Shapes, spacing: f64) -> Vec<Contour> {
    let mut found: Vec<Contour> = Vec::new();
    let mut level = geom::offset_round(&simplified(band), -0.5 * spacing, RESOLUTION);
    while !level.is_empty() {
        level = simplified(&level);
        found.extend(level.iter().flatten().cloned());
        level = geom::offset_round(&level, -1.3 * spacing, RESOLUTION);
        level = geom::offset_round(&simplified(&level), 0.3 * spacing, RESOLUTION);
    }
    outside_in(found)
}

/// Each ring simplified to Orca's resolution, as its `douglas_peucker` does a polygon (from its first point round).
fn simplified(shapes: &Shapes) -> Shapes {
    shapes
        .iter()
        .filter_map(|shape| {
            let rings: Shape = shape
                .iter()
                .filter_map(|c| {
                    let mut closed = c.clone();
                    closed.push(c[0]);
                    let mut kept = geom::simplify_line(&closed, RESOLUTION);
                    kept.pop();
                    (kept.len() >= 3).then_some(kept)
                })
                .collect();
            (!rings.is_empty() && geom::area2(&rings[0]) != 0).then_some(rings)
        })
        .collect()
}

/// Loops ordered as Orca walks the tree they nest in (`union_pt_chained_outside_in`): each level's loops chained,
/// each followed by the loops inside it, all turned counter-clockwise.
fn outside_in(found: Vec<Contour>) -> Vec<Contour> {
    let n = found.len();
    let areas: Vec<i128> = found.iter().map(|c| geom::area2(c).abs()).collect();
    // Each loop's parent: the smallest loop holding it.
    let parent: Vec<Option<usize>> = (0..n)
        .map(|i| {
            (0..n)
                .filter(|&j| j != i && areas[j] > areas[i] && geom::contour_contains(&found[j], found[i][0]))
                .min_by_key(|&j| areas[j])
        })
        .collect();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut roots = Vec::new();
    for (i, p) in parent.iter().enumerate() {
        match p {
            Some(p) => children[*p].push(i),
            None => roots.push(i),
        }
    }
    let mut order = Vec::with_capacity(n);
    walk(&roots, &found, &children, &mut order);
    order
        .into_iter()
        .map(|i| {
            let mut c = found[i].clone();
            if geom::area2(&c) < 0 {
                c.reverse();
            }
            c
        })
        .collect()
}

/// One level's loops in the order Clipper2 lists them (as its sweep meets them, from the largest y down), chained by
/// their first points (Orca's `chain_points`), each followed by the loops inside it.
fn walk(siblings: &[usize], found: &[Contour], children: &[Vec<usize>], order: &mut Vec<usize>) {
    let mut level = siblings.to_vec();
    let lowest = |i: usize| found[i].iter().map(|p| (std::cmp::Reverse(p.y), p.x)).min();
    level.sort_by_key(|&i| lowest(i));
    let points: Vec<Pt> = level.iter().map(|&i| found[i][0]).collect();
    for k in chain(&points) {
        let i = level[k];
        order.push(i);
        walk(&children[i], found, children, order);
    }
}

/// An order to visit points in: for up to four, the shortest path through them, as Orca chains so few exactly
/// (`chain_segments_exact`, ties going as its search finds them); for more, each next the nearest.
fn chain(points: &[Pt]) -> Vec<usize> {
    let n = points.len();
    if n <= 1 {
        return (0..n).collect();
    }
    let d = |a: usize, b: usize| geom::dist(points[a], points[b]);
    if n > 4 {
        let mut left: Vec<usize> = (1..n).collect();
        let mut out = vec![0];
        while !left.is_empty() {
            let at = out[out.len() - 1];
            let k = (0..left.len()).min_by(|&x, &y| d(at, left[x]).total_cmp(&d(at, left[y]))).unwrap_or(0);
            out.push(left.remove(k));
        }
        return out;
    }
    // States (visited, last, flipped), as Orca's search keeps them: a point flipped is the same point.
    let states = (1usize << n) * n * 2;
    let mut cost = vec![f64::MAX; states];
    let mut from = vec![usize::MAX; states];
    for j in 0..n {
        for o in 0..2 {
            cost[(((1 << j) * n) + j) * 2 + o] = 0.0;
        }
    }
    for mask in 1..(1usize << n) {
        for st in mask * n * 2..(mask + 1) * n * 2 {
            if cost[st] == f64::MAX {
                continue;
            }
            for k in (0..n).filter(|&k| mask >> k & 1 == 0) {
                for o in 0..2 {
                    let next = (((mask | 1 << k) * n) + k) * 2 + o;
                    let c = cost[st] + d(k, st / 2 % n);
                    if c < cost[next] {
                        cost[next] = c;
                        from[next] = st;
                    }
                }
            }
        }
    }
    let full = (1usize << n) - 1;
    let ends = full * n * 2;
    let mut best = ends;
    for st in ends..states {
        if cost[st] < cost[best] {
            best = st;
        }
    }
    let mut out = vec![0; n];
    let mut st = best;
    for k in (0..n).rev() {
        out[k] = st / 2 % n;
        st = from[st];
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, w: f64, h: f64) -> Shape {
        let s = geom::sc;
        vec![vec![
            geom::pt(s(x0), s(y0)),
            geom::pt(s(x0 + w), s(y0)),
            geom::pt(s(x0 + w), s(y0 + h)),
            geom::pt(s(x0), s(y0 + h)),
        ]]
    }

    fn settings(brim: &str) -> Settings {
        Settings { brim_type: brim.into(), ..Settings::default() }
    }

    #[test]
    fn a_squat_object_gets_no_auto_brim_and_a_tall_thin_one_does() {
        let s = settings("auto_brim");
        // A 40 mm square 20 mm tall stands on its own.
        let squat = brims(&vec![rect(100.0, 100.0, 40.0, 40.0)], &[0], &[20.0], &Vec::new(), &s);
        assert!(squat.loops[0].is_empty() && squat.area.is_empty());
        // A 5 × 20 mm footprint 60 mm tall bends easily across its short side: Orca's formula gives it 13.5 mm of
        // brim at the X2D's fastest speed (300 mm/s), which comes to 28 lines.
        let tall = brims(&vec![rect(100.0, 100.0, 5.0, 20.0)], &[0], &[60.0], &Vec::new(), &s).loops;
        let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
        assert_eq!(tall[0].len(), 28);
        let widest = tall[0]
            .iter()
            .map(|c| geom::bbox_of(&vec![c.clone()]))
            .map(|b| geom::unsc(b[2] - b[0]))
            .fold(0.0, f64::max);
        let outermost = s.brim_object_gap + 28.0 * spacing - spacing / 2.0;
        assert!((widest - (5.0 + 2.0 * outermost)).abs() < 0.01, "{widest} mm across");
        // Twice as tall, it gets the most there is, 18 mm, no wider than the island is long.
        let taller = brims(&vec![rect(100.0, 100.0, 5.0, 20.0)], &[0], &[120.0], &Vec::new(), &s).loops;
        assert_eq!(taller[0].len(), 2 * (18.0 / spacing / 2.0).floor() as usize);
    }

    #[test]
    fn a_brim_people_turn_on_rings_every_island_from_the_outside_in() {
        let s = settings("outer_only");
        let out = brims(&vec![rect(100.0, 100.0, 30.0, 30.0)], &[0], &[10.0], &Vec::new(), &s).loops;
        let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
        let lines = (s.brim_width / spacing / 2.0).floor() as usize * 2;
        assert_eq!(out[0].len(), lines);
        // Outermost first, each counter-clockwise, a line apart, the last one the gap and half a line off the island.
        let left: Vec<f64> = out[0].iter().map(|c| geom::unsc(c.iter().map(|q| q.x).min().unwrap())).collect();
        assert!(left.windows(2).all(|w| (w[1] - w[0] - spacing).abs() < 0.01), "{left:?}");
        assert!((100.0 - left[lines - 1] - (s.brim_object_gap + spacing / 2.0)).abs() < 0.01, "{left:?}");
        assert!(out[0].iter().all(|c| geom::area2(c) > 0));
    }

    #[test]
    fn a_brim_in_another_objects_opening_keeps_a_line_off_its_edge() {
        let s = settings("outer_only");
        let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
        // A 40 mm frame round a 14 mm opening, and a 4 mm pillar in the middle of it: the pillar's 5 mm brim would
        // reach to 1.3 mm of the opening's edge, so it stops a line short of it; the frame's brim goes round its
        // outside only.
        let mut frame = rect(100.0, 100.0, 40.0, 40.0);
        let mut hole = rect(113.0, 113.0, 14.0, 14.0).remove(0);
        hole.reverse();
        frame.push(hole);
        let out = brims(&vec![frame, rect(118.0, 118.0, 4.0, 4.0)], &[0, 1], &[10.0, 10.0], &Vec::new(), &s).loops;
        assert!(!out[0].is_empty() && !out[1].is_empty());
        let (lo, hi) = (113.0 + spacing + spacing / 2.0 - 0.01, 127.0 - spacing - spacing / 2.0 + 0.01);
        for q in out[1].iter().flatten() {
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            assert!(x >= lo && x <= hi && y >= lo && y <= hi, "the pillar's brim at ({x}, {y})");
        }
        // The innermost loop is still the gap and half a line off the pillar.
        let last = out[1].last().unwrap();
        let left = geom::unsc(last.iter().map(|q| q.x).min().unwrap());
        assert!((118.0 - left - (s.brim_object_gap + spacing / 2.0)).abs() < 0.01, "{left}");
        for q in out[0].iter().flatten() {
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            assert!(!(100.0..=140.0).contains(&x) || !(100.0..=140.0).contains(&y), "the frame's brim at ({x}, {y})");
        }
    }

    #[test]
    fn brims_stop_short_of_another_object_and_an_earlier_brim() {
        let s = settings("outer_only");
        // Two blocks 4 mm apart: neither's brim reaches the other block, and they don't overlap.
        let first = vec![rect(100.0, 100.0, 20.0, 20.0), rect(124.0, 100.0, 20.0, 20.0)];
        let out = brims(&first, &[0, 1], &[10.0, 10.0], &Vec::new(), &s).loops;
        let gap = s.brim_object_gap;
        for (o, x0, x1) in [(0, 124.0, 144.0), (1, 100.0, 120.0)] {
            for q in out[o].iter().flatten() {
                let x = geom::unsc(q.x);
                let y = geom::unsc(q.y);
                assert!(!(x > x0 - gap && x < x1 + gap && y > 100.0 - gap && y < 120.0 + gap), "{o}: ({x}, {y})");
            }
        }
        let area = |o: usize| -> Shapes { out[o].iter().map(|c| vec![c.clone()]).collect() };
        let common = geom::intersection(&geom::union_all(&[&area(0)]), &geom::union_all(&[&area(1)]));
        assert!(geom::area_mm2(&common) < 25.0, "{} mm² both", geom::area_mm2(&common));
    }
}
