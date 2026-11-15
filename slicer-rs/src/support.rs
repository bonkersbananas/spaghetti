//! Orca's normal supports (`PrintObjectSupportMaterial`, "normal(auto)" in its grid and snug styles), for one object
//! at a time, ported from OrcaSlicer 2.5's `SupportMaterial.cpp` and `SupportCommon.cpp` in its steps:
//!
//! 1. Overhangs: where a layer reaches more than the support angle beyond the layer below (31° for 30, as Orca makes
//!    it inclusive), and "sharp tails", small islands that start in the air, grown up while they stay small. Small
//!    clusters of overhang that are neither are dropped.
//! 2. Top contacts: a layer of interface the top gap under each overhang, its area stretched onto the support grid
//!    (`grid.rs`), dense only where the overhang is steep enough to need it; or, snug, the area itself closed across
//!    gaps and rounded off, all of it dense.
//! 3. Columns: the contacts projected down layer by layer, re-gridded (or, snug, closed and rounded off again) and cut
//!    by each layer of the object, to the plate or to the object's top surfaces, where a bottom contact layer of
//!    interface sits the bottom gap above.
//! 4. The support's own layers between those contacts, as thick as the printer allows (0.28 mm on the X2D) and
//!    evened out, so most of them fall between the object's layers; or, in step with the object's layers (the
//!    support's own heights off, as Orca turns them with a prime tower: `synchronize_layers`), the contacts on the
//!    object's layers the gaps reach, rounded to whole layers, and the object's layers between them.
//! 5. Every layer cut back from the object by the XY gap (less beside sharp tails and layers it doesn't overlap), one
//!    more layer of interface next to each contact, and on the plate a flange 2 mm wider than the columns.
//! 6. Toolpaths: interfaces and columns as Orca's support pattern (`base_support.rs`), the flange as a loop round
//!    rectilinear lines.
//!
//! A raft (`raft.rs`) is support too: its contact layer the object's first layer, grown, and the layers under it
//! (`raft_base`), printed first (`raft_paths`); organic trees make theirs without the grid (`raft_alone`).
//!
//! On the plate only (`support_on_build_plate_only`), nothing stands on the object: whatever any layer below covers
//! is cut from the overhangs, the contacts and the columns, and no bottom contact is made (Orca's
//! `buildplate_covered`).
//!
//! What it leaves out: Orca's thinning of a column's layer where it overlaps a contact in height
//! (`modulate_extrusion_by_overlapping_layers`) and its arcs; supports are refused painted on, and with the settings
//! `config.rs` lists.

use crate::base_support;
use crate::config::{RaftMaker, Settings};
use crate::fmath::Hyp;
use crate::geom::{self, Pt, Shape, Shapes};
use crate::grid::{self, Grid};
use crate::monotonic;
use crate::par;
use crate::raft::Raft;
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
/// mm: support paths are simplified to this, the tolerance Orca fits them to when it fits arcs (`SCALED_SUPPORT_RESOLUTION`,
/// the profile's default). We write the chords, not the arcs: round a tree's circles they print 0.4 % less plastic.
const RESOLUTION: f64 = 0.0375;

/// What a brim keeps the first layer's support out of: the object's footprint, its outlines grown by `gap` where a
/// brim goes round them (`outer`), its holes shrunk by it where one goes inside them (`inner`).
#[derive(Clone, Copy, Debug, PartialEq)]
struct BrimTrim {
    outer: bool,
    inner: bool,
    gap: f64,
}

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
    /// mm: the gaps over and under the support, as Orca's slicing parameters keep them (whole layers when the
    /// support's layers are in step with the object's).
    gap_top: f64,
    gap_bottom: f64,
    /// The support's layers in step with the object's (`independent_support_layer_height` off, as a prime tower
    /// turns it): Orca's `synchronize_layers`.
    synchronize: bool,
    gap_xy: f64,
    gap_xy_first_layer: f64,
    remove_small_overhangs: bool,
    top_interfaces: usize,
    bottom_interfaces: usize,
    /// How many of those print as base interface (`Settings::base_interface_layers`).
    top_base_interfaces: usize,
    bottom_base_interfaces: usize,
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
    /// How the brim keeps the first layer's support off: not at all (no brim), or by the object's footprint, its
    /// outlines grown by the brim's gap where a brim goes round them and its holes shrunk by it where one goes inside
    /// them (Orca's `trim_support_layers_by_object`).
    brim: Option<BrimTrim>,
    grid_resolution: f64,
    base_spacing: f64,
    /// Orca's organic trees (`smsTreeOrganic`), whose layers come from `tree.rs`: their bottom contacts aren't printed,
    /// their interfaces are rounded off, and their branches print as anchored loops.
    organic: bool,
    /// Orca's snug style of normal supports (`smsSnug`): the support follows the overhangs, closed and rounded off,
    /// rather than snapping to the grid; its interfaces are rounded off too, and none is left out under gentle slopes.
    snug: bool,
    /// Radians added to the interfaces' direction: a quarter of a half turn back for snug supports whose interface
    /// pattern is set to rectilinear (Orca's `support_interface_angle`), else none.
    interface_turn: f64,
    /// mm²: a tree branch's island larger than this gets a second wall (`tree_branch_diameter_double_wall_area`).
    double_wall_area: f64,
    /// Whether supports are on: with them off, the generator makes only the raft, if any.
    enabled: bool,
    /// Automatic supports (`normal(auto)`), or only where they are painted on (`normal(manual)`, Orca's `stNormal`).
    auto: bool,
    /// Supports on the plate only (`support_on_build_plate_only`, with supports on): nothing stands on the object.
    plate_only: bool,
    /// The raft under the object (`raft.rs`), how far its contact layer reaches past the object's first layer, and
    /// the density of its interface (`support_interface_spacing`, as the top interfaces' but never the base's).
    raft: Option<Raft>,
    raft_expansion: f64,
    raft_interface_density: f64,
    /// Whether the raft's base layers print a loop round their lines (Orca's `with_sheath`, which its organic trees
    /// turn on).
    raft_sheath: bool,
}

impl Params {
    pub fn new(s: &Settings) -> Params {
        let sp = &s.support;
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
            gap_top: s.support_gaps().0,
            gap_bottom: s.support_gaps().1,
            synchronize: !sp.independent_layer_height,
            gap_xy: sp.xy_distance,
            gap_xy_first_layer: sp.first_layer_xy_distance,
            remove_small_overhangs: sp.remove_small_overhang,
            top_interfaces: sp.top_interface_layers,
            bottom_interfaces: sp.bottom_interface_layers,
            top_base_interfaces: s.base_interface_layers().0,
            bottom_base_interfaces: s.base_interface_layers().1,
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
                // An object on a raft has no brim (Orca's `has_brim`).
                _ if sp.raft_layers > 0 => None,
                "auto_brim" | "" => Some(BrimTrim { outer: false, inner: false, gap: 0.0 }),
                kind if s.brim_width > 0.0 && kind != "no_brim" => Some(BrimTrim {
                    outer: matches!(kind, "outer_only" | "outer_and_inner"),
                    inner: matches!(kind, "inner_only" | "outer_and_inner"),
                    gap: s.brim_object_gap,
                }),
                _ => None,
            },
            grid_resolution: support_spacing,
            base_spacing: sp.base_spacing,
            organic: sp.organic(),
            snug: sp.snug(),
            interface_turn: if sp.snug() && sp.interface_pattern == "rectilinear" {
                -(std::f32::consts::FRAC_PI_4 as f64)
            } else {
                0.0
            },
            double_wall_area: match sp.wall_count {
                0 => 0.25 * 25.0 * std::f64::consts::PI,
                1 => f64::MAX,
                _ => 1e-13,
            },
            enabled: s.enable_support,
            auto: !sp.kind.contains("manual"),
            plate_only: s.enable_support && sp.on_build_plate_only,
            raft: Raft::of(s),
            raft_expansion: sp.raft_expansion,
            raft_interface_density: (spacing / (sp.interface_spacing + spacing)).min(1.0),
            raft_sheath: if s.enable_support { sp.organic() } else { sp.raft_maker() == RaftMaker::OrganicTrees },
        }
    }

    /// mm between the columns' lines (`support_base_pattern_spacing`).
    fn base_spacing(&self) -> f64 {
        self.base_spacing
    }

    /// mm: the thinnest and thickest support layer.
    pub fn layer_bounds(&self) -> (f64, f64) {
        (self.min_height, self.max_height)
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
    /// mm: its bounding box's size, which the classic trees' grid of tips spans.
    pub size: (f64, f64),
    /// Its painted supports on each layer (`segment::support_slabs`, Orca's `project_and_append_custom_facets`): where
    /// they enforce support, and where they block it; each empty for an object with none of that kind.
    pub enforcers: Vec<Shapes>,
    pub blockers: Vec<Shapes>,
    /// Its upright enforced triangles, each with the layer it is on, which Orca's trees give a tip each.
    pub upright: Vec<(usize, crate::segment::Upright)>,
}

impl Object<'_> {
    fn bottom_z(&self, l: usize) -> f64 {
        self.print_z[l] - self.height[l]
    }

    /// Where layer `l`'s painted supports enforce support, if they do.
    fn enforcer(&self, l: usize) -> Option<&Shapes> {
        self.enforcers.get(l).filter(|e| !e.is_empty())
    }

    /// Its painted supports as the trees take them.
    pub fn painted(&self) -> crate::tree::overhangs::Painted<'_> {
        crate::tree::overhangs::Painted { enforcers: &self.enforcers, blockers: &self.blockers, upright: &self.upright }
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

/// Which of a support layer's extrusions an item is (Orca's role of an extrusion, or of a collection of them): the
/// base's, the interface's, or both in one group (`erMixed`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part {
    Base,
    Interface,
    Both,
}

/// How a filament prints an object's support on a layer (Orca's `process_layer`): which of its extrusions (`Both`: all
/// of them), and whether straight after the change to it, as what the filament before flushes into.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Pass {
    pub part: Part,
    pub flush: bool,
}

impl Item {
    pub fn paths(&self) -> &[Path] {
        match self {
            Item::Path(path) => std::slice::from_ref(path),
            Item::Fixed(group) => group,
        }
    }

    pub fn part(&self) -> Part {
        let of = |p: &Path| if p.role == Role::SupportInterface { Part::Interface } else { Part::Base };
        let paths = self.paths();
        let first = paths.first().map_or(Part::Base, of);
        if paths.iter().all(|p| of(p) == first) { first } else { Part::Both }
    }

    /// mm³ of plastic (Orca's `total_volume`): each path's flow times its length, added up in order.
    pub fn volume(&self) -> f64 {
        self.paths()
            .iter()
            .map(|p| {
                let length: f64 = p.points.windows(2).map(|w| geom::dist(w[0], w[1])).sum();
                Settings::mm3_per_mm(p.width, p.height) * length / geom::SCALE
            })
            .sum()
    }
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
    /// Whether it is among the object's first support layers, as many as the raft has (Orca's `raft_layer`, whose
    /// cooling it doesn't hold for the object layer above: it cools each on its own).
    pub raft: bool,
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
    /// The support pattern at the interface's spacing, in the base's filament (Orca's base interface layers), where
    /// the interface has a filament of its own.
    BaseInterface,
    /// A raft's layers under its contact layer: its base (the first layer among them), and its interface.
    RaftBase,
    RaftInterface,
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
    /// What of a top contact painted supports enforce (Orca's `enforcer_polygons`), projected down on its own.
    enforcer: Shapes,
}

impl Gen {
    fn new(kind: Kind, bottom_z: f64, print_z: f64, height: f64) -> Gen {
        Gen {
            kind,
            print_z,
            bottom_z,
            height,
            polygons: Vec::new(),
            contact: Vec::new(),
            overhang: Vec::new(),
            enforcer: Vec::new(),
        }
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

/// `grow` with square corners (Orca's `SUPPORT_SURFACES_OFFSET_PARAMETERS`, `jtSquare`), by Orca 2.5's own offsets.
fn square(shapes: &Shapes, d: f64) -> Shapes {
    if shapes.is_empty() { Vec::new() } else { geom::offset_c2(shapes, d, geom::Join::Square) }
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

/// Orca's interfaces with smooth supports (snug ones and trees, `regularize` in `generate_interface_layers`): the
/// areas grown by the islands' smallest radius for the interface's density, closed, and rounded off outward. Snug
/// supports take Orca 2.5's own offsets (`offset_c2`); the trees, matched on box models, keep Clipper1's.
fn regularize(polys: Shapes, density: f64, p: &Params) -> Shapes {
    if polys.is_empty() {
        return polys;
    }
    let smoothing = (p.spacing * 1e6) as i64 as f64 * 1.5;
    let island = (p.spacing * 1e6) as i64 as f64 / density;
    let (grow_by, shrink_by) = (((smoothing + island) as f32 as f64) / 1e6, (smoothing as f32 as f64) / 1e6);
    let closed = if p.snug {
        let grown = geom::offset_c2(&polys, grow_by, geom::Join::Square);
        geom::offset_c2(&grown, -shrink_by, geom::Join::Square)
    } else {
        let grown =
            geom::offset_square(&geom::union_nonzero(&polys.into_iter().flatten().collect::<Vec<_>>()), grow_by);
        geom::offset_square(&grown, -shrink_by)
    };
    crate::tree::smooth::smooth_outward(&closed, smoothing as i64)
}

/// Orca's snug support area (`SupportGridPattern::extract_support` in its snug style): the areas closed by 2 mm
/// (`support_closing_radius`), with square corners, and rounded off outward by a support line's spacing. Nothing is
/// cut by the object here.
fn snug(polys: &Shapes, p: &Params) -> Shapes {
    if polys.is_empty() {
        return Vec::new();
    }
    let closing = 2e6_f32 as f64 / 1e6;
    let closed = geom::offset_c2(&geom::offset_c2(polys, closing, geom::Join::Square), -closing, geom::Join::Square);
    crate::tree::smooth::smooth_outward(&closed, (p.spacing / 1e-6) as f32 as i64)
}

/// Orca's `remove_sticks` and `remove_degenerate` on a projection: points where an outline doubles straight back on
/// itself, or repeats, go; an outline left with under three points goes, and a shape whose outer one went goes whole.
fn remove_sticks(shapes: &mut Shapes) {
    // Orca's `is_stick`: p3 turns straight back past p2 towards p1, or p2 repeats a neighbour.
    let stick = |a: Pt, b: Pt, c: Pt| {
        let (v1, v2) =
            ((b.x as i64 - a.x as i64, b.y as i64 - a.y as i64), (c.x as i64 - b.x as i64, c.y as i64 - b.y as i64));
        let dir = v1.0 * v2.0 + v1.1 * v2.1;
        if dir > 0 {
            return false;
        }
        let l1 = (v1.0 as f64).powi(2) + (v1.1 as f64).powi(2);
        let l2 = (v2.0 as f64).powi(2) + (v2.1 as f64).powi(2);
        if dir == 0 {
            return l1 == 0.0 || l2 == 0.0;
        }
        let cross = v1.0 as f64 * v2.1 as f64 - v2.0 as f64 * v1.1 as f64;
        // Orca's EPSILON² in nm², here in our units (0.1 µm): collinear to the last bit.
        cross * cross / l1.max(l2) < (EPSILON / 100.0) * (EPSILON / 100.0)
    };
    for shape in shapes.iter_mut() {
        for c in shape.iter_mut() {
            if c.len() < 3 {
                continue;
            }
            let mut j = 1;
            for i in 1..c.len() - 1 {
                if !stick(c[j - 1], c[i], c[i + 1]) {
                    c[j] = c[i];
                    j += 1;
                }
            }
            j += 1;
            if j < c.len() {
                let last = *c.last().unwrap();
                c[j - 1] = last;
                c.truncate(j);
            }
            while c.len() >= 3 && stick(c[c.len() - 2], c[c.len() - 1], c[0]) {
                c.pop();
            }
            while c.len() >= 3 && stick(c[c.len() - 1], c[0], c[1]) {
                c.remove(0);
            }
        }
        // `remove_degenerate`: outlines of under three points go.
        if shape.first().is_some_and(|outer| outer.len() < 3) {
            shape.clear();
        } else {
            shape.retain(|c| c.len() >= 3);
        }
    }
    shapes.retain(|shape| !shape.is_empty());
}

/// The supports of one object, layer by layer, bottom up.
pub fn generate(o: &Object, p: &Params) -> Vec<Layer> {
    let n = o.slices.len();
    if n == 0 || (n < 2 && p.raft.is_none()) {
        return Vec::new();
    }
    let origin = ((o.origin.0 * 100.0).round() as i64, (o.origin.1 * 100.0).round() as i64);
    let gp = p.grid(origin);
    // With supports off, a raft alone: only the first layer is looked at.
    let looked = if p.enabled { n } else { 1 };
    // On the plate only, what the layers below each layer cover, which no support may stand on.
    let covered = if p.plate_only { buildplate_covered(o) } else { Vec::new() };
    let covered_at = |l: usize| covered.get(l).filter(|c| !c.is_empty());
    // Painted blockers, grown a little (Orca's `SupportAnnotations`): they come as strips between two slices, which
    // would leave narrow scraps of the overhangs they cut.
    let blockers: Vec<Shapes> = o
        .blockers
        .iter()
        .map(|b| if b.is_empty() { Vec::new() } else { geom::offset_c2(b, 0.1, geom::Join::Miter(3.0)) })
        .collect();
    let blocker_at = |l: usize| blockers.get(l).filter(|b| !b.is_empty());

    // 1. Overhangs; on a raft, the first layer's whole slice, whose small islands are sharp tails.
    let mut detected: Vec<Detected> = par::map_range(n, |l| {
        if l == 0 {
            if p.raft.is_some() { raft_overhangs(o) } else { Detected::default() }
        } else if l < looked {
            detect_overhangs(o, l, p, covered_at(l), blocker_at(l))
        } else {
            Detected::default()
        }
    });
    // Sharp tails grow up only with automatic supports.
    if p.enabled && p.auto {
        grow_sharp_tails(o, &mut detected, p, &blockers);
    }
    let mut present = vec![false; n];
    for (l, d) in detected.iter().enumerate() {
        // A layer with painted enforcers may get a contact of them alone.
        present[l] = !d.overhangs.is_empty() || (l > 0 && l < looked && o.enforcer(l).is_some());
    }
    if p.remove_small_overhangs {
        remove_small_overhangs(&mut detected, p);
    }

    // 2. Top contacts.
    let mut arena: Vec<Gen> = Vec::new();
    let contacts: Vec<Option<Gen>> = par::map_range(n, |l| {
        if !present[l] {
            return None;
        }
        match (l, p.raft) {
            (0, Some(r)) => Some(raft_contact(o, &r, p, &gp)),
            (0, None) => None,
            _ => contact_layer(o, l, &detected[l], p, &gp, covered_at(l), o.enforcer(l)),
        }
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
    let (bottoms, support_areas) = columns(o, &mut arena, &tops, p, &gp, &covered);
    trim_by_object(o, &mut arena, &bottoms, &tails, p);

    // 4. The support's own layers.
    let inter = intermediate_layers(o, &mut arena, &tops, &bottoms, p);

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
    let (interfaces, base_interfaces) = interface_layers(&mut arena, &tops, &bottoms, &inter, p);
    let rafts = match p.raft {
        Some(r) if r.layers() > 1 => raft_base(&mut arena, &tops, &interfaces, &base_interfaces, &inter, &r, p),
        _ => {
            flange(o, &mut arena, &tops, &interfaces, &base_interfaces, &inter, p);
            Vec::new()
        }
    };

    // 6. Layers and toolpaths: the raft's layers under its contact layer, then the rest.
    let mut layers = raft_paths(&arena, &rafts, &[], o.origin, p);
    layers.extend(toolpaths(o, &mut arena, &tops, &bottoms, &inter, &interfaces, &base_interfaces, p));
    mark_raft(&mut layers, p);
    layers
}

/// Marks the object's first support layers, as many as the raft has: Orca's G-code cools each of them on its own
/// (`cooling_buffer_flush` at a `raft_layer`, which it tells by the support layer's index, whatever it prints).
fn mark_raft(layers: &mut [Layer], p: &Params) {
    let n = p.raft.map_or(0, |r| r.layers());
    for layer in layers.iter_mut().take(n) {
        layer.raft = true;
    }
}

/// One object's raft as Orca's organic trees make it with supports off, when they have no trees to grow
/// (`generate_raft_contact`): its contact layer the object's first layer grown by `raft_expansion` as it is, not put on
/// the support grid as the normal generator puts it, and the layers under it as `raft_base` makes them.
pub fn raft_alone(o: &Object, p: &Params) -> Vec<Layer> {
    let Some(r) = p.raft else { return Vec::new() };
    let Some(footprint) = o.slices.first().filter(|s| !s.is_empty()) else { return Vec::new() };
    let mut g = Gen::new(Kind::TopContact, r.interface_top_z, r.contact_top_z, r.contact_height);
    g.polygons = if p.raft_expansion > 0.0 {
        geom::offset_c2(footprint, p.raft_expansion, geom::Join::Miter(3.0))
    } else {
        footprint.clone()
    };
    let mut arena = vec![g];
    let tops = [0];
    let rafts = if r.layers() > 1 { raft_base(&mut arena, &tops, &[], &[], &[], &r, p) } else { Vec::new() };
    let mut layers = raft_paths(&arena, &rafts, &[], o.origin, p);
    layers.extend(toolpaths(o, &mut arena, &tops, &[], &[], &[], &[], p));
    mark_raft(&mut layers, p);
    layers
}

/// One object's organic trees as drawn (`tree.rs`), on the support's layers (the object's): each layer's branches
/// (Orca's base layers), the bottom contacts where branches rest on the model, and the roofs' contact and interface
/// layers.
pub struct TreeLayers {
    pub base: Vec<Shapes>,
    pub bottom_contacts: Vec<Shapes>,
    pub contacts: Vec<Shapes>,
    pub interfaces: Vec<Shapes>,
    pub base_interfaces: Vec<Shapes>,
    /// mm: each layer's bottom and top.
    pub z: Vec<(f64, f64)>,
}

/// The supports of one object from its organic trees: interfaces under the roofs and over the bottom contacts, the
/// flange on the plate, then toolpaths, as Orca's `generate_support_areas` goes on after drawing the trees.
pub fn generate_tree(o: &Object, p: &Params, t: TreeLayers) -> Vec<Layer> {
    let mut arena: Vec<Gen> = Vec::new();
    let (mut tops, mut bottoms, mut inter, mut placed) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut placed_base = Vec::new();
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
        add(Kind::BaseInterface, t.base_interfaces.get(l), &mut placed_base);
        add(Kind::Base, t.base.get(l), &mut inter);
    }
    if tops.is_empty() && inter.is_empty() && placed.is_empty() && placed_base.is_empty() {
        return Vec::new();
    }
    let (interfaces, base_interfaces) =
        tree_interface_layers(&mut arena, &tops, &bottoms, &inter, &placed, &placed_base, p);
    if let Some(r) = p.raft.filter(|r| r.layers() > 1) {
        // On a raft (Orca's `generate_raft_base`, then `generate_support_toolpaths`): the raft's layers under its
        // contact, the trees cutting through them, then the rest from the contact layer up, as without a raft.
        let rafts = raft_base(&mut arena, &tops, &interfaces, &base_interfaces, &inter, &r, p);
        let mut layers = raft_paths(&arena, &rafts, &inter, o.origin, p);
        let above = |list: &[usize]| -> Vec<usize> {
            list.iter().copied().filter(|&g| arena[g].print_z > r.interface_top_z + EPSILON).collect()
        };
        let (tops, bottoms, inter) = (above(&tops), above(&bottoms), above(&inter));
        let (interfaces, base_interfaces) = (above(&interfaces), above(&base_interfaces));
        layers.extend(toolpaths(o, &mut arena, &tops, &bottoms, &inter, &interfaces, &base_interfaces, p));
        mark_raft(&mut layers, p);
        return layers;
    }
    flange(o, &mut arena, &tops, &interfaces, &base_interfaces, &inter, p);
    let mut layers = toolpaths(o, &mut arena, &tops, &bottoms, &inter, &interfaces, &base_interfaces, p);
    mark_raft(&mut layers, p);
    layers
}

/// Orca's `generate_interface_layers` for organic trees: a base layer prints as interface where the contacts on its
/// own layer and the next one up lie, and where the bottom contacts of the two layers below lie (which print
/// nothing themselves), each grown and rounded off; the roofs' own interface layers take in what falls on their
/// layer. Where the interface has a filament of its own, the farthest of those layers from the contacts print as
/// base interface instead (`Params::top_base_interfaces`), into the roofs' own base interface layers, cut back from
/// the interface on their layer. With no base layer at all, there are no interfaces either. Returns the interface
/// layers and the base interface layers.
fn tree_interface_layers(
    arena: &mut Vec<Gen>,
    tops: &[usize],
    bottoms: &[usize],
    inter: &[usize],
    placed: &[usize],
    placed_base: &[usize],
    p: &Params,
) -> (Vec<usize>, Vec<usize>) {
    let num_top = p.top_interfaces.saturating_sub(1);
    let num_bottom = p.bottom_interfaces;
    if inter.is_empty() || (p.top_interfaces == 0 && p.bottom_interfaces == 0) {
        return (Vec::new(), Vec::new());
    }
    let num_top_base = p.top_base_interfaces.min(num_top);
    let num_bottom_base = p.bottom_base_interfaces.min(num_bottom);
    let (num_top_only, num_bottom_only) = (num_top - num_top_base, num_bottom - num_bottom_base);
    let ni = inter.len();
    // Each of the two: a new layer (none where it went into the roofs' own) and its polygons.
    type Made = Option<(Option<Gen>, Shapes)>;
    let made: Vec<Option<(Made, Made, Shapes)>> = {
        let arena = &*arena;
        let same_in = |list: &[usize], z: f64| {
            list.iter().copied().find(|&q| (arena[q].print_z - z).abs() < EPSILON && !arena[q].polygons.is_empty())
        };
        par::map_range(ni, |i| {
            let it = &arena[inter[i]];
            let (mut top_interface, mut top_base) = (Vec::new(), Vec::new());
            let (mut bottom_interface, mut bottom_base) = (Vec::new(), Vec::new());
            if num_top > 0 {
                let top_z = arena[inter[(i + num_top - 1).min(ni - 1)]].print_z;
                let top_interface_z = match (num_top_base, num_top_only) {
                    (0, _) => f64::MAX,
                    (_, 0) => f64::MIN,
                    (_, only) => arena[inter[(i + only - 1).min(ni - 1)]].print_z,
                };
                let first = tops.partition_point(|&t| arena[t].print_z < it.print_z);
                for &t in &tops[first..] {
                    if arena[t].bottom_z - EPSILON > top_z {
                        break;
                    }
                    let into =
                        if arena[t].bottom_z - EPSILON > top_interface_z { &mut top_base } else { &mut top_interface };
                    into.extend(arena[t].polygons.iter().cloned());
                }
            }
            if num_bottom > 0 {
                let bottom_z = arena[inter[(i + 1).saturating_sub(num_bottom)]].bottom_z;
                let bottom_interface_z = match (num_bottom_base, num_bottom_only) {
                    (0, _) => f64::MIN,
                    (_, 0) => f64::MAX,
                    (_, only) => arena[inter[i.saturating_sub(only)]].bottom_z,
                };
                let first = bottoms.partition_point(|&b| arena[b].print_z < bottom_z - EPSILON);
                for &b in &bottoms[first..] {
                    if arena[b].print_z - EPSILON > it.bottom_z {
                        break;
                    }
                    let into = if arena[b].print_z - EPSILON > bottom_interface_z {
                        &mut bottom_interface
                    } else {
                        &mut bottom_base
                    };
                    into.extend(arena[b].polygons.iter().cloned());
                }
            }
            let mut rest = it.polygons.clone();
            // Orca's `insert_layer`: what of the contacts falls on this base layer, with the roofs' own layer here.
            let mut insert = |bottom: Shapes, top: Shapes, same: Option<usize>, subtract: Option<&Shapes>, kind| {
                if bottom.is_empty() && top.is_empty() && same.is_none() {
                    return None;
                }
                let mut both = regularize(bottom, p.bottom_interface_density, p);
                both.extend(regularize(top, p.top_interface_density, p));
                let mut poly = if both.is_empty() { Vec::new() } else { geom::intersection(&both, &rest) };
                if let Some(q) = same {
                    poly = geom::union(&arena[q].polygons, &poly);
                }
                if poly.is_empty() {
                    return None;
                }
                rest = geom::difference(&rest, &poly);
                if let Some(cut) = subtract {
                    poly = geom::difference(&poly, cut);
                }
                // Into the roofs' own layer where there is one, else a new one.
                let g = same.is_none().then(|| {
                    let mut g = Gen::new(kind, it.bottom_z, it.print_z, it.height);
                    g.polygons = poly.clone();
                    g
                });
                Some((g, poly))
            };
            let kind = if top_interface.is_empty() { Kind::BottomInterface } else { Kind::TopInterface };
            let interface = insert(bottom_interface, top_interface, same_in(placed, it.print_z), None, kind);
            let cut = interface.as_ref().map(|(_, poly)| poly.clone());
            let same_base = same_in(placed_base, it.print_z);
            let base = insert(bottom_base, top_base, same_base, cut.as_ref(), Kind::BaseInterface);
            if interface.is_none() && base.is_none() {
                return None;
            }
            Some((interface, base, rest))
        })
    };
    let (mut out, mut out_base) = (Vec::new(), Vec::new());
    for (i, m) in made.into_iter().enumerate() {
        let Some((interface, base, rest)) = m else { continue };
        arena[inter[i]].polygons = rest;
        let (z, bottom_z, height) = (arena[inter[i]].print_z, arena[inter[i]].bottom_z, arena[inter[i]].height);
        for (made, list, own) in [(interface, &mut out, placed), (base, &mut out_base, placed_base)] {
            match made {
                Some((Some(g), _)) => {
                    if !g.polygons.is_empty() {
                        list.push(arena.len());
                        arena.push(g);
                    }
                }
                Some((None, poly)) => {
                    if let Some(&q) = own.iter().find(|&&q| (arena[q].print_z - z).abs() < EPSILON) {
                        arena[q].polygons = poly;
                        arena[q].bottom_z = bottom_z;
                        arena[q].height = height;
                    }
                }
                None => {}
            }
        }
    }
    for (list, own) in [(&mut out, placed), (&mut out_base, placed_base)] {
        list.extend(own.iter().copied().filter(|&q| !arena[q].polygons.is_empty()));
        list.sort_by(|&a, &b| arena[a].print_z.partial_cmp(&arena[b].print_z).unwrap());
        list.dedup();
    }
    (out, out_base)
}

/// Orca's `buildplate_covered`, for supports on the plate only: on each layer, the union of every layer below it,
/// each grown by 0.01 mm so they join (none on the first layer).
fn buildplate_covered(o: &Object) -> Vec<Shapes> {
    let n = o.slices.len();
    let mut covered: Vec<Shapes> = vec![Vec::new(); n];
    for l in 1..n {
        let grown = geom::offset_c2(&o.slices[l - 1], 0.01, geom::Join::Miter(3.0));
        covered[l] = geom::union_all(&[&covered[l - 1], &grown]);
    }
    covered
}

/// Orca's `detect_overhangs` for layer `l`: the parts beyond the layer below by more than the support angle allows,
/// with sharp tails (small islands with nothing under them) and cantilevers (overhangs reaching over 3 mm out). On
/// the plate only (`covered`), nothing over what the layers below cover: that is cut before the overhang grows back
/// to its full size. Painted blockers (`blocker`) cut the overhangs and the sharp tails. Supports only where painted
/// find none here: their painted enforcers come in with the contacts.
fn detect_overhangs(o: &Object, l: usize, p: &Params, covered: Option<&Shapes>, blocker: Option<&Shapes>) -> Detected {
    let lower = &o.slices[l - 1];
    let region = &o.slices[l];
    let mut out = Detected::default();
    if region.is_empty() || !p.auto {
        return out;
    }
    let fw = p.fw;
    let lower_expolys: Shapes =
        lower.iter().filter(|isl| !geom::offset(&one(isl), -fw / 2.0).is_empty()).cloned().collect();
    // Orca's offset is a float in nanometres.
    let llo = ((o.height[l - 1] / p.threshold.tan()) * 1e6) as f32 as f64 / 1e6;
    let mut d = geom::difference(region, &square(lower, llo));
    if let Some(covered) = covered {
        d = geom::difference(&d, covered);
    }
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
    if d.is_empty() {
        return out;
    }
    if let Some(blocker) = blocker {
        d = geom::difference(&d, blocker);
        // The tails are cut too (their heights stay as they were, as Orca's do).
        out.tails = geom::difference(&out.tails, blocker);
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
/// below is an overhang, less what painted blockers (grown, `blockers`) cover.
fn grow_sharp_tails(o: &Object, detected: &mut [Detected], p: &Params, blockers: &[Shapes]) {
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
            // By the heights, as Orca reads them: blockers can have cut a tail in pieces.
            for (i, &h) in lower.tail_heights.iter().enumerate() {
                if lower.tails.get(i).is_some_and(|tail| overlaps(&one(tail), &shape)) {
                    height += h;
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
            let overhang = geom::difference(&shape, &o.slices[l - 1]);
            match blockers.get(l).filter(|b| !b.is_empty()) {
                Some(blocker) => here.overhangs.extend(geom::difference(&overhang, blocker)),
                None => here.overhangs.extend(overhang),
            }
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
    // The first layer has overhangs only on a raft (its whole slice), where it clusters as any other layer.
    for (l, d) in detected.iter().enumerate() {
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

/// Orca's `sync_gap_with_object_layer`, with the support's layers in step with the object's: the object layer that
/// a contact under layer `l` (`top`) or on it (else) takes its top and height from. Walking down (up) from `l`, the
/// layers' heights are summed in single precision, as Orca's are, until they reach the gap; the nearer of the last
/// two sums decides the layer that ends the gap, and the contact is the layer beyond it.
fn synced_layer(o: &Object, l: usize, gap: f64, top: bool) -> usize {
    let n = o.height.len();
    let next = |k: usize| if top { k.checked_sub(1) } else { Some(k + 1).filter(|&k| k < n) };
    let back = |k: usize| if top { Some(k + 1).filter(|&k| k < n) } else { k.checked_sub(1) };
    let Some(first) = next(l) else { return l };
    let (mut at, mut last) = (Some(first), first);
    let mut synced = 0.0f32;
    while let Some(k) = at {
        if synced as f64 >= gap {
            break;
        }
        last = k;
        synced = (synced as f64 + o.height[k]) as f32;
        at = next(k);
    }
    if ((synced as f64 - o.height[last]) - gap).abs() < (synced as f64 - gap).abs()
        && let Some(k) = back(last)
    {
        last = k;
    }
    if top || gap > 0.0 { next(last).unwrap_or(last) } else { at.unwrap_or(last) }
}

/// Orca's `detect_contacts`, `new_contact_layer` and `fill_contact_layer`: the top contact layer under layer `l`'s
/// overhangs, the top gap below it.
#[allow(clippy::too_many_arguments)]
fn contact_layer(
    o: &Object,
    l: usize,
    d: &Detected,
    p: &Params,
    gp: &grid::Params,
    covered: Option<&Shapes>,
    enforcer: Option<&Shapes>,
) -> Option<Gen> {
    let mut overhangs: Shapes = d.overhangs.iter().filter(|s| !s.is_empty()).cloned().collect();
    let lower = &o.slices[l - 1];
    // What the contact is trimmed by (Orca's `slices_margin`): the layer below, and on the plate only all the layers
    // below.
    let united;
    let margin = match covered {
        Some(covered) => {
            united = geom::union(lower, covered);
            &united
        }
        None => lower,
    };
    let mut contact = if overhangs.is_empty() {
        Vec::new()
    } else {
        geom::difference(&geom::intersection(&overhangs, &o.slices[l]), margin)
    };
    // Painted enforcers (Orca's `detect_contacts`): support as under a vertical overhang wherever the layer reaches
    // beyond the one below (grown a hair, so as not to touch the object), its contact cut by the layer below alone,
    // also on the plate only.
    let enforced = match enforcer {
        Some(e) => geom::difference(&geom::intersection(&o.slices[l], e), &square(lower, 0.05 * p.fw)),
        None => Vec::new(),
    };
    if d.overhangs.is_empty() && enforced.is_empty() {
        return None;
    }
    if !enforced.is_empty() {
        overhangs = geom::union(&overhangs, &enforced);
        contact = geom::union(&contact, &geom::difference(&enforced, lower));
    }
    // In step with the object's layers, the contact is the layer the gap ends on, and as thick; else its height is
    // decided with the support's own layers.
    let (mut print_z, height) = if p.synchronize {
        let k = synced_layer(o, l, p.gap_top, true);
        (o.print_z[k], o.height[k])
    } else {
        (o.bottom_z(l) - p.gap_top, 0.0)
    };
    if print_z < p.first_layer_height - EPSILON {
        return None;
    }
    let mut g = if print_z < p.first_layer_height + p.min_height {
        print_z = p.first_layer_height;
        Gen::new(Kind::TopContact, 0.0, print_z, p.first_layer_height)
    } else {
        Gen::new(Kind::TopContact, print_z - height, print_z, height)
    };
    // On the plate only, the enforced areas print too, apart from the rest (which the layers below trim further).
    let enforced_apart = covered.is_some() && !enforced.is_empty();
    if p.snug {
        // Snug: the contact closed and rounded off, the same to project down and to print; every overhang gets dense
        // interface.
        g.contact = snug(&contact, p);
        g.polygons = g.contact.clone();
        if enforced_apart {
            g.polygons = geom::union(&g.polygons, &snug(&enforced, p));
        }
        g.overhang = overhangs;
        g.enforcer = enforced;
        return Some(g);
    }
    g.contact = Grid::new(&contact, margin, gp).extract(grid::EXPANSION_TO_PROPAGATE, true);
    // Dense interface only under overhangs steep enough to need it: beyond the layer below, its thin parts opened
    // away and the rest grown by 60 % of a wall.
    let nio = p.fw;
    let held = square(&square(lower, -0.5 * nio), 1.1 * nio);
    let dense = geom::difference(&overhangs, &held);
    if !dense.is_empty() {
        let dense = geom::difference(&geom::offset(&dense, 0.1 * nio), margin);
        let trimmed = geom::intersection(&dense, &g.contact);
        g.polygons = Grid::new(&trimmed, margin, gp).extract(gp.expansion_to_slice(), false);
    }
    if enforced_apart {
        // Gridded by themselves, trimmed by the layer below alone, with their own dense interface.
        let gridded = Grid::new(&enforced, lower, gp).extract(grid::EXPANSION_TO_PROPAGATE, true);
        let dense = geom::difference(&enforced, &held);
        if !dense.is_empty() {
            let dense = geom::difference(&geom::offset(&dense, 0.1 * nio), lower);
            let trimmed = geom::intersection(&dense, &gridded);
            let more = Grid::new(&trimmed, lower, gp).extract(gp.expansion_to_slice(), false);
            g.polygons = if g.polygons.is_empty() { more } else { geom::union(&g.polygons, &more) };
        }
    }
    g.overhang = overhangs;
    g.enforcer = enforced;
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
        d.enforcer = geom::union(&d.enforcer, &src.enforcer);
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
    covered: &[Shapes],
) -> (Vec<usize>, Vec<Shapes>) {
    let n = o.slices.len();
    let mut areas: Vec<Shapes> = vec![Vec::new(); n];
    let mut bottoms: Vec<usize> = Vec::new();
    let mut projection: Shapes = Vec::new();
    // What painted enforcers hold up, projected down on its own (never trimmed by the plate-only cover).
    let mut enforced: Shapes = Vec::new();
    let mut contact_idx = tops.len() as isize - 1;
    for l in (0..n - 1).rev() {
        let z = o.print_z[l];
        while contact_idx >= 0 && arena[tops[contact_idx as usize]].print_z > z - EPSILON {
            let t = &arena[tops[contact_idx as usize]];
            let new = [t.contact.clone(), grow(&t.overhang, SCALED_EPSILON)].concat();
            projection.extend(geom::union_all(&[&new]));
            enforced.extend(t.enforcer.iter().cloned());
            contact_idx -= 1;
        }
        if projection.is_empty() && enforced.is_empty() {
            continue;
        }
        let raw = geom::union_all(&[&projection]);
        let enforced_raw = if enforced.is_empty() { Vec::new() } else { geom::union_all(&[&enforced]) };
        // A bottom contact where the projection lands on a top surface; on the plate only, where what enforcers hold
        // up does.
        let top = &o.tops[l];
        let landing = if p.plate_only { &enforced_raw } else { &raw };
        if !top.is_empty() && !landing.is_empty() {
            let touching = geom::intersection(top, landing);
            if !touching.is_empty() {
                // In step with the object's layers, the layer the gap up from this one ends on, and as thick.
                let (mut height, mut print_z) = if p.synchronize {
                    let k = synced_layer(o, l, p.gap_bottom, false);
                    (o.height[k], o.print_z[k])
                } else {
                    (p.bottom_contact_height, z + p.bottom_contact_height + p.gap_bottom)
                };
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
        // The support near this layer, and the columns going on down: cut by the layer, or on the plate only by all
        // the layers below it; what enforcers hold up, cut by the layer alone, joins it.
        let trimming = if p.plate_only { covered[l].clone() } else { grow(&o.slices[l], SCALED_EPSILON) };
        let (area, next) = project_to_grid(&raw, &trimming, p, gp);
        areas[l] = area;
        projection = next;
        if !enforced.is_empty() {
            let (area, next) = project_to_grid(&enforced_raw, &grow(&o.slices[l], SCALED_EPSILON), p, gp);
            areas[l] = if areas[l].is_empty() { area } else { geom::union(&areas[l], &area) };
            enforced = next;
        }
    }
    bottoms.reverse();
    (bottoms, areas)
}

/// Orca's `project_support_to_grid`: support projected onto a layer, less what `trimming` covers there: the area to
/// print near the layer, and what goes on down. Snug: closed and rounded off, not cut by the object (its XY gap does
/// that later), the same to print and to project on down.
fn project_to_grid(raw: &Shapes, trimming: &Shapes, p: &Params, gp: &grid::Params) -> (Shapes, Shapes) {
    let mut below = geom::difference(raw, trimming);
    if p.snug {
        remove_sticks(&mut below);
        let area = snug(&below, p);
        return (area.clone(), area);
    }
    let grid = Grid::new(&below, trimming, gp);
    (grid.extract(gp.expansion_to_slice(), true), grid.extract(grid::EXPANSION_TO_PROPAGATE, true))
}

/// Orca's `raft_and_intermediate_support_layers`: between each pair of contacts (top contacts by their bottoms, bottom
/// contacts by their tops), as few layers as the thickest support layer allows, evenly thick, a top contact taking its
/// height from the layers below it; or, in step with the object's layers, the object's layers between them (and on a
/// raft one base layer under the object's first).
fn intermediate_layers(o: &Object, arena: &mut Vec<Gen>, tops: &[usize], bottoms: &[usize], p: &Params) -> Vec<usize> {
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
    // On a raft, the support's own layers start on its interface (the contact layer's height is decided).
    let raft_z = p.raft.map_or(0.0, |r| r.interface_top_z);
    let mut first = 0;
    if !extremes.is_empty() && (arena[extremes[0]].extreme_z() - raft_z).abs() < EPSILON {
        first = 1;
    }
    // In step with the object: the next of its layers to give the support.
    let mut object_layer = 0;
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
        let mut z1 = e1.map_or(raft_z, |e| arena[e].extreme_z());
        if z1.abs() < EPSILON {
            push(arena, &mut inter, 0.0, first_h, first_h);
            z1 = first_h;
        }
        let mut dist = z2 - z1;
        if dist == 0.0 {
            continue;
        }
        if p.synchronize {
            // The object's layers from above the lower extreme up to the upper one (Orca's `synchronize_layers`).
            let n_object = o.print_z.len();
            while object_layer < n_object && o.print_z[object_layer] < z1 + EPSILON {
                object_layer += 1;
            }
            if object_layer == 0 && z1 == raft_z && p.raft.is_some() {
                // One base layer under the object, on the raft.
                let bottom = raft_z;
                let top = o.print_z.first().map_or(bottom, |&z| z - o.height[0]);
                push(arena, &mut inter, bottom, top, top - bottom);
            }
            while object_layer < n_object && o.print_z[object_layer] < z2 + EPSILON {
                let (z, h) = (o.print_z[object_layer], o.height[object_layer]);
                let bottom = if object_layer > 0 { o.print_z[object_layer - 1] } else { z - h };
                push(arena, &mut inter, bottom, z, h);
                object_layer += 1;
            }
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
    // Not the raft's layers (its contact layer among them).
    let raft_top = p.raft.map_or(0.0, |r| r.contact_top_z);
    let todo: Vec<usize> = layers
        .iter()
        .copied()
        .filter(|&i| !arena[i].polygons.is_empty() && arena[i].print_z >= raft_top + EPSILON)
        .collect();
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
/// many as the interface layers asked for, less the contact itself) print as interface where the contact is; the
/// base interface layers among them (`Params::top_base_interfaces`, the farthest from the contact) print as base
/// interface there instead, cut back from the interface on their layer. Returns the interface layers and the base
/// interface layers.
fn interface_layers(
    arena: &mut Vec<Gen>,
    tops: &[usize],
    bottoms: &[usize],
    inter: &[usize],
    p: &Params,
) -> (Vec<usize>, Vec<usize>) {
    let num_top = p.top_interfaces.saturating_sub(1);
    let num_bottom = p.bottom_interfaces.saturating_sub(1);
    if inter.is_empty() || (num_top == 0 && num_bottom == 0) {
        return (Vec::new(), Vec::new());
    }
    let num_top_base = p.top_base_interfaces.min(num_top);
    let num_bottom_base = p.bottom_base_interfaces.min(num_bottom);
    let (num_top_only, num_bottom_only) = (num_top - num_top_base, num_bottom - num_bottom_base);
    let ni = inter.len();
    // The contacts' areas as Orca's `insert_layer` takes them: rounded off for snug supports, else as they are.
    let regularized = |bottom: Shapes, top: Shapes| -> Shapes {
        let mut both =
            if p.snug { regularize(bottom, p.bottom_interface_density, p) } else { geom::union_all(&[&bottom]) };
        both.extend(if p.snug { regularize(top, p.top_interface_density, p) } else { geom::union_all(&[&top]) });
        both
    };
    type Made = (Option<Gen>, Option<Gen>, Shapes);
    let made: Vec<Option<Made>> = {
        let arena = &*arena;
        par::map_range(ni, |i| {
            let it = &arena[inter[i]];
            let (mut top_interface, mut top_base) = (Vec::new(), Vec::new());
            let (mut bottom_interface, mut bottom_base) = (Vec::new(), Vec::new());
            if num_top > 0 {
                let top_z = arena[inter[(i + num_top - 1).min(ni - 1)]].print_z;
                // Contacts over this height make base interface here.
                let top_interface_z = match (num_top_base, num_top_only) {
                    (0, _) => f64::MAX,
                    (_, 0) => f64::MIN,
                    (_, only) => arena[inter[(i + only - 1).min(ni - 1)]].print_z,
                };
                let first = tops.partition_point(|&t| arena[t].print_z < it.print_z);
                for &t in &tops[first..] {
                    if arena[t].bottom_z - EPSILON > top_z {
                        break;
                    }
                    // Snug supports project the whole overhang, so that the interfaces meet the support of the
                    // layers round them without a gap.
                    let projected = if p.snug { &arena[t].overhang } else { &arena[t].polygons };
                    let into =
                        if arena[t].bottom_z - EPSILON > top_interface_z { &mut top_base } else { &mut top_interface };
                    into.extend(projected.iter().cloned());
                }
            }
            if num_bottom > 0 {
                let bottom_z = arena[inter[(i + 1).saturating_sub(num_bottom)]].bottom_z;
                // Bottom contacts under this height make base interface here.
                let bottom_interface_z = match (num_bottom_base, num_bottom_only) {
                    (0, _) => f64::MIN,
                    (_, 0) => f64::MAX,
                    (_, only) => arena[inter[i.saturating_sub(only)]].bottom_z,
                };
                let first = bottoms.partition_point(|&b| arena[b].print_z < bottom_z - EPSILON);
                for &b in &bottoms[first..] {
                    if arena[b].print_z - EPSILON > it.bottom_z {
                        break;
                    }
                    let into = if arena[b].print_z - EPSILON > bottom_interface_z {
                        &mut bottom_interface
                    } else {
                        &mut bottom_base
                    };
                    into.extend(arena[b].polygons.iter().cloned());
                }
            }
            let mut rest = it.polygons.clone();
            let mut interface = None;
            if !top_interface.is_empty() || !bottom_interface.is_empty() {
                let kind = if top_interface.is_empty() { Kind::BottomInterface } else { Kind::TopInterface };
                let poly =
                    geom::intersection(&geom::union_all(&[&regularized(bottom_interface, top_interface)]), &rest);
                if !poly.is_empty() {
                    rest = geom::difference(&rest, &poly);
                    let mut g = Gen::new(kind, it.bottom_z, it.print_z, it.height);
                    g.polygons = poly;
                    interface = Some(g);
                }
            }
            let mut base_interface = None;
            if !top_base.is_empty() || !bottom_base.is_empty() {
                let poly = geom::intersection(&geom::union_all(&[&regularized(bottom_base, top_base)]), &rest);
                if !poly.is_empty() {
                    rest = geom::difference(&rest, &poly);
                    let poly = match &interface {
                        Some(g) => geom::difference(&poly, &g.polygons),
                        None => poly,
                    };
                    if !poly.is_empty() {
                        let mut g = Gen::new(Kind::BaseInterface, it.bottom_z, it.print_z, it.height);
                        g.polygons = poly;
                        base_interface = Some(g);
                    }
                }
            }
            if interface.is_none() && base_interface.is_none() {
                return None;
            }
            Some((interface, base_interface, rest))
        })
    };
    let (mut interfaces, mut base_interfaces) = (Vec::new(), Vec::new());
    for (i, m) in made.into_iter().enumerate() {
        let Some((interface, base_interface, rest)) = m else { continue };
        arena[inter[i]].polygons = rest;
        for (g, list) in [(interface, &mut interfaces), (base_interface, &mut base_interfaces)] {
            if let Some(g) = g {
                list.push(arena.len());
                arena.push(g);
            }
        }
    }
    (interfaces, base_interfaces)
}

/// Orca's `generate_raft_base` without a raft: the support's first layer grown 2 mm past the columns, in steps,
/// kept off the object's first layer by the first layer's gap, and off the contacts and interfaces printed there.
fn flange(
    o: &Object,
    arena: &mut [Gen],
    tops: &[usize],
    interfaces: &[usize],
    base_interfaces: &[usize],
    inter: &[usize],
    p: &Params,
) {
    let contacts = tops.first().copied().filter(|&t| arena[t].print_z <= p.first_layer_height + EPSILON);
    let first_interface = interfaces.first().copied().filter(|&i| arena[i].bottom_print_z() <= EPSILON);
    let first_base_interface = base_interfaces.first().copied().filter(|&i| arena[i].bottom_print_z() <= EPSILON);
    let base = inter.first().copied().filter(|&i| arena[i].bottom_print_z() <= EPSILON);
    let mut interface_polygons: Shapes = Vec::new();
    for g in [contacts, first_interface, first_base_interface].into_iter().flatten() {
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
    if let Some(BrimTrim { outer, inner, gap }) = p.brim {
        let outlines: Shapes = footprint.iter().map(|s| vec![s[0].clone()]).collect();
        let holes: Shapes = footprint
            .iter()
            .flat_map(|s| s[1..].iter().map(|h| vec![h.iter().rev().copied().collect::<Vec<Pt>>()]))
            .collect();
        let brim = match (outer, inner) {
            // Brims both sides: the footprint grown by the gap, mitred (Orca's offset of the expolygons).
            (true, true) => geom::offset_c2(&footprint, gap, geom::Join::Miter(3.0)),
            // A brim round the outside: the outlines grown by the gap, round, the holes left out.
            (true, false) => geom::difference(&geom::offset_round(&outlines, gap, 0.1), &holes),
            // A brim inside the holes only: the outlines as they are, the holes shrunk by the gap, round.
            (false, true) => geom::difference(&outlines, &geom::offset_round(&holes, -gap, 0.1)),
            (false, false) => footprint,
        };
        for g in [base, contacts, first_interface, first_base_interface].into_iter().flatten() {
            if !arena[g].polygons.is_empty() {
                arena[g].polygons = geom::difference(&arena[g].polygons, &brim);
            }
        }
    }
}

/// The first layer's overhangs on a raft (Orca's `detect_overhangs` on the first object layer): its whole slice, holes
/// and all, which the raft's contact layer holds up; its islands not over 6 mm both ways are sharp tails.
fn raft_overhangs(o: &Object) -> Detected {
    let mut out = Detected { overhangs: o.slices[0].clone(), ..Detected::default() };
    for island in &o.slices[0] {
        let (x, y) = size(&one(island));
        if !(x > WELL_SUPPORTED && y > WELL_SUPPORTED) {
            out.tails.push(island.clone());
            out.tail_heights.push(o.height[0]);
        }
    }
    out
}

/// The raft's contact layer (Orca's `detect_contacts`, `new_contact_layer` and `fill_contact_layer` on the first object
/// layer over a raft): that layer grown by `raft_expansion`, put on the support grid (or, snug, closed and rounded
/// off), from the top of the raft's interface to its own top, all of it dense.
fn raft_contact(o: &Object, r: &Raft, p: &Params, gp: &grid::Params) -> Gen {
    let footprint = &o.slices[0];
    let contact = if p.raft_expansion > 0.0 {
        geom::offset_c2(footprint, p.raft_expansion, geom::Join::Miter(3.0))
    } else {
        footprint.clone()
    };
    let mut g = Gen::new(Kind::TopContact, r.interface_top_z, r.contact_top_z, r.contact_height);
    g.overhang = footprint.clone();
    if p.snug {
        g.contact = snug(&contact, p);
        g.polygons = g.contact.clone();
        return g;
    }
    // Nothing below to keep off.
    let nothing: Shapes = Vec::new();
    let grid = Grid::new(&contact, &nothing, gp);
    g.contact = grid.extract(grid::EXPANSION_TO_PROPAGATE, true);
    g.polygons = grid.extract(gp.expansion_to_slice(), true);
    g
}

/// Orca's `generate_raft_base` with a raft of two layers or more: under its contact layer, its interface layers and
/// its base, down to the first layer. The interface layers hold up the contact layer and what else rests on the raft
/// (the first interface layer, grown by half a millimetre), with the columns that start there printed through them
/// as base (each layer's `contact`); the base holds up both, and on the plate it grows by the first layer's expansion
/// less that half millimetre. Returns the raft's layers, lowest first.
fn raft_base(
    arena: &mut Vec<Gen>,
    tops: &[usize],
    interfaces: &[usize],
    base_interfaces: &[usize],
    inter: &[usize],
    r: &Raft,
    p: &Params,
) -> Vec<usize> {
    const FINE: f64 = 0.5;
    let first_inflate = (p.first_expansion - FINE).max(0.0);
    let contacts =
        tops.first().copied().filter(|&t| arena[t].print_z <= p.first_layer_height.max(r.contact_top_z) + EPSILON);
    let first_interface =
        interfaces.first().copied().filter(|&i| arena[i].bottom_print_z() <= r.interface_top_z + EPSILON);
    let first_base_interface =
        base_interfaces.first().copied().filter(|&i| arena[i].bottom_print_z() <= r.interface_top_z + EPSILON);
    let columns_base = inter.first().copied().filter(|&i| arena[i].bottom_print_z() <= r.interface_top_z + EPSILON);
    let mut interface_polygons: Shapes = Vec::new();
    for g in [contacts, first_interface, first_base_interface].into_iter().flatten() {
        if !arena[g].polygons.is_empty() {
            interface_polygons.extend(square(&arena[g].polygons, FINE));
        }
    }
    let interface_polygons = geom::union_all(&[&interface_polygons]);
    let (mut base, mut columns, mut first_layer) = (Vec::new(), Vec::new(), Vec::new());
    if let Some(c) = columns_base {
        if arena[c].bottom_print_z() > r.interface_top_z - EPSILON {
            // Columns standing on the raft's interface.
            base = arena[c].polygons.clone();
            columns =
                if interface_polygons.is_empty() { base.clone() } else { geom::difference(&base, &interface_polygons) };
        } else {
            // Organic trees, which stand on the plate through the raft: their foot is the raft's first layer too.
            first_layer = arena[c].polygons.clone();
        }
    }
    if !interface_polygons.is_empty() {
        base = geom::union(&base, &interface_polygons);
    }
    let mut out: Vec<usize> = Vec::new();
    let mut push = |arena: &mut Vec<Gen>, g: Gen| {
        out.push(arena.len());
        arena.push(g);
    };
    // The first layer.
    let kind = if r.base_layers > 0 { Kind::RaftBase } else { Kind::RaftInterface };
    let mut g = Gen::new(kind, 0.0, r.first_height, r.first_height);
    let first_layer = if first_layer.is_empty() { base.clone() } else { geom::union(&first_layer, &base) };
    g.polygons = if first_inflate > 0.0 {
        geom::offset_c2(&first_layer, first_inflate, geom::Join::Miter(3.0))
    } else {
        first_layer
    };
    push(arena, g);
    let mut z = r.first_height;
    // The rest of the base.
    for _ in 1..r.base_layers {
        let mut g = Gen::new(Kind::RaftBase, z, z + r.base_height, r.base_height);
        g.polygons = base.clone();
        z += r.base_height;
        push(arena, g);
    }
    // The interface under the contact layer.
    for _ in 1..r.interface_layers {
        let mut g = Gen::new(Kind::RaftInterface, z, z + r.interface_height, r.interface_height);
        g.polygons = interface_polygons.clone();
        g.contact = columns.clone();
        z += r.interface_height;
        push(arena, g);
    }
    out
}

/// The directions Orca's raft fills its layers in (`raft_angle_1st_layer`, `raft_angle_base`, `raft_angle_interface`,
/// as filler angles, radians in float), which depend on how many layers of each kind it has.
struct RaftAngles {
    first: f32,
    base: f32,
    interface: f32,
}

impl RaftAngles {
    fn of(r: &Raft) -> RaftAngles {
        // The support's angle is 0 (`support_angle`, `unsupported` refuses others); its interface a quarter turn on.
        let (base_angle, interface_angle) = (0.0f32, std::f32::consts::FRAC_PI_2);
        if r.base_layers > 1 {
            let turn = if r.interface_layers.is_multiple_of(2) { std::f32::consts::FRAC_PI_2 } else { 0.0 };
            RaftAngles { first: interface_angle, base: base_angle, interface: interface_angle + turn }
        } else if r.base_layers == 1 || r.interface_layers > 1 {
            RaftAngles {
                first: base_angle,
                base: 0.0,
                interface: (f64::from(interface_angle) + 0.5 * std::f64::consts::PI) as f32,
            }
        } else {
            let a = (0.5 * std::f64::consts::PI) as f32;
            RaftAngles { first: a, base: 0.0, interface: a }
        }
    }

    /// Orca's `raft_interface_angle`: the interface's direction, an eighth of a turn either way by the layer's
    /// interface id.
    fn interface(&self, id: usize) -> f32 {
        self.interface + if id % 2 == 1 { -std::f32::consts::FRAC_PI_4 } else { std::f32::consts::FRAC_PI_4 }
    }
}

/// The direction a filler at this angle lays its lines in, as `base_support::fill` takes it (Orca's
/// `_infill_direction`: a quarter turn on, in float).
fn direction(filler_angle: f32) -> f64 {
    f64::from(filler_angle + std::f32::consts::FRAC_PI_2)
}

/// The interface id Orca's support layers give the raft's contact layer (`generate_support_layers`): one more than
/// the layer under it, the last interface layer's (counted from 0) or a base layer's (0); on a raft of one layer, 0.
fn raft_contact_id(r: &Raft) -> usize {
    match r.layers() {
        1 => 0,
        _ if r.interface_layers >= 2 => r.interface_layers - 1,
        _ => 1,
    }
}

/// The raft's layers under its contact layer, as Orca's `generate_support_toolpaths` prints them: the first layer as a
/// loop round the raft's interface pattern at its own density (`raft_first_layer_density`), the base layers in the
/// support's pattern and density, and the interface layers in the raft's interface pattern, an eighth of a turn
/// either way by layer, with the columns that start on the raft printed through them as base.
fn raft_paths(arena: &[Gen], rafts: &[usize], trees: &[usize], origin: (f64, f64), p: &Params) -> Vec<Layer> {
    let Some(r) = p.raft else { return Vec::new() };
    let angles = RaftAngles::of(&r);
    // The raft's interface is the support pattern but at a density over 95 %, where it is straight lines.
    let rectilinear = p.raft_interface_density > 0.95;
    par::map_range(rafts.len(), |k| {
        let g = &arena[rafts[k]];
        let h = g.height;
        let path = |role: Role, points: Vec<Pt>, width: f64| Path {
            role,
            points: geom::simplify_line(&points, RESOLUTION),
            width,
            height: h,
        };
        // Organic trees cut through the raft above its first layer (Orca takes the k-th layer of their branches
        // where it is at this height): the raft prints round them, and they print as branches.
        let tree = trees
            .get(k)
            .map(|&t| &arena[t])
            .filter(|t| k > 0 && (t.print_z - g.print_z).abs() < EPSILON && !t.polygons.is_empty());
        let but_trees = |area: &Shapes| -> Shapes {
            match tree {
                Some(t) => geom::difference(area, &t.polygons),
                None => area.clone(),
            }
        };
        let mut items: Vec<Item> = Vec::new();
        if k > 0 {
            let area = but_trees(if k < r.base_layers { &g.polygons } else { &g.contact });
            let fill = |shape: &Shape| base_support::fill(shape, direction(angles.base), origin, p.spacing, p.density);
            if p.raft_sheath {
                // A loop round each part, as wide as a support line of the layer's height.
                let line = Line { width: p.width, height: h, spacing: flow_spacing(p.width, h) };
                items.extend(sheath_paths(&area, line, Role::Support, false, fill));
            } else {
                for shape in &geom::closing(&area, SCALED_EPSILON) {
                    for line in fill(shape) {
                        items.push(Item::Path(path(Role::Support, line, p.width)));
                    }
                }
            }
            if let Some(t) = tree {
                items.extend(tree_paths(&t.polygons, h, p));
            }
        }
        let role = if k < r.base_layers { Role::Support } else { Role::SupportInterface };
        if k == 0 {
            let (angle, sp) = (direction(angles.first), p.first_spacing);
            let line = Line { width: p.first_width, height: p.first_layer_height, spacing: sp };
            items.extend(sheath_paths(&g.polygons, line, role, true, |inner: &Shape| {
                if rectilinear {
                    monotonic::rectilinear(inner, angle, origin, sp, p.first_density)
                } else {
                    base_support::fill(inner, angle, origin, sp, p.first_density)
                }
            }));
        } else if k >= r.base_layers {
            // Interface ids count the raft's interface layers from 0.
            let angle = direction(angles.interface(k - r.base_layers));
            for shape in &geom::closing(&but_trees(&g.polygons), SCALED_EPSILON) {
                let lines = if rectilinear {
                    monotonic::rectilinear(shape, angle, origin, p.spacing, p.raft_interface_density)
                } else {
                    base_support::fill(shape, angle, origin, p.spacing, p.raft_interface_density)
                };
                for line in lines {
                    items.push(Item::Path(path(role, line, p.width)));
                }
            }
        }
        let islands = match tree {
            Some(t) => geom::union_all(&[&g.polygons, &g.contact, &t.polygons]),
            None => geom::union(&g.polygons, &g.contact),
        };
        Layer { print_z: g.print_z, height: h, items, islands, first: k == 0, raft: false }
    })
}

/// A support line's width, height and spacing, mm (Orca's `Flow`).
#[derive(Clone, Copy)]
struct Line {
    width: f64,
    height: f64,
    spacing: f64,
}

/// The spacing of a line this wide and high, mm, as Orca's float `Flow::spacing` works it out.
fn flow_spacing(width: f64, height: f64) -> f64 {
    (width as f32 - height as f32 * (1.0 - 0.25 * std::f64::consts::PI) as f32) as f64
}

/// Orca's `fill_expolygons_with_sheath_generate_paths`: each part of the area, closed, a loop half a line in from its
/// edge (stopping 15 % of a line short), then `fill`'s lines from 40 % of a line further in, as `role`. With `fixed`
/// (Orca's `no_sort`, on the first layer) each part's loop and lines print together, in that order.
fn sheath_paths(
    area: &Shapes,
    line: Line,
    role: Role,
    fixed: bool,
    fill: impl Fn(&Shape) -> Vec<Vec<Pt>>,
) -> Vec<Item> {
    let Line { width: w, height: h, spacing: sp } = line;
    let path = |points: Vec<Pt>, role: Role| Path {
        role,
        points: geom::simplify_line(&points, RESOLUTION),
        width: w,
        height: h,
    };
    let mut out = Vec::new();
    let closed = geom::offset(&geom::offset(area, SCALED_EPSILON), -(SCALED_EPSILON + 0.5 * w));
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
                group.push(path(pl, Role::Support));
            }
        }
        for inner in &geom::offset(&one(shape), -0.4 * sp) {
            for line in fill(inner) {
                group.push(path(line, role));
            }
        }
        if !fixed {
            out.extend(group.into_iter().map(Item::Path));
        } else if !group.is_empty() {
            out.push(Item::Fixed(group));
        }
    }
    out
}

/// Orca's `generate_support_layers` and `generate_support_toolpaths`: the generator's layers grouped by height into
/// the support's layers, merged where they print alike, and filled.
#[allow(clippy::too_many_arguments)]
fn toolpaths(
    o: &Object,
    arena: &mut [Gen],
    tops: &[usize],
    bottoms: &[usize],
    inter: &[usize],
    interfaces: &[usize],
    base_interfaces: &[usize],
    p: &Params,
) -> Vec<Layer> {
    // Grouped by height: within 0.1 µm of the group's lowest, at their average height and the thinnest one's
    // thickness; groups with nothing in them leave no layer.
    let mut all: Vec<usize> =
        bottoms.iter().chain(tops).chain(inter).chain(interfaces).chain(base_interfaces).copied().collect();
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
        let found = [at(bottoms), at(tops), at(interfaces), at(base_interfaces), at(inter)];
        layer_paths(arena, z, height, found, origin, p)
    })
}

/// One support layer's extrusions from the generator layers at its height (bottom contact, top contact, interface,
/// base interface, base).
fn layer_paths(arena: &[Gen], z: f64, height: f64, found: [Option<usize>; 5], origin: (f64, f64), p: &Params) -> Layer {
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
    let [mut bottom, mut top, mut interface, mut base_interface, base] = found.map(make);
    let could_merge = |a: &Option<Item>, b: &Option<Item>| match (a, b) {
        (Some(a), Some(b)) => (arena[a.layer].height - arena[b.layer].height).abs() < EPSILON,
        _ => false,
    };
    // The raft's contact layer, which nothing merges into and which prints as the raft's interface.
    let raft_contact =
        p.raft.filter(|r| top.is_some() && r.interface_layers > 0 && (z - r.contact_top_z).abs() < EPSILON);
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
    if p.top_interfaces > 0 && could_merge(&top, &interface) && raft_contact.is_none() {
        merge(&mut top, &mut interface);
    }
    // Organic trees' bottom contacts print nothing: nothing merges into them.
    if p.organic {
    } else if could_merge(&bottom, &top) && raft_contact.is_none() {
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
    let interface_angle = (std::f32::consts::FRAC_PI_2 + p.interface_turn as f32 + std::f32::consts::FRAC_PI_2) as f64;
    let extrude_interface = |item: &mut Option<Item>, density: f64, angle: f64| {
        let Some(item) = item.as_mut() else { return };
        let area = item.to_extrude.clone().unwrap_or_else(|| item.polygons.clone());
        if area.is_empty() {
            return;
        }
        let g = &arena[item.layer];
        for shape in &geom::union_all(&[&area]) {
            for line in base_support::fill(shape, angle, origin, p.spacing, density) {
                item.paths.push(crate::support::Item::Path(path(Role::SupportInterface, line, p.width, g.height)));
            }
        }
    };
    match raft_contact {
        // The raft's contact layer: its interface's density, turned as Orca turns it by its interface id.
        Some(r) => {
            let angle = direction(RaftAngles::of(&r).interface(raft_contact_id(&r)));
            extrude_interface(&mut top, p.raft_interface_density, angle);
        }
        None => extrude_interface(&mut top, p.top_interface_density, interface_angle),
    }
    if !p.organic {
        extrude_interface(&mut bottom, p.bottom_interface_density, interface_angle);
    }
    let interface_bottom = interface.as_ref().is_some_and(|i| arena[i.layer].kind == Kind::BottomInterface);
    let density = if interface_bottom { p.bottom_interface_density } else { p.top_interface_density };
    extrude_interface(&mut interface, density, interface_angle);
    // Base interface: the support pattern (straight lines over 95 %, and under organic trees, which print with a
    // sheath) at the interface's spacing and density, turned as the interface, in the base's line (Orca's
    // `filler_base_interface`).
    let base_interface_density = if p.top_interfaces > 0 || p.bottom_interfaces == 0 {
        p.top_interface_density
    } else {
        p.bottom_interface_density
    };
    if let Some(item) = base_interface.as_mut() {
        let area = item.to_extrude.clone().unwrap_or_else(|| item.polygons.clone());
        let g = &arena[item.layer];
        for shape in &geom::union_all(&[&area]) {
            let lines = if base_interface_density > 0.95 || p.raft_sheath {
                monotonic::rectilinear(shape, interface_angle, origin, p.spacing, base_interface_density)
            } else {
                base_support::fill(shape, interface_angle, origin, p.spacing, base_interface_density)
            };
            for line in lines {
                item.paths.push(crate::support::Item::Path(path(Role::Support, line, p.width, g.height)));
            }
        }
    }
    let mut base = base;
    // A raft of one layer is its contact layer, on the plate.
    let mut first = raft_contact.is_some_and(|r| r.layers() == 1);
    if let Some(item) = base.as_mut() {
        let g = &arena[item.layer];
        let area = item.to_extrude.clone().unwrap_or_else(|| item.polygons.clone());
        if !area.is_empty() {
            if g.bottom_z < EPSILON {
                // The flange: rectilinear lines along Y.
                first = true;
                let angle = (std::f32::consts::FRAC_PI_2 + std::f32::consts::FRAC_PI_2) as f64;
                item.paths.extend(flange_paths(&area, angle, origin, p));
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
    // The base interface goes in with the base, after it, where both print.
    let printed =
        |item: &Option<Item>| item.as_ref().is_some_and(|i| !i.to_extrude.as_ref().unwrap_or(&i.polygons).is_empty());
    if printed(&base) && printed(&base_interface) && could_merge(&base, &base_interface) {
        let mut from = base_interface.take();
        let paths = from.as_mut().map(|f| std::mem::take(&mut f.paths)).unwrap_or_default();
        merge(&mut base, &mut from);
        if let Some(b) = base.as_mut() {
            b.paths.extend(paths);
        }
    }
    // Thickest first, as Orca prints them; their areas are where travels needn't retract.
    let mut nonempty: Vec<Item> = [bottom, top, interface, base_interface, base].into_iter().flatten().collect();
    nonempty.sort_by(|a, b| arena[b.layer].height.partial_cmp(&arena[a.layer].height).unwrap());
    let mut polys: Shapes = Vec::new();
    let mut items = Vec::new();
    for item in nonempty {
        polys.extend(item.polygons);
        items.extend(item.paths);
    }
    let islands = geom::union_all(&[&polys]);
    Layer { print_z: z, height, items, islands, first, raft: false }
}

/// The classic trees' layers as drawn (`tree::classic`), printed as Orca's `TreeSupport::generate_toolpaths` prints
/// them: branches as walls (`tree_paths`), a hybrid tree's columns walled and filled, roofs and floors as the
/// interface pattern, each roof's first layer a loop and dense lines, and the first layer as the flange. Each
/// layer's lines are as wide and spaced as a line of its own height.
pub fn classic_layers(
    drawn: Vec<crate::tree::classic::draw::Drawn>,
    origin: (f64, f64),
    wall_count: usize,
    p: &Params,
) -> Vec<Layer> {
    use crate::tree::classic::draw::AreaType;
    // Orca's `_infill_direction` angles (the filler's and a quarter turn, in float): the interfaces' filler is at the
    // support angle and a quarter turn, the base's at the support angle.
    let interface_angle = (std::f32::consts::FRAC_PI_2 + std::f32::consts::FRAC_PI_2) as f64;
    let base_angle = std::f32::consts::FRAC_PI_2 as f64;
    par::map_range(drawn.len(), |layer_id| {
        let d = &drawn[layer_id];
        let h = d.height;
        let sp = flow_spacing(p.width, h);
        let support_spacing = p.base_spacing() + sp;
        let support_density = (sp / support_spacing).min(1.0);
        let path = |role: Role, points: Vec<Pt>| Path {
            role,
            points: geom::simplify_line(&points, RESOLUTION),
            width: p.width,
            height: h,
        };
        let mut items: Vec<Item> = Vec::new();
        let first = layer_id == 0;
        for g in &d.groups {
            let one_area = vec![g.area.clone()];
            match g.kind {
                AreaType::Base if first => {
                    items.extend(flange_paths(&one_area, base_angle, origin, p));
                }
                AreaType::Base if g.need_infill => {
                    // A hybrid tree's column: walls (one at least where it is too thin for lines alone) and the
                    // support pattern inside.
                    let thin = geom::offset_square(&one_area, -(support_spacing * 1.5)).is_empty();
                    let walls = wall_count.max(usize::from(thin));
                    items.push(Item::Fixed(walled_infill(
                        &one_area,
                        walls,
                        sp,
                        support_density,
                        base_angle,
                        origin,
                        h,
                        p,
                    )));
                }
                AreaType::Base => {
                    let mut lp = p.clone();
                    lp.spacing = sp;
                    if g.need_extra_wall && wall_count == 0 {
                        lp.double_wall_area = 1e-13;
                    }
                    let group: Vec<Path> = tree_paths(&one_area, h, &lp)
                        .into_iter()
                        .flat_map(|item| match item {
                            Item::Path(path) => vec![path],
                            Item::Fixed(group) => group,
                        })
                        .collect();
                    if !group.is_empty() {
                        items.push(Item::Fixed(group));
                    }
                }
                AreaType::Roof1stLayer => {
                    // A loop half a line in, then dense lines inside it; as support where it is base interface.
                    let role = if g.interface_as_base { Role::Support } else { Role::SupportInterface };
                    let mut group: Vec<Path> = Vec::new();
                    for e in &geom::offset_square(&one_area, -0.5 * sp) {
                        for (k, contour) in e.iter().enumerate() {
                            let mut pl = contour.clone();
                            if k > 0 {
                                pl.reverse();
                            }
                            pl.push(pl[0]);
                            group.push(path(role, pl));
                        }
                    }
                    for e in &geom::offset_square(&one_area, -sp) {
                        for line in monotonic::rectilinear(e, interface_angle, origin, sp, p.top_interface_density) {
                            group.push(path(role, line));
                        }
                    }
                    if !group.is_empty() {
                        items.push(Item::Fixed(group));
                    }
                }
                AreaType::Roof | AreaType::Floor => {
                    let density =
                        if g.kind == AreaType::Floor { p.bottom_interface_density } else { p.top_interface_density };
                    let role = if g.interface_as_base { Role::Support } else { Role::SupportInterface };
                    for line in base_support::fill(&g.area, interface_angle, origin, sp, density) {
                        items.push(Item::Path(path(role, line)));
                    }
                }
            }
        }
        let all: Shapes = d.groups.iter().map(|g| g.area.clone()).collect();
        Layer { print_z: d.print_z, height: h, items, islands: geom::union_all(&[&all]), first, raft: false }
    })
}

/// Orca's `make_perimeter_and_infill` with the walls first: `walls` loops from half a line in, and the support
/// pattern inside the last; with no walls, a loop only round what the lines leave out.
#[allow(clippy::too_many_arguments)]
fn walled_infill(
    area: &Shapes,
    walls: usize,
    sp: f64,
    density: f64,
    angle: f64,
    origin: (f64, f64),
    h: f64,
    p: &Params,
) -> Vec<Path> {
    let path = |points: Vec<Pt>| Path {
        role: Role::Support,
        points: geom::simplify_line(&points, RESOLUTION),
        width: p.width,
        height: h,
    };
    let mut outline = geom::offset_square(area, -0.5 * sp);
    let to_infill = geom::offset_square(area, -(walls as f64) * sp);
    let mut lines: Vec<Path> = Vec::new();
    let mut boxes: Vec<[i32; 4]> = Vec::new();
    for e in &to_infill {
        let fill = base_support::fill(e, angle, origin, sp, density);
        if let Some(b) = geom::bbox(&fill.iter().map(|l| vec![l.clone()]).collect::<Shapes>()) {
            boxes.push(b);
        }
        lines.extend(fill.into_iter().map(&path));
    }
    if walls == 0 {
        // The lines' boxes, stretched 10 mm along them, take their place from the loop.
        for b in boxes {
            let ten = (10.0 * geom::SCALE) as i32;
            let r = [b[0] - ten, b[1], b[2] + ten, b[3]];
            let rect: Shape =
                vec![vec![geom::pt(r[0], r[1]), geom::pt(r[2], r[1]), geom::pt(r[2], r[3]), geom::pt(r[0], r[3])]];
            outline = geom::difference(&outline, &geom::offset(&vec![rect], 0.5 * p.width));
        }
        outline.retain(|e| !geom::offset(&vec![e.clone()], -p.width).is_empty());
    }
    let mut out: Vec<Path> = Vec::new();
    let mut level = outline;
    for depth in 0..walls.max(1) {
        let mut next: Shapes = Vec::new();
        for e in &level {
            for (k, contour) in e.iter().enumerate() {
                let mut pl = contour.clone();
                if k > 0 {
                    pl.reverse();
                }
                pl.push(pl[0]);
                out.push(path(pl));
            }
            if depth + 1 < walls {
                next.extend(geom::offset(&geom::offset(&vec![e.clone()], -1.4 * sp), 0.4 * sp));
            }
        }
        level = next;
    }
    out.extend(lines);
    out
}

/// Orca's `fill_expolygons_with_sheath_generate_paths` on the first layer: a loop round each part, half a line in,
/// then rectilinear lines at `angle`, dense, each part's printed as it comes.
fn flange_paths(area: &Shapes, angle: f64, origin: (f64, f64), p: &Params) -> Vec<Item> {
    let sp = p.first_spacing;
    let line = Line { width: p.first_width, height: p.first_layer_height, spacing: sp };
    sheath_paths(area, line, Role::Support, true, |inner: &Shape| {
        monotonic::rectilinear(inner, angle, origin, sp, p.first_density)
    })
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
                    let mut remaining = anchor_length - (sx - f.0).hyp(sy - f.1);
                    let mut i = start;
                    let mut j = (i + 1) % m;
                    let mut pi = (cand[i].0.x as f64, cand[i].0.y as f64);
                    let mut pj = (cand[j].0.x as f64, cand[j].0.y as f64);
                    let (mut vx, mut vy) = (pj.0 - pi.0, pj.1 - pi.1);
                    let mut l = vx.hyp(vy);
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
                            l = vx.hyp(vy);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sticks_and_repeated_points_leave_an_outline_and_a_bare_stick_goes() {
        let p = |x: i32, y: i32| geom::pt(x * 1000, y * 1000);
        // A square with a spike out of its top edge (out to x 15 and straight back) and a repeated corner.
        let mut shapes: Shapes =
            vec![vec![vec![p(0, 0), p(10, 0), p(10, 0), p(10, 10), p(5, 10), p(15, 10), p(5, 10), p(0, 10)]]];
        remove_sticks(&mut shapes);
        // The spike and the repeat go; the point where the spike left the edge stays, on the edge, as in Orca.
        assert_eq!(shapes, vec![vec![vec![p(0, 0), p(10, 0), p(10, 10), p(5, 10), p(0, 10)]]]);
        // An outline that is only a stick there and back goes, and its shape with it.
        let mut stick: Shapes = vec![vec![vec![p(0, 0), p(5, 0), p(10, 0), p(5, 0)]]];
        remove_sticks(&mut stick);
        assert!(stick.is_empty());
    }
}
