//! G-code: every layer's paths as printer moves, Bambu flavoured (absolute XYZ, relative E, and the
//! `; CHANGE_LAYER`, `; Z_HEIGHT:`, `; LAYER_HEIGHT:` and `; FEATURE:` markers Orca writes, which the app's 3D view
//! reads), timed the way Orca's estimator times them (trapezoids, per-axis jerk at junctions, the machine's limits),
//! with the statistics Orca reports. Layers are built and timed in parallel; each starts and ends at a safe speed,
//! so their times add up.

use crate::config::{Settings, trim};
use crate::geom::{self, Pt};
use crate::plan::{LayerPlan, Path};
use crate::region::{LayerRegions, Role};

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
}

pub struct Gcode {
    pub text: Vec<u8>,
    pub stats: Stats,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Extrude(Role),
    Travel,
    /// Moving back over what was just printed while retracting.
    Wipe,
    /// The filament only.
    Retract,
    /// Up or down only.
    Lift,
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
    accel: f64,
    kind: Kind,
    width: f64,
}

/// Where the start G-code leaves the nozzle.
const START_XY: (f64, f64) = (0.0, 0.0);

/// One layer's G-code and what it costs. The travel onto the layer (from wherever the last one ended) is in the
/// text but not yet in the time: `assemble` adds it, once it knows where the layer before ended.
pub struct LayerGcode {
    text: Vec<u8>,
    z: f64,
    height: f64,
    /// Where the layer's first travel goes, and where the layer ends.
    first: Option<[f64; 2]>,
    end: Option<[f64; 3]>,
    time: f64,
    travel_time: f64,
    travel_distance: f64,
    retractions: usize,
    filament_mm: f64,
    features: [Feature; Role::ALL.len()],
}

/// The height the nozzle travels at onto layer `i` (the layer before's top, lifted).
pub fn travel_z(layers: &crate::section::Layers, i: usize, s: &Settings) -> f64 {
    if i == 0 { layers.top[0] + s.z_hop } else { layers.top[i - 1] + s.z_hop }
}

/// One layer, from its plan to its G-code: moves, slowing down if it is too quick, timing and text.
pub fn layer(plan: &LayerPlan, regions: &LayerRegions, s: &Settings, from_z: f64) -> LayerGcode {
    let mut moves = build_layer(plan, regions, s, from_z);
    let first = moves.first().map(|m| [m.x, m.y]);
    let start = first.map(|[x, y]| [x, y, from_z]).unwrap_or([0.0, 0.0, from_z]);
    if let Some(k) = slowdown_factor(&moves, start, s) {
        slow_down(&mut moves, k, s);
    }
    let out = finish_layer(&moves, start, s);
    LayerGcode {
        text: out.text,
        z: plan.z,
        height: plan.height,
        first,
        end: moves.last().map(|m| [m.x, m.y, m.z]),
        time: out.time,
        travel_time: out.travel_time,
        travel_distance: out.travel_distance,
        retractions: out.retractions,
        filament_mm: out.filament_mm,
        features: out.features,
    }
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

/// The whole file from its layers: header, start, the layers with the printer's progress, end and the totals.
pub fn assemble(layers: Vec<LayerGcode>, s: &Settings) -> Gcode {
    let n = layers.len();
    let start_z = layers.first().map(|l| l.z).unwrap_or(0.0) + s.z_hop;
    let mut stats = Stats { layers: n, max_z: layers.last().map(|l| l.z).unwrap_or(0.0), ..Default::default() };
    let mut at = [START_XY.0, START_XY.1];
    let mut times = Vec::with_capacity(n);
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
        for (total, f) in stats.features.iter_mut().zip(&l.features) {
            total.time += f.time;
            total.volume += f.volume;
        }
    }
    stats.layer_times = times;
    stats.volume = stats.filament_mm * s.filament_area();
    stats.weight = stats.volume * s.filament_density / 1000.0;
    stats.cost = stats.weight / 1000.0 * s.filament_cost;
    stats.prepare_time = s.prepare_time;
    stats.total_time = stats.prepare_time + stats.model_time;

    let body: usize = layers.iter().map(|l| l.text.len()).sum();
    let mut text = Vec::with_capacity(body + 16 * 1024 + n * 160);
    header(&mut text, &stats, s);
    start_gcode(&mut text, &stats, s, start_z);
    let mut elapsed = stats.prepare_time;
    for (i, l) in layers.into_iter().enumerate() {
        text.extend_from_slice(
            format!("; CHANGE_LAYER\n; Z_HEIGHT: {}\n; LAYER_HEIGHT: {}\n", trim(l.z), trim(l.height)).as_bytes(),
        );
        m73(&mut text, elapsed, stats.total_time);
        text.extend_from_slice(b"M73 L");
        int(&mut text, i as u64 + 1);
        text.extend_from_slice(b"\nM991 S0 P");
        int(&mut text, i as u64);
        text.extend_from_slice(b" ;notify layer change\n");
        if i == 0 {
            text.extend_from_slice(b"M106 S0\nM106 P2 S0\n");
        }
        if i == s.fan_off_layers {
            text.extend_from_slice(b"M106 S");
            int(&mut text, (s.fan_speed * 255.0).round() as u64);
            text.push(b'\n');
        }
        if i == s.aux_fan_off_layers {
            text.extend_from_slice(b"M106 P2 S");
            int(&mut text, (s.aux_fan_speed * 255.0).round() as u64);
            text.push(b'\n');
        }
        text.extend_from_slice(&l.text);
        elapsed += stats.layer_times[i];
    }
    end_gcode(&mut text, &stats, s);
    Gcode { text, stats }
}

// ---- One layer's moves.

struct Builder<'a> {
    s: &'a Settings,
    moves: Vec<Move>,
    x: f64,
    y: f64,
    z: f64,
    layer_z: f64,
    retracted: bool,
    lifted: bool,
    travel_accel: f64,
}

impl Builder<'_> {
    fn push(&mut self, m: Move) {
        self.x = m.x;
        self.y = m.y;
        self.z = m.z;
        self.moves.push(m);
    }

    fn travel(&mut self, x: f64, y: f64) {
        let m = Move {
            x,
            y,
            z: self.z,
            e: 0.0,
            f: self.s.travel_speed,
            accel: self.travel_accel,
            kind: Kind::Travel,
            width: 0.0,
        };
        self.push(m);
    }

    fn lift_to(&mut self, z: f64) {
        if (z - self.z).abs() < 1e-9 {
            return;
        }
        let m = Move {
            x: self.x,
            y: self.y,
            z,
            e: 0.0,
            f: self.s.travel_speed,
            accel: self.travel_accel,
            kind: Kind::Lift,
            width: 0.0,
        };
        self.push(m);
    }

    /// Pulls the filament back, wiping over the path just printed while doing so (a loop wipes on along its
    /// start, an open line goes back the way it came), then lifts the nozzle.
    fn retract(&mut self, last: Option<&Path>) {
        if !self.retracted {
            let s = self.s;
            let mut left = s.retract_length;
            if let Some(path) = last
                && s.wipe_distance > 0.0
                && path.points.len() >= 2
            {
                left -= if path.closed {
                    self.wipe(path.points.iter().skip(1).copied(), path.speed)
                } else {
                    self.wipe(path.points.iter().rev().skip(1).copied(), path.speed)
                };
            }
            if left > 1e-9 {
                let m = Move {
                    x: self.x,
                    y: self.y,
                    z: self.z,
                    e: -left,
                    f: s.retract_speed,
                    accel: self.travel_accel,
                    kind: Kind::Retract,
                    width: 0.0,
                };
                self.push(m);
            }
            self.retracted = true;
        }
        if !self.lifted {
            self.lift_to(self.layer_z + self.s.z_hop);
            self.lifted = true;
        }
    }

    /// Wipes along `route` for the wipe distance, retracting as it goes; returns how much it retracted.
    fn wipe(&mut self, route: impl Iterator<Item = Pt>, speed: f64) -> f64 {
        let s = self.s;
        let mut budget = s.wipe_distance;
        let mut retracted = 0.0;
        for q in route {
            let (qx, qy) = (geom::unsc(q.x), geom::unsc(q.y));
            let seg = (qx - self.x).hypot(qy - self.y);
            if seg < 1e-9 {
                continue;
            }
            let take = seg.min(budget);
            let t = take / seg;
            let e = s.retract_length * take / s.wipe_distance;
            let m = Move {
                x: self.x + (qx - self.x) * t,
                y: self.y + (qy - self.y) * t,
                z: self.z,
                e: -e,
                f: speed,
                accel: self.travel_accel,
                kind: Kind::Wipe,
                width: 0.0,
            };
            self.push(m);
            retracted += e;
            budget -= take;
            if budget <= 1e-9 {
                break;
            }
        }
        retracted
    }

    /// Lowers the nozzle and pushes the filament back, ready to print.
    fn ready(&mut self) {
        if self.lifted {
            self.lift_to(self.layer_z);
            self.lifted = false;
        }
        if self.retracted {
            let m = Move {
                x: self.x,
                y: self.y,
                z: self.z,
                e: self.s.retract_length,
                f: self.s.deretract_speed,
                accel: self.travel_accel,
                kind: Kind::Retract,
                width: 0.0,
            };
            self.push(m);
            self.retracted = false;
        }
    }

    fn extrude(&mut self, path: &Path) {
        self.ready();
        let e_per_mm = path.mm3_per_mm * self.s.e_per_mm3();
        for q in &path.points[1..] {
            let (x, y) = (geom::unsc(q.x), geom::unsc(q.y));
            let length = (x - self.x).hypot(y - self.y);
            if length < 1e-9 {
                continue;
            }
            let m = Move {
                x,
                y,
                z: self.z,
                e: length * e_per_mm,
                f: path.speed,
                accel: path.accel,
                kind: Kind::Extrude(path.role),
                width: path.width,
            };
            self.push(m);
        }
    }
}

/// Infill inside the walls: travelling between these, within the area inside the walls, needs no retraction
/// (Orca's "reduce infill retraction").
fn internal(role: Role) -> bool {
    matches!(role, Role::SparseInfill | Role::SolidInfill | Role::InternalBridge)
}

fn build_layer(plan: &LayerPlan, regions: &LayerRegions, s: &Settings, from_z: f64) -> Vec<Move> {
    let first = plan.index == 0;
    let points: usize = plan.paths.iter().map(|p| p.points.len()).sum();
    let (x0, y0) =
        plan.paths.first().map(|p| (geom::unsc(p.points[0].x), geom::unsc(p.points[0].y))).unwrap_or((0.0, 0.0));
    let mut b = Builder {
        s,
        moves: Vec::with_capacity(points + plan.paths.len() * 4 + 8),
        x: x0,
        y: y0,
        z: from_z,
        layer_z: plan.z,
        retracted: true,
        lifted: true,
        travel_accel: if first { s.first_layer_travel_accel } else { s.travel_accel },
    };
    let mut last: Option<&Path> = None;
    for path in &plan.paths {
        let to = path.points[0];
        let (x, y) = (geom::unsc(to.x), geom::unsc(to.y));
        match last {
            None => b.travel(x, y),
            Some(prev) => {
                let d = (x - b.x).hypot(y - b.y);
                if d > 1e-6 {
                    let here = geom::pt(geom::sc(b.x), geom::sc(b.y));
                    let stay = d < s.retract_min_travel
                        || (prev.island == path.island
                            && internal(prev.role)
                            && internal(path.role)
                            && regions
                                .islands
                                .get(path.island as usize)
                                .is_some_and(|island| geom::segment_inside(&island.inner, here, to)));
                    if !stay {
                        b.retract(Some(prev));
                    }
                    b.travel(x, y);
                }
            }
        }
        b.extrude(path);
        last = Some(path);
    }
    if last.is_some() {
        b.retract(last);
    }
    b.moves
}

// ---- Slowing down short layers, as Orca's cooling does: the extrusions slow so the layer takes at least
// `slow_down_layer_time`, none below `slow_down_min_speed`. Like Orca, this works on plain length / speed times.

fn simple_time(m: &Move, from: [f64; 3]) -> f64 {
    let d = ((m.x - from[0]).powi(2) + (m.y - from[1]).powi(2) + (m.z - from[2]).powi(2)).sqrt();
    let d = if d > 1e-9 { d } else { m.e.abs() };
    if m.f > 0.0 { d / m.f } else { 0.0 }
}

/// How many times longer the layer's extrusions must take, if the layer is too quick.
fn slowdown_factor(moves: &[Move], start: [f64; 3], s: &Settings) -> Option<f64> {
    if moves.is_empty() || s.slow_down_layer_time <= 0.0 {
        return None;
    }
    let mut at = start;
    let mut fixed = 0.0;
    let mut adjustable: Vec<(f64, f64)> = Vec::new(); // (time, speed)
    for m in moves {
        let t = simple_time(m, at);
        at = [m.x, m.y, m.z];
        match m.kind {
            Kind::Extrude(_) if m.f > s.slow_down_min_speed => adjustable.push((t, m.f)),
            _ => fixed += t,
        }
    }
    let flexible: f64 = adjustable.iter().map(|a| a.0).sum();
    let need = s.slow_down_layer_time - fixed;
    if flexible <= 0.0 || need <= flexible {
        return None;
    }
    // Each extrusion's time grows by k, but no more than its speed allows (down to the minimum speed).
    let stretched = |k: f64| -> f64 { adjustable.iter().map(|&(t, v)| t * k.min(v / s.slow_down_min_speed)).sum() };
    let most = adjustable.iter().map(|&(_, v)| v / s.slow_down_min_speed).fold(1.0, f64::max);
    if stretched(most) <= need {
        return Some(most);
    }
    let (mut lo, mut hi) = (1.0, most);
    for _ in 0..50 {
        let mid = (lo + hi) / 2.0;
        if stretched(mid) < need { lo = mid } else { hi = mid }
    }
    Some(hi)
}

fn slow_down(moves: &mut [Move], k: f64, s: &Settings) {
    for m in moves {
        if matches!(m.kind, Kind::Extrude(_)) && m.f > s.slow_down_min_speed {
            m.f = (m.f / k).max(s.slow_down_min_speed);
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

/// Each move's seconds: the printer's planner, as Orca's G-code processor models it (Marlin's classic jerk).
fn timing(moves: &[Move], start: [f64; 3], s: &Settings) -> Vec<f64> {
    let max_speed = [s.max_speed_xy, s.max_speed_xy, s.max_speed_z, s.max_speed_e];
    let max_accel = [s.max_accel_xy, s.max_accel_xy, s.max_accel_z, s.max_accel_e];
    let jerk = [s.max_jerk_xy, s.max_jerk_xy, s.max_jerk_z, s.max_jerk_e];
    let mut blocks: Vec<Block> = Vec::with_capacity(moves.len());
    let mut index: Vec<usize> = Vec::with_capacity(moves.len());
    let mut at = start;
    let mut prev_cruise = 0.0;
    let mut prev_axis = [0.0f64; 4];
    let mut prev_safe = 0.0;
    for (i, m) in moves.iter().enumerate() {
        let delta = [m.x - at[0], m.y - at[1], m.z - at[2], m.e];
        at = [m.x, m.y, m.z];
        let xyz = (delta[0] * delta[0] + delta[1] * delta[1] + delta[2] * delta[2]).sqrt();
        let dist = if xyz > 1e-9 { xyz } else { delta[3].abs() };
        if dist < 1e-9 || m.f <= 0.0 {
            continue;
        }
        let inv = 1.0 / dist;
        let mut cruise = m.f;
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
            Kind::Travel | Kind::Lift => m.accel.min(s.max_accel_travel),
            Kind::Retract => s.max_accel_retract,
            _ => m.accel.min(s.max_accel_xy),
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
        if prev_cruise > 0.0001 {
            let prev_larger = prev_cruise > cruise;
            let smaller = if prev_larger { cruise / prev_cruise } else { prev_cruise / cruise };
            junction = if prev_larger { cruise } else { prev_cruise };
            let mut v_factor = 1.0;
            let mut limited = false;
            for a in 0..4 {
                let mut v_exit = prev_axis[a];
                let mut v_entry = axis[a];
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
                if j > jerk[a] {
                    v_factor *= jerk[a] / j;
                    limited = true;
                }
            }
            if limited {
                junction *= v_factor;
            }
            let threshold = junction * 0.99;
            if prev_safe > threshold && safe > threshold {
                junction = safe;
            }
        }
        let allowable = (safe * safe + 2.0 * accel * dist).sqrt();
        blocks.push(Block {
            dist,
            cruise,
            accel,
            safe,
            max_entry: junction,
            entry: junction.min(allowable),
            nominal_length: cruise <= allowable,
        });
        index.push(i);
        prev_cruise = cruise;
        prev_axis = axis;
        prev_safe = safe;
    }

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
        times[index[k]] = trapezoid(&blocks[k], exit);
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
    time: f64,
    travel_time: f64,
    travel_distance: f64,
    retractions: usize,
    filament_mm: f64,
    features: [Feature; Role::ALL.len()],
}

fn role_index(role: Role) -> usize {
    Role::ALL.iter().position(|&r| r == role).unwrap_or(0)
}

fn finish_layer(moves: &[Move], start: [f64; 3], s: &Settings) -> LayerOut {
    let times = timing(moves, start, s);
    let mut out = LayerOut {
        text: Vec::with_capacity(moves.len() * 28 + 64),
        time: 0.0,
        travel_time: 0.0,
        travel_distance: 0.0,
        retractions: 0,
        filament_mm: 0.0,
        features: Default::default(),
    };
    let area = s.filament_area();
    let mut feature: Option<Role> = None;
    let mut width = f64::NAN;
    let mut accel = f64::NAN;
    let mut feed = f64::NAN;
    let mut wiping = false;
    let mut at = start;
    let mut prev_kind = Kind::Travel;
    let t = &mut out.text;
    for (m, &secs) in moves.iter().zip(&times) {
        // A retraction starts with a wipe, or with pulling back right away.
        if (m.kind == Kind::Wipe || (m.kind == Kind::Retract && m.e < 0.0)) && prev_kind != Kind::Wipe {
            out.retractions += 1;
        }
        prev_kind = m.kind;
        out.time += secs;
        match m.kind {
            Kind::Extrude(role) => {
                let f = &mut out.features[role_index(role)];
                f.time += secs;
                f.volume += m.e * area;
                out.filament_mm += m.e;
            }
            Kind::Travel => {
                out.travel_time += secs;
                out.travel_distance += (m.x - at[0]).hypot(m.y - at[1]);
            }
            Kind::Retract | Kind::Wipe | Kind::Lift => out.travel_time += secs,
        }
        if wiping && m.kind != Kind::Wipe {
            t.extend_from_slice(b"; WIPE_END\n");
            wiping = false;
        }
        match m.kind {
            Kind::Extrude(role) => {
                if feature != Some(role) {
                    t.extend_from_slice(b"; FEATURE: ");
                    t.extend_from_slice(role.feature().as_bytes());
                    t.push(b'\n');
                    feature = Some(role);
                }
                if m.width != width {
                    t.extend_from_slice(b"; LINE_WIDTH: ");
                    num(t, m.width, 4);
                    t.push(b'\n');
                    width = m.width;
                }
                if m.accel != accel {
                    t.extend_from_slice(b"M204 S");
                    num(t, m.accel, 0);
                    t.push(b'\n');
                    accel = m.accel;
                }
                t.extend_from_slice(b"G1 X");
                num(t, m.x, 3);
                t.extend_from_slice(b" Y");
                num(t, m.y, 3);
                t.extend_from_slice(b" E");
                num(t, m.e, 5);
            }
            Kind::Travel | Kind::Wipe => {
                if m.kind == Kind::Wipe && !wiping {
                    t.extend_from_slice(b"; WIPE_START\n");
                    wiping = true;
                }
                if m.accel != accel {
                    t.extend_from_slice(b"M204 S");
                    num(t, m.accel, 0);
                    t.push(b'\n');
                    accel = m.accel;
                }
                t.extend_from_slice(b"G1 X");
                num(t, m.x, 3);
                t.extend_from_slice(b" Y");
                num(t, m.y, 3);
                if m.kind == Kind::Wipe {
                    t.extend_from_slice(b" E");
                    num(t, m.e, 5);
                }
            }
            Kind::Lift => {
                t.extend_from_slice(b"G1 Z");
                num(t, m.z, 3);
            }
            Kind::Retract => {
                t.extend_from_slice(b"G1 E");
                num(t, m.e, 5);
            }
        }
        if m.f != feed {
            t.extend_from_slice(b" F");
            num(t, m.f * 60.0, 0);
            feed = m.f;
        }
        t.push(b'\n');
        at = [m.x, m.y, m.z];
    }
    if wiping {
        t.extend_from_slice(b"; WIPE_END\n");
    }
    out
}

fn header(t: &mut Vec<u8>, stats: &Stats, s: &Settings) {
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
    let first = stats.layer_times.first().copied().unwrap_or(0.0);
    line(t, &format!("; estimated first layer printing time (normal mode) = {}", duration(first)));
    line(t, &format!("; total layer number: {}", stats.layers));
    line(t, &format!("; filament_density: {}", trim(s.filament_density)));
    line(t, &format!("; filament_diameter: {}", trim(s.filament_diameter)));
    line(t, &format!("; max_z_height: {:.2}", stats.max_z));
    line(t, "; filament: 1");
    line(t, "; HEADER_BLOCK_END");
    line(t, "");
    line(t, "; CONFIG_BLOCK_START");
    for (key, value) in s.project_settings() {
        let text = match value {
            crate::config::Value::One(v) => v,
            crate::config::Value::List(v) => v.join(","),
        };
        line(t, &format!("; {key} = {text}"));
    }
    line(t, "; CONFIG_BLOCK_END");
    line(t, "");
}

fn start_gcode(t: &mut Vec<u8>, stats: &Stats, s: &Settings, start_z: f64) {
    let bed = trim(s.bed_temperature);
    let nozzle = trim(s.nozzle_temperature);
    t.extend_from_slice(b"; EXECUTABLE_BLOCK_START\n");
    m73(t, 0.0, stats.total_time);
    t.extend_from_slice(
        format!(
            "M201 X{a} Y{a} Z{az} E{ae}\nM203 X{v} Y{v} Z{vz} E{ve}\nM204 P{a} R{ar} T{a}\nM205 X{j:.2} Y{j:.2} Z{jz:.2} E{je:.2} ; sets the jerk limits, mm/sec\n",
            a = trim(s.max_accel_xy),
            az = trim(s.max_accel_z),
            ae = trim(s.max_accel_e),
            ar = trim(s.max_accel_retract),
            v = trim(s.max_speed_xy),
            vz = trim(s.max_speed_z),
            ve = trim(s.max_speed_e),
            j = s.max_jerk_xy,
            jz = s.max_jerk_z,
            je = s.max_jerk_e,
        )
        .as_bytes(),
    );
    t.extend_from_slice(
        format!(
            "; FEATURE: Custom\n\
             ; {NAME}'s own start: heat, home and wait. It is not the X2D's start sequence (no calibration, no\n\
             ; filament loading, no purge): this file is for looking at, not for printing yet.\n\
             M140 S{bed}\n\
             M104 S{nozzle}\n\
             G28\n\
             M190 S{bed}\n\
             M109 S{nozzle}\n\
             G90\n\
             G21\n\
             M83 ; use relative distances for extrusion\n\
             G1 Z{z} F600\n\
             G1 X{x} Y{y} F30000\n\
             ; MACHINE_START_GCODE_END\n",
            z = trim(start_z),
            x = trim(START_XY.0),
            y = trim(START_XY.1),
        )
        .as_bytes(),
    );
}

fn end_gcode(t: &mut Vec<u8>, stats: &Stats, s: &Settings) {
    let park = (stats.max_z + 2.0).min(s.max_height);
    t.extend_from_slice(
        format!(
            "; FEATURE: Custom\n\
             ; {NAME}'s own end: lift, heaters and fans off.\n\
             G1 Z{park} F600\n\
             M104 S0\n\
             M140 S0\n\
             M106 S0\n\
             M106 P2 S0\n\
             M400\n\
             M18\n\
             M73 P100 R0\n\
             ; EXECUTABLE_BLOCK_END\n\
             \n\
             ; filament used [mm] = {mm:.2}\n\
             ; filament used [cm3] = {cm3:.2}\n\
             ; filament used [g] = {g:.2}\n\
             ; filament cost = {cost:.2}\n",
            park = trim(park),
            mm = stats.filament_mm,
            cm3 = stats.volume / 1000.0,
            g = stats.weight,
            cost = stats.cost,
        )
        .as_bytes(),
    );
}

/// `M73 P<percent> R<minutes left>`: the printer's progress, and the app's per-layer times.
fn m73(t: &mut Vec<u8>, elapsed: f64, total: f64) {
    let percent = if total > 0.0 { (100.0 * elapsed / total).floor().clamp(0.0, 100.0) } else { 0.0 };
    let left = ((total - elapsed).max(0.0) / 60.0).floor();
    t.extend_from_slice(b"M73 P");
    int(t, percent as u64);
    t.extend_from_slice(b" R");
    int(t, left as u64);
    t.push(b'\n');
}

/// "1h 2m 3s", "32m 36s", "5s": durations as Orca writes them.
pub fn duration(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    let (d, h, m, s) = (total / 86400, total / 3600 % 24, total / 60 % 60, total % 60);
    if d > 0 {
        format!("{d}d {h}h {m}m {s}s")
    } else if h > 0 {
        format!("{h}h {m}m {s}s")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
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
        format!(
            "{{\n \"generator\": \"{NAME} {VERSION}\",\n \"summary\": {{\n  \"time\": {:.3},\n  \"prepare_time\": {:.3},\n  \"model_time\": {:.3},\n  \"travel_time\": {:.3},\n  \"travel_distance\": {:.2},\n  \"retractions\": {},\n  \"layer_count\": {},\n  \"length\": {:.2},\n  \"volume\": {:.3},\n  \"weight\": {:.4},\n  \"filament_cost\": {:.2},\n  \"features\": {{{}\n  }}\n }},\n \"layer_times\": [{}]\n}}\n",
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
            features,
            layers.join(", ")
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn durations_are_written_like_orca() {
        assert_eq!(duration(1956.0), "32m 36s");
        assert_eq!(duration(3723.4), "1h 2m 3s");
        assert_eq!(duration(5.0), "5s");
        assert_eq!(duration(90061.0), "1d 1h 1m 1s");
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
