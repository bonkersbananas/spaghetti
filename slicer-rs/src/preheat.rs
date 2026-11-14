//! Orca 2.5's pre-cooling and pre-heating of a waiting nozzle, on a printer with several extruders that asks for it
//! (`enable_pre_heating`: the X2D). Orca adds these lines once the G-code is written, in a second pass of its G-code
//! processor (`GCodeProcessor::PreCoolingInjector`), and so does this module, from the G-code alone:
//!
//! - **When each extruder waits.** An extruder is in use from the end of the tower's change to it
//!   (`; NOZZLE_CHANGE_END … NN<nozzle>`) to the end of the next change away from it. It waits between two uses,
//!   before its first (from `; MACHINE_START_GCODE_END`) and after its last (to `; MACHINE_END_GCODE_START`). On one
//!   extruder, where no change of nozzle is marked, it waits between one filament's use and the next's on it, which
//!   leaves no gap.
//! - **How long**, by Orca's estimator: each move's seconds as its processor hands them out, a pause's to the oldest
//!   move its planner still holds, a tool change's to its `T` line, and none to the printer's own moves (`;VG1`).
//!   Where a move speeds up or slows down along the way, the processor puts a point of no time before it with its
//!   line (for its preview), which is where Orca's lookup by time then lands: so does ours.
//! - **What it does then.** The nozzle cools at `hotend_cooling_rate` from where the wait begins
//!   (`M104 T<n> S<°C> N0 ;Multi extruder pre cooling`) and heats again at `hotend_heating_rate` from the move where
//!   that ends as the wait does (`;Multi extruder pre heating`, between the `M632` and `M633` that let the printer
//!   skip it). After its last use it cools to the room's 25 °C. A wait too short to cool and heat again adds nothing.
//!
//! The lines move nothing and come after the estimate, as Orca's do, so it stays as it was.

use crate::config::Settings;
use crate::gcode::{Kind, Move, arc_pieces, timing_and_turns};
use crate::region::Role;
use crate::toolchange::Colours;

/// A line no marker has named (Orca's `(unsigned int)-1`).
const UNSET: u32 = u32::MAX;
/// Where the wait after an extruder's last use ends, as Orca has it (`std::numeric_limits<int>::max()`).
const END: u32 = i32::MAX as u32;
/// Orca's planner times the blocks it holds once it holds more than `REFRESH`, keeping the last `QUEUE`.
const QUEUE: usize = 64;
const REFRESH: usize = 4 * QUEUE;
/// The coolest a nozzle gets, and what Orca takes a nozzle not used yet to be at.
const ROOM: f32 = 25.0;
const UNUSED: i32 = 140;

/// Lines to add, each after the line of the G-code it names, in the order they go there.
type Added = Vec<(u32, String)>;

/// `items` by extruder (-1, none, first), each in its order; extruders with none left out.
fn by_extruder<T: Copy>(items: impl Iterator<Item = (i32, T)>) -> Vec<(i32, Vec<T>)> {
    let mut per: Vec<Vec<T>> = Vec::new();
    for (e, item) in items {
        let k = (e + 1).max(0) as usize;
        if per.len() <= k {
            per.resize_with(k + 1, Vec::new);
        }
        per[k].push(item);
    }
    per.into_iter().enumerate().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (k as i32 - 1, v)).collect()
}

/// What pre-heating reads of the presets.
#[derive(Clone, Debug)]
pub struct Params {
    /// Each filament's printing temperature, the one it may cool to while its extruder's last moves before a change
    /// print (`filament_pre_cooling_temperature`, 0: none), and how far below printing temperature it heats again
    /// before a tower the model doesn't touch (`filament_preheat_temperature_delta`).
    pub temperature: Vec<i32>,
    pub pre_cooling: Vec<i32>,
    pub preheat_delta: Vec<f64>,
    /// Each filament's extruder (its nozzle: the X2D has one in each).
    pub extruder_of: Vec<usize>,
    /// Each extruder's heating and cooling (°C/s), its number for the printer (`physical_extruder_map`) and how many
    /// nozzles it holds (`extruder_max_nozzle_count`).
    pub heating: Vec<f32>,
    pub cooling: Vec<f32>,
    pub physical: Vec<i64>,
    pub nozzles: Vec<i64>,
    /// How far below printing temperature a nozzle heats to at most, where Orca works round an X2D with a filament
    /// switcher whose extruders differ (`has_filament_switcher`): 20 °C, 40 for nozzles of 0.6 mm or more.
    pub switcher_offset: Option<f32>,
    /// A tool change's seconds: changing extruder, loading a filament into a nozzle, unloading one.
    pub change_secs: f64,
    pub load_secs: f64,
    pub unload_secs: f64,
}

impl Params {
    /// The presets' values for the plate's filaments, or none where the printer doesn't pre-heat.
    pub fn of(c: &Colours) -> Option<Params> {
        let (base, k) = c.printer();
        if !base.bool("enable_pre_heating") {
            return None;
        }
        let per: Vec<_> = (0..k).map(|e| crate::filaments::for_extruder(base, e)).collect();
        let rate = |key: &str| per.iter().map(|p| p.float_at(key, 0) as f32).collect::<Vec<f32>>();
        let ints = |key: &str| base.list(key).iter().filter_map(|v| v.trim().parse::<i64>().ok()).collect::<Vec<i64>>();
        let types = base.list("extruder_type");
        let mixed = types.iter().any(|t| Some(t) != types.first());
        let switcher_offset = (base.bool("has_filament_switcher") && mixed)
            .then(|| if base.float_at("nozzle_diameter", 0) >= 0.6 - 1e-4 { 40.0 } else { 20.0 });
        Some(Params {
            temperature: c.settings.iter().map(|s| s.nozzle_temperature as i32).collect(),
            pre_cooling: c
                .settings
                .iter()
                .map(|s| s.profile.float_at("filament_pre_cooling_temperature", 0) as i32)
                .collect(),
            preheat_delta: c
                .settings
                .iter()
                .map(|s| s.profile.float_at("filament_preheat_temperature_delta", 0))
                .collect(),
            extruder_of: c.extruder_of.clone(),
            heating: rate("hotend_heating_rate"),
            cooling: rate("hotend_cooling_rate"),
            physical: ints("physical_extruder_map"),
            nozzles: ints("extruder_max_nozzle_count"),
            switcher_offset,
            change_secs: base.float("machine_tool_change_time"),
            load_secs: base.float("machine_load_filament_time"),
            unload_secs: base.float("machine_unload_filament_time"),
        })
    }

    /// A filament's temperature as the injector reads it: where a nozzle comes from (`from`) or goes to, less the
    /// pre-heating delta where it counts; a nozzle with no filament yet is at 140 °C, and goes to none.
    fn nozzle_temp(&self, filament: i32, from: bool, delta: bool) -> i32 {
        if filament < 0 {
            return if from { UNUSED } else { 0 };
        }
        let f = filament as usize;
        let t = self.temperature.get(f).copied().unwrap_or(0) as f64;
        if delta { (t - self.preheat_delta.get(f).copied().unwrap_or(0.0)) as i32 } else { t as i32 }
    }

    /// A nozzle's extruder (on the X2D the nozzles are numbered as their extruders), or none.
    fn extruder_of_nozzle(&self, nozzle: i32) -> Option<usize> {
        (nozzle >= 0 && (nozzle as usize) < self.heating.len().max(1)).then_some(nozzle as usize)
    }
}

/// `v[i]`, or the first of `v` where it has no `i`th (Orca's `get_at`), or `or` where it is empty.
fn at_or_front<T: Copy>(v: &[T], i: usize, or: T) -> T {
    v.get(i).or(v.first()).copied().unwrap_or(or)
}

/// `text` with the lines Orca's pre-heating adds, or none where it adds none.
pub fn add_lines(text: &[u8], p: &Params, s: &Settings) -> Option<Vec<u8>> {
    let text = std::str::from_utf8(text).ok()?;
    let mut usage = Usage::new();
    for (i, line) in text.split_inclusive('\n').enumerate() {
        usage.line(i as u32 + 1, line, p);
    }
    usage.finish(p);
    // Where no nozzle change is marked, one filament's use ends where the next's starts on the same extruder: only
    // moves before the first use could make a wait, and the X2D's G-code names the first filament (`;VT…`) first.
    let waits_hold_moves = usage.extruders.len() > 1 || usage.moved_before_first_use;
    if usage.start_end == UNSET || usage.end_start == UNSET || !waits_hold_moves {
        return None;
    }
    let mut clock = Clock::new(p, s, text.len() / 24);
    for (i, line) in text.split_inclusive('\n').enumerate() {
        clock.line(i as u32 + 1, line);
    }
    let moves = clock.finish();
    let mut added: Added = Vec::new();
    let injector = Injector { p, moves: &moves, skippable: &usage.skippable };
    for (_, waits) in by_extruder(usage.waits().into_iter().map(|w| (w.extruder, w))) {
        for (i, w) in waits.iter().enumerate() {
            let last = i + 1 == waits.len();
            let curr = p.nozzle_temp(w.last_filament, true, false) as f32;
            let mut target = p.nozzle_temp(w.next_filament, false, !w.ignore_cooling_before_tower) as f32;
            if let (Some(offset), false) = (p.switcher_offset, last) {
                target = target.min(p.nozzle_temp(w.next_filament, false, false) as f32 - offset);
            }
            injector.wait(&mut added, w, curr, target, true, !last);
        }
    }
    if added.is_empty() {
        return None;
    }
    // The G-code as it was, with the lines after the ones they follow (in the order they were added there).
    let mut order: Vec<([f64; 4], usize)> =
        added.iter().enumerate().map(|(i, a)| ([f64::from(a.0), 0.0, 0.0, 0.0], i)).collect();
    crate::fill::sort_keyed(&mut order);
    let extra: usize = added.iter().map(|a| a.1.len()).sum();
    let mut out = Vec::with_capacity(text.len() + extra);
    let (mut copied, mut end, mut next) = (0, 0, 0);
    for (i, line) in text.split_inclusive('\n').enumerate() {
        end += line.len();
        if next == order.len() {
            break;
        }
        if added[order[next].1].0 == i as u32 + 1 {
            out.extend_from_slice(&text.as_bytes()[copied..end]);
            copied = end;
            while next < order.len() && added[order[next].1].0 == i as u32 + 1 {
                out.extend_from_slice(added[order[next].1].1.as_bytes());
                next += 1;
            }
        }
    }
    out.extend_from_slice(&text.as_bytes()[copied..]);
    Some(out)
}

// ---- Where each extruder is in use (Orca's usage blocks, built from the G-code's markers).

/// The lines a filament prints from, `[lower, upper)`, on its extruder and nozzle (`FilamentUsageBlock`).
#[derive(Clone, Copy, Debug)]
struct FilamentUse {
    filament: i32,
    extruder: i32,
    nozzle: i32,
    lower: u32,
    upper: u32,
}

/// The lines an extruder is in use (`ExtruderUsageBlcok`): from `start`, with its filament and nozzle then, to `end`,
/// the last of which, from `post_start` to `post_end`, change away from it; and whether the tower's wipe after the
/// change to it touches the model or is on the first layer (then it heats to the full temperature).
#[derive(Clone, Copy, Debug)]
struct ExtruderUse {
    extruder: i32,
    start: u32,
    end: u32,
    start_filament: i32,
    end_filament: i32,
    start_nozzle: i32,
    end_nozzle: i32,
    post_start: u32,
    post_end: u32,
    ignore_cooling_before_tower: bool,
}

impl Default for ExtruderUse {
    fn default() -> ExtruderUse {
        ExtruderUse {
            extruder: -1,
            start: UNSET,
            end: UNSET,
            start_filament: -1,
            end_filament: -1,
            start_nozzle: -1,
            end_nozzle: -1,
            post_start: UNSET,
            post_end: UNSET,
            ignore_cooling_before_tower: false,
        }
    }
}

impl ExtruderUse {
    fn begin(&mut self, extruder: i32, start: u32, filament: i32, nozzle: i32) {
        (self.extruder, self.start, self.start_filament, self.start_nozzle) = (extruder, start, filament, nozzle);
    }

    fn finish(&mut self, end: u32, filament: i32, post_end: u32, nozzle: i32) {
        (self.end, self.end_filament, self.post_end, self.end_nozzle) = (end, filament, post_end, nozzle);
    }
}

/// An extruder waiting (`ExtruderFreeBlock`): from line `lower` to `upper`, after `last_filament` and before
/// `next_filament`, the stretch from `partial_lower` to `partial_upper` being the change away from it.
#[derive(Clone, Copy, Debug)]
struct Wait {
    lower: u32,
    upper: u32,
    partial_lower: u32,
    partial_upper: u32,
    last_filament: i32,
    next_filament: i32,
    last_nozzle: i32,
    extruder: i32,
    ignore_cooling_before_tower: bool,
}

/// What the markers say of the G-code (Orca's `build_usage_blocks`).
struct Usage {
    start_end: u32,
    end_start: u32,
    filaments: Vec<FilamentUse>,
    extruders: Vec<ExtruderUse>,
    /// The stretches the printer may skip (`; SKIPPABLE_START` to `; SKIPPABLE_END`, the timelapse's).
    skippable: Vec<(u32, u32)>,
    /// Whether anything moves between the end of the start G-code and the first change of filament.
    moved_before_first_use: bool,
}

/// The numbers after `OF`, `NF`, `ON` and `NN` in a nozzle change's marker.
fn nozzle_change(line: &str) -> Option<[i32; 4]> {
    let mut out = [0; 4];
    let mut rest = line;
    for (k, key) in ["OF", "NF", "ON", "NN"].iter().enumerate() {
        let at = rest.find(key)?;
        let digits: String = rest[at + 2..].chars().take_while(char::is_ascii_digit).collect();
        out[k] = digits.parse().ok()?;
        rest = &rest[at + 2 + digits.len()..];
    }
    Some(out)
}

/// A filament number at the start of `s` (after spaces), under 255, and the nozzle an `H` after it names (-1: none).
fn filament_and_nozzle(s: &str) -> Option<(i32, i32)> {
    let s = s.trim_start();
    let digits: String = s.chars().take_while(char::is_ascii_digit).collect();
    let id: i32 = digits.parse().ok().filter(|&n| n < 255)?;
    let nozzle = s[digits.len()..]
        .split_whitespace()
        .find_map(|w| w.strip_prefix('H'))
        .and_then(|n| n.parse().ok())
        .unwrap_or(-1);
    Some((id, nozzle))
}

impl Usage {
    fn new() -> Usage {
        Usage {
            start_end: UNSET,
            end_start: UNSET,
            filaments: Vec::new(),
            // The first use of an extruder has no marker before it: Orca starts with an empty one.
            extruders: vec![ExtruderUse::default()],
            skippable: Vec::new(),
            moved_before_first_use: false,
        }
    }

    /// What line `id` says, if it is a marker or a change of filament.
    fn line(&mut self, id: u32, raw: &str, p: &Params) {
        // Moves, most of the G-code, say nothing here.
        if !matches!(raw.as_bytes().first(), Some(b';' | b'T' | b'M' | b' ' | b'\t')) {
            self.moved_before_first_use |= self.start_end != UNSET && self.filaments.is_empty() && raw.starts_with('G');
            return;
        }
        let line = raw.trim_end_matches(['\n', '\r']);
        match line.strip_prefix(';') {
            Some(" SKIPPABLE_START") => self.skippable.push((id, 0)),
            Some(" SKIPPABLE_END") => {
                if let Some(b) = self.skippable.last_mut() {
                    b.1 = id;
                }
            }
            Some(" MACHINE_START_GCODE_END") => {
                self.start_end = id;
                return;
            }
            Some(" MACHINE_END_GCODE_START") => {
                self.end_start = id;
                return;
            }
            _ => {}
        }
        let t = line.trim_start_matches([' ', '\t']);
        if t.starts_with('G') {
            self.moved_before_first_use |= self.start_end != UNSET && self.filaments.is_empty();
            return;
        }
        let change = if let Some(rest) = t.strip_prefix('T') {
            filament_and_nozzle(rest)
        } else if let Some(rest) = t.strip_prefix(";VT") {
            filament_and_nozzle(rest)
        } else if t.starts_with("M1020") {
            line.find('S').and_then(|at| filament_and_nozzle(&line[at + 1..]))
        } else {
            if t.starts_with("; NOZZLE_CHANGE_START") {
                if let Some(b) = self.extruders.last_mut() {
                    b.post_start = id;
                }
            } else if t.starts_with("; NOZZLE_CHANGE_END") {
                let [of, nf, on, nn] = nozzle_change(t).unwrap_or([-1; 4]);
                let extruder = p.extruder_of_nozzle(nn).map_or(-1, |e| e as i32);
                if let Some(b) = self.extruders.last_mut() {
                    b.finish(id, of, id, on);
                }
                let mut next = ExtruderUse::default();
                next.begin(extruder, id, nf, nn);
                self.extruders.push(next);
            } else if let Some(rest) = t.strip_prefix("; CP_TOOLCHANGE_WIPE") {
                // "CT<contact> FL<first layer>"
                let flag = |key: &str| {
                    let digit =
                        rest.split_whitespace().find_map(|w| w.strip_prefix(key)).and_then(|v| v.chars().next());
                    digit.is_some_and(|d| d.is_ascii_digit() && d != '0')
                };
                if let Some(b) = self.extruders.last_mut() {
                    b.ignore_cooling_before_tower = flag("CT") || flag("FL");
                }
            }
            return;
        };
        let Some((filament, nozzle)) = change else { return };
        // Changes in the start and end G-code don't count.
        if (self.start_end == UNSET && id < UNSET) || (self.end_start != UNSET && id > self.end_start) {
            return;
        }
        if let Some(b) = self.filaments.last_mut() {
            b.upper = id;
        }
        let nozzle = if nozzle == -1 { p.extruder_of.get(filament as usize).map_or(-1, |&e| e as i32) } else { nozzle };
        let extruder = p.extruder_of_nozzle(nozzle).map_or(0, |e| e as i32);
        self.filaments.push(FilamentUse { filament, extruder, nozzle, lower: id, upper: UNSET });
    }

    /// Closes the uses: the last run to the end G-code, the first extruder's from the start G-code's end.
    fn finish(&mut self, p: &Params) {
        if let Some(b) = self.filaments.last_mut() {
            b.upper = self.end_start;
        }
        let first = self.filaments.first().map_or(0, |b| b.filament);
        let last = self.filaments.last().map_or(0, |b| b.filament);
        let nozzle = p.extruder_of.get(first as usize).map_or(-1, |&e| e as i32);
        self.extruders[0].begin(nozzle, self.start_end, first, nozzle);
        let last_nozzle = self.filaments.last().map_or(-1, |b| b.nozzle);
        let end_start = self.end_start;
        if let Some(b) = self.extruders.last_mut() {
            b.post_start = end_start;
            b.finish(end_start, last, end_start, last_nozzle);
        }
    }

    /// Where each extruder waits (`build_extruder_free_blocks`), in order of where the wait starts: between its uses
    /// where the G-code changes nozzle, else between one filament's use and the next's on the same extruder.
    fn waits(&self) -> Vec<Wait> {
        let mut out = Vec::new();
        if self.extruders.len() <= 1 {
            for (extruder, mut blocks) in by_extruder(self.filaments.iter().map(|b| (b.extruder, *b))) {
                blocks
                    .insert(0, FilamentUse { filament: -1, extruder: -1, nozzle: -1, lower: 0, upper: self.start_end });
                blocks.push(FilamentUse {
                    filament: -1,
                    extruder: -1,
                    nozzle: -1,
                    lower: self.end_start,
                    upper: UNSET,
                });
                for pair in blocks.windows(2) {
                    let (a, b) = (pair[0], pair[1]);
                    out.push(Wait {
                        lower: a.upper,
                        upper: b.lower,
                        partial_lower: a.upper,
                        partial_upper: a.upper,
                        last_filament: a.filament,
                        next_filament: b.filament,
                        last_nozzle: if a.nozzle == -1 { b.nozzle } else { a.nozzle },
                        extruder,
                        ignore_cooling_before_tower: true,
                    });
                }
            }
        } else {
            for (extruder, mut blocks) in by_extruder(self.extruders.iter().map(|b| (b.extruder, *b))) {
                let mut start = ExtruderUse::default();
                start.begin(extruder, 0, -1, -1);
                start.post_start = self.start_end;
                start.finish(self.start_end, -1, self.start_end, -1);
                let mut end = ExtruderUse::default();
                end.begin(extruder, self.end_start, -1, -1);
                end.post_start = END;
                end.finish(END, -1, END, -1);
                blocks.insert(0, start);
                blocks.push(end);
                for pair in blocks.windows(2) {
                    let (a, b) = (pair[0], pair[1]);
                    out.push(Wait {
                        lower: a.end,
                        upper: b.start,
                        partial_lower: a.post_start,
                        partial_upper: a.post_end,
                        last_filament: a.end_filament,
                        next_filament: b.start_filament,
                        last_nozzle: if a.end_nozzle == -1 { b.start_nozzle } else { a.end_nozzle },
                        extruder,
                        ignore_cooling_before_tower: b.ignore_cooling_before_tower,
                    });
                }
            }
        }
        // In order of where they start and end (Orca's sort; equal ones keep their order).
        let mut order: Vec<([f64; 4], usize)> =
            out.iter().enumerate().map(|(i, w)| ([f64::from(w.lower), f64::from(w.upper), 0.0, 0.0], i)).collect();
        crate::fill::sort_keyed(&mut order);
        order.iter().map(|&(_, i)| out[i]).collect()
    }
}

// ---- The lines (Orca's `inject_cooling_heating_command`).

struct Injector<'a> {
    p: &'a Params,
    /// Each of the processor's moves: its line and the seconds from the start to its end.
    moves: &'a [(u32, f32)],
    skippable: &'a [(u32, u32)],
}

impl Injector<'_> {
    /// The first move on or after line `id`.
    fn first_from(&self, id: u32) -> usize {
        self.moves.partition_point(|m| m.0 < id)
    }

    /// The start of the stretch the printer may skip that line `id` is in, if it is in one.
    fn skippable_start(&self, id: u32) -> Option<u32> {
        let i = self.skippable.partition_point(|b| b.0 <= id);
        let b = self.skippable.get(i.checked_sub(1)?)?;
        (id >= b.0 && id <= b.1).then_some(b.0)
    }

    /// Seconds from the start to the end of move `i`, and to just before it.
    fn time(&self, i: usize) -> f32 {
        self.moves[i].1
    }

    fn before(&self, i: usize) -> f32 {
        if i == 0 { 0.0 } else { self.moves[i - 1].1 }
    }

    #[allow(clippy::too_many_arguments)]
    fn m104(
        &self,
        added: &mut Added,
        after: u32,
        extruder: usize,
        temp: i32,
        skippable: bool,
        next_filament: i32,
        comment: &str,
    ) {
        // (Orca names the next nozzle too, `M632 S… H…`, on printers that map nozzles per layer, which the X2D doesn't.)
        if skippable {
            let n = if at_or_front(&self.p.nozzles, extruder, 1) > 1 { " N R" } else { "" };
            added.push((after, format!("M632 S{next_filament}{n} W\n")));
        }
        added.push((after, "M400\n".into()));
        let t = self.p.physical.get(extruder).copied().unwrap_or(extruder as i64);
        added.push((after, format!("M104 T{t} S{temp} N0 ;{comment}\n")));
        if skippable {
            added.push((after, "M633\n".into()));
        }
    }

    /// The lines for one wait: cool from `curr`, heat to `target`.
    fn wait(&self, added: &mut Added, w: &Wait, curr: f32, target: f32, cool: bool, heat: bool) {
        let (p, n) = (self.p, self.moves.len());
        if !cool && !heat && w.upper <= w.lower {
            return;
        }
        let lower = self.first_from(w.lower);
        let upper_end = self.first_from(w.upper);
        if lower == n || upper_end == 0 {
            return;
        }
        let upper = upper_end - 1;
        let gap = self.time(upper) - self.before(lower);
        let partial_lower = self.first_from(w.partial_lower);
        let partial_end = self.first_from(w.partial_upper);
        if partial_lower == n || partial_end == 0 {
            return;
        }
        let partial_gap = self.time(partial_end - 1) - self.before(partial_lower);
        if lower >= upper {
            return;
        }
        let lf = w.last_filament;
        let valid = lf >= 0
            && p.pre_cooling
                .get(lf as usize)
                .is_some_and(|&c| c > 0 && p.temperature.get(lf as usize).is_some_and(|&t| c < t));
        let cool_partly = valid && cool;
        // Orca's threshold is 0 s.
        if (cool_partly && partial_gap + gap < 0.0) || (!cool_partly && gap < 0.0) {
            return;
        }
        let extruder = p.extruder_of_nozzle(w.last_nozzle).unwrap_or(0);
        let heating = at_or_front(&p.heating, extruder, 1.0);
        let cooling = at_or_front(&p.cooling, extruder, 1.0);
        let mut curr = curr;
        if cool_partly {
            let threshold = p.temperature[lf as usize] as f32 - p.pre_cooling[lf as usize] as f32;
            let most = curr.min(threshold.min(partial_gap * cooling));
            curr = ROOM.max(curr - most);
            let comment = "Multi extruder pre cooling in post extrusion";
            self.m104(added, w.partial_lower, extruder, curr as i32, false, w.next_filament, comment);
        }
        if cool && !heat {
            if target >= curr {
                return;
            }
            let to = (ROOM as i32).max(target as i32);
            self.m104(added, w.lower, extruder, to, false, w.next_filament, "Multi extruder pre cooling");
            return;
        }
        // The first move that ends after `secs`, among the wait's.
        let ends_after = |secs: f32| lower + self.moves[lower..=upper].partition_point(|m| m.1 <= secs);
        if !cool && heat {
            if target <= curr {
                return;
            }
            let start = self.time(upper) - (target - curr) / heating;
            let i = ends_after(start);
            let after = if i == lower { w.lower } else { self.moves[self.out_of_skippable(i - 1, lower)].0 };
            self.m104(added, after, extruder, target as i32, true, w.next_filament, "Multi extruder pre heating");
            return;
        }
        // Cool first, then heat: to the temperature from which heating ends as the wait does.
        let mid = ROOM.max((curr * heating + target * cooling - gap * cooling * heating) / (cooling + heating));
        let start = self.time(upper) - (target - mid) / heating;
        let i = ends_after(start);
        if i == lower {
            return;
        }
        let i = self.out_of_skippable(i - 1, lower);
        let cooled = self.time(i) - self.time(lower);
        let delta = ((cooled * cooling) as i32).min(curr as i32);
        if delta == 0 {
            return;
        }
        let to = (ROOM as i32).max(curr as i32 - delta);
        self.m104(added, w.lower, extruder, to, false, w.next_filament, "Multi extruder pre cooling");
        self.m104(added, self.moves[i].0, extruder, target as i32, true, w.next_filament, "Multi extruder pre heating");
    }

    /// Move `i`, or the last move before the stretch the printer may skip that it is in (none before `first`).
    fn out_of_skippable(&self, mut i: usize, first: usize) -> usize {
        while i != first {
            let Some(start) = self.skippable_start(self.moves[i].0) else { break };
            let j = first + self.moves[first..i].partition_point(|m| m.0 < start);
            if j == first {
                break;
            }
            i = j - 1;
        }
        i
    }
}

// ---- Orca's estimator, as far as pre-heating reads it.

/// One of the planner's blocks: the processor's move it times (none for the printer's own moves, whose seconds Orca
/// writes to the file's first move), whether it is a tool change's (which a change's own seconds wait for), its
/// move among the planner's (none for a tool change, which goes nowhere), and the pauses it took on.
#[derive(Clone, Copy)]
struct Block {
    vertex: Option<usize>,
    tool: bool,
    motion: Option<usize>,
    extra: f32,
}

/// Each move's seconds by line, as Orca's processor hands them out (`calculate_time`).
struct Clock<'a> {
    s: &'a Settings,
    p: &'a Params,
    moves: Vec<(u32, f32)>,
    /// Whether the processor puts a point of no time before each move (where its speed changes along it).
    turns: Vec<bool>,
    /// The moves since the planner last started from rest, where from, and the blocks of them and of the tool
    /// changes among them, the last `pending` of which the planner still holds.
    batch: Vec<Move>,
    from: [f64; 3],
    blocks: Vec<Block>,
    pending: usize,
    /// Pauses waiting for a block to take them: for a tool change's own block, or for any.
    waiting: Vec<(bool, f32)>,
    at: [f64; 3],
    e: f64,
    absolute: bool,
    e_relative: bool,
    feed: f64,
    accel: f64,
    wiping: bool,
    filament: Option<usize>,
    /// The filament each extruder's nozzle holds.
    held: Vec<Option<usize>>,
}

impl<'a> Clock<'a> {
    fn new(p: &'a Params, s: &'a Settings, capacity: usize) -> Clock<'a> {
        Clock {
            s,
            p,
            moves: Vec::with_capacity(capacity),
            turns: Vec::with_capacity(capacity),
            batch: Vec::new(),
            from: [0.0; 3],
            blocks: Vec::new(),
            pending: 0,
            waiting: Vec::new(),
            at: [0.0; 3],
            e: 0.0,
            absolute: true,
            e_relative: false,
            feed: 0.0,
            accel: f64::NAN,
            wiping: false,
            filament: None,
            held: vec![None; p.heating.len().max(1)],
        }
    }

    /// Each move's line and the seconds from the start to its end, with a point of no time before a move whose
    /// speed changes along it.
    fn finish(mut self) -> Vec<(u32, f32)> {
        self.time_batch();
        let mut total = 0.0f32;
        let mut out = Vec::with_capacity(self.moves.len() + self.turns.len() / 2);
        for (&(line, secs), &turns) in self.moves.iter().zip(&self.turns) {
            if turns {
                out.push((line, total));
            }
            total += secs;
            out.push((line, total));
        }
        out
    }

    fn line(&mut self, id: u32, raw: &str) {
        let line = raw.trim_ascii();
        if !matches!(line.as_bytes().first(), Some(b';' | b'G' | b'M' | b'T' | b'S')) {
            return;
        }
        if let Some(comment) = line.strip_prefix(';') {
            if comment.starts_with(" WIPE_START") {
                self.wiping = true;
            } else if comment.starts_with(" WIPE_END") {
                self.wiping = false;
            } else if let Some(rest) = comment.strip_prefix("VG1 ") {
                let words = Words::read(rest.split(';').next().unwrap_or(""));
                self.g1(id, &words, false);
            }
            return;
        }
        let code = line.split(';').next().unwrap_or("");
        let (cmd, rest) = code.split_once(|c: char| c.is_ascii_whitespace()).unwrap_or((code, ""));
        let value = |letter: u8| Words::read(rest).get(letter);
        match cmd {
            "G0" | "G1" => self.g1(id, &Words::read(rest), true),
            "G2" | "G3" => self.arc(id, &Words::read(rest), cmd == "G2"),
            "G4" | "M400" => {
                if let Some(secs) = value(b'S').or_else(|| value(b'P').map(|ms| ms * 0.001)) {
                    self.sync(secs as f32, false);
                }
            }
            "SYNC" => {
                if let Some(secs) = value(b'T') {
                    self.sync(secs as f32, false);
                }
            }
            "G90" => self.absolute = true,
            "G91" => self.absolute = false,
            "M82" => self.e_relative = false,
            "M83" => self.e_relative = true,
            "G92" => {
                if let Some(e) = value(b'E') {
                    self.e = e;
                }
            }
            "M204" => {
                if let Some(a) = value(b'S') {
                    self.accel = a;
                }
            }
            _ => {
                if let Some(n) = cmd.strip_prefix('T').and_then(|n| n.parse::<usize>().ok()) {
                    self.tool(id, n, value(b'H').map_or(-1, |h| h as i64));
                }
            }
        }
    }

    /// Where an axis goes, and the filament a move pushes (relative), from its words.
    fn target(&mut self, words: &Words) -> ([f64; 3], f64, f64) {
        let mut to = self.at;
        for (a, letter) in b"XYZ".iter().copied().enumerate() {
            if let Some(v) = words.get(letter) {
                to[a] = if self.absolute { v } else { self.at[a] + v };
            }
        }
        let (e, e_abs) = match words.get(b'E') {
            Some(v) if self.e_relative || !self.absolute => (v, self.e + v),
            Some(v) => (v - self.e, v),
            None => (0.0, self.e),
        };
        (to, e, e_abs)
    }

    fn g1(&mut self, id: u32, words: &Words, vertex: bool) {
        let (to, e, e_abs) = self.target(words);
        if let Some(f) = words.get(b'F') {
            self.feed = f / 60.0;
        }
        self.e = e_abs;
        self.go(id, to, e, vertex);
    }

    /// An arc, in the straight pieces Orca's estimator splits it into (`process_G2_G3`, Marlin's legacy flavour).
    fn arc(&mut self, id: u32, words: &Words, clockwise: bool) {
        let (i, j) = (words.get(b'I'), words.get(b'J'));
        if i.is_none() && j.is_none() {
            return;
        }
        let (end, e, e_abs) = self.target(words);
        let pieces = arc_pieces(self.at, end, i.unwrap_or(0.0), j.unwrap_or(0.0), clockwise);
        if pieces.is_empty() {
            return;
        }
        if let Some(f) = words.get(b'F') {
            self.feed = f / 60.0;
        }
        self.e = e_abs;
        let share = e / pieces.len() as f64;
        for to in pieces {
            self.go(id, to, share, true);
        }
    }

    /// A straight move (`process_G1`): a block for the planner and, unless it is the printer's own, a move of the
    /// processor's.
    fn go(&mut self, id: u32, to: [f64; 3], e: f64, vertex: bool) {
        let d = [to[0] - self.at[0], to[1] - self.at[1], to[2] - self.at[2]];
        if d.iter().all(|v| *v == 0.0) && e == 0.0 {
            return;
        }
        let (xy, z) = (d[0] != 0.0 || d[1] != 0.0, d[2] != 0.0);
        let kind = if self.wiping {
            Kind::Wipe
        } else if e < 0.0 {
            if xy || z { Kind::Travel } else { Kind::Retract }
        } else if e > 0.0 {
            if xy {
                Kind::Extrude(Role::InnerWall)
            } else if z {
                Kind::Travel
            } else {
                Kind::Retract
            }
        } else {
            Kind::Travel
        };
        let (x, y, z) = (to[0], to[1], to[2]);
        self.batch.push(Move { x, y, z, e, f: self.feed, accel: self.accel, kind, width: 0.0, height: 0.0 });
        let v = vertex.then(|| {
            self.moves.push((id, 0.0));
            self.turns.push(false);
            self.moves.len() - 1
        });
        self.blocks.push(Block { vertex: v, tool: false, motion: Some(self.batch.len() - 1), extra: 0.0 });
        self.pending += 1;
        self.at = to;
        if vertex && self.pending > REFRESH {
            let first = self.blocks.len() - self.pending;
            self.hand_out(first, first + self.pending - QUEUE, None);
            self.pending = QUEUE;
        }
    }

    /// A change of filament (`process_filament_change`): its seconds, on a block of its own.
    fn tool(&mut self, id: u32, filament: usize, nozzle: i64) {
        if self.filament == Some(filament) && nozzle == -1 {
            return;
        }
        let Some(&to) = self.p.extruder_of.get(filament) else { return };
        let mut secs = 0.0;
        if self.filament.and_then(|f| self.p.extruder_of.get(f)).is_some_and(|&from| from != to) {
            secs += self.p.change_secs;
        }
        if let Some(held) = self.held.get_mut(to) {
            if *held != Some(filament) {
                if held.is_some() {
                    secs += self.p.unload_secs;
                }
                secs += self.p.load_secs;
            }
            *held = Some(filament);
        }
        self.filament = Some(filament);
        self.moves.push((id, 0.0));
        self.turns.push(false);
        self.blocks.push(Block { vertex: Some(self.moves.len() - 1), tool: true, motion: None, extra: 0.0 });
        self.pending += 1;
        self.sync(secs as f32, true);
    }

    /// The planner waits for its moves (`simulate_st_synchronize`), `secs` more (for a tool change's block, or any).
    fn sync(&mut self, secs: f32, tool: bool) {
        if self.pending < 2 {
            if secs > 0.0 {
                self.waiting.push((tool, secs));
            }
            return;
        }
        let first = self.blocks.len() - self.pending;
        self.hand_out(first, self.blocks.len(), (secs > 0.0).then_some((tool, secs)));
        self.pending = 0;
        self.time_batch();
    }

    /// The waiting pauses (and `add`), each to the first of blocks `from..to` it may go to, one to a block.
    fn hand_out(&mut self, from: usize, to: usize, add: Option<(bool, f32)>) {
        let mut merged: Vec<(bool, f32)> = Vec::new();
        for (tool, secs) in std::mem::take(&mut self.waiting).into_iter().chain(add) {
            match merged.last_mut() {
                Some(last) if last.0 == tool => last.1 += secs,
                _ => merged.push((tool, secs)),
            }
        }
        let mut k = 0;
        for b in &mut self.blocks[from..to] {
            if k < merged.len() && (!merged[k].0 || b.tool) {
                b.extra += merged[k].1;
                k += 1;
            }
        }
        self.waiting = merged.split_off(k);
    }

    /// The planner's seconds for the batch's moves, onto the processor's moves they belong to; and where a printing,
    /// travelling or wiping move changes speed along the way.
    fn time_batch(&mut self) {
        let timed = timing_and_turns(&self.batch, self.from, self.s);
        for b in &self.blocks {
            if let Some(v) = b.vertex {
                let (secs, turns) = b.motion.map_or((0.0, false), |m| timed[m]);
                self.moves[v].1 = (secs + b.extra as f64) as f32;
                self.turns[v] = turns && b.motion.is_some_and(|m| self.batch[m].kind != Kind::Retract);
            }
        }
        self.batch.clear();
        self.blocks.clear();
        self.from = self.at;
    }
}

/// A G-code line's numbers by letter: the first word that starts with each (Orca's reader takes the first too).
struct Words {
    values: [f64; 26],
    seen: u32,
}

impl Words {
    fn read(text: &str) -> Words {
        let mut w = Words { values: [f64::NAN; 26], seen: 0 };
        for word in text.split_ascii_whitespace() {
            let b = word.as_bytes()[0];
            if b.is_ascii_uppercase() && w.seen & (1 << (b - b'A')) == 0 {
                w.seen |= 1 << (b - b'A');
                w.values[(b - b'A') as usize] = number(&word[1..]).unwrap_or(f64::NAN);
            }
        }
        w
    }

    fn get(&self, letter: u8) -> Option<f64> {
        Some(self.values[(letter - b'A') as usize]).filter(|v| !v.is_nan())
    }
}

/// A number as G-code writes one (`-12.5`, `.4`, `3`), read exactly as `str::parse` reads it but faster: digits make
/// an integer that a power of ten then divides, both exact, so the one rounding is the division's.
fn number(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    let (negative, digits) = match b.first() {
        Some(b'-') => (true, &b[1..]),
        Some(b'+') => (false, &b[1..]),
        _ => (false, b),
    };
    let (mut mantissa, mut decimals, mut any, mut point) = (0u64, 0i32, false, false);
    for &c in digits {
        match c {
            b'0'..=b'9' if mantissa < (1 << 53) / 10 => {
                mantissa = mantissa * 10 + u64::from(c - b'0');
                decimals += i32::from(point);
                any = true;
            }
            b'.' if !point => point = true,
            _ => return s.parse().ok(),
        }
    }
    const POW10: [f64; 23] = [
        1e0, 1e1, 1e2, 1e3, 1e4, 1e5, 1e6, 1e7, 1e8, 1e9, 1e10, 1e11, 1e12, 1e13, 1e14, 1e15, 1e16, 1e17, 1e18, 1e19,
        1e20, 1e21, 1e22,
    ];
    if !any || decimals > 22 {
        return s.parse().ok();
    }
    let v = mantissa as f64 / POW10[decimals as usize];
    Some(if negative { -v } else { v })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two PLA filaments at 220 °C, the first on the right extruder (the X2D's numbers: right is physical 0).
    fn x2d() -> Params {
        Params {
            temperature: vec![220, 220],
            pre_cooling: vec![0, 0],
            preheat_delta: vec![0.0, 0.0],
            extruder_of: vec![1, 0],
            heating: vec![1.5, 1.5],
            cooling: vec![2.0, 2.0],
            physical: vec![1, 0],
            nozzles: vec![1],
            switcher_offset: None,
            change_secs: 5.0,
            load_secs: 29.0,
            unload_secs: 29.0,
        }
    }

    /// Moves of no time on lines 5 to 9 (the start G-code's), then one a second on each of lines 10 to 110.
    fn second_a_line() -> Vec<(u32, f32)> {
        (5..=110u32).map(|l| (l, l.saturating_sub(9) as f32)).collect()
    }

    /// The left extruder (filament 2's) waiting from line 10 to line 111, from where it has never printed.
    fn first_wait() -> Wait {
        Wait {
            lower: 10,
            upper: 111,
            partial_lower: 10,
            partial_upper: 10,
            last_filament: -1,
            next_filament: 1,
            last_nozzle: 0,
            extruder: 0,
            ignore_cooling_before_tower: false,
        }
    }

    fn lines(added: &Added, after: u32) -> Vec<&str> {
        added.iter().filter(|a| a.0 == after).map(|a| a.1.as_str()).collect()
    }

    #[test]
    fn a_wait_cools_then_heats_just_in_time() {
        let (p, moves) = (x2d(), second_a_line());
        let injector = Injector { p: &p, moves: &moves, skippable: &[] };
        let mut added = Added::new();
        injector.wait(&mut added, &first_wait(), UNUSED as f32, 220.0, true, true);
        // A 101 s wait from 140 °C: heating at 1.5 °C/s from the temperature that cooling at 2 °C/s reaches, so that it
        // ends as the wait does: from 99.1 °C, 80.6 s before the end, so after the move that ends at 20 s. The nozzle
        // has cooled 19 s by then (from the end of the first move): 38 °C.
        assert_eq!(lines(&added, 10), ["M400\n", "M104 T1 S102 N0 ;Multi extruder pre cooling\n"]);
        assert_eq!(
            lines(&added, 29),
            ["M632 S1 W\n", "M400\n", "M104 T1 S220 N0 ;Multi extruder pre heating\n", "M633\n"]
        );
        assert_eq!(added.len(), 6);
    }

    #[test]
    fn heating_starts_before_a_stretch_the_printer_may_skip() {
        let (p, moves) = (x2d(), second_a_line());
        let injector = Injector { p: &p, moves: &moves, skippable: &[(25, 35)] };
        let mut added = Added::new();
        injector.wait(&mut added, &first_wait(), UNUSED as f32, 220.0, true, true);
        // The move at line 29 is in the stretch, so heating starts after line 24's (15 s), and cools 14 s: 28 °C.
        assert_eq!(lines(&added, 10)[1], "M104 T1 S112 N0 ;Multi extruder pre cooling\n");
        assert_eq!(lines(&added, 24)[2], "M104 T1 S220 N0 ;Multi extruder pre heating\n");
    }

    #[test]
    fn a_short_wait_adds_nothing_and_the_last_cools_to_the_room() {
        let (p, moves) = (x2d(), second_a_line());
        let injector = Injector { p: &p, moves: &moves, skippable: &[] };
        let mut added = Added::new();
        // 3 s at 220 °C: heating would have to start before the wait does.
        let short = Wait { upper: 13, last_filament: 1, ..first_wait() };
        injector.wait(&mut added, &short, 220.0, 220.0, true, true);
        assert!(added.is_empty());
        // After its last use, a nozzle goes to 25 °C and stays.
        let last = Wait { next_filament: -1, last_filament: 1, ..first_wait() };
        injector.wait(&mut added, &last, 220.0, 0.0, true, false);
        assert_eq!(lines(&added, 10), ["M400\n", "M104 T1 S25 N0 ;Multi extruder pre cooling\n"]);
    }

    #[test]
    fn numbers_read_as_the_standard_library_reads_them() {
        for s in
            ["0", "-0", "12", "-12.5", ".4", "-.019", "3.", "220", "0.0285", "204.285", "1e3", "x", "", "-", "1.2.3"]
        {
            assert_eq!(number(s).map(f64::to_bits), s.parse::<f64>().ok().map(f64::to_bits), "{s}");
        }
        let mut x = 0.0f64;
        for i in 0..20000 {
            x = (x * 1.37 + i as f64 * 0.731).rem_euclid(1000.0) - 500.0;
            let s = format!("{x:.3}");
            assert_eq!(number(&s).map(f64::to_bits), s.parse::<f64>().ok().map(f64::to_bits), "{s}");
        }
    }

    #[test]
    fn the_clock_hands_out_time_as_orcas_processor_does() {
        let p = x2d();
        let s = Settings::default();
        let gcode = "M83\nM204 S10000\nT0 H-1\nG1 X10 Y10 F6000\nG1 X60 E2\nG1 X60 Y60 E2\nG4 S7\n;VG1 E4 F600\nG1 E-.8 F1800\nT1 H-1\nG1 X10 Y60 F6000\n";
        let mut c = Clock::new(&p, &s, 16);
        for (i, line) in gcode.split_inclusive('\n').enumerate() {
            c.line(i as u32 + 1, line);
        }
        let durations: Vec<(u32, f32)> = c.moves.clone();
        let moves = c.finish();
        let at = |line: u32| durations.iter().find(|m| m.0 == line).map(|m| m.1).unwrap();
        // Loading the first filament takes 29 s, on its line, though the planner held nothing to give it to then;
        // the pause goes to the oldest move the planner holds, the first after it.
        assert_eq!(at(3), 29.0);
        assert!(at(4) > 7.0 && at(5) < 7.0, "{durations:?}");
        // The printer's own push (;VG1) is no move of the processor's; the change of filament takes its 5 s to change
        // extruder and 29 s to load the left nozzle, on its line.
        assert!(durations.iter().all(|m| m.0 != 8));
        assert_eq!(at(10), 34.0);
        // Moves that speed up or slow down get a point of no time before them, with their line (not the retraction).
        let points: Vec<u32> = moves.windows(2).filter(|w| w[0].0 == w[1].0).map(|w| w[0].0).collect();
        assert_eq!(points, [4, 5, 6, 11]);
        assert!(moves.windows(2).all(|w| w[0].1 <= w[1].1));
    }
}
