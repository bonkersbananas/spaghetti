//! The slicing settings: the defaults of decision 0046 (the Bambu Lab X2D with its 0.4 mm nozzle, OrcaSlicer's
//! "0.20mm Standard @BBL X2D" process, "Bambu PLA Basic @BBL X2D 0.4 nozzle", the Textured PEI plate, supports off)
//! as plain numbers, read from the presets the app's engine flattens (`presets.json`, Orca 2.5.0-dev). Where a
//! preset value is a list per extruder variant, the first one (the left nozzle, "Direct Drive Standard") is used.

use std::f64::consts::PI;

#[derive(Clone, Debug)]
pub struct Settings {
    // The machine.
    pub printer: &'static str,
    pub bed: [f64; 2],
    pub max_height: f64,
    pub nozzle_diameter: f64,
    pub max_accel_xy: f64,
    pub max_accel_travel: f64,
    pub max_accel_z: f64,
    pub max_accel_e: f64,
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

    // The process.
    pub process: &'static str,
    pub layer_height: f64,
    pub first_layer_height: f64,
    pub wall_loops: usize,
    pub top_shell_layers: usize,
    pub bottom_shell_layers: usize,
    pub top_shell_thickness: f64,
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
    /// Share of the infill line's width the infill reaches into the innermost wall.
    pub infill_wall_overlap: f64,
    pub top_bottom_infill_wall_overlap: f64,
    /// mm²: sparse infill regions smaller than this are printed solid.
    pub min_sparse_infill_area: f64,
    pub elephant_foot: f64,
    /// mm: how far a contour may be simplified.
    pub resolution: f64,
    /// mm between the first layer and a skirt (there is none, but Orca levels the bed that far around the first
    /// layer all the same).
    pub skirt_distance: f64,
    pub only_one_wall_top: bool,

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

    // Accelerations, mm/s².
    pub default_accel: f64,
    pub outer_wall_accel: f64,
    pub inner_wall_accel: f64,
    pub top_surface_accel: f64,
    pub bridge_accel: f64,
    pub first_layer_accel: f64,
    pub travel_accel: f64,
    pub first_layer_travel_accel: f64,
    pub print_jerk: f64,
    pub travel_jerk: f64,

    // Retraction and travel.
    pub retract_length: f64,
    pub retract_speed: f64,
    pub deretract_speed: f64,
    pub retract_min_travel: f64,
    pub z_hop: f64,
    /// Degrees: how steeply a spiral lift climbs (its turn's radius is the z-hop over 2π·atan of it).
    pub travel_slope: f64,
    pub wipe_distance: f64,

    // The filament.
    pub filament: &'static str,
    pub filament_type: &'static str,
    pub filament_colour: &'static str,
    pub filament_diameter: f64,
    pub filament_density: f64,
    pub flow_ratio: f64,
    pub max_volumetric_speed: f64,
    pub nozzle_temperature: f64,
    pub bed_temperature: f64,
    pub bed_type: &'static str,
    /// Per kg.
    pub filament_cost: f64,
    pub slow_down_layer_time: f64,
    pub slow_down_min_speed: f64,
    /// The part fan is off for this many layers, then at `fan_speed`, and the auxiliary fan with it at
    /// `aux_fan_speed` (as Orca's cooling sets them; the printer's layer change G-code then sets the auxiliary fan
    /// lower for the first layers itself).
    pub fan_off_layers: usize,
    pub fan_speed: f64,
    pub aux_fan_speed: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            printer: "Bambu Lab X2D 0.4 nozzle",
            bed: [256.0, 256.0],
            max_height: 261.0,
            nozzle_diameter: 0.4,
            max_accel_xy: 20000.0,
            max_accel_travel: 9000.0,
            max_accel_z: 500.0,
            max_accel_e: 30000.0,
            max_accel_retract: 30000.0,
            max_speed_xy: 1000.0,
            max_speed_z: 20.0,
            max_speed_e: 30.0,
            max_jerk_xy: 9.0,
            max_jerk_z: 3.0,
            max_jerk_e: 2.5,
            filament_load_time: 29.0,
            extruder_clearance_radius: 60.0,

            process: "0.20mm Standard @BBL X2D",
            layer_height: 0.2,
            first_layer_height: 0.2,
            wall_loops: 2,
            top_shell_layers: 5,
            bottom_shell_layers: 3,
            top_shell_thickness: 1.0,
            sparse_density: 0.15,
            infill_direction: 45.0,
            solid_infill_direction: 45.0,
            outer_wall_width: 0.42,
            inner_wall_width: 0.45,
            sparse_infill_width: 0.45,
            solid_infill_width: 0.42,
            top_surface_width: 0.42,
            first_layer_width: 0.5,
            infill_wall_overlap: 0.15,
            top_bottom_infill_wall_overlap: 0.25,
            min_sparse_infill_area: 15.0,
            elephant_foot: 0.15,
            resolution: 0.012,
            skirt_distance: 2.0,
            only_one_wall_top: true,

            outer_wall_speed: 200.0,
            inner_wall_speed: 300.0,
            sparse_infill_speed: 270.0,
            solid_infill_speed: 250.0,
            top_surface_speed: 200.0,
            gap_infill_speed: 250.0,
            bridge_speed: 50.0,
            internal_bridge_speed: 75.0,
            travel_speed: 1000.0,
            first_layer_speed: 50.0,
            first_layer_infill_speed: 105.0,

            default_accel: 10000.0,
            outer_wall_accel: 5000.0,
            inner_wall_accel: 10000.0,
            top_surface_accel: 2000.0,
            bridge_accel: 2500.0,
            first_layer_accel: 500.0,
            travel_accel: 10000.0,
            first_layer_travel_accel: 6000.0,
            print_jerk: 9.0,
            travel_jerk: 12.0,

            retract_length: 0.4,
            retract_speed: 30.0,
            deretract_speed: 30.0,
            retract_min_travel: 1.0,
            z_hop: 0.4,
            travel_slope: 3.0,
            wipe_distance: 1.0,

            filament: "Bambu PLA Basic @BBL X2D 0.4 nozzle",
            filament_type: "PLA",
            filament_colour: "#F2754E",
            filament_diameter: 1.75,
            filament_density: 1.26,
            flow_ratio: 0.98,
            max_volumetric_speed: 21.0,
            nozzle_temperature: 220.0,
            bed_temperature: 55.0,
            bed_type: "Textured PEI Plate",
            filament_cost: 24.99,
            slow_down_layer_time: 4.0,
            slow_down_min_speed: 20.0,
            fan_off_layers: 1,
            fan_speed: 1.0,
            aux_fan_speed: 0.7,
        }
    }
}

impl Settings {
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

    /// mm³ per mm of a bridge: a round thread the nozzle's width.
    pub fn bridge_mm3_per_mm(&self) -> f64 {
        PI * (self.nozzle_diameter / 2.0).powi(2)
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
        let list = |v: String| Value::List(vec![v]);
        vec![
            ("printer_settings_id", Value::One(self.printer.into())),
            ("print_settings_id", Value::One(self.process.into())),
            ("filament_settings_id", list(self.filament.into())),
            ("printer_model", Value::One("Bambu Lab X2D".into())),
            ("nozzle_diameter", list(trim(self.nozzle_diameter))),
            ("layer_height", f(self.layer_height)),
            ("initial_layer_print_height", f(self.first_layer_height)),
            ("wall_loops", Value::One(self.wall_loops.to_string())),
            ("top_shell_layers", Value::One(self.top_shell_layers.to_string())),
            ("bottom_shell_layers", Value::One(self.bottom_shell_layers.to_string())),
            ("sparse_infill_density", Value::One(format!("{}%", trim(self.sparse_density * 100.0)))),
            ("sparse_infill_pattern", Value::One("crosshatch".into())),
            ("enable_support", Value::One("0".into())),
            ("curr_bed_type", Value::One(self.bed_type.into())),
            ("filament_type", list(self.filament_type.into())),
            ("filament_colour", list(self.filament_colour.into())),
            ("filament_density", list(trim(self.filament_density))),
            ("filament_diameter", list(trim(self.filament_diameter))),
            ("filament_flow_ratio", list(trim(self.flow_ratio))),
            ("filament_max_volumetric_speed", list(trim(self.max_volumetric_speed))),
            ("nozzle_temperature", list(trim(self.nozzle_temperature))),
            ("nozzle_temperature_initial_layer", list(trim(self.nozzle_temperature))),
            ("textured_plate_temp", list(trim(self.bed_temperature))),
            ("textured_plate_temp_initial_layer", list(trim(self.bed_temperature))),
            ("outer_wall_speed", list(trim(self.outer_wall_speed))),
            ("inner_wall_speed", list(trim(self.inner_wall_speed))),
            ("sparse_infill_speed", list(trim(self.sparse_infill_speed))),
            ("travel_speed", list(trim(self.travel_speed))),
            ("print_sequence", Value::One("by layer".into())),
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
