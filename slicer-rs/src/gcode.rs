//! G-code: every layer's paths as printer moves, written the way OrcaSlicer writes them for a Bambu Lab printer.
//! Absolute XYZ and relative E; the printer's own G-code at the start, at each layer change, for each timelapse
//! photo and at the end (`bambu`); the `; CHANGE_LAYER`, `; Z_HEIGHT:`, `; LAYER_HEIGHT:` and `; FEATURE:` markers
//! the app's 3D view reads; labels around each object's moves (M624/M625) so the printer can skip one; retractions
//! that wipe as they pull back, and spiral lifts. The moves are timed the way Orca's estimator times them
//! (trapezoids, per-axis jerk at junctions, the machine's limits), with the statistics Orca reports. Layers are
//! built and timed in parallel; each starts and ends at a safe speed, so their times add up.

use crate::Object;
use crate::bambu::Frame;
use crate::config::{Settings, trim};
use crate::geom::{self, Pt, Shapes};
use crate::plan::{LayerPlan, Path};
use crate::region::{LayerRegions, Role};
use crate::template::format_g;
use std::f64::consts::PI;

pub const NAME: &str = "Spaghetti slicer";
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Feature {
    pub time: f64,
    /// mm³ of filament.
    pub volume: f64,
}

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub layers: usize,
    /// Seconds printing the layers.
    pub model_time: f64,
    /// Seconds before the first layer: the start G-code and the printer's own preparation.
    pub prepare_time: f64,
    pub total_time: f64,
    /// Seconds moving without printing: travels, lifts, wipes and retractions.
    pub travel_time: f64,
    /// mm travelled without printing.
    pub travel_distance: f64,
    pub retractions: usize,
    /// mm of filament.
    pub filament_mm: f64,
    /// mm³ of filament.
    pub volume: f64,
    pub weight: f64,
    pub cost: f64,
    /// By `Role` (in `Role::ALL`'s order).
    pub features: [Feature; Role::ALL.len()],
    /// Each layer's seconds.
    pub layer_times: Vec<f64>,
    pub max_z: f64,
    /// With several filaments, each one's use (every filament of the plate's, used or not).
    pub filaments: Vec<FilamentUse>,
    /// With several filaments, how many times the print changes filament, and the prime tower's width, depth and brim
    /// width (mm).
    pub tool_changes: usize,
    pub tower: Option<[f64; 3]>,
}

/// What one filament of several prints and flushes.
#[derive(Clone, Debug, Default)]
pub struct FilamentUse {
    /// In all: mm, mm³, g and cost, the flush included.
    pub length: f64,
    pub volume: f64,
    pub weight: f64,
    pub cost: f64,
    /// mm³ printed on the prime tower, and flushed by the printer when changing to it.
    pub tower: f64,
    pub flush: f64,
    /// g per mm³.
    pub density: f64,
}

pub struct Gcode {
    pub text: Vec<u8>,
    pub stats: Stats,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Extrude(Role),
    Travel,
    /// A travel that names its height too (`G1 X Y Z`), as Orca writes the travel after a lift.
    TravelZ,
    /// Moving back over what was just printed while retracting.
    Wipe,
    /// The filament only.
    Retract,
    /// Up or down only.
    Lift,
    /// A spiral lift: one turn around the point (`i`, `j`) mm away while rising to `z` (`G17`, `G3 … P1`).
    Spiral {
        i: f64,
        j: f64,
    },
}

#[derive(Clone, Copy, Debug)]
struct Move {
    x: f64,
    y: f64,
    z: f64,
    /// mm of filament, relative.
    e: f64,
    /// mm/s.
    f: f64,
    /// mm/s², or NaN where none is set yet.
    accel: f64,
    kind: Kind,
    /// An extrusion's width and height (Orca keeps them as floats, and writes them so).
    width: f32,
    height: f32,
}

/// What the G-code says between two moves.
#[derive(Clone, Debug)]
enum Note {
    /// The acceleration from here on (`M204 S`), written when it changes.
    Accel(f64),
    /// Orca's comments where an object's moves begin and end in a layer (`; printing object …`).
    Printing(u32),
    Stopped(u32),
    /// The printer's labels around an object's moves (`M624` … `M625`), which let it skip the object.
    LabelStart(u32),
    LabelEnd(u32),
    /// The printer's own G-code: the layer change, the timelapse photo.
    Text(String),
    /// A visit to the prime tower's G-code (`toolchange.rs`): written as it is, with what it costs.
    Tower(Box<crate::toolchange::Text>),
    /// The filament printing from here on (several filaments).
    Tool(usize),
}

/// What every layer's G-code shares.
pub struct Job<'a> {
    pub settings: &'a Settings,
    pub frame: &'a Frame,
    pub objects: &'a [Object],
    /// Where the printer takes the timelapse photo after each layer (None: it picks its own spot).
    pub photos: &'a [Option<[i64; 2]>],
    /// Where the start G-code leaves the nozzle.
    pub start: [f64; 3],
    /// The plate's filaments, their tool changes and prime tower, when it prints in several (`toolchange.rs`).
    pub colours: Option<&'a crate::toolchange::Colours>,
}

impl Job<'_> {
    /// Whether the objects get labels: Orca's label mask has room for 63.
    fn labels(&self) -> bool {
        self.objects.len() < 64
    }
}

/// One layer's G-code and what it costs. The travel onto the layer (from wherever the last one ended) is in the
/// text but not yet in the time: `assemble` adds it, once it knows where the layer before ended.
pub struct LayerGcode {
    text: Vec<u8>,
    /// Where the layer's progress line (`M73 P… R…`) goes, once the time before the layer is known.
    progress_at: usize,
    /// The layer's first `M204` line (its bytes in the text) and its acceleration: left out when the layer before
    /// ended at that acceleration already, as Orca's writer leaves it out.
    first_accel: Option<(usize, usize, f64)>,
    /// The acceleration the layer ends at (NaN when it sets none).
    last_accel: f64,
    z: f64,
    /// Where the layer's first travel goes, and where the layer ends.
    first: Option<[f64; 2]>,
    end: Option<[f64; 3]>,
    time: f64,
    travel_time: f64,
    travel_distance: f64,
    retractions: usize,
    filament_mm: f64,
    features: [Feature; Role::ALL.len()],
    /// The part and auxiliary fans for the layer, in percent (`layer_fans`).
    fans: [f64; 2],
    /// With several filaments: mm of each, and mm³ of each on the prime tower.
    by_filament: Vec<[f64; 2]>,
}

/// The part and auxiliary fans for layer `i`, in percent, as Orca's cooling sets them at a layer's start
/// (`CoolingBuffer::apply_layer_cooldown`): off for the first layers, then by how long the layer takes
/// (`layer_time`, after slowing down): at the maximum when it is shorter than the slow-down time, easing down to the
/// minimum by the fan's cooling time, and past that the minimum when the fan stays on, else off; with a ramp over
/// the first layers when the filament asks for one.
fn layer_fans(i: usize, layer_time: f64, s: &Settings) -> [f64; 2] {
    if i < s.fan_off_layers {
        return [0.0, 0.0];
    }
    let (min, max) = (s.fan_min_speed * 100.0, s.fan_max_speed * 100.0);
    let mut fan = if s.fan_always_on { min } else { 0.0 };
    if layer_time < s.slow_down_layer_time {
        fan = max;
    } else if layer_time < s.fan_cooling_layer_time {
        // Orca works `t` out in single precision (its times are floats): the blend below is then exact, so equal
        // minimum and maximum speeds give that speed, never a hair under it.
        let (lt, slow, cool) = (layer_time as f32, s.slow_down_layer_time as f32, s.fan_cooling_layer_time as f32);
        let t = ((lt - slow) / (cool - slow)) as f64;
        fan = (t * min + (1.0 - t) * max).floor();
    }
    if i + 1 < s.full_fan_speed_layer {
        let factor = (i + 1 - s.fan_off_layers) as f32 / (s.full_fan_speed_layer - s.fan_off_layers) as f32;
        fan = ((fan as f32 * factor + 0.5) as i32).clamp(0, 255) as f64;
    }
    [fan, (s.aux_fan_speed * 100.0).round()]
}

/// `M106 S…`: the part fan at `percent`, as Orca's writer turns it into the fan's 0–255.
fn set_fan(t: &mut Vec<u8>, percent: f64) {
    let speed = percent.max(0.0) as u32;
    if speed == 0 {
        t.extend_from_slice(b"M106 S0\n");
    } else {
        t.extend_from_slice(format!("M106 S{}\n", (255.5 * speed as f64 / 100.0) as u32).as_bytes());
    }
}

/// Layers from their plans to their G-code: moves, slowing down if they are too quick, timing and text. Each comes
/// with its regions and the height the nozzle travels at onto it (the layer before's top, lifted; for the first,
/// where the start G-code leaves the nozzle). They are cooled as one, as Orca's cooling buffer holds the support's
/// own layers until an object layer comes: the last is an object layer (or the print's last), any before it the
/// support's alone.
pub fn layers(group: &[(&LayerPlan, &LayerRegions, f64)], job: &Job) -> Vec<LayerGcode> {
    let s = job.settings;
    let mut built: Vec<_> = group
        .iter()
        .map(|&(plan, regions, from_z)| {
            let (moves, notes) = build_layer(plan, regions, job, from_z);
            let first = layer_start(plan);
            let start = first.map(|[x, y]| [x, y, from_z]).unwrap_or([job.start[0], job.start[1], from_z]);
            (moves, notes, start, first)
        })
        .collect();
    let (factor, cooling_time) = slowdown(built.iter().map(|b| (b.0.as_slice(), b.2)), s);
    if let Some(k) = factor {
        for b in &mut built {
            slow_down(&mut b.0, k, s);
        }
    }
    let fans = layer_fans(group.last().map_or(0, |g| g.0.id), cooling_time, s);
    group
        .iter()
        .zip(built)
        .map(|(&(plan, _, _), (moves, notes, start, first))| {
            // The layer's markers (its fans go before them, in `assemble`), then its moves.
            let mut text = Vec::with_capacity(moves.len() * 28 + 4096);
            text.extend_from_slice(
                format!(
                    "; CHANGE_LAYER\n; Z_HEIGHT: {}\n; LAYER_HEIGHT: {}\n",
                    format_g(plan.z),
                    format_g(plan.header_height as f64)
                )
                .as_bytes(),
            );
            let progress_at = text.len();
            let tool = job.colours.map_or(0, |c| c.start(plan.index));
            let out = finish_layer(&moves, &notes, start, job, text, plan.header_height, (fans, tool));
            LayerGcode {
                text: out.text,
                progress_at,
                first_accel: out.first_accel,
                last_accel: out.last_accel,
                z: plan.z,
                first,
                end: moves.last().map(|m| [m.x, m.y, m.z]),
                time: out.time,
                travel_time: out.travel_time,
                travel_distance: out.travel_distance,
                retractions: out.retractions,
                filament_mm: out.filament_mm,
                features: out.features,
                fans,
                by_filament: out.by_filament,
            }
        })
        .collect()
}

/// Seconds for a travel of `d` mm, from and to a standstill (the jerk speed), as the planner times it.
fn travel_time(d: f64, first_layer: bool, s: &Settings) -> f64 {
    if d < 1e-9 {
        return 0.0;
    }
    let accel = if first_layer { s.first_layer_travel_accel } else { s.travel_accel }.min(s.max_accel_travel);
    let cruise = s.travel_speed.min(s.max_speed_xy);
    let safe = cruise.min(s.max_jerk_xy);
    let b = Block { dist: d, cruise, accel, safe, max_entry: safe, entry: safe, nominal_length: true };
    trapezoid(&b, safe)
}

/// The whole file from its layers: header, the printer's start, the layers with the printer's progress, its end and
/// the totals.
pub fn assemble(layers: Vec<LayerGcode>, job: &Job) -> Gcode {
    let s = job.settings;
    let n = layers.len();
    let mut stats = Stats { layers: n, max_z: layers.last().map(|l| l.z).unwrap_or(0.0), ..Default::default() };
    let mut at = [job.start[0], job.start[1]];
    let mut times = Vec::with_capacity(n);
    // With several filaments, each one's mm and mm³ on the prime tower.
    let mut by_filament: Vec<[f64; 2]> = Vec::new();
    for (i, l) in layers.iter().enumerate() {
        // The travel onto the layer, from where the one before ended.
        let mut time = l.time;
        if let Some(first) = l.first {
            let d = (first[0] - at[0]).hypot(first[1] - at[1]);
            let t = travel_time(d, i == 0, s);
            time += t;
            stats.travel_time += t;
            stats.travel_distance += d;
        }
        if let Some(end) = l.end {
            at = [end[0], end[1]];
        }
        times.push(time);
        stats.model_time += time;
        stats.travel_time += l.travel_time;
        stats.travel_distance += l.travel_distance;
        stats.retractions += l.retractions;
        stats.filament_mm += l.filament_mm;
        if by_filament.len() < l.by_filament.len() {
            by_filament.resize(l.by_filament.len(), [0.0; 2]);
        }
        for (total, b) in by_filament.iter_mut().zip(&l.by_filament) {
            total[0] += b[0];
            total[1] += b[1];
        }
        for (total, f) in stats.features.iter_mut().zip(&l.features) {
            total.time += f.time;
            total.volume += f.volume;
        }
    }
    stats.layer_times = times;
    if let Some(c) = job.colours {
        // Each filament's own: what it prints, and what the printer flushes when changing to it (Orca counts the flush
        // to the new filament).
        by_filament.resize(c.settings.len(), [0.0; 2]);
        stats.filaments = by_filament
            .iter()
            .zip(&c.settings)
            .zip(&c.flushed)
            .map(|((b, fs), &flush)| {
                let volume = b[0] * fs.filament_area() + flush;
                let weight = volume * fs.filament_density / 1000.0;
                FilamentUse {
                    length: volume / fs.filament_area(),
                    volume,
                    weight,
                    cost: weight / 1000.0 * fs.filament_cost,
                    tower: b[1],
                    flush,
                    density: fs.filament_density / 1000.0,
                }
            })
            .collect();
        stats.filament_mm = stats.filaments.iter().map(|f| f.length).sum();
        stats.volume = stats.filaments.iter().map(|f| f.volume).sum();
        stats.weight = stats.filaments.iter().map(|f| f.weight).sum();
        stats.cost = stats.filaments.iter().map(|f| f.cost).sum();
        stats.tool_changes = c.changes;
        stats.tower = Some([c.tower[0], c.tower[1], c.tower[2]]);
    } else {
        stats.volume = stats.filament_mm * s.filament_area();
        stats.weight = stats.volume * s.filament_density / 1000.0;
        stats.cost = stats.weight / 1000.0 * s.filament_cost;
    }
    let start = job.frame.start();
    let prepare = time_custom(&start, s);
    stats.prepare_time = prepare;
    stats.total_time = stats.prepare_time + stats.model_time;

    let body: usize = layers.iter().map(|l| l.text.len()).sum();
    let mut text = Vec::with_capacity(body + 64 * 1024 + n * 64);
    header(&mut text, &stats, job);
    text.extend_from_slice(b"; EXECUTABLE_BLOCK_START\n");
    m73(&mut text, 0.0, stats.total_time);
    text.extend_from_slice(job.frame.envelope().as_bytes());
    text.extend_from_slice(b"M106 S0\nM106 P2 S0\n");
    text.extend_from_slice(start.as_bytes());
    let mut elapsed = stats.prepare_time;
    let mut accel = f64::NAN;
    let (mut last_index, mut last_z) = (0, 0.0);
    // The fans as Orca's cooling last set them (unknown before the first layer, so it sets both there).
    let mut fans = [f64::NAN; 2];
    for (i, l) in layers.into_iter().enumerate() {
        if l.fans[0] != fans[0] {
            set_fan(&mut text, l.fans[0]);
        }
        if l.fans[1] != fans[1] && s.aux_fan {
            text.extend_from_slice(format!("M106 P2 S{}\n", (255.0 * l.fans[1] / 100.0) as i64).as_bytes());
        }
        fans = l.fans;
        let (cut_from, cut_to) = match l.first_accel {
            Some((from, to, value)) if value == accel => (from, to),
            _ => (l.text.len(), l.text.len()),
        };
        text.extend_from_slice(&l.text[..l.progress_at]);
        m73(&mut text, elapsed, stats.total_time);
        text.extend_from_slice(&l.text[l.progress_at..cut_from]);
        text.extend_from_slice(&l.text[cut_to..]);
        if l.last_accel.is_finite() {
            accel = l.last_accel;
        }
        elapsed += stats.layer_times[i];
        (last_index, last_z) = (i, l.z);
    }
    text.extend_from_slice(b"M106 S0\nM106 P2 S0\n");
    text.extend_from_slice(job.frame.end(last_index, last_z).as_bytes());
    text.extend_from_slice(b"M73 P100 R0\n; EXECUTABLE_BLOCK_END\n\n");
    // Each filament's use, every filament of the plate's listed (as Orca's processor writes them).
    let uses: Vec<[f64; 4]> = match job.colours {
        Some(_) => stats.filaments.iter().map(|f| [f.length, f.volume / 1000.0, f.weight, f.cost]).collect(),
        None => vec![[stats.filament_mm, stats.volume / 1000.0, stats.weight, stats.cost]],
    };
    for (k, what) in ["; filament used [mm] =", "; filament used [cm3] =", "; filament used [g] =", "; filament cost ="]
        .iter()
        .enumerate()
    {
        let values: Vec<String> = uses.iter().map(|u| format!(" {:.2}", u[k])).collect();
        text.extend_from_slice(format!("{what}{}\n", values.join(",")).as_bytes());
    }
    text.push(b'\n');
    Gcode { text, stats }
}

// ---- One layer's moves.

struct Builder<'a> {
    s: &'a Settings,
    moves: Vec<Move>,
    notes: Vec<(usize, Note)>,
    x: f64,
    y: f64,
    z: f64,
    layer_z: f64,
    retracted: bool,
    lifted: bool,
    /// The acceleration the printer has, as Orca's writer tracks it: moves that set none keep it.
    accel: f64,
    first_layer: bool,
    /// The layer's height (for an overhang wall's flow when the filament changes).
    layer_height: f64,
    /// The last extrusion, until a wipe goes back over it, and the speed it ended at.
    wipe: Option<(&'a Path, f64)>,
    /// The speed the last extrusion ended at (Orca wipes at it on the prime tower too).
    speed: f64,
    /// mm the filament is pulled back by now, when `retracted`; and mm it was already pulled back by when it came
    /// back from a tool change (its next retraction pulls back only the rest).
    retracted_mm: f64,
    prior: f64,
    /// An overhang wall's width, mm³ per mm, speed and acceleration on this layer.
    overhang: (f64, f64, f64, f64),
}

impl<'a> Builder<'a> {
    fn push(&mut self, m: Move) {
        self.x = m.x;
        self.y = m.y;
        self.z = m.z;
        self.moves.push(m);
    }

    fn note(&mut self, note: Note) {
        self.notes.push((self.moves.len(), note));
    }

    fn set_accel(&mut self, accel: f64) {
        if accel != self.accel {
            self.note(Note::Accel(accel));
            self.accel = accel;
        }
    }

    fn line(&mut self, x: f64, y: f64, z: f64, e: f64, f: f64, kind: Kind) {
        let m = Move { x, y, z, e, f, accel: self.accel, kind, width: 0.0, height: 0.0 };
        self.push(m);
    }

    /// Orca's travel acceleration: the first layer's own, an outer wall's for a hop of under the minimum travel
    /// onto one, else the travel acceleration.
    fn travel_accel(&self, next: &Path, d: f64) -> f64 {
        let s = self.s;
        if self.first_layer {
            s.first_layer_travel_accel
        } else if next.first_role() == Role::OuterWall && d < s.retract_min_travel {
            s.outer_wall_accel
        } else if next.first_role() == Role::OverhangWall && d < s.retract_min_travel {
            s.bridge_accel
        } else {
            s.travel_accel
        }
    }

    fn travel(&mut self, x: f64, y: f64, with_z: bool) {
        let kind = if with_z { Kind::TravelZ } else { Kind::Travel };
        self.line(x, y, self.z, 0.0, self.s.travel_speed, kind);
    }

    fn lift_to(&mut self, z: f64) {
        if (z - self.z).abs() > 1e-9 {
            self.line(self.x, self.y, z, 0.0, self.s.travel_speed, Kind::Lift);
        }
    }

    /// Pulls the filament back as Orca does: wiping back over the last extrusion (on along a loop, back along a
    /// line) for the wipe distance, retracting during the wipe as much as the retraction speed allows in the time it
    /// takes and the rest just before it.
    fn retract(&mut self) {
        self.retract_by(self.s.retract_length);
    }

    /// `retract` by `length` mm (less what was already pulled back).
    fn retract_by(&mut self, length: f64) {
        if self.retracted {
            return;
        }
        let s = self.s;
        let mut left = (length - self.prior).max(0.0);
        self.retracted_mm = length.max(self.prior);
        self.prior = 0.0;
        if let Some((path, speed)) = self.wipe.take()
            && s.wipe_distance > 0.0
            && path.points.len() >= 2
        {
            let from = (self.x, self.y);
            // With tree supports Orca wipes a support path forward, from near its end (`tree_wipe_start`).
            let forward = tree_wipe_start(path, s);
            let length = if let Some(start) = forward {
                route_length(from, path.points[start + 1..].iter(), s.wipe_distance)
            } else if path.closed {
                route_length(from, path.points[1..].iter(), s.wipe_distance)
            } else {
                route_length(from, path.points.iter().rev().skip(1), s.wipe_distance)
            };
            // Orca wipes at the speed the path ended at (before any slowing down for cooling).
            let speed = speed.max(10.0);
            // In the G-code's hundred-thousandths of a millimetre, so that what is written adds up to the whole
            // retraction exactly (Orca's rounding lets a few microns drift over a long print).
            let during = e_units((s.retract_speed * length / speed).min(left));
            if length > 1e-9 && during > 0 {
                let before = e_units(left) - during;
                if before > 0 {
                    self.line(self.x, self.y, self.z, -from_units(before), s.retract_speed, Kind::Retract);
                }
                if let Some(start) = forward {
                    self.wipe_along(path.points[start + 1..].iter(), length, during, speed);
                } else if path.closed {
                    self.wipe_along(path.points[1..].iter(), length, during, speed);
                } else {
                    self.wipe_along(path.points.iter().rev().skip(1), length, during, speed);
                }
                left = 0.0;
            }
        }
        if left > 1e-9 {
            self.line(self.x, self.y, self.z, -left, s.retract_speed, Kind::Retract);
        }
        self.retracted = true;
    }

    /// Wipes `length` mm along `route`, retracting `units` hundred-thousandths of a millimetre over it.
    fn wipe_along<'p>(&mut self, route: impl Iterator<Item = &'p Pt>, length: f64, units: i64, speed: f64) {
        let mut done = 0.0;
        let mut written = 0;
        for q in route {
            let (qx, qy) = (geom::unsc(q.x), geom::unsc(q.y));
            let seg = (qx - self.x).hypot(qy - self.y);
            if seg < 1e-9 {
                continue;
            }
            let take = seg.min(length - done);
            let t = take / seg;
            let (x, y) = (self.x + (qx - self.x) * t, self.y + (qy - self.y) * t);
            done += take;
            let last = length - done <= 1e-9;
            let upto = if last { units } else { (units as f64 * done / length).round() as i64 };
            self.line(x, y, self.z, -from_units(upto - written), speed, Kind::Wipe);
            written = upto;
            if last {
                break;
            }
        }
    }

    /// Lifts the nozzle by the z-hop as Orca's spiral lift does: one turn around a point beside the nozzle (to the
    /// left of `toward`, the way the travel goes, or to the right when it goes nowhere), rising as it turns, or
    /// straight up where the turn wouldn't stay on the plate.
    fn lift(&mut self, toward: Option<(f64, f64)>) {
        if self.lifted {
            return;
        }
        let s = self.s;
        let z = self.layer_z + s.z_hop;
        let r = s.z_hop / (2.0 * PI * (s.travel_slope.to_radians()).atan());
        let (i, j) = match toward {
            Some((x, y)) if (x - self.x).hypot(y - self.y) > 0.0 => {
                let d = (x - self.x).hypot(y - self.y);
                (-(y - self.y) / d * r, (x - self.x) / d * r)
            }
            _ => (r, 0.0),
        };
        let (cx, cy) = (self.x + i, self.y + j);
        let fits = cx.min(s.bed[0] - cx).min(cy).min(s.bed[1] - cy) >= r;
        let kind = if fits { Kind::Spiral { i, j } } else { Kind::Lift };
        self.line(self.x, self.y, z, 0.0, s.travel_speed, kind);
        self.lifted = true;
    }

    /// Lowers the nozzle and pushes the filament back, ready to print.
    fn ready(&mut self) {
        if self.lifted {
            self.lift_to(self.layer_z);
            self.lifted = false;
        }
        if self.retracted {
            self.line(self.x, self.y, self.z, self.retracted_mm, self.s.deretract_speed, Kind::Retract);
            self.retracted = false;
        }
    }

    /// Prints a path. Where its segments print otherwise (`Path::parts`), each stretch of overhang wall or wall
    /// prints as such, at its segments' speeds as Orca writes them: a new speed where it changes by more than
    /// 1 mm/s, and the stretch's own where it comes back within 1 mm/s of that.
    fn extrude(&mut self, path: &'a Path) {
        self.ready();
        self.accel = path.accel;
        let e_per_mm3 = self.s.e_per_mm3();
        let mut stretch: Option<bool> = None;
        // mm/min, as Orca compares them.
        let mut written = path.speed * 60.0;
        for (k, q) in path.points[1..].iter().enumerate() {
            let part = path.parts.get(k);
            let over = part.is_some_and(|p| p.overhang);
            let (role, width, mm3_per_mm, own, accel) = if over {
                let (w, mm3, speed, accel) = self.overhang;
                (Role::OverhangWall, w, mm3, speed, accel)
            } else {
                (path.role, path.width, path.mm3_per_mm, path.speed, path.accel)
            };
            // An overhang wall is a round thread with thick bridges, else as high as its wall.
            let height = if over && self.s.thick_bridges { width } else { path.height };
            if stretch != Some(over) {
                stretch = Some(over);
                written = part.map_or(own * 60.0, |p| p.speed as f64 * 60.0);
            }
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            // A point the G-code would write as the one before (to its thousandth of a millimetre) waits for the
            // next one, which then covers both.
            let same = |a: f64, b: f64| (a * 1000.0).round() == (b * 1000.0).round();
            if same(x, self.x) && same(y, self.y) {
                continue;
            }
            match part {
                Some(p) => {
                    let new = p.speed as f64 * 60.0;
                    if (written - new).abs() > 60.0 {
                        written = new;
                    } else if (own * 60.0 - new).abs() <= 60.0 {
                        written = own * 60.0;
                    }
                }
                None => written = own * 60.0,
            }
            let length = (x - self.x).hypot(y - self.y);
            self.accel = accel;
            let m = Move {
                x,
                y,
                z: self.z,
                e: length * mm3_per_mm * e_per_mm3,
                f: written / 60.0,
                accel,
                kind: Kind::Extrude(role),
                width: width as f32,
                height: height as f32,
            };
            self.push(m);
        }
        self.wipe = Some((path, written / 60.0));
        self.speed = written / 60.0;
    }

    /// `retract_by` wiping along `route` (mm on the plate) instead of the last path.
    fn retract_along(&mut self, length: f64, route: &[[f64; 2]]) {
        if self.retracted {
            return;
        }
        let s = self.s;
        let mut left = (length - self.prior).max(0.0);
        self.retracted_mm = length.max(self.prior);
        self.prior = 0.0;
        self.wipe = None;
        let points: Vec<Pt> = route.iter().map(|p| geom::pt(geom::sc(p[0]), geom::sc(p[1]))).collect();
        if s.wipe_distance > 0.0 && points.len() >= 2 {
            let from = (self.x, self.y);
            let length = route_length(from, points[1..].iter(), s.wipe_distance);
            let speed = self.speed.max(10.0);
            let during = e_units((s.retract_speed * length / speed).min(left));
            if length > 1e-9 && during > 0 {
                let before = e_units(left) - during;
                if before > 0 {
                    self.line(self.x, self.y, self.z, -from_units(before), s.retract_speed, Kind::Retract);
                }
                self.wipe_along(points[1..].iter(), length, during, speed);
                left = 0.0;
            }
        }
        if left > 1e-9 {
            self.line(self.x, self.y, self.z, -left, s.retract_speed, Kind::Retract);
        }
        self.retracted = true;
    }

    /// Carries out a visit to the prime tower (`toolchange.rs`). `colours` gives each filament's settings.
    fn visit(
        &mut self,
        steps: &'a [crate::toolchange::Step],
        colours: &'a crate::toolchange::Colours,
        end_labels: &mut dyn FnMut(&mut Self),
    ) {
        use crate::toolchange::Step;
        for step in steps {
            match step {
                Step::Text(t) => {
                    self.note(Note::Tower(t.clone()));
                    if let Some(e) = t.end {
                        (self.x, self.y, self.z) = (e[0], e[1], e[2]);
                        self.lifted = e[2] > self.layer_z + 1e-6;
                    }
                    if let Some(a) = t.accel {
                        self.accel = a;
                    }
                }
                Step::Retract { length, wipe, lift } => {
                    let length = length.unwrap_or(self.s.retract_length);
                    match wipe {
                        Some(route) => self.retract_along(length, route),
                        None => self.retract_by(length),
                    }
                    if *lift {
                        self.lift(None);
                    }
                }
                Step::Travel { x, y, lift, lower } => {
                    let d = (x - self.x).hypot(y - self.y);
                    if *lift && !self.lifted {
                        self.lift(Some((*x, *y)));
                    }
                    let a = if self.first_layer { self.s.first_layer_travel_accel } else { self.s.travel_accel };
                    self.set_accel(a);
                    if d > 1e-9 || self.moves.is_empty() {
                        self.travel(*x, *y, self.lifted && *lift);
                    }
                    if *lower && self.z > self.layer_z + 1e-6 {
                        self.lift_to(self.layer_z);
                        self.lifted = false;
                    }
                }
                Step::Ready => self.ready(),
                Step::EndLabels => end_labels(self),
                Step::Use { filament, prior } => {
                    if let Some(s) = colours.settings.get(*filament) {
                        self.s = s;
                        self.overhang = crate::plan::overhang_flow(self.first_layer, self.layer_height, s);
                    }
                    self.retracted = false;
                    self.retracted_mm = 0.0;
                    self.prior = *prior;
                    self.wipe = None;
                    self.note(Note::Tool(*filament));
                }
            }
        }
    }
}

/// mm of filament in the hundred-thousandths of a millimetre the G-code writes.
fn e_units(mm: f64) -> i64 {
    (mm * 100_000.0).round() as i64
}

fn from_units(units: i64) -> f64 {
    units as f64 / 100_000.0
}

/// Where a wipe after a support path starts with tree supports, which Orca wipes along the path as printed rather
/// than back over it: from its start when it ends within 0.2 mm of it (a loop), else from the point before the
/// path turns away again after first coming within 0.2 mm of its end (its last point: no wipe). None for other
/// paths, which wipe as usual.
fn tree_wipe_start(path: &Path, s: &Settings) -> Option<usize> {
    if !s.support.kind.starts_with("tree") || !matches!(path.role, Role::Support | Role::SupportInterface) {
        return None;
    }
    let points = &path.points;
    let last = points[points.len() - 1];
    let near = geom::sc(0.2) as f64;
    if geom::dist(points[0], last) <= near {
        return Some(0);
    }
    let mut closest = near;
    let mut i = 0;
    while i < points.len() {
        let d = geom::dist(points[i], last);
        closest = closest.min(d);
        if closest < near && d > closest {
            break;
        }
        i += 1;
    }
    Some(i.max(1) - 1)
}

/// How far a wipe from `from` along `route` can go, up to `most` mm.
fn route_length<'p>(from: (f64, f64), route: impl Iterator<Item = &'p Pt>, most: f64) -> f64 {
    let (mut x, mut y) = from;
    let mut total = 0.0;
    for q in route {
        let (qx, qy) = (geom::unsc(q.x), geom::unsc(q.y));
        total += (qx - x).hypot(qy - y);
        if total >= most {
            return most;
        }
        (x, y) = (qx, qy);
    }
    total
}

/// Whether a travel from the end of a `from` path to the start of a `to` path, `d` mm long, retracts, as Orca's
/// `needs_retraction` decides: not when it is shorter than the retraction's minimum travel; always when it leaves an
/// outer or overhang wall; not when it goes to anything but a wall and stays within one of the layer's internal shapes (the slice
/// but its top and bottom surfaces), with "reduce infill retraction" on and some sparse infill; else it does.
fn retracts(from: &Path, to: &Path, d: f64, a: Pt, b: Pt, internal: &Internal, s: &Settings) -> bool {
    if d < s.retract_min_travel {
        return false;
    }
    // A brim lies outside every island, and the first layer has no internal surfaces to hide a travel in.
    if matches!(from.last_role(), Role::OuterWall | Role::OverhangWall | Role::Brim) || to.role == Role::Brim {
        return true;
    }
    // Nor does a travel to support (not its interface) that stays inside one of the object's support areas.
    if to.role == Role::Support && internal.in_support(to.object, a, b) {
        return false;
    }
    let wall = matches!(to.role, Role::InnerWall | Role::OuterWall);
    !(!wall
        && s.reduce_infill_retraction
        && s.sparse_density > 0.0
        && from.island == to.island
        && internal.holds(from.island as usize, a, b))
}

/// A layer's islands' outlines and its top and bottom surfaces, each contour and shape with its bounding box, for
/// testing travels against.
struct Internal<'a> {
    outlines: Vec<Vec<(&'a [Pt], [i32; 4])>>,
    surfaces: &'a Shapes,
    surface_boxes: Vec<[i32; 4]>,
    /// Each object's support areas on the layer.
    support: &'a [(u32, Shapes)],
}

impl<'a> Internal<'a> {
    fn new(islands: &'a [crate::region::Island], surfaces: &'a Shapes, support: &'a [(u32, Shapes)]) -> Self {
        let bbox = |c: &[Pt]| {
            c.iter().fold([i32::MAX, i32::MAX, i32::MIN, i32::MIN], |b, p| {
                [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)]
            })
        };
        Internal {
            outlines: islands.iter().map(|i| i.outline.iter().map(|c| (c.as_slice(), bbox(c))).collect()).collect(),
            surfaces,
            surface_boxes: surfaces.iter().map(geom::bbox_of).collect(),
            support,
        }
    }

    /// Whether the segment a–b stays inside one of `object`'s support areas (Orca's `support_islands`).
    fn in_support(&self, object: u32, a: Pt, b: Pt) -> bool {
        self.support.iter().any(|(o, areas)| *o == object && geom::segment_inside(areas, a, b))
    }

    /// Whether the segment a–b, between two of island `k`'s paths, stays within its outline and off the layer's top
    /// and bottom surfaces: within one of Orca's internal surfaces (the slice but its tops and bottoms), without
    /// working them out. Both ends lie in the island, so the segment stays in it unless it crosses its outline.
    fn holds(&self, k: usize, a: Pt, b: Pt) -> bool {
        let (lo, hi) = ((a.x.min(b.x), a.y.min(b.y)), (a.x.max(b.x), a.y.max(b.y)));
        let near = |bb: &[i32; 4]| bb[0] <= hi.0 && bb[2] >= lo.0 && bb[1] <= hi.1 && bb[3] >= lo.1;
        let Some(outline) = self.outlines.get(k) else { return false };
        if outline.iter().any(|&(c, bb)| near(&bb) && geom::contour_crosses(c, a, b)) {
            return false;
        }
        !self.surfaces.iter().zip(&self.surface_boxes).any(|(shape, bb)| {
            near(bb) && {
                let one = std::slice::from_ref(shape);
                geom::contains(one, a) || geom::segment_crosses(one, a, b)
            }
        })
    }
}

/// The layer's moves and what is said between them, in Orca's order: the printer's layer change G-code, each object's
/// labels around its moves, retractions that wipe and spiral lifts on travels, and after the last path a retraction,
/// a lift and the timelapse photo.
fn build_layer<'a>(
    plan: &'a LayerPlan,
    regions: &'a LayerRegions,
    job: &'a Job<'a>,
    from_z: f64,
) -> (Vec<Move>, Vec<(usize, Note)>) {
    let i = plan.index;
    let s = job.colours.map_or(job.settings, |c| &c.settings[c.start(i)]);
    let first_layer = i == 0;
    let points: usize = plan.paths.iter().map(|p| p.points.len()).sum();
    let (x0, y0) = layer_start(plan).map(|[x, y]| (x, y)).unwrap_or((job.start[0], job.start[1]));
    let mut b = Builder {
        s,
        moves: Vec::with_capacity(points + plan.paths.len() * 8 + 8),
        notes: Vec::with_capacity(16),
        x: x0,
        y: y0,
        z: from_z,
        layer_z: plan.z,
        retracted: true,
        lifted: true,
        accel: f64::NAN,
        first_layer,
        layer_height: plan.height,
        wipe: None,
        speed: 0.0,
        retracted_mm: s.retract_length,
        prior: 0.0,
        overhang: crate::plan::overhang_flow(first_layer, plan.height, s),
    };
    if first_layer {
        // Orca retracts at the first layer change, where the start G-code left the nozzle.
        b.line(x0, y0, from_z, -s.retract_length, s.retract_speed, Kind::Retract);
    }
    let mut change = job.frame.layer_change(i, plan.z, plan.z);
    change.push_str(";_SET_FAN_SPEED_CHANGING_LAYER\n");
    b.note(Note::Text(change));
    // The first layer's acceleration, and the usual one from the second layer on.
    if first_layer {
        b.set_accel(s.first_layer_accel);
    } else if i == 1 {
        b.set_accel(s.default_accel);
        // From the second layer on, the nozzle and the bed take their own temperatures where the filament's differ
        // from the first layer's, as Orca sets them there.
        let mut temps = String::new();
        if s.nozzle_temperature > 0.0 && s.nozzle_temperature != s.first_layer_nozzle_temperature {
            temps += &format!("M104 S{} ; set nozzle temperature\n", s.nozzle_temperature as i64);
        }
        if s.bed_temperature != s.first_layer_bed_temperature {
            temps += &format!("M140 S{} ; set bed temperature\n", s.bed_temperature as i64);
        }
        if !temps.is_empty() {
            b.note(Note::Text(temps));
        }
    }
    let labels = job.labels();
    let internal = Internal::new(&regions.islands, &regions.surfaces, &plan.support_islands);
    // The object a path prints inside the labels of: none for a brim, which Orca prints before it starts the object.
    let owner = |p: &Path| (p.role != Role::Brim).then_some(p.object);
    let mut last: Option<&Path> = None;
    // With several filaments: the visits to the prime tower between the filaments' paths, and the timelapse photo,
    // which Orca takes before the tower when the camera's extruder is about to stop printing.
    let mut next_visit = 0;
    let mut photo_taken = false;
    let mut open_label: Option<u32> = None;
    let photo_note = |b: &Builder| -> Note { Note::Text(layer_photo(plan, job, b.z)) };
    for (k, path) in plan.paths.iter().enumerate() {
        while let Some(colours) = job.colours
            && let Some(visit) = plan.visits.get(next_visit).filter(|v| v.at == k)
        {
            next_visit += 1;
            if let Some(o) = last.and_then(owner) {
                b.note(Note::Stopped(o));
            }
            if !photo_taken && visit.from != visit.to && colours.photo_head(visit.from) {
                b.retract();
                b.lift(None);
                if let Some(o) = open_label.take() {
                    b.note(Note::LabelEnd(o));
                }
                let photo = photo_note(&b);
                b.note(photo);
                photo_taken = true;
            }
            let mut end = |b: &mut Builder<'a>| {
                if let Some(o) = open_label.take() {
                    b.note(Note::LabelEnd(o));
                }
            };
            b.visit(&visit.steps, colours, &mut end);
            last = None;
        }
        let to = path.points[0];
        let (x, y) = (geom::unsc(to.x), geom::unsc(to.y));
        match last {
            None => {
                if let Some(o) = owner(path) {
                    b.note(Note::Printing(o));
                }
                b.set_accel(b.travel_accel(path, f64::INFINITY));
                if let Some(o) = owner(path).filter(|_| labels) {
                    b.note(Note::LabelStart(o));
                    open_label = Some(o);
                }
                b.travel(x, y, false);
                if first_layer {
                    // Down to the first layer's travel height first.
                    b.lift_to(plan.z + s.z_hop);
                }
            }
            Some(prev) => {
                let (was, now) = (owner(prev), owner(path));
                let other = was != now;
                if other {
                    if let Some(o) = was {
                        b.note(Note::Stopped(o));
                    }
                    if let Some(o) = now {
                        b.note(Note::Printing(o));
                    }
                }
                let mut relabel = |b: &mut Builder| {
                    if other && labels {
                        if let Some(o) = was {
                            b.note(Note::LabelEnd(o));
                        }
                        open_label = None;
                        if let Some(o) = now {
                            b.note(Note::LabelStart(o));
                            open_label = Some(o);
                        }
                    }
                };
                let d = (x - b.x).hypot(y - b.y);
                if d > 1e-6 {
                    b.set_accel(b.travel_accel(path, d));
                    let here = geom::pt(geom::sc(b.x), geom::sc(b.y));
                    let stay = !retracts(prev, path, d, here, to, &internal, s);
                    if !stay {
                        b.retract();
                    }
                    relabel(&mut b);
                    if stay {
                        b.travel(x, y, false);
                    } else {
                        b.lift(Some((x, y)));
                        b.travel(x, y, true);
                    }
                } else {
                    relabel(&mut b);
                }
            }
        }
        b.extrude(path);
        last = Some(path);
    }
    if let Some(colours) = job.colours {
        for visit in &plan.visits[next_visit.min(plan.visits.len())..] {
            if let Some(o) = last.and_then(owner) {
                b.note(Note::Stopped(o));
            }
            let mut end = |b: &mut Builder<'a>| {
                if let Some(o) = open_label.take() {
                    b.note(Note::LabelEnd(o));
                }
            };
            b.visit(&visit.steps, colours, &mut end);
            last = None;
        }
    }
    if let Some(prev) = last {
        if let Some(o) = owner(prev) {
            b.note(Note::Stopped(o));
        }
        b.retract();
        b.lift(None);
        if let Some(o) = owner(prev).filter(|_| labels) {
            b.note(Note::LabelEnd(o));
        }
    } else if let Some(o) = open_label.take() {
        b.note(Note::LabelEnd(o));
    }
    if !photo_taken {
        b.note(Note::Text(layer_photo(plan, job, plan.z)));
    }
    (b.moves, b.notes)
}

/// Where a layer's first travel goes: its first visit to the prime tower when that comes first, else its first path.
fn layer_start(plan: &LayerPlan) -> Option<[f64; 2]> {
    if let Some(v) = plan.visits.first().filter(|v| v.at == 0)
        && let Some(p) = v.first_point()
    {
        return Some(p);
    }
    plan.paths.first().map(|p| [geom::unsc(p.points[0].x), geom::unsc(p.points[0].y)])
}

/// The timelapse photo after the layer, which the printer skips with the layer's objects when all of them are skipped.
fn layer_photo(plan: &LayerPlan, job: &Job, _z: f64) -> String {
    let i = plan.index;
    let labels = job.labels();
    let mut photo = job.frame.timelapse(i, plan.z, plan.z, job.photos.get(i).copied().flatten());
    let mut printed: Vec<u32> =
        plan.paths.iter().map(|p| job.objects.get(p.object as usize).map_or(0, |o| o.label)).collect();
    printed.sort_unstable();
    printed.dedup();
    if labels && job.objects.len() > 1 && !printed.is_empty() {
        let ids: Vec<String> = printed.iter().map(u32::to_string).collect();
        let mask = printed.iter().fold(0u64, |m, &label| m | label_bit(job, label));
        photo = format!(
            "; object ids of layer {n} start: {ids}\nM624 {mask}\n{photo}; object ids of this layer{n} end: {ids}\nM625\n",
            n = i + 1,
            ids = ids.join(","),
            mask = base64_u64(mask),
        );
    }
    photo
}

/// An object's bit in the printer's label mask: its place among the plate's labels, smallest first.
fn label_bit(job: &Job, label: u32) -> u64 {
    let rank = job.objects.iter().filter(|o| o.label < label).count();
    1u64 << rank.min(63)
}

/// Eight bytes, least significant first, in base64 (Orca's `encodeBase64` of a label mask).
fn base64_u64(value: u64) -> String {
    const ABC: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let bytes = value.to_le_bytes();
    let mut out = String::with_capacity(12);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        for k in 0..4 {
            if k <= chunk.len() {
                out.push(ABC[(n >> (18 - 6 * k) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

// ---- Slowing down short layers, as Orca's cooling does: the extrusions slow so the layer takes at least
// `slow_down_layer_time`, none below `slow_down_min_speed`. Like Orca, this works on plain length / speed times.

fn simple_time(m: &Move, from: [f64; 3]) -> f64 {
    let d = match m.kind {
        Kind::Spiral { i, j } => (2.0 * PI * i.hypot(j)).hypot(m.z - from[2]),
        _ => ((m.x - from[0]).powi(2) + (m.y - from[1]).powi(2) + (m.z - from[2]).powi(2)).sqrt(),
    };
    let d = if d > 1e-9 { d } else { m.e.abs() };
    if m.f > 0.0 { d / m.f } else { 0.0 }
}

/// How Orca's cooling slows a layer that is too quick.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Slow {
    /// Every extrusion faster than this (mm/s) comes down to it.
    To(f64),
    /// Every extrusion takes this many times longer (a filament with no minimum speed).
    By(f64),
}

/// How Orca's cooling slows the layer's extrusions, if the layer is too quick; and how long the layer takes then, as
/// it reckons it for the fans (`calculate_layer_slowdown`, the stretched time before speeds are rounded to whole
/// mm/min). It slows non-proportionally: the fastest extrusions come down first, all to one speed, until the layer
/// takes its minimum time (and a thousandth), none below the filament's minimum speed.
fn slowdown<'m>(layers: impl Iterator<Item = (&'m [Move], [f64; 3])>, s: &Settings) -> (Option<Slow>, f64) {
    let mut fixed = 0.0;
    let mut adjustable: Vec<(f64, f64)> = Vec::new(); // (time, speed)
    let mut any = false;
    for (moves, start) in layers {
        let mut at = start;
        for m in moves {
            let t = simple_time(m, at);
            at = [m.x, m.y, m.z];
            match m.kind {
                Kind::Extrude(_) if m.f > s.slow_down_min_speed => adjustable.push((t, m.f)),
                _ => fixed += t,
            }
        }
        any |= !moves.is_empty();
    }
    if !any {
        return (None, 0.0);
    }
    let flexible: f64 = adjustable.iter().map(|a| a.0).sum();
    let target = s.slow_down_layer_time * 1.001;
    if s.slow_down_layer_time <= 0.0 || flexible <= 0.0 || fixed + flexible > target {
        return (None, fixed + flexible);
    }
    let min = s.slow_down_min_speed;
    if min <= 0.0 {
        return (Some(Slow::By((target - fixed) / flexible)), target);
    }
    let slowest = fixed + adjustable.iter().map(|&(t, v)| t * v / min).sum::<f64>();
    if slowest <= target {
        return (Some(Slow::To(min)), slowest);
    }
    // With the fastest extrusions down to a speed f, the layer takes the rest's time and their length over f.
    adjustable.sort_by(|a, b| b.1.total_cmp(&a.1));
    let (mut length, mut rest) = (0.0, flexible);
    for k in 0..adjustable.len() {
        let (t, v) = adjustable[k];
        length += t * v;
        rest -= t;
        let floor = adjustable.get(k + 1).map_or(min, |a| a.1.max(min));
        let room = target - fixed - rest;
        if room > 0.0 && length / room >= floor {
            return (Some(Slow::To((length / room).min(v))), target);
        }
    }
    (Some(Slow::To(min)), slowest)
}

/// Slows the layer's extrusions as `slowdown` says; like Orca's cooling, a slowed speed is a whole number of mm/min.
fn slow_down(moves: &mut [Move], how: Slow, s: &Settings) {
    for m in moves {
        if matches!(m.kind, Kind::Extrude(_)) && m.f > s.slow_down_min_speed {
            let f = match how {
                Slow::To(f) if m.f > f => f,
                Slow::To(_) => continue,
                Slow::By(k) => m.f / k,
            };
            m.f = (f * 60.0).round() / 60.0;
        }
    }
}

// ---- Timing.

struct Block {
    dist: f64,
    cruise: f64,
    accel: f64,
    safe: f64,
    max_entry: f64,
    entry: f64,
    nominal_length: bool,
}

/// How many straight pieces Orca's estimator splits an arc of radius `r` and `angle` radians into (to within
/// 0.0125 mm, `ArcWelder::arc_discretization_steps`).
fn arc_steps(r: f64, angle: f64) -> usize {
    const DEVIATION: f64 = 0.0125;
    let d = r - DEVIATION;
    if d < 1e-4 {
        return if angle < PI || r * (1.0 + (PI - 0.5 * angle).cos()) < DEVIATION { 1 } else { 2 };
    }
    ((angle / (2.0 * (d / r).acos())).ceil() as usize).max(1)
}

/// The planner's blocks as moves are added, with what the junction to the next block needs to know.
struct Planner<'a> {
    s: &'a Settings,
    blocks: Vec<Block>,
    /// The move each block belongs to.
    index: Vec<usize>,
    at: [f64; 3],
    prev_cruise: f64,
    prev_axis: [f64; 4],
    prev_safe: f64,
    /// The way the last move went (a unit vector; none for one that only moved the filament).
    prev_dir: [f64; 3],
}

impl Planner<'_> {
    /// A straight move to `to` with `e` mm of filament, as move `i` (`m`) asks: its speed, acceleration and the
    /// junction from the block before.
    fn add(&mut self, to: [f64; 3], e: f64, m: &Move, i: usize) {
        let s = self.s;
        let max_speed = [s.max_speed_xy, s.max_speed_xy, s.max_speed_z, s.max_speed_e];
        let max_accel = [s.max_accel_xy, s.max_accel_xy, s.max_accel_z, s.max_accel_e];
        let jerk = [s.max_jerk_xy, s.max_jerk_xy, s.max_jerk_z, s.max_jerk_e];
        let delta = [to[0] - self.at[0], to[1] - self.at[1], to[2] - self.at[2], e];
        self.at = to;
        let xyz = (delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]).sqrt();
        let dist = if xyz > 1e-9 { xyz } else { delta[3].abs() };
        if dist < 1e-9 || m.f <= 0.0 {
            return;
        }
        let inv = 1.0 / dist;
        let dir = if xyz > 1e-9 { [delta[0] / xyz, delta[1] / xyz, delta[2] / xyz] } else { [0.0; 3] };
        let set = if m.accel.is_finite() { m.accel } else { s.travel_accel };
        let mut cruise = m.f;
        // Bambu's limit on curves (Orca's estimator, "limit the cruise according to centripetal acceleration"): where
        // the path turns by less than about 29° from the last move, no faster than the print acceleration allows round
        // the circle the turn implies.
        if (self.prev_dir[0] != 0.0 || self.prev_dir[1] != 0.0) && (dir[0] != 0.0 || dir[1] != 0.0) {
            let (l1, l2) = (self.prev_dir[0].hypot(self.prev_dir[1]), dir[0].hypot(dir[1]));
            let v1 = (self.prev_dir[0] / l1, self.prev_dir[1] / l1);
            let v2 = (dir[0] / l2, dir[1] / l2);
            let norm_diff = (v2.0 - v1.0).hypot(v2.1 - v1.1);
            if norm_diff < 0.5 && norm_diff > 0.00001 {
                let angle = (v1.0 * v2.1 - v1.1 * v2.0).atan2(v1.0 * v2.0 + v1.1 * v2.1);
                let sin_half = ((1.0 - angle.cos()) * 0.5).sqrt();
                let r = delta[0].hypot(delta[1]) * 0.5 / sin_half;
                cruise = cruise.min((set.min(s.max_accel_extruding) * r).sqrt());
            }
        }
        let mut axis = [0.0f64; 4];
        let mut factor = 1.0f64;
        for a in 0..4 {
            axis[a] = cruise * delta[a] * inv;
            let v = axis[a].abs();
            if v > max_speed[a] {
                factor = factor.min(max_speed[a] / v);
            }
        }
        cruise *= factor;
        for v in &mut axis {
            *v *= factor;
        }
        let mut accel = match m.kind {
            Kind::Travel | Kind::TravelZ | Kind::Lift | Kind::Spiral { .. } => set.min(s.max_accel_travel),
            Kind::Retract => s.max_accel_retract,
            _ => set.min(s.max_accel_xy),
        };
        for a in 0..4 {
            let share = delta[a].abs() * inv;
            if share > 0.0 && accel * share > max_accel[a] {
                accel = max_accel[a] / share;
            }
        }
        let mut safe = cruise;
        for a in 0..4 {
            if axis[a].abs() > jerk[a] {
                safe = safe.min(jerk[a]);
            }
        }
        let mut junction = safe;
        if self.prev_cruise > 0.0001 {
            let prev_larger = self.prev_cruise > cruise;
            let smaller = if prev_larger { cruise / self.prev_cruise } else { self.prev_cruise / cruise };
            junction = if prev_larger { cruise } else { self.prev_cruise };
            let mut v_factor = 1.0;
            let mut limited = false;
            // X, Y and Z together, as Bambu's estimator has it: the change of velocity on each, scaled down by
            // everything found so far wherever one is too much.
            let exit_scale = self.prev_cruise * if prev_larger { smaller } else { 1.0 };
            let mut change = [0.0f64; 3];
            for a in 0..3 {
                change[a] = (cruise * dir[a] - exit_scale * self.prev_dir[a]).abs();
            }
            for a in 0..3 {
                if change[a] > jerk[a] {
                    v_factor *= jerk[a] / change[a];
                    for c in &mut change {
                        *c *= v_factor;
                    }
                    limited = true;
                }
            }
            // The filament as Marlin's classic jerk has it: coasting or reversing.
            {
                let mut v_exit = self.prev_axis[3];
                let mut v_entry = axis[3];
                if prev_larger {
                    v_exit *= smaller;
                }
                if limited {
                    v_exit *= v_factor;
                    v_entry *= v_factor;
                }
                let j = if v_exit > v_entry {
                    if v_entry > 0.0 || v_exit < 0.0 { v_exit - v_entry } else { v_exit.max(-v_entry) }
                } else if v_entry < 0.0 || v_exit > 0.0 {
                    v_entry - v_exit
                } else {
                    (-v_exit).max(v_entry)
                };
                if j > jerk[3] {
                    v_factor *= jerk[3] / j;
                    limited = true;
                }
            }
            if limited {
                junction *= v_factor;
            }
            let threshold = junction * 0.99;
            if self.prev_safe > threshold && safe > threshold {
                junction = safe;
            }
        }
        let allowable = (safe * safe + 2.0 * accel * dist).sqrt();
        self.blocks.push(Block {
            dist,
            cruise,
            accel,
            safe,
            max_entry: junction,
            entry: junction.min(allowable),
            nominal_length: cruise <= allowable,
        });
        self.index.push(i);
        self.prev_cruise = cruise;
        self.prev_axis = axis;
        self.prev_safe = safe;
        self.prev_dir = dir;
    }
}

/// Each move's seconds: the printer's planner, as Orca's G-code processor models it (Marlin's classic jerk, with
/// Bambu's limit on curves and its jerk on X, Y and Z together). A spiral lift is timed as the straight pieces the
/// processor splits it into.
fn timing(moves: &[Move], start: [f64; 3], s: &Settings) -> Vec<f64> {
    timing_with(moves, start, s, &[])
}

/// `timing`, the planner starting again from rest at `resets` (move index, where the nozzle is then).
fn timing_with(moves: &[Move], start: [f64; 3], s: &Settings, resets: &[(usize, [f64; 3])]) -> Vec<f64> {
    let mut p = Planner {
        s,
        blocks: Vec::with_capacity(moves.len()),
        index: Vec::with_capacity(moves.len()),
        at: start,
        prev_cruise: 0.0,
        prev_axis: [0.0; 4],
        prev_safe: 0.0,
        prev_dir: [0.0; 3],
    };
    let mut r = 0;
    for (i, m) in moves.iter().enumerate() {
        while r < resets.len() && resets[r].0 <= i {
            (p.at, p.prev_cruise, p.prev_axis, p.prev_safe, p.prev_dir) = (resets[r].1, 0.0, [0.0; 4], 0.0, [0.0; 3]);
            r += 1;
        }
        if let Kind::Spiral { i: ci, j: cj } = m.kind {
            let r = ci.hypot(cj);
            let (cx, cy, z0) = (p.at[0] + ci, p.at[1] + cj, p.at[2]);
            let a0 = (-cj).atan2(-ci);
            let n = arc_steps(r, 2.0 * PI);
            for k in 1..=n {
                let t = k as f64 / n as f64;
                let a = a0 + 2.0 * PI * t;
                let to =
                    if k == n { [m.x, m.y, m.z] } else { [cx + r * a.cos(), cy + r * a.sin(), z0 + (m.z - z0) * t] };
                p.add(to, 0.0, m, i);
            }
        } else {
            p.add([m.x, m.y, m.z], m.e, m, i);
        }
    }
    let Planner { mut blocks, index, .. } = p;

    // Backwards: every block can slow down to the next one's entry.
    for i in (0..blocks.len().saturating_sub(1)).rev() {
        let next_entry = blocks[i + 1].entry;
        let b = &mut blocks[i];
        if b.entry != b.max_entry {
            b.entry = if !b.nominal_length && b.max_entry > next_entry {
                b.max_entry.min((next_entry * next_entry + 2.0 * b.accel * b.dist).sqrt())
            } else {
                b.max_entry
            };
        }
    }
    // Forwards: every block can speed up from the one before.
    for i in 1..blocks.len() {
        let (prev, rest) = blocks.split_at_mut(i);
        let p = &prev[i - 1];
        let b = &mut rest[0];
        if !p.nominal_length && p.entry < b.entry {
            b.entry = b.entry.min((p.entry * p.entry + 2.0 * p.accel * p.dist).sqrt());
        }
    }

    let mut times = vec![0.0; moves.len()];
    for k in 0..blocks.len() {
        let exit = if k + 1 < blocks.len() { blocks[k + 1].entry } else { blocks[k].safe };
        times[index[k]] += trapezoid(&blocks[k], exit);
    }
    times
}

/// Seconds to cover a block from its entry speed to `exit`, accelerating towards its cruise speed.
fn trapezoid(b: &Block, exit: f64) -> f64 {
    let (v0, v1, vc, a, d) = (b.entry, exit, b.cruise, b.accel, b.dist);
    if a <= 0.0 {
        return d / vc;
    }
    let accel_d = ((vc * vc - v0 * v0) / (2.0 * a)).max(0.0);
    let decel_d = ((vc * vc - v1 * v1) / (2.0 * a)).max(0.0);
    let cruise_d = d - accel_d - decel_d;
    if cruise_d >= 0.0 {
        return (vc - v0).max(0.0) / a + cruise_d / vc + (vc - v1).max(0.0) / a;
    }
    // Never reaches cruise: accelerate to where the two ramps meet, then brake.
    let meet = ((2.0 * a * d - v0 * v0 + v1 * v1) / (4.0 * a)).clamp(0.0, d);
    let peak = (v0 * v0 + 2.0 * a * meet).sqrt();
    (peak - v0).max(0.0) / a + (peak - v1).max(0.0) / a
}

// ---- Text.

struct LayerOut {
    text: Vec<u8>,
    first_accel: Option<(usize, usize, f64)>,
    last_accel: f64,
    time: f64,
    travel_time: f64,
    travel_distance: f64,
    retractions: usize,
    filament_mm: f64,
    features: [Feature; Role::ALL.len()],
    by_filament: Vec<[f64; 2]>,
}

fn role_index(role: Role) -> usize {
    Role::ALL.iter().position(|&r| r == role).unwrap_or(0)
}

/// What the text writer knows of the printer's state, to write only what changes as Orca does.
struct Writer {
    feature: Option<Role>,
    width: f64,
    /// The height last written (the layer's, from its header on).
    height: f32,
    accel: f64,
    /// The feed rate in whole mm/min, as Orca's cooling compares them.
    feed: i64,
    first_accel: Option<(usize, usize, f64)>,
}

impl Writer {
    fn accel(&mut self, t: &mut Vec<u8>, accel: f64) {
        if !accel.is_finite() || accel == self.accel {
            return;
        }
        let from = t.len();
        t.extend_from_slice(b"M204 S");
        num(t, accel, 0);
        t.push(b'\n');
        if self.first_accel.is_none() {
            self.first_accel = Some((from, t.len(), accel));
        }
        self.accel = accel;
    }

    /// ` F…` (or a line of its own) when the feed rate changes: three decimals as Orca's writer gives it.
    fn feed(&mut self, t: &mut Vec<u8>, f: f64, own_line: bool) {
        let mm_min = f * 60.0;
        if mm_min as i64 == self.feed {
            return;
        }
        t.extend_from_slice(if own_line { b"G1 F" } else { b" F" });
        num(t, mm_min, 3);
        if own_line {
            t.push(b'\n');
        }
        self.feed = mm_min as i64;
    }
}

fn finish_layer(
    moves: &[Move],
    notes: &[(usize, Note)],
    start: [f64; 3],
    job: &Job,
    text: Vec<u8>,
    header_height: f32,
    (fans, mut tool): ([f64; 2], usize),
) -> LayerOut {
    let s = job.settings;
    // Where the prime tower's G-code leaves the nozzle, the planner starts again.
    let resets: Vec<(usize, [f64; 3])> = notes
        .iter()
        .filter_map(|(k, n)| match n {
            Note::Tower(t) => t.end.map(|e| (*k, e)),
            _ => None,
        })
        .collect();
    let times = timing_with(moves, start, s, &resets);
    let filaments = job.colours.map_or(0, |c| c.settings.len());
    let mut out = LayerOut {
        text,
        first_accel: None,
        last_accel: f64::NAN,
        time: 0.0,
        travel_time: 0.0,
        travel_distance: 0.0,
        retractions: 0,
        filament_mm: 0.0,
        features: Default::default(),
        by_filament: vec![[0.0; 2]; filaments],
    };
    let area = s.filament_area();
    let mut w =
        Writer { feature: None, width: f64::NAN, height: header_height, accel: f64::NAN, feed: -1, first_accel: None };
    let mut wiping = false;
    let mut at = start;
    let mut next_note = 0;
    let t = &mut out.text;
    // Each move with what is said before it, then what is said after the last one.
    for (k, m) in moves.iter().map(Some).chain([None]).enumerate() {
        if wiping && m.is_none_or(|m| m.kind != Kind::Wipe) {
            t.extend_from_slice(b"; WIPE_END\n");
            wiping = false;
        }
        while next_note < notes.len() && notes[next_note].0 == k {
            match &notes[next_note].1 {
                Note::Tower(tower) => {
                    let text = tower.text.replace(
                        ";_FORCE_RESUME_FAN_SPEED\n",
                        &format!("M106 P2 S{}\n{}", (255.0 * fans[1] / 100.0) as i64, fan_line(fans[0])),
                    );
                    t.extend_from_slice(text.as_bytes());
                    out.time += tower.secs;
                    out.travel_time += tower.secs - tower.extruding;
                    out.travel_distance += tower.travel;
                    out.filament_mm += tower.mm;
                    let f = &mut out.features[role_index(Role::PrimeTower)];
                    f.time += tower.extruding;
                    f.volume += tower.volume;
                    if let Some(b) = out.by_filament.get_mut(tower.filament) {
                        b[0] += tower.mm;
                        b[1] += tower.volume;
                    }
                    // What the tower's G-code set, the writer doesn't know: it writes the next feature, width,
                    // height and speed again, as Orca does after the tower.
                    (w.feature, w.width, w.height, w.feed) = (None, f64::NAN, f32::NAN, -1);
                    if let Some(a) = tower.accel {
                        w.accel = a;
                    }
                    if let Some(e) = tower.end {
                        at = e;
                    }
                }
                Note::Tool(f) => tool = *f,
                note => write_note(t, note, job, &mut w),
            }
            next_note += 1;
        }
        let Some(m) = m else { break };
        let secs = times[k];
        out.time += secs;
        match m.kind {
            Kind::Extrude(role) => {
                let f = &mut out.features[role_index(role)];
                f.time += secs;
                f.volume += m.e * area;
                out.filament_mm += m.e;
                if let Some(b) = out.by_filament.get_mut(tool) {
                    b[0] += m.e;
                }
            }
            Kind::Travel | Kind::TravelZ => {
                out.travel_time += secs;
                out.travel_distance += (m.x - at[0]).hypot(m.y - at[1]);
            }
            Kind::Retract | Kind::Wipe | Kind::Lift | Kind::Spiral { .. } => out.travel_time += secs,
        }
        // Each retraction is undone once before printing again: count those.
        if m.kind == Kind::Retract && m.e > 0.0 {
            out.retractions += 1;
        }
        match m.kind {
            Kind::Extrude(role) => {
                w.accel(t, m.accel);
                if w.feature != Some(role) {
                    t.extend_from_slice(b"; FEATURE: ");
                    t.extend_from_slice(role.feature().as_bytes());
                    t.push(b'\n');
                    w.feature = Some(role);
                }
                if m.width as f64 != w.width {
                    t.extend_from_slice(b"; LINE_WIDTH: ");
                    t.extend_from_slice(format_g(m.width as f64).as_bytes());
                    t.push(b'\n');
                    w.width = m.width as f64;
                }
                if (m.height - w.height).abs() > 1e-4 {
                    t.extend_from_slice(b"; LAYER_HEIGHT: ");
                    t.extend_from_slice(format_g(m.height as f64).as_bytes());
                    t.push(b'\n');
                    w.height = m.height;
                }
                w.feed(t, m.f, true);
                t.extend_from_slice(b"G1 X");
                num(t, m.x, 3);
                t.extend_from_slice(b" Y");
                num(t, m.y, 3);
                t.extend_from_slice(b" E");
                num(t, m.e, 5);
            }
            Kind::Travel | Kind::TravelZ => {
                w.accel(t, m.accel);
                t.extend_from_slice(b"G1 X");
                num(t, m.x, 3);
                t.extend_from_slice(b" Y");
                num(t, m.y, 3);
                if m.kind == Kind::TravelZ {
                    t.extend_from_slice(b" Z");
                    num(t, m.z, 3);
                }
                w.feed(t, m.f, false);
            }
            Kind::Wipe => {
                w.accel(t, m.accel);
                if !wiping {
                    t.extend_from_slice(b"; WIPE_START\n");
                    wiping = true;
                }
                w.feed(t, m.f, true);
                t.extend_from_slice(b"G1 X");
                num(t, m.x, 3);
                t.extend_from_slice(b" Y");
                num(t, m.y, 3);
                t.extend_from_slice(b" E");
                num(t, m.e, 5);
            }
            Kind::Retract => {
                w.accel(t, m.accel);
                t.extend_from_slice(b"G1 E");
                num(t, m.e, 5);
                w.feed(t, m.f, false);
            }
            Kind::Lift => {
                t.extend_from_slice(b"G1 Z");
                num(t, m.z, 3);
                w.feed(t, m.f, false);
            }
            Kind::Spiral { i, j } => {
                t.extend_from_slice(b"G17\nG3 Z");
                num(t, m.z, 3);
                t.extend_from_slice(b" I");
                num(t, i, 3);
                t.extend_from_slice(b" J");
                num(t, j, 3);
                // Orca writes the speed into every spiral.
                t.extend_from_slice(b" P1  F");
                num(t, m.f * 60.0, 3);
                w.feed = (m.f * 60.0) as i64;
            }
        }
        t.push(b'\n');
        at = [m.x, m.y, m.z];
    }
    out.first_accel = w.first_accel;
    out.last_accel = w.accel;
    out
}

fn write_note(t: &mut Vec<u8>, note: &Note, job: &Job, w: &mut Writer) {
    let object = |k: u32| job.objects.get(k as usize);
    match note {
        Note::Accel(a) => w.accel(t, *a),
        Note::Printing(k) | Note::Stopped(k) => {
            let verb = if matches!(note, Note::Printing(_)) { "printing" } else { "stop printing" };
            let name = object(*k).map_or("", |o| o.name.as_str());
            t.extend_from_slice(format!("; {verb} object {name} id:{k} copy 0\n").as_bytes());
        }
        Note::LabelStart(k) => {
            let label = object(*k).map_or(0, |o| o.label);
            t.extend_from_slice(
                format!(
                    "; start printing object, unique label id: {label}\nM624 {}\n",
                    base64_u64(label_bit(job, label))
                )
                .as_bytes(),
            );
        }
        Note::LabelEnd(k) => {
            let label = object(*k).map_or(0, |o| o.label);
            t.extend_from_slice(format!("; stop printing object, unique label id: {label}\nM625\n").as_bytes());
        }
        Note::Text(text) => t.extend_from_slice(text.as_bytes()),
        Note::Tower(tower) => t.extend_from_slice(tower.text.as_bytes()),
        Note::Tool(_) => {}
    }
}

/// `M106 S…` for the part fan at `percent`, as a line.
fn fan_line(percent: f64) -> String {
    let mut t = Vec::new();
    set_fan(&mut t, percent);
    String::from_utf8(t).unwrap_or_default()
}

/// A string in a list of strings as Orca writes it (`escape_strings_cstyle`): quoted, with `\\` and `\"` escaped, when it
/// holds a space, a tab, a `;`, a quote, a backslash or a line break.
fn quoted(v: &str) -> String {
    if !v.contains([' ', ';', '\t', '\\', '"', '\r', '\n']) {
        return v.to_string();
    }
    let mut out = String::from('"');
    for c in v.chars() {
        match c {
            '\\' | '"' => {
                out.push('\\');
                out.push(c);
            }
            '\r' => out.push_str("\\r"),
            '\n' => out.push_str("\\n"),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn header(t: &mut Vec<u8>, stats: &Stats, job: &Job) {
    let s = job.settings;
    let line = |t: &mut Vec<u8>, text: &str| {
        t.extend_from_slice(text.as_bytes());
        t.push(b'\n');
    };
    line(t, "; HEADER_BLOCK_START");
    line(t, &format!("; generated by {NAME} {VERSION}"));
    line(
        t,
        &format!(
            "; model printing time: {}; total estimated time: {}",
            duration(stats.model_time),
            duration(stats.total_time)
        ),
    );
    // Orca's estimate counts the start G-code as the first layer and the first layer as the second, so what it calls
    // the first layer's time is the start's.
    line(t, &format!("; estimated first layer printing time (normal mode) = {}", duration(stats.prepare_time)));
    line(t, &format!("; total layer number: {}", stats.layers));
    if job.labels() {
        let mut labels: Vec<u32> = job.objects.iter().map(|o| o.label).collect();
        labels.sort_unstable();
        let labels: Vec<String> = labels.iter().map(u32::to_string).collect();
        line(t, &format!("; model label id: {}", labels.join(",")));
    }
    // Each filament's, and the filaments the plate uses.
    let (densities, diameters, used) = match job.colours {
        Some(c) => {
            let all = |v: fn(&Settings) -> f64| c.settings.iter().map(|fs| trim(v(fs))).collect::<Vec<_>>().join(",");
            let mut used: Vec<usize> = c.orders.iter().flatten().copied().collect();
            used.sort_unstable();
            used.dedup();
            let used: Vec<String> = used.iter().map(|f| (f + 1).to_string()).collect();
            (all(|fs| fs.filament_density), all(|fs| fs.filament_diameter), used.join(","))
        }
        None => (trim(s.filament_density), trim(s.filament_diameter), "1".to_string()),
    };
    line(t, &format!("; filament_density: {densities}"));
    line(t, &format!("; filament_diameter: {diameters}"));
    line(t, &format!("; max_z_height: {:.2}", stats.max_z));
    line(t, &format!("; filament: {used}"));
    line(t, "; HEADER_BLOCK_END");
    line(t, "");
    line(t, "; CONFIG_BLOCK_START");
    let settings = match job.colours {
        Some(c) => c.project_settings(s),
        None => s.project_settings(),
    };
    for (key, value) in settings {
        let text = match value {
            crate::config::Value::One(v) => v,
            // Several filaments' names, as Orca lists strings: ';' between them, quoted where they have spaces.
            crate::config::Value::List(v)
                if job.colours.is_some()
                    && matches!(key, "filament_settings_id" | "filament_type" | "filament_colour") =>
            {
                v.iter().map(|v| quoted(v)).collect::<Vec<_>>().join(";")
            }
            crate::config::Value::List(v) => v.join(","),
        };
        line(t, &format!("; {key} = {text}"));
    }
    line(t, "; CONFIG_BLOCK_END");
    line(t, "");
    // Orca writes the widths once for each print region, which here is once for each object.
    for _ in 0..job.objects.len().max(1) {
        for (what, width) in [
            ("external perimeters", s.outer_wall_width),
            ("perimeters", s.inner_wall_width),
            ("infill", s.sparse_infill_width),
            ("solid infill", s.solid_infill_width),
            ("top infill", s.top_surface_width),
            ("first layer", s.first_layer_width),
        ] {
            line(t, &format!("; {what} extrusion width = {width:.2}mm"));
        }
        line(t, "");
    }
}

/// The percentage done and the whole minutes left, `elapsed` seconds into `total`, rounded as Orca's estimator
/// rounds them.
fn progress(elapsed: f64, total: f64) -> (u64, u64) {
    let percent = if total > 0.0 { (100.0 * elapsed / total).floor().clamp(0.0, 100.0) } else { 0.0 };
    let left = (((total - elapsed).max(0.0) + 0.5) / 60.0).floor();
    (percent as u64, left as u64)
}

/// `M73 P<percent> R<minutes left>`: the printer's progress, and the app's per-layer times.
fn m73(t: &mut Vec<u8>, elapsed: f64, total: f64) {
    let (percent, left) = progress(elapsed, total);
    t.extend_from_slice(b"M73 P");
    int(t, percent);
    t.extend_from_slice(b" R");
    int(t, left);
    t.push(b'\n');
}

/// The printer's start G-code timed as Orca's estimator times it: its moves through the planner (at the
/// accelerations it sets; `G28` as a move to 0 on the axes it homes), its pauses (`G4`, `M400` with `S` or `P`), the
/// bed levelling (`G29`, a fixed 260 s, once), heating the chamber (`M191` over 40 °C, 720 s) and loading the first
/// filament (the first `T0`…`T254`). Commands it doesn't know (the X2D's own `G130`, `G150`, `G380`, …) take no time.
fn time_custom(text: &str, s: &Settings) -> f64 {
    let mut moves: Vec<Move> = Vec::new();
    let mut at = [0.0f64; 3];
    let mut start = at;
    let mut absolute = true;
    let mut feed = s.travel_speed;
    let mut accel = s.default_accel;
    let mut seconds = 0.0;
    let (mut levelled, mut loaded) = (false, false);
    for line in text.lines() {
        let code = line.split(';').next().unwrap_or("").trim();
        let words: Vec<&str> = code.split_whitespace().collect();
        let Some(&cmd) = words.first() else { continue };
        let value = |letter: u8| -> Option<f64> {
            words[1..].iter().find(|w| w.as_bytes().first() == Some(&letter)).and_then(|w| w[1..].parse().ok())
        };
        let mut pause = 0.0;
        match cmd {
            "G90" => absolute = true,
            "G91" => absolute = false,
            "M204" => accel = value(b'S').unwrap_or(accel),
            "G0" | "G1" | "G28" => {
                let mut to = at;
                let mut e = 0.0;
                if cmd == "G28" {
                    let homed: Vec<usize> = (0..3).filter(|&a| words[1..].contains(&["X", "Y", "Z"][a])).collect();
                    for a in if homed.is_empty() { vec![0, 1, 2] } else { homed } {
                        to[a] = 0.0;
                    }
                } else {
                    for (a, letter) in b"XYZ".iter().copied().enumerate() {
                        if let Some(v) = value(letter) {
                            to[a] = if absolute { v } else { at[a] + v };
                        }
                    }
                    e = value(b'E').unwrap_or(0.0);
                    feed = value(b'F').map_or(feed, |f| f / 60.0);
                }
                let kind = if to[0] != at[0] || to[1] != at[1] {
                    if e > 0.0 { Kind::Extrude(Role::InnerWall) } else { Kind::Travel }
                } else if to[2] != at[2] {
                    Kind::Lift
                } else {
                    Kind::Retract
                };
                if to != at || e != 0.0 {
                    moves.push(Move { x: to[0], y: to[1], z: to[2], e, f: feed, accel, kind, width: 0.0, height: 0.0 });
                }
                at = to;
            }
            "G4" | "M400" => pause = value(b'S').unwrap_or(0.0) + value(b'P').unwrap_or(0.0) / 1000.0,
            "G29" if !levelled => {
                levelled = true;
                pause = 260.0;
            }
            "M191" if value(b'S').is_some_and(|t| t > 40.0) => pause = 720.0,
            _ if !loaded && cmd.len() > 1 && cmd.starts_with('T') && cmd[1..].parse::<u32>().is_ok_and(|n| n < 255) => {
                loaded = true;
                pause = s.filament_load_time;
            }
            _ => {}
        }
        // A pause waits for the moves before it: they start and end at rest.
        if pause > 0.0 {
            seconds += timing(&moves, start, s).iter().sum::<f64>() + pause;
            moves.clear();
            start = at;
        }
    }
    seconds + timing(&moves, start, s).iter().sum::<f64>()
}

/// What a piece of G-code text costs (`time_text`).
pub struct TextTime {
    pub secs: f64,
    /// Seconds extruding.
    pub extruding: f64,
    /// Where it leaves the nozzle, if it moves it.
    pub end: Option<[f64; 3]>,
    /// The acceleration it leaves set, if it sets one.
    pub accel: Option<f64>,
    /// mm of filament extruded (moves that print), and mm travelled.
    pub mm: f64,
    pub travel: f64,
}

/// Times G-code text (the prime tower's, a tool change's) from `from`, as Orca's estimator does: its moves through the
/// planner at the accelerations it sets (a full-circle `G2`/`G3` lift as the circle), its pauses (`G4`, `M400` with
/// `S` or `P`, `SYNC T`). Tool changes themselves (`T…`) are timed by `toolchange.rs`.
pub fn time_text(text: &str, from: [f64; 3], s: &Settings) -> TextTime {
    let mut moves: Vec<Move> = Vec::new();
    let mut at = from;
    let mut start = at;
    let mut feed = s.travel_speed;
    let mut accel = f64::NAN;
    let mut out = TextTime { secs: 0.0, extruding: 0.0, end: None, accel: None, mm: 0.0, travel: 0.0 };
    let flush = |moves: &mut Vec<Move>, start: [f64; 3], out: &mut TextTime| {
        let times = timing(moves, start, s);
        for (m, t) in moves.iter().zip(&times) {
            out.secs += t;
            if matches!(m.kind, Kind::Extrude(_)) {
                out.extruding += t;
            }
        }
        moves.clear();
    };
    for line in text.lines() {
        // Orca's estimator runs the moves the printer makes by itself too, which the G-code gives as comments
        // (`;VG1 E4 F523`: the push after a filament change, the flush).
        let line = line.strip_prefix(";V").filter(|l| l.starts_with("G1 ")).unwrap_or(line);
        let code = line.split(';').next().unwrap_or("").trim();
        let words: Vec<&str> = code.split_whitespace().collect();
        let Some(&cmd) = words.first() else { continue };
        let value = |letter: u8| -> Option<f64> {
            words[1..].iter().find(|w| w.as_bytes().first() == Some(&letter)).and_then(|w| w[1..].parse().ok())
        };
        // A pause, and whether the planner waits for the moves before it (`G4 S0` and `SYNC T0` do, a bare `M400`
        // doesn't on Orca's Marlin).
        let (mut pause, mut sync) = (0.0, false);
        match cmd {
            "M204" => {
                accel = value(b'S').unwrap_or(accel);
                out.accel = Some(accel);
            }
            "G0" | "G1" => {
                let mut to = at;
                for (a, letter) in b"XYZ".iter().copied().enumerate() {
                    if let Some(v) = value(letter) {
                        to[a] = v;
                    }
                }
                let e = value(b'E').unwrap_or(0.0);
                feed = value(b'F').map_or(feed, |f| f / 60.0);
                let xy = to[0] != at[0] || to[1] != at[1];
                let kind = if xy {
                    if e > 0.0 { Kind::Extrude(Role::PrimeTower) } else { Kind::Travel }
                } else if to[2] != at[2] {
                    Kind::Lift
                } else {
                    Kind::Retract
                };
                if xy && e > 0.0 {
                    out.mm += e;
                } else if xy {
                    out.travel += (to[0] - at[0]).hypot(to[1] - at[1]);
                }
                if to != at || e != 0.0 {
                    moves.push(Move { x: to[0], y: to[1], z: to[2], e, f: feed, accel, kind, width: 0.0, height: 0.0 });
                }
                if to != at {
                    out.end = Some(to);
                }
                at = to;
            }
            "G2" | "G3" if value(b'P') == Some(1.0) => {
                // A lift turning once round a point beside the nozzle.
                let (i, j) = (value(b'I').unwrap_or(0.0), value(b'J').unwrap_or(0.0));
                feed = value(b'F').map_or(feed, |f| f / 60.0);
                let to = [at[0], at[1], value(b'Z').unwrap_or(at[2])];
                moves.push(Move {
                    x: to[0],
                    y: to[1],
                    z: to[2],
                    e: 0.0,
                    f: feed,
                    accel,
                    kind: Kind::Spiral { i, j },
                    width: 0.0,
                    height: 0.0,
                });
                if to != at {
                    out.end = Some(to);
                }
                at = to;
            }
            "G4" | "M400" if value(b'S').is_some() || value(b'P').is_some() => {
                (pause, sync) = (value(b'S').unwrap_or(0.0) + value(b'P').unwrap_or(0.0) / 1000.0, true);
            }
            "SYNC" if value(b'T').is_some() => (pause, sync) = (value(b'T').unwrap_or(0.0), true),
            _ => {}
        }
        if sync {
            flush(&mut moves, start, &mut out);
            out.secs += pause;
            start = at;
        }
    }
    flush(&mut moves, start, &mut out);
    out
}

/// "1h 2m 3s", "32m 36s", "5s": durations as Orca writes them (whole seconds, cut off rather than rounded).
pub fn duration(seconds: f64) -> String {
    let total = seconds.max(0.0);
    let whole = total as u64;
    let (d, h, m, s) = (whole / 86400, whole / 3600 % 24, whole / 60 % 60, whole % 60);
    if d > 0 {
        format!("{d}d {h}h {m}m {s}s")
    } else if h > 0 {
        format!("{h}h {m}m {s}s")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else if total > 1.0 {
        format!("{s}s")
    } else {
        format!("{total:.6}s")
    }
}

const POW10: [f64; 7] = [1.0, 10.0, 100.0, 1000.0, 10000.0, 100000.0, 1000000.0];

/// A number with at most `decimals` places, trailing zeros and a leading zero dropped: 0.6 → ".6", 24.0 → "24".
fn num(t: &mut Vec<u8>, v: f64, decimals: usize) {
    let scaled = (v * POW10[decimals]).round() as i64;
    if scaled == 0 {
        t.push(b'0');
        return;
    }
    if scaled < 0 {
        t.push(b'-');
    }
    let a = scaled.unsigned_abs();
    let p = POW10[decimals] as u64;
    let whole = a / p;
    let mut frac = a % p;
    if whole > 0 {
        int(t, whole);
    }
    if frac > 0 {
        let mut digits = decimals;
        while frac.is_multiple_of(10) {
            frac /= 10;
            digits -= 1;
        }
        let mut buf = [b'0'; 8];
        for slot in buf[..digits].iter_mut().rev() {
            *slot = b'0' + (frac % 10) as u8;
            frac /= 10;
        }
        t.push(b'.');
        t.extend_from_slice(&buf[..digits]);
    }
}

fn int(t: &mut Vec<u8>, mut v: u64) {
    let mut buf = [0u8; 20];
    let mut i = buf.len();
    loop {
        i -= 1;
        buf[i] = b'0' + (v % 10) as u8;
        v /= 10;
        if v == 0 {
            break;
        }
    }
    t.extend_from_slice(&buf[i..]);
}

impl Stats {
    /// The statistics as Orca's `--export-statistics` writes them (the summary and its features), so the two can be
    /// compared key by key.
    pub fn json(&self, s: &Settings) -> String {
        let g = |volume: f64| volume * s.filament_density / 1000.0;
        let mut features = String::new();
        for (role, f) in Role::ALL.iter().zip(&self.features) {
            if f.volume <= 0.0 && f.time <= 0.0 {
                continue;
            }
            if !features.is_empty() {
                features.push(',');
            }
            features.push_str(&format!(
                "\n   \"{}\": {{\"time\": {:.3}, \"volume\": {:.3}, \"weight\": {:.4}}}",
                role.feature(),
                f.time,
                f.volume,
                g(f.volume)
            ));
        }
        let layers: Vec<String> = self.layer_times.iter().map(|t| format!("{t:.3}")).collect();
        // With several filaments, each one's use (as Orca's statistics give them), the tool changes and the tower.
        let mut colours = String::new();
        if !self.filaments.is_empty() {
            let uses: Vec<String> = self
                .filaments
                .iter()
                .enumerate()
                .map(|(i, f)| {
                    format!(
                        "\n   {{\"id\": {}, \"length\": {:.2}, \"volume\": {:.3}, \"weight\": {:.4}, \"cost\": {:.2}, \"prime_tower\": {{\"volume\": {:.3}, \"weight\": {:.4}}}, \"flush\": {{\"volume\": {:.3}, \"weight\": {:.4}}}}}",
                        i + 1,
                        f.length,
                        f.volume,
                        f.weight,
                        f.cost,
                        f.tower,
                        f.tower * f.density,
                        f.flush,
                        f.flush * f.density
                    )
                })
                .collect();
            let tower = self.tower.unwrap_or_default();
            colours = format!(
                "  \"filaments\": [{}\n  ],\n  \"tool_changes\": {},\n  \"prime_tower\": {{\"width\": {:.3}, \"depth\": {:.3}, \"brim_width\": {:.3}}},\n",
                uses.join(","),
                self.tool_changes,
                tower[0],
                tower[1],
                tower[2]
            );
        }
        format!(
            "{{\n \"generator\": \"{NAME} {VERSION}\",\n \"summary\": {{\n  \"time\": {:.3},\n  \"prepare_time\": {:.3},\n  \"model_time\": {:.3},\n  \"travel_time\": {:.3},\n  \"travel_distance\": {:.2},\n  \"retractions\": {},\n  \"layer_count\": {},\n  \"length\": {:.2},\n  \"volume\": {:.3},\n  \"weight\": {:.4},\n  \"filament_cost\": {:.2},\n{}  \"features\": {{{}\n  }}\n }},\n \"layer_times\": [{}]\n}}\n",
            self.total_time,
            self.prepare_time,
            self.model_time,
            self.travel_time,
            self.travel_distance,
            self.retractions,
            self.layers,
            self.filament_mm,
            self.volume,
            self.weight,
            self.cost,
            colours,
            features,
            layers.join(", ")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plan::Part;

    fn text(v: f64, d: usize) -> String {
        let mut t = Vec::new();
        num(&mut t, v, d);
        String::from_utf8(t).unwrap()
    }

    #[test]
    fn numbers_are_written_like_orca() {
        assert_eq!(text(0.6, 3), ".6");
        assert_eq!(text(24.0, 3), "24");
        assert_eq!(text(135.4234, 3), "135.423");
        assert_eq!(text(-0.4, 5), "-.4");
        assert_eq!(text(0.012114, 5), ".01211");
        assert_eq!(text(0.000001, 5), "0");
        assert_eq!(text(12000.0, 0), "12000");
        assert_eq!(text(100.05, 3), "100.05");
    }

    #[test]
    fn fans_follow_orcas_cooling() {
        // Generic ABS on the X2D: no fan for three layers, 80 % on a layer under 3 s, easing to 10 % by 30 s.
        let mut s = Settings::default();
        (s.fan_off_layers, s.fan_min_speed, s.fan_max_speed) = (3, 0.1, 0.8);
        (s.slow_down_layer_time, s.fan_cooling_layer_time, s.aux_fan_speed) = (3.0, 30.0, 0.0);
        assert_eq!(layer_fans(2, 2.0, &s), [0.0, 0.0]);
        assert_eq!(layer_fans(3, 2.0, &s), [80.0, 0.0]);
        assert_eq!(layer_fans(3, 3.0, &s), [80.0, 0.0]);
        assert_eq!(layer_fans(3, 16.5, &s), [45.0, 0.0]);
        assert_eq!(layer_fans(3, 40.0, &s), [10.0, 0.0]);
        // A fan that doesn't stay on stops on a long layer.
        s.fan_always_on = false;
        assert_eq!(layer_fans(3, 40.0, &s), [0.0, 0.0]);
        // A ramp over the first fan layers.
        (s.full_fan_speed_layer, s.fan_always_on) = (6, true);
        assert_eq!(layer_fans(3, 2.0, &s), [27.0, 0.0]);
        assert_eq!(layer_fans(4, 2.0, &s), [53.0, 0.0]);
        assert_eq!(layer_fans(5, 2.0, &s), [80.0, 0.0]);
        // PLA Basic: full fan from the second layer whatever the layer's time, the auxiliary fan at 70 %.
        let pla = Settings::default();
        for time in [1.0, 4.0, 4.5, 37.3, 99.9, 500.0] {
            assert_eq!(layer_fans(1, time, &pla), [100.0, 70.0], "{time} s");
        }
        // As Orca's writer turns percent into the fan's 0–255.
        for (percent, line) in
            [(100.0, "M106 S255\n"), (80.0, "M106 S204\n"), (45.0, "M106 S114\n"), (0.0, "M106 S0\n")]
        {
            let mut t = Vec::new();
            set_fan(&mut t, percent);
            assert_eq!(String::from_utf8(t).unwrap(), line);
        }
    }

    #[test]
    fn travels_retract_where_orcas_do() {
        // An island 20 mm square with a 4 mm hole in its middle, and a top surface in a corner of it.
        let mm = geom::SCALE as i32;
        let square = |x0: i32, y0: i32, x1: i32, y1: i32| {
            vec![
                geom::pt(x0 * mm, y0 * mm),
                geom::pt(x1 * mm, y0 * mm),
                geom::pt(x1 * mm, y1 * mm),
                geom::pt(x0 * mm, y1 * mm),
            ]
        };
        let mut hole = square(8, 8, 12, 12);
        hole.reverse();
        let island = crate::region::Island { outline: vec![square(0, 0, 20, 20), hole], ..Default::default() };
        let islands = vec![island];
        let tops: Shapes = vec![vec![square(2, 14, 6, 18)]];
        let internal = Internal::new(&islands, &tops, &[]);
        let s = Settings::default();
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        let path = |role: Role, island: u32| Path {
            role,
            points: Vec::new(),
            closed: false,
            width: 0.42,
            height: 0.2,
            mm3_per_mm: 0.08,
            speed: 100.0,
            accel: 1000.0,
            island,
            object: 0,
            parts: Vec::new(),
        };
        let (sparse, solid, gap) = (path(Role::SparseInfill, 0), path(Role::SolidInfill, 0), path(Role::GapFill, 0));
        let (inner, outer, top) = (path(Role::InnerWall, 0), path(Role::OuterWall, 0), path(Role::TopSurface, 0));
        let elsewhere = path(Role::SparseInfill, 1);
        // Within the island, off its hole and its top surface: to infill, from infill or an inner wall, none.
        assert!(!retracts(&sparse, &solid, 16.0, p(2.0, 2.0), p(18.0, 2.0), &internal, &s));
        assert!(!retracts(&inner, &gap, 8.0, p(2.0, 2.0), p(2.0, 10.0), &internal, &s));
        // Across the hole, into the top surface, to another island, to a wall or off the outer wall, it retracts.
        assert!(retracts(&sparse, &solid, 10.0, p(5.0, 10.0), p(15.0, 10.0), &internal, &s));
        assert!(retracts(&sparse, &top, 6.3, p(2.0, 10.0), p(4.0, 16.0), &internal, &s));
        assert!(retracts(&sparse, &elsewhere, 16.0, p(2.0, 2.0), p(18.0, 2.0), &internal, &s));
        assert!(retracts(&sparse, &inner, 16.0, p(2.0, 2.0), p(18.0, 2.0), &internal, &s));
        assert!(retracts(&outer, &sparse, 16.0, p(2.0, 2.0), p(18.0, 2.0), &internal, &s));
        // Shorter than the minimum travel, never.
        assert!(!retracts(&outer, &inner, 0.5, p(2.0, 2.0), p(2.0, 2.5), &internal, &s));
        // Off a wall that ends over an overhang, as off an outer wall.
        let mut hanging = path(Role::InnerWall, 0);
        hanging.points = vec![p(2.0, 2.0), p(3.0, 2.0), p(4.0, 2.0)];
        hanging.parts = vec![Part { overhang: false, speed: 100.0 }, Part { overhang: true, speed: 50.0 }];
        assert!(retracts(&hanging, &sparse, 16.0, p(2.0, 2.0), p(18.0, 2.0), &internal, &s));
    }

    #[test]
    fn a_wall_over_an_overhang_prints_stretch_by_stretch_as_orca_writes_it() {
        let s = Settings::default();
        let overhang = (0.4, 0.07, 50.0, 2500.0);
        let mut b = Builder {
            s: &s,
            moves: Vec::new(),
            notes: Vec::new(),
            x: 0.0,
            y: 0.0,
            z: 0.2,
            layer_z: 0.2,
            retracted: false,
            lifted: false,
            accel: f64::NAN,
            first_layer: false,
            layer_height: 0.2,
            wipe: None,
            speed: 0.0,
            retracted_mm: 0.0,
            prior: 0.0,
            overhang,
        };
        let p = |x: f64| geom::pt(geom::sc(x), 0);
        let speeds = [200.0, 120.0, 120.5, 199.5, 199.6, 50.0, 50.0];
        let wall = Path {
            role: Role::OuterWall,
            points: (0..=7).map(|k| p(k as f64)).collect(),
            closed: false,
            width: 0.42,
            height: 0.2,
            mm3_per_mm: 0.08,
            speed: 200.0,
            accel: 5000.0,
            island: 0,
            object: 0,
            parts: speeds.iter().enumerate().map(|(k, &speed)| Part { overhang: k >= 5, speed }).collect(),
        };
        b.extrude(&wall);
        let f: Vec<f64> = b.moves.iter().map(|m| m.f).collect();
        // A new speed where it changes by more than 1 mm/s, else the one before, or the wall's own within 1 mm/s of
        // it; the overhang wall at its own.
        assert_eq!(f, vec![200.0, 120.0, 120.0, 199.5, 200.0, 50.0, 50.0]);
        let kinds: Vec<Kind> = b.moves.iter().map(|m| m.kind).collect();
        assert_eq!(kinds[4], Kind::Extrude(Role::OuterWall));
        assert_eq!(kinds[5], Kind::Extrude(Role::OverhangWall));
        assert_eq!((b.moves[5].width, b.moves[5].accel), (0.4f32, 2500.0));
        assert!((b.moves[5].e - 0.07 * s.e_per_mm3()).abs() < 1e-12);
        // The wipe goes at the speed the wall ended at.
        assert_eq!(b.wipe.map(|(_, speed)| speed), Some(50.0));
    }

    #[test]
    fn durations_are_written_like_orca() {
        assert_eq!(duration(1956.806), "32m 36s");
        assert_eq!(duration(3723.4), "1h 2m 3s");
        assert_eq!(duration(5.9), "5s");
        assert_eq!(duration(0.5), "0.500000s");
        assert_eq!(duration(90061.0), "1d 1h 1m 1s");
    }

    /// A circle of radius `r` mm in `n` chords, printed at 200 mm/s and 5,000 mm/s², timed by the planner.
    fn circle_time(r: f64, n: usize) -> f64 {
        let s = Settings::default();
        let moves: Vec<Move> = (1..=n)
            .map(|k| {
                let a = 2.0 * PI * k as f64 / n as f64;
                Move {
                    x: r * a.cos(),
                    y: r * a.sin(),
                    z: 0.2,
                    e: 0.01,
                    f: 200.0,
                    accel: 5000.0,
                    kind: Kind::Extrude(Role::OuterWall),
                    width: 0.42,
                    height: 0.2,
                }
            })
            .collect();
        timing(&moves, [r, 0.0, 0.2], &s).iter().sum()
    }

    #[test]
    fn curves_slow_down_as_bambus_estimator_has_them() {
        // A tight curve: chords 5° apart round a 2 mm circle go no faster than √(5,000 · 2) = 100 mm/s (starting and
        // stopping take a little more).
        let (r, n) = (2.0, 72);
        let length = n as f64 * 2.0 * r * (PI / n as f64).sin();
        let t = circle_time(r, n);
        assert!(t > length / 100.0 && t < length / 100.0 * 1.2, "{t} for {length} mm");
        // A gentle one (√(5,000 · 20) is over 200 mm/s) at the speed asked for.
        let (r, n) = (20.0, 360);
        let length = n as f64 * 2.0 * r * (PI / n as f64).sin();
        let t = circle_time(r, n);
        assert!(t > length / 200.0 && t < length / 200.0 * 1.1, "{t} for {length} mm");
    }

    /// Times a G-code file (Orca's, say) with this planner, layer by layer and feature by feature, to hold it to
    /// Orca's own estimate: `SPAGHETTI_TIME_GCODE=plate_1.gcode cargo test --release time_a_gcode_file -- --ignored
    /// --nocapture`. Arcs are split as Orca's estimator splits them.
    #[test]
    #[ignore]
    fn time_a_gcode_file() {
        let path = std::env::var("SPAGHETTI_TIME_GCODE").expect("SPAGHETTI_TIME_GCODE: the G-code to time");
        let text = std::fs::read_to_string(path).unwrap();
        let s = Settings::default();
        let mut role = Role::OuterWall;
        let (mut x, mut y, mut z, mut f, mut accel) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, f64::NAN);
        let mut moves: Vec<Move> = Vec::new();
        let mut start = [0.0; 3];
        let mut totals: std::collections::BTreeMap<&str, f64> = Default::default();
        let mut started = false;
        let flush = |moves: &mut Vec<Move>, start: [f64; 3], totals: &mut std::collections::BTreeMap<&str, f64>| {
            for (m, t) in moves.iter().zip(timing(moves, start, &s)) {
                let key = if let Kind::Extrude(r) = m.kind { r.feature() } else { "Travel, retractions and lifts" };
                *totals.entry(key).or_default() += t;
            }
            moves.clear();
        };
        for line in text.lines() {
            if line.starts_with("; CHANGE_LAYER") {
                if started {
                    flush(&mut moves, start, &mut totals);
                }
                (started, start) = (true, [x, y, z]);
                continue;
            }
            if let Some(name) = line.strip_prefix("; FEATURE: ") {
                role = Role::ALL.into_iter().find(|r| r.feature() == name.trim()).unwrap_or(Role::SparseInfill);
                continue;
            }
            let code = line.split(';').next().unwrap_or("").trim();
            if let Some(v) = code.strip_prefix("M204 S") {
                accel = v.trim().parse().unwrap_or(accel);
                continue;
            }
            let mut words = code.split_whitespace();
            let Some(g @ ("G0" | "G1" | "G2" | "G3")) = words.next() else { continue };
            let (mut nx, mut ny, mut nz, mut e, mut i, mut j) = (x, y, z, 0.0, 0.0, 0.0);
            for w in words {
                let v: f64 = w[1..].parse().unwrap_or(0.0);
                match &w[..1] {
                    "X" => nx = v,
                    "Y" => ny = v,
                    "Z" => nz = v,
                    "E" => e = v,
                    "I" => i = v,
                    "J" => j = v,
                    "F" => f = v / 60.0,
                    _ => {}
                }
            }
            if !started {
                (x, y, z) = (nx, ny, nz);
                continue;
            }
            let mv = |x: f64, y: f64, z: f64, e: f64, kind: Kind| Move {
                x,
                y,
                z,
                e,
                f,
                accel,
                kind,
                width: 0.4,
                height: 0.2,
            };
            let moved = (nx - x).abs() > 1e-9 || (ny - y).abs() > 1e-9;
            if g == "G0" || g == "G1" {
                let kind = match (moved, e > 0.0) {
                    (true, true) => Kind::Extrude(role),
                    (true, false) => Kind::Travel,
                    _ if (nz - z).abs() > 1e-9 => Kind::Lift,
                    _ if e != 0.0 => Kind::Retract,
                    _ => continue,
                };
                moves.push(mv(nx, ny, nz, e, kind));
            } else if !moved {
                moves.push(mv(nx, ny, nz, 0.0, Kind::Spiral { i, j }));
            } else {
                let (cx, cy, r) = (x + i, y + j, i.hypot(j));
                let a0 = (y - cy).atan2(x - cx);
                let mut d = (ny - cy).atan2(nx - cx) - a0;
                if g == "G3" && d <= 0.0 {
                    d += 2.0 * PI;
                }
                if g == "G2" && d >= 0.0 {
                    d -= 2.0 * PI;
                }
                let n = arc_steps(r, d.abs());
                let kind = if e > 0.0 { Kind::Extrude(role) } else { Kind::Travel };
                for k in 1..=n {
                    let a = a0 + d * k as f64 / n as f64;
                    let (px, py) = if k == n { (nx, ny) } else { (cx + r * a.cos(), cy + r * a.sin()) };
                    moves.push(mv(px, py, nz, e / n as f64, kind));
                }
            }
            (x, y, z) = (nx, ny, nz);
        }
        flush(&mut moves, start, &mut totals);
        for (feature, t) in &totals {
            println!("{feature}: {t:.1} s");
        }
    }

    #[test]
    fn a_long_move_cruises_and_a_short_one_does_not() {
        let b = Block {
            dist: 100.0,
            cruise: 100.0,
            accel: 1000.0,
            safe: 10.0,
            max_entry: 10.0,
            entry: 10.0,
            nominal_length: true,
        };
        // 10 → 100 mm/s at 1000 mm/s² takes 0.09 s over 4.95 mm, twice; 90.1 mm at 100 mm/s.
        let t = trapezoid(&b, 10.0);
        assert!((t - (0.09 + 0.09 + 0.901)).abs() < 1e-9, "{t}");
        let short = Block { dist: 1.0, ..b };
        let t = trapezoid(&short, 10.0);
        // Peak: v² = 10² + 2·1000·0.5 → 33.17 mm/s.
        let peak = (100.0f64 + 1000.0).sqrt();
        assert!((t - 2.0 * (peak - 10.0) / 1000.0).abs() < 1e-9, "{t}");
    }
}
