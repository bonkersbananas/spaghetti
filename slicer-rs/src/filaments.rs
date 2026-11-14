//! A plate in several filaments, as OrcaSlicer 2.5 prints one on the X2D: which nozzle each filament prints with,
//! each filament's settings for its nozzle, and how much each change of filament flushes.
//!
//! - **Nozzles.** The X2D has two extruders, each with one nozzle: the left, direct-drive one (extruder 0, the
//!   presets' "Direct Drive Standard" variant) and the right, Bowden one (extruder 1, "Bowden Standard"). Orca's
//!   default (`filament_map_mode` "Auto For Flush", its `FilamentGroup`) weighs every way to share the filaments
//!   out: first by keeping each on a nozzle that reaches all its objects (the right one prints from x = 20.5 mm and
//!   up to 256 mm), then by each nozzle's AMS holding its filaments (one 4-slot unit, as Orca's command line
//!   assumes), then by the flush its layers need, counted as time, plus the time loading and unloading takes; the
//!   larger group then goes on the left nozzle. With two filaments each gets its own nozzle, filament 1 the right
//!   one and filament 2 the left, so nothing flushes and every change is a change of nozzle. A setup may instead say
//!   which nozzle each filament uses (`filament_map_mode` "Manual" with `filament_map`), as Orca's does.
//! - **Settings per nozzle.** Every per-variant list in the presets (speeds, accelerations, retraction, the
//!   filament's volumetric speed and temperatures…) holds one value per extruder variant; a filament prints with the
//!   values of its nozzle's variant (Orca's `update_values_to_printer_extruders`).
//! - **Flushing.** A change of filament within one nozzle flushes the old one out through the printer's own chute
//!   (the change G-code's `M620.10 … L<length>`): Orca's volume for the pair of colours (`FlushVolCalc`, with the
//!   measured table of the nozzle's `nozzle_flush_dataset`, which for the right nozzle comes to the single-nozzle
//!   one) times the nozzle's `flush_multiplier`, at least 100 mm³. Its first nozzle volume counts to the filament it
//!   pushes out, the rest to the new one, as Orca's G-code processor counts them.

use crate::config::Settings;
use crate::json::Json;
use crate::profile::Profile;
use std::collections::BTreeMap;
use std::sync::Arc;

/// What a setup says of the plate's filaments, once it has more than one.
#[derive(Clone, Debug)]
pub struct Palette {
    /// Each filament's presets (the machine and the process with that filament), as given.
    pub profiles: Vec<Arc<Profile>>,
    /// Each filament's colour, "#RRGGBB".
    pub colours: Vec<String>,
    /// Each filament's extruder (0-based) when the setup chooses them (`filament_map_mode` "Manual").
    pub manual_map: Option<Vec<usize>>,
    /// Whether the tower's place is still to be chosen (the presets' own, not a setup's): then it goes where the app
    /// puts it, the first corner of the plate no object comes near.
    pub place_tower: bool,
}

/// The app's stand-in colours for filaments nobody coloured (`STAND_IN_COLOURS` in orca.ts).
pub const STAND_INS: [&str; 8] =
    ["#F2754E", "#4F7FC7", "#6FA37A", "#E8A33D", "#A77FC2", "#8D9AA3", "#C2418A", "#3F8F86"];

pub fn stand_in(i: usize) -> &'static str {
    STAND_INS[i % STAND_INS.len()]
}

/// `count` filaments with `s`'s presets (its colour first, then the stand-ins), for a plate given no setup.
pub fn palette_of(s: &Settings, count: usize) -> Palette {
    Palette {
        profiles: (0..count).map(|_| s.profile.clone()).collect(),
        colours: (0..count).map(|i| if i == 0 { s.filament_colour.clone() } else { stand_in(i).to_string() }).collect(),
        manual_map: None,
        place_tower: true,
    }
}

/// The X2D's extruders: their variant names in the presets' per-variant lists.
fn extruder_variant(p: &Profile, extruder: usize) -> String {
    let kind = p.list("extruder_type").get(extruder).copied().unwrap_or("Direct Drive").to_string();
    let volume = p.list("default_nozzle_volume_type").get(extruder).copied().unwrap_or("Standard").to_string();
    format!("{kind} {volume}")
}

/// mm³ an extruder's nozzle holds (`nozzle_volume` of its variant).
pub fn nozzle_volume(p: &Profile, extruder: usize) -> f64 {
    let (index, _) = variant_index(&p.machine, "printer_extruder_variant", &extruder_variant(p, extruder));
    p.list("nozzle_volume").get(index).and_then(|v| v.parse().ok()).unwrap_or(0.0)
}

/// How many extruders the printer has.
pub fn extruders(p: &Profile) -> usize {
    p.list("nozzle_diameter").len().max(1)
}

// Orca's sets of options with a value per extruder variant (PrintConfig.cpp, `print_options_with_variant`,
// `filament_options_with_variant`, `printer_options_with_variant_1` and `_2`) and per extruder
// (`printer_extruder_options`).
const PRINT_VARIANT_KEYS: &[&str] = &[
    "initial_layer_speed",
    "initial_layer_infill_speed",
    "outer_wall_speed",
    "inner_wall_speed",
    "small_perimeter_speed",
    "small_perimeter_threshold",
    "sparse_infill_speed",
    "internal_solid_infill_speed",
    "top_surface_speed",
    "enable_overhang_speed",
    "overhang_1_4_speed",
    "overhang_2_4_speed",
    "overhang_3_4_speed",
    "overhang_4_4_speed",
    "slowdown_for_curled_perimeters",
    "bridge_speed",
    "internal_bridge_speed",
    "gap_infill_speed",
    "support_speed",
    "support_interface_speed",
    "travel_speed",
    "travel_speed_z",
    "initial_layer_travel_speed",
    "default_acceleration",
    "bridge_acceleration",
    "travel_acceleration",
    "initial_layer_travel_acceleration",
    "initial_layer_acceleration",
    "outer_wall_acceleration",
    "inner_wall_acceleration",
    "sparse_infill_acceleration",
    "internal_solid_infill_acceleration",
    "top_surface_acceleration",
    "default_jerk",
    "outer_wall_jerk",
    "inner_wall_jerk",
    "infill_jerk",
    "top_surface_jerk",
    "initial_layer_jerk",
    "travel_jerk",
    "initial_layer_travel_jerk",
    "default_junction_deviation",
    "print_extruder_id",
    "print_extruder_variant",
    "top_solid_infill_flow_ratio",
];

const FILAMENT_VARIANT_KEYS: &[&str] = &[
    "filament_flow_ratio",
    "filament_max_volumetric_speed",
    "filament_ramming_volumetric_speed",
    "filament_pre_cooling_temperature",
    "filament_ramming_travel_time",
    "filament_ramming_volumetric_speed_nc",
    "filament_pre_cooling_temperature_nc",
    "filament_ramming_travel_time_nc",
    "filament_retract_length_nc",
    "filament_preheat_temperature_delta",
    "filament_extruder_variant",
    "filament_retraction_length",
    "filament_z_hop",
    "filament_z_hop_types",
    "filament_retract_lift_above",
    "filament_retract_lift_below",
    "filament_retract_lift_enforce",
    "filament_retract_restart_extra",
    "filament_retract_length_toolchange",
    "filament_retract_restart_extra_toolchange",
    "filament_retraction_speed",
    "filament_deretraction_speed",
    "filament_retraction_minimum_travel",
    "filament_retract_when_changing_layer",
    "filament_wipe",
    "filament_wipe_distance",
    "filament_retract_before_wipe",
    "filament_retract_after_wipe",
    "filament_long_retractions_when_cut",
    "filament_retraction_distances_when_cut",
    "long_retractions_when_ec",
    "retraction_distances_when_ec",
    "nozzle_temperature_initial_layer",
    "nozzle_temperature",
    "filament_flush_volumetric_speed",
    "filament_flush_temp",
    "filament_cooling_before_tower",
    "volumetric_speed_coefficients",
    "filament_adaptive_volumetric_speed",
    "filament_ironing_flow",
    "filament_ironing_spacing",
    "filament_ironing_inset",
    "filament_ironing_speed",
    "enable_pressure_advance",
    "pressure_advance",
    "adaptive_pressure_advance",
    "adaptive_pressure_advance_model",
    "adaptive_pressure_advance_overhangs",
    "adaptive_pressure_advance_bridges",
    "fan_min_speed",
    "fan_max_speed",
    "additional_cooling_fan_speed",
    "filament_minimal_purge_on_wipe_tower",
    "filament_multitool_ramming",
    "filament_multitool_ramming_volume",
    "filament_multitool_ramming_flow",
    "nozzle_temperature_range_low",
    "nozzle_temperature_range_high",
    "activate_air_filtration",
    "activate_air_filtration_during_print",
    "activate_air_filtration_on_completion",
    "during_print_exhaust_fan_speed",
    "complete_print_exhaust_fan_speed",
];

const PRINTER_VARIANT_KEYS: &[&str] = &[
    "nozzle_volume",
    "retraction_length",
    "z_hop",
    "travel_slope",
    "retract_lift_above",
    "retract_lift_below",
    "retract_lift_enforce",
    "z_hop_types",
    "retraction_speed",
    "deretraction_speed",
    "retraction_minimum_travel",
    "retract_when_changing_layer",
    "wipe",
    "wipe_distance",
    "retract_before_wipe",
    "retract_after_wipe",
    "retract_length_toolchange",
    "retract_restart_extra",
    "retract_restart_extra_toolchange",
    "long_retractions_when_cut",
    "retraction_distances_when_cut",
    "nozzle_type",
    "printer_extruder_id",
    "printer_extruder_variant",
    "hotend_cooling_rate",
    "hotend_heating_rate",
    "nozzle_flush_dataset",
];

/// The machine limits, a normal and a silent value per variant.
const PRINTER_MODE_KEYS: &[&str] = &[
    "machine_max_acceleration_x",
    "machine_max_acceleration_y",
    "machine_max_acceleration_z",
    "machine_max_acceleration_e",
    "machine_max_acceleration_extruding",
    "machine_max_acceleration_retracting",
    "machine_max_acceleration_travel",
    "machine_max_speed_x",
    "machine_max_speed_y",
    "machine_max_speed_z",
    "machine_max_speed_e",
    "machine_max_jerk_x",
    "machine_max_jerk_y",
    "machine_max_jerk_z",
    "machine_max_jerk_e",
    "machine_max_junction_deviation",
];

const PRINTER_EXTRUDER_KEYS: &[&str] = &[
    "extruder_type",
    "nozzle_diameter",
    "default_nozzle_volume_type",
    "extruder_printable_area",
    "extruder_bed_exclude_volumes",
    "extruder_printable_height",
    "min_layer_height",
    "max_layer_height",
    "extruder_max_nozzle_count",
];

fn strings(v: &Json) -> Vec<String> {
    match v {
        Json::Array(a) => a.iter().map(|j| j.as_str().unwrap_or("").to_string()).collect(),
        Json::String(s) => vec![s.clone()],
        _ => Vec::new(),
    }
}

/// `map` with every per-variant list in `keys` cut down to variant `index` of `count` (`per` values each).
fn project(map: &mut BTreeMap<String, Json>, keys: &[&str], index: usize, count: usize, per: usize) {
    for key in keys {
        let Some(Json::Array(list)) = map.get(*key) else { continue };
        if count <= 1 || list.len() != count * per {
            continue;
        }
        let picked: Vec<Json> = list[index * per..(index + 1) * per].to_vec();
        map.insert(key.to_string(), Json::Array(picked));
    }
}

/// The variant `name`'s place in a preset's variant list (`list_key`), else the first.
fn variant_index(map: &BTreeMap<String, Json>, list_key: &str, name: &str) -> (usize, usize) {
    let list = map.get(list_key).map(strings).unwrap_or_default();
    (list.iter().position(|v| v == name).unwrap_or(0), list.len())
}

/// The presets as a filament on `extruder` sees them: each per-variant list cut down to that extruder's variant,
/// each per-extruder list to that extruder, so the first value of each is the one it prints with.
pub fn for_extruder(p: &Profile, extruder: usize) -> Profile {
    let name = extruder_variant(p, extruder);
    let mut machine = p.machine.clone();
    let mut process = p.process.clone();
    let mut filament = p.filament.clone();
    let (m, mn) = variant_index(&machine, "printer_extruder_variant", &name);
    project(&mut machine, PRINTER_VARIANT_KEYS, m, mn, 1);
    project(&mut machine, PRINTER_MODE_KEYS, m, mn, 2);
    project(&mut machine, PRINTER_EXTRUDER_KEYS, extruder, extruders(p), 1);
    let (q, qn) = variant_index(&process, "print_extruder_variant", &name);
    project(&mut process, PRINT_VARIANT_KEYS, q, qn, 1);
    let (f, fnn) = variant_index(&filament, "filament_extruder_variant", &name);
    project(&mut filament, FILAMENT_VARIANT_KEYS, f, fnn, 1);
    Profile { machine, process, filament }
}

/// Each filament's settings for the nozzle it prints with.
pub fn settings_for(palette: &Palette, extruder_of: &[usize]) -> Vec<Settings> {
    palette
        .profiles
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let e = extruder_of.get(i).copied().unwrap_or(0);
            let mut s =
                Settings::from_profile(Arc::new(for_extruder(p, e)), palette.colours.get(i).map(String::as_str));
            s.palette = None;
            s
        })
        .collect()
}

/// The used filaments each extruder can't print, as Orca hands them to its grouping (`collect_unprintable_limits`):
/// by the filament's `filament_printable` bits (the first extruder whose bit is clear), and where an object in it
/// (`objects`: its filament, how far its slices reach, min x, min y, max x, max y, and its top) reaches outside
/// the extruder's `extruder_printable_area` or above its `extruder_printable_height` (Orca's geometric
/// unprintables; the X2D's areas are rectangles, so how far the slices reach tells). Of each kind, a filament
/// neither extruder can print is left out, and a filament the kinds put on different extruders keeps the first.
pub fn unprintable(palette: &Palette, used: &[usize], objects: &[(usize, [f64; 4], f64)]) -> Vec<Vec<usize>> {
    let p = &palette.profiles[0];
    let k = extruders(p);
    let mut physical = vec![Vec::new(); 2];
    let mut geometric = vec![Vec::new(); 2];
    if k < 2 {
        return physical;
    }
    for &f in used {
        let bits = palette.profiles.get(f).and_then(|q| q.list("filament_printable").first()?.parse::<i64>().ok());
        if let Some(e) = (0..k.min(32)).find(|&e| bits.unwrap_or(3) >> e & 1 == 0) {
            physical.resize(physical.len().max(e + 1), Vec::new());
            physical[e].push(f);
        }
    }
    let areas: Vec<Option<[f64; 4]>> = p
        .list("extruder_printable_area")
        .iter()
        .map(|area| {
            let pts: Vec<[f64; 2]> = area
                .split(',')
                .filter_map(|c| {
                    let (x, y) = c.split_once('x')?;
                    Some([x.trim().parse().ok()?, y.trim().parse().ok()?])
                })
                .collect();
            (!pts.is_empty()).then(|| {
                pts.iter().fold([f64::MAX, f64::MAX, f64::MIN, f64::MIN], |b, q| {
                    [b[0].min(q[0]), b[1].min(q[1]), b[2].max(q[0]), b[3].max(q[1])]
                })
            })
        })
        .collect();
    let heights: Vec<f64> = p.list("extruder_printable_height").iter().filter_map(|h| h.parse().ok()).collect();
    for &(f, b, top) in objects {
        for e in 0..k {
            let outside = areas
                .get(e)
                .copied()
                .flatten()
                .is_some_and(|a| b[0] < a[0] || b[1] < a[1] || b[2] > a[2] || b[3] > a[3]);
            let above = heights.get(e).is_some_and(|&h| top > h);
            if outside || above {
                geometric.resize(geometric.len().max(e + 1), Vec::new());
                geometric[e].push(f);
            }
        }
    }
    let mut limits = vec![Vec::new(); 2];
    let mut placed: Vec<usize> = Vec::new();
    for mut kind in [physical, geometric] {
        kind.truncate(2);
        kind.resize(2, Vec::new());
        for set in &mut kind {
            set.sort_unstable();
            set.dedup();
        }
        let both: Vec<usize> = kind[0].iter().copied().filter(|f| kind[1].contains(f)).collect();
        for (e, set) in kind.iter().enumerate() {
            for &f in set.iter().filter(|f| !both.contains(f)) {
                if !placed.contains(&f) {
                    placed.push(f);
                    limits[e].push(f);
                }
            }
        }
    }
    for set in &mut limits {
        set.sort_unstable();
    }
    limits
}

/// Which extruder each filament prints with (0-based), as Orca groups them: the setup's own map when it gives one,
/// else Orca's "Auto For Flush" grouping of the filaments the plate uses (`used`, ascending), whose `layers` (each
/// layer's filaments, ascending) it weighs, keeping each filament off the extruder that can't print it
/// (`unprintable`, by extruder) where it can. Filaments the plate doesn't use go on the master extruder
/// (`master_extruder_id`, the left one).
pub fn group(
    palette: &Palette,
    layers: &[Vec<usize>],
    used: &[usize],
    flush: &Flush,
    unprintable: &[Vec<usize>],
) -> Vec<usize> {
    let n = palette.profiles.len();
    let p = &palette.profiles[0];
    let k = extruders(p);
    let master = (p.int("master_extruder_id").max(1) - 1) as usize;
    if let Some(map) = &palette.manual_map {
        return (0..n).map(|i| map.get(i).copied().filter(|&e| e < k).unwrap_or(master)).collect();
    }
    let mut map = vec![master; n];
    if k < 2 || used.len() < 2 {
        return map;
    }
    // Each used filament's extruder it can't go on, if any.
    let banned: Vec<Option<usize>> = used.iter().map(|f| unprintable.iter().position(|set| set.contains(f))).collect();
    let labels = flush_group(p, layers, used, flush, k, master, &banned)
        .unwrap_or_else(|| pair_group(used, flush, k, master, &banned));
    for (&f, &l) in used.iter().zip(&labels) {
        map[f] = l;
    }
    map
}

/// Orca's flush counted in seconds (FilamentGroup's `FLUSH_VOLUME_TO_SCORE`: mm³ to grams at 1.26 g/cm³, 180 s a
/// gram, twice).
const FLUSH_SECONDS: f64 = 1.26 * 180.0 * 2.0 / 1000.0;
/// What Orca adds to the score of a grouping that leaves the master extruder fewer than half of the filaments.
const MASTER_SHORT: f64 = 10.0;
/// Orca weighs every grouping while there are fewer than this many (else it clusters them).
const GROUPINGS: u64 = 10_000;
/// The filaments an extruder's AMS holds as Orca's command line has it: one 4-slot unit.
const AMS_SLOTS: usize = 4;

/// Orca's grouping for least flushing (FilamentGroup's `calc_group_by_enum`, then `apply_master_extruder_preference`):
/// of every assignment of the used filaments to the `k` nozzles (filament `i`'s nozzle is digit `i` of a count in
/// base `k`), the first of the best: those that put the most filaments on a nozzle that can print them (`banned`),
/// then those whose nozzles' AMS hold their filaments (4 each), then the lowest `score`, raised by 10 where the
/// master extruder gets fewer than half of the filaments. On two nozzles the larger group then goes on the master
/// extruder, unless a filament can't print where that would put it. None where Orca would cluster instead (14
/// filaments or more on two nozzles).
fn flush_group(
    p: &Profile,
    layers: &[Vec<usize>],
    used: &[usize],
    flush: &Flush,
    k: usize,
    master: usize,
    banned: &[Option<usize>],
) -> Option<Vec<usize>> {
    let n = used.len();
    let total = (k as u64).checked_pow(n as u32).filter(|&t| t < GROUPINGS)?;
    if used.iter().any(|&f| f >= 64) {
        return None;
    }
    // Orca's command line groups for one 4-slot AMS on each extruder (`extruder_ams_count` "1#0|4#1").
    let holds = vec![AMS_SLOTS; k];
    let times = (p.float("machine_load_filament_time"), p.float("machine_unload_filament_time"));
    let mut best: Option<((usize, bool), f64, Vec<usize>)> = None;
    let mut labels = vec![0; n];
    let mut count = vec![0; k];
    for mask in 0..total {
        let mut num = mask;
        count.fill(0);
        for l in &mut labels {
            *l = (num % k as u64) as usize;
            num /= k as u64;
            count[*l] += 1;
        }
        let placeable = labels.iter().zip(banned).filter(|(l, b)| **b != Some(**l)).count();
        let prefer = (placeable, count.iter().zip(&holds).all(|(c, h)| c <= h));
        // One less preferred than the best so far can't win, whatever its score.
        if best.as_ref().is_some_and(|(f, _, _)| prefer < *f) {
            continue;
        }
        let mut s = score(layers, used, &labels, flush, k, times);
        if master < k && count[master] < n.div_ceil(2) {
            s += MASTER_SHORT;
        }
        if best.as_ref().is_none_or(|(f, b, _)| prefer > *f || (prefer == *f && s < *b)) {
            best = Some((prefer, s, labels.clone()));
        }
    }
    let (_, _, mut labels) = best?;
    if k == 2 && master < 2 {
        let other = 1 - master;
        let on = |g: usize| labels.iter().filter(|&&l| l == g).count();
        let (m, o) = (on(master), on(other));
        // Orca swaps the groups unless a filament can't print on the other extruder, or each group fits its own
        // extruder's AMS and not the other's.
        let blocked = labels.iter().zip(banned).any(|(&l, &b)| b == Some(if l == master { other } else { master }));
        let stuck = holds[other] >= o && holds[master] >= m && (holds[other] < m || holds[master] < o);
        if o > m && !blocked && !stuck {
            for l in &mut labels {
                *l = if *l == master { other } else { master };
            }
        }
    }
    Some(labels)
}

/// Orca's score of a grouping, in seconds (FilamentGroup's `full_evaluate`, as it runs for the X2D): the flush its
/// layers need, each nozzle printing its filaments in the order that flushes least from the one it holds (no look
/// ahead), plus a change's time on the order the layers print in, unloading what a nozzle holds and loading the next
/// (`simulate_filament_change_time` with no AMS preloading). Orca adds each layer's flush to a whole number.
fn score(layers: &[Vec<usize>], used: &[usize], labels: &[usize], flush: &Flush, k: usize, times: (f64, f64)) -> f64 {
    let mut nozzle_of = [usize::MAX; 64];
    for (&f, &l) in used.iter().zip(labels) {
        nozzle_of[f] = l;
    }
    let mut flushed = 0i32;
    // The orders found, by a nozzle's filaments on a layer (as a set) and the one it held before: Orca's cache, which
    // hands out the first order found for a set whatever order the layer lists it in. Each layer's order on each
    // nozzle is an index into it.
    let mut found: Vec<(u64, Option<usize>, Vec<usize>, f32)> = Vec::new();
    let mut orders: Vec<Vec<usize>> = vec![Vec::new(); k];
    let mut nozzles = Vec::new();
    let mut mine = Vec::new();
    for (e, orders) in orders.iter_mut().enumerate() {
        if !labels.contains(&e) {
            continue;
        }
        nozzles.push(e);
        let mut cost = 0i32;
        let mut held = None;
        for layer in layers {
            let set = layer.iter().filter(|&&f| nozzle_of[f] == e).fold(0u64, |m, &f| m | 1 << f);
            let i = match found.iter().position(|x| x.0 == set && x.1 == held) {
                Some(i) => i,
                None => {
                    mine.clear();
                    mine.extend(layer.iter().copied().filter(|&f| nozzle_of[f] == e));
                    let (order, c) = least_flush_order(flush, e, &mine, held);
                    found.push((set, held, order, c));
                    found.len() - 1
                }
            };
            cost = (cost as f32 + found[i].3) as i32;
            if let Some(&f) = found[i].2.last() {
                held = Some(f);
            }
            orders.push(i);
        }
        flushed += cost;
    }
    // A change's halves as Orca's time model has them, in single precision.
    let half = |t: f64| (t / 2.0) as f32;
    let load = (times.0 as f32 - half(times.0)) + half(times.0);
    let unload = half(times.1) + (times.1 as f32 - half(times.1));
    let mut seconds = 0.0f64;
    let mut held: Vec<Option<usize>> = vec![None; k];
    // Each layer's nozzles from the one that ended the layer below (Orca counts round from it as from an index).
    let mut last = 0;
    for layer in 0..layers.len() {
        let mut ended = last;
        for i in 0..nozzles.len() {
            let e = nozzles[(last + i) % nozzles.len()];
            let order = &found[orders[e][layer]].2;
            for &f in order {
                if held[e] != Some(f) {
                    if held[e].is_some() {
                        seconds += f64::from(unload);
                    }
                    seconds += f64::from(load);
                    held[e] = Some(f);
                }
            }
            if !order.is_empty() {
                ended = e;
            }
        }
        last = ended;
    }
    f64::from(flushed) * FLUSH_SECONDS + seconds
}

/// One nozzle's filaments on a layer in the order that flushes least from `start` (the filament it holds), and that
/// flush: Orca's `get_extruders_order` without looking a layer ahead, the shortest path through them all.
pub fn least_flush_order(flush: &Flush, e: usize, current: &[usize], start: Option<usize>) -> (Vec<usize>, f32) {
    let w = |a: usize, b: usize| flush.volume(e, a, b) as f32;
    match current {
        [] => return (Vec::new(), 0.0),
        [f] => return (vec![*f], start.map_or(0.0, |s| w(s, *f))),
        _ => {}
    }
    let mut all: Vec<usize> = current.to_vec();
    let added = match start {
        Some(s) => match all.iter().position(|&f| f == s) {
            Some(i) => {
                all.swap(0, i);
                false
            }
            None => {
                all.insert(0, s);
                true
            }
        },
        None => false,
    };
    let start_id = start.unwrap_or(all[0]);
    let n = all.len();
    let states = 1usize << n;
    // The least flush of a path through a state's filaments ending at each, and the filament before it there.
    let mut cache = vec![f32::MAX; states * n];
    let mut prev = vec![usize::MAX; states * n];
    cache[n] = 0.0;
    for state in 0..states {
        if state & 1 == 0 {
            continue;
        }
        for target in 0..n {
            if state >> target & 1 == 0 {
                continue;
            }
            for mid in 0..n {
                if state >> mid & 1 == 0 {
                    continue;
                }
                let from = state - (1 << target);
                if cache[from * n + mid] == f32::MAX {
                    continue;
                }
                let t = cache[from * n + mid] + w(all[mid], all[target]);
                if cache[state * n + target] > t {
                    cache[state * n + target] = t;
                    prev[state * n + target] = mid;
                }
            }
        }
    }
    let full = states - 1;
    let mut cost = f32::MAX;
    let mut found = 0.0;
    let mut dst = 0;
    for d in 0..n {
        if all[d] != start_id && cost > cache[full * n + d] {
            cost = cache[full * n + d];
            found = cost;
            dst = d;
        }
    }
    let mut path = Vec::new();
    let (mut state, mut point) = (full, dst);
    while point != usize::MAX {
        path.push(all[point]);
        let mid = prev[state * n + point];
        state -= 1 << point;
        point = mid;
    }
    if added {
        path.pop();
    }
    path.reverse();
    (path, found)
}

/// Where Orca would cluster the filaments rather than weigh every grouping (k-medoids, not ported): of every
/// assignment, the first that flushes least between each pair of filaments on a nozzle, each filament kept off the
/// extruder that can't print it and the master extruder preferred to take at least half of them.
fn pair_group(used: &[usize], flush: &Flush, k: usize, master: usize, banned: &[Option<usize>]) -> Vec<usize> {
    let total = (k as u64).pow(used.len() as u32);
    let mut best: Option<(f64, u64)> = None;
    let mut labels = vec![0; used.len()];
    for mask in 0..total {
        let mut num = mask;
        for l in &mut labels {
            *l = (num % k as u64) as usize;
            num /= k as u64;
        }
        let mut cost = 0.0;
        for (a, &fa) in used.iter().enumerate() {
            for (b, &fb) in used.iter().enumerate() {
                if a != b && labels[a] == labels[b] {
                    cost += flush.volume(labels[a], fa, fb);
                }
            }
        }
        if labels.iter().filter(|&&l| l == master).count() < used.len().div_ceil(2) {
            cost += 1e-3;
        }
        cost += 1e9 * labels.iter().zip(banned).filter(|(l, b)| **b == Some(**l)).count() as f64;
        if best.is_none_or(|(c, _)| cost < c) {
            best = Some((cost, mask));
        }
    }
    let mut num = best.map_or(0, |b| b.1);
    used.iter()
        .map(|_| {
            let l = (num % k as u64) as usize;
            num /= k as u64;
            l
        })
        .collect()
}

/// How much a change of filament flushes, mm³, per extruder: Orca's volume for the colours times the extruder's
/// flush multiplier.
#[derive(Clone, Debug, Default)]
pub struct Flush {
    /// [extruder][from][to], before the multiplier.
    pub volumes: Vec<Vec<Vec<f64>>>,
    /// Each extruder's flush multiplier.
    pub multipliers: Vec<f64>,
}

/// Orca's least flush it writes for a change that flushes at all (`g_min_purge_volume`).
pub const MIN_PURGE_VOLUME: f64 = 100.0;

impl Flush {
    fn raw(&self, extruder: usize, from: usize, to: usize) -> f64 {
        self.volumes.get(extruder).and_then(|m| m.get(from)).and_then(|r| r.get(to)).copied().unwrap_or(0.0)
    }

    fn multiplier(&self, extruder: usize) -> f64 {
        self.multipliers.get(extruder).copied().unwrap_or(1.0)
    }

    /// What Orca's tool ordering weighs a change by: the volume times the multiplier, kept in single precision.
    pub fn volume(&self, extruder: usize, from: usize, to: usize) -> f64 {
        f64::from((self.raw(extruder, from, to) * self.multiplier(extruder)) as f32)
    }

    /// What Orca's tower plans to flush for a change: the same product, taken in single precision.
    pub fn purge(&self, extruder: usize, from: usize, to: usize) -> f32 {
        self.raw(extruder, from, to) as f32 * self.multiplier(extruder) as f32
    }

    /// The volumes for `palette`'s colours, as Orca's command line works them out when the project gives none.
    pub fn of(palette: &Palette) -> Flush {
        let p = &palette.profiles[0];
        let k = extruders(p);
        let n = palette.colours.len();
        // The presets give one multiplier; Orca's command line pads the list with 1 for the other extruders.
        let multipliers: Vec<f64> = {
            let mut m: Vec<f64> = p.list("flush_multiplier").iter().filter_map(|v| v.parse().ok()).collect();
            if m.is_empty() {
                m.push(0.3);
            }
            m.resize(k, 1.0);
            m
        };
        // Orca's command line names each extruder's variant by its type and the config's `nozzle_volume_type`,
        // which the presets leave at its default of one value: it reads the second extruder's past the end, finds
        // no variant for it and takes the dataset from before the start of the list, which comes to 0, the
        // single-nozzle table (seen in native Orca 2.5's matrices).
        let volume_types = p.list("nozzle_volume_type");
        let volume_types = if volume_types.is_empty() { vec!["Standard"] } else { volume_types };
        let datasets: Vec<i32> = (0..k)
            .map(|e| {
                let Some(volume) = volume_types.get(e) else { return 0 };
                let kind = p.list("extruder_type").get(e).copied().unwrap_or("Direct Drive");
                let volume = if *volume == "Hybrid" { "Standard" } else { volume };
                let (index, _) = variant_index(&p.machine, "printer_extruder_variant", &format!("{kind} {volume}"));
                p.list("nozzle_flush_dataset").get(index).and_then(|v| v.parse().ok()).unwrap_or(0)
            })
            .collect();
        // The least flush is the nozzle's volume (Orca's `get_min_flush_volumes`, without a long retraction when
        // cutting, which the X2D's presets leave off).
        let min_flush: Vec<i32> = (0..k).map(|e| nozzle_volume(p, e) as i32).collect();
        let rgb: Vec<[u8; 4]> = palette.colours.iter().map(|c| parse_colour(c)).collect();
        let volumes = (0..k)
            .map(|e| {
                (0..n)
                    .map(|from| {
                        (0..n)
                            .map(|to| {
                                if from == to {
                                    return 0.0;
                                }
                                let (a, b) = (rgb[from], rgb[to]);
                                f64::from(calc_flush_vol(a, b, min_flush[e], datasets[e]))
                            })
                            .collect()
                    })
                    .collect()
            })
            .collect();
        Flush { volumes, multipliers }
    }
}

/// "#RRGGBB" or "#RRGGBBAA" as RGBA.
fn parse_colour(c: &str) -> [u8; 4] {
    let hex = c.trim_start_matches('#');
    let byte = |i: usize| hex.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok());
    match (byte(0), byte(2), byte(4)) {
        (Some(r), Some(g), Some(b)) => [r, g, b, byte(6).unwrap_or(255)],
        _ => [0, 0, 0, 255],
    }
}

const MAX_FLUSH_VOLUME: i32 = 20000;

/// `FlushVolCalculator::calc_flush_vol`: the measured table's volume for the nearest colours in it when there is one,
/// else the estimate from hue, saturation and luminance.
fn calc_flush_vol(src: [u8; 4], dst: [u8; 4], min: i32, dataset: i32) -> i32 {
    let white = |c: [u8; 4]| if c[3] == 0 { [255, 255, 255] } else { [c[0], c[1], c[2]] };
    let (s, d) = (white(src), white(dst));
    if dataset != 0
        && let Some(v) = predict(s, d, dataset)
    {
        return (v as i32).min(MAX_FLUSH_VOLUME);
    }
    let mut flush = calc_flush_vol_rgb(s, d, min, dataset) as f32;
    let lum = |c: [u8; 3]| c[0] as f32 * 0.3 + c[1] as f32 * 0.59 + c[2] as f32 * 0.11;
    // Orca compares the luminance of 0–255 values with thresholds for 0–1 ones: never true together.
    let from_dark = lum(s) > 180.0 / 255.0;
    let to_light = lum(d) < 75.0 / 255.0;
    if dataset != 0 && from_dark && to_light {
        flush *= 1.3;
    }
    flush += min as f32;
    (flush as i32).min(MAX_FLUSH_VOLUME)
}

fn calc_flush_vol_rgb(s: [u8; 3], d: [u8; 3], _min: i32, dataset: i32) -> i32 {
    if dataset == 0
        && let Some(v) = predict(s, d, 0)
    {
        return v as i32;
    }
    let f = |c: [u8; 3]| [c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0];
    let (a, b) = (f(s), f(d));
    let (h1, s1, v1) = rgb_to_hsv(a);
    let (h2, s2, v2) = rgb_to_hsv(b);
    let mut hs_dist = delta_hs(h1, s1, v1, h2, s2, v2);
    let lum = |c: [f32; 3]| c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    let (from_lumi, to_lumi) = (lum(a), lum(b));
    let lumi_flush = if to_lumi >= from_lumi {
        (to_lumi - from_lumi).powf(0.7) * 560.0
    } else {
        let inter = 0.67 * v2 + 0.33 * v1;
        hs_dist = inter.min(hs_dist);
        (from_lumi - to_lumi) * 80.0
    };
    let hs_flush = 230.0 * hs_dist;
    let third = (hs_flush * hs_flush + lumi_flush * lumi_flush
        - 2.0 * hs_flush * lumi_flush * (120.0f32 / 180.0 * std::f32::consts::PI).cos())
    .sqrt();
    third.max(60.0) as i32
}

fn delta_hs(h1: f32, s1: f32, v1: f32, h2: f32, s2: f32, v2: f32) -> f32 {
    let (r1, r2) = (h1 / 180.0 * std::f32::consts::PI, h2 / 180.0 * std::f32::consts::PI);
    let dx = r1.cos() * s1 * v1 - r2.cos() * s2 * v2;
    let dy = r1.sin() * s1 * v1 - r2.sin() * s2 * v2;
    (dx * dx + dy * dy).sqrt().min(1.2)
}

/// Hue in degrees, saturation and value in 0–1 (Orca's `RGB2HSV`).
fn rgb_to_hsv(c: [f32; 3]) -> (f32, f32, f32) {
    let max = c[0].max(c[1]).max(c[2]);
    let min = c[0].min(c[1]).min(c[2]);
    let delta = max - min;
    let v = max;
    let s = if max > 0.0 { delta / max } else { 0.0 };
    let mut h = if delta == 0.0 {
        0.0
    } else if max == c[0] {
        60.0 * (((c[1] - c[2]) / delta) % 6.0)
    } else if max == c[1] {
        60.0 * ((c[2] - c[0]) / delta + 2.0)
    } else {
        60.0 * ((c[0] - c[1]) / delta + 4.0)
    };
    if h < 0.0 {
        h += 360.0;
    }
    (h, s, v)
}

const FLUSH_STANDARD: &str = include_str!("../profiles/x2d/flush_data_standard.txt");
const FLUSH_DUAL_STANDARD: &str = include_str!("../profiles/x2d/flush_data_dual_standard.txt");
const FLUSH_DUAL_HIGHFLOW: &str = include_str!("../profiles/x2d/flush_data_dual_highflow.txt");

/// A measured flush table: its colours and the volume for each pair.
struct Table {
    colours: Vec<[u8; 3]>,
    volumes: std::collections::HashMap<([u8; 3], [u8; 3]), f32>,
}

fn hex3(s: &str) -> Option<[u8; 3]> {
    let c = parse_colour(s);
    (s.len() == 7 && s.starts_with('#')).then_some([c[0], c[1], c[2]])
}

fn table(dataset: i32) -> Option<&'static Table> {
    use std::sync::OnceLock;
    static TABLES: [OnceLock<Option<Table>>; 3] = [OnceLock::new(), OnceLock::new(), OnceLock::new()];
    let (slot, text) = match dataset {
        0 => (&TABLES[0], FLUSH_STANDARD),
        1 => (&TABLES[1], FLUSH_DUAL_STANDARD),
        2 => (&TABLES[2], FLUSH_DUAL_HIGHFLOW),
        _ => return None,
    };
    slot.get_or_init(|| {
        let mut lines = text.lines();
        lines.next()?;
        let colours: Vec<[u8; 3]> = lines.next()?.split_whitespace().map(hex3).collect::<Option<_>>()?;
        lines.next()?;
        let mut volumes = std::collections::HashMap::new();
        for line in lines {
            let mut w = line.split_whitespace();
            let (Some(a), Some(b), Some(v)) = (w.next(), w.next(), w.next()) else { continue };
            volumes.insert((hex3(a)?, hex3(b)?), v.parse().ok()?);
        }
        Some(Table { colours, volumes })
    })
    .as_ref()
}

/// `FlushVolPredictor::predict`: the table's volume for its first colours within a ΔE00 of 5 of `from` and `to`.
fn predict(from: [u8; 3], to: [u8; 3], dataset: i32) -> Option<f32> {
    let t = table(dataset)?;
    let near = |c: [u8; 3]| t.colours.iter().copied().find(|&k| colour_distance(k, c) <= 5.0);
    let (a, b) = (near(from)?, near(to)?);
    t.volumes.get(&(a, b)).copied()
}

fn lab(c: [u8; 3]) -> [f64; 3] {
    let gamma = |x: f64| if x > 0.04045 { ((x + 0.055) / 1.055).powf(2.4) } else { x / 12.92 };
    let r = gamma(c[0] as f64 / 255.0) * 100.0;
    let g = gamma(c[1] as f64 / 255.0) * 100.0;
    let b = gamma(c[2] as f64 / 255.0) * 100.0;
    let x = 0.412453 * r + 0.357580 * g + 0.180423 * b;
    let y = 0.212671 * r + 0.715160 * g + 0.072169 * b;
    let z = 0.019334 * r + 0.119193 * g + 0.950227 * b;
    let f = |t: f64| if t > 0.008856f32 as f64 { t.powf(1.0 / 3.0) } else { 7.787 * t + 0.137931 };
    let (xn, yn, zn) = (f(x / 95.0489), f(y / 100.0), f(z / 108.8840));
    [116.0 * yn - 16.0, 500.0 * (xn - yn), 200.0 * (yn - zn)]
}

/// CIEDE2000 colour difference (`FlushPredict::calc_color_distance`).
fn colour_distance(c1: [u8; 3], c2: [u8; 3]) -> f32 {
    use std::f64::consts::PI;
    let (l1, l2) = (lab(c1), lab(c2));
    let deg = |d: f64| d * PI / 180.0;
    let p25_7 = 25f64.powi(7);
    let ca = (l1[1] * l1[1] + l1[2] * l1[2]).sqrt();
    let cb = (l2[1] * l2[1] + l2[2] * l2[2]).sqrt();
    let cmean7 = ((ca + cb) / 2.0).powi(7);
    let g = 0.5 * (1.0 - (cmean7 / (cmean7 + p25_7)).sqrt());
    let (a1, a2) = ((1.0 + g) * l1[1], (1.0 + g) * l2[1]);
    let (b1, b2) = (l1[2], l2[2]);
    let (c1p, c2p) = ((a1 * a1 + b1 * b1).sqrt(), (a2 * a2 + b2 * b2).sqrt());
    let hue = |a: f64, b: f64| {
        if a == 0.0 && b == 0.0 {
            0.0
        } else {
            let h = b.atan2(a);
            if h < 0.0 { h + 2.0 * PI } else { h }
        }
    };
    let (h1, h2) = (hue(a1, b1), hue(a2, b2));
    let dl = l2[0] - l1[0];
    let dc = c2p - c1p;
    let dh = if c1p * c2p == 0.0 {
        0.0
    } else {
        let mut d = h2 - h1;
        if d < -PI {
            d += 2.0 * PI;
        } else if d > PI {
            d -= 2.0 * PI;
        }
        2.0 * (c1p * c2p).sqrt() * (d / 2.0).sin()
    };
    let lmean = (l1[0] + l2[0]) / 2.0;
    let cmean = (c1p + c2p) / 2.0;
    let hsum = h1 + h2;
    let hmean = if c1p * c2p == 0.0 {
        hsum
    } else if (h1 - h2).abs() <= PI {
        hsum / 2.0
    } else if hsum < 2.0 * PI {
        (hsum + 2.0 * PI) / 2.0
    } else {
        (hsum - 2.0 * PI) / 2.0
    };
    let t = 1.0 - 0.17 * (hmean - deg(30.0)).cos() + 0.24 * (2.0 * hmean).cos() + 0.32 * (3.0 * hmean + deg(6.0)).cos()
        - 0.2 * (4.0 * hmean - deg(63.0)).cos();
    let dtheta = deg(30.0) * (-((hmean - deg(275.0)) / deg(25.0)).powi(2)).exp();
    let cm7 = cmean.powi(7);
    let rc = 2.0 * (cm7 / (cm7 + p25_7)).sqrt();
    let lm2 = (lmean - 50.0).powi(2);
    let sl = 1.0 + 0.015 * lm2 / (20.0 + lm2).sqrt();
    let sc = 1.0 + 0.045 * cmean;
    let sh = 1.0 + 0.015 * cmean * t;
    let rt = -(2.0 * dtheta).sin() * rc;
    let de = ((dl / sl).powi(2) + (dc / sc).powi(2) + (dh / sh).powi(2) + rt * (dc / sc) * (dh / sh)).sqrt();
    de as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn palette(colours: &[&str]) -> Palette {
        let p = crate::profile::x2d();
        Palette {
            profiles: colours.iter().map(|_| p.clone()).collect(),
            colours: colours.iter().map(|c| c.to_string()).collect(),
            manual_map: None,
            place_tower: false,
        }
    }

    #[test]
    fn two_filaments_each_get_a_nozzle_the_first_the_right_one() {
        let pal = palette(&["#F2754E", "#4F7FC7"]);
        let flush = Flush::of(&pal);
        let layers = vec![vec![0, 1]; 10];
        assert_eq!(group(&pal, &layers, &[0, 1], &flush, &[vec![], vec![]]), vec![1, 0]);
        // Unless the right nozzle can't print the first: then they swap.
        assert_eq!(group(&pal, &layers, &[0, 1], &flush, &[vec![], vec![0]]), vec![0, 1]);
    }

    #[test]
    fn the_right_nozzle_flushes_by_the_single_nozzle_table() {
        // Native Orca 2.5 on the X2D, green to grey and back: the left nozzle by the dual nozzle table (330 and 210
        // mm³, before its 0.3), the right one by the single nozzle table, where Orca's command line ends up for it
        // (206 and 56 mm³ measured, plus the nozzle's 92).
        let pal = palette(&["#00AE42", "#8E9089"]);
        let flush = Flush::of(&pal);
        assert_eq!((flush.raw(0, 0, 1), flush.raw(0, 1, 0)), (330.0, 210.0));
        assert_eq!((flush.raw(1, 0, 1), flush.raw(1, 1, 0)), (298.0, 148.0));
    }

    #[test]
    fn a_filament_whose_object_the_right_nozzle_cant_reach_stays_left() {
        let pal = palette(&["#F2754E", "#4F7FC7", "#FFFFFF"]);
        // The right nozzle prints from x = 20.5 mm and up to 256 mm high.
        let objects = [
            (0, [20.0, 20.0, 35.0, 35.0], 10.0),
            (1, [50.0, 20.0, 65.0, 35.0], 10.0),
            (2, [80.0, 20.0, 95.0, 35.0], 258.0),
        ];
        assert_eq!(unprintable(&pal, &[0, 1, 2], &objects), vec![vec![], vec![0, 2]]);
        // Touching the edge is no reach past it.
        assert_eq!(unprintable(&pal, &[0], &[(0, [20.5, 20.0, 35.0, 35.0], 10.0)]), vec![vec![], vec![]]);
    }

    #[test]
    fn a_filament_on_the_right_nozzle_prints_with_its_bowden_values() {
        let p = crate::profile::x2d();
        let right = for_extruder(&p, 1);
        assert_eq!(right.float_at("outer_wall_speed", 0), 50.0);
        assert_eq!(right.float_at("filament_retraction_length", 0), 3.0);
        assert_eq!(right.float_at("retraction_speed", 0), 20.0);
        let left = for_extruder(&p, 0);
        assert_eq!(left.float_at("outer_wall_speed", 0), 200.0);
        assert_eq!(left.float_at("filament_retraction_length", 0), 0.4);
    }

    #[test]
    fn flush_volumes_are_orcas_for_the_stand_in_orange_and_blue() {
        // Native Orca 2.5 on the X2D: 289 mm³ from orange to blue and 423 back, before the multiplier (0.3 on the
        // left nozzle, 1 on the right).
        let pal = palette(&["#F2754E", "#4F7FC7"]);
        let flush = Flush::of(&pal);
        assert!((flush.volume(1, 0, 1) - 289.0).abs() < 1e-9, "{:?}", flush.volumes);
        assert!((flush.volume(1, 1, 0) - 423.0).abs() < 1e-9);
        assert_eq!(flush.volume(0, 1, 0), f64::from(126.9f32));
        assert_eq!(flush.purge(0, 1, 0), 423.0f32 * 0.3f32);
    }
}
