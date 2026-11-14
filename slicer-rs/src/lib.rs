//! Spaghetti's experimental slicer: STL and plain 3MF in, a Bambu-flavoured `.gcode.3mf` out, with the defaults of
//! decision 0046. Built for speed: layers are sliced, walled and filled in parallel (one thread in WebAssembly), on
//! exact integer geometry. See `docs/proposals/rust-slicer.md` for what it does, how fast, and what it lacks.

pub mod bambu;
pub mod base_support;
pub mod bridges;
pub mod brim;
pub mod config;
pub mod filaments;
pub mod fill;
pub mod gcode;
pub mod geom;
pub mod grid;
pub mod infill;
pub mod json;
pub mod lift;
pub mod lightning;
pub mod medial;
pub mod mesh;
pub mod monotonic;
pub mod order;
pub mod overhang;
pub mod pack;
pub mod plan;
pub mod png;
pub mod preheat;
pub mod profile;
pub mod region;
pub mod section;
pub mod setup;
pub mod solid;
pub mod support;
pub mod surfaces;
pub mod template;
pub mod threemf;
pub mod toolchange;
pub mod tree;
#[cfg(target_arch = "wasm32")]
mod wasm;
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
}

impl Default for Options {
    fn default() -> Self {
        Options { arrange: true, thumbnail: true, scale: 100.0 }
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

/// Keeps the meshes (and their filaments) where `keep` says.
fn retain_by(meshes: &mut Vec<Mesh>, filaments: &mut Vec<usize>, keep: &[bool]) {
    let mut k = keep.iter();
    meshes.retain(|_| k.next().copied().unwrap_or(true));
    let mut k = keep.iter();
    filaments.retain(|_| k.next().copied().unwrap_or(true));
}

/// Models read from their files, not yet laid out or sliced. Adding the files one at a time lets each file's bytes
/// go as soon as it is read, so a plate of big models never holds all of its files and all of its slices at once.
#[derive(Default)]
pub struct Plate {
    meshes: Vec<Mesh>,
    /// Each mesh's filament (0-based).
    filaments: Vec<usize>,
    project: bool,
    /// Whether an object's parts print in different filaments (a project's).
    mixed_parts: bool,
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
        if input.bytes.starts_with(b"PK\x03\x04") {
            let model = threemf::read(input.bytes)?;
            self.project |= model.project;
            self.mixed_parts |= model.mixed_parts;
            self.unassigned |= filament.is_none() && !model.project;
            self.filaments.extend(model.filaments.iter().map(|&f| filament.unwrap_or(f)));
            self.meshes.extend(model.meshes);
        } else {
            self.meshes.push(mesh::read_stl(name, input.bytes)?);
            self.unassigned |= filament.is_none();
            self.filaments.push(filament.unwrap_or(0));
        }
        self.title.get_or_insert_with(|| name.to_string());
        self.read_ms += now() - t0;
        Ok(())
    }

    /// Lays the models on the plate and slices them with `settings` into a `.gcode.3mf`.
    pub fn slice(self, settings: &Settings, options: &Options) -> Result<Output, Error> {
        let Plate { mut meshes, mut filaments, project, mixed_parts, unassigned, title, read_ms } = self;
        filaments.resize(meshes.len(), 0);
        let t0 = now();
        if let Some(what) = settings.unsupported() {
            return Err(Error::Unsupported(what));
        }
        // With several filaments, each object prints in the one its file or its caller gives it: parts of it in others
        // it can't print yet, and models that say nothing would all print in the first (with one filament, everything
        // prints in it, as Orca prints it).
        if settings.palette.as_ref().is_some_and(|p| p.profiles.len() > 1) {
            if mixed_parts {
                return Err(Error::Unsupported("parts of one object in different filaments"));
            }
            if unassigned {
                return Err(Error::Unsupported("several filaments for models that don't say which they print in"));
            }
        }
        if meshes.iter().all(|m| m.triangles.is_empty()) {
            return Err(Error::NoModel);
        }
        let keep: Vec<bool> = meshes.iter().map(|m| !m.triangles.is_empty()).collect();
        retain_by(&mut meshes, &mut filaments, &keep);
        let scaled = options.scale > 0.0 && (options.scale - 100.0).abs() > 1e-9;
        for m in &mut meshes {
            m.orient();
            if scaled {
                m.scale(options.scale / 100.0);
            }
        }
        if (options.arrange && !project) || scaled {
            mesh::arrange(&mut meshes, settings.bed, settings.max_height)?;
        } else {
            mesh::drop_to_bed(&mut meshes);
            // Kept where they are, as Orca keeps them: one partly off the plate stops the slice, and those wholly off
            // it (on a project's other plates) are left out.
            let places: Vec<mesh::OnPlate> = meshes.iter().map(|m| mesh::on_plate(m, settings.bed)).collect();
            if places.contains(&mesh::OnPlate::Partly) {
                return Err(Error::OffPlate);
            }
            let keep: Vec<bool> = places.iter().map(|p| *p == mesh::OnPlate::Inside).collect();
            retain_by(&mut meshes, &mut filaments, &keep);
            if meshes.is_empty() {
                return Err(Error::OffPlate);
            }
        }
        let height = meshes.iter().map(|m| m.bounds().max[2]).fold(0.0, f64::max);
        if height > settings.max_height {
            return Err(Error::TooTall);
        }
        let t1 = now();
        let layers = section::Layers::plan(height, settings.first_layer_height, settings.layer_height);
        // Slices simplified to half the profile's resolution, as before: Orca simplifies its own to 0.0025 mm, which
        // comes a little closer to its supports on a Benchy and makes every later step a third slower.
        let (slices, owners) =
            section::slice(&meshes, &layers, settings.resolution / 2.0, settings.slice_closing_radius);
        let t2 = now();
        let mut objects: Vec<Object> = meshes.iter().enumerate().map(|(i, m)| Object::from_mesh(i, m)).collect();
        if let Some(first) = slices.first() {
            first_layers(&mut objects, first, &owners[0]);
        }
        // The first layer as sliced, for the brims once the supports are known.
        let first = slices.first().cloned().unwrap_or_default();
        let first_owners = owners.first().cloned().unwrap_or_default();
        // Each object's infill pattern is anchored at the middle of its bounding box, as Orca anchors it.
        let centres: Vec<(f64, f64)> = objects
            .iter()
            .map(|o| ((o.min[0] + o.max[0]) / 2.0 * geom::SCALE, (o.min[1] + o.max[1]) / 2.0 * geom::SCALE))
            .collect();
        let regions = region::regions(&slices, &owners, &layers, &centres, settings);
        // Where travels lift in spirals rather than slopes, for filaments that lift as Orca's Auto Lift does.
        let auto_lift = match &settings.palette {
            Some(p) if p.profiles.len() > 1 => p.profiles.iter().any(|f| config::Settings::auto_lifts(f)),
            _ => settings.z_hop_type == "Auto Lift",
        };
        let lift_overhangs = if auto_lift && settings.z_hop > 0.0 {
            lift::Overhangs::find(&slices, &owners, &layers.top, settings.line_width)
        } else {
            lift::Overhangs::default()
        };
        drop((slices, owners));
        let t3 = now();
        let supports = if settings.enable_support {
            object_supports(&regions, &layers, &centres, objects.len(), settings)
        } else {
            Vec::new()
        };
        // Without supports, whether an object needs them, as Orca checks it and warns.
        let warnings =
            if settings.enable_support { Vec::new() } else { support_warnings(&regions, &layers, &objects, settings) };
        // Each object's brim, round its first layer as sliced and out of what the supports' lowest layers print.
        let heights: Vec<f64> = objects.iter().map(|o| o.max[2] - o.min[2]).collect();
        let support_cover: Vec<geom::Shapes> =
            supports.iter().filter_map(|layers| layers.first()).map(support::cover).collect();
        let support_cover = geom::union_all(&support_cover.iter().collect::<Vec<_>>());
        let brims = brim::brims(&first, &first_owners, &heights, &support_cover, settings);
        let facts = first_layer_facts(&first, &layers, &brims, settings);
        let facts = with_support(facts, &supports, settings);
        let schedule = schedule(&layers, &supports, objects.len());
        let t4 = now();
        // Several filaments: the order they print in on each layer, and the prime tower (`toolchange.rs`).
        let colours = settings.palette.as_ref().filter(|p| p.profiles.len() > 1).map(|palette| {
            let layer_objects: Vec<Vec<usize>> = schedule
                .iter()
                .map(|slot| {
                    let mut here: Vec<usize> = Vec::new();
                    if let Some(l) = slot.layer {
                        here.extend(regions[l].islands.iter().map(|i| i.object as usize));
                    }
                    for (o, k) in slot.supports.iter().enumerate() {
                        if k.is_some_and(|k| !supports[o][k].items.is_empty()) {
                            here.push(o);
                        }
                    }
                    here.sort_unstable();
                    here.dedup();
                    here
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
                    object_filament: &filaments,
                    layer_objects: &layer_objects,
                    layer_z: &zs,
                    layer_h: &hs,
                    first_island: &first_island,
                    object_boxes: &objects.iter().map(|o| [o.min[0], o.min[1], o.max[0], o.max[1]]).collect::<Vec<_>>(),
                    object_reach: &reach,
                    object_tops: &tops,
                },
            )
        });
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
        let mut frame = bambu::Frame::new(settings.profile.clone(), &facts);
        if let (Some(c), Some(palette)) = (&colours, &settings.palette) {
            c.frame_vars(&mut frame, palette);
        }
        let zs: Vec<f64> = schedule.iter().map(|slot| slot.z).collect();
        let photos = timelapse_spots(&objects, &zs, settings);
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
        // with the object layer above them, which they are cooled with.
        let empty = region::LayerRegions::default();
        let mut groups: Vec<std::ops::Range<usize>> = Vec::new();
        for (g, slot) in schedule.iter().enumerate() {
            if slot.layer.is_some() || g + 1 == schedule.len() {
                groups.push(groups.last().map_or(0, |r| r.end)..g + 1);
            }
        }
        let texts = par::map_range(groups.len(), |k| {
            let plans: Vec<(plan::LayerPlan, &region::LayerRegions, f64)> = groups[k]
                .clone()
                .map(|g| {
                    let slot = &schedule[g];
                    let here: Vec<Option<&support::Layer>> =
                        slot.supports.iter().enumerate().map(|(o, k)| k.map(|k| &supports[o][k])).collect();
                    // A layer of the support's own is planned as an object layer with nothing in it (`next` stands
                    // in for its index: no first layer, no layer below to hang over).
                    let (l, regions_here) = match slot.layer {
                        Some(l) => (l, &regions[l]),
                        None => (slot.next, &empty),
                    };
                    let lower = slot.layer.and_then(|l| l.checked_sub(1)).map(|j| &regions[j]);
                    let h = slot.layer.map_or(slot.header_height as f64, |l| layers.height[l]);
                    let mut plan = match &colours {
                        Some(c) if !c.orders[g].is_empty() => {
                            let plans = c.orders[g]
                                .iter()
                                .map(|&f| {
                                    let only: Vec<bool> = c.object_filament.iter().map(|&of| of == f).collect();
                                    let s = &c.settings[f];
                                    let plan = plan::plan_layer_of(
                                        Some(&only),
                                        regions_here,
                                        lower,
                                        l,
                                        (slot.z, h),
                                        &centres,
                                        &brims.loops,
                                        &here,
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
                            &brims.loops,
                            &here,
                            settings,
                        ),
                    };
                    (plan.index, plan.id, plan.header_height) = (g, slot.id, slot.header_height);
                    let from_z = if g == 0 { job.start[2] } else { schedule[g - 1].z + settings.z_hop };
                    (plan, regions_here, from_z)
                })
                .collect();
            let group: Vec<(&plan::LayerPlan, &region::LayerRegions, f64)> =
                plans.iter().map(|(plan, r, z)| (plan, *r, *z)).collect();
            gcode::layers(&group, &job)
        });
        let texts: Vec<gcode::LayerGcode> = texts.into_iter().flatten().collect();
        drop(regions);
        let t5 = now();
        let mut g = gcode::assemble(texts, &job);
        // Orca's pre-cooling and pre-heating of the nozzle that waits, added after the estimate as Orca adds it.
        if let Some(p) = colours.as_ref().and_then(preheat::Params::of)
            && let Some(text) = preheat::add_lines(&g.text, &p, settings)
        {
            g.text = text;
        }
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
        let file =
            pack::gcode_3mf(&g.text, thumbnail.as_deref(), &g.stats, &objects, settings, title, colours.as_ref());
        let t8 = now();
        Ok(Output {
            file,
            gcode: g.text,
            stats: g.stats,
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

/// Each object's highest layer, if it has any.
fn last_layers(regions: &[region::LayerRegions], objects: usize) -> Vec<Option<usize>> {
    let mut last = vec![None; objects];
    for (l, r) in regions.iter().enumerate() {
        for island in &r.islands {
            if let Some(last) = last.get_mut(island.object as usize) {
                *last = Some(l);
            }
        }
    }
    last
}

/// Orca's warning for each object sliced without supports that needs them (`PrintObject::is_support_necessary`, which
/// runs its trees' overhang detection on the object whatever the support settings).
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

/// Each object's normal supports (`support.rs`), from its slices and top surfaces up to its last layer.
fn object_supports(
    regions: &[region::LayerRegions],
    layers: &section::Layers,
    centres: &[(f64, f64)],
    objects: usize,
    s: &Settings,
) -> Vec<Vec<support::Layer>> {
    let params = support::Params::new(s);
    let last = last_layers(regions, objects);
    (0..objects)
        .map(|o| {
            let Some(top) = last[o] else { return Vec::new() };
            let slices: Vec<geom::Shapes> = regions[..=top].iter().map(|r| r.slice_of(o as u32)).collect();
            // The layers' top surfaces, each object's own.
            let tops = regions[..=top]
                .iter()
                .zip(&slices)
                .map(|(r, slice)| {
                    if r.tops.is_empty() || slice.is_empty() {
                        Vec::new()
                    } else if objects == 1 {
                        r.tops.clone()
                    } else {
                        geom::intersection(&r.tops, slice)
                    }
                })
                .collect();
            let object = support::Object {
                print_z: &layers.top[..=top],
                height: &layers.height[..=top],
                slices,
                tops,
                origin: centres[o],
            };
            if s.support.organic() {
                tree::supports(&object.slices, object.height, s, object.origin, s.bed)
                    .map_or_else(Vec::new, |t| support::generate_tree(&object, &params, t))
            } else {
                support::generate(&object, &params)
            }
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
            } else {
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
    /// Settings this can't slice yet: what they ask for ("tree supports", "a raft"…).
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
