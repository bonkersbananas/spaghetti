//! Spaghetti's experimental slicer: STL and plain 3MF in, a Bambu-flavoured `.gcode.3mf` out, with the defaults of
//! decision 0046. Built for speed: layers are sliced, walled and filled in parallel (one thread in WebAssembly), on
//! exact integer geometry. See `docs/proposals/rust-slicer.md` for what it does, how fast, and what it lacks.

pub mod bambu;
pub mod config;
pub mod gcode;
pub mod geom;
pub mod infill;
pub mod json;
pub mod medial;
pub mod mesh;
pub mod pack;
pub mod plan;
pub mod png;
pub mod profile;
pub mod region;
pub mod section;
pub mod template;
pub mod threemf;
#[cfg(target_arch = "wasm32")]
mod wasm;
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
    /// mm on the plate: the lowest corner of its bounding box, then the highest.
    pub min: [f64; 3],
    pub max: [f64; 3],
    /// Its first layer's extent on the plate (min x, min y, max x, max y, mm) and area (mm²), which the plate's
    /// description gives the printer.
    pub first_layer: [f64; 4],
    pub first_layer_area: f64,
}

impl Object {
    fn from_mesh(index: usize, m: &Mesh) -> Object {
        let b = m.bounds();
        Object {
            name: m.name.clone(),
            label: index as u32 + 1,
            min: b.min,
            max: b.max,
            first_layer: [b.min[0], b.min[1], b.max[0], b.max[1]],
            first_layer_area: 0.0,
        }
    }
}

/// Gives each object the parts of the first layer's outline that lie on it: their extent and area.
fn first_layers(objects: &mut [Object], first: &geom::Shapes) {
    let mut seen = vec![false; objects.len()];
    for shape in first {
        let b = geom::bbox_of(shape).map(geom::unsc);
        let (x, y) = ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0);
        let distance =
            |o: &Object| (o.min[0] - x).max(x - o.max[0]).max(0.0).hypot((o.min[1] - y).max(y - o.max[1]).max(0.0));
        let Some(k) = (0..objects.len()).min_by(|&a, &b| distance(&objects[a]).total_cmp(&distance(&objects[b])))
        else {
            return;
        };
        let o = &mut objects[k];
        o.first_layer = if seen[k] {
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
        seen[k] = true;
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
}

impl Default for Options {
    fn default() -> Self {
        Options { arrange: true, thumbnail: true }
    }
}

/// Milliseconds each step took.
#[derive(Clone, Debug, Default)]
pub struct Timings {
    pub read: f64,
    pub slice: f64,
    pub regions: f64,
    /// Each layer's paths in order, its moves, their timing and its G-code text.
    pub toolpaths: f64,
    /// The layers' G-code into one file, with the header and the progress marks.
    pub gcode: f64,
    pub thumbnail: f64,
    pub pack: f64,
    pub total: f64,
}

pub struct Output {
    /// The `.gcode.3mf`.
    pub file: Vec<u8>,
    pub gcode: Vec<u8>,
    pub stats: Stats,
    pub timings: Timings,
    pub triangles: usize,
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

/// Models read from their files, not yet laid out or sliced. Adding the files one at a time lets each file's bytes
/// go as soon as it is read, so a plate of big models never holds all of its files and all of its slices at once.
#[derive(Default)]
pub struct Plate {
    meshes: Vec<Mesh>,
    project: bool,
    title: Option<String>,
    read_ms: f64,
}

impl Plate {
    /// Reads one STL or 3MF file onto the plate.
    pub fn add(&mut self, input: &Input) -> Result<(), Error> {
        let t0 = now();
        let name = input.name.rsplit(['/', '\\']).next().unwrap_or(input.name);
        if input.bytes.starts_with(b"PK\x03\x04") {
            let model = threemf::read(input.bytes)?;
            self.project |= model.project;
            self.meshes.extend(model.meshes);
        } else {
            self.meshes.push(mesh::read_stl(name, input.bytes)?);
        }
        self.title.get_or_insert_with(|| name.to_string());
        self.read_ms += now() - t0;
        Ok(())
    }

    /// Lays the models on the plate and slices them with `settings` into a `.gcode.3mf`.
    pub fn slice(self, settings: &Settings, options: &Options) -> Result<Output, Error> {
        let Plate { mut meshes, project, title, read_ms } = self;
        let t0 = now();
        if meshes.iter().all(|m| m.triangles.is_empty()) {
            return Err(Error::NoModel);
        }
        meshes.retain(|m| !m.triangles.is_empty());
        for m in &mut meshes {
            m.orient();
        }
        if options.arrange && !project {
            mesh::arrange(&mut meshes, settings.bed, settings.max_height)?;
        } else {
            mesh::drop_to_bed(&mut meshes);
        }
        let height = meshes.iter().map(|m| m.bounds().max[2]).fold(0.0, f64::max);
        if height > settings.max_height {
            return Err(Error::TooTall);
        }
        let t1 = now();
        let layers = section::Layers::plan(height, settings.first_layer_height, settings.layer_height);
        let slices = section::slice(&meshes, &layers, settings.resolution);
        let t2 = now();
        let facts = first_layer_facts(&slices, &layers, settings);
        let mut objects: Vec<Object> = meshes.iter().enumerate().map(|(i, m)| Object::from_mesh(i, m)).collect();
        if let Some(first) = slices.first() {
            first_layers(&mut objects, first);
        }
        let regions = region::regions(&slices, &layers, settings);
        drop(slices);
        let t3 = now();
        let frame = bambu::Frame::new(profile::x2d(), &facts);
        let photos = timelapse_spots(&objects, &layers, settings);
        let job =
            gcode::Job { settings, frame: &frame, objects: &objects, photos: &photos, start: frame.start_position() };
        // Each layer from its regions to its G-code in one go, so only the text stays.
        let texts = par::map_range(regions.len(), |i| {
            let plan = plan::plan_layer(&regions[i], i, &layers, &objects, settings);
            gcode::layer(&plan, &regions[i], &job, gcode::travel_z(&layers, i, settings, job.start[2]))
        });
        drop(regions);
        let t4 = now();
        let g = gcode::assemble(texts, &job);
        let t5 = now();
        let thumbnail = options.thumbnail.then(|| {
            let size = 512;
            png::encode(&png::render(&meshes, size, settings.filament_colour), size, size)
        });
        let t6 = now();
        let title = title.as_deref().unwrap_or("Model");
        let file = pack::gcode_3mf(&g.text, thumbnail.as_deref(), &g.stats, &objects, settings, title);
        let t7 = now();
        Ok(Output {
            file,
            gcode: g.text,
            stats: g.stats,
            timings: Timings {
                read: read_ms + t1 - t0,
                slice: t2 - t1,
                regions: t3 - t2,
                toolpaths: t4 - t3,
                gcode: t5 - t4,
                thumbnail: t6 - t5,
                pack: t7 - t6,
                total: read_ms + t7 - t0,
            },
            triangles: meshes.iter().map(|m| m.triangles.len()).sum(),
        })
    }
}

/// What the printer's start G-code needs to know about the first layer, as Orca works it out: the extent of its
/// outline grown by the skirt distance (Orca's first-layer hull takes in the skirt's, which it draws that far out
/// even with no skirt loops), its area, the print's height and the plate.
fn first_layer_facts(slices: &[geom::Shapes], layers: &section::Layers, s: &Settings) -> bambu::Facts {
    let Some(first) = slices.first() else { return bambu::Facts::default() };
    let margin = s.skirt_distance;
    let b = geom::bbox(first).map(|b| b.map(geom::unsc)).unwrap_or([0.0; 4]);
    bambu::Facts {
        first_layer_min: [b[0] - margin, b[1] - margin],
        first_layer_max: [b[2] + margin, b[3] + margin],
        first_layer_area: geom::area_mm2(first),
        top: layers.top.last().copied().unwrap_or(0.0),
        bed_type: s.bed_type.to_string(),
    }
}

/// Where the timelapse photo is taken after each layer: Orca's pick, which changes only when the objects standing at
/// the layer's height (in whole millimetres) do.
fn timelapse_spots(objects: &[Object], layers: &section::Layers, s: &Settings) -> Vec<Option<[i64; 2]>> {
    let mut spots = Vec::with_capacity(layers.top.len());
    let mut last: Option<(Vec<bool>, Option<[i64; 2]>)> = None;
    for &z in &layers.top {
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    /// Not an STL or 3MF this reads.
    Unreadable,
    /// No triangles in it.
    NoModel,
    TooBig,
    TooTall,
    TooMany,
}

impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Error::Unreadable => "can't read this file as an STL or a 3MF",
            Error::NoModel => "this file has no model in it",
            Error::TooBig => "too big for the plate",
            Error::TooTall => "too tall for the printer",
            Error::TooMany => "too many objects for one plate",
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

    #[cfg(feature = "parallel")]
    pub fn join<A: Send, B: Send>(a: impl FnOnce() -> A + Send, b: impl FnOnce() -> B + Send) -> (A, B) {
        rayon::join(a, b)
    }

    #[cfg(not(feature = "parallel"))]
    pub fn join<A, B>(a: impl FnOnce() -> A, b: impl FnOnce() -> B) -> (A, B) {
        (a(), b())
    }
}
