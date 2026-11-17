//! Spaghetti's experimental slicer: STL and plain 3MF in, a Bambu-flavoured `.gcode.3mf` out, with the defaults of
//! decision 0046. Built for speed: layers are sliced, walled and filled in parallel (one thread in WebAssembly), on
//! exact integer geometry. See `docs/proposals/rust-slicer.md` for what it does, how fast, and what it lacks.

pub mod adaptive;
pub mod arachne;
pub mod arc_fit;
pub mod bambu;
pub mod base_support;
pub mod bridges;
pub mod brim;
pub mod concentric;
pub mod config;
pub mod elephant;
pub mod filaments;
pub mod fill;
pub mod fmath;
pub mod fuzzy;
pub mod gcode;
pub mod geom;
pub mod grid;
pub mod honeycomb3d;
pub mod infill;
pub mod ironing;
pub mod json;
pub mod lift;
pub mod lightning;
pub mod medial;
pub mod mesh;
pub mod monotonic;
pub mod noise;
pub mod order;
pub mod overhang;
pub mod pack;
pub mod paint;
pub mod parts;
pub mod plan;
pub mod plane_path;
pub mod png;
pub mod preheat;
pub mod profile;
pub mod raft;
pub mod region;
pub mod seam;
pub mod seam_mesh;
pub mod section;
pub mod segment;
pub mod setup;
pub mod solid;
pub mod spiral;
pub mod support;
pub mod surfaces;
pub mod template;
pub mod threemf;
pub mod toolchange;
pub mod tree;
#[cfg(target_arch = "wasm32")]
mod wasm;

/// In WebAssembly, Talc's allocator rather than Rust's own (dlmalloc): about as fast on a Benchy, a little faster
/// with trees, and a smaller module.
#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();
pub mod wipe_tower;
pub mod zip;

pub use config::Settings;
pub use gcode::Stats;
use mesh::Mesh;

/// A model file: an STL (binary or text) or a 3MF.
pub struct Input<'a> {
    pub name: &'a str,
    pub bytes: &'a [u8],
}

/// A model as placed on the plate, as the G-code and the plate's object list name it.
#[derive(Clone, Debug)]
pub struct Object {
    pub name: String,
    /// The id the printer knows it by: in the header's label list, the M624/M625 labels around its moves and the
    /// plate's object list (1, 2, 3…; Orca uses its own internal ids).
    pub label: u32,
    /// Which of the plate's objects it is (0, 1, 2…): an object whose parts print in different filaments prints as
    /// one of these for each filament (`parts.rs`), and they share their object's group, name, label and box.
    pub group: u32,
    /// mm on the plate: the lowest corner of its bounding box, then the highest.
    pub min: [f64; 3],
    pub max: [f64; 3],
    /// Its first layer's extent on the plate (min x, min y, max x, max y, mm) and area (mm²), which the plate's
    /// description gives the printer.
    pub first_layer: [f64; 4],
    pub first_layer_area: f64,
}

impl Object {
    /// The `group`th object on the plate, from the meshes of its parts.
    fn of_group(group: usize, parts: &[&Mesh]) -> Object {
        let mut b = mesh::Bounds { min: [f64::INFINITY; 3], max: [f64::NEG_INFINITY; 3] };
        for m in parts {
            let p = m.bounds();
            for k in 0..3 {
                b.min[k] = b.min[k].min(p.min[k]);
                b.max[k] = b.max[k].max(p.max[k]);
            }
        }
        Object {
            name: parts.first().map(|m| m.name.clone()).unwrap_or_default(),
            label: group as u32 + 1,
            group: group as u32,
            min: b.min,
            max: b.max,
            first_layer: [b.min[0], b.min[1], b.max[0], b.max[1]],
            first_layer_area: 0.0,
        }
    }
}

/// Gives each object the parts of the first layer's outline cut from it (`owners`): their extent and area.
fn first_layers(objects: &mut [Object], first: &geom::Shapes, owners: &[u32]) {
    let mut seen = vec![false; objects.len()];
    for (shape, &k) in first.iter().zip(owners) {
        let Some(o) = objects.get_mut(k as usize) else { continue };
        let b = geom::bbox_of(shape).map(geom::unsc);
        o.first_layer = if seen[k as usize] {
            [
                o.first_layer[0].min(b[0]),
                o.first_layer[1].min(b[1]),
                o.first_layer[2].max(b[2]),
                o.first_layer[3].max(b[3]),
            ]
        } else {
            b
        };
        o.first_layer_area += geom::shape_area_mm2(shape);
        seen[k as usize] = true;
    }
}

#[derive(Clone, Debug)]
pub struct Options {
    /// Arranges the objects in the middle of the plate, as the app does with STL and plain 3MF files; off, they
    /// stay where the files put them (each dropped onto the plate). A Bambu Studio or Orca project always stays
    /// as laid out.
    pub arrange: bool,
    /// Draws the plate picture into the file.
    pub thumbnail: bool,
    /// Percent of the models' own size, scaled about their origin before they are laid out (as the app scales);
    /// scaled models are always arranged.
    pub scale: f64,
    /// Keeps the plain G-code in `Output::gcode`. Without it the G-code is packed as it's written, and never held
    /// whole (a tall print's is 80 MB).
    pub gcode: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { arrange: true, thumbnail: true, scale: 100.0, gcode: true }
    }
}

/// Milliseconds each step took.
#[derive(Clone, Debug, Default)]
pub struct Timings {
    pub read: f64,
    pub slice: f64,
    pub regions: f64,
    /// Normal supports, when the settings ask for them, and the G-code's layers with theirs.
    pub supports: f64,
    /// Each layer's paths in order, its moves, their timing and its G-code text.
    pub toolpaths: f64,
    /// The layers' G-code into one file, with the header and the progress marks, deflated.
    pub gcode: f64,
    pub thumbnail: f64,
    pub pack: f64,
    pub total: f64,
}

pub struct Output {
    /// The `.gcode.3mf`.
    pub file: Vec<u8>,
    /// The plain G-code, when `Options::gcode` asks for it.
    pub gcode: Vec<u8>,
    pub gcode_bytes: usize,
    pub stats: Stats,
    pub timings: Timings,
    pub triangles: usize,
    /// What the settings ask for that this printed otherwise (`Settings::fallbacks`).
    pub fallbacks: Vec<String>,
    /// What Orca would warn of: for now, objects sliced without supports that need them (`Warning`).
    pub warnings: Vec<Warning>,
}

/// A warning about the print, as Orca's engine gives it: its kind and its words.
#[derive(Clone, Debug, PartialEq)]
pub struct Warning {
    /// Orca's: `need_support_on` (an object sliced without supports needs them).
    pub kind: &'static str,
    pub message: String,
}

impl Warning {
    /// Orca's warning for an object sliced without supports that needs them (`PrintObject::is_support_necessary`).
    fn needs_support(object: &str, why: tree::overhangs::Necessity) -> Warning {
        let what = match why {
            tree::overhangs::Necessity::FloatingRegions => "has floating regions",
            tree::overhangs::Necessity::FloatingCantilever => "has a floating cantilever",
        };
        Warning {
            kind: "need_support_on",
            message: format!(
                "It seems object {object} {what}. Please re-orient the object or enable support generation."
            ),
        }
    }
}

/// A clock that works natively and in WebAssembly (where the host tells the time).
fn now() -> f64 {
    #[cfg(not(target_arch = "wasm32"))]
    {
        use std::sync::OnceLock;
        use std::time::Instant;
        static START: OnceLock<Instant> = OnceLock::new();
        START.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
    }
    #[cfg(target_arch = "wasm32")]
    {
        wasm::now()
    }
}

/// Reads the models, lays them on the plate and slices them with `settings`: the whole job, from files to a
/// `.gcode.3mf`.
pub fn slice(inputs: &[Input], settings: &Settings, options: &Options) -> Result<Output, Error> {
    let mut plate = Plate::default();
    for input in inputs {
        plate.add(input)?;
    }
    plate.slice(settings, options)
}

/// Keeps the meshes (and their filaments and objects) where `keep` says, the objects then numbered from 0 again.
fn retain_by(
    meshes: &mut Vec<Mesh>,
    filaments: &mut Vec<usize>,
    groups: &mut Vec<usize>,
    paints: [&mut Vec<Option<paint::Paint>>; 2],
    keep: &[bool],
) {
    for paints in paints {
        paints.resize(meshes.len(), None);
        let mut k = keep.iter();
        paints.retain(|_| k.next().copied().unwrap_or(true));
    }
    let mut k = keep.iter();
    meshes.retain(|_| k.next().copied().unwrap_or(true));
    let mut k = keep.iter();
    filaments.retain(|_| k.next().copied().unwrap_or(true));
    let mut k = keep.iter();
    groups.retain(|_| k.next().copied().unwrap_or(true));
    let mut seen: Vec<usize> = Vec::new();
    for g in groups.iter_mut() {
        *g = seen.iter().position(|&s| s == *g).unwrap_or_else(|| {
            seen.push(*g);
            seen.len() - 1
        });
    }
}

/// Each painted object's layers re-split by its paint, as Orca applies it (`segment::apply`): the painted parts of
/// its regions go to the region of the filament they are painted in (made where the object has none).
fn paint_regions(
    parts: &mut parts::Regions,
    slices: &mut [geom::Shapes],
    owners: &mut [Vec<u32>],
    meshes: &[Mesh],
    paints: &[Option<paint::Paint>],
    layers: &section::Layers,
    settings: &Settings,
) {
    let (slice_z, heights) = (&layers.slice_z(), &layers.height);
    // The filaments the setup has: paint in any past them prints in the object's own.
    let filaments = settings.palette.as_ref().map_or(1, |p| p.profiles.len());
    // What Orca's walls simplify each region to first: a fifth of the resolution, with arc fitting.
    let tolerance = 0.2 * settings.resolution;
    // With interlocking beams Orca doesn't keep painted sides to a width (and the beams are refused).
    let cut = |mm: f64| if settings.interlocking_beam { 0.0 } else { mm };
    let shells = segment::Shells {
        top: settings.top_color_layers,
        bottom: settings.bottom_color_layers,
        width: settings.outer_wall_width,
        gap_fill: settings.gap_infill_speed > 0.0,
        max_width: cut(settings.painted_max_width),
        interlocking_depth: cut(settings.painted_interlocking_depth),
    };
    for g in 0..parts.members.len() {
        let painted: Vec<(&Mesh, &paint::Paint)> = parts.members[g]
            .iter()
            .filter_map(|&m| paints.get(m).and_then(Option::as_ref).map(|p| (&meshes[m], p)))
            .collect();
        if painted.iter().all(|(_, p)| p.states() <= 1) {
            continue;
        }
        let facets = segment::facets(&painted);
        // Every triangle of the object, painted or not, for its tops and bottoms.
        let all: Vec<(&Mesh, Option<&paint::Paint>)> =
            parts.members[g].iter().map(|&m| (&meshes[m], paints.get(m).and_then(Option::as_ref))).collect();
        let surfaces = segment::surfaces(&all);
        // The object's regions: those it has now, and any made for it below.
        let before: Vec<bool> = parts.group.iter().map(|&rg| rg as usize == g).collect();
        let is_mine = |r: u32| before.get(r as usize).copied().unwrap_or(true);
        let layers: Vec<geom::Shapes> = slices
            .iter()
            .zip(owners.iter())
            .map(|(s, o)| s.iter().zip(o).filter(|&(_, &r)| is_mine(r)).map(|(s, _)| s.clone()).collect())
            .collect();
        let by_layer = segment::painted_regions(slice_z, heights, &layers, &facets, &surfaces, filaments, &shells);
        for (l, painted) in by_layer.iter().enumerate() {
            if painted.iter().all(Vec::is_empty) {
                continue;
            }
            // The object's regions on the layer, by filament, in the order of its regions.
            let mut regions: Vec<(usize, geom::Shapes)> = Vec::new();
            for (shape, &r) in slices[l].iter().zip(&owners[l]) {
                if !is_mine(r) {
                    continue;
                }
                let f = parts.filament[r as usize];
                match regions.iter_mut().find(|x| x.0 == f) {
                    Some(x) => x.1.push(shape.clone()),
                    None => regions.push((f, vec![shape.clone()])),
                }
            }
            let split = segment::apply(&regions, painted);
            let (mut shapes, mut own): (geom::Shapes, Vec<u32>) =
                slices[l].iter().cloned().zip(owners[l].iter().copied()).filter(|&(_, r)| !is_mine(r)).unzip();
            for (f, region_shapes) in split {
                let r = parts.region_of(g, f);
                // Simplified as Orca's walls simplify each region first: the split leaves points a hair apart, which
                // would make a flat of an inner corner.
                for shape in geom::simplify_polygons(&region_shapes, tolerance) {
                    shapes.push(shape);
                    own.push(r);
                }
            }
            slices[l] = shapes;
            owners[l] = own;
        }
    }
}

/// Models read from their files, not yet laid out or sliced. Adding the files one at a time lets each file's bytes
/// go as soon as it is read, so a plate of big models never holds all of its files and all of its slices at once.
#[derive(Default)]
pub struct Plate {
    meshes: Vec<Mesh>,
    /// Each mesh's filament (0-based).
    filaments: Vec<usize>,
    /// Which object each mesh is of: a project's object whose parts print in different filaments comes as a mesh
    /// for each part.
    groups: Vec<usize>,
    /// Each mesh's painted colours (`paint.rs`), when it has any.
    paints: Vec<Option<paint::Paint>>,
    /// Each mesh's painted supports (state 1 enforcing support, 2 blocking it), when it has any.
    support_paints: Vec<Option<paint::Paint>>,
    /// The mesh an STL last added became, and where its triangles went: paint for it (`paint`) goes by the STL's.
    last_stl: Option<(usize, mesh::Moves)>,
    project: bool,
    /// Whether a model came with no word of its filament (an STL, or a 3MF that isn't a project, added without one).
    unassigned: bool,
    title: Option<String>,
    read_ms: f64,
}

impl Plate {
    /// Reads one STL or 3MF file onto the plate.
    pub fn add(&mut self, input: &Input) -> Result<(), Error> {
        self.add_with_filament(input, None)
    }

    /// `add`, its objects printing in filament `filament` (0-based), else in the filaments the file gives them.
    pub fn add_with_filament(&mut self, input: &Input, filament: Option<usize>) -> Result<(), Error> {
        let t0 = now();
        let name = input.name.rsplit(['/', '\\']).next().unwrap_or(input.name);
        self.last_stl = None;
        if input.bytes.starts_with(b"PK\x03\x04") {
            let model = threemf::read(input.bytes)?;
            self.project |= model.project;
            self.unassigned |= filament.is_none() && !model.project;
            self.filaments.extend(model.filaments.iter().map(|&f| filament.unwrap_or(f)));
            let next = self.groups.iter().map(|&g| g + 1).max().unwrap_or(0);
            self.groups.extend(model.groups.iter().map(|&g| next + g));
            self.paints.resize(self.meshes.len(), None);
            self.paints.extend(model.paints);
            self.support_paints.resize(self.meshes.len(), None);
            self.support_paints.extend(model.support_paints);
            self.meshes.extend(model.meshes);
        } else {
            let (mut m, moves) = mesh::read_stl_moved(name, input.bytes)?;
            let n = m.vertices.len();
            mesh::settle_heights(&mut m.vertices, &[(0..n, 0.0)], true);
            self.last_stl = Some((self.meshes.len(), moves));
            self.meshes.push(m);
            self.groups.push(self.groups.iter().map(|&g| g + 1).max().unwrap_or(0));
            self.unassigned |= filament.is_none();
            self.filaments.push(filament.unwrap_or(0));
        }
        self.title.get_or_insert_with(|| name.to_string());
        self.read_ms += now() - t0;
        Ok(())
    }

    /// One part of an object made of parts (an STL; a 3MF's objects all become parts), printing in filament
    /// `filament` (0-based): with `first`, of a new object, else of the object of the part added just before. An
    /// object's parts stay where they are against each other (the object goes onto the bed as a whole), and print as
    /// Orca prints an object's parts: each in its filament, the later one where two overlap.
    pub fn add_part(&mut self, input: &Input, filament: usize, first: bool) -> Result<(), Error> {
        let t0 = now();
        let name = input.name.rsplit(['/', '\\']).next().unwrap_or(input.name);
        self.last_stl = None;
        let (meshes, paints, support_paints, moves) = if input.bytes.starts_with(b"PK\x03\x04") {
            let model = threemf::read(input.bytes)?;
            (model.meshes, model.paints, model.support_paints, None)
        } else {
            let (mut m, moves) = mesh::read_stl_moved(name, input.bytes)?;
            let n = m.vertices.len();
            // Its heights as Orca holds a part's, not dropped onto the bed on its own.
            mesh::settle_heights(&mut m.vertices, &[(0..n, 0.0)], false);
            (vec![m], vec![None], vec![None], Some(moves))
        };
        let group = match self.groups.last() {
            Some(&g) if !first => g,
            _ => self.groups.iter().map(|&g| g + 1).max().unwrap_or(0),
        };
        if let Some(moves) = moves {
            self.last_stl = Some((self.meshes.len(), moves));
        }
        self.paints.resize(self.meshes.len(), None);
        self.support_paints.resize(self.meshes.len(), None);
        for ((m, paint), supports) in meshes.into_iter().zip(paints).zip(support_paints) {
            self.meshes.push(m);
            self.groups.push(group);
            self.filaments.push(filament);
            self.paints.push(paint);
            self.support_paints.push(supports);
        }
        self.title.get_or_insert_with(|| name.to_string());
        self.read_ms += now() - t0;
        Ok(())
    }

    /// Paints the mesh the last STL added became (`add`, `add_in`, `add_part`): `paint`'s triangles are the STL's,
    /// in its order. False when the last model added wasn't an STL, or the paint names triangles it doesn't have.
    pub fn paint(&mut self, paint: &paint::Paint) -> bool {
        self.paint_kind(paint, false)
    }

    /// As `paint`, with painted supports (state 1 enforcing support, 2 blocking it).
    pub fn paint_supports(&mut self, paint: &paint::Paint) -> bool {
        self.paint_kind(paint, true)
    }

    fn paint_kind(&mut self, paint: &paint::Paint, supports: bool) -> bool {
        let Some((k, moves)) = &self.last_stl else { return false };
        let count = self.meshes[*k].triangles.len() as u32;
        let places = moves.new_places();
        if paint.triangles.iter().any(|&t| places(t).is_some_and(|n| n >= count)) {
            return false;
        }
        let moved = paint.moved(places);
        let paints = if supports { &mut self.support_paints } else { &mut self.paints };
        paints.resize(self.meshes.len(), None);
        paints[*k] = (!moved.is_empty()).then_some(moved);
        true
    }

    /// Lays the models on the plate and slices them with `settings` into a `.gcode.3mf`.
    pub fn slice(self, settings: &Settings, options: &Options) -> Result<Output, Error> {
        let Plate {
            mut meshes,
            mut filaments,
            mut groups,
            mut paints,
            mut support_paints,
            project,
            unassigned,
            title,
            read_ms,
            ..
        } = self;
        filaments.resize(meshes.len(), 0);
        if groups.len() != meshes.len() {
            groups = (0..meshes.len()).collect();
        }
        let t0 = now();
        if let Some(what) = settings.unsupported() {
            return Err(Error::Unsupported(what));
        }
        // With several filaments, each object prints in the one its file or its caller gives it (a project's object
        // its parts each in theirs): models that say nothing would all print in the first (with one filament,
        // everything prints in it, as Orca prints it).
        let several = settings.palette.as_ref().is_some_and(|p| p.profiles.len() > 1);
        if several && unassigned {
            return Err(Error::Unsupported("several filaments for models that don't say which they print in"));
        }
        if meshes.iter().all(|m| m.triangles.is_empty()) {
            return Err(Error::NoModel);
        }
        let keep: Vec<bool> = meshes.iter().map(|m| !m.triangles.is_empty()).collect();
        retain_by(&mut meshes, &mut filaments, &mut groups, [&mut paints, &mut support_paints], &keep);
        let scaled = options.scale > 0.0 && (options.scale - 100.0).abs() > 1e-9;
        paints.resize(meshes.len(), None);
        support_paints.resize(meshes.len(), None);
        for ((m, paint), supports) in meshes.iter_mut().zip(&mut paints).zip(&mut support_paints) {
            // A mesh turned right way out has its corners in the other order: its paint goes by the file's still.
            if m.signed_volume() < 0.0 {
                for paint in [paint, supports].into_iter().flatten() {
                    paint.turned.iter_mut().for_each(|t| *t = !*t);
                }
            }
            m.orient();
            if scaled {
                m.scale(options.scale / 100.0);
            }
        }
        if (options.arrange && !project) || scaled {
            mesh::arrange(&mut meshes, &groups, settings.bed, settings.max_height)?;
        } else {
            mesh::drop_to_bed(&mut meshes, &groups);
            // Kept where they are, as Orca keeps them: one partly off the plate stops the slice, and those wholly off
            // it (on a project's other plates) are left out. An object's parts are where the object is.
            let places: Vec<mesh::OnPlate> = meshes.iter().map(|m| mesh::on_plate(m, settings.bed)).collect();
            let place_of = |g: usize| {
                let mine: Vec<mesh::OnPlate> =
                    places.iter().zip(&groups).filter(|&(_, &k)| k == g).map(|(p, _)| *p).collect();
                if mine.iter().all(|p| *p == mine[0]) { mine[0] } else { mesh::OnPlate::Partly }
            };
            let places: Vec<mesh::OnPlate> = groups.iter().map(|&g| place_of(g)).collect();
            if places.contains(&mesh::OnPlate::Partly) {
                return Err(Error::OffPlate);
            }
            let keep: Vec<bool> = places.iter().map(|p| *p == mesh::OnPlate::Inside).collect();
            retain_by(&mut meshes, &mut filaments, &mut groups, [&mut paints, &mut support_paints], &keep);
            if meshes.is_empty() {
                return Err(Error::OffPlate);
            }
        }
        // Orca's settings for as many filaments as the plate prints in: with more than one, a prime tower.
        let palette_len = settings.palette.as_ref().map_or(1, |p| p.profiles.len());
        let used = if several {
            let mut used = filaments.clone();
            // Painted filaments print too (those the setup has), and the supports' own, with supports or a raft
            // (Orca's `Print::extruders`).
            for paint in paints.iter().flatten() {
                let states = paint.states();
                used.extend((1..=palette_len).filter(|&s| states & (1 << s) != 0).map(|s| s - 1));
            }
            if settings.enable_support || settings.support.raft_layers > 0 {
                let (base, interface) = settings.support.filaments(palette_len);
                used.extend(base.into_iter().chain(interface));
            }
            used.sort_unstable();
            used.dedup();
            used.len()
        } else {
            1
        };
        let for_plate = settings.for_filaments(used);
        let settings = &for_plate;
        if let Some(what) = settings.unsupported() {
            return Err(Error::Unsupported(what));
        }
        // In spiral vase mode Orca prints one object, and stops the slice when the plate has more: so the app's
        // fallback, Orca's engine, says why. An object made of parts there is left to Orca's engine too.
        let objects_on_plate = groups.iter().map(|&g| g + 1).max().unwrap_or(0);
        if settings.spiral_mode && objects_on_plate > 1 {
            return Err(Error::Unsupported("several objects in spiral vase mode"));
        }
        if settings.spiral_mode && meshes.len() > 1 {
            return Err(Error::Unsupported("an object made of parts in spiral vase mode"));
        }
        // Each object prints as a region for each filament its parts print in (with one filament, one region).
        let region_filaments: Vec<usize> = if several { filaments.clone() } else { vec![0; meshes.len()] };
        let mut parts = parts::Regions::new(&groups, &region_filaments);
        // Orca interlocks an object's filaments with beams where they meet (`InterlockingGenerator`), which isn't
        // ported: refused for an object in several, by its parts or its paint.
        let painted = several && paints.iter().flatten().any(|p| p.states() > 1);
        if settings.interlocking_beam && (parts.mixed() || painted) {
            return Err(Error::Unsupported("interlocking beams"));
        }
        let height = meshes.iter().map(|m| m.bounds().max[2]).fold(0.0, f64::max);
        if height > settings.max_height {
            return Err(Error::TooTall);
        }
        let t1 = now();
        // On a raft (`raft.rs`) the object starts over its contact layer, its first layer as thick as the others.
        let raft = raft::Raft::of(settings);
        let layers = match &raft {
            Some(r) => section::Layers::on_raft(height, settings.layer_height, r.object_z),
            None => section::Layers::plan(height, settings.first_layer_height, settings.layer_height),
        };
        // Slices simplified to half the profile's resolution, as before: Orca simplifies its own to 0.0025 mm, which
        // comes a little closer to its supports on a Benchy and makes every later step a third slower.
        // A spiral vase's layers above its bottom keep their outline's largest loop alone.
        let largest_from = if settings.spiral_mode { spiral::first_layer(&layers, settings) } else { usize::MAX };
        let (mut slices, mut owners) =
            section::slice(&meshes, &layers, settings.resolution / 2.0, settings.slice_closing_radius, largest_from);
        // An object's parts in different filaments: each part clipped by the parts after it, those of one filament
        // merged into a region (`parts.rs`); from here on each region is an object of its own, of its group.
        parts.assign(&mut slices, &mut owners, &meshes);
        // Painted objects: their regions re-split by their paint (`segment.rs`), each painted filament a region.
        if several {
            paint_regions(&mut parts, &mut slices, &mut owners, &meshes, &paints, &layers, settings);
        }
        let t2 = now();
        // The plate's objects, and one for each region (an object's own, unless its parts print in several filaments).
        let mut group_objects: Vec<Object> = parts
            .members
            .iter()
            .enumerate()
            .map(|(g, members)| Object::of_group(g, &members.iter().map(|&m| &meshes[m]).collect::<Vec<_>>()))
            .collect();
        // Each shape's object by group, for what Orca works out for whole objects.
        let group_owners = |owners: &[u32]| if parts.mixed() { parts.groups_of(owners) } else { owners.to_vec() };
        if let Some(first) = slices.first() {
            first_layers(&mut group_objects, first, &group_owners(&owners[0]));
        }
        let objects: Vec<Object> = parts.group.iter().map(|&g| group_objects[g as usize].clone()).collect();
        // The first layer as sliced, for the brims once the supports are known.
        let first = slices.first().cloned().unwrap_or_default();
        let first_owners = owners.first().cloned().unwrap_or_default();
        // Each object's infill pattern is anchored at the middle of its bounding box, as Orca anchors it.
        let centres: Vec<(f64, f64)> = objects
            .iter()
            .map(|o| ((o.min[0] + o.max[0]) / 2.0 * geom::SCALE, (o.min[1] + o.max[1]) / 2.0 * geom::SCALE))
            .collect();
        let sizes: Vec<(f64, f64)> = objects.iter().map(|o| (o.max[0] - o.min[0], o.max[1] - o.min[1])).collect();
        // Each object's mesh: all of its parts' (Orca sees an object's seams on its whole model, and builds its
        // adaptive infill's octree from it).
        let whole: Vec<Option<Mesh>> = parts
            .members
            .iter()
            .map(|members| (members.len() > 1).then(|| Mesh::merged(members.iter().map(|&m| &meshes[m]))))
            .collect();
        let by_group: Vec<&Mesh> =
            parts.members.iter().zip(&whole).map(|(members, w)| w.as_ref().unwrap_or(&meshes[members[0]])).collect();
        let mut regions = region::regions(&slices, &owners, &parts.group, &layers, &centres, &by_group, settings);
        // Where each wall loop starts, from the objects' outer walls and their surfaces (`seam.rs`). In spiral vase mode
        // Orca starts every loop where the nozzle is instead (`GCode::extrude_loop`), so there are none to place.
        if !settings.spiral_mode {
            let by_part: Vec<Vec<&Mesh>> =
                parts.members.iter().map(|members| members.iter().map(|&m| &meshes[m]).collect()).collect();
            seam::place(&mut regions, &by_part, &layers.slice_z(), &layers.height, settings);
        }
        // Where travels lift in spirals rather than slopes, for filaments that lift as Orca's Auto Lift does.
        let auto_lift = match &settings.palette {
            Some(p) if p.profiles.len() > 1 => p.profiles.iter().any(|f| config::Settings::auto_lifts(f)),
            _ => settings.z_hop_type == "Auto Lift",
        };
        let lift_overhangs = if auto_lift && settings.z_hop > 0.0 {
            let owners: Vec<Vec<u32>> = owners.iter().map(|o| group_owners(o)).collect();
            lift::Overhangs::find(&slices, &owners, &layers.top, settings.line_width)
        } else {
            lift::Overhangs::default()
        };
        drop((slices, owners));
        let t3 = now();
        // A raft is support too, which Orca builds whether or not supports are on. Each object's painted supports,
        // projected onto its layers, go with it while supports are on.
        let supports = if settings.enable_support || raft.is_some() {
            let painted: Vec<Option<PaintedSupports>> = if settings.enable_support {
                parts
                    .members
                    .iter()
                    .map(|members| painted_supports(members, &meshes, &support_paints, &layers))
                    .collect()
            } else {
                Vec::new()
            };
            object_supports(&regions, &layers, &centres, &sizes, &parts.group, &parts.filament, &painted, settings)
        } else {
            Vec::new()
        };
        // Without supports, whether an object needs them, as Orca checks it and warns.
        let warnings = if settings.enable_support {
            Vec::new()
        } else {
            support_warnings(&regions, &layers, &group_objects, settings)
        };
        // Each object's brim, round its first layer as sliced (all of its regions as one) and out of what the
        // supports' lowest layers print.
        let heights: Vec<f64> = group_objects.iter().map(|o| o.max[2] - o.min[2]).collect();
        let support_cover: Vec<geom::Shapes> =
            supports.iter().filter_map(|layers| layers.first()).map(support::cover).collect();
        let support_cover = geom::union_all(&support_cover.iter().collect::<Vec<_>>());
        let brims = if parts.mixed() {
            let (shapes, owners) = parts::group_slices(&first, &parts.groups_of(&first_owners));
            brim::brims(&shapes, &owners, &heights, &support_cover, settings)
        } else {
            brim::brims(&first, &first_owners, &heights, &support_cover, settings)
        };
        let facts = first_layer_facts(&first, &layers, &brims, settings);
        let facts = with_support(facts, &supports, settings);
        let schedule = schedule(&layers, &supports, objects.len());
        let t4 = now();
        // Several filaments: the order they print in on each layer, and the prime tower (`toolchange.rs`).
        let colours = settings.palette.as_ref().filter(|p| p.profiles.len() > 1).map(|palette| {
            // Each layer's objects that print islands in their filaments, and its supports, which print in whichever
            // the layer has.
            let layer_objects: Vec<Vec<usize>> = schedule
                .iter()
                .map(|slot| {
                    let mut here: Vec<usize> = match slot.layer {
                        Some(l) => (0..regions[l].islands.len())
                            .filter(|&k| regions[l].prints(k))
                            .map(|k| regions[l].islands[k].object as usize)
                            .collect(),
                        None => Vec::new(),
                    };
                    here.sort_unstable();
                    here.dedup();
                    here
                })
                .collect();
            let last = last_layers(&regions, group_objects.len());
            let layer_supports: Vec<Vec<toolchange::SupportHere>> = schedule
                .iter()
                .map(|slot| {
                    let on = |o: usize, k: usize| {
                        let layer = &supports[o][k];
                        (!layer.items.is_empty()).then(|| toolchange::SupportHere {
                            object: o,
                            with_layer: slot.layer.is_some_and(|l| last[parts.group[o] as usize] >= Some(l)),
                            items: layer.items.iter().map(|item| (item.part(), item.volume())).collect(),
                        })
                    };
                    slot.supports.iter().enumerate().filter_map(|(o, k)| on(o, (*k)?)).collect()
                })
                .collect();
            let zs: Vec<f64> = schedule.iter().map(|slot| slot.z).collect();
            let hs: Vec<f64> = zs.iter().enumerate().map(|(g, z)| if g == 0 { *z } else { z - zs[g - 1] }).collect();
            // Each object's smallest island on the first layer, which orders the first layer's filaments.
            let mut first_island = vec![f64::INFINITY; objects.len()];
            for (shape, &o) in first.iter().zip(&first_owners) {
                if let (Some(outer), Some(f)) = (shape.first(), first_island.get_mut(o as usize)) {
                    *f = f.min(geom::area2(outer) as f64 / 2.0 / (geom::SCALE * geom::SCALE));
                }
            }
            // How far each object's slices reach on the plate and how high, which decide the nozzles that can
            // print it.
            let mut reach = vec![[f64::MAX, f64::MAX, f64::MIN, f64::MIN]; objects.len()];
            let mut tops = vec![0.0f64; objects.len()];
            for (r, &top) in regions.iter().zip(&layers.top) {
                for island in &r.islands {
                    let o = island.object as usize;
                    tops[o] = tops[o].max(top);
                    for p in island.outline.iter().flatten() {
                        let (x, y) = (f64::from(p.x) / geom::SCALE, f64::from(p.y) / geom::SCALE);
                        let b = &mut reach[o];
                        *b = [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)];
                    }
                }
            }
            toolchange::Colours::prepare(
                settings,
                palette,
                &toolchange::Plate {
                    object_filament: &parts.filament,
                    layer_objects: &layer_objects,
                    layer_supports: &layer_supports,
                    layer_z: &zs,
                    layer_h: &hs,
                    first_island: &first_island,
                    object_boxes: &objects.iter().map(|o| [o.min[0], o.min[1], o.max[0], o.max[1]]).collect::<Vec<_>>(),
                    object_reach: &reach,
                    object_tops: &tops,
                },
            )
        });
        let colours = colours.transpose().map_err(Error::Unsupported)?;
        // The bed's probing covers the prime tower's first layer too, grown by the skirt distance as the objects are
        // (Orca's skirt hull takes in the tower).
        let facts = match &colours {
            Some(c) => c.first_layer_corners.iter().fold(facts, |mut f, p| {
                let m = settings.skirt_distance;
                f.first_layer_min = [f.first_layer_min[0].min(p[0] - m), f.first_layer_min[1].min(p[1] - m)];
                f.first_layer_max = [f.first_layer_max[0].max(p[0] + m), f.first_layer_max[1].max(p[1] + m)];
                f
            }),
            None => facts,
        };
        // Each object's brim prints when Orca first comes to the object on the first layer: with the first of the
        // layer's filaments that prints any of it, its islands or its support.
        let brim_loops = brims.loops;
        let brim_passes: Vec<Option<usize>> = match &colours {
            Some(c) => {
                let g0 = schedule.iter().position(|slot| slot.layer == Some(0));
                let order = g0.and_then(|g| c.orders.get(g)).map_or(&[][..], Vec::as_slice);
                // The first layer's islands that print something.
                let firsts: Vec<&region::Island> = regions.first().map_or(Vec::new(), |r| {
                    r.islands.iter().enumerate().filter(|&(k, _)| r.prints(k)).map(|(_, i)| i).collect()
                });
                let supports_by: Vec<Vec<Option<support::Pass>>> = match g0 {
                    Some(g) => order.iter().map(|&f| c.supports_of(g, f, objects.len())).collect(),
                    None => Vec::new(),
                };
                (0..group_objects.len())
                    .map(|g| {
                        let mine = |r: usize| parts.group[r] as usize == g;
                        order.iter().enumerate().find_map(|(k, &f)| {
                            let islands = firsts
                                .iter()
                                .any(|i| mine(i.object as usize) && parts.filament[i.object as usize] == f);
                            let support = supports_by[k].iter().enumerate().any(|(r, p)| p.is_some() && mine(r));
                            (islands || support).then_some(f)
                        })
                    })
                    .collect()
            }
            None => Vec::new(),
        };
        let mut frame = bambu::Frame::new(settings.profile.clone(), &facts);
        if let (Some(c), Some(palette)) = (&colours, &settings.palette) {
            c.frame_vars(&mut frame, palette);
        }
        let zs: Vec<f64> = schedule.iter().map(|slot| slot.z).collect();
        let photos = timelapse_spots(&group_objects, &zs, settings);
        let job = gcode::Job {
            settings,
            frame: &frame,
            objects: &objects,
            photos: &photos,
            start: frame.start_position(),
            colours: colours.as_ref(),
            lift_overhangs: &lift_overhangs,
        };
        // Each layer from its regions to its G-code in one go, so only the text stays; the support's own layers
        // with the object layer above them, which they are cooled with, but for a raft's, each cooled on its own.
        let empty = region::LayerRegions::default();
        let mut groups: Vec<std::ops::Range<usize>> = Vec::new();
        for (g, slot) in schedule.iter().enumerate() {
            let raft = slot.supports.iter().enumerate().any(|(o, k)| k.is_some_and(|k| supports[o][k].raft));
            if slot.layer.is_some() || raft || g + 1 == schedule.len() {
                groups.push(groups.last().map_or(0, |r| r.end)..g + 1);
            }
        }
        // Each layer's regions go as soon as the last group that reads them (its own, and the next one's, which
        // hangs over them) has made its G-code: the layers' texts take their place rather than adding to them.
        let mut readers: Vec<std::sync::atomic::AtomicUsize> = Vec::with_capacity(regions.len());
        readers.resize_with(regions.len(), Default::default);
        let read_by = |k: usize| -> Vec<usize> {
            let mut read: Vec<usize> = groups[k]
                .clone()
                .filter_map(|g| schedule[g].layer)
                .flat_map(|l| [Some(l), l.checked_sub(1)])
                .flatten()
                .collect();
            read.sort_unstable();
            read.dedup();
            read
        };
        for k in 0..groups.len() {
            for l in read_by(k) {
                *readers[l].get_mut() += 1;
            }
        }
        let regions: Vec<std::sync::Mutex<Option<std::sync::Arc<region::LayerRegions>>>> =
            regions.into_iter().map(|r| std::sync::Mutex::new(Some(std::sync::Arc::new(r)))).collect();
        let held = |l: usize| -> std::sync::Arc<region::LayerRegions> {
            regions[l].lock().unwrap().clone().expect("a layer's regions, until its last reader is done")
        };
        let empty = std::sync::Arc::new(empty);
        // In spiral vase mode each layer starts where the one before ended, so the layers go one after another.
        let group_texts = |k: usize, mut spiral: Option<&mut spiral::State>| -> Vec<gcode::LayerGcode> {
            let plans: Vec<(plan::LayerPlan, std::sync::Arc<region::LayerRegions>, f64)> = groups[k]
                .clone()
                .map(|g| {
                    let slot = &schedule[g];
                    let here: Vec<Option<&support::Layer>> =
                        slot.supports.iter().enumerate().map(|(o, k)| k.map(|k| &supports[o][k])).collect();
                    // A layer of the support's own is planned as an object layer with nothing in it (`next` stands
                    // in for its index: no first layer, no layer below to hang over).
                    let (l, held_here) = match slot.layer {
                        Some(l) => (l, held(l)),
                        None => (slot.next, empty.clone()),
                    };
                    let regions_here = &*held_here;
                    let held_lower = slot.layer.and_then(|l| l.checked_sub(1)).map(held);
                    let lower = held_lower.as_deref();
                    let h = slot.layer.map_or(slot.header_height as f64, |l| layers.height[l]);
                    let mut plan = match &colours {
                        Some(c) if !c.orders[g].is_empty() => {
                            let plans = c.orders[g]
                                .iter()
                                .map(|&f| {
                                    let islands: Vec<bool> = c.object_filament.iter().map(|&of| of == f).collect();
                                    let supports = c.supports_of(g, f, islands.len());
                                    let brims: Vec<bool> = brim_passes.iter().map(|&p| p == Some(f)).collect();
                                    let only = plan::Only {
                                        islands: &islands,
                                        supports: &supports,
                                        brims: &brims,
                                        group: &parts.group,
                                        flushing: c.flushing(g),
                                    };
                                    let s = &c.settings[f];
                                    let plan = plan::plan_layer_of(
                                        Some(&only),
                                        regions_here,
                                        lower,
                                        l,
                                        (slot.z, h),
                                        &centres,
                                        &brim_loops,
                                        &here,
                                        spiral.as_ref().map(|st| st.at),
                                        s,
                                    );
                                    (f, plan)
                                })
                                .collect();
                            c.combine(g, plans, &frame)
                        }
                        _ => plan::plan_layer(
                            regions_here,
                            lower,
                            l,
                            (slot.z, h),
                            &centres,
                            &brim_loops,
                            &here,
                            spiral.as_ref().map(|st| st.at),
                            settings,
                        ),
                    };
                    (plan.index, plan.id, plan.header_height) = (g, slot.id, slot.header_height);
                    let from_z = if g == 0 { job.start[2] } else { schedule[g - 1].z + settings.z_hop };
                    let from_z = match spiral.as_deref_mut() {
                        Some(st) => {
                            plan.spiral &= plan.visits.is_empty();
                            st.course(&mut plan, slot.z, g + 1 == schedule.len(), settings)
                        }
                        None => from_z,
                    };
                    (plan, held_here, from_z)
                })
                .collect();
            let group: Vec<(&plan::LayerPlan, &region::LayerRegions, f64)> =
                plans.iter().map(|(plan, r, z)| (plan, &**r, *z)).collect();
            let texts = gcode::layers(&group, &job);
            if let Some(st) = spiral {
                st.turned(&texts);
            }
            drop(group);
            drop(plans);
            for l in read_by(k) {
                if readers[l].fetch_sub(1, std::sync::atomic::Ordering::AcqRel) == 1 {
                    regions[l].lock().unwrap().take();
                }
            }
            texts
        };
        let texts: Vec<Vec<gcode::LayerGcode>> = if settings.spiral_mode {
            let mut st = spiral::State::new(job.start);
            (0..groups.len()).map(|k| group_texts(k, Some(&mut st))).collect()
        } else {
            par::map_range(groups.len(), |k| group_texts(k, None))
        };
        let texts: Vec<gcode::LayerGcode> = texts.into_iter().flatten().collect();
        drop(regions);
        let t5 = now();
        let preheat = colours.as_ref().and_then(preheat::Params::of);
        let (text, packed, stats) = if options.gcode || preheat.is_some() {
            let mut g = gcode::assemble(texts, &job);
            // Orca's pre-cooling and pre-heating of the nozzle that waits, added after the estimate as Orca adds it.
            if let Some(p) = preheat
                && let Some(text) = preheat::add_lines(&g.text, &p, settings)
            {
                g.text = text;
            }
            let packed = zip::Deflated::of(&g.text, pack::GCODE_LEVEL);
            (if options.gcode { g.text } else { Vec::new() }, packed, g.stats)
        } else {
            // Each layer's text packed as it's written and let go.
            let stats = gcode::totals(&texts, &job);
            let mut packer = zip::Deflater::with_md5(pack::GCODE_LEVEL);
            gcode::write(texts, &stats, &job, &mut packer);
            (Vec::new(), packer.finish(), stats)
        };
        let t6 = now();
        let thumbnail = options.thumbnail.then(|| {
            let size = 512;
            let picture = match &settings.palette {
                // Each object in its filament's colour.
                Some(p) if p.profiles.len() > 1 => {
                    let each: Vec<&str> = filaments
                        .iter()
                        .map(|&f| p.colours.get(f).map_or(settings.filament_colour.as_str(), String::as_str))
                        .collect();
                    png::render_each(&meshes, size, &each)
                }
                _ => png::render(&meshes, size, &settings.filament_colour),
            };
            png::encode(&picture, size, size)
        });
        let t7 = now();
        let title = title.as_deref().unwrap_or("Model");
        let file = pack::gcode_3mf(
            &packed,
            thumbnail.as_deref(),
            &stats,
            &group_objects,
            settings,
            title,
            colours.as_ref(),
            &pack::Model { meshes: &meshes, members: &parts.members, filaments: &filaments },
        );
        let t8 = now();
        Ok(Output {
            file,
            gcode: text,
            gcode_bytes: packed.size,
            stats,
            timings: Timings {
                read: read_ms + t1 - t0,
                slice: t2 - t1,
                regions: t3 - t2,
                supports: t4 - t3,
                toolpaths: t5 - t4,
                gcode: t6 - t5,
                thumbnail: t7 - t6,
                pack: t8 - t7,
                total: read_ms + t8 - t0,
            },
            triangles: meshes.iter().map(|m| m.triangles.len()).sum(),
            fallbacks: settings.fallbacks(),
            warnings,
        })
    }
}

/// What the printer's start G-code needs to know about the first layer, as Orca works it out: the extent of its
/// outline and brims grown by the skirt distance (Orca's first-layer hull takes in the skirt's, which it draws that
/// far out even with no skirt loops), its area with the brims' lines, the print's height and the plate.
fn first_layer_facts(
    first: &geom::Shapes,
    layers: &section::Layers,
    brims: &brim::Brims,
    s: &Settings,
) -> bambu::Facts {
    if layers.top.is_empty() {
        return bambu::Facts::default();
    }
    let margin = s.skirt_distance;
    // The brims count as part of the first layer, as Orca counts them.
    let b = [geom::bbox(first), geom::bbox(&brims.area)]
        .into_iter()
        .flatten()
        .reduce(|a, b| [a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])])
        .map(|b| b.map(geom::unsc))
        .unwrap_or([0.0; 4]);
    bambu::Facts {
        first_layer_min: [b[0] - margin, b[1] - margin],
        first_layer_max: [b[2] + margin, b[3] + margin],
        first_layer_area: geom::area_mm2(first) + brims.covered_mm2(s),
        top: layers.top.last().copied().unwrap_or(0.0),
        bed_type: s.bed_type.to_string(),
    }
}

/// Where the timelapse photo is taken after each layer (at `zs`): Orca's pick, which changes only when the objects
/// standing at the layer's height (in whole millimetres) do.
fn timelapse_spots(objects: &[Object], zs: &[f64], s: &Settings) -> Vec<Option<[i64; 2]>> {
    let mut spots = Vec::with_capacity(zs.len());
    let mut last: Option<(Vec<bool>, Option<[i64; 2]>)> = None;
    for &z in zs {
        let at = z as i64;
        let standing: Vec<bool> = objects.iter().map(|o| (o.min[2] as i64) <= at && at <= (o.max[2] as i64)).collect();
        let spot = match &last {
            Some((before, spot)) if *before == standing => *spot,
            _ => bambu::timelapse_position(objects, z, s.bed, s.extruder_clearance_radius),
        };
        spots.push(spot);
        last = Some((standing, spot));
    }
    spots
}

/// Each object's highest layer, if it has any (by group: all of an object's regions).
fn last_layers(regions: &[region::LayerRegions], objects: usize) -> Vec<Option<usize>> {
    let mut last = vec![None; objects];
    for (l, r) in regions.iter().enumerate() {
        for island in &r.islands {
            if let Some(last) = last.get_mut(island.group as usize) {
                *last = Some(l);
            }
        }
    }
    last
}

/// Orca's warning for each object sliced without supports that needs them (`PrintObject::is_support_necessary`, which
/// runs its trees' overhang detection on the object whatever the support settings). `objects` are the plate's, one
/// for each group.
fn support_warnings(
    regions: &[region::LayerRegions],
    layers: &section::Layers,
    objects: &[Object],
    s: &Settings,
) -> Vec<Warning> {
    let last = last_layers(regions, objects.len());
    objects
        .iter()
        .enumerate()
        .filter_map(|(o, object)| {
            let top = last[o]?;
            let slices: Vec<geom::Shapes> = regions[..=top].iter().map(|r| r.slice_of(o as u32)).collect();
            tree::necessity(&slices, &layers.height[..=top], s).map(|why| Warning::needs_support(&object.name, why))
        })
        .collect()
}

/// An object's painted supports on each of its layers (`segment::support_slabs`): enforced areas, blocked ones (each
/// none where nothing is painted so), and its upright enforced leaves, each with the layer it is on.
type PaintedSupports = (Vec<geom::Shapes>, Vec<geom::Shapes>, Vec<(usize, segment::Upright)>);

/// The painted supports of the object made of the meshes `members`, as Orca projects its parts' onto its layers;
/// None when none of them has any.
fn painted_supports(
    members: &[usize],
    meshes: &[Mesh],
    support_paints: &[Option<paint::Paint>],
    layers: &section::Layers,
) -> Option<PaintedSupports> {
    let painted: Vec<(&Mesh, &paint::Paint)> = members
        .iter()
        .filter_map(|&m| support_paints.get(m).and_then(Option::as_ref).map(|p| (&meshes[m], p)))
        .collect();
    let (facets, upright) = segment::support_facets(&painted);
    (!facets.is_empty()).then(|| {
        let slice_z = layers.slice_z();
        let (enforcers, blockers) = segment::support_slabs(&facets, &slice_z);
        // An upright leaf is on the first layer sliced at or over its centre (Orca's `lower_bound` of the layers'
        // slicing heights, as floats).
        let upright = upright
            .into_iter()
            .filter_map(|u| {
                let l = slice_z.partition_point(|&z| (z as f32) < u.z);
                (l < slice_z.len()).then_some((l, u))
            })
            .collect();
        (enforcers, blockers, upright)
    })
}

/// Each object's supports (`support.rs`, `tree/`), from its slices and top surfaces up to its last layer. An object
/// on the plate made of regions in different filaments (`group` gives each region's) has its supports worked out for
/// all of it, as Orca works them out, and kept with its first region; its other regions have none. Its painted supports
/// (`painted`, by object) enforce and block support as Orca's do.
#[allow(clippy::too_many_arguments)]
fn object_supports(
    regions: &[region::LayerRegions],
    layers: &section::Layers,
    centres: &[(f64, f64)],
    sizes: &[(f64, f64)],
    group: &[u32],
    filament: &[usize],
    painted: &[Option<PaintedSupports>],
    s: &Settings,
) -> Vec<Vec<support::Layer>> {
    let groups = group.iter().map(|&g| g as usize + 1).max().unwrap_or(0);
    let mut first_region: Vec<Option<usize>> = vec![None; groups];
    for (o, &g) in group.iter().enumerate() {
        first_region[g as usize].get_or_insert(o);
    }
    let params = support::Params::new(s);
    let last = last_layers(regions, groups);
    let mut by_group: Vec<Vec<support::Layer>> = (0..groups)
        .map(|g| {
            let (Some(top), Some(o)) = (last[g], first_region[g]) else { return Vec::new() };
            // The filaments the object's regions print in.
            let own: Vec<usize> =
                group.iter().zip(filament).filter(|(r, _)| **r as usize == g).map(|(_, &f)| f).collect();
            let params = params.for_object(&own);
            let slices: Vec<geom::Shapes> = regions[..=top].iter().map(|r| r.slice_of(g as u32)).collect();
            // The layers' top surfaces, each object's own.
            let tops = regions[..=top]
                .iter()
                .zip(&slices)
                .map(|(r, slice)| {
                    if r.tops.is_empty() || slice.is_empty() {
                        Vec::new()
                    } else if groups == 1 {
                        r.tops.clone()
                    } else {
                        geom::intersection(&r.tops, slice)
                    }
                })
                .collect();
            // Up to its last layer (each kind none where nothing is painted so).
            let upto = |v: &Vec<geom::Shapes>| v.iter().take(top + 1).cloned().collect::<Vec<_>>();
            let (enforcers, blockers, upright) = match painted.get(g).and_then(Option::as_ref) {
                Some((e, b, u)) => (upto(e), upto(b), u.iter().filter(|(l, _)| *l <= top).copied().collect()),
                None => (Vec::new(), Vec::new(), Vec::new()),
            };
            // With `bridge_no_support`, what each layer bridges, which Orca's normal supports leave unsupported (its
            // trees don't read the setting).
            let normal = s.enable_support && s.support.classic().is_none() && !s.support.organic();
            let bridging = if normal && s.support.bridge_no_support {
                regions[..=top]
                    .iter()
                    .zip(&layers.height[..=top])
                    .map(|(r, &h)| {
                        let mut b = support::Bridging::default();
                        for (k, island) in r.islands.iter().enumerate().filter(|(_, i)| i.group == g as u32) {
                            b.walls.extend(island.walls.iter().flatten().cloned());
                            // Orca's fill surfaces reach into the innermost wall by the overlap (ours get it when
                            // planned): the bridges with their share of that band.
                            if let Some(f) = r.fills.get(k).filter(|f| !f.bridge.is_empty()) {
                                if island.overlap > 0.0 {
                                    let band =
                                        geom::difference(&geom::offset(&island.inner, island.overlap), &island.inner);
                                    let reach = geom::intersection(&geom::offset(&f.bridge, island.overlap), &band);
                                    b.fills.extend(geom::union(&f.bridge, &reach));
                                } else {
                                    b.fills.extend(f.bridge.iter().cloned());
                                }
                            }
                        }
                        let flow = s.overhang_wall_flow(h);
                        b.half_width = 0.5 * (flow.width as f32).max(flow.spacing as f32) as f64 + 0.001;
                        b.nozzle = s.nozzle_diameter;
                        b
                    })
                    .collect()
            } else {
                Vec::new()
            };
            let object = support::Object {
                print_z: &layers.top[..=top],
                height: &layers.height[..=top],
                slices,
                tops,
                origin: centres[o],
                size: sizes[o],
                enforcers,
                blockers,
                upright,
                bridging,
            };
            if !s.enable_support {
                // Supports off: a raft alone, as the generator Orca takes for these supports makes it (`unsupported`
                // refuses its classic trees').
                match s.support.raft_maker() {
                    config::RaftMaker::OrganicTrees => support::raft_alone(&object, &params),
                    _ => support::generate(&object, &params),
                }
            } else if s.support.classic().is_some() {
                tree::classic::supports(&object, s, &params)
            } else if s.support.organic() {
                // With nothing to hold up, a raft alone (Orca's `generate_raft_contact`), if there is one.
                tree::supports(&object.slices, object.height, s, object.origin, s.bed, &object.painted()).map_or_else(
                    || support::raft_alone(&object, &params),
                    |t| support::generate_tree(&object, &params, t),
                )
            } else {
                support::generate(&object, &params)
            }
        })
        .collect();
    (0..group.len())
        .map(|o| {
            let g = group[o] as usize;
            if first_region[g] == Some(o) { std::mem::take(&mut by_group[g]) } else { Vec::new() }
        })
        .collect()
}

/// The first layer's extent with the support's first layer in it: its extrusions, grown by the skirt distance as
/// the objects' outlines are (Orca's skirt hull takes in the support's points).
fn with_support(mut facts: bambu::Facts, supports: &[Vec<support::Layer>], s: &Settings) -> bambu::Facts {
    let margin = s.skirt_distance;
    for layer in supports.iter().filter_map(|layers| layers.first()) {
        if !layer.first {
            continue;
        }
        let points = layer.items.iter().flat_map(|item| match item {
            support::Item::Path(p) => std::slice::from_ref(p),
            support::Item::Fixed(group) => group.as_slice(),
        });
        for p in points.flat_map(|p| &p.points) {
            let (x, y) = (geom::unsc(p.x), geom::unsc(p.y));
            facts.first_layer_min =
                [facts.first_layer_min[0].min(x - margin), facts.first_layer_min[1].min(y - margin)];
            facts.first_layer_max =
                [facts.first_layer_max[0].max(x + margin), facts.first_layer_max[1].max(y + margin)];
        }
    }
    facts
}

/// One of the G-code's layers: an object layer, with any support printed with it, or a layer of the support's own.
struct Slot {
    /// The layer's top, as its header gives it: the object layer's, else the first object's support layer's.
    z: f64,
    /// The object layer printed (the plate's layer index), if any.
    layer: Option<usize>,
    /// For a layer of the support's own, the object layer above it.
    next: usize,
    /// Each object's support layer printed with it.
    supports: Vec<Option<usize>>,
    /// Orca's id of the layer (the object layer's index, else the first object's support layer's), which its fans
    /// count by.
    id: usize,
    /// The height the header gives: from the layer before's top, in single precision as Orca works it out.
    header_height: f32,
}

/// The G-code's layers, as Orca pairs each object's layers with its support layers (within 0.1 µm of each other)
/// and merges the objects' (within 0.1 µm): the plate's layers, and between them the support's own, at the heights
/// it was evened out to.
fn schedule(layers: &section::Layers, supports: &[Vec<support::Layer>], objects: usize) -> Vec<Slot> {
    const EPSILON: f64 = 1e-4;
    let n = layers.top.len();
    let mut slots: Vec<Slot> = (0..n)
        .map(|l| Slot {
            z: layers.top[l],
            layer: Some(l),
            next: l,
            supports: vec![None; objects],
            id: l,
            header_height: 0.0,
        })
        .collect();
    // Support layers that pair with an object layer print with it; the others, merged across the objects.
    let mut own: Vec<(f64, usize, usize)> = Vec::new();
    for (o, list) in supports.iter().enumerate() {
        for (k, layer) in list.iter().enumerate() {
            let l = layers.top.partition_point(|&z| z < layer.print_z - EPSILON);
            if l < n && layers.top[l] <= layer.print_z + EPSILON {
                slots[l].supports[o] = Some(k);
            } else if !layer.items.is_empty() {
                // A layer of the support's own with nothing to print (an area too thin to fill) is left out: Orca
                // writes nothing for a layer with nothing to extrude, not even its layer change.
                own.push((layer.print_z, o, k));
            }
        }
    }
    own.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
    let mut i = 0;
    while i < own.len() {
        let zmax = own[i].0 + EPSILON;
        let mut j = i + 1;
        while j < own.len() && own[j].0 <= zmax {
            j += 1;
        }
        let mut slot = Slot {
            z: 0.0,
            layer: None,
            next: layers.top.partition_point(|&z| z < own[i].0).min(n.saturating_sub(1)),
            supports: vec![None; objects],
            id: 0,
            header_height: 0.0,
        };
        // The header's: the first object's.
        let &(z, _, k) = own[i..j].iter().min_by_key(|&&(_, o, _)| o).unwrap();
        (slot.z, slot.id) = (z, k);
        for &(_, o, k) in &own[i..j] {
            slot.supports[o].get_or_insert(k);
        }
        slots.push(slot);
        i = j;
    }
    slots.sort_by(|a, b| a.z.total_cmp(&b.z));
    let mut below = 0.0f32;
    for (g, slot) in slots.iter_mut().enumerate() {
        let z = slot.z as f32;
        slot.header_height = if g == 0 { z } else { z - below };
        below = z;
    }
    slots
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Not an STL or 3MF this reads.
    Unreadable,
    /// No triangles in it.
    NoModel,
    TooBig,
    TooTall,
    TooMany,
    /// Kept where a project or the caller put it, an object lies partly off the plate, or none lies on it.
    OffPlate,
    /// A slice setup that isn't one (`setup.rs`).
    Setup,
    /// Settings this can't slice yet: what they ask for ("a raft in this style of tree support"…).
    Unsupported(&'static str),
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Error::Unreadable => "can't read this file as an STL or a 3MF",
            Error::NoModel => "this file has no model in it",
            Error::TooBig => "too big for the plate",
            Error::TooTall => "too tall for the printer",
            Error::TooMany => "too many objects for one plate",
            Error::OffPlate => "an object lies off the plate",
            Error::Setup => "can't read the slice setup",
            Error::Unsupported(what) => return write!(f, "can't slice with {what} yet"),
        })
    }
}

impl std::error::Error for Error {}

/// Runs work on every core where there are threads (rayon), else one item after the other.
pub mod par {
    #[cfg(feature = "parallel")]
    pub fn map_range<T: Send, F: Fn(usize) -> T + Sync + Send>(n: usize, f: F) -> Vec<T> {
        use rayon::prelude::*;
        (0..n).into_par_iter().map(f).collect()
    }

    #[cfg(not(feature = "parallel"))]
    pub fn map_range<T, F: Fn(usize) -> T>(n: usize, f: F) -> Vec<T> {
        (0..n).map(f).collect()
    }

    /// Each item's result, in order (on every core where there are threads).
    #[cfg(feature = "parallel")]
    pub fn map_vec<T: Send, R: Send, F: Fn(T) -> R + Sync + Send>(items: Vec<T>, f: F) -> Vec<R> {
        use rayon::prelude::*;
        items.into_par_iter().map(f).collect()
    }

    #[cfg(not(feature = "parallel"))]
    pub fn map_vec<T, R, F: Fn(T) -> R>(items: Vec<T>, f: F) -> Vec<R> {
        items.into_iter().map(f).collect()
    }

    #[cfg(feature = "parallel")]
    pub fn join<A: Send, B: Send>(a: impl FnOnce() -> A + Send, b: impl FnOnce() -> B + Send) -> (A, B) {
        rayon::join(a, b)
    }

    #[cfg(not(feature = "parallel"))]
    pub fn join<A, B>(a: impl FnOnce() -> A, b: impl FnOnce() -> B) -> (A, B) {
        (a(), b())
    }
}
