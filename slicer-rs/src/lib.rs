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
pub mod profile;
pub mod png;
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
        let regions = region::regions(&slices, &layers, settings);
        drop(slices);
        let t3 = now();
        // Each layer from its regions to its G-code in one go, so only the text stays.
        let texts = par::map_range(regions.len(), |i| {
            let plan = plan::plan_layer(&regions[i], i, &layers, settings);
            gcode::layer(&plan, &regions[i], settings, gcode::travel_z(&layers, i, settings))
        });
        drop(regions);
        let t4 = now();
        let g = gcode::assemble(texts, settings);
        let t5 = now();
        let thumbnail = options.thumbnail.then(|| {
            let size = 512;
            png::encode(&png::render(&meshes, size, settings.filament_colour), size, size)
        });
        let t6 = now();
        let objects: Vec<pack::Object> = meshes
            .iter()
            .map(|m| {
                let b = m.bounds();
                pack::Object { name: m.name.clone(), bbox: [b.min[0], b.min[1], b.max[0], b.max[1]] }
            })
            .collect();
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
