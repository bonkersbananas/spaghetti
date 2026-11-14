//! The prime tower, as OrcaSlicer 2.5 builds it for a Bambu Lab printer (its "type 1" tower, `GCode/WipeTower.cpp`,
//! the `generate_new` path, which Orca always takes for Bambu printers whatever `wipe_tower_type` says). Ported
//! function by function, in Orca's single-precision arithmetic, so the tower's size, its walls and every purge line
//! fall where Orca's do:
//!
//! - **Planning** (`plan_toolchange`, `plan_tower_new`): each tool change reserves room on the tower for the new
//!   filament's prime (whole lines across the tower at the block's infill gap) and, when the old filament leaves its
//!   nozzle, for ramming it out over 1 mm wide lines first. Room is kept per block (one block per adhesiveness
//!   category), carried down so a layer is never narrower than the one above it, and the tower is squared up: its
//!   width becomes the side of the square of its area.
//! - **Each layer** (`generate_new`): the tool changes in order, each one's ramming, the change itself (placeholders
//!   the G-code writer fills: `[filament_end_gcode]`, `[change_filament_gcode]`, …) and the purge, a zig-zag that
//!   speeds up line by line; then what is left of each block filled sparsely, and the tower's wall: a square with two
//!   ribs along its diagonals, filleted, with gaps where the next layers' purges start (`prime_tower_skip_points`),
//!   and on the first layer a brim round it.
//!
//! What it writes is the tower's own G-code, in the tower's coordinates (its front left corner at 0, 0), as Orca's
//! `WipeTowerWriter` writes it; `toolchange.rs` moves it onto the plate and fills the placeholders, as Orca's
//! `WipeTowerIntegration` does. Orca writes the curved walls as arcs when arc fitting is on (the X2D's default);
//! this writes them as the straight lines Orca writes with it off, simplified to the same 0.1 mm.

use crate::geom::{self, Contour, Pt};
use std::collections::HashMap;
use std::f32::consts::PI as PI_F32;
use std::f64::consts::PI;
use std::sync::Arc;

/// Orca's `EPSILON` (libslic3r.h) and the tower's own `WT_EPSILON`.
const EPSILON: f64 = 1e-4;
const WT_EPSILON: f32 = 1e-3;
const WIDTH_TO_NOZZLE_RATIO: f32 = 1.25;
/// Depth a tower keeps at least, by its height (`min_depth_per_height`).
const MIN_DEPTH_PER_HEIGHT: [(f32, f32); 4] = [(5.0, 5.0), (100.0, 20.0), (250.0, 40.0), (350.0, 60.0)];
/// mm/min of the flat ironing at the start of a purge.
const FLAT_IRON_SPEED: f32 = 10.0 * 60.0;
/// Points on each filleted corner (`arc_fit_size`).
const ARC_FIT_SIZE: usize = 20;
/// How far the wall's path may be simplified, mm (`WIPE_TOWER_RESOLUTION`).
const RESOLUTION: f64 = 0.1;

/// A point or vector in the tower's frame, mm, in single precision as Orca's `Vec2f`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct V {
    pub x: f32,
    pub y: f32,
}

pub const fn v(x: f32, y: f32) -> V {
    V { x, y }
}

impl std::ops::Add for V {
    type Output = V;
    fn add(self, o: V) -> V {
        v(self.x + o.x, self.y + o.y)
    }
}

impl std::ops::Sub for V {
    type Output = V;
    fn sub(self, o: V) -> V {
        v(self.x - o.x, self.y - o.y)
    }
}

impl std::ops::Mul<f32> for V {
    type Output = V;
    fn mul(self, k: f32) -> V {
        v(self.x * k, self.y * k)
    }
}

impl std::ops::Neg for V {
    type Output = V;
    fn neg(self) -> V {
        v(-self.x, -self.y)
    }
}

impl V {
    fn norm(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
    fn squared_norm(self) -> f32 {
        self.x * self.x + self.y * self.y
    }
    fn normalized(self) -> V {
        let n = self.norm();
        if n > 0.0 { v(self.x / n, self.y / n) } else { self }
    }
}

/// `Slic3r::float_to_string_decimal_point(value, precision)`: fixed decimals, as C's `%.*f`.
fn fixed(value: f64, precision: usize) -> String {
    format!("{value:.precision$}")
}

/// What a filament brings to the tower (`WipeTower::FilamentParameters`, as `set_extruder` fills them), with
/// its own extruder's values where Orca resolves them per filament.
#[derive(Clone, Debug)]
pub struct Filament {
    pub material: String,
    /// `filament_adhesiveness_category`: filaments of one category share a block of the tower.
    pub category: i32,
    pub is_soluble: bool,
    pub is_support: bool,
    pub nozzle_temperature: i32,
    pub nozzle_temperature_initial_layer: i32,
    /// mm² ironed flat where a purge starts (`filament_tower_ironing_area`).
    pub flat_iron_area: f32,
    pub filament_area: f32,
    pub nozzle_diameter: f32,
    pub max_layer_height: f32,
    /// mm of filament a second at the filament's volumetric limit (`max_e_speed`).
    pub max_e_speed: f32,
    /// … when ramming before a change of extruder and before a change of nozzle.
    pub max_e_ramming_speed: (f32, f32),
    /// Seconds of reverse travel after ramming (extruder change, nozzle change).
    pub ramming_travel_time: (f32, f32),
    /// Seconds to cool to the pre-cooling temperature, per extruder (extruder change, nozzle change), and on the
    /// first layer.
    pub precool_t: (Vec<f32>, Vec<f32>),
    pub precool_t_first_layer: (Vec<f32>, Vec<f32>),
    pub precool_target_temp: (i32, i32),
    pub retract_length: f32,
    pub retract_speed: f32,
    pub wipe_dist: f32,
    pub filament_cooling_before_tower: f32,
    pub tower_interface_print_temp: f32,
    pub tower_interface_pre_extrusion_dist: f32,
    pub tower_interface_pre_extrusion_length: f32,
    pub petg_pre_extrusion_offset_dist: f32,
}

/// The tower's settings (`WipeTower`'s constructor), and which extruder each filament prints with.
#[derive(Clone, Debug)]
pub struct Params {
    /// mm on the plate: its front left corner (`wipe_tower_x`, `wipe_tower_y`).
    pub position: [f32; 2],
    pub width: f32,
    pub rotation_angle: f32,
    /// `prime_tower_brim_width`; below zero, chosen by the tower's height.
    pub brim_width: f32,
    pub travel_speed: f32,
    pub first_layer_speed: f32,
    pub use_gap_wall: bool,
    pub use_rib_wall: bool,
    pub extra_rib_length: f32,
    pub rib_width: f32,
    pub used_fillet: bool,
    /// `prime_tower_infill_gap`, as a share.
    pub extra_spacing: f32,
    pub tower_framework: bool,
    /// mm/min (`wipe_tower_max_purge_speed`).
    pub max_speed: f32,
    pub printable_height: Vec<f64>,
    pub flat_ironing: bool,
    pub enable_tower_interface_features: bool,
    pub physical_extruder_map: Vec<i32>,
    /// `filament_change_length` and `filament_change_length_nc`, per filament.
    pub change_length: (Vec<f64>, Vec<f64>),
    /// Per extruder, mm/s².
    pub normal_accels: Vec<u32>,
    pub first_layer_normal_accels: Vec<u32>,
    pub travel_accels: Vec<u32>,
    pub first_layer_travel_accels: Vec<u32>,
    pub max_accel: u32,
    pub first_layer_flow_ratio: f32,
    /// The plate's printable area every extruder reaches (min x, min y, max x, max y), mm.
    pub shared_bed: [f64; 4],
    /// Each filament's extruder (0-based), which is also its nozzle on a printer with one nozzle per extruder.
    pub extruder_of: Vec<usize>,
}

/// One tool change on a layer of the plan (`WipeTowerInfo::ToolChange`).
#[derive(Clone, Copy, Debug, Default)]
struct ToolChange {
    old_tool: usize,
    new_tool: usize,
    required_depth: f32,
    wipe_volume: f32,
    wipe_length: f32,
    nozzle_change_depth: f32,
    nozzle_change_length: f32,
    purge_volume: f32,
}

/// One layer of the plan (`WipeTowerInfo`).
#[derive(Clone, Debug)]
struct LayerInfo {
    z: f32,
    height: f32,
    depth: f32,
    extra_spacing: f32,
    extruder_fill: bool,
    tool_changes: Vec<ToolChange>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LayerType {
    Normal,
    Contact,
    Solid,
    ContactUp,
}

/// A block of the tower: the room one adhesiveness category's purges take (`WipeTowerBlock`).
#[derive(Clone, Debug)]
struct Block {
    block_id: usize,
    category: i32,
    layer_depths: Vec<f32>,
    finish_depth: Vec<f32>,
    layers_type: Vec<LayerType>,
    depth: f32,
    start_depth: f32,
    cur_depth: f32,
    last_filament_change_id: i64,
    last_nozzle_change_id: i64,
}

#[derive(Clone, Copy, Debug, Default)]
struct BlockDepthInfo {
    category: i32,
    depth: f32,
    nozzle_change_depth: f32,
}

/// The ramming of a nozzle change, which the G-code writer puts before the change itself (`NozzleChangeResult`).
#[derive(Clone, Debug, Default)]
pub struct NozzleChange {
    pub gcode: String,
    pub start_pos: V,
    pub end_pos: V,
    pub wipe_path: Vec<V>,
    pub is_extruder_change: bool,
}

/// A piece of the tower's G-code (`ToolChangeResult`): a tool change, or the rest of a layer.
#[derive(Clone, Debug, Default)]
pub struct Piece {
    pub print_z: f32,
    pub layer_height: f32,
    pub gcode: String,
    /// Where it starts and ends, in the tower's frame.
    pub start_pos: V,
    pub end_pos: V,
    pub wipe_path: Vec<V>,
    pub purge_volume: f32,
    pub initial_tool: usize,
    pub new_tool: usize,
    /// The rest of a layer printed before the tool change it is merged with: the writer travels to the tower first.
    pub is_finish_first: bool,
    pub is_tool_change: bool,
    pub tool_change_start_pos: V,
    pub is_contact: bool,
    pub nozzle_change: NozzleChange,
}

/// A box on the tower (`box_coordinates`): its four corners.
#[derive(Clone, Copy, Debug)]
struct BoxC {
    ld: V,
    lu: V,
    rd: V,
    ru: V,
}

impl BoxC {
    fn new(pos: V, width: f32, height: f32) -> BoxC {
        let (left, bottom) = (pos.x, pos.y);
        BoxC {
            ld: v(left, bottom),
            lu: v(left, bottom + height),
            rd: v(left + width, bottom),
            ru: v(left + width, bottom + height),
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum LimitFlow {
    None,
    Print,
    Ramming,
    RammingNc,
}

/// Orca's `WipeTowerWriter`: the tower's G-code, written as it moves.
struct Writer {
    gcode: String,
    start_pos: V,
    pos: V,
    wipe_path: Vec<V>,
    z: f32,
    feedrate: f32,
    tool: usize,
    layer_height: f32,
    flow: f32,
    internal_angle: f32,
    y_shift: f32,
    wt_width: f32,
    wt_depth: f32,
    used_filament_length: f32,
    filpar: Arc<Vec<Filament>>,
    params: Arc<Params>,
    first_layer: bool,
    last_accel: u32,
}

impl Writer {
    fn new(layer_height: f32, line_width: f32, filpar: Arc<Vec<Filament>>, params: Arc<Params>) -> Writer {
        let mut w = Writer {
            gcode: String::with_capacity(4096),
            start_pos: V::default(),
            pos: v(f32::MAX, f32::MAX),
            wipe_path: Vec::new(),
            z: 0.0,
            feedrate: 0.0,
            tool: 0,
            layer_height,
            flow: 0.0,
            internal_angle: 0.0,
            y_shift: 0.0,
            wt_width: 0.0,
            wt_depth: 0.0,
            used_filament_length: 0.0,
            filpar,
            params,
            first_layer: false,
            last_accel: 0,
        };
        w.gcode += &format!("; LAYER_HEIGHT: {}\n; FEATURE: Prime tower\n", fixed(layer_height as f64, 6));
        w.change_analyzer_line_width(line_width);
        w
    }

    fn change_analyzer_line_width(&mut self, line_width: f32) -> &mut Self {
        self.gcode += &format!("; LINE_WIDTH: {}\n", fixed(line_width as f64, 6));
        self
    }

    fn set_initial_position(&mut self, pos: V, width: f32, depth: f32, internal_angle: f32) -> &mut Self {
        self.wt_width = width;
        self.wt_depth = depth;
        self.internal_angle = internal_angle;
        self.start_pos = self.rotate(pos);
        self.pos = pos;
        self
    }

    fn set_y_shift(&mut self, shift: f32) -> &mut Self {
        self.pos.y -= shift - self.y_shift;
        self.y_shift = shift;
        self
    }

    fn append(&mut self, text: &str) -> &mut Self {
        self.gcode += text;
        self
    }

    fn comment_with_value(&mut self, comment: &str, value: i64) -> &mut Self {
        self.gcode += &format!(";{comment}{value}\n");
        self
    }

    fn feedrate(&mut self, f: f32) -> &mut Self {
        if f != self.feedrate {
            let text = self.format_f(f);
            self.gcode += &format!("G1{text}\n");
        }
        self
    }

    fn x(&self) -> f32 {
        self.pos.x
    }

    fn y(&self) -> f32 {
        self.pos.y
    }

    fn pos_rotated(&self) -> V {
        self.rotate(self.pos)
    }

    fn get_and_reset_used_filament_length(&mut self) -> f32 {
        std::mem::take(&mut self.used_filament_length)
    }

    fn rotate(&self, mut pt: V) -> V {
        pt.x -= self.wt_width / 2.0;
        pt.y += self.y_shift - self.wt_depth / 2.0;
        let angle = (self.internal_angle * (PI as f32 / 180.0)) as f64;
        let (c, s) = (angle.cos(), angle.sin());
        v(
            (pt.x as f64 * c - pt.y as f64 * s) as f32 + self.wt_width / 2.0,
            (pt.x as f64 * s + pt.y as f64 * c) as f32 + self.wt_depth / 2.0,
        )
    }

    fn format_f(&mut self, f: f32) -> String {
        self.feedrate = f;
        format!(" F{}", (f + 0.5).floor() as i32)
    }

    fn acceleration(&mut self, travel: bool) -> String {
        let p = &*self.params;
        let list = match (self.first_layer, travel) {
            (true, true) => &p.first_layer_travel_accels,
            (true, false) => &p.first_layer_normal_accels,
            (false, true) => &p.travel_accels,
            (false, false) => &p.normal_accels,
        };
        let Some(&extruder) = p.extruder_of.get(self.tool) else { return String::new() };
        let Some(&acc) = list.get(extruder) else { return String::new() };
        let acc = if p.max_accel > 0 && acc > p.max_accel { p.max_accel } else { acc };
        if acc == 0 || acc == self.last_accel {
            return String::new();
        }
        self.last_accel = acc;
        format!("M204 S{acc}\n")
    }

    /// `extrude_explicit`: to (x, y) with `e` mm of filament at feed rate `f` (mm/min; 0 keeps the current one).
    fn extrude_explicit(&mut self, x: f32, y: f32, e: f32, f: f32, record_length: bool, limit: LimitFlow) -> &mut Self {
        if (x - self.pos.x).abs() <= EPSILON as f32
            && (y - self.pos.y).abs() < EPSILON as f32
            && e == 0.0
            && (f == 0.0 || f == self.feedrate)
        {
            return self;
        }
        let (dx, dy) = (x - self.pos.x, y - self.pos.y);
        let len = (dx * dx + dy * dy).sqrt();
        if record_length {
            self.used_filament_length += e;
        }
        let rotated_current = self.pos_rotated();
        let rot = self.rotate(v(x, y));
        let accel = self.acceleration(e == 0.0);
        self.gcode += &accel;
        self.gcode += "G1";
        if (rot.x - rotated_current.x).abs() > EPSILON as f32 {
            self.pos.x = rot.x;
            self.gcode += &format!(" X{}", fixed(rot.x as f64, 3));
        }
        if (rot.y - rotated_current.y).abs() > EPSILON as f32 {
            self.pos.y = rot.y;
            self.gcode += &format!(" Y{}", fixed(rot.y as f64, 3));
        }
        if e != 0.0 {
            self.gcode += &format!(" E{}", fixed(e as f64, 4));
        }
        let mut f = f;
        if f != 0.0 && f != self.feedrate {
            if limit != LimitFlow::None {
                let e_speed = e / ((if len == 0.0 { e.abs() } else { len }) / f * 60.0);
                let fp = &self.filpar[self.tool];
                let most = match limit {
                    LimitFlow::Ramming => fp.max_e_ramming_speed.0,
                    LimitFlow::RammingNc => fp.max_e_ramming_speed.1,
                    _ => fp.max_e_speed,
                };
                f /= (e_speed / most).max(1.0);
            }
            let text = self.format_f(f);
            self.gcode += &text;
        }
        self.pos = v(x, y);
        self.gcode += "\n";
        self
    }

    fn travel(&mut self, x: f32, y: f32, f: f32) -> &mut Self {
        self.extrude_explicit(x, y, 0.0, f, false, LimitFlow::Print)
    }

    fn travel_to(&mut self, p: V, f: f32) -> &mut Self {
        self.travel(p.x, p.y, f)
    }

    /// A line to (x, y) at the writer's flow.
    fn extrude(&mut self, x: f32, y: f32, f: f32, limit: LimitFlow) -> &mut Self {
        let (dx, dy) = (x - self.pos.x, y - self.pos.y);
        let e = (dx * dx + dy * dy).sqrt() * self.flow;
        self.extrude_explicit(x, y, e, f, false, limit)
    }

    fn extrude_to(&mut self, p: V, f: f32) -> &mut Self {
        self.extrude(p.x, p.y, f, LimitFlow::Print)
    }

    fn load(&mut self, e: f32, f: f32) -> &mut Self {
        if e == 0.0 && (f == 0.0 || f == self.feedrate) {
            return self;
        }
        self.gcode += "G1";
        if e != 0.0 {
            self.gcode += &format!(" E{}", fixed(e as f64, 4));
        }
        if f != 0.0 && f != self.feedrate {
            let text = self.format_f(f);
            self.gcode += &text;
        }
        self.gcode += "\n";
        self
    }

    fn retract(&mut self, e: f32, f: f32) -> &mut Self {
        self.load(-e, f)
    }

    fn rectangle_fill_box(&mut self, wt: &WipeTower, ld: V, width: f32, height: f32, f: f32) -> &mut Self {
        let need_change_flow = wt.need_thick_bridge_flow(ld.y);
        let corners = [ld, ld + v(width, 0.0), ld + v(width, height), ld + v(0.0, height)];
        let mut closest = 0;
        if self.x() - ld.x > ld.x + width - self.x() {
            closest = 1;
        }
        if self.y() - ld.y > ld.y + height - self.y() {
            closest = if closest == 0 { 3 } else { 2 };
        }
        let (cx, cy) = (corners[closest].x, self.y());
        self.travel(cx, cy, 0.0);
        let (cx, cy) = (self.x(), corners[closest].y);
        self.travel(cx, cy, 0.0);
        let mut i = closest;
        let mut flow_changed = false;
        loop {
            i = (i + 1) % 4;
            if need_change_flow {
                if i == 1 {
                    self.flow = wt.extrusion_flow(0.2);
                    self.append(&format!("; LAYER_HEIGHT: {}\n", fixed(0.2, 6)));
                    flow_changed = true;
                } else if i == 2 && flow_changed {
                    self.flow = wt.extrusion_flow;
                    let h = self.layer_height;
                    self.append(&format!("; LAYER_HEIGHT: {}\n", fixed(h as f64, 6)));
                }
            }
            self.extrude_to(corners[i], f);
            if i == closest {
                break;
            }
        }
        self
    }

    fn line(&mut self, wt: &WipeTower, mut p0: V, mut p1: V, f: f32) -> &mut Self {
        let need_change_flow = wt.need_thick_bridge_flow(p0.y);
        if need_change_flow {
            self.flow = wt.extrusion_flow(0.2);
            self.append(&format!("; LAYER_HEIGHT: {}\n", fixed(0.2, 6)));
        }
        if (self.x() - p0.x).abs() > (self.x() - p1.x).abs() {
            std::mem::swap(&mut p0, &mut p1);
        }
        let y = self.y();
        self.travel(p0.x, y, 0.0);
        let x = self.x();
        self.travel(x, p0.y, 0.0);
        self.extrude_to(p1, f);
        if need_change_flow {
            self.flow = wt.extrusion_flow;
            let h = self.layer_height;
            self.append(&format!("; LAYER_HEIGHT: {}\n", fixed(h as f64, 6)));
        }
        self
    }

    fn rectangle_fill(&mut self, wt: &WipeTower, fill_box: &BoxC, wipe_path: &mut Vec<V>, f: f32) -> &mut Self {
        let width = fill_box.rd.x - fill_box.ld.x;
        let height = fill_box.ru.y - fill_box.rd.y;
        if height > wt.perimeter_width - WT_EPSILON {
            self.rectangle_fill_box(wt, fill_box.ld, width, height, f);
            let p = self.pos;
            let target = if p == fill_box.ld {
                fill_box.rd
            } else if p == fill_box.rd {
                fill_box.ru
            } else if p == fill_box.ru {
                fill_box.lu
            } else {
                fill_box.ld
            };
            wipe_path.push(p);
            wipe_path.push(target);
        } else if height > WT_EPSILON {
            self.line(wt, fill_box.ld, fill_box.rd, 0.0);
            let p = self.pos;
            let target = if p == fill_box.ld { fill_box.rd } else { fill_box.ld };
            wipe_path.push(p);
            wipe_path.push(target);
        }
        self
    }

    /// `generate_path`: the wall's polylines from the one nearest the nozzle, retracting over the gaps between them.
    fn generate_path(&mut self, polylines: &[Vec<V>], feedrate: f32, retract_length: f32, retract_speed: f32) {
        let mut segments: Vec<(V, V)> = Vec::new();
        for pl in polylines {
            let simplified = simplify_polyline(pl, RESOLUTION as f32);
            if simplified.len() < 2 {
                continue;
            }
            for w in simplified.windows(2) {
                segments.push((w[0], w[1]));
            }
        }
        if segments.is_empty() {
            return;
        }
        let anchor = self.pos;
        let mut closest = 0;
        let mut best = f32::MAX;
        for (i, s) in segments.iter().enumerate() {
            let d = (s.0 - anchor).squared_norm();
            if d < best {
                best = d;
                closest = i;
            }
        }
        let mut i = closest;
        self.travel_to(segments[i].0, 0.0);
        self.extrude_to(segments[i].1, feedrate);
        loop {
            i = (i + 1) % segments.len();
            if i == closest {
                break;
            }
            let (dx, dy) = (segments[i].0.x - self.pos.x, segments[i].0.y - self.pos.y);
            let len = (dx * dx + dy * dy).sqrt();
            if len > EPSILON as f32 {
                self.retract(retract_length, retract_speed);
                self.travel_to(segments[i].0, 600.0);
                self.retract(-retract_length, retract_speed);
            }
            self.extrude_to(segments[i].1, feedrate);
        }
    }

    /// `polygon`: a closed loop from its point nearest the nozzle.
    fn polygon(&mut self, points: &[V], f: f32) -> &mut Self {
        let mut closed = points.to_vec();
        if let Some(&first) = points.first() {
            closed.push(first);
        }
        let simplified = simplify_polyline(&simplify_polyline(&closed, 0.001), RESOLUTION as f32);
        let segments: Vec<(V, V)> = simplified.windows(2).map(|w| (w[0], w[1])).collect();
        if segments.is_empty() {
            return self;
        }
        let anchor = self.pos;
        let mut closest = 0;
        let mut best = f32::MAX;
        for (i, s) in segments.iter().enumerate() {
            let d = (s.0 - anchor).squared_norm();
            if d < best {
                best = d;
                closest = i;
            }
        }
        let mut i = closest;
        self.travel_to(segments[i].0, 0.0);
        self.extrude_to(segments[i].1, f);
        loop {
            i = (i + 1) % segments.len();
            if i == closest {
                break;
            }
            self.extrude_to(segments[i].1, f);
        }
        self
    }

    fn spiral_flat_ironing(&mut self, center: V, area: f32, step: f32, feedrate: f32) {
        let edge = area.sqrt();
        let mut max = center + v(step, step);
        let mut min = center - v(step, step);
        let mut n = (edge / step / 2.0).ceil() as i32;
        if n <= 0 {
            return;
        }
        while n > 0 {
            n -= 1;
            let y = self.y();
            self.travel(max.x, y, feedrate);
            let x = self.x();
            self.travel(x, max.y, feedrate);
            let y = self.y();
            self.travel(min.x, y, feedrate);
            let x = self.x();
            self.travel(x, min.y, feedrate);
            max = max + v(step, step);
            min = min - v(step, step);
        }
    }

    fn format_line_m104(&mut self, temp: i32, extruder: i64) -> &mut Self {
        let mut t = String::from("M400\nM104");
        if extruder >= 0 && (extruder as usize) < self.params.physical_extruder_map.len() {
            t += &format!(" T{}", self.params.physical_extruder_map[extruder as usize]);
        }
        t += &format!(" S{temp} N0\n");
        self.append(&t)
    }

    fn format_line_m109(&mut self, temp: i32, extruder: i64) -> &mut Self {
        let mut t = String::from("M109");
        if extruder >= 0 && (extruder as usize) < self.params.physical_extruder_map.len() {
            t += &format!(" T{}", self.params.physical_extruder_map[extruder as usize]);
        }
        t += &format!(" S{temp} N0\n");
        self.append(&t)
    }

    fn add_wipe_point(&mut self, p: V) -> &mut Self {
        let r = self.rotate(p);
        self.wipe_path.push(r);
        self
    }

    /// The wipe after the wall: back along it from the point nearest the nozzle, `wipe_dist` mm.
    fn add_wipe_path(&mut self, polygon: &[V], wipe_dist: f32) {
        if polygon.is_empty() {
            return;
        }
        let here = self.pos;
        let closest = closest_index(polygon, here);
        // `split_at_index`: from that point round the loop and back to it, then reversed.
        let mut path: Vec<V> = (0..=polygon.len()).map(|k| polygon[(closest + k) % polygon.len()]).collect();
        path.reverse();
        let mut left = wipe_dist as f64;
        for i in 0..path.len() {
            if left < EPSILON {
                break;
            }
            self.add_wipe_point(path[i]);
            if i != 0 {
                let d = path[i] - path[i - 1];
                left -= ((d.x as f64).powi(2) + (d.y as f64).powi(2)).sqrt();
            }
        }
    }
}

fn closest_index(points: &[V], to: V) -> usize {
    // Orca compares in scaled integers; the order of the distances is the same.
    let mut best = 0;
    let mut best_d = f64::MAX;
    for (i, p) in points.iter().enumerate() {
        let d = ((p.x - to.x) as f64).powi(2) + ((p.y - to.y) as f64).powi(2);
        if d < best_d {
            best_d = d;
            best = i;
        }
    }
    best
}

/// Douglas–Peucker on an open polyline, to `tolerance` mm.
fn simplify_polyline(points: &[V], tolerance: f32) -> Vec<V> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let pts: Vec<Pt> = points.iter().map(|p| geom::pt(geom::sc(p.x as f64), geom::sc(p.y as f64))).collect();
    geom::simplify_line(&pts, tolerance as f64)
        .into_iter()
        .map(|p| v(geom::unsc(p.x) as f32, geom::unsc(p.y) as f32))
        .collect()
}

/// `WipeTower::rounding_polygon`: every corner sharper than 30° off straight rounded, 2 mm (or less, on short
/// edges) along each side, with `ARC_FIT_SIZE` points on the arc.
fn rounding_polygon(polygon: &[V], rounding: f64) -> Vec<V> {
    if polygon.len() < 3 {
        return polygon.to_vec();
    }
    let angle_tol = 30.0 / 180.0 * PI;
    let cos_tol = angle_tol.cos().abs();
    let n = polygon.len();
    let mut res: Vec<V> = Vec::with_capacity(n * (ARC_FIT_SIZE + 1));
    let d2 = |p: V| [p.x as f64, p.y as f64];
    for i in 0..n {
        let a = d2(polygon[(i + n - 1) % n]);
        let b = d2(polygon[i]);
        let c = d2(polygon[(i + 1) % n]);
        let ab_len = ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
        let bc_len = ((b[0] - c[0]).powi(2) + (b[1] - c[1]).powi(2)).sqrt();
        let ab = [(b[0] - a[0]) / ab_len, (b[1] - a[1]) / ab_len];
        let bc = [(c[0] - b[0]) / bc_len, (c[1] - b[1]) / bc_len];
        let cosangle = ((ab[0] * bc[0] + ab[1] * bc[1]) as f32).clamp(-1.0, 1.0);
        let is_ccw = ab[0] * bc[1] - ab[1] * bc[0] > 0.0;
        if (cosangle as f64).abs() < cos_tol {
            let real = rounding.min(ab_len / 2.1).min(bc_len / 2.1) as f32 as f64;
            let left = [b[0] - ab[0] * real, b[1] - ab[1] * real];
            let right = [b[0] + bc[0] * real, b[1] + bc[1] * real];
            let half_angle = (cosangle.acos() / 2.0) as f64;
            let mut dir = [right[0] - left[0], right[1] - left[1]];
            let len = (dir[0] * dir[0] + dir[1] * dir[1]).sqrt();
            dir = [dir[0] / len, dir[1] / len];
            dir = [-dir[1], dir[0]];
            if !is_ccw {
                dir = [-dir[0], -dir[1]];
            }
            let dis = real / half_angle.sin();
            let center = [b[0] + dir[0] * dis, b[1] + dir[1] * dis];
            let radius = ((left[0] - center[0]).powi(2) + (left[1] - center[1]).powi(2)).sqrt();
            // Orca's ArcSegment from left to right round the centre, in the turn's direction.
            let start = (left[1] - center[1]).atan2(left[0] - center[0]);
            let end = (right[1] - center[1]).atan2(right[0] - center[0]);
            let mut sweep = end - start;
            if is_ccw {
                while sweep <= 0.0 {
                    sweep += 2.0 * PI;
                }
            } else {
                while sweep >= 0.0 {
                    sweep -= 2.0 * PI;
                }
            }
            for j in 0..ARC_FIT_SIZE {
                let t = start + j as f64 / ARC_FIT_SIZE as f64 * sweep;
                res.push(v((center[0] + radius * t.cos()) as f32, (center[1] + radius * t.sin()) as f32));
            }
            res.push(v(right[0] as f32, right[1] as f32));
        } else {
            res.push(polygon[i]);
        }
    }
    res.dedup_by(|a, b| geom::sc(a.x as f64) == geom::sc(b.x as f64) && geom::sc(a.y as f64) == geom::sc(b.y as f64));
    while res.len() > 1
        && geom::sc(res[0].x as f64) == geom::sc(res[res.len() - 1].x as f64)
        && geom::sc(res[0].y as f64) == geom::sc(res[res.len() - 1].y as f64)
    {
        res.pop();
    }
    res
}

/// A rectangle `offset` mm either side of the line from `a` to `b` (`generate_rectange`).
fn rectangle_round_line(a: V, b: V, offset: f64) -> Vec<V> {
    let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
    let length = (dx * dx + dy * dy).sqrt();
    let (ux, uy) = (dx / length, dy / length);
    let (ox, oy) = (-uy * offset, ux * offset);
    let p = |x: f64, y: f64| v(x as f32, y as f32);
    vec![
        p(a.x as f64 + ox, a.y as f64 + oy),
        p(a.x as f64 - ox, a.y as f64 - oy),
        p(b.x as f64 - ox, b.y as f64 - oy),
        p(b.x as f64 + ox, b.y as f64 + oy),
    ]
}

fn to_contour(points: &[V]) -> Contour {
    let mut c: Contour = points.iter().map(|p| geom::pt(geom::sc(p.x as f64), geom::sc(p.y as f64))).collect();
    if geom::area2(&c) < 0 {
        c.reverse();
    }
    c
}

fn from_contour(c: &Contour) -> Vec<V> {
    c.iter().map(|p| v(geom::unsc(p.x) as f32, geom::unsc(p.y) as f32)).collect()
}

/// The outer contour of the union of loops.
fn union_outline(loops: &[Vec<V>]) -> Vec<V> {
    let contours: Vec<Contour> = loops.iter().map(|l| to_contour(l)).collect();
    let shapes = geom::union_contours(&contours);
    // The largest shape's outline (a tower's pieces always overlap into one).
    shapes
        .iter()
        .max_by_key(|s| s.first().map_or(0, |c| geom::area2(c)))
        .and_then(|s| s.first())
        .map(from_contour)
        .unwrap_or_default()
}

/// `move_point_along_polygon`: from `start` on edge `start_idx`, `offset` mm along the loop, forwards or back.
fn move_point_along_polygon(points: &[V], start: V, start_idx: usize, offset: f32, forward: bool) -> (V, usize, f32) {
    let m = points.len();
    let mut remaining = offset;
    if forward {
        let next = (start_idx + 1) % m;
        remaining -= (points[next] - start).norm();
        if remaining <= 0.0 {
            let pos = start + (points[next] - start).normalized() * offset;
            return (pos, start_idx, (points[start_idx] - pos).norm());
        }
        let mut i = (start_idx + 1) % m;
        while i != start_idx {
            let seg = (points[(i + 1) % m] - points[i]).norm();
            if remaining <= seg {
                let ratio = remaining / seg;
                let pos = points[i] + (points[(i + 1) % m] - points[i]) * ratio;
                return (pos, i, remaining);
            }
            remaining -= seg;
            i = (i + 1) % m;
        }
        let idx = (start_idx + m - 1) % m;
        let pos = points[start_idx];
        (pos, idx, (pos - points[idx]).norm())
    } else {
        let next = (start_idx + 1) % m;
        remaining -= (points[start_idx] - start).norm();
        if remaining <= 0.0 {
            let pos = start - (points[next] - points[start_idx]).normalized() * offset;
            return (pos, start_idx, (pos - points[start_idx]).norm());
        }
        let mut i = (start_idx + m - 1) % m;
        while i != start_idx {
            let seg = (points[(i + 1) % m] - points[i]).norm();
            if remaining <= seg {
                let ratio = remaining / seg;
                let pos = points[(i + 1) % m] - (points[(i + 1) % m] - points[i]) * ratio;
                return (pos, i, seg - remaining);
            }
            remaining -= seg;
            i = (i + m - 1) % m;
        }
        (points[start_idx], start_idx, 0.0)
    }
}

/// Where a ray from `a` along `v1` meets the segment `b`–`c` (`ray_intersetion_line`).
fn ray_intersection(a: V, v1: V, b: V, c: V) -> Option<V> {
    let v2 = c - b;
    let cross = |p: V, q: V| (p.x * q.y - p.y * q.x) as f64;
    let denom = cross(v1, v2);
    if denom.abs() < EPSILON {
        return None;
    }
    let v12 = a - b;
    let t1 = cross(v2, v12) / denom;
    let t2 = cross(v1, v12) / denom;
    (t1 >= 0.0 && (0.0..=1.0).contains(&t2)).then(|| a + v1 * t1 as f32)
}

/// `add_extra_point`: three points in the middle of the edge nearest the bottom middle of the loop, `range` apart,
/// so a gap never has to cut across a corner there.
fn add_extra_point(polygon: &[V], range: f32) -> Vec<V> {
    if polygon.len() < 2 {
        return polygon.to_vec();
    }
    let (mut min_x, mut max_x, mut min_y) = (f32::MAX, f32::MIN, f32::MAX);
    for p in polygon {
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
    }
    let anchor = v((min_x + max_x) / 2.0, min_y);
    let n = polygon.len();
    let mut closest_edge = 0;
    let mut min_d = f32::MAX;
    for i in 0..n {
        let mid = (polygon[i] + polygon[(i + 1) % n]) * 0.5;
        let d = (anchor - mid).squared_norm();
        if d < min_d {
            min_d = d;
            closest_edge = i;
        }
    }
    let (a, b) = (polygon[closest_edge], polygon[(closest_edge + 1) % n]);
    let mid = (a + b) * 0.5;
    let (to_a, to_b) = (a - mid, b - mid);
    let (len_a, len_b) = (to_a.norm(), to_b.norm());
    if (len_a as f64) < EPSILON || (len_b as f64) < EPSILON {
        return polygon.to_vec();
    }
    let range = range.min(len_a.min(len_b) * 0.9);
    let pa = mid + to_a * (1.0 / len_a) * range;
    let pb = mid + to_b * (1.0 / len_b) * range;
    let mut res = Vec::with_capacity(n + 3);
    for (i, &p) in polygon.iter().enumerate() {
        res.push(p);
        if i == closest_edge {
            res.extend([pa, mid, pb]);
        }
    }
    res
}

/// `remove_points_from_polygon` (through `construct_gap_for_skip_points`): the wall loop cut open `range` mm either
/// side of where each skip point's horizontal ray meets it; also the loop with the cut ends added (for the wipe).
fn gap_for_skip_points(polygon: &[V], skip_points: &[V], wt_width: f32, range: f32) -> (Vec<Vec<V>>, Vec<V>) {
    if skip_points.is_empty() {
        let mut closed = polygon.to_vec();
        if let Some(&f) = polygon.first() {
            closed.push(f);
        }
        return (vec![closed], polygon.to_vec());
    }
    let polygon = add_extra_point(polygon, range);
    if polygon.len() < 2 {
        return (vec![polygon.clone()], polygon);
    }
    let (mut min_x, mut max_x, mut min_y) = (f32::MAX, f32::MIN, f32::MAX);
    for p in &polygon {
        min_x = min_x.min(p.x);
        max_x = max_x.max(p.x);
        min_y = min_y.min(p.y);
    }
    let anchor = v(((min_x + max_x) / 2.0 * 1e6).trunc() / 1e6, min_y);
    let start = closest_index(&polygon, anchor);
    let points: Vec<V> = (0..polygon.len()).map(|k| polygon[(start + k) % polygon.len()]).collect();

    // (position, edge index, distance from the edge's start, pair, forward)
    let mut inter: Vec<(V, usize, f32, i64, bool)> = Vec::new();
    for (i, sp) in skip_points.iter().enumerate() {
        let is_left = sp.x.abs() < wt_width / 2.0;
        let ray = if is_left { v(-1.0, 0.0) } else { v(1.0, 0.0) };
        for j in 0..points.len() {
            let (p1, p2) = (points[j], points[(j + 1) % points.len()]);
            if let Some(at) = ray_intersection(*sp, ray, p1, p2) {
                let (fp, fi, fd) = move_point_along_polygon(&points, at, j, range, true);
                let (bp, bi, bd) = move_point_along_polygon(&points, at, j, range, false);
                inter.push((bp, bi, bd, i as i64, false));
                inter.push((fp, fi, fd, i as i64, true));
                break;
            }
        }
    }
    // (position, pair, forward)
    let mut new_pl: Vec<(V, i64, bool)> = points.iter().map(|&p| (p, -1, false)).collect();
    inter.sort_by(|a, b| if a.1 == b.1 { a.2.total_cmp(&b.2) } else { a.1.cmp(&b.1) });
    for &(pos, idx, _, pair, forward) in inter.iter().rev() {
        let next = (idx + 1) % new_pl.len();
        let (p1, p2) = (new_pl[idx].0, new_pl[next].0);
        if ((pos - p1).squared_norm() as f64) < EPSILON {
            new_pl[idx].1 = pair;
            new_pl[idx].2 = forward;
        } else if ((pos - p2).squared_norm() as f64) < EPSILON {
            new_pl[next].1 = pair;
            new_pl[next].2 = forward;
        } else {
            new_pl.insert(idx + 1, (pos, pair, forward));
        }
    }
    let with_cuts: Vec<V> = new_pl.iter().map(|p| p.0).collect();

    let mut result: Vec<Vec<V>> = Vec::new();
    let beg = 0;
    let mut skip = true;
    let mut i = beg;
    let mut pl: Vec<V> = Vec::new();
    let n = new_pl.len();
    loop {
        if skip || new_pl[i].1 == -1 {
            pl.push(new_pl[i].0);
            i = (i + 1) % n;
            skip = false;
        } else {
            if !pl.is_empty() {
                pl.push(new_pl[i].0);
                result.push(std::mem::take(&mut pl));
            }
            let mut left = new_pl[i].1;
            let mut j = (i + 1) % n;
            while j != beg && new_pl[j].1 != left {
                if new_pl[j].1 != -1 && !new_pl[j].2 {
                    left = new_pl[j].1;
                }
                j = (j + 1) % n;
            }
            i = j;
            skip = true;
        }
        if i == beg {
            break;
        }
    }
    if !pl.is_empty() {
        if new_pl[i].1 == -1 {
            pl.push(new_pl[i].0);
        }
        result.push(pl);
    }
    (result, with_cuts)
}

/// The prime tower being planned and generated (`WipeTower`).
pub struct WipeTower {
    params: Arc<Params>,
    filpar: Arc<Vec<Filament>>,
    wipe_tower_pos: V,
    wipe_tower_width: f32,
    wipe_tower_depth: f32,
    wipe_tower_height: f32,
    brim_width: f32,
    brim_width_real: f32,
    y_shift: f32,
    z_pos: f32,
    layer_height: f32,
    num_layer_changes: u32,
    num_tool_changes: u32,
    current_tool: usize,
    perimeter_width: f32,
    nozzle_change_perimeter_width: f32,
    extrusion_flow: f32,
    extra_spacing: f32,
    rib_length: f32,
    rib_width: f32,
    rib_offset: V,
    left_to_right: bool,
    current_layer_finished: bool,
    first_layer_idx: Option<usize>,
    plan: Vec<LayerInfo>,
    layer_info: usize,
    cur_layer_id: usize,
    blocks: Vec<Block>,
    cur_block: Option<usize>,
    all_layers_depth: Vec<Vec<BlockDepthInfo>>,
    block_infill_gap_width: HashMap<i32, (f32, f32)>,
    last_layer_id: Vec<i64>,
    wall_skip_points: Vec<Vec<V>>,
    outer_wall: Vec<(f32, Vec<Vec<V>>)>,
    used_filament_length: Vec<f32>,
    nozzle_change_result: NozzleChange,
    contact_speed: f32,
    bridging: f32,
}

fn align_round(value: f32, base: f32) -> f32 {
    (value / base).round() * base
}

fn align_ceil(value: f32, base: f32) -> f32 {
    (value / base).ceil() * base
}

fn align_floor(value: f32, base: f32) -> f32 {
    (value / base).floor() * base
}

/// The least depth a tower this tall keeps (`get_limit_depth_by_height`).
pub fn limit_depth_by_height(max_height: f32) -> f32 {
    let table = MIN_DEPTH_PER_HEIGHT;
    for (k, &(h, d)) in table.iter().enumerate() {
        if h >= max_height {
            return d;
        }
        if k + 1 == table.len() {
            return d;
        }
        let (h2, d2) = table[k + 1];
        if h2 > max_height {
            return d + (max_height - h) / (h2 - h) * (d2 - d);
        }
    }
    0.0
}

/// The brim a tower this tall gets when the setting leaves it to the tower (`get_auto_brim_by_height`).
pub fn auto_brim_by_height(max_height: f32) -> f32 {
    if max_height < 100.0 { max_height / 100.0 * 8.0 } else { 8.0 }
}

impl WipeTower {
    pub fn new(params: Params, filpar: Vec<Filament>, initial_tool: usize, height: f32) -> WipeTower {
        let nozzle = filpar.first().map_or(0.4, |f| f.nozzle_diameter);
        let perimeter_width = nozzle * WIDTH_TO_NOZZLE_RATIO;
        let nozzle_change_perimeter_width = match nozzle {
            d if (d - 0.2).abs() < 1e-6 => 0.5,
            d if (d - 0.4).abs() < 1e-6 => 1.0,
            d if (d - 0.6).abs() < 1e-6 => 1.2,
            d if (d - 0.8).abs() < 1e-6 => 1.4,
            _ => 2.0 * perimeter_width,
        };
        let extruders = params.printable_height.len().max(1);
        let n = filpar.len();
        WipeTower {
            wipe_tower_pos: v(params.position[0], params.position[1]),
            wipe_tower_width: params.width,
            wipe_tower_depth: 0.0,
            wipe_tower_height: height,
            brim_width: params.brim_width,
            brim_width_real: 0.0,
            y_shift: 0.0,
            z_pos: 0.0,
            layer_height: 0.0,
            num_layer_changes: 0,
            num_tool_changes: 0,
            current_tool: initial_tool,
            perimeter_width,
            nozzle_change_perimeter_width,
            extrusion_flow: 0.038,
            extra_spacing: params.extra_spacing,
            rib_length: 0.0,
            rib_width: params.rib_width,
            rib_offset: V::default(),
            left_to_right: true,
            current_layer_finished: false,
            first_layer_idx: None,
            plan: Vec::new(),
            layer_info: 0,
            cur_layer_id: 0,
            blocks: Vec::new(),
            cur_block: None,
            all_layers_depth: Vec::new(),
            block_infill_gap_width: HashMap::new(),
            last_layer_id: vec![-1; extruders],
            wall_skip_points: Vec::new(),
            outer_wall: Vec::new(),
            used_filament_length: vec![0.0; n],
            nozzle_change_result: NozzleChange::default(),
            contact_speed: 20.0 * 60.0,
            bridging: 10.0,
            filpar: Arc::new(filpar),
            params: Arc::new(params),
        }
    }

    pub fn width(&self) -> f32 {
        self.wipe_tower_width
    }

    pub fn depth(&self) -> f32 {
        self.wipe_tower_depth
    }

    /// The brim's width as printed (`get_brim_width`, which Orca keeps apart from the setting).
    pub fn brim_width_printed(&self) -> f32 {
        self.brim_width_real
    }

    pub fn position(&self) -> V {
        self.wipe_tower_pos
    }

    pub fn rib_offset(&self) -> V {
        self.rib_offset
    }

    /// mm of filament each filament spent on the tower.
    pub fn used_filament(&self) -> &[f32] {
        &self.used_filament_length
    }

    /// The bounding box of the tower's first-layer wall and brim, in the tower's frame (`get_bbx`).
    pub fn bbx(&self) -> [f32; 4] {
        let Some((_, walls)) = self.outer_wall.first() else { return [0.0; 4] };
        let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for p in walls.iter().flatten() {
            b = [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)];
        }
        if b[0] > b[2] { [0.0; 4] } else { b }
    }

    fn extruder(&self, filament: usize) -> usize {
        self.params.extruder_of.get(filament).copied().unwrap_or(0)
    }

    fn is_need_ramming(&self, a: usize, b: usize) -> bool {
        self.extruder(a) != self.extruder(b)
    }

    fn is_same_extruder(&self, a: usize, b: usize) -> bool {
        self.extruder(a) == self.extruder(b)
    }

    fn is_same_nozzle(&self, a: usize, b: usize) -> bool {
        self.extruder(a) == self.extruder(b)
    }

    fn filament_area(&self) -> f32 {
        self.filpar[0].filament_area
    }

    fn extrusion_flow(&self, layer_height: f32) -> f32 {
        layer_height * (self.perimeter_width - layer_height * (1.0 - PI_F32 / 4.0)) / self.filament_area()
    }

    fn nozzle_change_extrusion_flow(&self, layer_height: f32) -> f32 {
        layer_height * (self.nozzle_change_perimeter_width - layer_height * (1.0 - PI_F32 / 4.0)) / self.filament_area()
    }

    fn volume_to_length(&self, volume: f32, line_width: f32, layer_height: f32) -> f32 {
        (volume / (layer_height * (line_width - layer_height * (1.0 - PI_F32 / 4.0)))).max(0.0)
    }

    fn change_length(&self, extruder_change: bool, tool: usize) -> f32 {
        let list = if extruder_change { &self.params.change_length.0 } else { &self.params.change_length.1 };
        list.get(tool).or(list.first()).copied().unwrap_or(0.0) as f32
    }

    fn is_need_reverse_travel(&self, filament: usize, extruder_change: bool) -> bool {
        let fp = &self.filpar[filament];
        if extruder_change {
            fp.ramming_travel_time.0 as f64 > EPSILON && self.change_length(true, filament) as f64 > EPSILON
        } else {
            fp.ramming_travel_time.1 as f64 > EPSILON && self.change_length(false, filament) as f64 > EPSILON
        }
    }

    fn is_first_layer(&self) -> bool {
        Some(self.layer_info) == self.first_layer_idx
    }

    fn category(&self, filament: usize) -> i32 {
        self.filpar.get(filament).map_or(0, |f| f.category)
    }

    fn block_gap_width(&self, tool: usize, nozzle_change: bool) -> f32 {
        match self.block_infill_gap_width.get(&self.filpar[tool].category) {
            Some(&(tc, nc)) => {
                if nozzle_change {
                    nc
                } else {
                    tc
                }
            }
            None => {
                if nozzle_change {
                    self.nozzle_change_perimeter_width
                } else {
                    self.perimeter_width
                }
            }
        }
    }

    fn is_valid_last_layer(&self, tool: usize, layer_id: usize, layer_z: f64) -> bool {
        let e = self.extruder(tool);
        if e >= self.params.printable_height.len() {
            return true;
        }
        !(self.last_layer_id[e] == layer_id as i64 && layer_z > self.params.printable_height[e])
    }

    /// Adds a tool change (or, `old == new`, a layer without one) to the plan (`plan_toolchange`). Volumes in mm³.
    #[allow(clippy::too_many_arguments)]
    pub fn plan_toolchange(
        &mut self,
        z: f32,
        layer_height: f32,
        old_tool: usize,
        new_tool: usize,
        wipe_volume_ec: f32,
        wipe_volume_nc: f32,
        purge_volume: f32,
    ) {
        if self.plan.last().is_none_or(|l| l.z + WT_EPSILON < z) {
            self.plan.push(LayerInfo {
                z,
                height: layer_height,
                depth: 0.0,
                extra_spacing: 1.0,
                extruder_fill: true,
                tool_changes: Vec::new(),
            });
        }
        if self.first_layer_idx.is_none() {
            self.first_layer_idx = Some(self.plan.len() - 1);
        }
        if old_tool == new_tool {
            return;
        }
        let width = self.wipe_tower_width - 2.0 * self.perimeter_width;
        if (width as f64) <= EPSILON {
            return;
        }
        let wipe_volume = if self.is_same_extruder(old_tool, new_tool) && !self.is_same_nozzle(old_tool, new_tool) {
            wipe_volume_nc
        } else {
            wipe_volume_ec
        };
        let length_to_extrude = self.volume_to_length(wipe_volume, self.perimeter_width, layer_height);
        let mut depth = (length_to_extrude / width).ceil() * self.perimeter_width;
        let change_length = self.change_length(!self.is_same_extruder(old_tool, new_tool), old_tool);
        let (mut nc_depth, mut nc_length) = (0.0, 0.0);
        if self.is_need_ramming(old_tool, new_tool) {
            let e_flow = self.nozzle_change_extrusion_flow(layer_height) as f64;
            let length = change_length as f64 / e_flow;
            let lines = (length / (self.wipe_tower_width - 2.0 * self.nozzle_change_perimeter_width) as f64).ceil();
            nc_depth = lines as f32 * self.nozzle_change_perimeter_width;
            depth += nc_depth;
            nc_length = length as f32;
        }
        self.plan.last_mut().unwrap().tool_changes.push(ToolChange {
            old_tool,
            new_tool,
            required_depth: depth,
            wipe_volume,
            wipe_length: length_to_extrude,
            nozzle_change_depth: nc_depth,
            nozzle_change_length: nc_length,
            purge_volume,
        });
    }

    /// `set_toolchange`: a tool change's room again, at the blocks' gaps.
    fn set_toolchange(&self, t: &ToolChange, layer_height: f32) -> ToolChange {
        let width = self.wipe_tower_width - 2.0 * self.perimeter_width;
        let nc_width = self.wipe_tower_width - (self.nozzle_change_perimeter_width + self.perimeter_width);
        let length_to_extrude = self.volume_to_length(t.wipe_volume, self.perimeter_width, layer_height);
        let toolchange_gap = self.block_gap_width(t.new_tool, false);
        let nozzlechange_gap = self.block_gap_width(t.old_tool, true);
        let change_length = self.change_length(!self.is_same_extruder(t.old_tool, t.new_tool), t.old_tool);
        let mut depth = (length_to_extrude / width).ceil() * toolchange_gap;
        let (mut nc_depth, mut nc_length) = (0.0, 0.0);
        if self.is_need_ramming(t.old_tool, t.new_tool) {
            let e_flow = self.nozzle_change_extrusion_flow(layer_height) as f64;
            let length = change_length as f64 / e_flow;
            let lines = (length / nc_width as f64).ceil() as i32;
            nc_depth = lines as f32 * nozzlechange_gap;
            depth += nc_depth;
            nc_length = length as f32;
        }
        ToolChange {
            old_tool: t.old_tool,
            new_tool: t.new_tool,
            required_depth: depth,
            wipe_volume: t.wipe_volume,
            wipe_length: length_to_extrude,
            nozzle_change_depth: nc_depth,
            nozzle_change_length: nc_length,
            purge_volume: t.purge_volume,
        }
    }

    fn block_index(&self, category: i32) -> Option<usize> {
        self.blocks.iter().position(|b| b.category == category)
    }

    fn block_by_category(&mut self, category: i32, create: bool) -> Option<usize> {
        if let Some(i) = self.block_index(category) {
            return Some(i);
        }
        if !create {
            return None;
        }
        self.blocks.push(Block {
            block_id: self.blocks.len(),
            category,
            layer_depths: Vec::new(),
            finish_depth: vec![0.0],
            layers_type: Vec::new(),
            depth: 0.0,
            start_depth: 0.0,
            cur_depth: 0.0,
            last_filament_change_id: -1,
            last_nozzle_change_id: -1,
        });
        Some(self.blocks.len() - 1)
    }

    fn add_depth_to_block(&mut self, category: i32, depth: f32, is_nozzle_change: bool) {
        let layer = &mut self.all_layers_depth[self.cur_layer_id];
        if let Some(b) = layer.iter_mut().find(|b| b.category == category) {
            b.depth += depth;
            if is_nozzle_change {
                b.nozzle_change_depth += depth;
            }
        } else {
            layer.push(BlockDepthInfo {
                category,
                depth,
                nozzle_change_depth: if is_nozzle_change { depth } else { 0.0 },
            });
        }
    }

    fn reset_block_status(&mut self) {
        for b in &mut self.blocks {
            b.cur_depth = b.start_depth;
            b.last_filament_change_id = -1;
            b.last_nozzle_change_id = -1;
        }
    }

    fn set_nozzle_last_layer_id(&mut self) {
        for idx in 0..self.plan.len() {
            for i in 0..self.plan[idx].tool_changes.len() {
                let t = self.plan[idx].tool_changes[i];
                for f in [t.old_tool, t.new_tool] {
                    let e = self.extruder(f);
                    if e < self.last_layer_id.len() {
                        self.last_layer_id[e] = idx as i64;
                    }
                }
            }
        }
    }

    fn update_all_layer_depth(&mut self) {
        self.wipe_tower_depth = 0.0;
        let start_offset = self.perimeter_width;
        let mut start_depth = start_offset;
        let extra = self.extra_spacing;
        for k in 0..self.blocks.len() {
            let b = &mut self.blocks[k];
            b.depth *= extra;
            b.start_depth = start_depth;
            start_depth += b.depth;
            self.wipe_tower_depth += b.depth;
            for d in &mut b.layer_depths {
                *d *= extra;
            }
            for info in &mut self.plan {
                info.depth *= extra;
            }
        }
        if self.wipe_tower_depth > 0.0 {
            self.wipe_tower_depth += start_offset;
        }
    }

    fn generate_wipe_tower_blocks(&mut self, add_solid_flag: bool) {
        // 1. Each layer's depth per category.
        self.all_layers_depth = vec![Vec::new(); self.plan.len()];
        self.cur_layer_id = 0;
        for idx in 0..self.plan.len() {
            self.cur_layer_id = idx;
            for i in 0..self.plan[idx].tool_changes.len() {
                let t = self.plan[idx].tool_changes[i];
                if !self.is_need_ramming(t.old_tool, t.new_tool) {
                    let c = self.category(t.new_tool);
                    self.add_depth_to_block(c, t.required_depth, false);
                } else {
                    let c_old = self.category(t.old_tool);
                    self.add_depth_to_block(c_old, t.nozzle_change_depth, true);
                    let c_new = self.category(t.new_tool);
                    self.add_depth_to_block(c_new, t.required_depth - t.nozzle_change_depth, false);
                }
            }
        }
        self.cur_layer_id = self.plan.len();
        // 2. … as maps.
        let n = self.plan.len();
        let per_layer: Vec<Vec<(i32, f32)>> =
            self.all_layers_depth.iter().map(|layer| layer.iter().map(|b| (b.category, b.depth)).collect()).collect();
        // 3. The blocks, in the order their categories first appear.
        self.blocks.clear();
        for (layer_id, layer) in per_layer.iter().enumerate() {
            for &(category, depth) in layer {
                let i = self.block_by_category(category, true).unwrap();
                let b = &mut self.blocks[i];
                if b.layer_depths.is_empty() {
                    b.layer_depths = vec![0.0; n];
                    b.finish_depth = vec![0.0; n];
                    b.layers_type = vec![LayerType::Normal; n];
                }
                b.depth = b.depth.max(depth);
                b.layer_depths[layer_id] = depth;
            }
        }
        // 4. Each layer at least as deep as the one above.
        for layer_id in (0..n).rev() {
            self.plan[layer_id].depth = 0.0;
            for b in &mut self.blocks {
                if layer_id + 1 < n {
                    b.layer_depths[layer_id] = b.layer_depths[layer_id].max(b.layer_depths[layer_id + 1]);
                }
                self.plan[layer_id].depth += b.layer_depths[layer_id];
            }
        }
        if self.params.tower_framework {
            for layer_id in 1..n {
                self.plan[layer_id].depth = 0.0;
                for b in &mut self.blocks {
                    b.layer_depths[layer_id] = b.layer_depths[0];
                    self.plan[layer_id].depth += b.layer_depths[layer_id];
                }
            }
        }
        if add_solid_flag {
            const SOLID_INFILL_LAYER_LOW: usize = 4;
            let mut first_tool: Option<usize> = None;
            for layer in &self.plan {
                if let Some(t) = layer.tool_changes.first() {
                    first_tool = Some(t.old_tool);
                    break;
                }
            }
            let mut layers_used: Vec<Vec<i32>> = Vec::with_capacity(n);
            for info in &self.plan {
                let mut used: Vec<i32> = Vec::new();
                if info.tool_changes.is_empty() {
                    used.push(first_tool.map_or(0, |t| self.category(t)));
                } else {
                    for t in &info.tool_changes {
                        used.push(self.category(t.old_tool));
                        used.push(self.category(t.new_tool));
                    }
                    first_tool = Some(info.tool_changes.last().unwrap().new_tool);
                }
                layers_used.push(used);
            }
            let pw = self.perimeter_width;
            for b in &mut self.blocks {
                for layer_id in 0..n {
                    let depth_here = per_layer[layer_id].iter().find(|(c, _)| *c == b.category).map_or(0.0, |x| x.1);
                    if depth_here < b.layer_depths[layer_id] - pw {
                        let cur_has = layers_used[layer_id].contains(&b.category);
                        let mut count = SOLID_INFILL_LAYER_LOW;
                        while count > 0 {
                            if layer_id + count < n {
                                let up_has = layers_used[layer_id + count].contains(&b.category);
                                if cur_has != up_has {
                                    b.layers_type[layer_id] = LayerType::Solid;
                                    break;
                                }
                            }
                            count -= 1;
                        }
                    }
                    if layer_id > 0 {
                        let cur_has = layers_used[layer_id].contains(&b.category);
                        let pre_has = layers_used[layer_id - 1].contains(&b.category);
                        if cur_has != pre_has {
                            b.layers_type[layer_id] = LayerType::Contact;
                        }
                        if b.layers_type[layer_id - 1] == LayerType::Contact
                            && b.layers_type[layer_id] != LayerType::Contact
                        {
                            b.layers_type[layer_id] = LayerType::ContactUp;
                        }
                    }
                }
            }
        }
    }

    fn calc_block_infill_gap(&mut self) {
        #[derive(Clone, Copy, Default)]
        struct Info {
            has_ramming: bool,
            has_reverse_travel: bool,
            depth: f32,
        }
        let mut block_info: Vec<(i32, Info)> = Vec::new();
        let mut high: Vec<(i32, Info)> = Vec::new();
        let get = |list: &mut Vec<(i32, Info)>, c: i32| -> usize {
            match list.iter().position(|x| x.0 == c) {
                Some(i) => i,
                None => {
                    list.push((c, Info::default()));
                    list.len() - 1
                }
            }
        };
        for i in (0..self.plan.len()).rev() {
            for t in self.plan[i].tool_changes.clone() {
                if self.is_need_ramming(t.old_tool, t.new_tool) {
                    let extruder_change = !self.is_same_extruder(t.new_tool, t.old_tool);
                    let k = get(&mut block_info, self.filpar[t.old_tool].category);
                    block_info[k].1.has_ramming = true;
                    if self.is_need_reverse_travel(t.old_tool, extruder_change) {
                        block_info[k].1.has_reverse_travel = true;
                    }
                    block_info[k].1.depth += t.nozzle_change_depth;
                }
                let k = get(&mut block_info, self.filpar[t.new_tool].category);
                block_info[k].1.depth += t.required_depth - t.nozzle_change_depth;
            }
            for b in &mut block_info {
                if let Some(h) = high.iter().find(|h| h.0 == b.0)
                    && h.1.depth > b.1.depth
                {
                    b.1.depth = h.1.depth;
                }
            }
            high = block_info.clone();
            for b in &mut block_info {
                b.1.depth = 0.0;
            }
            if i == 0 {
                block_info = high.clone();
            }
        }
        let max_depth: f32 = block_info.iter().map(|b| b.1.depth).sum();
        let height_to_depth = limit_depth_by_height(self.wipe_tower_height);
        let height_to_spacing = if max_depth > height_to_depth { 1.0 } else { height_to_depth / max_depth };
        let extra_width = (self.extra_spacing - 1.0) * self.perimeter_width;
        let (pw, ncpw) = (self.perimeter_width, self.nozzle_change_perimeter_width);
        let line_gap_tol = 2.0 * ncpw;
        let tpu_extra = 2.0 - 1.0;
        for (category, info) in &block_info {
            let gaps = if !info.has_ramming {
                (extra_width + pw, extra_width + pw)
            } else if !info.has_reverse_travel {
                let mut line_gap = ncpw + extra_width;
                if !self.params.use_rib_wall {
                    line_gap *= height_to_spacing;
                }
                if line_gap < line_gap_tol {
                    (pw + extra_width, ncpw + extra_width)
                } else {
                    (ncpw + extra_width, ncpw + extra_width)
                }
            } else {
                let mut line_gap = ncpw + (tpu_extra * pw).max(extra_width);
                if !self.params.use_rib_wall {
                    line_gap *= height_to_spacing;
                }
                let nc = ncpw + (tpu_extra * pw).max(extra_width);
                if line_gap < line_gap_tol { (pw + extra_width, nc) } else { (nc, nc) }
            };
            self.block_infill_gap_width.insert(*category, gaps);
        }
        for idx in 0..self.plan.len() {
            let h = self.plan[idx].height;
            for k in 0..self.plan[idx].tool_changes.len() {
                let t = self.plan[idx].tool_changes[k];
                self.plan[idx].tool_changes[k] = self.set_toolchange(&t, h);
            }
        }
        self.extra_spacing = 1.0;
    }

    fn plan_tower_new(&mut self) {
        if self.brim_width < 0.0 {
            self.brim_width = auto_brim_by_height(self.wipe_tower_height);
        }
        self.calc_block_infill_gap();
        if self.params.use_rib_wall {
            self.generate_wipe_tower_blocks(false);
            let max_depth: f32 = self.blocks.iter().map(|b| b.depth).sum::<f32>() + self.perimeter_width;
            let square =
                align_ceil((max_depth * self.wipe_tower_width * self.extra_spacing).sqrt(), self.perimeter_width);
            self.wipe_tower_width = square;
            for idx in 0..self.plan.len() {
                let h = self.plan[idx].height;
                for k in 0..self.plan[idx].tool_changes.len() {
                    let t = self.plan[idx].tool_changes[k];
                    self.plan[idx].tool_changes[k] = self.set_toolchange(&t, h);
                }
            }
        }
        self.generate_wipe_tower_blocks(true);
        let max_depth: f32 = self.blocks.iter().map(|b| b.depth).sum();
        let min_depth = limit_depth_by_height(self.wipe_tower_height);
        if max_depth + (EPSILON as f32) < min_depth {
            if self.params.use_rib_wall {
                self.rib_length = self.rib_length.max(min_depth * 2f32.sqrt());
            } else {
                self.extra_spacing = (min_depth / max_depth).max(self.extra_spacing);
            }
        }
        let (pw, ncpw, extra) = (self.perimeter_width, self.nozzle_change_perimeter_width, self.extra_spacing);
        let tower_width = self.wipe_tower_width;
        for idx in 0..self.plan.len() {
            let h = self.plan[idx].height;
            if idx == 0 {
                self.plan[idx].extra_spacing = 1.0;
                for t in &mut self.plan[idx].tool_changes {
                    let line_len = tower_width - 2.0 * pw;
                    let wipe_depth = (t.required_depth - t.nozzle_change_depth) * extra;
                    let wipe_line_count = wipe_depth / pw;
                    let nc_depth = t.nozzle_change_depth * extra;
                    let nc_lines = ((t.nozzle_change_depth * extra + WT_EPSILON) / ncpw) as i32;
                    t.required_depth = wipe_depth + nc_depth;
                    t.wipe_length = wipe_line_count * line_len;
                    t.wipe_volume = (t.wipe_length * (h * (pw - h * (1.0 - PI_F32 / 4.0)))).max(0.0);
                    t.nozzle_change_length = nc_lines as f32 * (tower_width - (ncpw + pw));
                    t.nozzle_change_depth = nc_depth;
                }
            } else {
                self.plan[idx].extra_spacing = extra;
                for t in &mut self.plan[idx].tool_changes {
                    t.required_depth *= extra;
                    t.nozzle_change_depth *= extra;
                    t.wipe_length = (t.wipe_volume / (h * (pw - h * (1.0 - PI_F32 / 4.0)))).max(0.0);
                }
            }
        }
        self.update_all_layer_depth();
        self.set_nozzle_last_layer_id();
        if self.params.use_gap_wall {
            self.get_all_wall_skip_points();
        }
        let diagonal =
            (self.wipe_tower_depth * self.wipe_tower_depth + self.wipe_tower_width * self.wipe_tower_width).sqrt();
        self.rib_length = self.rib_length.max(diagonal);
        self.rib_length += self.params.extra_rib_length;
        self.rib_length = diagonal.max(self.rib_length);
        self.rib_width = self.rib_width.min(self.wipe_tower_depth.min(self.wipe_tower_width) / 2.0);
    }

    fn get_all_wall_skip_points(&mut self) {
        self.wall_skip_points = vec![Vec::new(); self.plan.len()];
        for i in 0..self.plan.len() {
            self.get_wall_skip_points(i);
        }
    }

    fn get_wall_skip_points(&mut self, layer_id: usize) {
        const PRE_ACCESS_LAYER: usize = 4;
        let layer = self.plan[layer_id].clone();
        let mut cur_block_depth: Vec<(i32, f32)> = Vec::new();
        let get = |list: &[(i32, f32)], c: i32| list.iter().find(|x| x.0 == c).map(|x| x.1);
        let set = |list: &mut Vec<(i32, f32)>, c: i32, d: f32| match list.iter_mut().find(|x| x.0 == c) {
            Some(x) => x.1 = d,
            None => list.push((c, d)),
        };
        for t in &layer.tool_changes {
            let (old, new) = (t.old_tool, t.new_tool);
            let mut nc_depth = t.nozzle_change_depth;
            let wipe_depth = t.required_depth - nc_depth;
            if !self.is_valid_last_layer(old, layer_id, self.plan[layer_id].z as f64) {
                nc_depth = 0.0;
            }
            let new_cat = self.filpar[new].category;
            let Some(bi) = self.block_index(new_cat) else { continue };
            if get(&cur_block_depth, new_cat).is_none() {
                set(&mut cur_block_depth, new_cat, self.blocks[bi].start_depth);
            }
            let mut process_depth = get(&cur_block_depth, new_cat).unwrap();
            if self.is_need_ramming(new, old) {
                if self.category(new) == self.category(old) {
                    process_depth += nc_depth;
                } else {
                    let old_cat = self.filpar[old].category;
                    if get(&cur_block_depth, old_cat).is_none() {
                        let Some(ob) = self.block_index(old_cat) else { continue };
                        set(&mut cur_block_depth, old_cat, self.blocks[ob].start_depth);
                    }
                    let d = get(&cur_block_depth, old_cat).unwrap() + nc_depth;
                    set(&mut cur_block_depth, old_cat, d);
                }
            }
            let gap = self.block_gap_width(new, false);
            let es = self.plan[layer_id].extra_spacing;
            let w = self.wipe_tower_width;
            let res = match layer_id % 4 {
                0 => v(0.0, process_depth),
                1 => v(w, process_depth + wipe_depth - es * gap),
                2 => v(w, process_depth),
                _ => v(0.0, process_depth + wipe_depth - es * gap),
            };
            self.wall_skip_points[layer_id].push(res);
            set(&mut cur_block_depth, new_cat, process_depth + wipe_depth);
            let solid = self.blocks[bi].layers_type[layer_id] == LayerType::Contact;
            if solid && self.params.enable_tower_interface_features {
                for j in 0..PRE_ACCESS_LAYER {
                    if j > layer_id {
                        break;
                    }
                    self.wall_skip_points[layer_id - j].push(res);
                }
            }
        }
        if self.params.enable_tower_interface_features {
            let pw = self.perimeter_width;
            for k in 0..self.blocks.len() {
                let b = &self.blocks[k];
                let block_depth = get(&cur_block_depth, b.category).unwrap_or(b.start_depth);
                if (block_depth as f64 + EPSILON) as f32 >= b.start_depth + b.layer_depths[layer_id] - pw {
                    continue;
                }
                let solid = b.layers_type[layer_id] == LayerType::Contact;
                if solid && ((block_depth - b.start_depth).abs() as f64) < EPSILON {
                    let dy = b.layer_depths[layer_id] - pw;
                    let n_skip = ((dy + 0.25 * pw) / pw + 1.0) as i32;
                    let grid_depth = pw * (n_skip - 1) as f32;
                    let w = self.wipe_tower_width;
                    let res = match layer_id % 4 {
                        0 => v(0.0, block_depth),
                        1 => v(w, block_depth + grid_depth),
                        2 => v(w, block_depth),
                        _ => v(0.0, block_depth + grid_depth),
                    };
                    self.wall_skip_points[layer_id].push(res);
                    for j in 0..PRE_ACCESS_LAYER {
                        if j > layer_id {
                            break;
                        }
                        self.wall_skip_points[layer_id - j].push(res);
                    }
                }
            }
        }
    }

    fn get_wall_filament_for_all_layer(&self) -> Option<usize> {
        let mut category_counts: Vec<(i32, i32)> = Vec::new();
        let mut filament_counts: Vec<(usize, i32)> = Vec::new();
        fn bump<K: PartialEq + Ord + Copy>(list: &mut Vec<(K, i32)>, k: K) {
            match list.iter_mut().find(|x| x.0 == k) {
                Some(x) => x.1 += 1,
                None => {
                    list.push((k, 1));
                    list.sort_by_key(|a| a.0);
                }
            }
        }
        let mut current = self.current_tool;
        for layer in &self.plan {
            if layer.tool_changes.is_empty() {
                bump(&mut filament_counts, current);
                bump(&mut category_counts, self.category(current));
                continue;
            }
            let mut used_tools: Vec<usize> = Vec::new();
            let mut used_cat: Vec<i32> = Vec::new();
            for (i, t) in layer.tool_changes.iter().enumerate() {
                if i == 0 {
                    bump(&mut filament_counts, t.old_tool);
                    bump(&mut category_counts, self.category(t.old_tool));
                    used_tools.push(t.old_tool);
                    used_cat.push(self.category(t.old_tool));
                }
                if !used_cat.contains(&self.category(t.new_tool)) {
                    bump(&mut category_counts, self.category(t.new_tool));
                }
                if !used_tools.contains(&t.new_tool) {
                    bump(&mut filament_counts, t.new_tool);
                }
                used_tools.push(t.new_tool);
                used_cat.push(self.category(t.new_tool));
            }
            current = layer.tool_changes.last().unwrap().new_tool;
        }
        let mut selected_category = -1;
        let mut selected_count = 0;
        for &(c, n) in &category_counts {
            if n > selected_count {
                selected_category = c;
                selected_count = n;
            }
        }
        let mut filament = None;
        let mut count = 0;
        for &(f, n) in &filament_counts {
            if self.category(f) == selected_category && n > count {
                filament = Some(f);
                count = n;
            }
        }
        filament
    }

    fn set_layer(&mut self, z: f32, layer_height: f32, is_first_layer: bool) {
        self.z_pos = z;
        self.layer_height = layer_height;
        self.current_layer_finished = false;
        if is_first_layer {
            self.num_layer_changes = 0;
            self.num_tool_changes = 0;
        } else {
            self.num_layer_changes += 1;
        }
        self.extrusion_flow = self.extrusion_flow(layer_height);
        while self.layer_info + 1 < self.plan.len() && self.plan[self.layer_info].z < z - WT_EPSILON {
            self.layer_info += 1;
        }
    }

    fn get_floating_area(&self) -> Option<(f32, f32)> {
        if self.layer_info == 0 || self.layer_info == 1 {
            return None;
        }
        let b = &self.blocks[self.cur_block?];
        let end = b.start_depth + b.depth - self.perimeter_width;
        let start = b.finish_depth[self.cur_layer_id - 1];
        Some((start, end))
    }

    fn need_thick_bridge_flow(&self, pos_y: f32) -> bool {
        if self.layer_height >= 0.2 {
            return false;
        }
        match self.get_floating_area() {
            Some((lo, hi)) => pos_y > lo && pos_y < hi,
            None => false,
        }
    }

    fn writer(&self, layer_height: f32, line_width: f32) -> Writer {
        let mut w = Writer::new(layer_height, line_width, self.filpar.clone(), self.params.clone());
        w.first_layer = self.cur_layer_id == 0;
        w
    }

    fn piece(
        &self,
        w: Writer,
        old_tool: usize,
        is_finish: bool,
        is_tool_change: bool,
        purge: f32,
        contact: bool,
    ) -> Piece {
        let start_pos = w.start_pos;
        Piece {
            print_z: self.z_pos,
            layer_height: self.layer_height,
            start_pos,
            end_pos: w.pos_rotated(),
            gcode: w.gcode,
            wipe_path: w.wipe_path,
            purge_volume: purge,
            initial_tool: old_tool,
            new_tool: self.current_tool,
            is_finish_first: is_finish,
            is_tool_change,
            tool_change_start_pos: if is_tool_change { start_pos } else { V::default() },
            is_contact: contact,
            nozzle_change: self.nozzle_change_result.clone(),
        }
    }

    fn block_piece(&self, w: Writer, filament: usize) -> Piece {
        let start_pos = w.start_pos;
        Piece {
            print_z: self.z_pos,
            layer_height: self.layer_height,
            start_pos,
            end_pos: w.pos_rotated(),
            gcode: w.gcode,
            wipe_path: w.wipe_path,
            purge_volume: 0.0,
            initial_tool: filament,
            new_tool: filament,
            is_finish_first: true,
            is_tool_change: false,
            tool_change_start_pos: V::default(),
            is_contact: false,
            nozzle_change: NozzleChange::default(),
        }
    }

    fn merge(&self, first: &Piece, second: &Piece) -> Piece {
        let mut out = first.clone();
        if ((first.end_pos - second.start_pos).norm() as f64) > EPSILON {
            let travel = format!(
                "G1 X{} Y{} F{}\n",
                fixed(second.start_pos.x as f64, 3),
                fixed(second.start_pos.y as f64, 3),
                fixed(self.params.max_speed as f64, 6)
            );
            let skip = second.is_tool_change
                && ((second.start_pos.x - second.tool_change_start_pos.x).abs() as f64) < EPSILON
                && ((second.start_pos.y - second.tool_change_start_pos.y).abs() as f64) < EPSILON;
            if !skip {
                out.gcode += &travel;
            }
        }
        out.gcode += &second.gcode;
        out.end_pos = second.end_pos;
        out.wipe_path = second.wipe_path.clone();
        out.initial_tool = first.initial_tool;
        out.new_tool = second.new_tool;
        out.is_contact = first.is_contact || second.is_contact;
        if first.nozzle_change.gcode.is_empty() && !second.nozzle_change.gcode.is_empty() {
            out.nozzle_change = second.nozzle_change.clone();
        }
        if first.is_tool_change {
            out.is_tool_change = true;
            out.tool_change_start_pos = first.tool_change_start_pos;
        } else if second.is_tool_change {
            out.is_tool_change = true;
            out.tool_change_start_pos = second.tool_change_start_pos;
        } else {
            out.is_tool_change = false;
        }
        out.purge_volume += second.purge_volume;
        out
    }

    /// Every layer's pieces (`generate_new`).
    pub fn generate(&mut self) -> Vec<Vec<Piece>> {
        let mut result = Vec::new();
        if self.plan.is_empty() {
            return result;
        }
        self.wipe_tower_height = self.plan.last().unwrap().z;
        self.plan_tower_new();
        self.layer_info = 0;
        if let Some(t) = self.plan.iter().find_map(|l| l.tool_changes.first()) {
            self.current_tool = t.old_tool;
        }
        self.used_filament_length.fill(0.0);
        let wall_filament = self.get_wall_filament_for_all_layer();
        self.outer_wall = Vec::with_capacity(self.plan.len());
        for index in 0..self.plan.len() {
            let layer = self.plan[index].clone();
            self.reset_block_status();
            self.cur_layer_id = index;
            self.set_layer(layer.z, layer.height, false);
            self.outer_wall.push((layer.z, Vec::new()));
            if self.plan[self.layer_info].depth < self.perimeter_width {
                result.push(Vec::new());
                continue;
            }
            if self.blocks.len() == 1 && self.plan[self.layer_info].depth < self.wipe_tower_depth - self.perimeter_width
            {
                let dy = self.extra_spacing * self.perimeter_width;
                self.y_shift = (self.wipe_tower_depth - self.plan[self.layer_info].depth) / 2.0;
                self.y_shift = align_round(self.y_shift, dy);
            }
            let mut layer_result: Vec<Piece> = Vec::new();
            let mut finish_layer: Option<Piece> = None;
            let wall_idx: Option<usize> = if layer.tool_changes.is_empty() {
                None
            } else if let Some(wf) = wall_filament {
                let mut candidate: Option<usize> = None;
                let mut found = None;
                for (idx, t) in layer.tool_changes.iter().enumerate() {
                    if idx == 0 {
                        if t.old_tool == wf && self.is_valid_last_layer(t.old_tool, index, layer.z as f64) {
                            found = Some(wf);
                            break;
                        } else if self.filpar[t.old_tool].category == self.filpar[wf].category
                            && self.is_valid_last_layer(t.old_tool, index, layer.z as f64)
                        {
                            candidate = Some(t.old_tool);
                        }
                    }
                    if t.new_tool == wf {
                        found = Some(wf);
                        break;
                    }
                    if candidate.is_none() && self.filpar[t.new_tool].category == self.filpar[wf].category {
                        candidate = Some(t.new_tool);
                    }
                }
                Some(found.or(candidate).unwrap_or(layer.tool_changes[0].new_tool))
            } else {
                Some(layer.tool_changes[0].new_tool)
            };
            let mut wall_idx = wall_idx;
            if wall_idx.is_none() {
                let need_solid = self.blocks.iter().any(|b| b.layers_type[self.cur_layer_id] != LayerType::Normal);
                if need_solid {
                    wall_idx = Some(self.current_tool);
                } else {
                    finish_layer = Some(self.finish_layer_new(true, layer.extruder_fill, true));
                    let id = self.cur_layer_id;
                    for b in &mut self.blocks {
                        b.finish_depth[id] = b.start_depth;
                    }
                }
            }
            let mut insert_finish_layer_idx: Option<usize> = None;
            for (i, &t) in layer.tool_changes.iter().enumerate() {
                if i == 0 && Some(t.old_tool) == wall_idx {
                    finish_layer = Some(self.finish_layer_new(true, false, false));
                }
                let block = self.block_index(self.filpar[t.new_tool].category);
                let solid_toolchange =
                    block.is_some_and(|b| self.blocks[b].layers_type[self.cur_layer_id] == LayerType::Contact);
                let block2 = self.block_index(self.filpar[t.old_tool].category);
                let solid_nozzlechange =
                    block2.is_some_and(|b| self.blocks[b].layers_type[self.cur_layer_id] == LayerType::Contact);
                let piece = self.tool_change_new(t.new_tool, solid_toolchange, solid_nozzlechange);
                layer_result.push(piece);
                if !(i == 0 && Some(t.old_tool) == wall_idx) && Some(t.new_tool) == wall_idx {
                    finish_layer = Some(self.finish_layer_new(true, false, false));
                    insert_finish_layer_idx = Some(i);
                }
            }
            if let Some(wall) = wall_idx {
                if layer.tool_changes.is_empty() {
                    finish_layer = Some(self.finish_layer_new(true, false, false));
                }
                for bk in 0..self.blocks.len() {
                    let id = self.cur_layer_id;
                    let pw = self.perimeter_width;
                    {
                        let b = &mut self.blocks[bk];
                        b.finish_depth[id] = b.start_depth + b.depth;
                        if (b.cur_depth as f64 + EPSILON) as f32 >= b.start_depth + b.layer_depths[id] - pw {
                            continue;
                        }
                    }
                    let b = self.blocks[bk].clone();
                    let block_solid =
                        matches!(b.layers_type[id], LayerType::Contact | LayerType::ContactUp | LayerType::Solid);
                    let mut finish_filament: Option<usize> = if b.last_filament_change_id != -1 {
                        Some(b.last_filament_change_id as usize)
                    } else if b.last_nozzle_change_id != -1 {
                        Some(b.last_nozzle_change_id as usize)
                    } else {
                        None
                    };
                    if let Some(first) = layer.tool_changes.first() {
                        let last_block = self.block_index(self.category(first.old_tool));
                        if last_block.is_some_and(|lb| self.blocks[lb].block_id == b.block_id)
                            && finish_filament.is_none()
                        {
                            finish_filament = Some(first.old_tool);
                        }
                    }
                    let finish_filament = finish_filament.unwrap_or(wall);
                    if !self.is_valid_last_layer(finish_filament, id, layer.z as f64) {
                        continue;
                    }
                    let finish_block = if block_solid {
                        let p = self.finish_block_solid(bk, finish_filament, b.layers_type[id]);
                        let bb = &mut self.blocks[bk];
                        bb.finish_depth[id] = bb.start_depth + bb.depth;
                        p
                    } else {
                        let p = self.finish_block(bk, finish_filament, layer.extruder_fill);
                        let bb = &mut self.blocks[bk];
                        bb.finish_depth[id] = bb.cur_depth;
                        p
                    };
                    let mut inserted = false;
                    if let Some(k) = layer_result.iter().position(|p| p.new_tool == finish_filament) {
                        layer_result[k] = self.merge(&layer_result[k], &finish_block);
                        inserted = true;
                    }
                    if b.last_filament_change_id == -1
                        && !inserted
                        && let Some(k) = layer_result.iter().position(|p| p.initial_tool == finish_filament)
                    {
                        layer_result[k] = self.merge(&finish_block, &layer_result[k]);
                        inserted = true;
                    }
                    if !inserted && !finish_block.gcode.is_empty() {
                        finish_layer = Some(match finish_layer {
                            Some(f) => self.merge(&f, &finish_block),
                            None => finish_block,
                        });
                    }
                }
            }
            let finish_layer = finish_layer.unwrap_or_default();
            if layer_result.is_empty() {
                layer_result.push(finish_layer);
            } else if is_valid_gcode(&finish_layer.gcode) {
                match insert_finish_layer_idx {
                    None => layer_result[0] = self.merge(&finish_layer, &layer_result[0]),
                    Some(k) => layer_result[k] = self.merge(&layer_result[k], &finish_layer),
                }
            }
            result.push(layer_result);
        }
        result
    }

    /// `get_next_pos`: where a purge starts, by the layer (the corners turn with each layer).
    fn get_next_pos(&self, cleaning_box: &BoxC, wipe_length: f32, solid_toolchange: bool) -> V {
        let (xl, xr) = (cleaning_box.ld.x, cleaning_box.rd.x);
        let line_count = (wipe_length / (xr - xl)) as i32;
        let dy = self.plan[self.layer_info].extra_spacing * self.block_gap_width(self.current_tool, false);
        let y_offset = line_count as f32 * dy;
        let mut res = match self.cur_layer_id % 4 {
            0 => cleaning_box.ld,
            1 => cleaning_box.rd + v(0.0, y_offset),
            2 => cleaning_box.rd,
            _ => cleaning_box.ld + v(0.0, y_offset),
        };
        let contact = solid_toolchange && self.params.enable_tower_interface_features;
        if contact {
            let dist = self.filpar[self.current_tool].tower_interface_pre_extrusion_dist;
            let min_x = (self.params.shared_bed[0] - (self.wipe_tower_pos.x + self.rib_offset.x) as f64) as f32;
            let max_x = (self.params.shared_bed[2] - (self.wipe_tower_pos.x + self.rib_offset.x) as f64) as f32;
            let mut stop = res;
            if stop.x < self.wipe_tower_width / 2.0 {
                stop.x -= dist;
            } else {
                stop.x += dist;
            }
            stop.x = stop.x.max(min_x).min(max_x);
            res = stop;
        }
        res
    }

    fn tool_change_new(&mut self, new_tool: usize, solid_toolchange: bool, solid_nozzlechange: bool) -> Piece {
        self.nozzle_change_result = NozzleChange::default();
        if self.is_need_ramming(self.current_tool, new_tool) {
            let hotend_change = self.is_same_extruder(self.current_tool, new_tool);
            if self.is_valid_last_layer(self.current_tool, self.cur_layer_id, self.z_pos as f64) {
                self.nozzle_change_result =
                    self.ramming(self.current_tool, new_tool, solid_nozzlechange, !hotend_change);
            }
        }
        let old_tool = self.current_tool;
        let info = &self.plan[self.layer_info];
        let t = info.tool_changes.iter().find(|t| t.new_tool == new_tool).copied().unwrap_or_default();
        let (wipe_length, wipe_depth, purge_volume, nc_depth) =
            (t.wipe_length, t.required_depth, t.purge_volume, t.nozzle_change_depth);
        self.current_tool = new_tool;
        let Some(bi) = self.block_index(self.filpar[new_tool].category) else { return Piece::default() };
        self.cur_block = Some(bi);
        let cleaning_box = BoxC::new(
            v(self.perimeter_width, self.blocks[bi].cur_depth),
            self.wipe_tower_width - 2.0 * self.perimeter_width,
            wipe_depth - nc_depth,
        );
        let initial_position = self.get_next_pos(&cleaning_box, wipe_length, solid_toolchange);
        let material_from = self.filpar.get(old_tool).map_or("(NONE)".to_string(), |f| f.material.clone());
        let material_to = self.filpar[new_tool].material.clone();
        let first = self.is_first_layer();
        let (tower_w, tower_d, y_shift) = (self.wipe_tower_width, self.wipe_tower_depth, self.y_shift);
        let num = self.num_tool_changes;
        let travel_speed = self.params.travel_speed;
        let mut w = self.writer(self.layer_height, self.perimeter_width);
        w.flow = self.extrusion_flow;
        w.z = self.z_pos;
        w.tool = new_tool;
        w.set_y_shift(y_shift);
        w.append(";--------------------\n; CP TOOLCHANGE START\n").comment_with_value(" toolchange #", num as i64 + 1);
        w.append(&format!("; material : {material_from} -> {material_to}\n;--------------------\n"));
        // Bambu's firmware has no speed override backup (`speed_override_backup` writes nothing for it), but the X2D's
        // flavour is plain Marlin, so Orca's writer backs it up and restores it.
        w.append("M220 B\nM220 S100\n");
        w.set_initial_position(initial_position, tower_w, tower_d, 0.0);
        w.append("; WIPE_TOWER_START\n");
        // toolchange_Change: the custom G-code goes where these placeholders stand.
        let used = w.get_and_reset_used_filament_length();
        if old_tool < self.used_filament_length.len() {
            self.used_filament_length[old_tool] += used;
        }
        w.append("[filament_end_gcode]\n[restore_layer_z_before_toolchange]\n[change_filament_gcode]\n");
        w.tool = new_tool;
        w.append("[filament_start_gcode]\n");
        w.append("G4 S0\n");
        let (mut w, _) = self.toolchange_wipe_new(w, &cleaning_box, wipe_length, solid_toolchange, first);
        w.append("; WIPE_TOWER_END\n");
        self.num_tool_changes += 1;
        self.blocks[bi].cur_depth += wipe_depth - nc_depth;
        self.blocks[bi].last_filament_change_id = new_tool as i64;
        w.append("M220 R\n");
        w.feedrate(travel_speed * 60.0);
        w.append("G4 S0\nG92 E0\n; CP TOOLCHANGE END\n;------------------\n\n\n");
        let used = w.get_and_reset_used_filament_length();
        if self.current_tool < self.used_filament_length.len() {
            self.used_filament_length[self.current_tool] += used;
        }
        self.piece(w, old_tool, false, true, purge_volume, solid_toolchange)
    }

    /// `ramming`: the old filament pushed out over 1 mm lines before the nozzle changes.
    fn ramming(
        &mut self,
        old_filament: usize,
        new_filament: usize,
        solid_infill: bool,
        extruder_change: bool,
    ) -> NozzleChange {
        let (pw, ncpw) = (self.perimeter_width, self.nozzle_change_perimeter_width);
        let x_offset = pw + (ncpw - pw) / 2.0;
        let box_width = self.wipe_tower_width - 2.0 * x_offset;
        let info = &self.plan[self.layer_info];
        let (mut line_count, nc_depth) = info
            .tool_changes
            .iter()
            .find(|t| t.new_tool == new_filament)
            .map_or((0, 0.0), |t| ((t.nozzle_change_length / box_width).ceil() as i32, t.nozzle_change_depth));
        let tag = |start: bool| {
            format!(
                "; NOZZLE_CHANGE_{} OF{} NF{} ON{} NN{}\n",
                if start { "START" } else { "END" },
                old_filament,
                new_filament,
                self.extruder(old_filament),
                self.extruder(new_filament)
            )
        };
        let start_tag = tag(true);
        let end_tag = tag(false);
        let nz_flow = self.nozzle_change_extrusion_flow(self.layer_height);
        let Some(bi) = self.block_index(self.filpar[old_filament].category) else { return NozzleChange::default() };
        self.cur_block = Some(bi);
        let first = self.is_first_layer();
        let mut dy = if first {
            ncpw
        } else {
            self.plan[self.layer_info].extra_spacing * self.block_gap_width(self.current_tool, true)
        };
        let cleaning_box = BoxC::new(v(x_offset, self.blocks[bi].cur_depth + (ncpw - pw) / 2.0), box_width, nc_depth);
        let initial_position = cleaning_box.ld;
        let (tower_w, tower_d, y_shift) = (self.wipe_tower_width, self.wipe_tower_depth, self.y_shift);
        let current = self.current_tool;
        let extruder_id = self.extruder(current);
        let fp = self.filpar[current].clone();
        let bridge_flow = self.nozzle_change_extrusion_flow(0.2);
        let layer_flow = self.nozzle_change_extrusion_flow(self.layer_height);
        let mut w = self.writer(self.layer_height, ncpw);
        w.flow = nz_flow;
        w.z = self.z_pos;
        w.tool = current;
        w.set_y_shift(y_shift);
        w.set_initial_position(initial_position, tower_w, tower_d, 0.0);
        w.append(&start_tag);
        let mut result = NozzleChange::default();
        let mut new_cur_depth = None;
        if line_count > 0 {
            let max_e_ramming = if extruder_change { fp.max_e_ramming_speed.0 } else { fp.max_e_ramming_speed.1 };
            let mut speed = 60.0 * max_e_ramming / nz_flow;
            if solid_infill {
                speed = speed.min(40.0 * 60.0);
            }
            let mut bridge_speed = (60.0 * max_e_ramming / bridge_flow).min(speed);
            let (xl, xr) = (cleaning_box.ld.x, cleaning_box.rd.x);
            if solid_infill {
                dy = ncpw;
                line_count = ((EPSILON as f32) + (cleaning_box.ru.y - cleaning_box.rd.y + (ncpw - pw) / 2.0) / ncpw)
                    .floor() as i32;
            }
            let mut left_to_right = true;
            let mut need_change_flow = false;
            let ramming_length = line_count as f32 * (xr - xl);
            let precool_t = if extruder_change {
                fp.precool_t.0.get(extruder_id).copied().unwrap_or(0.0)
            } else {
                fp.precool_t.1.get(extruder_id).copied().unwrap_or(0.0)
            };
            let precool_first = if extruder_change {
                fp.precool_t_first_layer.0.get(extruder_id).copied().unwrap_or(0.0)
            } else {
                fp.precool_t_first_layer.1.get(extruder_id).copied().unwrap_or(0.0)
            };
            let mut max_cooling_speed = speed;
            if extruder_change {
                if first && precool_first as f64 > EPSILON {
                    max_cooling_speed = ramming_length / precool_first * 60.0;
                } else if precool_t as f64 > EPSILON {
                    max_cooling_speed = ramming_length / precool_t * 60.0;
                }
            }
            if speed > max_cooling_speed {
                speed = max_cooling_speed;
            }
            if bridge_speed > max_cooling_speed {
                bridge_speed = max_cooling_speed;
            }
            let limit = if extruder_change { LimitFlow::Ramming } else { LimitFlow::RammingNc };
            let mut i = 0;
            loop {
                // need_thick_bridge_flow reads the tower's state, which the writer borrows: decided above per line.
                if self_thick(
                    self.layer_height,
                    &self.blocks,
                    self.cur_block,
                    self.layer_info,
                    self.cur_layer_id,
                    pw,
                    w.y(),
                ) {
                    w.flow = bridge_flow;
                    w.append(&format!("; LAYER_HEIGHT: {}\n", fixed(0.2, 6)));
                    need_change_flow = true;
                }
                let s = if need_change_flow { bridge_speed } else { speed };
                let y = w.y();
                if left_to_right {
                    w.extrude(xr, y, s, limit);
                } else {
                    w.extrude(xl, y, s, limit);
                }
                if i == line_count - 1 {
                    break;
                }
                if (w.y() + dy - cleaning_box.ru.y + (ncpw + pw) / 2.0) as f64 > EPSILON {
                    break;
                }
                if need_change_flow {
                    w.flow = layer_flow;
                    let h = w.layer_height;
                    w.append(&format!("; LAYER_HEIGHT: {}\n", fixed(h as f64, 6)));
                    need_change_flow = false;
                }
                let (x, y) = (w.x(), w.y() + dy);
                w.extrude(x, y, speed, limit);
                left_to_right = !left_to_right;
                i += 1;
            }
            if need_change_flow {
                let h = w.layer_height;
                w.append(&format!("; LAYER_HEIGHT: {}\n", fixed(h as f64, 6)));
            }
            w.flow = nz_flow;
            new_cur_depth = Some(nc_depth);
            self.left_to_right = left_to_right;
            if self.is_need_reverse_travel(current, extruder_change) {
                // Reverse travel after ramming (TPU), which Bambu's filaments here never ask for.
            } else {
                let p = w.pos_rotated();
                result.wipe_path.push(p);
                result.wipe_path.push(if left_to_right { v(0.0, p.y) } else { v(tower_w, p.y) });
            }
        }
        w.append(&end_tag);
        result.start_pos = w.start_pos;
        result.end_pos = w.pos_rotated();
        result.gcode = std::mem::take(&mut w.gcode);
        result.is_extruder_change = extruder_change;
        if let Some(d) = new_cur_depth {
            self.blocks[bi].cur_depth += d;
            self.blocks[bi].last_nozzle_change_id = old_filament as i64;
        }
        result
    }

    fn finish_layer_new(&mut self, extrude_perimeter: bool, extrude_fill: bool, extrude_fill_wall: bool) -> Piece {
        self.current_layer_finished = true;
        let first = self.is_first_layer();
        let pw = self.perimeter_width;
        let tool = self.current_tool;
        let feedrate = if first {
            (self.params.first_layer_speed * 60.0).min(self.params.max_speed)
        } else {
            (60.0 * self.filpar[tool].max_e_speed / self.extrusion_flow).min(self.params.max_speed)
        };
        let multi_block_fill = self.blocks.len() > 1 && (extrude_fill_wall || extrude_fill);
        let mut fill_boxes: Vec<BoxC> = Vec::new();
        if multi_block_fill {
            for b in &self.blocks {
                let mut h = b.depth - 2.0 * pw;
                if self.cur_layer_id < b.layer_depths.len() {
                    h = b.layer_depths[self.cur_layer_id] - 2.0 * pw;
                }
                if h <= WT_EPSILON {
                    continue;
                }
                fill_boxes.push(BoxC::new(v(pw, b.start_depth + pw), self.wipe_tower_width - 2.0 * pw, h));
            }
        }
        if fill_boxes.is_empty() {
            let mut d = self.wipe_tower_depth - 2.0 * pw;
            if self.blocks.len() == 1 {
                d = self.plan[self.layer_info].depth - 2.0 * pw;
            }
            fill_boxes.push(BoxC::new(v(pw, pw), self.wipe_tower_width - 2.0 * pw, d));
        }
        let start = if self.left_to_right { fill_boxes[0].ru } else { fill_boxes[0].lu };
        let solid_infill_next = self.layer_info + 1 < self.plan.len()
            && self.plan[self.layer_info + 1]
                .tool_changes
                .iter()
                .any(|t| self.filpar[t.new_tool].is_soluble || self.filpar[t.old_tool].is_soluble);
        let solid_infill = solid_infill_next || first;
        let wipe_tower_depth =
            if self.blocks.len() == 1 { self.plan[self.layer_info].depth + pw } else { self.wipe_tower_depth };
        let wt_box = self.align_perimeter(BoxC::new(v(0.0, 0.0), self.wipe_tower_width, wipe_tower_depth));
        let wall = self.wall_polygon(&wt_box);
        let skip = self.wall_skip_points.get(self.cur_layer_id).cloned().unwrap_or_default();
        let spacing = pw - self.layer_height * (1.0 - std::f32::consts::FRAC_PI_4);
        let mut loops_num = ((self.brim_width + spacing / 2.0) / spacing) as i32;
        if !first {
            if self.plan[self.layer_info].depth != self.plan[0].depth {
                loops_num = 0;
            } else {
                let chamfer = (3.0 / spacing) as i32;
                let dist = self.layer_info as i32 - self.first_layer_idx.unwrap_or(0) as i32;
                loops_num = loops_num.min(chamfer) - dist;
            }
        }
        let (tower_w, tower_d, y_shift, num_layer) =
            (self.wipe_tower_width, self.wipe_tower_depth, self.y_shift, self.num_layer_changes);
        let (bridging, retract_length, retract_speed, wipe_dist) = (
            self.bridging,
            self.filpar[tool].retract_length,
            self.filpar[tool].retract_speed * 60.0,
            self.filpar[tool].wipe_dist,
        );
        let mut w = self.writer(self.layer_height, pw);
        w.flow = self.extrusion_flow;
        w.z = self.z_pos;
        w.tool = tool;
        w.set_y_shift(y_shift);
        w.append("; WIPE_TOWER_START\n");
        w.set_initial_position(start, tower_w, tower_d, 0.0);
        let mut finish_rect_wipe_path: Vec<V> = Vec::new();
        for (i, fill_box) in fill_boxes.iter().enumerate() {
            if i > 0 {
                let to = if self.left_to_right { fill_box.ru } else { fill_box.lu };
                w.travel_to(to, 0.0);
            }
            if extrude_fill_wall && fill_box.ru.y - fill_box.rd.y > WT_EPSILON {
                w.rectangle_fill(self, fill_box, &mut finish_rect_wipe_path, feedrate);
            }
            let dy = fill_box.lu.y - fill_box.ld.y - pw;
            let mut left = fill_box.lu.x + 2.0 * pw;
            let mut right = fill_box.ru.x - 2.0 * pw;
            if extrude_fill && dy > pw {
                w.travel_to(fill_box.ld + v(pw * 2.0, 0.0), 0.0);
                w.append(";--------------------\n; CP EMPTY GRID START\n")
                    .comment_with_value(" layer #", num_layer as i64 + 1);
                if solid_infill {
                    let mut sparse_factor = 1.5f32;
                    if first {
                        left -= pw;
                        right += pw;
                        sparse_factor = 1.0;
                    }
                    let mut y = fill_box.ld.y + pw;
                    let n = (dy / (pw * sparse_factor)) as i32;
                    let spacing = (dy - pw) / (n - 1) as f32;
                    for i in 0..n {
                        let x = w.x();
                        w.extrude(x, y, feedrate, LimitFlow::Print);
                        w.extrude(if i % 2 == 1 { left } else { right }, y, 0.0, LimitFlow::Print);
                        y += spacing;
                    }
                    let x = w.x();
                    w.extrude(x, fill_box.lu.y, 0.0, LimitFlow::Print);
                } else {
                    w.extrude_to(fill_box.lu + v(pw * 2.0, 0.0), feedrate);
                    let n = 1 + ((right - left) / bridging) as i32;
                    let dx = (right - left) / n as f32;
                    for i in 1..=n {
                        let x = left + dx * i as f32;
                        let y = w.y();
                        w.travel(x, y, 0.0);
                        w.extrude(x, if i % 2 == 1 { fill_box.rd.y } else { fill_box.ru.y }, 0.0, LimitFlow::Print);
                    }
                    finish_rect_wipe_path.clear();
                    finish_rect_wipe_path.push(w.pos);
                    finish_rect_wipe_path
                        .push(v(left + dx * n as f32, if n % 2 == 1 { fill_box.ru.y } else { fill_box.rd.y }));
                }
                w.append("; CP EMPTY GRID END\n;------------------\n\n\n\n\n\n\n");
            }
        }
        // The wall.
        let mut outer = wall.clone();
        let mut walls_drawn: Vec<Vec<V>> = Vec::new();
        if extrude_perimeter {
            let (paths, with_cuts) = if self.params.use_gap_wall {
                gap_for_skip_points(&wall, &skip, tower_w, 2.5 * pw)
            } else {
                let mut closed = wall.clone();
                if let Some(&f) = wall.first() {
                    closed.push(f);
                }
                (vec![closed], wall.clone())
            };
            w.generate_path(&paths, feedrate, retract_length, retract_speed);
            if self.cur_layer_id == 0 {
                let mut b = [f32::MAX, f32::MAX];
                for p in paths.iter().flatten() {
                    b = [b[0].min(p.x), b[1].min(p.y)];
                }
                self.rib_offset = v(-b[0], -b[1]);
            }
            outer = with_cuts;
            walls_drawn.push(wall.iter().map(|p| *p + v(0.0, y_shift)).collect());
        }
        if loops_num > 0 {
            let mut ring = outer.clone();
            for _ in 0..loops_num {
                ring = offset_loop(&ring, spacing as f64);
                w.polygon(&ring, feedrate);
                walls_drawn.push(ring.clone());
            }
            if first {
                self.brim_width_real = loops_num as f32 * spacing + spacing / 2.0;
            }
            outer = ring;
        }
        if extrude_perimeter || loops_num > 0 {
            w.add_wipe_path(&outer, wipe_dist);
        } else {
            let p = w.pos;
            let mut target = if p == wt_box.ld {
                wt_box.rd
            } else if p == wt_box.rd {
                wt_box.ru
            } else if p == wt_box.ru {
                wt_box.lu
            } else {
                wt_box.ld
            };
            if finish_rect_wipe_path.len() == 2 && finish_rect_wipe_path[0] == p {
                target = finish_rect_wipe_path[1];
            }
            w.add_wipe_point(p).add_wipe_point(target);
        }
        w.append("; WIPE_TOWER_END\n");
        let used = w.get_and_reset_used_filament_length();
        let _ = used;
        if let Some(last) = self.outer_wall.last_mut() {
            last.1.extend(walls_drawn);
        }
        self.nozzle_change_result = NozzleChange::default();
        // The writer counted nothing (its extrusions record no length): the tower's filament is counted by the
        // G-code writer as it writes it.
        self.piece(w, tool, true, false, 0.0, false)
    }

    fn finish_block(&mut self, bk: usize, filament: usize, extrude_fill: bool) -> Piece {
        let first = self.is_first_layer();
        let pw = self.perimeter_width;
        let feedrate = if first {
            (self.params.first_layer_speed * 60.0).min(self.params.max_speed)
        } else {
            (60.0 * self.filpar[filament].max_e_speed / self.extrusion_flow).min(self.params.max_speed)
        };
        let b = self.blocks[bk].clone();
        let fill_box = BoxC::new(
            v(pw, b.cur_depth),
            self.wipe_tower_width - 2.0 * pw,
            b.start_depth + b.layer_depths[self.cur_layer_id] - b.cur_depth - pw,
        );
        let start = if self.left_to_right { fill_box.ru } else { fill_box.lu };
        let solid_infill = (self.layer_info + 1 < self.plan.len()
            && self.plan[self.layer_info + 1]
                .tool_changes
                .iter()
                .any(|t| self.filpar[t.new_tool].is_soluble || self.filpar[t.old_tool].is_soluble))
            || first;
        let wt_box =
            self.align_perimeter(BoxC::new(v(0.0, 0.0), self.wipe_tower_width, self.plan[self.layer_info].depth + pw));
        let (tower_w, tower_d, y_shift, num_layer, bridging) =
            (self.wipe_tower_width, self.wipe_tower_depth, self.y_shift, self.num_layer_changes, self.bridging);
        let mut w = self.writer(self.layer_height, pw);
        w.flow = self.extrusion_flow;
        w.z = self.z_pos;
        w.tool = filament;
        w.set_y_shift(y_shift);
        w.append("; WIPE_TOWER_START\n");
        w.set_initial_position(start, tower_w, tower_d, 0.0);
        let mut finish_rect_wipe_path: Vec<V> = Vec::new();
        if fill_box.ru.y - fill_box.rd.y > WT_EPSILON {
            w.rectangle_fill(self, &fill_box, &mut finish_rect_wipe_path, feedrate);
        }
        let dy = fill_box.lu.y - fill_box.ld.y - pw;
        let mut left = fill_box.lu.x + 2.0 * pw;
        let mut right = fill_box.ru.x - 2.0 * pw;
        if extrude_fill && dy > pw {
            w.travel_to(fill_box.ld + v(pw * 2.0, 0.0), 0.0);
            w.append(";--------------------\n; CP EMPTY GRID START\n")
                .comment_with_value(" layer #", num_layer as i64 + 1);
            if solid_infill {
                let mut sparse_factor = 1.5f32;
                if first {
                    left -= pw;
                    right += pw;
                    sparse_factor = 1.0;
                }
                let mut y = fill_box.ld.y + pw;
                let n = (dy / (pw * sparse_factor)) as i32;
                let spacing = (dy - pw) / (n - 1) as f32;
                for i in 0..n {
                    let x = w.x();
                    w.extrude(x, y, feedrate, LimitFlow::Print);
                    w.extrude(if i % 2 == 1 { left } else { right }, y, 0.0, LimitFlow::Print);
                    y += spacing;
                }
                let x = w.x();
                w.extrude(x, fill_box.lu.y, 0.0, LimitFlow::Print);
            } else {
                w.extrude_to(fill_box.lu + v(pw * 2.0, 0.0), feedrate);
                let n = 1 + ((right - left) / bridging) as i32;
                let dx = (right - left) / n as f32;
                for i in 1..=n {
                    let x = left + dx * i as f32;
                    let y = w.y();
                    w.travel(x, y, 0.0);
                    w.extrude(x, if i % 2 == 1 { fill_box.rd.y } else { fill_box.ru.y }, 0.0, LimitFlow::Print);
                }
                finish_rect_wipe_path.clear();
                finish_rect_wipe_path.push(w.pos);
                finish_rect_wipe_path
                    .push(v(left + dx * n as f32, if n % 2 == 1 { fill_box.ru.y } else { fill_box.rd.y }));
            }
            w.append("; CP EMPTY GRID END\n;------------------\n\n\n\n\n\n\n");
        }
        let p = w.pos;
        let mut target = if p == wt_box.ld {
            wt_box.rd
        } else if p == wt_box.rd {
            wt_box.ru
        } else if p == wt_box.ru {
            wt_box.lu
        } else {
            wt_box.ld
        };
        if finish_rect_wipe_path.len() == 2 && finish_rect_wipe_path[0] == p {
            target = finish_rect_wipe_path[1];
        }
        w.add_wipe_point(p).add_wipe_point(target);
        w.append("; WIPE_TOWER_END\n");
        self.block_piece(w, filament)
    }

    fn finish_block_solid(&mut self, bk: usize, filament: usize, layer_type: LayerType) -> Piece {
        let b = self.blocks[bk].clone();
        let mut layer_height = self.layer_height;
        let mut e_flow = self.extrusion_flow;
        if self.cur_layer_id > 1
            && b.layers_type[self.cur_layer_id - 1] == LayerType::Normal
            && self.extrusion_flow < self.extrusion_flow(0.2)
        {
            layer_height = 0.2;
            e_flow = self.extrusion_flow(0.2);
        }
        let first = self.is_first_layer();
        let pw = self.perimeter_width;
        let mut feedrate = if first {
            (self.params.first_layer_speed * 60.0).min(self.params.max_speed)
        } else {
            (60.0 * self.filpar[filament].max_e_speed / self.extrusion_flow).min(self.params.max_speed)
        };
        if matches!(layer_type, LayerType::Contact | LayerType::ContactUp) {
            feedrate = 20.0 * 60.0;
        }
        let fill_box = BoxC::new(
            v(pw, b.cur_depth),
            self.wipe_tower_width - 2.0 * pw,
            b.start_depth + b.layer_depths[self.cur_layer_id] - b.cur_depth - pw,
        );
        let dy = fill_box.lu.y - fill_box.ld.y;
        let n = ((dy as f64 + 0.25 * pw as f64) / pw as f64 + 1.0) as i32;
        let spacing = pw;
        let grid_depth = spacing * (n - 1) as f32;
        let (mut initial, up_to_down) = match self.cur_layer_id % 4 {
            0 => {
                self.left_to_right = true;
                (fill_box.ld, false)
            }
            1 => {
                self.left_to_right = false;
                (v(fill_box.rd.x, fill_box.rd.y + grid_depth), true)
            }
            2 => {
                self.left_to_right = false;
                (fill_box.rd, false)
            }
            _ => {
                self.left_to_right = true;
                (v(fill_box.ld.x, grid_depth + fill_box.ld.y), true)
            }
        };
        let (left, right) = (fill_box.lu.x, fill_box.ru.x);
        let current = self.current_tool;
        let fp = self.filpar[current].clone();
        let is_full_block = ((b.cur_depth - b.start_depth).abs() as f64) < EPSILON;
        let interface = self.params.enable_tower_interface_features;
        let extruder = self.extruder(current) as i64;
        let (tower_w, tower_d, y_shift, num_layer) =
            (self.wipe_tower_width, self.wipe_tower_depth, self.y_shift, self.num_layer_changes);
        let min_x = (self.params.shared_bed[0] - (self.wipe_tower_pos.x + self.rib_offset.x) as f64) as f32;
        let max_x = (self.params.shared_bed[2] - (self.wipe_tower_pos.x + self.rib_offset.x) as f64) as f32;
        let mut ltr = self.left_to_right;
        let mut w = self.writer(layer_height, pw);
        w.flow = e_flow;
        w.z = self.z_pos;
        w.tool = filament;
        w.set_y_shift(y_shift);
        w.append("; WIPE_TOWER_START\n");
        w.append(";--------------------\n; CP EMPTY GRID START\n").comment_with_value(" layer #", num_layer as i64 + 1);
        if is_full_block && layer_type == LayerType::Contact && interface {
            let mut stop = initial;
            if stop.x < tower_w / 2.0 {
                stop.x -= fp.tower_interface_pre_extrusion_dist;
            } else {
                stop.x += fp.tower_interface_pre_extrusion_dist;
            }
            stop.x = stop.x.max(min_x).min(max_x);
            initial = stop;
            if fp.tower_interface_print_temp != fp.nozzle_temperature as f32 {
                w.format_line_m109(fp.tower_interface_print_temp as i32, extruder);
            }
            w.retract(-fp.tower_interface_pre_extrusion_length - 2.0, 100.0);
        }
        w.set_initial_position(initial, tower_w, tower_d, 0.0);
        for i in 0..n {
            let y = w.y();
            w.extrude(if ltr { right } else { left }, y, feedrate, LimitFlow::Print);
            if i == n - 1 {
                let p = w.pos;
                w.add_wipe_point(p).add_wipe_point(v(if ltr { left } else { right }, p.y));
                break;
            }
            ltr = !ltr;
            let (x, y) = (w.x(), w.y() + spacing * if up_to_down { -1.0 } else { 1.0 });
            w.extrude(x, y, feedrate, LimitFlow::Print);
        }
        if layer_type == LayerType::Contact
            && interface
            && fp.tower_interface_print_temp != fp.nozzle_temperature as f32
        {
            w.format_line_m104(fp.nozzle_temperature, extruder);
        }
        w.append("; CP EMPTY GRID END\n;------------------\n\n\n\n\n\n\n");
        w.append("; WIPE_TOWER_END\n");
        self.left_to_right = ltr;
        self.block_piece(w, filament)
    }

    /// `toolchange_wipe_new`: the purge, a zig-zag across the block that speeds up over its first lines.
    fn toolchange_wipe_new(
        &mut self,
        mut w: Writer,
        cleaning_box: &BoxC,
        wipe_length: f32,
        solid: bool,
        first: bool,
    ) -> (Writer, ()) {
        let pw = self.perimeter_width;
        let flow_ratio = if first { self.params.first_layer_flow_ratio } else { 1.0 };
        w.flow = self.extrusion_flow * flow_ratio;
        w.append(&format!("; CP_TOOLCHANGE_WIPE CT{} FL{}\n", solid as i32, first as i32));
        if !self.nozzle_change_result.gcode.is_empty() {
            w.change_analyzer_line_width(pw);
        }
        if first {
            w.append(&format!("; LINE_WIDTH: {}\n", fixed((self.params.first_layer_flow_ratio * pw) as f64, 6)));
        }
        let tool = self.current_tool;
        let fp = self.filpar[tool].clone();
        let retract_length = fp.retract_length;
        let retract_speed = fp.retract_speed * 60.0;
        let (xl, xr) = (cleaning_box.ld.x, cleaning_box.rd.x);
        let mut flat = self.params.flat_ironing;
        let mut line_ironing = true;
        if solid {
            flat = false;
            line_ironing = false;
        }
        let mut x_to_wipe = if solid { f32::MAX } else { wipe_length };
        let mut dy =
            if first { pw } else { self.plan[self.layer_info].extra_spacing * self.block_gap_width(tool, false) };
        if solid {
            dy = pw;
        }
        let mut target_speed = if first {
            (self.params.first_layer_speed * 60.0).min(self.params.max_speed)
        } else {
            self.params.max_speed
        };
        if solid {
            target_speed = self.contact_speed;
        }
        let speeds = [
            0.33 * target_speed,
            0.375 * target_speed,
            0.458 * target_speed,
            0.875 * target_speed,
            target_speed.min(0.875 * target_speed + 50.0),
        ];
        let mut wipe_speed;
        self.left_to_right = (self.cur_layer_id + 3) % 4 >= 2;
        let is_from_up = self.cur_layer_id % 2 == 1;
        let should_heating = fp.filament_cooling_before_tower as f64 > EPSILON && !solid && !first;
        let extruder = self.extruder(tool) as i64;
        let target_temp = if first { fp.nozzle_temperature_initial_layer } else { fp.nozzle_temperature };
        let add_m104 = |w: &mut Writer| {
            if (fp.filament_cooling_before_tower as f64) < EPSILON || !should_heating {
                return;
            }
            w.format_line_m104(target_temp, extruder);
        };
        let use_gap_wall = self.params.use_gap_wall;
        let mut i = 0usize;
        loop {
            wipe_speed = speeds[i.min(speeds.len() - 1)];
            let need_change_flow = self_thick(
                self.layer_height,
                &self.blocks,
                self.cur_block,
                self.layer_info,
                self.cur_layer_id,
                pw,
                w.y(),
            );
            if need_change_flow {
                w.flow = self.extrusion_flow(0.2);
                w.append(&format!("; LAYER_HEIGHT: {}\n", fixed(0.2, 6)));
            }
            let area = fp.flat_iron_area;
            let mut ironing_length = 3.0f32;
            if i == 0 && use_gap_wall {
                if self.left_to_right {
                    if line_ironing {
                        let dx = xr - w.pos.x;
                        if dx.abs() < ironing_length {
                            ironing_length = dx.abs();
                        }
                        let (x, y) = (w.x() + ironing_length, w.y());
                        w.extrude(x, y, wipe_speed, LimitFlow::Print);
                        w.retract(retract_length, retract_speed);
                        let (x, y) = (w.x() - 1.5 * ironing_length, w.y());
                        w.travel(x, y, 600.0);
                        if flat {
                            let (x, y) = (w.x() + 0.5 * ironing_length, w.y());
                            w.travel(x, y, 240.0);
                            let pos = v(w.x() + ironing_length, w.y());
                            let here = w.pos;
                            w.spiral_flat_ironing(here, area, pw, FLAT_IRON_SPEED);
                            w.travel_to(pos, wipe_speed);
                        } else {
                            let (x, y) = (w.x() + 1.5 * ironing_length, w.y());
                            w.travel(x, y, 240.0);
                        }
                        w.retract(-retract_length, retract_speed);
                    }
                    add_m104(&mut w);
                    let y = w.y();
                    w.extrude(xr, y, wipe_speed, LimitFlow::Print);
                } else {
                    if line_ironing {
                        let dx = xl - w.pos.x;
                        if dx.abs() < ironing_length {
                            ironing_length = dx.abs();
                        }
                        let (x, y) = (w.x() - ironing_length, w.y());
                        w.extrude(x, y, wipe_speed, LimitFlow::Print);
                        w.retract(retract_length, retract_speed);
                        let (x, y) = (w.x() + 1.5 * ironing_length, w.y());
                        w.travel(x, y, 600.0);
                        if flat {
                            let (x, y) = (w.x() - 0.5 * ironing_length, w.y());
                            w.travel(x, y, 240.0);
                            let pos = v(w.x() - ironing_length, w.y());
                            let here = w.pos;
                            w.spiral_flat_ironing(here, area, pw, FLAT_IRON_SPEED);
                            w.travel_to(pos, wipe_speed);
                        } else {
                            let (x, y) = (w.x() - 1.5 * ironing_length, w.y());
                            w.travel(x, y, 240.0);
                        }
                        w.retract(-retract_length, retract_speed);
                    }
                    add_m104(&mut w);
                    let y = w.y();
                    w.extrude(xl, y, wipe_speed, LimitFlow::Print);
                }
            } else {
                if i == 0 {
                    add_m104(&mut w);
                }
                let y = w.y();
                if self.left_to_right {
                    w.extrude(xr, y, wipe_speed, LimitFlow::Print);
                } else {
                    w.extrude(xl, y, wipe_speed, LimitFlow::Print);
                }
            }
            if need_change_flow {
                w.flow = self.extrusion_flow;
                let h = self.layer_height;
                w.append(&format!("; LAYER_HEIGHT: {}\n", fixed(h as f64, 6)));
            }
            if !is_from_up && (w.y() + dy - EPSILON as f32) > cleaning_box.lu.y - pw {
                break;
            }
            if is_from_up && (w.y() - dy + EPSILON as f32) < cleaning_box.ld.y {
                break;
            }
            x_to_wipe -= xr - xl;
            if x_to_wipe < WT_EPSILON {
                break;
            }
            let (x, y) = (w.x(), if is_from_up { w.y() - dy } else { w.y() + dy });
            w.extrude(x, y, 0.0, LimitFlow::Print);
            self.left_to_right = !self.left_to_right;
            i += 1;
        }
        let p = w.pos;
        w.add_wipe_point(p);
        let tw = self.wipe_tower_width;
        w.add_wipe_point(v(if !self.left_to_right { tw } else { 0.0 }, p.y));
        if self.plan[self.layer_info].tool_changes.last().is_some_and(|t| t.new_tool != self.current_tool) {
            self.left_to_right = !self.left_to_right;
        }
        w.flow = self.extrusion_flow;
        if first {
            w.append(&format!("; LINE_WIDTH: {}\n", fixed(pw as f64, 6)));
        }
        (w, ())
    }

    fn align_perimeter(&self, b: BoxC) -> BoxC {
        let mut a = b;
        let spacing = self.extra_spacing * self.perimeter_width;
        let mut up = b.lu.y - self.perimeter_width - EPSILON as f32;
        up = align_ceil(up, spacing);
        up += self.perimeter_width;
        up = up.min(self.wipe_tower_depth);
        let mut down = b.ld.y - self.perimeter_width + EPSILON as f32;
        down = align_floor(down, spacing);
        down += self.perimeter_width;
        down = down.max(-self.y_shift);
        a.lu.y = up;
        a.ru.y = up;
        a.ld.y = down;
        a.rd.y = down;
        a
    }

    /// The wall's loop for the box (`generate_support_wall_new` up to its path): the square with its ribs,
    /// filleted, united with the box.
    fn wall_polygon(&self, wt_box: &BoxC) -> Vec<V> {
        let mut wall = if self.params.use_rib_wall { self.generate_rib_polygon(wt_box) } else { box_loop(wt_box) };
        if self.params.used_fillet && (self.params.use_rib_wall || self.y_shift as f64 <= EPSILON) {
            if self.params.use_rib_wall {
                wall = rounding_polygon(&wall, 2.0);
            }
            wall = union_outline(&[wall, box_loop(wt_box)]);
        }
        wall
    }

    fn generate_rib_polygon(&self, wt_box: &BoxC) -> Vec<V> {
        let diagonal_width = self.rib_width as f64 / 2.0;
        let (a, b) = (self.wipe_tower_width, self.wipe_tower_depth);
        let line_len = ((a as f64).powi(2) + (b as f64).powi(2)).sqrt();
        let mut extra = (self.rib_length - line_len as f32).max(0.0) / 2.0;
        extra *= (self.wipe_tower_height - self.z_pos).abs() / self.wipe_tower_height;
        let extend = |p: V, q: V| -> (V, V) {
            let d = q - p;
            let len = (d.x as f64).hypot(d.y as f64);
            let u = [d.x as f64 / len, d.y as f64 / len];
            let e = extra as f64;
            (
                v((p.x as f64 - u[0] * e) as f32, (p.y as f64 - u[1] * e) as f32),
                v((q.x as f64 + u[0] * e) as f32, (q.y as f64 + u[1] * e) as f32),
            )
        };
        let shift = v(0.0, self.y_shift);
        let (l1a, l1b) = extend(v(0.0, 0.0), v(a, b));
        let (l2a, l2b) = extend(v(a, 0.0), v(0.0, b));
        let poly1 = rectangle_round_line(l1a - shift, l1b - shift, diagonal_width);
        let poly2 = rectangle_round_line(l2a - shift, l2b - shift, diagonal_width);
        union_outline(&[poly1, poly2, box_loop(wt_box)])
    }
}

/// Whether the tower is printing over a block's empty part from the layer below at this y, where a thin layer
/// needs a thick bridge's flow (`need_thick_bridge_flow`): never at 0.2 mm layers and thicker.
fn self_thick(
    layer_height: f32,
    blocks: &[Block],
    cur_block: Option<usize>,
    layer_info: usize,
    cur_layer_id: usize,
    pw: f32,
    pos_y: f32,
) -> bool {
    if layer_height >= 0.2 || layer_info <= 1 {
        return false;
    }
    let Some(b) = cur_block.and_then(|k| blocks.get(k)) else { return false };
    let end = b.start_depth + b.depth - pw;
    let start = b.finish_depth[cur_layer_id - 1];
    pos_y > start && pos_y < end
}

fn box_loop(b: &BoxC) -> Vec<V> {
    vec![b.ld, b.rd, b.ru, b.lu]
}

/// A closed loop grown by `delta` mm, mitred as Clipper's default offset (`offset(Polygon, delta)`).
fn offset_loop(points: &[V], delta: f64) -> Vec<V> {
    let shapes = vec![vec![to_contour(points)]];
    let miter = 2.0 * (1.0f64 / 3.0).asin();
    let grown = geom::offset_mitred(&shapes, delta, miter);
    grown.first().and_then(|s| s.first()).map(from_contour).unwrap_or_default()
}

/// Whether text has a line that isn't a comment (`is_valid_gcode`).
fn is_valid_gcode(text: &str) -> bool {
    text.lines().any(|l| {
        let t = l.trim_matches(' ');
        !t.is_empty() && !t.starts_with(';')
    })
}
