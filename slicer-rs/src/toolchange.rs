//! Printing in several filaments as OrcaSlicer 2.5 does on the X2D: the order the filaments print in on each layer,
//! the prime tower (`wipe_tower.rs`) planned and generated from it, and each visit to the tower as Orca's G-code
//! writer makes it (`WipeTowerIntegration::append_tcr`): the old filament retracted, rammed out over the tower when
//! it leaves its nozzle, the printer's change G-code filled in, the travel round the tower to the gap in its wall,
//! the new filament primed on the tower, and the tower's wall and sparse layers where they fall.
//!
//! - **Order** (`ToolOrdering`): the first layer prints the filament with the largest smallest island first; later
//!   layers start on the nozzle that ended the layer before, each nozzle's filaments in the order that flushes least
//!   (looking a layer ahead, as Orca does for up to five), then the other nozzle's.
//! - **The tower** stands on every layer up to the last that changes filament; each change primes the new filament
//!   with its `filament_prime_volume`.
//! - **Flushing** happens in the printer, not on the tower: the change G-code's `M620.10 … L<mm>` and `SYNC T<s>`
//!   carry Orca's flush volume (`filaments::Flush`), at least 100 mm³.
//!
//! What a visit writes is a list of `Step`s that `gcode.rs` carries out: its own moves (retractions with their wipes,
//! lifts, travels) the way it writes every other one, and the tower's and the printer's G-code as text, timed as
//! Orca's estimator times it (a change of extruder 5 s, loading a filament into a nozzle 29 s, unloading one 29 s).

use crate::bambu::Frame;
use crate::config::{Settings, Value};
use crate::filaments::{self, Flush, MIN_PURGE_VOLUME, Palette};
use crate::template::Vars;
use crate::wipe_tower::{self, Piece, V, WipeTower};
use std::sync::Arc;

/// Something a visit to the tower does, in order.
#[derive(Clone, Debug)]
pub enum Step {
    /// G-code written as it is (`Text`).
    Text(Box<Text>),
    /// Pull the filament back (by its retraction length, or by `length`), wiping along `wipe` (mm on the plate; the
    /// last path printed when None) at the speed the last path printed, then lift when `lift`.
    Retract { length: Option<f64>, wipe: Option<Vec<[f64; 2]>>, lift: bool },
    /// Travel to (`x`, `y`): lifting first when `lift` (and not lifted yet), down to the layer after when `lower`.
    Travel { x: f64, y: f64, lift: bool, lower: bool },
    /// Down to the layer and push the filament back.
    Ready,
    /// The end of the last object's labels (Orca ends them after the tool change's retraction).
    EndLabels,
    /// Filament `filament` from here on, with `prior` mm of it already pulled back (from its last change).
    Use { filament: usize, prior: f64 },
}

/// G-code a visit writes as it is, and what it costs.
#[derive(Clone, Debug, Default)]
pub struct Text {
    pub text: String,
    /// Seconds, as Orca's estimator has them.
    pub secs: f64,
    /// Seconds of it extruding.
    pub extruding: f64,
    /// Where it leaves the nozzle (None: where it found it).
    pub end: Option<[f64; 3]>,
    /// The acceleration it leaves set, if it sets one.
    pub accel: Option<f64>,
    /// The filament its extrusions are, and how much: mm of filament, mm³ on the tower.
    pub filament: usize,
    pub mm: f64,
    pub volume: f64,
    /// mm travelled.
    pub travel: f64,
}

/// A visit to the prime tower between a layer's paths.
#[derive(Clone, Debug)]
pub struct Visit {
    /// The path it comes before (the layer's path count: after the last).
    pub at: usize,
    pub from: usize,
    pub to: usize,
    pub steps: Vec<Step>,
}

impl Visit {
    /// Where the visit's first travel goes.
    pub fn first_point(&self) -> Option<[f64; 2]> {
        self.steps.iter().find_map(|s| match s {
            Step::Travel { x, y, .. } => Some([*x, *y]),
            _ => None,
        })
    }
}

/// The plate's filaments and their tool changes, for the whole print.
pub struct Colours {
    /// Each filament's settings for the nozzle it prints with.
    pub settings: Vec<Settings>,
    /// Each filament's extruder (0: the left, direct-drive one).
    pub extruder_of: Vec<usize>,
    pub flush: Flush,
    /// Each G-code layer's filaments, in the order they print.
    pub orders: Vec<Vec<usize>>,
    /// Each G-code layer's pieces of tower G-code (none where the tower has ended).
    pieces: Vec<Vec<Piece>>,
    /// Each G-code layer's tool changes before it.
    changes_before: Vec<usize>,
    /// Each layer's filament when it starts.
    starts: Vec<usize>,
    /// The first filament printed, and the extruder the timelapse camera follows (`most_used_extruder`).
    pub first: usize,
    pub most_used_extruder: usize,
    /// Where the tower's frame sits on the plate (its position and rib offset), and its first layer's extent in that
    /// frame (with the brim): what travels go round.
    origin: V,
    bbx: [f32; 4],
    /// The tower's size: width, depth, brim width and height.
    pub tower: [f64; 4],
    /// The points of the tower's first layer on the plate that Orca adds to the first layer's hull, which the bed's
    /// probing covers (`first_layer_wipe_tower_corners`).
    pub first_layer_corners: Vec<[f64; 2]>,
    /// mm³ flushed into each filament (by the printer, at its changes).
    pub flushed: Vec<f64>,
    /// How many tool changes the print makes.
    pub changes: usize,
    /// Each object's filament.
    pub object_filament: Vec<usize>,
    /// The printer's numbering of the extruders (`physical_extruder_map`).
    physical: Vec<i64>,
    /// The presets as given (every extruder's values), and how many extruders the printer has.
    base: Arc<crate::profile::Profile>,
    extruders: usize,
    /// Each filament's first layer and its place in the layer's order: a change into a nozzle the first time loads it.
    first_use: Vec<Option<usize>>,
    /// Tool changes, in order: (layer, from, to), with the flush volume into the new filament.
    flushes: Vec<(usize, usize, usize, f64)>,
}

/// What `prepare` needs to know of the plate.
pub struct Plate<'a> {
    /// Each object's filament (0-based).
    pub object_filament: &'a [usize],
    /// Each G-code layer's objects that print anything on it.
    pub layer_objects: &'a [Vec<usize>],
    /// Each G-code layer's top and height.
    pub layer_z: &'a [f64],
    pub layer_h: &'a [f64],
    /// Each object's smallest island on its first layer (mm²), which orders the first layer.
    pub first_island: &'a [f64],
    /// Each object's extent on the plate (min x, min y, max x, max y), where the tower must keep clear of.
    pub object_boxes: &'a [[f64; 4]],
}

/// Where the app puts the prime tower when nothing says (`towerSpot` in slice-worker.ts): the first corner of the
/// plate, back right first, that no object comes within 5 mm of, 10 mm in from the edges.
pub fn tower_spot(boxes: &[[f64; 4]], bed: [f64; 2], width: f64) -> [f64; 2] {
    let (depth, margin) = (50.0, 10.0);
    let corners = [
        [bed[0] - width - margin, bed[1] - depth - margin],
        [margin, bed[1] - depth - margin],
        [bed[0] - width - margin, margin],
        [margin, margin],
    ];
    let clear = |c: &[f64; 2]| {
        boxes
            .iter()
            .all(|b| b[2] + 5.0 < c[0] || b[0] - 5.0 > c[0] + width || b[3] + 5.0 < c[1] || b[1] - 5.0 > c[1] + depth)
    };
    let spot = corners.iter().find(|c| clear(c)).unwrap_or(&corners[0]);
    [spot[0].round(), spot[1].round()]
}

fn list_f(p: &crate::profile::Profile, key: &str, i: usize) -> f64 {
    let l = p.list(key);
    l.get(i).or(l.first()).and_then(|v| v.trim_end_matches('%').parse().ok()).unwrap_or(0.0)
}

impl Colours {
    /// Plans the filaments' order and the tower for the plate, as Orca does before it writes any layer.
    pub fn prepare(settings: &Settings, palette: &Arc<Palette>, plate: &Plate) -> Colours {
        let n = palette.profiles.len();
        let layers = plate.layer_objects.len();
        let object_filament: Vec<usize> = plate.object_filament.iter().map(|&f| f.min(n - 1)).collect();
        // The filaments each layer uses, ascending.
        let layer_filaments: Vec<Vec<usize>> = plate
            .layer_objects
            .iter()
            .map(|objects| {
                let mut f: Vec<usize> = objects.iter().map(|&o| object_filament[o]).collect();
                f.sort_unstable();
                f.dedup();
                f
            })
            .collect();
        let mut used: Vec<usize> = layer_filaments.iter().flatten().copied().collect();
        used.sort_unstable();
        used.dedup();
        let flush = Flush::of(palette);
        let extruder_of = filaments::group(palette, &used, &flush);
        let per_filament = filaments::settings_for(palette, &extruder_of);
        let k = filaments::extruders(&palette.profiles[0]);

        // The first layer: the filament whose smallest island is largest first.
        let mut first_order: Vec<usize> = Vec::new();
        if let Some(first) = layer_filaments.first() {
            let mut min_area: Vec<(usize, f64)> = Vec::new();
            for &f in first {
                let area = (0..object_filament.len())
                    .filter(|&o| object_filament[o] == f && plate.layer_objects[0].contains(&o))
                    .map(|o| plate.first_island.get(o).copied().unwrap_or(0.0))
                    .fold(f64::INFINITY, f64::min);
                min_area.push((f, area));
            }
            for &(f, area) in &min_area {
                let at = first_order
                    .iter()
                    .position(|g| min_area.iter().find(|m| m.0 == *g).is_some_and(|m| m.1 < area))
                    .unwrap_or(first_order.len());
                first_order.insert(at, f);
            }
        }
        let orders = order_layers(&layer_filaments, &first_order, &extruder_of, &flush, k);
        let first = orders.iter().find_map(|o| o.first().copied()).unwrap_or(0);

        // The tower stands up to the last layer that changes filament.
        let mut partitions = vec![0usize; layers];
        let mut last: Option<usize> = None;
        for (g, order) in orders.iter().enumerate() {
            if order.is_empty() {
                continue;
            }
            partitions[g] = order.len() - usize::from(last.is_none_or(|l| l == order[0]));
            last = order.last().copied();
        }
        for g in (0..layers.saturating_sub(1)).rev() {
            partitions[g] = partitions[g].max(partitions[g + 1]);
        }
        let has_tower: Vec<bool> = partitions.iter().map(|&p| p > 0).collect();

        let p0 = &settings.profile;
        let mut params = tower_params(settings, &per_filament, &extruder_of);
        if palette.place_tower {
            let spot = tower_spot(plate.object_boxes, settings.bed, params.width as f64);
            params.position = [spot[0] as f32, spot[1] as f32];
        }
        let filpar: Vec<wipe_tower::Filament> =
            per_filament.iter().zip(&palette.profiles).map(|(s, p)| tower_filament(s, p)).collect();
        params.extruder_of = extruder_of.clone();
        let height = plate.layer_z.last().copied().unwrap_or(0.0) as f32;
        let tower_rotation = params.rotation_angle as f64;
        let mut tower = WipeTower::new(params, filpar, first, height);
        let mut current = first;
        // The filament in each nozzle, for flushing.
        let mut in_nozzle: Vec<Option<usize>> = vec![None; k];
        in_nozzle[extruder_of[first]] = Some(first);
        let mut flushes = Vec::new();
        let mut flushed = vec![0.0; n];
        let mut changes = 0;
        let mut starts = vec![first; layers];
        let mut changes_before = vec![0; layers];
        let mut first_use = vec![None; n];
        for (g, order) in orders.iter().enumerate() {
            starts[g] = current;
            changes_before[g] = changes;
            for &f in order {
                first_use[f].get_or_insert(g);
            }
            if !has_tower[g] {
                // Above the tower each layer still changes filament where it must (none do, by the tower's rule).
                if let Some(&l) = order.last() {
                    current = l;
                }
                continue;
            }
            let (z, h) = (plate.layer_z[g] as f32, plate.layer_h[g] as f32);
            tower.plan_toolchange(z, h, current, current, 0.0, 0.0, 0.0);
            for &f in order {
                if f == current {
                    continue;
                }
                let e = extruder_of[f];
                let mut purge = 0.0;
                if let Some(prev) = in_nozzle[e]
                    && prev != f
                {
                    purge = flush.volume(e, prev, f);
                }
                in_nozzle[e] = Some(f);
                let grab = list_f(p0, "grab_length", e) * 2.4;
                let purge = (purge - grab).max(0.0);
                let pv = |key: &str| list_f(&palette.profiles[f], key, 0) as f32;
                tower.plan_toolchange(
                    z,
                    h,
                    current,
                    f,
                    pv("filament_prime_volume"),
                    pv("filament_prime_volume_nc"),
                    purge as f32,
                );
                let written = if purge < 1e-4 { 0.0 } else { purge.max(MIN_PURGE_VOLUME) };
                flushed[f] += written;
                flushes.push((g, current, f, written));
                changes += 1;
                current = f;
            }
            if g + 1 < layers && !has_tower[g + 1] {
                // Orca stops planning the tower once no layer above changes filament.
            }
        }
        let generated = tower.generate();
        let mut pieces: Vec<Vec<Piece>> = vec![Vec::new(); layers];
        let mut it = generated.into_iter();
        for g in 0..layers {
            if has_tower[g] {
                pieces[g] = it.next().unwrap_or_default();
            }
        }
        // The extruder the camera follows: the one used on most layers (the later one on a tie).
        let mut count = vec![0usize; k];
        for order in &orders {
            let mut seen = vec![false; k];
            for &f in order {
                seen[extruder_of[f]] = true;
            }
            for (e, s) in seen.iter().enumerate() {
                count[e] += usize::from(*s);
            }
        }
        let mut most_used_extruder = 0;
        for e in 1..k {
            if count[e] >= count[most_used_extruder] {
                most_used_extruder = e;
            }
        }
        let origin = tower.position() + tower.rib_offset();
        let physical: Vec<i64> = p0.list("physical_extruder_map").iter().filter_map(|v| v.parse().ok()).collect();
        let tower_size = [tower.width() as f64, tower.depth() as f64, tower.brim_width_printed() as f64, height as f64];
        let first_layer_corners = {
            let (b, rib) = (tower.bbx().map(f64::from), tower.rib_offset());
            let (w, d) = (b[2] - b[0], b[3] - b[1]);
            let p0 = [b[0] + rib.x as f64, b[1] + rib.y as f64];
            let mut pts = vec![p0, [p0[0] + w, p0[1]], [p0[0] + w, p0[1] + d], [p0[0], p0[1] + d]];
            // Round the middle at the brim's width (a tower with no cone).
            let centre = [p0[0] + w / 2.0, p0[1] + d / 2.0];
            let r = tower.brim_width_printed() as f64;
            let mut alpha = 0.0f64;
            while alpha < 2.0 * std::f64::consts::PI {
                pts.push([centre[0] + r * alpha.cos(), centre[1] + r * alpha.sin()]);
                alpha += std::f64::consts::PI / 20.0;
            }
            let (sin, cos) = (tower_rotation.to_radians().sin(), tower_rotation.to_radians().cos());
            let at = tower.position();
            pts.iter().map(|p| [cos * p[0] - sin * p[1] + at.x as f64, sin * p[0] + cos * p[1] + at.y as f64]).collect()
        };
        Colours {
            settings: per_filament,
            extruder_of,
            flush,
            orders,
            pieces,
            changes_before,
            starts,
            first,
            most_used_extruder,
            origin,
            bbx: tower.bbx(),
            tower: tower_size,
            first_layer_corners,
            flushed,
            changes,
            object_filament,
            physical,
            first_use,
            flushes,
            base: settings.profile.clone(),
            extruders: k,
        }
    }

    /// The filament printing when G-code layer `g` starts.
    pub fn start(&self, g: usize) -> usize {
        self.starts.get(g).copied().unwrap_or(self.first)
    }

    /// Whether filament `f`'s extruder is the one the timelapse camera follows.
    pub fn photo_head(&self, f: usize) -> bool {
        self.extruder_of.get(f) == Some(&self.most_used_extruder)
    }

    /// mm on the plate of a point in the tower's frame.
    fn plate(&self, p: V) -> [f64; 2] {
        [(p.x + self.origin.x) as f64, (p.y + self.origin.y) as f64]
    }

    /// The layer's plans, one per filament in the layer's order (each with that filament's objects), as one: their
    /// paths in turn, with the tower visited where Orca visits it.
    pub fn combine(
        &self,
        g: usize,
        plans: Vec<(usize, crate::plan::LayerPlan)>,
        frame: &Frame,
    ) -> crate::plan::LayerPlan {
        let mut it = plans.into_iter();
        let Some((_, mut out)) = it.next() else { return crate::plan::LayerPlan::default() };
        let mut runs: Vec<(usize, usize)> = Vec::new(); // (filament, path index where it starts)
        let first_f = self.orders.get(g).and_then(|o| o.first().copied()).unwrap_or(0);
        runs.push((first_f, 0));
        for (f, plan) in it {
            runs.push((f, out.paths.len()));
            out.paths.extend(plan.paths);
            for (o, isl) in plan.support_islands {
                if !out.support_islands.iter().any(|(k, _)| *k == o) {
                    out.support_islands.push((o, isl));
                }
            }
        }
        let pieces = &self.pieces[g];
        if pieces.is_empty() {
            return out;
        }
        let mut current = self.starts[g];
        let mut k = 0;
        let mut count = self.changes_before[g];
        let n = runs.len();
        for (i, &(f, at)) in runs.iter().enumerate() {
            let finish = i + 1 == n;
            if f == current && !finish {
                continue;
            }
            let Some(piece) = pieces.get(k) else { break };
            k += 1;
            let change = f != current;
            if change {
                count += 1;
            }
            let steps = self.visit_steps(g, &out, piece, current, f, count, frame);
            out.visits.push(Visit { at, from: current, to: f, steps });
            current = f;
        }
        out
    }

    /// The steps of a visit to the tower on layer `g` with `piece`, changing from filament `from` to `to` (or not, when
    /// they are the same), the print's `count`th tool change.
    #[allow(clippy::too_many_arguments)]
    fn visit_steps(
        &self,
        g: usize,
        plan: &crate::plan::LayerPlan,
        piece: &Piece,
        from: usize,
        to: usize,
        count: usize,
        frame: &Frame,
    ) -> Vec<Step> {
        let mut steps = Vec::new();
        let z = plan.z;
        let so = &self.settings[from];
        let sn = &self.settings[to];
        let text = self.translate(&piece.gcode, piece.start_pos, piece.tool_change_start_pos, piece.initial_tool);
        let (head, rest) = match text.find("[filament_end_gcode]") {
            Some(k) => (&text[..k], &text[k..]),
            None => (text.as_str(), ""),
        };
        let start = self.plate(piece.start_pos);
        if piece.is_finish_first {
            steps.push(Step::Retract { length: None, wipe: None, lift: true });
            steps.push(Step::Travel { x: start[0], y: start[1], lift: true, lower: true });
            steps.push(Step::Ready);
            steps.push(Step::Text(Box::new(timed(head, [start[0], start[1], z], from, so))));
        } else {
            steps.push(Step::Text(Box::new(timed(head, [start[0], start[1], z], from, so))));
        }
        if rest.is_empty() {
            steps.push(Step::Retract { length: None, wipe: Some(self.wipe(&piece.wipe_path)), lift: true });
            return steps;
        }
        let nozzle_change = !piece.nozzle_change.gcode.is_empty() && self.extruders > 1;
        let toolchange_length = list_f(&so.profile, "retract_length_toolchange", 0);
        // [filament_end_gcode]: the old filament out.
        steps.push(Step::Retract {
            length: (piece.is_tool_change && !nozzle_change).then_some(toolchange_length),
            wipe: None,
            lift: true,
        });
        steps.push(Step::EndLabels);
        if nozzle_change {
            let nc = &piece.nozzle_change;
            let s = self.plate(nc.start_pos);
            steps.push(Step::Travel { x: s[0], y: s[1], lift: true, lower: true });
            steps.push(Step::Ready);
            let ram = self.translate_plain(&nc.gcode, nc.start_pos);
            steps.push(Step::Text(Box::new(timed(&ram, [s[0], s[1], z], from, so))));
            steps.push(Step::Retract {
                length: Some(toolchange_length),
                wipe: Some(self.wipe(&nc.wipe_path)),
                lift: true,
            });
        }
        let mut own = Vars::default();
        let layer_num = g as i64;
        own.int("filament_extruder_id", from as i64)
            .int("current_filament_id", from as i64)
            .int("current_nozzle_id", self.extruder_of[from] as i64)
            .int("layer_num", layer_num)
            .float("layer_z", z)
            .float("max_layer_z", z);
        let end_text = frame.process(so.profile.text("filament_end_gcode"), &own);
        let mut change = with_eol(end_text);
        // [change_filament_gcode]: the printer's own G-code for the change.
        let after = piece.tool_change_start_pos;
        let after_plate = self.plate(after);
        let changing = from != to;
        let purge = self.flushes.iter().find(|f| f.0 == g && f.1 == from && f.2 == to).map_or(0.0, |f| f.3);
        let mut tool_secs = 0.0;
        if changing {
            let vars = self.change_vars(g, z, from, to, count, after_plate, purge, piece.is_contact, frame);
            let filled = frame.process(sn.profile.text("change_filament_gcode"), &vars);
            change += &with_eol(filled);
            change += ";_FORCE_RESUME_FAN_SPEED\n";
            // The printer's time for the change itself: a change of extruder, and loading the new filament into its
            // nozzle (unloading the one in it first) when the nozzle doesn't hold it.
            let (eo, en) = (self.extruder_of[from], self.extruder_of[to]);
            if eo != en {
                tool_secs += so.profile.float("machine_tool_change_time");
            }
            let held = self.in_nozzle_before(g, en, from, to);
            if held != Some(to) {
                if held.is_some() {
                    tool_secs += so.profile.float("machine_unload_filament_time");
                }
                tool_secs += so.profile.float("machine_load_filament_time");
            }
        }
        let last = self.last_position(&change, [after_plate[0], after_plate[1], z + 3.0]);
        let mut t = timed(&change, last.1, to, sn);
        t.secs += tool_secs;
        t.end = Some(last.0);
        steps.push(Step::Text(Box::new(t)));
        if changing {
            let prior = if self.first_use[to].is_some_and(|f| f < g) || self.used_before(g, to) {
                list_f(&self.settings[to].profile, "retract_length_toolchange", 0)
            } else {
                0.0
            };
            steps.push(Step::Use { filament: to, prior });
        }
        // The travel to where the purge starts: round the tower to the gap in its wall, when the wall has gaps.
        let gaps =
            sn.profile.bool("prime_tower_skip_points") && !(nozzle_change && !piece.nozzle_change.is_extruder_change);
        if changing && gaps {
            let route = self.route(last.0, after_plate, frame);
            for (i, p) in route.iter().enumerate().take(route.len().saturating_sub(1)) {
                if i == 0 {
                    steps.push(Step::Retract { length: None, wipe: None, lift: false });
                    steps.push(Step::Travel { x: p[0], y: p[1], lift: false, lower: true });
                } else {
                    let prev = route[i - 1];
                    let long = (p[0] - prev[0]).hypot(p[1] - prev[1]) >= sn.retract_min_travel;
                    steps.push(Step::Travel { x: p[0], y: p[1], lift: long, lower: false });
                }
            }
        }
        let mut own = Vars::default();
        own.int("filament_extruder_id", to as i64)
            .int("current_filament_id", to as i64)
            .int("current_nozzle_id", self.extruder_of[to] as i64)
            .int("layer_num", layer_num)
            .float("layer_z", z)
            .float("max_layer_z", z);
        let start_text = frame.process(sn.profile.text("filament_start_gcode"), &own);
        steps.push(Step::Text(Box::new(Text { text: with_eol(start_text), filament: to, ..Default::default() })));
        steps.push(Step::Travel { x: after_plate[0], y: after_plate[1], lift: true, lower: true });
        steps.push(Step::Ready);
        // [filament_start_gcode] is the last placeholder: the purge, the end of the change and any tower after it.
        let tail = match rest.find("[filament_start_gcode]") {
            Some(k) => {
                let after = &rest[k + "[filament_start_gcode]".len()..];
                after.strip_prefix('\n').unwrap_or(after)
            }
            None => "",
        };
        steps.push(Step::Text(Box::new(timed(tail, [after_plate[0], after_plate[1], z], to, sn))));
        steps.push(Step::Retract { length: None, wipe: Some(self.wipe(&piece.wipe_path)), lift: true });
        steps
    }

    /// Whether filament `f` printed before layer `g` (so its last change left it pulled back).
    fn used_before(&self, g: usize, f: usize) -> bool {
        self.orders[..g].iter().any(|o| o.contains(&f))
    }

    /// The filament the nozzle `e` holds when layer `g` changes from `from` to `to`.
    fn in_nozzle_before(&self, g: usize, e: usize, from: usize, to: usize) -> Option<usize> {
        let mut held: Option<usize> = (self.extruder_of[self.first] == e).then_some(self.first);
        for (layer, order) in self.orders.iter().enumerate().take(g + 1) {
            let mut current = self.starts[layer];
            for &f in order {
                if layer == g && current == from && f == to {
                    return held;
                }
                if self.extruder_of[f] == e {
                    held = Some(f);
                }
                current = f;
            }
        }
        held
    }

    /// The variables the X2D's change G-code reads (`append_tcr`).
    #[allow(clippy::too_many_arguments)]
    fn change_vars(
        &self,
        g: usize,
        z: f64,
        from: usize,
        to: usize,
        count: usize,
        after: [f64; 2],
        purge: f64,
        contact: bool,
        frame: &Frame,
    ) -> Vars {
        let (so, sn) = (&self.settings[from], &self.settings[to]);
        let first_layer = g == 0;
        let temp =
            |s: &Settings| if first_layer { s.first_layer_nozzle_temperature } else { s.nozzle_temperature } as i64;
        let area = std::f64::consts::PI / 4.0 * sn.filament_diameter * sn.filament_diameter;
        let purge_length = purge / area;
        let feed = |s: &Settings| match (60.0 * list_f(&s.profile, "filament_max_volumetric_speed", 0) / area) as i64 {
            0 => 100,
            f => f,
        };
        let mut cooling: Vec<f64> =
            self.settings.iter().map(|s| list_f(&s.profile, "filament_cooling_before_tower", 0)).collect();
        if contact || g == 0 {
            cooling.iter_mut().for_each(|c| *c = 0.0);
        }
        let interface_temp = match list_f(&sn.profile, "filament_tower_interface_print_temp", 0) as i64 {
            -1 => list_f(&sn.profile, "nozzle_temperature_range_high", 0) as i64,
            t => t,
        };
        // A box round the tower 3 mm out, its x where the printer may wait beside it.
        let (b0, b1) =
            (self.plate(V { x: self.bbx[0], y: self.bbx[1] }), self.plate(V { x: self.bbx[2], y: self.bbx[3] }));
        let avoid_x = {
            let (a, b) = (b1[0] + 3.0, b0[0] - 3.0);
            if a > 100.0 && a < 250.0 {
                a
            } else if b > 100.0 && b < 250.0 {
                b
            } else {
                110.0
            }
        };
        let mut v = Vars::default();
        let new_temp =
            if contact && so.profile.bool("enable_tower_interface_features") { interface_temp } else { temp(sn) };
        v.int("previous_extruder", from as i64)
            .int("next_extruder", to as i64)
            .int("current_hotend", -1)
            .int("next_hotend", -1)
            .int("current_nozzle_id", self.extruder_of[from] as i64)
            .int("next_nozzle_id", self.extruder_of[to] as i64)
            .int("current_filament_id", from as i64)
            .int("next_filament_id", to as i64)
            .int("layer_num", g as i64)
            .float("layer_z", z)
            .float("toolchange_z", z)
            .float("max_layer_z", z)
            .int("toolchange_count", count as i64)
            .int("fan_speed", 0)
            .float("old_retract_length", so.retract_length)
            .float("new_retract_length", sn.retract_length)
            .float("old_retract_length_toolchange", list_f(&so.profile, "retract_length_toolchange", 0))
            .float("new_retract_length_toolchange", list_f(&sn.profile, "retract_length_toolchange", 0))
            .int("old_filament_temp", temp(so))
            .int("new_filament_temp", new_temp)
            .float("x_after_toolchange", after[0])
            .float("y_after_toolchange", after[1])
            .float("z_after_toolchange", z + sn.z_hop)
            .float("first_flush_volume", purge_length / 2.0)
            .float("second_flush_volume", purge_length / 2.0)
            .int("old_filament_e_feedrate", feed(so))
            .int("new_filament_e_feedrate", feed(sn))
            .float("flush_length", purge_length)
            .bool("wipe_avoid_perimeter", sn.profile.bool("prime_tower_skip_points"))
            .float("wipe_avoid_pos_x", avoid_x)
            .bool("is_prime_tower_interface", contact)
            .float(
                "filament_tower_interface_purge_volume",
                list_f(&sn.profile, "filament_tower_interface_purge_volume", 0),
            )
            .int("filament_tower_interface_print_temp", interface_temp)
            .floats("filament_cooling_before_tower", &cooling)
            .float("wipe_tower_wait_pos_x", after[0])
            .float("wipe_tower_wait_pos_y", after[1])
            .bool("wipe_tower_wait_pos_valid", true);
        for i in 1..=3 {
            v.float(&format!("travel_point_{i}_x"), 0.0).float(&format!("travel_point_{i}_y"), 0.0);
        }
        // Set for the filament printing until now (Orca sets them as each change ends, for the next one).
        let at = |key: &str| list_f(&so.profile, key, 0);
        v.float("retraction_distance_when_cut", at("filament_retraction_distances_when_cut").max(0.0))
            .bool(
                "long_retraction_when_cut",
                so.profile.list("filament_long_retractions_when_cut").first() == Some(&"1"),
            )
            .float("retraction_distance_when_ec", at("retraction_distances_when_ec"))
            .bool("long_retraction_when_ec", so.profile.list("long_retractions_when_ec").first() == Some(&"1"));
        let _ = frame;
        v
    }

    /// The tower's G-code moved onto the plate as Orca moves it (`post_process_wipe_tower_moves`): each move's X and Y
    /// rewritten where they change, and after the change G-code's placeholder from where the purge starts.
    fn translate(&self, gcode: &str, start: V, tool_change_start: V, _initial: usize) -> String {
        let mut out = String::with_capacity(gcode.len() + gcode.len() / 4);
        let mut pos = start;
        let mut old = V { x: -1000.1, y: -1000.1 };
        for line in gcode.split('\n') {
            let line = self.translate_line(line, &mut pos, &mut old);
            out += &line;
            out.push('\n');
            if line == "[change_filament_gcode]" {
                old = V { x: -1000.1, y: -1000.1 };
                pos = tool_change_start;
            }
        }
        // Orca's reading leaves one more newline than the text had.
        out.pop();
        out
    }

    /// The nozzle change's ramming moved onto the plate (`transform_gcode`).
    fn translate_plain(&self, gcode: &str, start: V) -> String {
        let mut out = String::with_capacity(gcode.len() + gcode.len() / 4);
        let mut pos = start;
        let mut old = V { x: -1000.1, y: -1000.1 };
        for line in gcode.split('\n') {
            if line.starts_with("G1 ") {
                out += &self.translate_line(line, &mut pos, &mut old);
            } else {
                out += line;
            }
            out.push('\n');
        }
        out.pop();
        out
    }

    fn translate_line(&self, line: &str, pos: &mut V, old: &mut V) -> String {
        let cmd = ["G1 ", "G2 ", "G3 "].into_iter().find(|c| line.starts_with(c));
        let Some(cmd) = cmd else { return line.to_string() };
        // The line without its X and Y, which it reads.
        let mut stripped = String::with_capacity(line.len());
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            let c = bytes[i];
            if c == b'X' || c == b'Y' {
                let mut j = i + 1;
                while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b'.' || bytes[j] == b'-') {
                    j += 1;
                }
                if let Ok(v) = line[i + 1..j].parse::<f32>() {
                    if c == b'X' {
                        pos.x = v;
                    } else {
                        pos.y = v;
                    }
                }
                i = j;
            } else {
                stripped.push(c as char);
                i += 1;
            }
        }
        let t = *pos + self.origin;
        if t != *old {
            let mut head = cmd.to_string();
            if t.x != old.x {
                head += &format!(" X{:.3}", t.x as f64);
            }
            if t.y != old.y {
                head += &format!(" Y{:.3}", t.y as f64);
            }
            head.push(' ');
            *old = t;
            format!("{head}{}", &stripped[3.min(stripped.len())..])
        } else {
            stripped
        }
    }

    /// A wipe path from the tower's frame onto the plate.
    fn wipe(&self, path: &[V]) -> Vec<[f64; 2]> {
        path.iter().map(|&p| self.plate(p)).collect()
    }

    /// Where the change G-code leaves the nozzle (its last G0/G1 X, Y and Z, from `from`), and where it starts.
    fn last_position(&self, text: &str, from: [f64; 3]) -> ([f64; 3], [f64; 3]) {
        let mut at = from;
        for line in text.lines() {
            let code = line.split(';').next().unwrap_or("").trim();
            let mut words = code.split_whitespace();
            if !matches!(words.next(), Some("G0" | "G1")) {
                continue;
            }
            for w in words {
                let axis = match w.as_bytes().first() {
                    Some(b'X') => 0,
                    Some(b'Y') => 1,
                    Some(b'Z') => 2,
                    _ => continue,
                };
                if let Ok(v) = w[1..].parse() {
                    at[axis] = v;
                }
            }
        }
        (at, from)
    }

    /// The way from `from` to `to` (where the purge starts) round the tower (`generate_path_to_wipe_tower`): to the
    /// tower's box (2 mm out), round it the shorter way to the side the purge starts from, then in. The last point is
    /// `to`.
    fn route(&self, from: [f64; 3], to: [f64; 2], _frame: &Frame) -> Vec<[f64; 2]> {
        let (lo, hi) =
            (self.plate(V { x: self.bbx[0], y: self.bbx[1] }), self.plate(V { x: self.bbx[2], y: self.bbx[3] }));
        // Orca's box in its integer units, grown by the 2 mm clearance.
        let r = |v: f64| (v * 1e6).round() / 1e6;
        let (x0, y0, x1, y1) = (r(lo[0]) - 2.0, r(lo[1]) - 2.0, r(hi[0]) + 2.0, r(hi[1]) + 2.0);
        let bed = self.settings[0].bed;
        let inside = |x: f64, y: f64| x > 0.0 && y > 0.0 && x < bed[0] && y < bed[1];
        if !(inside(x0, y0) && inside(x1, y1)) {
            return vec![to];
        }
        let corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        let width = x1 - x0;
        let v = if (to[0] - x0).abs() < width / 2.0 { [-1.0, 0.0] } else { [1.0, 0.0] };
        let cross = |a: [f64; 2], b: [f64; 2]| a[0] * b[1] - a[1] * b[0];
        let ray = |a: [f64; 2], d: [f64; 2], b: [f64; 2], c: [f64; 2]| -> Option<[f64; 2]> {
            let v2 = [c[0] - b[0], c[1] - b[1]];
            let denom = cross(d, v2);
            if denom.abs() < 1e-4 {
                return None;
            }
            let v12 = [a[0] - b[0], a[1] - b[1]];
            let t1 = cross(v2, v12) / denom;
            let t2 = cross(d, v12) / denom;
            (t1 >= 0.0 && (0.0..=1.0).contains(&t2)).then(|| [a[0] + t1 * d[0], a[1] + t1 * d[1]])
        };
        let mut hit: Option<(usize, [f64; 2])> = None;
        for i in 0..4 {
            if let Some(p) = ray(to, v, corners[i], corners[(i + 1) % 4]) {
                hit = Some((i, p));
                break;
            }
        }
        let Some((i1, p1)) = hit else { return vec![to] };
        // Where the line from the start to that point crosses another side.
        let start = [from[0], from[1]];
        let mut hit2: Option<(usize, [f64; 2])> = None;
        for i in 0..4 {
            if i == i1 {
                continue;
            }
            if let Some(p) = segment_cross(start, p1, corners[i], corners[(i + 1) % 4]) {
                hit2 = Some((i, p));
                break;
            }
        }
        let mut out = Vec::new();
        match hit2 {
            None => out.push(p1),
            Some((i2, p2)) => {
                let walk = |forward: bool| -> (Vec<[f64; 2]>, f64) {
                    let beg = if forward { (i2 + 1) % 4 } else { i2 };
                    let end = if forward { i1 } else { (i1 + 1) % 4 };
                    let mut path = vec![p2];
                    let d2 = |a: [f64; 2], b: [f64; 2]| (a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2);
                    let mut len = d2(p2, corners[beg]);
                    let mut i = beg;
                    while i != end {
                        let ni = if forward { (i + 1) % 4 } else { (i + 3) % 4 };
                        len += d2(corners[i], corners[ni]);
                        path.push(corners[i]);
                        i = ni;
                    }
                    path.push(corners[end]);
                    path.push(p1);
                    len += d2(p1, corners[end]);
                    (path, len)
                };
                let (a, la) = walk(true);
                let (b, lb) = walk(false);
                out.extend(if la < lb { a } else { b });
            }
        }
        out.push(to);
        out
    }

    /// The variables of the printer's start, layer change and end G-code that a plate in several filaments changes:
    /// one value per filament, the first filament, each extruder's first filament, the camera's extruder.
    pub fn frame_vars(&self, frame: &mut Frame, palette: &Palette) {
        let n = self.settings.len();
        let k = self.extruders;
        let at = |i: usize, key: &str| list_f(&self.settings[i].profile, key, 0);
        let ints = |key: &str| (0..n).map(|i| at(i, key) as i64).collect::<Vec<i64>>();
        let floats = |key: &str| (0..n).map(|i| at(i, key)).collect::<Vec<f64>>();
        let types: Vec<String> = self.settings.iter().map(|s| s.filament_type.clone()).collect();
        let types: Vec<&str> = types.iter().map(String::as_str).collect();
        let map: Vec<i64> = self.extruder_of.iter().map(|&e| e as i64 + 1).collect();
        let flush_speeds: Vec<f64> = (0..n)
            .map(|i| match at(i, "filament_flush_volumetric_speed") {
                0.0 => at(i, "filament_max_volumetric_speed"),
                v => v,
            })
            .collect();
        let flush_temps: Vec<i64> = (0..n)
            .map(|i| match at(i, "filament_flush_temp") as i64 {
                0 => at(i, "nozzle_temperature_range_high") as i64,
                t => t,
            })
            .collect();
        let z_hop_types: Vec<i64> = self
            .settings
            .iter()
            .map(|s| match s.z_hop_type.as_str() {
                "Normal Lift" => 1,
                "Slope Lift" => 2,
                "Spiral Lift" => 3,
                _ => 0,
            })
            .collect();
        // Each extruder's first filament, in the printer's numbering of the extruders (as Orca hands them over).
        let mut first_on = vec![-1i64; k];
        for order in &self.orders {
            for &f in order {
                let e = self.physical.get(self.extruder_of[f]).map_or(self.extruder_of[f], |&p| p as usize);
                if let Some(slot) = first_on.get_mut(e)
                    && *slot == -1
                {
                    *slot = f as i64;
                }
            }
        }
        let toolchange: Vec<f64> =
            (0..k).map(|e| list_f(&filaments::for_extruder(&self.base, e), "retract_length_toolchange", 0)).collect();
        let nozzles: Vec<f64> = (0..k).map(|e| list_f(&self.base, "nozzle_diameter", e)).collect();
        let vitrification = self.settings.iter().map(|s| s.profile.int("temperature_vitrification")).min().unwrap_or(0);
        let max_fan =
            self.settings.iter().map(|s| list_f(&s.profile, "additional_cooling_fan_speed", 0)).fold(0.0, f64::max);
        let all_bambu = palette.profiles.iter().all(|p| p.text("filament_vendor") == "Bambu Lab");
        let first = self.first;
        let base = &self.settings[0];
        let mut used: Vec<usize> = self.orders.iter().flatten().map(|&f| self.extruder_of[f]).collect();
        used.sort_unstable();
        used.dedup();
        frame.set_limits(used.iter().map(|&e| Arc::new(filaments::for_extruder(&self.base, e))).collect());
        let v = frame.vars_mut();
        v.ints("nozzle_temperature_initial_layer", &ints("nozzle_temperature_initial_layer"))
            .ints("nozzle_temperature", &ints("nozzle_temperature"))
            .ints("first_layer_temperature", &ints("nozzle_temperature_initial_layer"))
            .floats("filament_max_volumetric_speed", &floats("filament_max_volumetric_speed"))
            .strs("filament_type", &types)
            .ints("filament_map", &map)
            .ints("additional_cooling_fan_speed", &ints("additional_cooling_fan_speed"))
            .ints("additional_fan_full_speed_layer", &ints("additional_fan_full_speed_layer"))
            .ints("close_additional_fan_first_x_layers", &ints("close_additional_fan_first_x_layers"))
            .floats("first_x_layer_fan_speed", &floats("first_x_layer_fan_speed"))
            .floats("flush_volumetric_speeds", &flush_speeds)
            .ints("flush_temperatures", &flush_temps)
            .ints("z_hop_types", &z_hop_types)
            .floats("retract_length_toolchange", &toolchange)
            .floats("nozzle_diameter_at_nozzle_id", &nozzles)
            .float("initial_layer_print_height", base.first_layer_height)
            .float("initial_layer_acceleration", base.first_layer_accel)
            .float("travel_acceleration", base.travel_accel)
            .int("min_vitrification_temperature", vitrification)
            .float("max_additional_fan", max_fan)
            .bool("is_all_bbl_filament", all_bambu)
            .int("initial_filament_id", first as i64)
            .int("initial_no_support_filament_id", first as i64)
            .int("initial_nozzle_id", self.extruder_of[first] as i64)
            .int("current_filament_id", first as i64)
            .int("current_nozzle_id", self.extruder_of[first] as i64)
            .ints("first_non_support_filaments", &first_on)
            .ints("first_filaments", &first_on)
            .int("most_used_physical_extruder_id", self.physical.get(self.most_used_extruder).copied().unwrap_or(0))
            .int("curr_physical_extruder_id", self.physical_of(first));
    }

    /// The plate's settings as its files list them (`Settings::project_settings`) with every filament's value of the
    /// filament settings, every extruder's of the extruder settings, and which extruder each filament prints with
    /// (`filament_map`, 1-based).
    pub fn project_settings(&self, s: &Settings) -> Vec<(&'static str, Value)> {
        const PER_EXTRUDER: [&str; 5] =
            ["nozzle_diameter", "outer_wall_speed", "inner_wall_speed", "sparse_infill_speed", "travel_speed"];
        let per_filament: Vec<Vec<(&'static str, Value)>> =
            self.settings.iter().map(|fs| fs.project_settings()).collect();
        let extruders: Vec<crate::profile::Profile> =
            (0..self.extruders).map(|e| filaments::for_extruder(&self.base, e)).collect();
        let mut out: Vec<(&'static str, Value)> = s
            .project_settings()
            .into_iter()
            .map(|(key, value)| {
                let value = match value {
                    Value::List(_) if PER_EXTRUDER.contains(&key) => {
                        Value::List(extruders.iter().map(|p| crate::config::trim(p.float_at(key, 0))).collect())
                    }
                    Value::List(_) => Value::List(
                        per_filament
                            .iter()
                            .map(|settings| {
                                settings
                                    .iter()
                                    .find(|(k, _)| *k == key)
                                    .map_or(String::new(), |(_, v)| v.first().into())
                            })
                            .collect(),
                    ),
                    one => one,
                };
                (key, value)
            })
            .collect();
        out.push(("filament_map", Value::List(self.extruder_of.iter().map(|e| (e + 1).to_string()).collect())));
        out
    }

    /// The filaments the plate prints with, ascending.
    pub fn used(&self) -> Vec<usize> {
        let mut used: Vec<usize> = self.orders.iter().flatten().copied().collect();
        used.sort_unstable();
        used.dedup();
        used
    }

    /// The filaments in the order they print: the first, then the one each tool change changes to.
    pub fn sequence(&self) -> Vec<usize> {
        let mut out = vec![self.first];
        out.extend(self.flushes.iter().map(|f| f.2));
        out
    }

    /// The presets as given, with every extruder's values, and how many extruders the printer has.
    pub fn printer(&self) -> (&crate::profile::Profile, usize) {
        (&self.base, self.extruders)
    }

    /// The physical extruder (the printer's numbering) of filament `f`.
    pub fn physical_of(&self, f: usize) -> i64 {
        self.physical.get(self.extruder_of.get(f).copied().unwrap_or(0)).copied().unwrap_or(0)
    }
}

fn segment_cross(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> Option<[f64; 2]> {
    let r = [b[0] - a[0], b[1] - a[1]];
    let s = [d[0] - c[0], d[1] - c[1]];
    let denom = r[0] * s[1] - r[1] * s[0];
    if denom.abs() < 1e-12 {
        return None;
    }
    let qp = [c[0] - a[0], c[1] - a[1]];
    let t = (qp[0] * s[1] - qp[1] * s[0]) / denom;
    let u = (qp[0] * r[1] - qp[1] * r[0]) / denom;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u)).then(|| [a[0] + t * r[0], a[1] + t * r[1]])
}

fn with_eol(mut s: String) -> String {
    if !s.is_empty() && !s.ends_with('\n') {
        s.push('\n');
    }
    s
}

/// `text` (from `from`) timed with `s`'s machine limits, its extrusions counted to `filament`.
fn timed(text: &str, from: [f64; 3], filament: usize, s: &Settings) -> Text {
    let t = crate::gcode::time_text(text, from, s);
    Text {
        text: text.to_string(),
        secs: t.secs,
        extruding: t.extruding,
        end: t.end,
        accel: t.accel,
        filament,
        mm: t.mm,
        volume: t.mm * s.filament_area(),
        travel: t.travel,
    }
}

/// Each layer's filaments in Orca's order: the first layer as given; later ones by nozzle, starting with the nozzle
/// that ended the layer before, each nozzle's filaments in the order that flushes least.
fn order_layers(
    layers: &[Vec<usize>],
    first: &[usize],
    extruder_of: &[usize],
    flush: &Flush,
    k: usize,
) -> Vec<Vec<usize>> {
    let mut out: Vec<Vec<usize>> = Vec::with_capacity(layers.len());
    let k = k.max(1);
    // Per nozzle: each layer's sequence.
    let mut per: Vec<Vec<Vec<usize>>> = vec![Vec::new(); k];
    for (e, per) in per.iter_mut().enumerate() {
        let mut current: Option<usize> = None;
        for (l, filaments) in layers.iter().enumerate() {
            let mine: Vec<usize> = filaments.iter().copied().filter(|&f| extruder_of[f] == e).collect();
            if l == 0 {
                let seq: Vec<usize> = first.iter().copied().filter(|&f| extruder_of[f] == e).collect();
                if let Some(&f) = seq.last() {
                    current = Some(f);
                }
                per.push(seq);
                continue;
            }
            let next: Vec<usize> = layers
                .get(l + 1)
                .map(|n| n.iter().copied().filter(|&f| extruder_of[f] == e).collect())
                .unwrap_or_default();
            let seq = extruder_order(flush, e, &mine, &next, current);
            if let Some(&f) = seq.last() {
                current = Some(f);
            }
            per.push(seq);
        }
    }
    let mut last_group = first.last().map_or(0, |&f| extruder_of[f]);
    if !layers.is_empty() {
        out.push(first.to_vec());
    }
    for l in 1..layers.len() {
        let mut seq = Vec::new();
        let order: Vec<usize> = std::iter::once(last_group).chain((0..k).filter(|&e| e != last_group)).collect();
        for e in order {
            if let Some(part) = per[e].get(l).filter(|p| !p.is_empty()) {
                seq.extend(part);
                last_group = e;
            }
        }
        out.push(seq);
    }
    out
}

/// One nozzle's filaments on a layer in the order that flushes least from `start` (`get_extruders_order`).
fn extruder_order(flush: &Flush, e: usize, current: &[usize], next: &[usize], start: Option<usize>) -> Vec<usize> {
    if current.len() <= 1 {
        return current.to_vec();
    }
    let w = |a: usize, b: usize| flush.volume(e, a, b) as f32;
    if current.len() <= 5 && next.len() <= 5 {
        // Every order of this layer with every order of the next.
        let mut cur: Vec<usize> = current.to_vec();
        cur.sort_unstable();
        let mut best_cost = f32::MAX;
        let mut best_change = i32::MAX;
        let mut best: Vec<usize> = cur.clone();
        let changes = |a: &[usize], b: &[usize]| {
            let mut count = 0;
            let mut prev = start;
            for &f in a.iter().chain(b) {
                if prev.is_some_and(|p| p != f) {
                    count += 1;
                }
                prev = Some(f);
            }
            count
        };
        loop {
            let mut prev = start;
            let mut cost = 0.0f32;
            for &f in &cur {
                if let Some(p) = prev {
                    cost += w(p, f);
                }
                prev = Some(f);
            }
            if cost <= best_cost {
                let mut nxt: Vec<usize> = next.to_vec();
                nxt.sort_unstable();
                loop {
                    let mut p2 = prev;
                    let mut total = cost;
                    for &f in &nxt {
                        if let Some(p) = p2 {
                            total += w(p, f);
                        }
                        p2 = Some(f);
                    }
                    let change = changes(&cur, &nxt);
                    if total < best_cost || (total == best_cost && change < best_change) {
                        best_cost = total;
                        best = cur.clone();
                        best_change = change;
                    }
                    if !next_permutation(&mut nxt) {
                        break;
                    }
                }
            }
            if !next_permutation(&mut cur) {
                break;
            }
        }
        return best;
    }
    // Fewest flushes over every order (a path through all of them from the start).
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
    let mut cache = vec![vec![f32::MAX; n]; states];
    let mut prev = vec![vec![usize::MAX; n]; states];
    cache[1][0] = 0.0;
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
                if cache[from][mid] == f32::MAX {
                    continue;
                }
                let t = cache[from][mid] + w(all[mid], all[target]);
                if cache[state][target] > t {
                    cache[state][target] = t;
                    prev[state][target] = mid;
                }
            }
        }
    }
    let full = states - 1;
    let mut cost = f32::MAX;
    let mut dst = 0;
    for d in 0..n {
        if all[d] != start_id && cost > cache[full][d] {
            cost = cache[full][d];
            dst = d;
        }
    }
    let mut path = Vec::new();
    let (mut state, mut point) = (full, dst);
    while point != usize::MAX {
        path.push(all[point]);
        let mid = prev[state][point];
        state -= 1 << point;
        point = mid;
    }
    if added {
        path.pop();
    }
    path.reverse();
    path
}

fn next_permutation(v: &mut [usize]) -> bool {
    if v.len() < 2 {
        return false;
    }
    let mut i = v.len() - 1;
    while i > 0 && v[i - 1] >= v[i] {
        i -= 1;
    }
    if i == 0 {
        v.reverse();
        return false;
    }
    let mut j = v.len() - 1;
    while v[j] <= v[i - 1] {
        j -= 1;
    }
    v.swap(i - 1, j);
    v[i..].reverse();
    true
}

/// The tower's settings from the print's (`WipeTower`'s constructor).
fn tower_params(s: &Settings, per: &[Settings], extruder_of: &[usize]) -> wipe_tower::Params {
    let p = &s.profile;
    let f = |key: &str| p.float(key) as f32;
    let per_extruder = |key: &str| -> Vec<u32> {
        let k = filaments::extruders(p);
        (0..k)
            .map(|e| {
                let q = filaments::for_extruder(p, e);
                q.float_at(key, 0) as u32
            })
            .collect()
    };
    let first_layer_travel: Vec<u32> = {
        let k = filaments::extruders(p);
        (0..k)
            .map(|e| {
                let q = filaments::for_extruder(p, e);
                let travel = q.float_at("travel_acceleration", 0);
                let text = q.list("initial_layer_travel_acceleration").first().copied().unwrap_or("0").to_string();
                match text.strip_suffix('%') {
                    Some(pc) => (pc.parse::<f64>().unwrap_or(0.0) / 100.0 * travel) as u32,
                    None => text.parse::<f64>().unwrap_or(0.0) as u32,
                }
            })
            .collect()
    };
    let first = per.first().unwrap_or(s);
    let shared_bed = {
        let mut b = [0.0f64, 0.0, s.bed[0], s.bed[1]];
        for area in p.list("extruder_printable_area") {
            let pts: Vec<[f64; 2]> = area
                .split(',')
                .filter_map(|c| {
                    let (x, y) = c.split_once('x')?;
                    Some([x.trim().parse().ok()?, y.trim().parse().ok()?])
                })
                .collect();
            if pts.is_empty() {
                continue;
            }
            let (x0, y0) =
                (pts.iter().map(|q| q[0]).fold(f64::MAX, f64::min), pts.iter().map(|q| q[1]).fold(f64::MAX, f64::min));
            let (x1, y1) =
                (pts.iter().map(|q| q[0]).fold(f64::MIN, f64::max), pts.iter().map(|q| q[1]).fold(f64::MIN, f64::max));
            b = [b[0].max(x0), b[1].max(y0), b[2].min(x1), b[3].min(y1)];
        }
        b
    };
    let lists = |key: &str| -> Vec<f64> { per.iter().map(|q| list_f(&q.profile, key, 0)).collect() };
    wipe_tower::Params {
        position: [f("wipe_tower_x"), f("wipe_tower_y")],
        width: f("prime_tower_width"),
        rotation_angle: f("wipe_tower_rotation_angle"),
        brim_width: f("prime_tower_brim_width"),
        travel_speed: first.travel_speed as f32,
        first_layer_speed: match first.first_layer_speed as f32 {
            0.0 => 30.0,
            v => v,
        },
        use_gap_wall: p.bool("prime_tower_skip_points"),
        use_rib_wall: p.text("wipe_tower_wall_type") == "rib",
        extra_rib_length: f("wipe_tower_extra_rib_length"),
        rib_width: f("wipe_tower_rib_width"),
        used_fillet: p.bool("wipe_tower_fillet_wall"),
        extra_spacing: p.float("prime_tower_infill_gap") as f32 / 100.0,
        tower_framework: p.bool("prime_tower_enable_framework"),
        max_speed: f("wipe_tower_max_purge_speed") * 60.0,
        printable_height: p.list("extruder_printable_height").iter().filter_map(|v| v.parse().ok()).collect(),
        flat_ironing: p.bool("prime_tower_flat_ironing") && p.bool("prime_tower_skip_points"),
        enable_tower_interface_features: p.bool("enable_tower_interface_features"),
        physical_extruder_map: p.list("physical_extruder_map").iter().filter_map(|v| v.parse().ok()).collect(),
        change_length: (lists("filament_change_length"), lists("filament_change_length_nc")),
        normal_accels: per_extruder("default_acceleration"),
        first_layer_normal_accels: per_extruder("initial_layer_acceleration"),
        travel_accels: per_extruder("travel_acceleration"),
        first_layer_travel_accels: first_layer_travel,
        max_accel: p.float_at("machine_max_acceleration_extruding", 0) as u32,
        first_layer_flow_ratio: 1.0,
        shared_bed,
        extruder_of: extruder_of.to_vec(),
    }
}

/// A filament's parameters for the tower (`WipeTower::set_extruder`).
fn tower_filament(s: &Settings, original: &crate::profile::Profile) -> wipe_tower::Filament {
    let p = &s.profile;
    let at = |key: &str| list_f(p, key, 0) as f32;
    let area = (std::f64::consts::PI / 4.0 * s.filament_diameter * s.filament_diameter) as f32;
    let max_vol = at("filament_max_volumetric_speed");
    let ramming = |key: &str| match at(key) {
        v if (v - -1.0).abs() < 1e-6 => max_vol,
        v => v,
    };
    let k = filaments::extruders(p).max(1);
    let precool = |key: &str, first: bool| -> Vec<f32> {
        let target = at(key);
        if !p.bool("enable_pre_heating") || target == 0.0 {
            return vec![0.0; 2];
        }
        let temp = if first { at("nozzle_temperature_initial_layer") } else { at("nozzle_temperature") };
        (0..2).map(|i| (temp - target).max(0.0) / list_f(p, "hotend_cooling_rate", i) as f32).collect()
    };
    let _ = (k, original);
    let interface = p.bool("enable_tower_interface_features");
    wipe_tower::Filament {
        material: s.filament_type.clone(),
        category: list_f(p, "filament_adhesiveness_category", 0) as i32,
        is_soluble: p.list("filament_soluble").first() == Some(&"1"),
        is_support: p.list("filament_is_support").first() == Some(&"1"),
        nozzle_temperature: s.nozzle_temperature as i32,
        nozzle_temperature_initial_layer: s.first_layer_nozzle_temperature as i32,
        flat_iron_area: at("filament_tower_ironing_area"),
        filament_area: area,
        nozzle_diameter: s.nozzle_diameter as f32,
        max_layer_height: match at("max_layer_height") {
            v if v > 0.0 => v,
            _ => 0.75 * s.nozzle_diameter as f32,
        },
        max_e_speed: if max_vol != 0.0 { max_vol / area } else { f32::MAX },
        max_e_ramming_speed: (
            ramming("filament_ramming_volumetric_speed") / area,
            ramming("filament_ramming_volumetric_speed_nc") / area,
        ),
        ramming_travel_time: (at("filament_ramming_travel_time"), at("filament_ramming_travel_time_nc")),
        precool_t: (
            precool("filament_pre_cooling_temperature", false),
            precool("filament_pre_cooling_temperature_nc", false),
        ),
        precool_t_first_layer: (
            precool("filament_pre_cooling_temperature", true),
            precool("filament_pre_cooling_temperature_nc", true),
        ),
        precool_target_temp: (
            at("filament_pre_cooling_temperature") as i32,
            at("filament_pre_cooling_temperature_nc") as i32,
        ),
        retract_length: s.retract_length as f32,
        retract_speed: s.retract_speed as f32,
        wipe_dist: s.wipe_distance as f32,
        filament_cooling_before_tower: at("filament_cooling_before_tower"),
        tower_interface_print_temp: if interface {
            match at("filament_tower_interface_print_temp") {
                -1.0 => at("nozzle_temperature_range_high"),
                v => v,
            }
        } else {
            0.0
        },
        tower_interface_pre_extrusion_dist: if interface {
            at("filament_tower_interface_pre_extrusion_dist")
        } else {
            0.0
        },
        tower_interface_pre_extrusion_length: if interface {
            at("filament_tower_interface_pre_extrusion_length")
        } else {
            0.0
        },
        petg_pre_extrusion_offset_dist: at("filament_tower_interface_pre_extrusion_dist"),
    }
}
