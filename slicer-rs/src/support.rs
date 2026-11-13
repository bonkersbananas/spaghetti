//! Orca's normal supports (`PrintObjectSupportMaterial`, "normal(auto)" in its grid style), for one object at a time,
//! ported from OrcaSlicer 2.5's `SupportMaterial.cpp` and `SupportCommon.cpp` in its steps:
//!
//! 1. Overhangs: where a layer reaches more than the support angle beyond the layer below (31° for 30, as Orca makes
//!    it inclusive), and "sharp tails", small islands that start in the air, grown up while they stay small. Small
//!    clusters of overhang that are neither are dropped.
//! 2. Top contacts: a layer of interface the top gap under each overhang, its area stretched onto the support grid
//!    (`grid.rs`), dense only where the overhang is steep enough to need it.
//! 3. Columns: the contacts projected down layer by layer, re-gridded and cut by each layer of the object, to the
//!    plate or to the object's top surfaces, where a bottom contact layer of interface sits the bottom gap above.
//! 4. The support's own layers between those contacts, as thick as the printer allows (0.28 mm on the X2D) and
//!    evened out, so most of them fall between the object's layers.
//! 5. Every layer cut back from the object by the XY gap (less beside sharp tails and layers it doesn't overlap), one
//!    more layer of interface next to each contact, and on the plate a flange 2 mm wider than the columns.
//! 6. Toolpaths: interfaces and columns as Orca's support pattern (`base_support.rs`), the flange as a loop round
//!    rectilinear lines.
//!
//! What it leaves out: Orca's thinning of a column's layer where it overlaps a contact in height
//! (`modulate_extrusion_by_overlapping_layers`) and its arcs; supports are refused with a raft, on the plate only,
//! with painted or tree supports and the settings `config.rs` lists.

use crate::base_support;
use crate::config::Settings;
use crate::geom::{self, Pt, Shape, Shapes};
use crate::grid::{self, Grid};
use crate::monotonic;
use crate::par;
use crate::region::Role;

const EPSILON: f64 = 1e-4;
/// Orca's `SCALED_EPSILON` (100 nm), in mm.
const SCALED_EPSILON: f64 = 1e-4;
/// Orca's sharp tails: islands under 6 mm across, at most 16 mm tall.
const WELL_SUPPORTED: f64 = 6.0;
const SHARP_TAIL_MAX_HEIGHT: f64 = 16.0;
/// mm: how far support keeps off a sharp tail, and off object layers it doesn't overlap in height.
const SHARP_TAIL_XY_GAP: f64 = 0.2;
const NO_OVERLAP_XY_GAP: f64 = 0.2;
/// mm: support paths are simplified to this (Orca's `SCALED_SUPPORT_RESOLUTION`, with arc fitting off).
const RESOLUTION: f64 = 0.0375;

/// What the generator needs from the settings, worked out as Orca's `SupportParameters` and `SlicingParameters` do.
#[derive(Clone, Debug)]
pub struct Params {
    /// Radians: the overhang angle from vertical beyond which a layer needs support (the setting plus one degree).
    threshold: f64,
    /// mm: the outer wall's width (Orca's `fw`, as its float `scaled_width`).
    fw: f64,
    /// mm: the process's line width (sharp tails and small overhangs are measured in it).
    extrusion_width: f64,
    first_layer_height: f64,
    /// mm: the thinnest and thickest support layer.
    min_height: f64,
    max_height: f64,
    gap_top: f64,
    gap_bottom: f64,
    gap_xy: f64,
    gap_xy_first_layer: f64,
    remove_small_overhangs: bool,
    top_interfaces: usize,
    bottom_interfaces: usize,
    /// The support line: width and spacing (mm, Orca's float flow), its density in the columns and the interfaces.
    width: f64,
    spacing: f64,
    density: f64,
    top_interface_density: f64,
    bottom_interface_density: f64,
    /// The first layer's flange: line width and spacing, density and how far it grows past the columns.
    first_width: f64,
    first_spacing: f64,
    first_density: f64,
    first_expansion: f64,
    /// A bottom contact layer's height (the layer height as Orca's float flow keeps it).
    bottom_contact_height: f64,
    /// How the brim keeps the first layer's support off: none, the object's footprint, or that grown by the gap.
    brim: Option<f64>,
    grid_resolution: f64,
    /// Orca's organic trees (`smsTreeOrganic`), whose layers come from `tree.rs`: their bottom contacts aren't printed,
    /// their interfaces are rounded off, and their branches print as anchored loops.
    organic: bool,
    /// mm²: a tree branch's island larger than this gets a second wall (`tree_branch_diameter_double_wall_area`).
    double_wall_area: f64,
}

impl Params {
    pub fn new(s: &Settings) -> Params {
        let sp = &s.support;
        let flow_spacing = |w: f64, h: f64| (w as f32 - h as f32 * (1.0 - 0.25 * std::f64::consts::PI) as f32) as f64;
        let spacing = flow_spacing(sp.line_width, s.layer_height);
        let first_spacing = flow_spacing(s.first_layer_width, s.first_layer_height);
        let support_spacing = sp.base_spacing + spacing;
        let density = (spacing / support_spacing).min(1.0);
        let top_interface_density = (spacing / (sp.interface_spacing + spacing)).min(1.0);
        let bottom_interface_density = (spacing / (sp.bottom_interface_spacing + spacing)).min(1.0);
        let fw = ((s.outer_wall_width as f32 as f64 * 1e6) as i64) as f32 as f64 / 1e6;
        let threshold = (sp.threshold_angle + 1.0).min(89.0).to_radians();
        let min_height = s.layer_height.max(0.01).min(sp.min_layer_height.max(0.01));
        Params {
            threshold,
            fw,
            extrusion_width: s.line_width,
            first_layer_height: s.first_layer_height,
            min_height,
            max_height: sp.max_layer_height,
            gap_top: sp.top_z_distance,
            gap_bottom: sp.bottom_z_distance,
            gap_xy: sp.xy_distance,
            gap_xy_first_layer: sp.first_layer_xy_distance,
            remove_small_overhangs: sp.remove_small_overhang,
            top_interfaces: sp.top_interface_layers,
            bottom_interfaces: sp.bottom_interface_layers,
            width: sp.line_width,
            spacing,
            density,
            top_interface_density,
            bottom_interface_density,
            first_width: s.first_layer_width,
            first_spacing,
            first_density: sp.first_layer_density as f32 as f64,
            first_expansion: sp.first_layer_expansion,
            bottom_contact_height: s.layer_height as f32 as f64,
            brim: match s.brim_type.as_str() {
                "auto_brim" | "" => Some(0.0),
                "outer_only" if s.brim_width > 0.0 => Some(s.brim_object_gap),
                _ => None,
            },
            grid_resolution: support_spacing,
            organic: sp.organic(),
            double_wall_area: match sp.wall_count {
                0 => 0.25 * 25.0 * std::f64::consts::PI,
                1 => f64::MAX,
                _ => 1e-13,
            },
        }
    }

    fn grid(&self, origin: (i64, i64)) -> grid::Params {
        grid::Params { resolution: self.grid_resolution, line_spacing: self.spacing, origin }
    }
}

/// One object as the generator reads it, layer by layer up to its top.
pub struct Object<'a> {
    pub print_z: &'a [f64],
    pub height: &'a [f64],
    /// The object's slice on each layer (Orca's `lslices`: the first layer as sliced, before elephant's foot).
    pub slices: Vec<Shapes>,
    /// Its top surfaces on each layer (Orca's `stTop` slices).
    pub tops: Vec<Shapes>,
    /// Units on the plate: the middle of its bounding box, the origin of Orca's frame for it.
    pub origin: (f64, f64),
}

impl Object<'_> {
    fn bottom_z(&self, l: usize) -> f64 {
        self.print_z[l] - self.height[l]
    }
}

/// An extrusion of support.
#[derive(Clone, Debug)]
pub struct Path {
    pub role: Role,
    pub points: Vec<Pt>,
    pub width: f64,
    /// mm: the height of the support layer it belongs to, which may differ from the layer it prints on.
    pub height: f64,
}

/// What a support layer prints, in Orca's order before it chains them: single paths, which may be chained in any
/// order either way, and the flange's loop with its lines, which print as they come.
#[derive(Clone, Debug)]
pub enum Item {
    Path(Path),
    Fixed(Vec<Path>),
}

/// One of the support's layers.
#[derive(Clone, Debug)]
pub struct Layer {
    pub print_z: f64,
    pub height: f64,
    pub items: Vec<Item>,
    /// Its areas: a travel to support that stays inside one needn't retract (Orca's `support_islands`).
    pub islands: Shapes,
    /// Whether it is on the plate (its flange prints with the first layer's speeds).
    pub first: bool,
}

/// What a support layer prints: each path grown by half its line spacing, with square corners and flat ends, as
/// Orca's `polygons_covered_by_spacing` measures it. Orca keeps the brim out of what an object's lowest support layer
/// prints, wherever that layer is.
pub fn cover(layer: &Layer) -> Shapes {
    let mut out: Shapes = Vec::new();
    for item in &layer.items {
        let paths = match item {
            Item::Path(path) => std::slice::from_ref(path),
            Item::Fixed(group) => group.as_slice(),
        };
        for path in paths {
            out.extend(geom::offset_open(&path.points, 0.5 * Settings::spacing(path.width, path.height)));
        }
    }
    geom::union_all(&[&out])
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Kind {
    TopContact,
    BottomContact,
    Intermediate,
    Base,
    TopInterface,
    BottomInterface,
}

/// A layer of the generator (Orca's `SupportGeneratorLayer`).
#[derive(Clone, Debug)]
struct Gen {
    kind: Kind,
    print_z: f64,
    bottom_z: f64,
    height: f64,
    polygons: Shapes,
    /// A top contact's area as projected down, and the overhangs it holds up.
    contact: Shapes,
    overhang: Shapes,
}

impl Gen {
    fn new(kind: Kind, bottom_z: f64, print_z: f64, height: f64) -> Gen {
        Gen { kind, print_z, bottom_z, height, polygons: Vec::new(), contact: Vec::new(), overhang: Vec::new() }
    }

    fn bottom_print_z(&self) -> f64 {
        self.print_z - self.height
    }

    fn extreme_z(&self) -> f64 {
        if self.kind == Kind::TopContact { self.bottom_z } else { self.print_z }
    }
}

/// What overhang detection finds on a layer.
#[derive(Clone, Debug, Default)]
struct Detected {
    /// The overhangs, as islands; a cleared one (a small overhang removed) stays as an empty shape.
    overhangs: Vec<Shape>,
    tails: Vec<Shape>,
    tail_heights: Vec<f64>,
    cantilevers: Shapes,
}

fn grow(shapes: &Shapes, d: f64) -> Shapes {
    if shapes.is_empty() { Vec::new() } else { geom::offset(shapes, d) }
}

/// `grow` with square corners (Orca's `SUPPORT_SURFACES_OFFSET_PARAMETERS`, `jtSquare`).
fn square(shapes: &Shapes, d: f64) -> Shapes {
    if shapes.is_empty() { Vec::new() } else { geom::offset_square(shapes, d) }
}

fn one(shape: &Shape) -> Shapes {
    vec![shape.clone()]
}

/// Whether two sets of areas overlap (Orca's `overlaps`).
fn overlaps(a: &Shapes, b: &Shapes) -> bool {
    let (Some(ba), Some(bb)) = (geom::bbox(a), geom::bbox(b)) else { return false };
    if ba[0] > bb[2] || bb[0] > ba[2] || ba[1] > bb[3] || bb[1] > ba[3] {
        return false;
    }
    let near_b = geom::near(b, ba);
    !near_b.is_empty() && !geom::intersection(&geom::near(a, bb), &near_b).is_empty()
}

fn size(shapes: &Shapes) -> (f64, f64) {
    geom::bbox(shapes).map_or((0.0, 0.0), |b| (geom::unsc(b[2] - b[0]), geom::unsc(b[3] - b[1])))
}

/// The supports of one object, layer by layer, bottom up.
pub fn generate(o: &Object, p: &Params) -> Vec<Layer> {
    let n = o.slices.len();
    if n < 2 {
        return Vec::new();
    }
    let origin = ((o.origin.0 * 100.0).round() as i64, (o.origin.1 * 100.0).round() as i64);
    let gp = p.grid(origin);

    // 1. Overhangs.
    let mut detected: Vec<Detected> =
        par::map_range(n, |l| if l == 0 { Detected::default() } else { detect_overhangs(o, l, p) });
    grow_sharp_tails(o, &mut detected, p);
    let mut present = vec![false; n];
    for (l, d) in detected.iter().enumerate() {
        present[l] = !d.overhangs.is_empty();
    }
    if p.remove_small_overhangs {
        remove_small_overhangs(&mut detected, p);
    }

    // 2. Top contacts.
    let mut arena: Vec<Gen> = Vec::new();
    let contacts: Vec<Option<Gen>> = par::map_range(n, |l| {
        if l == 0 || !present[l] {
            return None;
        }
        contact_layer(o, l, &detected[l], p, &gp)
    });
    let mut tops: Vec<usize> = Vec::new();
    for g in contacts.into_iter().flatten() {
        tops.push(arena.len());
        arena.push(g);
    }
    if tops.is_empty() {
        return Vec::new();
    }
    merge_contacts(&mut arena, &mut tops, p);

    // 3. Columns and bottom contacts.
    let tails: Vec<&Vec<Shape>> = detected.iter().map(|d| &d.tails).collect();
    let (bottoms, support_areas) = columns(o, &mut arena, &tops, p, &gp);
    trim_by_object(o, &mut arena, &bottoms, &tails, p);

    // 4. The support's own layers.
    let inter = intermediate_layers(&mut arena, &tops, &bottoms, p);

    // 5. Trimming, base layers, interfaces, the flange.
    trim_by_object(o, &mut arena, &tops, &tails, p);
    base_layers(o, &mut arena, &tops, &bottoms, &inter, &support_areas);
    trim_by_object(o, &mut arena, &inter, &tails, p);
    for &t in &tops {
        let (tz, tb) = (arena[t].print_z, arena[t].bottom_z);
        let i = bottoms.partition_point(|&b| arena[b].bottom_print_z() - EPSILON <= tb);
        for k in (0..i).rev() {
            let b = bottoms[k];
            if tz < arena[b].print_z + EPSILON {
                if !arena[t].polygons.is_empty() && !arena[b].polygons.is_empty() {
                    arena[t].polygons = geom::difference(&arena[t].polygons, &arena[b].polygons);
                }
            } else {
                break;
            }
        }
    }
    let interfaces = interface_layers(&mut arena, &tops, &bottoms, &inter, p);
    flange(o, &mut arena, &tops, &interfaces, &inter, p);

    // 6. Layers and toolpaths.
    toolpaths(o, &mut arena, &tops, &bottoms, &inter, &interfaces, p)
}

/// One object's organic trees as drawn (`tree.rs`), on the support's layers (the object's): each layer's branches
/// (Orca's base layers), the bottom contacts where branches rest on the model, and the roofs' contact and interface
/// layers.
pub struct TreeLayers {
    pub base: Vec<Shapes>,
    pub bottom_contacts: Vec<Shapes>,
    pub contacts: Vec<Shapes>,
    pub interfaces: Vec<Shapes>,
    /// mm: each layer's bottom and top.
    pub z: Vec<(f64, f64)>,
}

/// The supports of one object from its organic trees: interfaces under the roofs and over the bottom contacts, the
/// flange on the plate, then toolpaths, as Orca's `generate_support_areas` goes on after drawing the trees.
pub fn generate_tree(o: &Object, p: &Params, t: TreeLayers) -> Vec<Layer> {
    let mut arena: Vec<Gen> = Vec::new();
    let (mut tops, mut bottoms, mut inter, mut placed) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for (l, &(bottom_z, print_z)) in t.z.iter().enumerate() {
        let height = print_z - bottom_z;
        let mut add = |kind: Kind, polygons: Option<&Shapes>, list: &mut Vec<usize>| {
            let Some(polygons) = polygons.filter(|s| !s.is_empty()) else { return };
            let mut g = Gen::new(kind, bottom_z, print_z, height);
            // (Orca's bed clip: the first union of the roofs' raw polygons.)
            g.polygons = geom::union_nonzero(&polygons.iter().flatten().cloned().collect::<Vec<_>>());
            if !g.polygons.is_empty() {
                list.push(arena.len());
                arena.push(g);
            }
        };
        add(Kind::BottomContact, t.bottom_contacts.get(l), &mut bottoms);
        add(Kind::TopContact, t.contacts.get(l), &mut tops);
        add(Kind::TopInterface, t.interfaces.get(l), &mut placed);
        add(Kind::Base, t.base.get(l), &mut inter);
    }
    if tops.is_empty() && inter.is_empty() && placed.is_empty() {
        return Vec::new();
    }
    let interfaces = tree_interface_layers(&mut arena, &tops, &bottoms, &inter, &placed, p);
    flange(o, &mut arena, &tops, &interfaces, &inter, p);
    toolpaths(o, &mut arena, &tops, &bottoms, &inter, &interfaces, p)
}

/// Orca's `generate_interface_layers` for organic trees: a base layer prints as interface where the contacts on its
/// own layer and the next one up lie, and where the bottom contacts of the two layers below lie (which print
/// nothing themselves), each grown and rounded off; the roofs' own interface layers take in what falls on their
/// layer. With no base layer at all, there are no interfaces either.
fn tree_interface_layers(
    arena: &mut Vec<Gen>,
    tops: &[usize],
    bottoms: &[usize],
    inter: &[usize],
    placed: &[usize],
    p: &Params,
) -> Vec<usize> {
    let num_top = p.top_interfaces.saturating_sub(1);
    let num_bottom = p.bottom_interfaces;
    if inter.is_empty() || (p.top_interfaces == 0 && p.bottom_interfaces == 0) {
        return Vec::new();
    }
    // Grown by the islands' smallest radius, then rounded off (Orca's `regularize` with smooth supports).
    let smoothing = (p.spacing * 1e6) as i64 as f64 * 1.5;
    let regularize = |polys: Shapes, density: f64| -> Shapes {
        if polys.is_empty() {
            return polys;
        }
        let island = (p.spacing * 1e6) as i64 as f64 / density;
        let grown = geom::offset_square(
            &geom::union_nonzero(&polys.into_iter().flatten().collect::<Vec<_>>()),
            ((smoothing + island) as f32 as f64) / 1e6,
        );
        let closed = geom::offset_square(&grown, -((smoothing as f32 as f64) / 1e6));
        crate::tree::smooth::smooth_outward(&closed, smoothing as i64)
    };
    let ni = inter.len();
    let made: Vec<Option<(Option<Gen>, Shapes, Shapes)>> = {
        let arena = &*arena;
        par::map_range(ni, |i| {
            let it = &arena[inter[i]];
            let mut top_set: Shapes = Vec::new();
            let mut bottom_set: Shapes = Vec::new();
            if num_top > 0 {
                let top_z = arena[inter[(i + num_top - 1).min(ni - 1)]].print_z;
                let first = tops.partition_point(|&t| arena[t].print_z < it.print_z);
                for &t in &tops[first..] {
                    if arena[t].bottom_z - EPSILON > top_z {
                        break;
                    }
                    top_set.extend(arena[t].polygons.iter().cloned());
                }
            }
            if num_bottom > 0 {
                let bottom_z = arena[inter[(i + 1).saturating_sub(num_bottom)]].bottom_z;
                let first = bottoms.partition_point(|&b| arena[b].print_z < bottom_z - EPSILON);
                for &b in &bottoms[first..] {
                    if arena[b].print_z - EPSILON > it.bottom_z {
                        break;
                    }
                    bottom_set.extend(arena[b].polygons.iter().cloned());
                }
            }
            let same = placed
                .iter()
                .copied()
                .find(|&q| (arena[q].print_z - it.print_z).abs() < EPSILON && !arena[q].polygons.is_empty());
            if top_set.is_empty() && bottom_set.is_empty() && same.is_none() {
                return None;
            }
            let kind = if top_set.is_empty() { Kind::BottomInterface } else { Kind::TopInterface };
            let mut both = regularize(bottom_set, p.bottom_interface_density);
            both.extend(regularize(top_set, p.top_interface_density));
            let mut poly = if both.is_empty() { Vec::new() } else { geom::intersection(&both, &it.polygons) };
            if let Some(q) = same {
                poly = geom::union(&arena[q].polygons, &poly);
            }
            if poly.is_empty() {
                return None;
            }
            let rest = geom::difference(&it.polygons, &poly);
            // Into the roofs' own interface layer where there is one, else a new one.
            let g = same.is_none().then(|| {
                let mut g = Gen::new(kind, it.bottom_z, it.print_z, it.height);
                g.polygons = poly.clone();
                g
            });
            Some((g, poly, rest))
        })
    };
    let mut out = Vec::new();
    for (i, m) in made.into_iter().enumerate() {
        let Some((g, poly, rest)) = m else { continue };
        arena[inter[i]].polygons = rest;
        match g {
            Some(g) => {
                out.push(arena.len());
                arena.push(g);
            }
            None => {
                let z = arena[inter[i]].print_z;
                if let Some(&q) = placed.iter().find(|&&q| (arena[q].print_z - z).abs() < EPSILON) {
                    arena[q].polygons = poly;
                    arena[q].bottom_z = arena[inter[i]].bottom_z;
                    arena[q].height = arena[inter[i]].height;
                }
            }
        }
    }
    out.extend(placed.iter().copied().filter(|&q| !arena[q].polygons.is_empty()));
    out.sort_by(|&a, &b| arena[a].print_z.partial_cmp(&arena[b].print_z).unwrap());
    out.dedup();
    out
}

/// Orca's `detect_overhangs` for layer `l`: the parts beyond the layer below by more than the support angle allows,
/// with sharp tails (small islands with nothing under them) and cantilevers (overhangs reaching over 3 mm out).
fn detect_overhangs(o: &Object, l: usize, p: &Params) -> Detected {
    let lower = &o.slices[l - 1];
    let region = &o.slices[l];
    let mut out = Detected::default();
    if region.is_empty() {
        return out;
    }
    let fw = p.fw;
    let lower_expolys: Shapes =
        lower.iter().filter(|isl| !geom::offset(&one(isl), -fw / 2.0).is_empty()).cloned().collect();
    // Orca's offset is a float in nanometres.
    let llo = ((o.height[l - 1] / p.threshold.tan()) * 1e6) as f32 as f64 / 1e6;
    let mut d = geom::difference(region, &square(lower, llo));
    if !d.is_empty() {
        d = geom::difference(&geom::intersection(&square(&d, llo), region), lower);
    }
    for expoly in region {
        let e = one(expoly);
        if geom::offset(&e, -0.5 * fw).is_empty() {
            continue;
        }
        let sharp = !overlaps(&geom::offset(&e, 0.5 * fw), &lower_expolys)
            && geom::shape_area_mm2(expoly) < WELL_SUPPORTED * WELL_SUPPORTED
            && !geom::offset(&e, -0.1 * fw).is_empty();
        if sharp {
            let overhang = geom::difference(&e, &lower_expolys);
            out.tails.push(expoly.clone());
            out.tail_heights.push(o.height[l]);
            d.extend(geom::offset(&overhang, 0.05 * fw));
        }
    }
    if d.is_empty() || geom::offset(&d, -0.1 * fw).is_empty() {
        return out;
    }
    let overhangs = geom::union_all(&[&d]);
    // Cantilevers: overhangs whose farthest point is over 3 mm from where they rest on the layer below.
    let rest = geom::offset(lower, fw.max(llo) + 0.1);
    for poly in &overhangs {
        let boundary = geom::intersection(&one(poly), &rest);
        if boundary.is_empty() {
            continue;
        }
        let vertices: Vec<Pt> = boundary.iter().flatten().flatten().copied().collect();
        let mut far = 0.0f64;
        for q in &poly[0] {
            let near = vertices
                .iter()
                .map(|v| ((v.x - q.x) as f64).powi(2) + ((v.y - q.y) as f64).powi(2))
                .fold(f64::INFINITY, f64::min);
            far = far.max(near.sqrt());
        }
        if far > 3.0 * geom::SCALE {
            out.cantilevers.push(poly.clone());
        }
    }
    out.overhangs = overhangs;
    out
}

/// Sharp tails grown upwards (Orca's part of `top_contact_layers`): an island resting only on a sharp tail below,
/// still small, not over 16 mm tall and not growing fast, is a sharp tail too, and what of it lies beyond the layer
/// below is an overhang.
fn grow_sharp_tails(o: &Object, detected: &mut [Detected], p: &Params) {
    let width = p.extrusion_width;
    for l in 1..o.slices.len() {
        let (below, here) = detected.split_at_mut(l);
        let lower = &below[l - 1];
        let here = &mut here[0];
        if lower.tails.is_empty() {
            continue;
        }
        let lower_tails: Shapes = lower.tails.clone();
        for e in &o.slices[l] {
            let shape = one(e);
            let supported = geom::intersection(&shape, &lower_tails);
            if supported.is_empty() {
                continue;
            }
            let (sx, sy) = size(&supported);
            if sx > WELL_SUPPORTED && sy > WELL_SUPPORTED {
                continue;
            }
            let mut height = o.height[l];
            for (i, tail) in lower.tails.iter().enumerate() {
                if overlaps(&one(tail), &shape) {
                    height += lower.tail_heights[i];
                    break;
                }
            }
            if height > SHARP_TAIL_MAX_HEIGHT {
                continue;
            }
            let new = geom::difference(&shape, &lower_tails);
            let (nx, ny) = size(&new);
            let (tx, ty) = size(&lower_tails);
            if (nx - tx > 5.0 && ny - ty > 5.0) || !geom::offset(&new, -5.0 * width).is_empty() {
                continue;
            }
            here.tails.push(e.clone());
            here.tail_heights.push(height);
            here.overhangs.extend(geom::difference(&shape, &o.slices[l - 1]));
        }
    }
}

/// Orca's removal of small overhangs: overhangs that touch (grown by a line width) on neighbouring layers form a
/// cluster; a cluster that is no sharp tail and no cantilever, and that a line width's erosion leaves under two line
/// widths across one way, is cleared (its overhangs stay, empty, so their contact layers do too).
fn remove_small_overhangs(detected: &mut [Detected], p: &Params) {
    struct Cluster {
        members: Vec<(usize, usize)>,
        dilated: Shapes,
        min: usize,
        max: usize,
        cantilever: bool,
    }
    let w = p.extrusion_width;
    let mut clusters: Vec<Cluster> = Vec::new();
    for (l, d) in detected.iter().enumerate().skip(1) {
        for (k, shape) in d.overhangs.iter().enumerate() {
            let overhang = one(shape);
            let dilated = geom::offset(&overhang, w);
            let found =
                clusters.iter().position(|c| l + 1 >= c.min && l <= c.max + 1 && overlaps(&dilated, &c.dilated));
            let c = match found {
                Some(i) => {
                    let c = &mut clusters[i];
                    c.members.push((l, k));
                    if !dilated.is_empty() {
                        c.dilated = geom::union(&c.dilated, &dilated);
                    }
                    c.min = c.min.min(l);
                    c.max = c.max.max(l);
                    c
                }
                None => {
                    clusters.push(Cluster { members: vec![(l, k)], dilated, min: l, max: l, cantilever: false });
                    clusters.last_mut().unwrap()
                }
            };
            if overlaps(&overhang, &d.cantilevers) {
                c.cantilever = true;
            }
        }
    }
    for c in &clusters {
        let tail = (c.min..=c.max).any(|l| overlaps(&detected[l].tails, &c.dilated));
        if tail || c.cantilever {
            continue;
        }
        let (x, y) = size(&geom::offset(&c.dilated, -w));
        if x < 2.0 * w || y < 2.0 * w {
            for &(l, k) in &c.members {
                detected[l].overhangs[k].clear();
            }
        }
    }
}

/// Orca's `detect_contacts`, `new_contact_layer` and `fill_contact_layer`: the top contact layer under layer `l`'s
/// overhangs, the top gap below it.
fn contact_layer(o: &Object, l: usize, d: &Detected, p: &Params, gp: &grid::Params) -> Option<Gen> {
    let overhangs: Shapes = d.overhangs.iter().filter(|s| !s.is_empty()).cloned().collect();
    let lower = &o.slices[l - 1];
    let contact = if overhangs.is_empty() {
        Vec::new()
    } else {
        geom::difference(&geom::intersection(&overhangs, &o.slices[l]), lower)
    };
    let mut print_z = o.bottom_z(l) - p.gap_top;
    if print_z < p.first_layer_height - EPSILON {
        return None;
    }
    let mut g = if print_z < p.first_layer_height + p.min_height {
        print_z = p.first_layer_height;
        Gen::new(Kind::TopContact, 0.0, print_z, p.first_layer_height)
    } else {
        Gen::new(Kind::TopContact, print_z, print_z, 0.0)
    };
    g.contact = Grid::new(&contact, lower, gp).extract(grid::EXPANSION_TO_PROPAGATE, true);
    // Dense interface only under overhangs steep enough to need it: beyond the layer below, its thin parts opened
    // away and the rest grown by 60 % of a wall.
    let nio = p.fw;
    let held = square(&square(lower, -0.5 * nio), 1.1 * nio);
    let dense = geom::difference(&overhangs, &held);
    if !dense.is_empty() {
        let dense = geom::difference(&geom::offset(&dense, 0.1 * nio), lower);
        let trimmed = geom::intersection(&dense, &g.contact);
        g.polygons = Grid::new(&trimmed, lower, gp).extract(gp.expansion_to_slice(), false);
    }
    g.overhang = overhangs;
    Some(g)
}

/// Orca's `merge_contact_layers`: contacts lower than the first layer and the thinnest support layer go to the first
/// layer; any closer than the thinnest support layer to the one below merge into it.
fn merge_contacts(arena: &mut [Gen], tops: &mut Vec<usize>, p: &Params) {
    tops.sort_by(|&a, &b| arena[a].print_z.partial_cmp(&arena[b].print_z).unwrap());
    let merge = |arena: &mut [Gen], dst: usize, src: usize| {
        let src = std::mem::replace(&mut arena[src], Gen::new(Kind::TopContact, 0.0, 0.0, 0.0));
        let d = &mut arena[dst];
        d.polygons = geom::union(&d.polygons, &src.polygons);
        d.contact = geom::union(&d.contact, &src.contact);
        d.overhang = geom::union(&d.overhang, &src.overhang);
    };
    let mut out: Vec<usize> = Vec::new();
    let mut j = 0;
    while j < tops.len() && arena[tops[j]].print_z < p.first_layer_height + p.min_height - EPSILON {
        j += 1;
    }
    if j > 0 {
        let dst = tops[0];
        for &src in &tops[1..j] {
            merge(arena, dst, src);
        }
        arena[dst].print_z = p.first_layer_height;
        arena[dst].height = p.first_layer_height;
        arena[dst].bottom_z = 0.0;
        out.push(dst);
    }
    let mut i = j;
    while i < tops.len() {
        let zmax = arena[tops[i]].print_z + p.min_height + EPSILON;
        let mut j = i + 1;
        while j < tops.len() && arena[tops[j]].print_z < zmax {
            j += 1;
        }
        for &src in &tops[i + 1..j] {
            merge(arena, tops[i], src);
        }
        out.push(tops[i]);
        i = j;
    }
    *tops = out;
}

/// Orca's `bottom_contact_layers_and_layer_support_areas`: walking down the object, the contacts above each layer
/// projected onto it, gridded and cut by it (the support to print near it, and what goes on down), and a bottom
/// contact wherever the projection lands on one of its top surfaces.
fn columns(
    o: &Object,
    arena: &mut Vec<Gen>,
    tops: &[usize],
    p: &Params,
    gp: &grid::Params,
) -> (Vec<usize>, Vec<Shapes>) {
    let n = o.slices.len();
    let mut areas: Vec<Shapes> = vec![Vec::new(); n];
    let mut bottoms: Vec<usize> = Vec::new();
    let mut projection: Shapes = Vec::new();
    let mut contact_idx = tops.len() as isize - 1;
    for l in (0..n - 1).rev() {
        let z = o.print_z[l];
        while contact_idx >= 0 && arena[tops[contact_idx as usize]].print_z > z - EPSILON {
            let t = &arena[tops[contact_idx as usize]];
            let new = [t.contact.clone(), grow(&t.overhang, SCALED_EPSILON)].concat();
            projection.extend(geom::union_all(&[&new]));
            contact_idx -= 1;
        }
        if projection.is_empty() {
            continue;
        }
        let raw = geom::union_all(&[&projection]);
        // A bottom contact where the projection lands on a top surface.
        let top = &o.tops[l];
        if !top.is_empty() {
            let touching = geom::intersection(top, &raw);
            if !touching.is_empty() {
                let height0 = p.bottom_contact_height;
                let mut height = height0;
                let mut print_z = z + height0 + p.gap_bottom;
                let mut t = contact_idx.max(0) as usize;
                while t < tops.len() && arena[tops[t]].print_z < print_z + p.min_height + EPSILON {
                    let tz = arena[tops[t]].print_z;
                    if tz > print_z - p.min_height - EPSILON {
                        let diff = print_z - tz;
                        if diff > 0.0 {
                            if height - diff > p.min_height {
                                print_z = tz;
                                height -= diff;
                            } else {
                                t += 1;
                                continue;
                            }
                        } else {
                            print_z = tz;
                            height -= diff;
                        }
                        break;
                    }
                    t += 1;
                }
                let mut b = Gen::new(Kind::BottomContact, z, print_z, height);
                b.polygons = square(&touching, p.width);
                let touching = grow(&touching, SCALED_EPSILON);
                for (area, &z) in areas[l + 1..n].iter_mut().zip(&o.print_z[l + 1..n]) {
                    if z > print_z - EPSILON {
                        break;
                    }
                    if !area.is_empty() {
                        *area = geom::difference(area, &touching);
                    }
                }
                bottoms.push(arena.len());
                arena.push(b);
            }
        }
        // The support near this layer, and the columns going on down.
        let trimming = grow(&o.slices[l], SCALED_EPSILON);
        let below = geom::difference(&raw, &trimming);
        let grid = Grid::new(&below, &trimming, gp);
        areas[l] = grid.extract(gp.expansion_to_slice(), true);
        projection = grid.extract(grid::EXPANSION_TO_PROPAGATE, true);
    }
    bottoms.reverse();
    (bottoms, areas)
}

/// Orca's `raft_and_intermediate_support_layers`, independent support layer heights: between each pair of contacts
/// (top contacts by their bottoms, bottom contacts by their tops), as few layers as the thickest support layer
/// allows, evenly thick; a top contact takes its height from the layers below it.
fn intermediate_layers(arena: &mut Vec<Gen>, tops: &[usize], bottoms: &[usize], p: &Params) -> Vec<usize> {
    let mut extremes: Vec<usize> = tops.iter().chain(bottoms).copied().collect();
    extremes.sort_by(|&a, &b| {
        let (za, zb) = (arena[a].extreme_z(), arena[b].extreme_z());
        za.partial_cmp(&zb).unwrap().then_with(|| {
            let rank = |g: &Gen| if g.kind == Kind::TopContact { 0 } else { 1 };
            rank(&arena[a]).cmp(&rank(&arena[b]))
        })
    });
    let mut inter: Vec<usize> = Vec::new();
    let first_h = p.first_layer_height;
    let push = |arena: &mut Vec<Gen>, inter: &mut Vec<usize>, bottom: f64, print: f64, height: f64| {
        inter.push(arena.len());
        arena.push(Gen::new(Kind::Intermediate, bottom, print, height));
    };
    let mut first = 0;
    if !extremes.is_empty() && arena[extremes[0]].extreme_z().abs() < EPSILON {
        first = 1;
    }
    for idx in first..extremes.len() {
        let e2 = extremes[idx];
        let mut z2 = arena[e2].extreme_z();
        if (z2 - first_h).abs() < EPSILON {
            if inter.last().is_none_or(|&l| arena[l].print_z < first_h) {
                push(arena, &mut inter, 0.0, first_h, first_h);
            }
            continue;
        }
        let e1 = (idx > first).then(|| extremes[idx - 1]);
        let mut z1 = e1.map_or(0.0, |e| arena[e].extreme_z());
        if z1.abs() < EPSILON {
            push(arena, &mut inter, 0.0, first_h, first_h);
            z1 = first_h;
        }
        let mut dist = z2 - z1;
        if dist == 0.0 {
            continue;
        }
        let mut n = ((dist - EPSILON) / p.max_height).ceil().max(0.0) as usize;
        if n == 0 {
            continue;
        }
        let mut step = dist / n as f64;
        if let Some(e1) = e1
            && arena[e1].kind == Kind::TopContact
            && arena[e1].print_z + p.min_height > arena[e1].bottom_z + step
        {
            let (b, t, h) = (arena[e1].bottom_z, arena[e1].print_z, arena[e1].height);
            push(arena, &mut inter, b, t, h);
            z1 = t;
            dist = z2 - z1;
            n = ((dist - EPSILON) / p.max_height).ceil().max(0.0) as usize;
            if n == 0 {
                continue;
            }
            step = dist / n as f64;
        }
        if arena[e2].kind == Kind::TopContact {
            arena[e2].height = step;
            arena[e2].bottom_z = arena[e2].print_z - step;
            z2 = arena[e2].bottom_z;
            n -= 1;
            if n == 0 {
                continue;
            }
        }
        for i in 0..n {
            if i + 1 == n {
                let bottom = if i == 0 { z1 } else { arena[*inter.last().unwrap()].print_z };
                push(arena, &mut inter, bottom, z2, z2 - bottom);
            } else {
                let bottom = z1 + i as f64 * step;
                push(arena, &mut inter, bottom, bottom + step, step);
            }
        }
    }
    inter
}

/// Orca's `trim_support_layers_by_object`: each support layer cut back from the object's layers it is near in height
/// (from the bottom gap below it to the top gap above): by the XY gap where they overlap in height, else by 0.2 mm,
/// and by 0.2 mm beside a sharp tail.
fn trim_by_object(o: &Object, arena: &mut [Gen], layers: &[usize], tails: &[&Vec<Shape>], p: &Params) {
    let n = o.slices.len();
    let todo: Vec<usize> =
        layers.iter().copied().filter(|&i| !arena[i].polygons.is_empty() && arena[i].print_z >= EPSILON).collect();
    let trimmed: Vec<Shapes> = {
        let arena = &*arena;
        par::map_range(todo.len(), |k| {
            let s = &arena[todo[k]];
            let threshold = s.bottom_print_z() - p.gap_bottom + EPSILON;
            let first = o.print_z[..n].partition_point(|&z| z < threshold);
            let mut trimming: Shapes = Vec::new();
            for i in first..n {
                if o.bottom_z(i) > s.print_z + p.gap_top - EPSILON {
                    break;
                }
                let (oz, oh) = (o.print_z[i], o.height[i]);
                let overlap = (s.print_z - oz).abs() < EPSILON
                    || (s.print_z < oz && s.print_z > oz - oh)
                    || (s.print_z > oz && s.bottom_z < oz - EPSILON);
                let layer_tails: Shapes = tails.get(i).map_or(Vec::new(), |t| t.to_vec());
                for e in &o.slices[i] {
                    let shape = one(e);
                    let tail = !layer_tails.is_empty() && overlaps(&shape, &layer_tails);
                    let d = if tail {
                        SHARP_TAIL_XY_GAP
                    } else if overlap {
                        p.gap_xy
                    } else {
                        NO_OVERLAP_XY_GAP
                    };
                    trimming.extend(square(&shape, d));
                }
            }
            if trimming.is_empty() { s.polygons.clone() } else { geom::difference(&s.polygons, &trimming) }
        })
    };
    for (k, polygons) in todo.into_iter().zip(trimmed) {
        arena[k].polygons = polygons;
    }
}

/// Orca's `generate_base_layers`: each intermediate layer is the support area of the highest object layer at or
/// below it, less the contacts it lies wholly within in height.
fn base_layers(o: &Object, arena: &mut [Gen], tops: &[usize], bottoms: &[usize], inter: &[usize], areas: &[Shapes]) {
    let n = o.slices.len();
    let result: Vec<Shapes> = {
        let arena = &*arena;
        par::map_range(inter.len(), |k| {
            let it = &arena[inter[k]];
            let above = o.print_z[..n].partition_point(|&z| z <= it.print_z + EPSILON);
            let mut trimming: Shapes = Vec::new();
            let idx_top = tops.partition_point(|&t| arena[t].bottom_z <= it.print_z - EPSILON);
            for &t in tops[..idx_top].iter().rev() {
                let t = &arena[t];
                if t.print_z < it.bottom_z + EPSILON {
                    break;
                }
                if it.print_z <= t.print_z + EPSILON && it.bottom_z >= t.bottom_z - EPSILON {
                    trimming.extend(t.polygons.iter().cloned());
                }
            }
            let new: Shapes = if above == 0 {
                let mut new = areas[0].clone();
                let first_z = o.print_z[0];
                for &t in &tops[idx_top..] {
                    if arena[t].print_z > first_z + EPSILON {
                        break;
                    }
                    new.extend(arena[t].polygons.iter().cloned());
                }
                new
            } else {
                areas[above - 1].clone()
            };
            let idx_b = bottoms.partition_point(|&b| arena[b].bottom_print_z() <= it.print_z - EPSILON);
            for &b in bottoms[..idx_b].iter().rev() {
                let b = &arena[b];
                if b.print_z < it.bottom_print_z() + EPSILON {
                    break;
                }
                if it.print_z <= b.print_z + EPSILON && it.bottom_z >= b.bottom_print_z() - EPSILON {
                    trimming.extend(b.polygons.iter().cloned());
                }
            }
            if trimming.is_empty() {
                geom::union_all(&[&new])
            } else {
                geom::difference(&geom::union_all(&[&new]), &trimming)
            }
        })
    };
    for (&i, polygons) in inter.iter().zip(result) {
        arena[i].polygons = polygons;
        arena[i].kind = Kind::Base;
    }
}

/// Orca's `generate_interface_layers`: the base layers right under a top contact and right over a bottom contact (as
/// many as the interface layers asked for, less the contact itself) print as interface where the contact is.
fn interface_layers(
    arena: &mut Vec<Gen>,
    tops: &[usize],
    bottoms: &[usize],
    inter: &[usize],
    p: &Params,
) -> Vec<usize> {
    let num_top = p.top_interfaces.saturating_sub(1);
    let num_bottom = p.bottom_interfaces.saturating_sub(1);
    if inter.is_empty() || (num_top == 0 && num_bottom == 0) {
        return Vec::new();
    }
    let ni = inter.len();
    let made: Vec<Option<(Gen, Shapes)>> = {
        let arena = &*arena;
        par::map_range(ni, |i| {
            let it = &arena[inter[i]];
            let mut top_set: Shapes = Vec::new();
            let mut bottom_set: Shapes = Vec::new();
            if num_top > 0 {
                let top_z = arena[inter[(i + num_top - 1).min(ni - 1)]].print_z;
                let first = tops.partition_point(|&t| arena[t].print_z < it.print_z);
                for &t in &tops[first..] {
                    if arena[t].bottom_z - EPSILON > top_z {
                        break;
                    }
                    top_set.extend(arena[t].polygons.iter().cloned());
                }
            }
            if num_bottom > 0 {
                let bottom_z = arena[inter[(i + 1).saturating_sub(num_bottom)]].bottom_z;
                let first = bottoms.partition_point(|&b| arena[b].print_z < bottom_z - EPSILON);
                for &b in &bottoms[first..] {
                    if arena[b].print_z - EPSILON > it.bottom_z {
                        break;
                    }
                    bottom_set.extend(arena[b].polygons.iter().cloned());
                }
            }
            if top_set.is_empty() && bottom_set.is_empty() {
                return None;
            }
            let kind = if top_set.is_empty() { Kind::BottomInterface } else { Kind::TopInterface };
            let mut both = geom::union_all(&[&bottom_set]);
            both.extend(geom::union_all(&[&top_set]));
            let poly = geom::intersection(&geom::union_all(&[&both]), &it.polygons);
            if poly.is_empty() {
                return None;
            }
            let rest = geom::difference(&it.polygons, &poly);
            let mut g = Gen::new(kind, it.bottom_z, it.print_z, it.height);
            g.polygons = poly;
            Some((g, rest))
        })
    };
    let mut out = Vec::new();
    for (i, m) in made.into_iter().enumerate() {
        if let Some((g, rest)) = m {
            arena[inter[i]].polygons = rest;
            out.push(arena.len());
            arena.push(g);
        }
    }
    out
}

/// Orca's `generate_raft_base` without a raft: the support's first layer grown 2 mm past the columns, in steps,
/// kept off the object's first layer by the first layer's gap, and off the contacts and interfaces printed there.
fn flange(o: &Object, arena: &mut [Gen], tops: &[usize], interfaces: &[usize], inter: &[usize], p: &Params) {
    let contacts = tops.first().copied().filter(|&t| arena[t].print_z <= p.first_layer_height + EPSILON);
    let first_interface = interfaces.first().copied().filter(|&i| arena[i].bottom_print_z() <= EPSILON);
    let base = inter.first().copied().filter(|&i| arena[i].bottom_print_z() <= EPSILON);
    let mut interface_polygons: Shapes = Vec::new();
    for g in [contacts, first_interface].into_iter().flatten() {
        if !arena[g].polygons.is_empty() {
            interface_polygons.extend(square(&arena[g].polygons, SCALED_EPSILON));
        }
    }
    let footprint = o.slices.first().cloned().unwrap_or_default();
    if let Some(b) = base {
        let trimming = square(&footprint, p.gap_xy_first_layer);
        let inflate = (p.first_expansion - EPSILON).max(0.0);
        if inflate > SCALED_EPSILON {
            let steps = 5usize.max((inflate / p.first_width).ceil() as usize);
            let step = inflate / steps as f64;
            for _ in 0..steps {
                arena[b].polygons = geom::difference(&grow(&arena[b].polygons, step), &trimming);
            }
        } else {
            arena[b].polygons = geom::difference(&arena[b].polygons, &trimming);
        }
        if !interface_polygons.is_empty() {
            arena[b].polygons = geom::difference(&arena[b].polygons, &geom::union_all(&[&interface_polygons]));
        }
    }
    if let Some(gap) = p.brim {
        // A brim round the outside: the footprint's outlines grown by the brim's gap, its holes left out.
        let brim = if gap > 0.0 {
            let outlines: Shapes = footprint.iter().map(|s| vec![s[0].clone()]).collect();
            let holes: Shapes = footprint
                .iter()
                .flat_map(|s| s[1..].iter().map(|h| vec![h.iter().rev().copied().collect::<Vec<Pt>>()]))
                .collect();
            geom::difference(&geom::offset_round(&outlines, gap, 0.1), &holes)
        } else {
            footprint
        };
        for g in [base, contacts, first_interface].into_iter().flatten() {
            if !arena[g].polygons.is_empty() {
                arena[g].polygons = geom::difference(&arena[g].polygons, &brim);
            }
        }
    }
}

/// Orca's `generate_support_layers` and `generate_support_toolpaths`: the generator's layers grouped by height into
/// the support's layers, merged where they print alike, and filled.
fn toolpaths(
    o: &Object,
    arena: &mut [Gen],
    tops: &[usize],
    bottoms: &[usize],
    inter: &[usize],
    interfaces: &[usize],
    p: &Params,
) -> Vec<Layer> {
    // Grouped by height: within 0.1 µm of the group's lowest, at their average height and the thinnest one's
    // thickness; groups with nothing in them leave no layer.
    let mut all: Vec<usize> = bottoms.iter().chain(tops).chain(inter).chain(interfaces).copied().collect();
    all.sort_by(|&a, &b| {
        arena[a]
            .print_z
            .partial_cmp(&arena[b].print_z)
            .unwrap()
            .then(arena[b].height.partial_cmp(&arena[a].height).unwrap())
    });
    let mut groups: Vec<(f64, f64)> = Vec::new();
    let mut i = 0;
    while i < all.len() {
        let zmax = arena[all[i]].print_z + EPSILON;
        let mut j = i + 1;
        while j < all.len() && arena[all[j]].print_z <= zmax {
            j += 1;
        }
        let zavg = 0.5 * (arena[all[i]].print_z + arena[all[j - 1]].print_z);
        let mut height = arena[all[i]].height;
        let mut empty = true;
        for &g in &all[i..j] {
            empty &= arena[g].polygons.is_empty();
            arena[g].print_z = zavg;
            height = height.min(arena[g].height);
        }
        if !empty {
            groups.push((zavg, height));
        }
        i = j;
    }
    let arena = &*arena;
    let origin = o.origin;
    par::map_range(groups.len(), |k| {
        let (z, height) = groups[k];
        let at = |list: &[usize]| -> Option<usize> {
            let i = list.partition_point(|&g| arena[g].print_z < z - EPSILON);
            list.get(i).copied().filter(|&g| arena[g].print_z < z + EPSILON)
        };
        layer_paths(arena, z, height, [at(bottoms), at(tops), at(interfaces), at(inter)], origin, p)
    })
}

/// One support layer's extrusions from the generator layers at its height (bottom contact, top contact, interface,
/// base).
fn layer_paths(arena: &[Gen], z: f64, height: f64, found: [Option<usize>; 4], origin: (f64, f64), p: &Params) -> Layer {
    // Each with its polygons (merges change them) and, where they were cut down, what is left to print.
    struct Item {
        layer: usize,
        polygons: Shapes,
        to_extrude: Option<Shapes>,
        paths: Vec<crate::support::Item>,
    }
    let make = |g: Option<usize>| {
        g.filter(|&g| !arena[g].polygons.is_empty()).map(|layer| Item {
            layer,
            polygons: arena[layer].polygons.clone(),
            to_extrude: None,
            paths: Vec::new(),
        })
    };
    let [mut bottom, mut top, mut interface, base] = found.map(make);
    let could_merge = |a: &Option<Item>, b: &Option<Item>| match (a, b) {
        (Some(a), Some(b)) => (arena[a.layer].height - arena[b.layer].height).abs() < EPSILON,
        _ => false,
    };
    let merge = |into: &mut Option<Item>, from: &mut Option<Item>| {
        let (Some(a), Some(b)) = (into.as_mut(), from.take()) else { return };
        if let Some(rest) = b.to_extrude {
            let mut mine = a.to_extrude.take().unwrap_or_else(|| a.polygons.clone());
            mine.extend(rest);
            a.to_extrude = Some(geom::union_all(&[&mine]));
        } else if let Some(mine) = a.to_extrude.as_mut() {
            mine.extend(b.polygons.iter().cloned());
            *mine = geom::union_all(&[&*mine]);
        }
        a.polygons.extend(b.polygons);
        a.polygons = geom::union_all(&[&a.polygons]);
    };
    if p.top_interfaces > 0 && could_merge(&top, &interface) {
        merge(&mut top, &mut interface);
    }
    // Organic trees' bottom contacts print nothing: nothing merges into them.
    if p.organic {
    } else if could_merge(&bottom, &top) {
        let mut b = bottom.take();
        merge(&mut top, &mut b);
    } else if could_merge(&bottom, &interface) {
        let bottom_kind = interface.as_ref().map(|i| arena[i.layer].kind) == Some(Kind::BottomInterface);
        if bottom_kind {
            merge(&mut bottom, &mut interface);
        } else if let (Some(b), Some(i)) = (bottom.as_mut(), interface.as_ref()) {
            let mine = b.to_extrude.take().unwrap_or_else(|| b.polygons.clone());
            let theirs = i.to_extrude.clone().unwrap_or_else(|| i.polygons.clone());
            b.to_extrude = Some(geom::difference(&mine, &theirs));
        }
    }
    let path = |role: Role, points: Vec<Pt>, width: f64, h: f64| Path {
        role,
        points: geom::simplify_line(&points, RESOLUTION),
        width,
        height: h,
    };
    // Interfaces: the support pattern a quarter turn from the columns', denser.
    let interface_angle = (std::f32::consts::FRAC_PI_2 + std::f32::consts::FRAC_PI_2) as f64;
    let extrude_interface = |item: &mut Option<Item>, bottom_density: bool| {
        let Some(item) = item.as_mut() else { return };
        let area = item.to_extrude.clone().unwrap_or_else(|| item.polygons.clone());
        if area.is_empty() {
            return;
        }
        let g = &arena[item.layer];
        let density = if bottom_density { p.bottom_interface_density } else { p.top_interface_density };
        for shape in &geom::union_all(&[&area]) {
            for line in base_support::fill(shape, interface_angle, origin, p.spacing, density) {
                item.paths.push(crate::support::Item::Path(path(Role::SupportInterface, line, p.width, g.height)));
            }
        }
    };
    extrude_interface(&mut top, false);
    if !p.organic {
        extrude_interface(&mut bottom, true);
    }
    let interface_bottom = interface.as_ref().is_some_and(|i| arena[i.layer].kind == Kind::BottomInterface);
    extrude_interface(&mut interface, interface_bottom);
    let mut base = base;
    let mut first = false;
    if let Some(item) = base.as_mut() {
        let g = &arena[item.layer];
        let area = item.to_extrude.clone().unwrap_or_else(|| item.polygons.clone());
        if !area.is_empty() {
            if g.bottom_z < EPSILON {
                // The flange: a loop round each part, half a line in, then rectilinear lines along Y, dense.
                first = true;
                let angle = (std::f32::consts::FRAC_PI_2 + std::f32::consts::FRAC_PI_2) as f64;
                let w = p.first_width;
                let h = p.first_layer_height;
                let sp = p.first_spacing;
                let closed = geom::offset(&geom::offset(&area, SCALED_EPSILON), -(SCALED_EPSILON + 0.5 * w));
                for shape in &closed {
                    let mut group: Vec<Path> = Vec::new();
                    for (k, contour) in shape.iter().enumerate() {
                        let mut pl: Vec<Pt> = contour.clone();
                        pl.push(pl[0]);
                        if k > 0 {
                            pl.reverse();
                        }
                        clip_end(&mut pl, 0.15 * sp * geom::SCALE);
                        if pl.len() >= 2 {
                            group.push(path(Role::Support, pl, w, h));
                        }
                    }
                    for inner in &geom::offset(&one(shape), -0.4 * sp) {
                        for line in monotonic::rectilinear(inner, angle, origin, sp, p.first_density) {
                            group.push(path(Role::Support, line, w, h));
                        }
                    }
                    if !group.is_empty() {
                        item.paths.push(crate::support::Item::Fixed(group));
                    }
                }
            } else if p.organic {
                item.paths.extend(tree_paths(&area, g.height, p));
            } else {
                let angle = std::f32::consts::FRAC_PI_2 as f64;
                for shape in &geom::closing(&area, SCALED_EPSILON) {
                    for line in base_support::fill(shape, angle, origin, p.spacing, p.density) {
                        item.paths.push(crate::support::Item::Path(path(Role::Support, line, p.width, g.height)));
                    }
                }
            }
        }
    }
    // Thickest first, as Orca prints them; their areas are where travels needn't retract.
    let mut nonempty: Vec<Item> = [bottom, top, interface, base].into_iter().flatten().collect();
    nonempty.sort_by(|a, b| arena[b.layer].height.partial_cmp(&arena[a.layer].height).unwrap());
    let mut polys: Shapes = Vec::new();
    let mut items = Vec::new();
    for item in nonempty {
        polys.extend(item.polygons);
        items.extend(item.paths);
    }
    let islands = geom::union_all(&[&polys]);
    Layer { print_z: z, height, items, islands, first }
}

/// Orca's `tree_supports_generate_paths`: each of a layer's branch islands as a loop half a line in from its edge,
/// anticlockwise, starting with an anchor cut from a second loop a line further in and ending where it starts, so
/// that the loop's seam sits on the anchor. An island over the double-wall area gets a wall outside that loop too,
/// printed after it. Nothing fills the islands.
fn tree_paths(area: &Shapes, height: f64, p: &Params) -> Vec<Item> {
    let (w, sp) = (p.width, p.spacing);
    let to_units = |mm: f64| mm * geom::SCALE;
    let clip = to_units(0.15 * sp);
    let anchor_length = to_units(6.0 * sp);
    let path = |points: Vec<Pt>| Path {
        role: Role::Support,
        points: geom::simplify_line(&points, RESOLUTION),
        width: w,
        height,
    };
    let closed = geom::offset_c2(
        &geom::offset_c2(area, SCALED_EPSILON, geom::Join::Miter(3.0)),
        -(SCALED_EPSILON + 0.5 * w),
        geom::Join::Miter(3.0),
    );
    let mut out = Vec::new();
    for e in &closed {
        let mut group: Option<Vec<Path>> = None;
        let mut regions: Shapes = vec![e.clone()];
        if p.double_wall_area > 0.0 && geom::shape_area_mm2(e) > p.double_wall_area {
            let mut g = Vec::new();
            let level2 = geom::offset_c2(
                &geom::offset_c2(&vec![e.clone()], -1.5 * w, geom::Join::Miter(3.0)),
                0.5 * w,
                geom::Join::Miter(3.0),
            );
            if !level2.is_empty() {
                regions = level2;
                // The outer wall: each contour from its first point round to it, holes turned anticlockwise.
                for (k, contour) in e.iter().enumerate() {
                    let mut pl = contour.clone();
                    pl.push(pl[0]);
                    if k > 0 {
                        pl.reverse();
                    }
                    clip_end(&mut pl, clip);
                    g.push(path(pl));
                }
            }
            group = Some(g);
        }
        for region in &regions {
            let candidates = anchor_candidates(region, w);
            for (idx_loop, contour) in region.iter().enumerate() {
                let mut pl = contour.clone();
                if idx_loop == 0 {
                    pl.reverse();
                }
                pl.push(pl[0]);
                clip_end(&mut pl, clip);
                if pl.len() < 2 {
                    continue;
                }
                let seam = pl[pl.len() - 1];
                let (sx, sy) = (seam.x as f64, seam.y as f64);
                let tag = idx_loop as i32;
                // The nearest point of the candidates made from this contour.
                let mut best: Option<(usize, usize, (f64, f64), f64)> = None;
                let mut d2min = f64::MAX;
                for (ci, cand) in candidates.iter().enumerate() {
                    let m = cand.len();
                    for i in 0..m {
                        let j = (i + 1) % m;
                        let (pi, zi) = cand[i];
                        let (pj, zj) = cand[j];
                        if zi != tag && zj != tag {
                            continue;
                        }
                        let (vx, vy) = ((pj.x - pi.x) as f64, (pj.y - pi.y) as f64);
                        let l2 = vx * vx + vy * vy;
                        let t = if l2 == 0.0 { 0.0 } else { ((sx - pi.x as f64) * vx + (sy - pi.y as f64) * vy) / l2 };
                        let t = t.clamp(0.0, 1.0);
                        if (zi == tag || t > EPSILON) && (zj == tag || t < 1.0 - EPSILON) {
                            let f = (pi.x as f64 + vx * t, pi.y as f64 + vy * t);
                            let d2 = (f.0 - sx).powi(2) + (f.1 - sy).powi(2);
                            if d2 < d2min {
                                d2min = d2;
                                best = Some((ci, i, f, t));
                            }
                        }
                    }
                }
                if let Some((ci, start, f, t)) = best.filter(|_| d2min < to_units(3.0 * w).powi(2)) {
                    // An anchor along the candidate from there (both run clockwise here), Orca's length less the
                    // way to it (and, as Orca has it, not less the rest of its first edge).
                    let cand = &candidates[ci];
                    let m = cand.len();
                    let trunc = |x: f64, y: f64| geom::pt(x as i32, y as i32);
                    pl.push(trunc(f.0, f.1));
                    let mut remaining = anchor_length - (sx - f.0).hypot(sy - f.1);
                    let mut i = start;
                    let mut j = (i + 1) % m;
                    let mut pi = (cand[i].0.x as f64, cand[i].0.y as f64);
                    let mut pj = (cand[j].0.x as f64, cand[j].0.y as f64);
                    let (mut vx, mut vy) = (pj.0 - pi.0, pj.1 - pi.1);
                    let mut l = vx.hypot(vy);
                    if remaining < (1.0 - t) * l {
                        pl.push(trunc(f.0 + vx * (remaining / l), f.1 + vy * (remaining / l)));
                    } else {
                        pl.push(cand[j].0);
                        pi = pj;
                        i = j;
                        while cand[i].1 == tag && remaining > 0.0 {
                            j = (i + 1) % m;
                            pj = (cand[j].0.x as f64, cand[j].0.y as f64);
                            (vx, vy) = (pj.0 - pi.0, pj.1 - pi.1);
                            l = vx.hypot(vy);
                            if i == start {
                                break;
                            }
                            if remaining <= l {
                                pl.push(trunc(pi.0 + vx * (remaining / l), pi.1 + vy * (remaining / l)));
                                break;
                            }
                            pl.push(cand[j].0);
                            remaining -= l;
                            i = j;
                            pi = pj;
                        }
                    }
                }
                pl.reverse();
                match group.as_mut() {
                    Some(g) => g.push(path(pl)),
                    None => out.push(Item::Fixed(vec![path(pl)])),
                }
            }
        }
        if let Some(mut g) = group.filter(|g| !g.is_empty()) {
            // The inner loops first, then the wall outside them.
            g.reverse();
            out.push(Item::Fixed(g));
        }
    }
    out
}

/// Where a tree loop's anchor may run (`shrink_expolygon_with_contour_idx`): the island's outline a line further in
/// (mitred, Orca's 1.2 raised to 2), less its holes grown as much, all clockwise, each point tagged with the contour
/// it came from (0 the outline, 1 + k the hole k) or -1 where they cross. None where nothing is left.
fn anchor_candidates(region: &Shape, w: f64) -> Vec<Vec<(Pt, i32)>> {
    let ccw = |c: &Vec<Pt>| -> Vec<Pt> {
        let mut c = c.clone();
        if geom::area2(&c) < 0 {
            c.reverse();
        }
        c
    };
    let join = geom::Join::Miter(1.2);
    let contours = geom::offset_c2(&vec![vec![ccw(&region[0])]], -w, join);
    if contours.is_empty() {
        return Vec::new();
    }
    let mut holes: Vec<(Shapes, i32)> = Vec::new();
    for (k, hole) in region.iter().enumerate().skip(1) {
        let grown = geom::offset_c2(&vec![vec![ccw(hole)]], w, join);
        if !grown.is_empty() {
            holes.push((grown, k as i32));
        }
    }
    let cw = |c: &Vec<Pt>| -> Vec<Pt> {
        let mut c = c.clone();
        if geom::area2(&c) > 0 {
            c.reverse();
        }
        c
    };
    if holes.is_empty() {
        return contours.iter().flatten().map(|c| cw(c).into_iter().map(|p| (p, 0)).collect()).collect();
    }
    let all_holes: Shapes = holes.iter().flat_map(|(h, _)| h.iter().cloned()).collect();
    let left = geom::difference(&contours, &geom::union_all(&[&all_holes]));
    if left.is_empty() {
        return Vec::new();
    }
    // Points keep the contour they come from where they are one of its points (the outline's first).
    let mut from: std::collections::HashMap<(i32, i32), i32> = std::collections::HashMap::new();
    for (h, k) in &holes {
        for q in h.iter().flatten().flatten() {
            from.insert((q.x, q.y), *k);
        }
    }
    for q in contours.iter().flatten().flatten() {
        from.insert((q.x, q.y), 0);
    }
    left.iter()
        .flatten()
        .map(|c| cw(c).into_iter().map(|q| (q, from.get(&(q.x, q.y)).copied().unwrap_or(-1))).collect())
        .collect()
}

/// Orca's `Polyline::clip_end`: `distance` (units) off the end.
fn clip_end(line: &mut Vec<Pt>, mut distance: f64) {
    while distance > 0.0 {
        let Some(last) = line.pop() else { return };
        let Some(&prev) = line.last() else { return };
        let (vx, vy) = ((prev.x - last.x) as f64, (prev.y - last.y) as f64);
        let l2 = vx * vx + vy * vy;
        if l2 > distance * distance {
            let t = distance / l2.sqrt();
            line.push(geom::pt((last.x as f64 + vx * t) as i32, (last.y as f64 + vy * t) as i32));
            return;
        }
        distance -= l2.sqrt();
    }
}
