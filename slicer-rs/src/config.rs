//! The slicing settings as plain numbers, read from OrcaSlicer's presets (`profile.rs`) by Orca's own keys: by
//! default the X2D's (decision 0046: the 0.4 mm nozzle, "0.20mm Standard @BBL X2D", "Bambu PLA Basic @BBL X2D 0.4
//! nozzle", the Textured PEI plate, supports off), else those of a slice setup the app made from people's slicing
//! settings (`setup.rs`, decision 0047). Where a preset value is a list per extruder variant, the first one (the
//! left nozzle, "Direct Drive Standard") is used.

use crate::profile::{self, Profile};
use std::f64::consts::PI;
use std::sync::Arc;

/// An extrusion's shape (Orca's `Flow`): its width and height, mm³ per mm, and how far apart its lines lie.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Flow {
    pub width: f64,
    pub height: f64,
    pub mm3_per_mm: f64,
    pub spacing: f64,
}

impl Flow {
    /// A flat line `w` wide and `h` high, a rectangle with round ends.
    pub fn flat(w: f64, h: f64) -> Flow {
        Flow { width: w, height: h, mm3_per_mm: Settings::mm3_per_mm(w, h), spacing: Settings::spacing(w, h) }
    }

    /// Orca's `Flow::with_flow_ratio` of a flat line: more plastic keeps the line's spacing and grows it in height,
    /// less narrows it, down to a round thread.
    pub fn with_flow_ratio(self, ratio: f64) -> Flow {
        let area = self.mm3_per_mm;
        let wanted = area * ratio;
        if wanted > area + 1e-4 {
            let height = wanted / self.spacing;
            Flow { width: self.spacing + height * (1.0 - PI / 4.0), height, mm3_per_mm: wanted, spacing: self.spacing }
        } else if wanted < area - 1e-4 {
            let width = self.width - (area - wanted) / self.height;
            if width > self.height {
                Flow::flat(width, self.height)
            } else {
                // Orca's "diameter" here is the radius of a circle of that area, its spacing the line's.
                let d = (wanted / PI).sqrt();
                Flow { width: d, height: d, mm3_per_mm: Settings::mm3_per_mm(d, d), spacing: self.spacing }
            }
        } else {
            self
        }
    }
}

#[derive(Clone, Debug)]
pub struct Settings {
    /// The presets these come from; the printer's start and end G-code are filled from them too.
    pub profile: Arc<Profile>,
    /// The plate's filaments when there are several (`filaments.rs`); None for one.
    pub palette: Option<Arc<crate::filaments::Palette>>,

    // The machine.
    pub printer: String,
    pub bed: [f64; 2],
    pub max_height: f64,
    pub nozzle_diameter: f64,
    pub max_accel_xy: f64,
    pub max_accel_travel: f64,
    pub max_accel_z: f64,
    pub max_accel_e: f64,
    /// The most a print acceleration (`M204 S`) can ask for (`machine_max_acceleration_extruding`).
    pub max_accel_extruding: f64,
    pub max_accel_retract: f64,
    pub max_speed_xy: f64,
    pub max_speed_z: f64,
    pub max_speed_e: f64,
    pub max_jerk_xy: f64,
    pub max_jerk_z: f64,
    pub max_jerk_e: f64,
    /// Seconds the printer takes to load a filament (`machine_load_filament_time`): Orca's estimate counts one load
    /// for the start G-code's first tool select.
    pub filament_load_time: f64,
    /// mm: how far around the nozzle the toolhead reaches (where the timelapse photo may not be taken).
    pub extruder_clearance_radius: f64,
    /// Whether the printer has an auxiliary part fan (`auxiliary_fan`, `M106 P2`).
    pub aux_fan: bool,

    // The process.
    pub process: String,
    pub layer_height: f64,
    pub first_layer_height: f64,
    pub wall_loops: usize,
    pub top_shell_layers: usize,
    pub bottom_shell_layers: usize,
    pub top_shell_thickness: f64,
    pub bottom_shell_thickness: f64,
    pub sparse_density: f64,
    /// Degrees from the X axis.
    pub infill_direction: f64,
    pub solid_infill_direction: f64,
    pub outer_wall_width: f64,
    pub inner_wall_width: f64,
    pub sparse_infill_width: f64,
    pub solid_infill_width: f64,
    pub top_surface_width: f64,
    pub first_layer_width: f64,
    /// The process's own line width (`line_width`), which Orca measures sharp tails and small overhangs in.
    pub line_width: f64,
    /// Share of the infill line's width the infill reaches into the innermost wall.
    pub infill_wall_overlap: f64,
    pub top_bottom_infill_wall_overlap: f64,
    /// mm²: sparse infill regions smaller than this are printed solid.
    pub min_sparse_infill_area: f64,
    /// mm: how far the end of a sparse infill line that joins no other follows the wall (Orca's `infill_anchor`,
    /// in % of the line spacing).
    pub infill_anchor: f64,
    /// mm: the longest stretch of wall that joins two sparse infill lines into one (`infill_anchor_max`).
    pub infill_anchor_max: f64,
    /// Lightning infill's angles, degrees (Orca's `lightning_overhang_angle`, `lightning_prune_angle` and
    /// `lightning_straightening_angle`): how far in the walls hold up the layer above, how far each layer cuts the
    /// trees' tips back, and how far it may move a node to straighten them, each as a slope over one layer.
    pub lightning_angles: [f64; 3],
    pub elephant_foot: f64,
    /// mm: how far a contour may be simplified.
    pub resolution: f64,
    /// mm between the first layer and a skirt (there is none, but Orca levels the bed that far around the first
    /// layer all the same).
    pub skirt_distance: f64,
    /// mm: how wide a brim people turn on is (`brim_width`), and how far any brim keeps off its object
    /// (`brim_object_gap`).
    pub brim_width: f64,
    pub brim_object_gap: f64,
    /// The brim's flow, a share of its line's (`brim_flow_ratio`).
    pub brim_flow_ratio: f64,
    /// mm a loop stops short of where it started (`seam_gap`, a share of the nozzle), so it doesn't print over its
    /// start.
    pub seam_gap: f64,
    pub only_one_wall_top: bool,
    /// How wide a top must be before it gets one wall (`min_width_top_surface`, a share of the inner wall's width).
    pub min_width_top_surface: Share,
    /// mm: how wide bridge lines are (`bridge_line_width`, a share of the nozzle); 0 for solid infill's width.
    pub bridge_width: f64,
    /// Whether bridges over air and over sparse infill print as round threads, a bridge line wide and as high
    /// (`thick_bridges`, `thick_internal_bridges`), rather than flat at the layer's height.
    pub thick_bridges: bool,
    pub thick_internal_bridges: bool,
    /// How much more plastic bridges and overhang walls carry than their lines' cross-section (`bridge_flow`: 1.5 on
    /// the 0.2 mm nozzle), and internal bridges on top of it as the G-code is written (`internal_bridge_flow`).
    pub bridge_flow_ratio: f64,
    pub internal_bridge_flow: f64,
    /// Whether narrow bands of solid infill print as loops instead of lines
    /// (`detect_narrow_internal_solid_infill`).
    pub narrow_solid_loops: bool,
    /// Whether a wall's stretches more than half the nozzle beyond the layer below print as overhang walls
    /// (`detect_overhang_wall`).
    pub detect_overhang_wall: bool,

    // What the process asks for by name, which this prints as it can (`fallbacks`) or refuses (`unsupported`).
    pub sparse_infill_pattern: String,
    pub top_surface_pattern: String,
    pub bottom_surface_pattern: String,
    pub internal_solid_infill_pattern: String,
    pub wall_generator: String,
    pub brim_type: String,
    pub enable_support: bool,
    pub spiral_mode: bool,
    pub print_sequence: String,
    pub ironing_type: String,
    pub fuzzy_skin: String,
    /// How the nozzle lifts on a retraction (`z_hop_types`, the filament's own first).
    pub z_hop_type: String,

    // Speeds, mm/s.
    pub outer_wall_speed: f64,
    pub inner_wall_speed: f64,
    pub sparse_infill_speed: f64,
    pub solid_infill_speed: f64,
    pub top_surface_speed: f64,
    pub gap_infill_speed: f64,
    pub bridge_speed: f64,
    pub internal_bridge_speed: f64,
    pub travel_speed: f64,
    pub first_layer_speed: f64,
    pub first_layer_infill_speed: f64,
    /// Supports' speed (`support_speed`, which Orca's auto brim also weighs among the fastest speeds) and their
    /// interfaces' (`support_interface_speed`).
    pub support_speed: f64,
    pub support_interface_speed: f64,
    /// Normal supports (`support.rs`).
    pub support: SupportSettings,
    /// Whether walls and bridges slow down over overhangs (`enable_overhang_speed`), and how far where a quarter,
    /// half, three quarters and all of a line hangs (`overhang_1_4_speed` to `overhang_4_4_speed`: mm/s, or a share
    /// of the wall's speed; under 0.5 mm/s, not at all).
    pub overhang_speed: bool,
    pub overhang_speeds: [Share; 4],
    /// Orca's slowing down over walls that curled up below (`slowdown_for_curled_perimeters`), which isn't modelled:
    /// it only makes the slowest overhang speed `overhang_4_4_speed` instead of the bridge speed.
    pub slow_for_curls: bool,
    /// The overhang fan: how much of a line's width may rest on the layer below for the fan to come on (from
    /// `overhang_fan_threshold`), or below zero where it never does (`enable_overhang_bridge_fan` off).
    pub overhang_fan_overlap: f64,

    // Accelerations, mm/s².
    pub default_accel: f64,
    pub outer_wall_accel: f64,
    pub inner_wall_accel: f64,
    pub top_surface_accel: f64,
    pub bridge_accel: f64,
    pub first_layer_accel: f64,
    pub travel_accel: f64,
    pub first_layer_travel_accel: f64,

    // Retraction and travel.
    pub retract_length: f64,
    pub retract_speed: f64,
    pub deretract_speed: f64,
    pub retract_min_travel: f64,
    /// No retraction on travels to infill that stay inside the object (Orca's `reduce_infill_retraction`).
    pub reduce_infill_retraction: bool,
    pub z_hop: f64,
    /// Degrees: how steeply a spiral lift climbs (its turn's radius is the z-hop over 2π·atan of it).
    pub travel_slope: f64,
    pub wipe_distance: f64,

    // The filament.
    pub filament: String,
    pub filament_type: String,
    pub filament_colour: String,
    /// Bambu's id for the filament (`tray_info_idx`), which the printer matches against what its trays hold: known
    /// for Bambu PLA Basic, empty for the generic presets (the engine's presets carry Orca's own ids).
    pub filament_tray: String,
    pub filament_diameter: f64,
    pub filament_density: f64,
    pub flow_ratio: f64,
    pub max_volumetric_speed: f64,
    /// °C from the second layer on, and on the first.
    pub nozzle_temperature: f64,
    pub first_layer_nozzle_temperature: f64,
    pub bed_temperature: f64,
    pub first_layer_bed_temperature: f64,
    pub bed_type: String,
    /// Per kg.
    pub filament_cost: f64,
    pub slow_down_layer_time: f64,
    pub slow_down_min_speed: f64,
    /// The part fan, as Orca's cooling sets it each layer: off for the first `fan_off_layers` layers, then at
    /// `fan_max_speed` for a layer shorter than `slow_down_layer_time`, easing to `fan_min_speed` by
    /// `fan_cooling_layer_time`, and past that `fan_min_speed` if `fan_always_on`, else off. The ramp
    /// `full_fan_speed_layer` raises it over the first layers. Speeds are shares of full (0 to 1).
    pub fan_off_layers: usize,
    pub fan_min_speed: f64,
    pub fan_max_speed: f64,
    pub fan_cooling_layer_time: f64,
    pub fan_always_on: bool,
    pub full_fan_speed_layer: usize,
    /// The auxiliary fan from the first fan layer on (the printer's layer change G-code sets it lower for the first
    /// layers itself).
    pub aux_fan_speed: f64,
}

/// What normal supports are made with (`support.rs`), by Orca's keys.
#[derive(Clone, Debug)]
pub struct SupportSettings {
    /// `support_type` ("normal(auto)", "tree(auto)"…) and `support_style` ("default", "grid", "snug"…).
    pub kind: String,
    pub style: String,
    /// Degrees from vertical beyond which an overhang needs support (`support_threshold_angle`).
    pub threshold_angle: f64,
    pub remove_small_overhang: bool,
    /// Supports only under what would fall (`support_critical_regions_only`, the app's "where needed"): trees hold
    /// up only overhangs that reach far from what holds them and islands that start in the air; normal supports
    /// ignore it, as Orca's do.
    pub critical_regions_only: bool,
    /// mm between support and the object above it, below it, beside it, and beside it on the first layer.
    pub top_z_distance: f64,
    pub bottom_z_distance: f64,
    pub xy_distance: f64,
    pub first_layer_xy_distance: f64,
    /// Layers of dense interface on top of the support and under it (the contact layer among them).
    pub top_interface_layers: usize,
    pub bottom_interface_layers: usize,
    /// mm between the columns' lines and the interfaces' (`support_base_pattern_spacing`,
    /// `support_interface_spacing`, `support_bottom_interface_spacing`).
    pub base_spacing: f64,
    pub interface_spacing: f64,
    pub bottom_interface_spacing: f64,
    pub line_width: f64,
    /// The first layer's flange: its density (a share) and how far it reaches past the columns, mm
    /// (`raft_first_layer_density`, `raft_first_layer_expansion`).
    pub first_layer_density: f64,
    pub first_layer_expansion: f64,
    /// The thinnest and thickest layer the printer prints (`min_layer_height`, `max_layer_height`), which bound the
    /// support's own layers.
    pub min_layer_height: f64,
    pub max_layer_height: f64,
    // Settings that change normal supports in ways this doesn't follow, which `unsupported` refuses.
    pub base_pattern: String,
    pub interface_pattern: String,
    pub raft_layers: i64,
    pub on_build_plate_only: bool,
    pub bridge_no_support: bool,
    pub enforce_layers: i64,
    pub expansion: f64,
    pub angle: f64,
    pub independent_layer_height: bool,
    pub ironing: bool,
    pub interface_loops: bool,
    pub wall_count: i64,
    /// Orca's organic trees (`tree_support_*`): the branches' diameter and their angle from vertical, fast and slow
    /// (degrees), how far apart their tips start, the tips' diameter, how much faster the diameter grows than the
    /// branch leans (degrees), and the share of a tip's area that is roof (percent).
    pub tree_branch_diameter: f64,
    pub tree_branch_angle: f64,
    pub tree_angle_slow: f64,
    pub tree_branch_distance: f64,
    pub tree_tip_diameter: f64,
    pub tree_branch_diameter_angle: f64,
    pub tree_top_rate: f64,
    /// `min_feature_size` as the trees read it: its number, a share of the nozzle, taken as millimetres.
    pub min_feature_size: f64,
    pub filament: i64,
    pub interface_filament: i64,
}

/// A setting that may be a share of another (Orca's float-or-percent): "50%" or "50".
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Share {
    pub value: f64,
    pub percent: bool,
}

impl Share {
    pub fn parse(text: &str) -> Share {
        match text.trim().strip_suffix('%') {
            Some(v) => Share { value: v.trim().parse().unwrap_or(0.0), percent: true },
            None => Share { value: text.trim().parse().unwrap_or(0.0), percent: false },
        }
    }

    /// Its value in mm/s (or whatever `base` is in).
    pub fn of(self, base: f64) -> f64 {
        if self.percent { self.value / 100.0 * base } else { self.value }
    }
}

/// The overlap under which Orca's overhang fan comes on, from `overhang_fan_threshold`
/// (`overhang_fan_overlap_threshold`); below zero for "0%", where it depends on no overlap.
fn overhang_fan_overlap(threshold: &str) -> f64 {
    match threshold.trim() {
        "10%" | "5%" => 0.9,
        "25%" => 0.75,
        "50%" => 0.5,
        "75%" => 0.25,
        "95%" => 0.05,
        _ => -1.0,
    }
}

impl SupportSettings {
    /// Whether these are Orca's organic trees: tree supports made where they are needed, in the default style (which
    /// Orca makes organic, as it does the grid and snug styles of normal supports) or the organic one.
    pub fn organic(&self) -> bool {
        self.kind == "tree(auto)" && matches!(self.style.as_str(), "default" | "grid" | "snug" | "organic" | "")
    }

    /// What of supports this can't slice yet, in a few words: Orca's normal supports in their grid style and its
    /// organic trees, made where they are needed, with the settings Orca's presets give them.
    fn unsupported(&self, s: &Settings) -> Option<&'static str> {
        let kind = self.kind.as_str();
        // Each by its name in the app's settings, as the app says "our own slicer can't do … yet".
        if kind == "tree(auto)" && !self.organic() {
            Some(match self.style.as_str() {
                "tree_slim" => "slim tree supports",
                "tree_strong" => "strong tree supports",
                "tree_hybrid" => "hybrid supports",
                _ => "this style of tree support",
            })
        } else if kind != "normal(auto)" && kind != "tree(auto)" {
            Some("supports painted on")
        } else if kind == "normal(auto)" && !matches!(self.style.as_str(), "default" | "grid" | "") {
            Some(if self.style == "snug" { "snug supports" } else { "this style of support" })
        } else if self.raft_layers > 0 {
            Some("a raft")
        } else if self.on_build_plate_only {
            Some("supports on the plate only")
        } else if self.threshold_angle <= 0.0 {
            Some("supports by overlap")
        } else if !(if self.organic() {
            // Other patterns fill trees' branches rather than drawing them as loops.
            matches!(self.base_pattern.as_str(), "default" | "none" | "")
        } else {
            matches!(self.base_pattern.as_str(), "default" | "rectilinear" | "")
        }) || !matches!(self.interface_pattern.as_str(), "auto" | "rectilinear" | "")
        {
            Some("this support pattern")
        } else if self.top_z_distance <= 0.0 || self.top_interface_layers == 0 || self.bottom_interface_layers == 0 {
            Some("supports without a gap or interface")
        } else if !self.independent_layer_height
            || self.enforce_layers > 0
            || self.expansion != 0.0
            || self.angle != 0.0
            || self.ironing
            || self.interface_loops
            || (self.wall_count > 0 && !self.organic())
            || self.bridge_no_support
            || s.thick_bridges
        {
            Some("these support settings")
        } else if self.filament > 1 || self.interface_filament > 1 {
            Some("supports in another filament")
        } else {
            None
        }
    }
}

impl Default for Settings {
    /// The X2D's presets: decision 0046's defaults.
    fn default() -> Self {
        Settings::from_profile(profile::x2d(), None)
    }
}

/// Orca's key for a plate's bed temperature on the first layer and after it.
pub fn plate_temperature_keys(bed_type: &str) -> (&'static str, &'static str) {
    match bed_type {
        "Cool Plate" => ("cool_plate_temp_initial_layer", "cool_plate_temp"),
        "Engineering Plate" => ("eng_plate_temp_initial_layer", "eng_plate_temp"),
        "High Temp Plate" => ("hot_plate_temp_initial_layer", "hot_plate_temp"),
        "Supertack Plate" => ("supertack_plate_temp_initial_layer", "supertack_plate_temp"),
        "Textured Cool Plate" => ("textured_cool_plate_temp_initial_layer", "textured_cool_plate_temp"),
        _ => ("textured_plate_temp_initial_layer", "textured_plate_temp"),
    }
}

/// The plate a print goes on when the presets name none: the X2D's stock plate.
pub const DEFAULT_PLATE: &str = "Textured PEI Plate";

/// Orca's own colour for a filament nobody coloured (the app's stand-in).
pub const DEFAULT_COLOUR: &str = "#F2754E";

impl Settings {
    /// The settings in `profile`, by Orca's keys. `colour` is the filament's colour as the setup gives it ("#RRGGBB"),
    /// else the preset's, else Orca's stand-in.
    pub fn from_profile(profile: Arc<Profile>, colour: Option<&str>) -> Settings {
        let p = &*profile;
        let at = |key: &str| p.float_at(key, 0);
        let share = |key: &str| p.float(key) / 100.0;
        let text = |key: &str| p.text(key).to_string();
        let nozzle_diameter = at("nozzle_diameter");
        // A line width may be a share of the nozzle; 0 is the process's default width.
        let default_width = p.float_of("line_width", nozzle_diameter);
        // A flow ratio, 1 where a preset leaves it out (or gives one Orca would refuse).
        let ratio = |key: &str| if p.text(key).is_empty() || p.float(key) <= 0.0 { 1.0 } else { p.float(key) };
        let width = |key: &str| match p.float_of(key, nozzle_diameter) {
            w if w > 0.0 => w,
            _ => default_width,
        };
        let area: Vec<[f64; 2]> = p
            .list("printable_area")
            .iter()
            .filter_map(|corner| {
                let (x, y) = corner.split_once('x')?;
                Some([x.trim().parse().ok()?, y.trim().parse().ok()?])
            })
            .collect();
        let bed = area.iter().fold([0.0f64, 0.0f64], |b, c| [b[0].max(c[0]), b[1].max(c[1])]);
        // Anchors in % are of the sparse infill's spacing at the object's layer height.
        let sparse_spacing = Settings::spacing(width("sparse_infill_line_width"), p.float("layer_height"));
        let infill_anchor_max = p.float_of("infill_anchor_max", sparse_spacing);
        let infill_anchor = p.float_of("infill_anchor", sparse_spacing).min(infill_anchor_max);
        let bed_type = match p.text("curr_bed_type") {
            "" => DEFAULT_PLATE.to_string(),
            plate => plate.to_string(),
        };
        let (first_plate_key, plate_key) = plate_temperature_keys(&bed_type);
        let filament = Profile::name(&p.filament, "filament_settings_id");
        let default_accel = at("default_acceleration");
        let outer_wall_accel = at("outer_wall_acceleration");
        let bridge_speed = at("bridge_speed");
        let travel_accel = at("travel_acceleration");
        let z_hop_type = match p.list("filament_z_hop_types").first() {
            Some(t) if *t != "nil" && !t.is_empty() => t.to_string(),
            _ => text("z_hop_types"),
        };
        let colour = colour
            .filter(|c| !c.is_empty())
            .map(str::to_string)
            .or_else(|| p.list("filament_colour").first().filter(|c| !c.is_empty()).map(|c| c.to_string()))
            .unwrap_or_else(|| DEFAULT_COLOUR.to_string());
        Settings {
            palette: None,
            printer: Profile::name(&p.machine, "printer_settings_id"),
            bed,
            max_height: p.float("printable_height"),
            nozzle_diameter,
            max_accel_xy: at("machine_max_acceleration_x"),
            max_accel_travel: at("machine_max_acceleration_travel"),
            max_accel_z: at("machine_max_acceleration_z"),
            max_accel_e: at("machine_max_acceleration_e"),
            max_accel_extruding: at("machine_max_acceleration_extruding"),
            max_accel_retract: at("machine_max_acceleration_retracting"),
            max_speed_xy: at("machine_max_speed_x"),
            max_speed_z: at("machine_max_speed_z"),
            max_speed_e: at("machine_max_speed_e"),
            max_jerk_xy: at("machine_max_jerk_x"),
            max_jerk_z: at("machine_max_jerk_z"),
            max_jerk_e: at("machine_max_jerk_e"),
            filament_load_time: p.float("machine_load_filament_time"),
            extruder_clearance_radius: p.float("extruder_clearance_radius"),
            aux_fan: p.bool("auxiliary_fan"),

            process: Profile::name(&p.process, "print_settings_id"),
            layer_height: p.float("layer_height"),
            first_layer_height: p.float("initial_layer_print_height"),
            wall_loops: p.int("wall_loops").max(0) as usize,
            top_shell_layers: p.int("top_shell_layers").max(0) as usize,
            bottom_shell_layers: p.int("bottom_shell_layers").max(0) as usize,
            top_shell_thickness: p.float("top_shell_thickness"),
            bottom_shell_thickness: p.float("bottom_shell_thickness"),
            sparse_density: share("sparse_infill_density"),
            infill_direction: p.float("infill_direction"),
            solid_infill_direction: p.float("solid_infill_direction"),
            outer_wall_width: width("outer_wall_line_width"),
            inner_wall_width: width("inner_wall_line_width"),
            sparse_infill_width: width("sparse_infill_line_width"),
            solid_infill_width: width("internal_solid_infill_line_width"),
            top_surface_width: width("top_surface_line_width"),
            first_layer_width: width("initial_layer_line_width"),
            line_width: default_width,
            infill_wall_overlap: share("infill_wall_overlap"),
            top_bottom_infill_wall_overlap: share("top_bottom_infill_wall_overlap"),
            min_sparse_infill_area: p.float("minimum_sparse_infill_area"),
            infill_anchor,
            lightning_angles: ["lightning_overhang_angle", "lightning_prune_angle", "lightning_straightening_angle"]
                .map(|key| if p.text(key).is_empty() { 45.0 } else { p.float(key) }),
            infill_anchor_max,
            elephant_foot: p.float("elefant_foot_compensation"),
            resolution: p.float("resolution"),
            skirt_distance: p.float("skirt_distance"),
            brim_width: p.float("brim_width"),
            brim_object_gap: p.float("brim_object_gap"),
            brim_flow_ratio: ratio("brim_flow_ratio"),
            seam_gap: p.float_of("seam_gap", nozzle_diameter),
            only_one_wall_top: p.bool("only_one_wall_top"),
            min_width_top_surface: Share::parse(p.text("min_width_top_surface")),
            bridge_width: p.float_of("bridge_line_width", nozzle_diameter).max(0.0),
            thick_bridges: p.bool("thick_bridges"),
            thick_internal_bridges: p.bool("thick_internal_bridges"),
            bridge_flow_ratio: ratio("bridge_flow"),
            internal_bridge_flow: ratio("internal_bridge_flow"),
            narrow_solid_loops: p.bool("detect_narrow_internal_solid_infill"),
            detect_overhang_wall: p.bool("detect_overhang_wall"),

            sparse_infill_pattern: text("sparse_infill_pattern"),
            top_surface_pattern: text("top_surface_pattern"),
            bottom_surface_pattern: text("bottom_surface_pattern"),
            internal_solid_infill_pattern: text("internal_solid_infill_pattern"),
            wall_generator: text("wall_generator"),
            brim_type: text("brim_type"),
            enable_support: p.bool("enable_support"),
            spiral_mode: p.bool("spiral_mode"),
            print_sequence: text("print_sequence"),
            ironing_type: text("ironing_type"),
            fuzzy_skin: text("fuzzy_skin"),
            z_hop_type,

            outer_wall_speed: at("outer_wall_speed"),
            inner_wall_speed: at("inner_wall_speed"),
            sparse_infill_speed: at("sparse_infill_speed"),
            solid_infill_speed: at("internal_solid_infill_speed"),
            top_surface_speed: at("top_surface_speed"),
            gap_infill_speed: at("gap_infill_speed"),
            bridge_speed,
            internal_bridge_speed: p.float_of("internal_bridge_speed", bridge_speed),
            travel_speed: at("travel_speed"),
            first_layer_speed: at("initial_layer_speed"),
            first_layer_infill_speed: at("initial_layer_infill_speed"),
            support_speed: at("support_speed"),
            support_interface_speed: at("support_interface_speed"),
            support: SupportSettings {
                kind: text("support_type"),
                style: text("support_style"),
                threshold_angle: p.float("support_threshold_angle"),
                remove_small_overhang: p.bool("support_remove_small_overhang"),
                critical_regions_only: p.bool("support_critical_regions_only"),
                top_z_distance: p.float("support_top_z_distance"),
                bottom_z_distance: match p.float("support_bottom_z_distance") {
                    // 0 is the top distance.
                    d if d > 0.0 => d,
                    _ => p.float("support_top_z_distance"),
                },
                xy_distance: p.float("support_object_xy_distance"),
                first_layer_xy_distance: p.float("support_object_first_layer_gap"),
                top_interface_layers: p.int("support_interface_top_layers").max(0) as usize,
                bottom_interface_layers: match p.int("support_interface_bottom_layers") {
                    // -1 is as many as on top.
                    n if n < 0 => p.int("support_interface_top_layers").max(0) as usize,
                    n => n as usize,
                },
                base_spacing: p.float("support_base_pattern_spacing"),
                interface_spacing: p.float("support_interface_spacing"),
                bottom_interface_spacing: p.float("support_bottom_interface_spacing"),
                line_width: width("support_line_width"),
                first_layer_density: share("raft_first_layer_density"),
                first_layer_expansion: p.float("raft_first_layer_expansion"),
                min_layer_height: at("min_layer_height"),
                max_layer_height: at("max_layer_height"),
                base_pattern: text("support_base_pattern"),
                interface_pattern: text("support_interface_pattern"),
                raft_layers: p.int("raft_layers"),
                on_build_plate_only: p.bool("support_on_build_plate_only"),
                bridge_no_support: p.bool("bridge_no_support"),
                enforce_layers: p.int("enforce_support_layers"),
                expansion: p.float("support_expansion"),
                angle: p.float("support_angle"),
                independent_layer_height: p.text("independent_support_layer_height") != "0",
                ironing: p.bool("support_ironing"),
                interface_loops: p.bool("support_interface_loop_pattern"),
                wall_count: p.int("tree_support_wall_count"),
                tree_branch_diameter: p.float("tree_support_branch_diameter_organic"),
                tree_branch_angle: p.float("tree_support_branch_angle_organic"),
                tree_angle_slow: p.float("tree_support_angle_slow"),
                tree_branch_distance: p.float("tree_support_branch_distance_organic"),
                tree_tip_diameter: p.float("tree_support_tip_diameter"),
                tree_branch_diameter_angle: p.float("tree_support_branch_diameter_angle"),
                tree_top_rate: p.float("tree_support_top_rate"),
                min_feature_size: p.float("min_feature_size"),
                filament: p.int("support_filament"),
                interface_filament: p.int("support_interface_filament"),
            },
            overhang_speed: p.bool("enable_overhang_speed"),
            overhang_speeds: ["overhang_1_4_speed", "overhang_2_4_speed", "overhang_3_4_speed", "overhang_4_4_speed"]
                .map(|key| Share::parse(p.list(key).first().copied().unwrap_or("0"))),
            slow_for_curls: p.bool("slowdown_for_curled_perimeters"),
            overhang_fan_overlap: if p.bool("enable_overhang_bridge_fan") {
                overhang_fan_overlap(p.text("overhang_fan_threshold"))
            } else {
                -1.0
            },

            default_accel,
            outer_wall_accel,
            // 0 is the default acceleration.
            inner_wall_accel: match at("inner_wall_acceleration") {
                a if a > 0.0 => a,
                _ => default_accel,
            },
            top_surface_accel: at("top_surface_acceleration"),
            // A share of the outer wall's, as Orca reads it.
            bridge_accel: p.float_of("bridge_acceleration", outer_wall_accel),
            first_layer_accel: at("initial_layer_acceleration"),
            travel_accel,
            first_layer_travel_accel: p.float_of("initial_layer_travel_acceleration", travel_accel),

            retract_length: p.filament_or_machine("filament_retraction_length", "retraction_length"),
            retract_speed: p.filament_or_machine("filament_retraction_speed", "retraction_speed"),
            deretract_speed: match p.filament_or_machine("filament_deretraction_speed", "deretraction_speed") {
                // 0 is the retraction speed.
                v if v > 0.0 => v,
                _ => p.filament_or_machine("filament_retraction_speed", "retraction_speed"),
            },
            retract_min_travel: p
                .filament_or_machine("filament_retraction_minimum_travel", "retraction_minimum_travel"),
            reduce_infill_retraction: p.bool("reduce_infill_retraction"),
            z_hop: p.filament_or_machine("filament_z_hop", "z_hop"),
            travel_slope: at("travel_slope"),
            wipe_distance: p.filament_or_machine("filament_wipe_distance", "wipe_distance"),

            filament_tray: if filament.starts_with("Bambu PLA Basic") { "GFA00".into() } else { String::new() },
            filament,
            filament_type: text("filament_type"),
            filament_colour: colour,
            filament_diameter: at("filament_diameter"),
            filament_density: at("filament_density"),
            flow_ratio: at("filament_flow_ratio"),
            max_volumetric_speed: at("filament_max_volumetric_speed"),
            nozzle_temperature: at("nozzle_temperature"),
            first_layer_nozzle_temperature: at("nozzle_temperature_initial_layer"),
            bed_temperature: at(plate_key),
            first_layer_bed_temperature: at(first_plate_key),
            bed_type,
            filament_cost: at("filament_cost"),
            slow_down_layer_time: at("slow_down_layer_time"),
            slow_down_min_speed: at("slow_down_min_speed"),
            fan_off_layers: p.int("close_fan_the_first_x_layers").max(0) as usize,
            fan_min_speed: at("fan_min_speed") / 100.0,
            fan_max_speed: at("fan_max_speed") / 100.0,
            fan_cooling_layer_time: at("fan_cooling_layer_time"),
            fan_always_on: p.bool("reduce_fan_stop_start_freq"),
            full_fan_speed_layer: p.int("full_fan_speed_layer").max(0) as usize,
            aux_fan_speed: at("additional_cooling_fan_speed") / 100.0,
            profile,
        }
    }

    /// What this can't slice yet, which the caller should slice elsewhere (the app: with Orca's engine).
    pub fn unsupported(&self) -> Option<&'static str> {
        if self.enable_support
            && let Some(what) = self.support.unsupported(self)
        {
            Some(what)
        } else if self.support.raft_layers > 0 {
            // Orca prints a raft under the objects whether or not supports are on.
            Some("a raft")
        } else if self.spiral_mode {
            Some("spiral vase mode")
        } else if self.print_sequence == "by object" {
            Some("printing one object after another")
        } else if !matches!(self.brim_type.as_str(), "auto_brim" | "outer_only" | "no_brim" | "") {
            Some(match self.brim_type.as_str() {
                "brim_ears" => "brim ears",
                "inner_only" | "outer_and_inner" => "a brim inside holes",
                _ => "this kind of brim",
            })
        } else {
            None
        }
    }

    /// What this prints otherwise than the presets ask, in a few words each (empty when it prints what they ask).
    pub fn fallbacks(&self) -> Vec<String> {
        let mut out = Vec::new();
        if !matches!(
            self.sparse_infill_pattern.as_str(),
            "zig-zag" | "rectilinear" | "crosshatch" | "gyroid" | "grid" | "cubic" | "honeycomb" | "lightning" | ""
        ) {
            out.push(format!("{} sparse infill printed as straight lines", self.sparse_infill_pattern));
        }
        for (what, pattern) in [
            ("top surfaces", &self.top_surface_pattern),
            ("bottom surfaces", &self.bottom_surface_pattern),
            ("solid infill", &self.internal_solid_infill_pattern),
        ] {
            if !matches!(pattern.as_str(), "monotonic" | "monotonicline" | "zig-zag" | "rectilinear" | "") {
                out.push(format!("{pattern} {what} printed as zig-zag"));
            }
        }
        if self.wall_generator == "arachne" {
            out.push("arachne walls printed as classic walls".into());
        }
        if !matches!(self.ironing_type.as_str(), "no ironing" | "") {
            out.push("no ironing".into());
        }
        if !matches!(self.fuzzy_skin.as_str(), "disabled_fuzzy" | "none" | "") {
            out.push("no fuzzy skin".into());
        }
        if self.z_hop > 0.0 && self.z_hop_type != "Spiral Lift" {
            out.push(format!("{} printed as spiral lifts", self.z_hop_type));
        }
        out
    }
    /// The cross-section of the filament, mm².
    pub fn filament_area(&self) -> f64 {
        PI * (self.filament_diameter / 2.0).powi(2)
    }

    /// mm³ per mm of an extrusion this wide and high: a rectangle with round ends (OrcaSlicer's flow model).
    pub fn mm3_per_mm(width: f64, height: f64) -> f64 {
        height * (width - height * (1.0 - PI / 4.0))
    }

    /// Centre to centre of two touching extrusions this wide and high.
    pub fn spacing(width: f64, height: f64) -> f64 {
        width - height * (1.0 - PI / 4.0)
    }

    /// A bridge on a layer `h` high, over air or (`internal`) over sparse infill, as Orca's `bridging_flow`: a thick
    /// bridge is a round thread a bridge line wide (else the nozzle's width), its lines that and 0.05 mm apart; any
    /// other is a flat line at the layer's height, a bridge line wide (else solid infill's width). Either carries
    /// `bridge_flow` times the plastic.
    pub fn bridge_flow(&self, internal: bool, h: f64) -> Flow {
        let thick = if internal { self.thick_internal_bridges } else { self.thick_bridges };
        self.bridging_flow(self.solid_infill_width, thick, h)
    }

    /// An overhang wall on a layer `h` high: Orca's bridging flow for walls, a bridge line wide (else an inner
    /// wall's), round threads where bridges are thick.
    pub fn overhang_wall_flow(&self, h: f64) -> Flow {
        self.bridging_flow(self.inner_wall_width, self.thick_bridges, h)
    }

    /// Orca's `LayerRegion::bridging_flow`, from a flat line `base` wide where no bridge line width is given.
    fn bridging_flow(&self, base: f64, thick: bool, h: f64) -> Flow {
        let given = (self.bridge_width > 0.0).then_some(self.bridge_width);
        let ratio = self.bridge_flow_ratio;
        if thick {
            let d = given.unwrap_or(self.nozzle_diameter);
            // Orca grows the thread's diameter by the ratio's square root, in single precision.
            let d = if ratio != 1.0 { (d as f32 * ratio.sqrt() as f32) as f64 } else { d };
            Flow { width: d, height: d, mm3_per_mm: PI * (d / 2.0).powi(2), spacing: d + 0.05 }
        } else {
            Flow::flat(given.unwrap_or(base), h).with_flow_ratio(ratio)
        }
    }

    /// Extruded filament (mm) per mm³ of plastic.
    pub fn e_per_mm3(&self) -> f64 {
        self.flow_ratio / self.filament_area()
    }

    /// The fastest an extrusion of this cross-section may go (the filament's volumetric limit).
    pub fn speed_cap(&self, mm3_per_mm: f64) -> f64 {
        if mm3_per_mm <= 0.0 { f64::INFINITY } else { self.max_volumetric_speed / mm3_per_mm }
    }

    /// The file's `project_settings.config`: the keys Spaghetti's reader, Bambu Studio and Orca look at, with
    /// per-filament and per-nozzle values as lists, as Orca writes them.
    pub fn project_settings(&self) -> Vec<(&'static str, Value)> {
        let f = |v: f64| Value::One(trim(v));
        let one = |v: &str| Value::One(v.to_string());
        let list = |v: String| Value::List(vec![v]);
        let (first_plate_key, plate_key) = plate_temperature_keys(&self.bed_type);
        vec![
            ("printer_settings_id", one(&self.printer)),
            ("print_settings_id", one(&self.process)),
            ("filament_settings_id", list(self.filament.clone())),
            ("printer_model", one(self.profile.machine.get("printer_model").and_then(|v| v.as_str()).unwrap_or(""))),
            ("nozzle_diameter", list(trim(self.nozzle_diameter))),
            ("layer_height", f(self.layer_height)),
            ("initial_layer_print_height", f(self.first_layer_height)),
            ("wall_loops", Value::One(self.wall_loops.to_string())),
            ("top_shell_layers", Value::One(self.top_shell_layers.to_string())),
            ("bottom_shell_layers", Value::One(self.bottom_shell_layers.to_string())),
            ("sparse_infill_density", Value::One(format!("{}%", trim(self.sparse_density * 100.0)))),
            ("sparse_infill_pattern", one(&self.sparse_infill_pattern)),
            ("enable_support", one(if self.enable_support { "1" } else { "0" })),
            ("curr_bed_type", one(&self.bed_type)),
            ("filament_type", list(self.filament_type.clone())),
            ("filament_colour", list(self.filament_colour.clone())),
            ("filament_density", list(trim(self.filament_density))),
            ("filament_diameter", list(trim(self.filament_diameter))),
            ("filament_flow_ratio", list(trim(self.flow_ratio))),
            ("filament_max_volumetric_speed", list(trim(self.max_volumetric_speed))),
            ("nozzle_temperature", list(trim(self.nozzle_temperature))),
            ("nozzle_temperature_initial_layer", list(trim(self.first_layer_nozzle_temperature))),
            (plate_key, list(trim(self.bed_temperature))),
            (first_plate_key, list(trim(self.first_layer_bed_temperature))),
            ("outer_wall_speed", list(trim(self.outer_wall_speed))),
            ("inner_wall_speed", list(trim(self.inner_wall_speed))),
            ("sparse_infill_speed", list(trim(self.sparse_infill_speed))),
            ("travel_speed", list(trim(self.travel_speed))),
            ("print_sequence", one(&self.print_sequence)),
        ]
    }
}

/// A setting's value in `project_settings.config`: one string, or a list (one per filament or nozzle).
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    One(String),
    List(Vec<String>),
}

impl Value {
    pub fn first(&self) -> &str {
        match self {
            Value::One(v) => v,
            Value::List(v) => v.first().map(String::as_str).unwrap_or(""),
        }
    }
}

/// 0.2 → "0.2", 220.0 → "220": numbers as slicers write them in settings.
pub fn trim(value: f64) -> String {
    let text = format!("{value:.4}");
    let text = text.trim_end_matches('0').trim_end_matches('.');
    if text.is_empty() || text == "-" { "0".into() } else { text.into() }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The X2D's presets, read by Orca's keys, give the numbers that were entered by hand from them before slicing
    /// took presets: every one of them, from the machine, the process and the filament.
    #[test]
    fn the_x2d_presets_read_by_orcas_keys_give_the_defaults() {
        let s = Settings::default();
        let numbers = [
            ("bed x", s.bed[0], 256.0),
            ("bed y", s.bed[1], 256.0),
            ("max height", s.max_height, 261.0),
            ("nozzle", s.nozzle_diameter, 0.4),
            ("max accel xy", s.max_accel_xy, 20000.0),
            ("max accel travel", s.max_accel_travel, 9000.0),
            ("max accel z", s.max_accel_z, 500.0),
            ("max accel e", s.max_accel_e, 30000.0),
            ("max accel retract", s.max_accel_retract, 30000.0),
            ("max speed xy", s.max_speed_xy, 1000.0),
            ("max speed z", s.max_speed_z, 20.0),
            ("max speed e", s.max_speed_e, 30.0),
            ("jerk xy", s.max_jerk_xy, 9.0),
            ("jerk z", s.max_jerk_z, 3.0),
            ("jerk e", s.max_jerk_e, 2.5),
            ("load time", s.filament_load_time, 29.0),
            ("clearance", s.extruder_clearance_radius, 60.0),
            ("layer height", s.layer_height, 0.2),
            ("first layer height", s.first_layer_height, 0.2),
            ("top thickness", s.top_shell_thickness, 1.0),
            ("sparse density", s.sparse_density, 0.15),
            ("infill direction", s.infill_direction, 45.0),
            ("solid direction", s.solid_infill_direction, 45.0),
            ("outer wall width", s.outer_wall_width, 0.42),
            ("inner wall width", s.inner_wall_width, 0.45),
            ("sparse width", s.sparse_infill_width, 0.45),
            ("solid width", s.solid_infill_width, 0.42),
            ("top width", s.top_surface_width, 0.42),
            ("first layer width", s.first_layer_width, 0.5),
            ("infill overlap", s.infill_wall_overlap, 0.15),
            ("top/bottom overlap", s.top_bottom_infill_wall_overlap, 0.25),
            ("min sparse area", s.min_sparse_infill_area, 15.0),
            ("elephant foot", s.elephant_foot, 0.15),
            ("resolution", s.resolution, 0.012),
            ("skirt distance", s.skirt_distance, 2.0),
            ("outer wall speed", s.outer_wall_speed, 200.0),
            ("inner wall speed", s.inner_wall_speed, 300.0),
            ("sparse speed", s.sparse_infill_speed, 270.0),
            ("solid speed", s.solid_infill_speed, 250.0),
            ("top speed", s.top_surface_speed, 200.0),
            ("gap speed", s.gap_infill_speed, 250.0),
            ("bridge speed", s.bridge_speed, 50.0),
            ("internal bridge speed", s.internal_bridge_speed, 75.0),
            ("travel speed", s.travel_speed, 1000.0),
            ("first layer speed", s.first_layer_speed, 50.0),
            ("first layer infill speed", s.first_layer_infill_speed, 105.0),
            ("default accel", s.default_accel, 10000.0),
            ("outer wall accel", s.outer_wall_accel, 5000.0),
            ("inner wall accel", s.inner_wall_accel, 10000.0),
            ("top accel", s.top_surface_accel, 2000.0),
            ("bridge accel", s.bridge_accel, 2500.0),
            ("first layer accel", s.first_layer_accel, 500.0),
            ("travel accel", s.travel_accel, 10000.0),
            ("first layer travel accel", s.first_layer_travel_accel, 6000.0),
            ("retract length", s.retract_length, 0.4),
            ("retract speed", s.retract_speed, 30.0),
            ("deretract speed", s.deretract_speed, 30.0),
            ("retract min travel", s.retract_min_travel, 1.0),
            ("z hop", s.z_hop, 0.4),
            ("travel slope", s.travel_slope, 3.0),
            ("wipe distance", s.wipe_distance, 1.0),
            ("filament diameter", s.filament_diameter, 1.75),
            ("filament density", s.filament_density, 1.26),
            ("flow ratio", s.flow_ratio, 0.98),
            ("max volumetric speed", s.max_volumetric_speed, 21.0),
            ("nozzle temperature", s.nozzle_temperature, 220.0),
            ("first layer nozzle temperature", s.first_layer_nozzle_temperature, 220.0),
            ("bed temperature", s.bed_temperature, 55.0),
            ("first layer bed temperature", s.first_layer_bed_temperature, 55.0),
            ("filament cost", s.filament_cost, 24.99),
            ("slow down time", s.slow_down_layer_time, 4.0),
            ("slow down min speed", s.slow_down_min_speed, 20.0),
            ("fan min", s.fan_min_speed, 1.0),
            ("fan max", s.fan_max_speed, 1.0),
            ("aux fan", s.aux_fan_speed, 0.7),
        ];
        for (what, got, want) in numbers {
            assert!((got - want).abs() < 1e-9, "{what}: {got}, not {want}");
        }
        assert_eq!((s.wall_loops, s.top_shell_layers, s.bottom_shell_layers, s.fan_off_layers), (2, 5, 3, 1));
        assert!(s.only_one_wall_top && s.aux_fan && s.fan_always_on && !s.enable_support);
        assert_eq!(s.printer, "Bambu Lab X2D 0.4 nozzle");
        assert_eq!(s.process, "0.20mm Standard @BBL X2D");
        assert_eq!(s.filament, "Bambu PLA Basic @BBL X2D 0.4 nozzle");
        assert_eq!((s.filament_type.as_str(), s.filament_colour.as_str()), ("PLA", "#F2754E"));
        assert_eq!((s.filament_tray.as_str(), s.bed_type.as_str()), ("GFA00", "Textured PEI Plate"));
        assert_eq!(s.unsupported(), None);
    }

    #[test]
    fn shares_and_overrides_read_as_orca_reads_them() {
        use crate::json::Json;
        use std::collections::BTreeMap;
        let map = |pairs: &[(&str, &str)]| -> BTreeMap<String, Json> {
            pairs.iter().map(|(k, v)| (k.to_string(), Json::Array(vec![Json::String(v.to_string())]))).collect()
        };
        let p = Profile::over_x2d(
            map(&[("retraction_length", "0.8"), ("z_hop", "0.6")]),
            map(&[
                ("bridge_speed", "40"),
                ("internal_bridge_speed", "200%"),
                ("outer_wall_acceleration", "4000"),
                ("bridge_acceleration", "25%"),
                ("inner_wall_acceleration", "0"),
                ("outer_wall_line_width", "110%"),
                ("sparse_infill_line_width", "0"),
            ]),
            map(&[("filament_retraction_length", "nil"), ("filament_z_hop", "0.2")]),
        );
        let s = Settings::from_profile(Arc::new(p), None);
        assert_eq!((s.bridge_speed, s.internal_bridge_speed), (40.0, 80.0));
        assert_eq!((s.bridge_accel, s.inner_wall_accel), (1000.0, 10000.0));
        // A width may be a share of the nozzle, and 0 is the default line width.
        assert!((s.outer_wall_width - 0.44).abs() < 1e-9 && s.sparse_infill_width == 0.42);
        // A filament's "nil" leaves the printer's value, anything else wins.
        assert_eq!((s.retract_length, s.z_hop), (0.8, 0.2));
    }
}
