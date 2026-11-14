//! Brims as OrcaSlicer 2.5 makes them (`Brim.cpp`): loops round each object's first layer that hold it to the
//! plate.
//!
//! Orca's auto brim, the X2D's default, gives an object one only where it may come loose: its width grows with the
//! object's height over how stiff its footprint is (the footprint's second moment of area), with how fast the
//! printer moves and with how far the material curls, up to 18 mm, and anything under 5 mm is dropped. A tall
//! object's island too thin to hold on its own (less area than 1.1 mm times its outline) gets a 5 mm brim anyway, as
//! wide at most as the island. A brim people turn on is the process's width round every island, inside its holes
//! too or only there when asked; brim ears are discs at the outline's sharp corners (and at the holes' corners that
//! point into them), the width less the gap and a line in radius. Any of them is a band from `brim_object_gap` off
//! the island's outline, cut where another object (or the edge of a hole in one) is, where an earlier object's brim
//! already lies and where the supports' lowest layers print, and dropped where it would not touch its object. Loops
//! fill it a line apart from the outside in, an even number of them.

use crate::config::Settings;
use crate::fmath::Hyp;
use crate::geom::{self, Contour, Join, Pt, Shape, Shapes};

/// mm: Orca's `RESOLUTION`, to which the brim's band is simplified and its corners rounded.
const RESOLUTION: f64 = 0.0125;

/// The sides of a brim ear's disc (Orca's `POLY_SIDE_COUNT`).
const EAR_SIDES: usize = 24;

/// Which brims the settings ask for (Orca's `brim_type`): round the outside of each island, inside its holes, and
/// whether as ears at the corners, or as wide as the auto brim makes it.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
struct Kind {
    auto: bool,
    outer: bool,
    inner: bool,
    ears: bool,
}

impl Kind {
    fn of(s: &Settings) -> Kind {
        let ears = s.brim_type == "brim_ears";
        match s.brim_type.as_str() {
            "auto_brim" => Kind { auto: true, outer: true, ..Kind::default() },
            "outer_only" => Kind { outer: true, ..Kind::default() },
            "inner_only" => Kind { inner: true, ..Kind::default() },
            "outer_and_inner" => Kind { outer: true, inner: true, ..Kind::default() },
            _ if ears => Kind { outer: true, inner: !s.brim_ears_outer_only, ears, auto: false },
            _ => Kind::default(),
        }
    }
}

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
    let kind = Kind::of(s);
    let auto = kind.auto;
    // An object on a raft has no brim (Orca's `has_brim`).
    if !kind.outer && !kind.inner || s.support.raft_layers > 0 {
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

    // Each object's band: from the gap off each island's outline to the brim's width beyond (or to its ears), and
    // from the gap inside each of its holes to the object's brim width further in (or to the ears there).
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
            if kind.outer && w > 0.0 {
                let outline = vec![vec![island[0].clone()]];
                if kind.ears {
                    // Which corners get ears depends on where the outline grown by the gap starts (its simplification
                    // keeps that point), so it is grown as Orca grows it, by Clipper2.
                    let inner = geom::offset_c2(&outline, gap, Join::Round(RESOLUTION));
                    band.extend(geom::difference(&ears(&inner, w - gap - spacing, true, s), &inner));
                } else {
                    let inner = geom::offset_round(&outline, gap, RESOLUTION);
                    band.extend(geom::difference(&geom::offset_round(&inner, w, RESOLUTION), &inner));
                }
            }
            // In the holes, as wide as the object's brim (Orca's `brim_width` there, not the island's), mitred.
            if kind.inner && width > 0.0 && island.len() > 1 {
                let holes: Shapes = island[1..].iter().map(|h| vec![h.iter().rev().copied().collect()]).collect();
                let deep = geom::offset_c2(&holes, -(width + gap), Join::Miter(3.0));
                let edge = geom::offset_c2(&holes, -gap, Join::Miter(3.0));
                let outer = if kind.ears { ears(&edge, width - gap - spacing, false, s) } else { edge };
                band.extend(geom::intersection(&geom::difference(&outer, &deep), &holes));
            }
        }
    }
    if bands.iter().all(Vec::is_empty) {
        return out;
    }
    // Near each band: every object's islands grown by the gap, where no brim may go nor one need reach to stay, a
    // line's width in from the edge of each of their holes where they get no brim inside them, a line's width round
    // their outline where they get none outside it, and what the supports' lowest layers print, where no brim may go
    // either. What lies further off can't change a boolean with the band (`geom::local`), so only the islands near
    // it are grown.
    let reach = 2.0 * spacing;
    let (bx, by) = (geom::sc(s.bed[0]), geom::sc(s.bed[1]));
    let bed: Shapes = vec![vec![vec![geom::pt(0, 0), geom::pt(bx, 0), geom::pt(bx, by), geom::pt(0, by)]]];
    let mut grown: Vec<Shapes> = vec![Vec::new(); objects];
    for (band, grown) in bands.iter_mut().zip(&mut grown) {
        let Some(b) = geom::bbox(band) else { continue };
        let near = geom::local(first, geom::inflate(b, reach + gap + spacing));
        *grown = geom::union_all(&[&geom::offset_round(&near, gap, RESOLUTION)]);
        let mut keep_out = grown.clone();
        if !kind.inner {
            for hole in near.iter().flat_map(|island| &island[1..]) {
                let mut ring = hole.clone();
                if geom::area2(&ring) < 0 {
                    ring.reverse();
                }
                let area: Shapes = vec![vec![ring]];
                keep_out.extend(geom::difference(&area, &geom::offset(&area, -spacing)));
            }
        }
        if !kind.outer {
            for island in &near {
                let outline: Shapes = vec![vec![island[0].clone()]];
                let holes: Shapes = island[1..].iter().map(|h| vec![h.iter().rev().copied().collect()]).collect();
                keep_out.extend(geom::difference(&geom::offset_c2(&outline, spacing, Join::Miter(3.0)), &holes));
            }
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

/// Brim ears round `areas`' outlines (Orca's `make_brim_ears_auto`): a disc `radius` mm across at each corner of an
/// outline, simplified to within `brim_ears_detection_length`, that turns more sharply than `brim_ears_max_angle`
/// allows, outwards (`convex`) or, for a hole's outline, inwards.
fn ears(areas: &Shapes, radius: f64, convex: bool, s: &Settings) -> Shapes {
    if radius <= 0.0 {
        return Vec::new();
    }
    let threshold = (180.0 - s.brim_ears_max_angle).to_radians();
    let mut centres = Vec::new();
    for area in areas {
        let mut outline = area[0].clone();
        if s.brim_ears_detection_length > 0.0 {
            let mut closed = outline.clone();
            closed.push(outline[0]);
            let mut kept = geom::simplify_line(&closed, s.brim_ears_detection_length);
            // Not below four corners, which surely hold it anyway.
            if kept.len() > 4 {
                kept.pop();
                outline = kept;
            }
        }
        centres.extend(corners(&outline, threshold, convex));
    }
    let r = radius * geom::SCALE;
    let disc: Contour = (0..EAR_SIDES)
        .map(|i| {
            let a = 2.0 * std::f64::consts::PI * i as f64 / EAR_SIDES as f64;
            geom::pt((r * a.cos()).round() as i32, (r * a.sin()).round() as i32)
        })
        .collect();
    centres.into_iter().map(|c| vec![disc.iter().map(|q| geom::pt(q.x + c.x, q.y + c.y)).collect()]).collect()
}

/// The corners of a ring where it turns left (`convex`, on a counter-clockwise outline) or right by more than
/// `threshold` radians, as Orca's `convex_points` and `concave_points` find them (from its last point round).
fn corners(ring: &[Pt], threshold: f64, convex: bool) -> Vec<Pt> {
    let n = ring.len();
    if n < 3 {
        return Vec::new();
    }
    let cos_threshold = threshold.next_up().cos();
    let unit = |x: f64, y: f64| {
        let l = x.hyp(y);
        if l > 0.0 { (x / l, y / l) } else { (x, y) }
    };
    let mut out = Vec::new();
    let mut p1 = ring[n - 1];
    let mut v1 = ((p1.x - ring[n - 2].x) as f64, (p1.y - ring[n - 2].y) as f64);
    for &p2 in ring {
        let v2 = ((p2.x - p1.x) as f64, (p2.y - p1.y) as f64);
        let cross = v1.0 * v2.1 - v1.1 * v2.0;
        let turns = if convex { cross > 0.0 } else { cross < 0.0 };
        if turns {
            let (a, b) = (unit(v1.0, v1.1), unit(v2.0, v2.1));
            if threshold <= 1e-4 || a.0 * b.0 + a.1 * b.1 < cos_threshold {
                out.push(p1);
            }
        }
        v1 = v2;
        p1 = p2;
    }
    out
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

/// An order to visit points in, as Orca's `chain_points`: for up to four, the shortest path through them, as Orca
/// chains so few exactly (`chain_segments_exact`, ties going as its search finds them); for more, its multi-fragment
/// algorithm (`order::chain`).
fn chain(points: &[Pt]) -> Vec<usize> {
    let n = points.len();
    if n <= 1 {
        return (0..n).collect();
    }
    let d = |a: usize, b: usize| geom::dist(points[a], points[b]);
    if n > 4 {
        let ends: Vec<(Pt, Pt)> = points.iter().map(|&p| (p, p)).collect();
        return crate::order::chain(&ends, &vec![true; n], None, false).into_iter().map(|(i, _)| i).collect();
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

    /// A 40 mm square with a 20 mm square hole, its lowest corner at (100, 100).
    fn frame() -> Shape {
        let mut frame = rect(100.0, 100.0, 40.0, 40.0);
        let mut hole = rect(110.0, 110.0, 20.0, 20.0).remove(0);
        hole.reverse();
        frame.push(hole);
        frame
    }

    /// Each loop's bounding box, mm.
    fn boxes(loops: &[Contour]) -> Vec<[f64; 4]> {
        loops
            .iter()
            .map(|c| geom::bbox_of(&vec![c.clone()]))
            .map(|b| [geom::unsc(b[0]), geom::unsc(b[1]), geom::unsc(b[2]), geom::unsc(b[3])])
            .collect()
    }

    #[test]
    fn ears_hold_the_sharp_corners_and_a_round_part_gets_none() {
        let s = settings("brim_ears");
        let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
        let width = (s.brim_width / spacing / 2.0).floor() * spacing * 2.0;
        let radius = width - s.brim_object_gap - spacing;
        // A 30 mm square: a disc at each corner, its radius the brim's width less the gap and a line, its loops a line
        // apart from the outside in, nothing along the middle of the sides.
        let out = brims(&vec![rect(100.0, 100.0, 30.0, 30.0)], &[0], &[10.0], &Vec::new(), &s).loops;
        assert!(!out[0].is_empty());
        for q in out[0].iter().flatten() {
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            let corner = [100.0, 130.0].iter().any(|cx| (x - cx).abs() <= radius + 0.11)
                && [100.0, 130.0].iter().any(|cy| (y - cy).abs() <= radius + 0.11);
            assert!(corner, "brim at ({x}, {y}) off the corners");
        }
        let b = boxes(&out[0]);
        let outermost = b.iter().filter(|b| (b[2] - b[0] - 2.0 * (radius - spacing / 2.0)).abs() < 0.05).count();
        assert_eq!(outermost, 4, "one disc's outermost loop at each corner: {b:?}");
        // The discs stop at the outline grown by the gap.
        for q in out[0].iter().flatten() {
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            assert!(
                !(x > 100.0 - s.brim_object_gap
                    && x < 130.0 + s.brim_object_gap
                    && y > 100.0 - s.brim_object_gap
                    && y < 130.0 + s.brim_object_gap)
            );
        }
        // A disc 30 mm across has no corner sharp enough.
        let round: Contour = geom::make_circle(15.0, 0.01)
            .iter()
            .map(|q| geom::pt(q.x + geom::sc(115.0), q.y + geom::sc(115.0)))
            .collect();
        let out = brims(&vec![vec![round]], &[0], &[10.0], &Vec::new(), &s);
        assert!(out.loops[0].is_empty() && out.area.is_empty());
    }

    #[test]
    fn an_inner_brim_lines_a_hole_and_an_outer_and_inner_one_both_sides() {
        let spacing = Settings::spacing(Settings::default().first_layer_width, Settings::default().first_layer_height);
        let lines = |s: &Settings| (s.brim_width / spacing / 2.0).floor() as usize * 2;
        // Inside only: as many loops along the hole's sides as a brim round the outside has, and one more in each of
        // its corners, where the band, mitred, is wider (14, as Orca's), all inside the hole, the first the gap and
        // half a line in from its edge.
        let s = settings("inner_only");
        let inner = brims(&vec![frame()], &[0], &[10.0], &Vec::new(), &s).loops;
        assert_eq!(inner[0].len(), lines(&s) + 4);
        for b in boxes(&inner[0]) {
            assert!(b[0] >= 110.0 && b[2] <= 130.0 && b[1] >= 110.0 && b[3] <= 130.0, "{b:?} outside the hole");
        }
        let first = boxes(&inner[0])[0];
        assert!((first[0] - (110.0 + s.brim_object_gap + spacing / 2.0)).abs() < 0.01, "{first:?}");
        // Both sides: the outer brim's loops, then the hole's.
        let s = settings("outer_and_inner");
        let both = brims(&vec![frame()], &[0], &[10.0], &Vec::new(), &s).loops;
        assert_eq!(both[0].len(), lines(&s) + lines(&s) + 4);
        let b = boxes(&both[0]);
        assert!(b[..lines(&s)].iter().all(|b| b[0] < 100.0), "the outside first: {b:?}");
        assert!(b[lines(&s)..].iter().all(|b| b[0] > 110.0), "then the hole: {b:?}");
        // Brim ears in a square hole: its corners point out of the hole, so none there.
        let ears = brims(&vec![frame()], &[0], &[10.0], &Vec::new(), &settings("brim_ears")).loops;
        assert!(boxes(&ears[0]).iter().all(|b| b[0] < 100.0 || b[2] > 140.0 || b[1] < 100.0 || b[3] > 140.0));
    }

    #[test]
    fn a_brim_only_inside_holes_keeps_other_brims_a_line_off_its_outline() {
        let s = settings("inner_only");
        let spacing = Settings::spacing(s.first_layer_width, s.first_layer_height);
        // A frame and a block 1 mm beside it: the block's brim, a ring round the outside of a hole-less part, is
        // none (inside only), and nothing else lies within a line of the frame's outline.
        let out = brims(&vec![frame(), rect(141.0, 100.0, 10.0, 10.0)], &[0, 1], &[10.0, 10.0], &Vec::new(), &s);
        assert!(out.loops[1].is_empty());
        for q in out.loops[0].iter().flatten() {
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            assert!((110.0 + spacing / 2.0..=130.0 - spacing / 2.0).contains(&x), "({x}, {y})");
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
