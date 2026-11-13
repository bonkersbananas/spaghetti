//! What OrcaSlicer writes around the toolpaths for a Bambu Lab printer, here the X2D: the machine limits, the
//! printer's own start and end G-code, and the G-code at each layer change and for each timelapse photo, filled
//! from the presets as Orca fills them (`GCode::_do_export`, `process_layer`, `process_layer_change_gcode` and
//! `generate_timelapse_gcode` in OrcaSlicer 2.5.0). The values a template sees are Orca's for one filament on the
//! X2D: filament 0, on extruder 1 (the left, direct-drive one, physical extruder 1), its "Direct Drive Standard"
//! variant, no wipe tower, no chamber heating.

use crate::profile::Profile;
use crate::template::{self, Var, Vars};

/// What the frame needs to know about the print.
#[derive(Clone, Debug, Default)]
pub struct Facts {
    /// The first layer's extent (the bounding box of its convex hull), mm on the plate.
    pub first_layer_min: [f64; 2],
    pub first_layer_max: [f64; 2],
    /// The first layer's area, mm² (Orca holds the chamber temperature for a large, flat print).
    pub first_layer_area: f64,
    /// The top of the last layer, mm.
    pub top: f64,
    /// The plate type, as Orca names it ("Textured PEI Plate").
    pub bed_type: String,
}

/// The variables, filled templates and fixed lines for one print.
pub struct Frame {
    print: Vars,
    profile: &'static Profile,
}

/// The `*_plate_temp_initial_layer` setting of a plate type.
fn bed_key(bed_type: &str) -> &'static str {
    match bed_type {
        "Cool Plate" => "cool_plate_temp_initial_layer",
        "Engineering Plate" => "eng_plate_temp_initial_layer",
        "High Temp Plate" => "hot_plate_temp_initial_layer",
        "Supertack Plate" => "supertack_plate_temp_initial_layer",
        "Textured Cool Plate" => "textured_cool_plate_temp_initial_layer",
        _ => "textured_plate_temp_initial_layer",
    }
}

/// Orca's filament index for the X2D's left extruder with a standard-flow nozzle: the first of each per-variant
/// list ("Direct Drive Standard").
const VARIANT: usize = 0;

impl Frame {
    pub fn new(profile: &'static Profile, facts: &Facts) -> Frame {
        let p = profile;
        let at = |key: &str| p.list(key).get(VARIANT).copied().unwrap_or("").to_string();
        let int_at = |key: &str| at(key).parse::<i64>().unwrap_or(0);
        let float_at = |key: &str| at(key).trim_end_matches('%').parse::<f64>().unwrap_or(0.0);

        let mut v = Vars::default();
        // From the presets, one value per filament (Orca remaps the per-variant lists by filament).
        v.ints("nozzle_temperature_initial_layer", &[int_at("nozzle_temperature_initial_layer")])
            .ints("nozzle_temperature", &[int_at("nozzle_temperature")])
            .ints("first_layer_temperature", &[int_at("nozzle_temperature_initial_layer")])
            .floats("filament_max_volumetric_speed", &[float_at("filament_max_volumetric_speed")])
            .strs("filament_type", &[p.text("filament_type")])
            .ints("filament_map", &[1])
            .ints("additional_cooling_fan_speed", &[p.int("additional_cooling_fan_speed")])
            .ints("additional_fan_full_speed_layer", &[p.int("additional_fan_full_speed_layer")])
            .ints("close_additional_fan_first_x_layers", &[p.int("close_additional_fan_first_x_layers")])
            .floats("first_x_layer_fan_speed", &[p.float("first_x_layer_fan_speed")])
            .bool("spiral_mode", p.bool("spiral_mode"))
            .str("timelapse_type", p.text("timelapse_type"))
            .str("curr_bed_type", &facts.bed_type);
        // A flush speed or temperature of 0 means the filament's maximum speed and its highest temperature.
        let flush_speed = match float_at("filament_flush_volumetric_speed") {
            0.0 => float_at("filament_max_volumetric_speed"),
            s => s,
        };
        let flush_temp = match int_at("filament_flush_temp") {
            0 => p.int("nozzle_temperature_range_high"),
            t => t,
        };
        v.floats("flush_volumetric_speeds", &[flush_speed]).ints("flush_temperatures", &[flush_temp]);
        // What Orca works out for the print.
        let chamber = p.list("chamber_temperature").iter().filter_map(|t| t.parse::<i64>().ok()).max().unwrap_or(0);
        let size =
            [facts.first_layer_max[0] - facts.first_layer_min[0], facts.first_layer_max[1] - facts.first_layer_min[1]];
        v.int("bed_temperature_initial_layer_single", p.int(bed_key(&facts.bed_type)))
            .int("overall_chamber_temperature", chamber)
            .int("min_vitrification_temperature", p.int("temperature_vitrification"))
            .bool("is_all_bbl_filament", p.text("filament_vendor") == "Bambu Lab")
            .float("max_additional_fan", p.float("additional_cooling_fan_speed"))
            // Held only for a print under 0.3 mm covering more than 40 000 mm².
            .bool(
                "hold_chamber_temp_for_flat_print",
                facts.top > 0.0 && facts.top < 0.3 && facts.first_layer_area > 40000.0,
            )
            .floats("first_layer_print_min", &facts.first_layer_min)
            .floats("first_layer_print_size", &size)
            .int("max_print_z", facts.top.ceil() as i64)
            .int("initial_filament_id", 0)
            .int("initial_no_support_filament_id", 0)
            .int("initial_no_support_hotend", -1)
            .int("initial_nozzle_id", 0)
            .int("current_filament_id", 0)
            .int("current_nozzle_id", 0)
            .ints("first_non_support_filaments", &[0, -1])
            .ints("first_filaments", &[0, -1])
            .floats(
                "nozzle_diameter_at_nozzle_id",
                &p.list("nozzle_diameter").iter().filter_map(|d| d.parse().ok()).collect::<Vec<f64>>(),
            );
        let physical = p.list("physical_extruder_map").first().and_then(|e| e.parse().ok()).unwrap_or(0);
        v.int("most_used_physical_extruder_id", physical).int("curr_physical_extruder_id", physical);
        Frame { print: v, profile }
    }

    fn fill(&self, key: &str, own: &Vars) -> String {
        let template = self.profile.text(key);
        template::process(template, &[own, &self.print], 0)
            .unwrap_or_else(|e| panic!("the X2D's {key} doesn't fill: {e}"))
    }

    /// Orca's `writeln`: the text, ending in a newline.
    fn line(text: String) -> String {
        if text.is_empty() || text.ends_with('\n') { text } else { text + "\n" }
    }

    /// The machine limits, as Orca writes them for Marlin (legacy) firmware: the left extruder's normal-mode values.
    pub fn envelope(&self) -> String {
        let p = self.profile;
        let n = |key: &str| (p.float_at(key, 0) + 0.5) as i64;
        let f = |key: &str| p.float_at(key, 0);
        format!(
            "M201 X{} Y{} Z{} E{}\nM203 X{} Y{} Z{} E{}\nM204 P{} R{} T{}\nM205 X{:.2} Y{:.2} Z{:.2} E{:.2} ; sets the jerk limits, mm/sec\n",
            n("machine_max_acceleration_x"),
            n("machine_max_acceleration_y"),
            n("machine_max_acceleration_z"),
            n("machine_max_acceleration_e"),
            n("machine_max_speed_x"),
            n("machine_max_speed_y"),
            n("machine_max_speed_z"),
            n("machine_max_speed_e"),
            n("machine_max_acceleration_extruding"),
            n("machine_max_acceleration_retracting"),
            n("machine_max_acceleration_extruding"),
            f("machine_max_jerk_x"),
            f("machine_max_jerk_y"),
            f("machine_max_jerk_z"),
            f("machine_max_jerk_e"),
        )
    }

    /// From the printer's start G-code to the spaghetti detector: everything between the machine limits and the
    /// first layer.
    pub fn start(&self) -> String {
        let mut t = String::from("; FEATURE: Custom\n");
        t += &Self::line(self.fill("machine_start_gcode", &Vars::default()));
        t += "; MACHINE_START_GCODE_END\n";
        let mut own = Vars::default();
        own.int("filament_extruder_id", 0)
            .int("current_filament_id", 0)
            .int("current_extruder_id", 0)
            .int("current_nozzle_id", 0)
            .int("layer_num", -1)
            .float("layer_z", 0.0)
            .float("max_layer_z", 0.0);
        t += &Self::line(self.fill("filament_start_gcode", &own));
        t += ";VT0\nG90\nG21\nM83 ; use relative distances for extrusion\nM981 S1 P20000 ;open spaghetti detector\n";
        t
    }

    /// The printer's G-code at the start of layer `index` (0 is the first), at `z`, the top so far `max_z`.
    pub fn layer_change(&self, index: usize, z: f64, max_z: f64) -> String {
        let mut own = Vars::default();
        own.int("layer_num", index as i64).float("layer_z", z).float("max_layer_z", max_z);
        self.fill("layer_change_gcode", &own) + "\n"
    }

    /// The printer's G-code for a timelapse photo after layer `index`, at `z`, taken at `spot` (mm on the plate, as
    /// `timelapse_position` picks it), or where the printer chooses when there is none (as Orca leaves it when its
    /// picker finds no spot).
    pub fn timelapse(&self, index: usize, z: f64, max_z: f64, spot: Option<[i64; 2]>) -> String {
        let [x, y] = spot.unwrap_or([0, 0]);
        let mut own = Vars::default();
        own.int("layer_num", index as i64)
            .float("layer_z", z)
            .float("max_layer_z", max_z)
            .int("timelapse_pos_x", x)
            .int("timelapse_pos_y", y)
            .bool("has_timelapse_safe_pos", spot.is_some())
            .bool("timelapse_inline_photo", false)
            .bool("farthest_point_timelapse_enabled", false)
            .bool("clear_to_x0", false);
        self.fill("time_lapse_gcode", &own) + "\n"
    }

    /// Where the start G-code leaves the nozzle: its last absolute X, Y and Z (mm). Commands Orca's estimator doesn't
    /// follow (the X2D's purge line, `G130`) don't count, as for it.
    pub fn start_position(&self) -> [f64; 3] {
        let mut at = [0.0f64; 3];
        let mut absolute = true;
        for line in self.start().lines() {
            let code = line.split(';').next().unwrap_or("").trim();
            let mut words = code.split_whitespace();
            match words.next() {
                Some("G90") => absolute = true,
                Some("G91") => absolute = false,
                Some("G0" | "G1") if absolute => {
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
                _ => {}
            }
        }
        at
    }

    /// From the spaghetti detector to the end of the printer's end G-code, after the last layer (`index`, at `z`).
    pub fn end(&self, index: usize, z: f64) -> String {
        let mut own = Vars::default();
        own.int("layer_num", index as i64)
            .float("layer_z", z)
            .float("max_layer_z", z)
            .int("filament_extruder_id", 0)
            .int("current_filament_id", 0)
            .int("current_extruder_id", 0)
            .int("current_nozzle_id", 0);
        let mut t =
            String::from("M981 S0 P20000 ; close spaghetti detector\n; FEATURE: Custom\n; MACHINE_END_GCODE_START\n");
        t += &Self::line(self.fill("filament_end_gcode", &own));
        t += &Self::line(self.fill("machine_end_gcode", &own));
        t
    }

    pub fn var(&self, name: &str) -> Option<&Var> {
        self.print.0.get(name)
    }
}

/// Where the printer takes the timelapse photo after the layer at `z` (mm, rounded), as Orca's picker chooses it
/// for a print made layer by layer (`TimelapsePosPicker::pick_pos_for_curr_layer`): off the plate's printable
/// area, outside every object standing at this height (its bounding box grown by half the toolhead's clearance
/// radius) and outside what lies between the camera (the plate's front left corner) and any object, the spot on
/// the edge of what is left (sampled every 5 mm) nearest the objects' middle and farthest from the camera. None
/// when nothing is left, as for Orca: the printer then picks its own spot.
pub fn timelapse_position(objects: &[crate::Object], z: f64, bed: [f64; 2], clearance: f64) -> Option<[i64; 2]> {
    use crate::geom::{self, Contour, Pt, pt, sc};
    if objects.is_empty() {
        return None;
    }
    let rect = |x0: f64, y0: f64, x1: f64, y1: f64| -> Contour {
        vec![pt(sc(x0), sc(y0)), pt(sc(x1), sc(y0)), pt(sc(x1), sc(y1)), pt(sc(x0), sc(y1))]
    };
    let mut blocked: Vec<Contour> = Vec::new();
    // Orca compares the heights as whole millimetres.
    let at = z as i64;
    let half = clearance / 2.0;
    for o in objects {
        if (o.min[2] as i64) <= at && at <= (o.max[2] as i64) {
            blocked.push(rect(o.min[0] - half, o.min[1] - half, o.max[0] + half, o.max[1] + half));
        }
    }
    // The camera's view of each object: from the plate's corner to the far sides of its bounding box, grown by
    // √2 times half the clearance radius (which Orca halves as a whole number).
    let grow = std::f64::consts::SQRT_2 * ((clearance as i64) / 2) as f64;
    for o in objects {
        let (x0, y0, x1, y1) = (o.min[0] - grow, o.min[1] - grow, o.max[0] + grow, o.max[1] + grow);
        blocked.push(vec![
            pt(0, 0),
            pt(sc(x1.max(0.0)), sc(y0.max(0.0))),
            pt(sc(x1.max(0.0)), sc(y1.max(0.0))),
            pt(sc(x0.max(0.0)), sc(y1.max(0.0))),
        ]);
    }
    let plate = vec![vec![rect(0.0, 0.0, bed[0], bed[1])]];
    let free = geom::difference(&plate, &geom::union_contours(&blocked));
    // Clipper's default miter limit (3), as Orca's opening uses.
    let miter = 2.0 * (1.0f64 / 3.0).asin();
    let free = geom::offset_mitred(&geom::offset_mitred(&free, -5.0, miter), 5.0, miter);
    if free.is_empty() {
        return None;
    }
    let n = objects.len() as f64;
    let middle = [
        objects.iter().map(|o| (o.min[0] + o.max[0]) / 2.0).sum::<f64>() / n,
        objects.iter().map(|o| (o.min[1] + o.max[1]) / 2.0).sum::<f64>() / n,
    ];
    let centre = pt(sc(middle[0]), sc(middle[1]));
    let best = if free.iter().any(|shape| geom::shape_contains(shape, centre)) {
        centre
    } else {
        // A short way from the middle, and away from the camera (in L1 distances, as Orca measures them).
        let l1 = |a: Pt, b: Pt| (a.x as f64 - b.x as f64).abs() + (a.y as f64 - b.y as f64).abs();
        let penalty = |p: Pt| l1(centre, p) - l1(pt(0, 0), p) / 3.0;
        let step = sc(5.0) as f64;
        let mut best: Option<(f64, Pt)> = None;
        for contour in free.iter().flatten() {
            for (k, &a) in contour.iter().enumerate() {
                let b = contour[(k + 1) % contour.len()];
                let length = l1(a, b);
                let mut consider = |p: Pt| {
                    let cost = penalty(p);
                    if best.is_none_or(|(c, _)| cost < c) {
                        best = Some((cost, p));
                    }
                };
                if length < step {
                    consider(a);
                } else {
                    let steps = (length / step) as i32;
                    let dx = ((b.x - a.x) as f64 * step / length) as i32;
                    let dy = ((b.y - a.y) as f64 * step / length) as i32;
                    for i in 0..=steps {
                        consider(pt(a.x + dx * i, a.y + dy * i));
                    }
                }
            }
        }
        best?.1
    };
    let spot = [geom::unsc(best.x).round() as i64, geom::unsc(best.y).round() as i64];
    // Orca takes the plate's corner itself to mean "none found".
    (spot != [0, 0]).then_some(spot)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile;

    fn benchy() -> Frame {
        // Orca's first layer of the Benchy reference: G29 A1 X63.6778 Y117.902 I42.9903 J20.1955.
        let facts = Facts {
            first_layer_min: [63.6778, 117.902],
            first_layer_max: [63.6778 + 42.9903, 117.902 + 20.1955],
            first_layer_area: 600.0,
            top: 48.0,
            bed_type: "Textured PEI Plate".into(),
        };
        Frame::new(profile::x2d(), &facts)
    }

    /// Orca 2.5.0's own output for the Benchy (Textured PEI plate), from `; FEATURE: Custom` before the start
    /// G-code to the spaghetti detector.
    const ORCA_START: &str = include_str!("../tests/orca/x2d-benchy-start.gcode");
    /// … and from the spaghetti detector after the last layer to the end of the end G-code.
    const ORCA_END: &str = include_str!("../tests/orca/x2d-benchy-end.gcode");
    /// … and layers 1 to 5's layer change G-code, each from `; CHANGE_LAYER` to `;_SET_FAN_SPEED_CHANGING_LAYER`.
    const ORCA_LAYERS: &str = include_str!("../tests/orca/x2d-benchy-layers.gcode");

    #[test]
    fn the_start_is_orcas_line_for_line() {
        let f = benchy();
        assert_eq!(
            f.envelope(),
            "M201 X20000 Y20000 Z500 E30000\nM203 X1000 Y1000 Z20 E30\nM204 P20000 R30000 T20000\nM205 X9.00 Y9.00 Z3.00 E2.50 ; sets the jerk limits, mm/sec\n"
        );
        assert_lines_eq(&f.start(), ORCA_START);
    }

    #[test]
    fn the_end_is_orcas_line_for_line() {
        assert_lines_eq(&benchy().end(239, 48.0), ORCA_END);
    }

    #[test]
    fn layer_changes_and_timelapse_are_orcas() {
        let f = benchy();
        let mut ours = String::new();
        for i in 0..5 {
            let z = 0.2 * (i + 1) as f64;
            ours += &format!("; CHANGE_LAYER\n; Z_HEIGHT: {}\n; LAYER_HEIGHT: 0.2\n", template::format_g(z));
            ours += &f.layer_change(i, z, z);
            ours += ";_SET_FAN_SPEED_CHANGING_LAYER\n";
        }
        // Orca retracts at the first layer change, before its G-code (our layer writer does that).
        assert_lines_eq(&ours, &ORCA_LAYERS.replacen("G1 E-.4 F1800\n", "", 1));
        let photo = f.timelapse(0, 0.2, 0.2, Some([131, 186]));
        assert!(photo.contains("\n        M9711 M0 E1 U131 V186 Z0.6 S11 C10 O0 T3000\n"), "{photo}");
        let anywhere = f.timelapse(0, 0.2, 0.2, None);
        assert!(anywhere.contains("\n            M9711 M0 E1 Z0.6 S11 C10 O0 T3000\n"), "{anywhere}");
        assert!(
            photo.starts_with(";======== X2D timelapse gcode ========\n") && photo.ends_with("; SKIPPABLE_END\n\n")
        );
    }

    fn object(min: [f64; 3], max: [f64; 3]) -> crate::Object {
        crate::Object { name: "model.stl".into(), label: 1, min, max }
    }

    #[test]
    fn the_timelapse_photo_is_taken_where_orcas_picker_takes_it() {
        // The benchmark's models where its STLs put them, and the spots native Orca 2.5.0 picked for every layer.
        let at = |objects: &[crate::Object], z: f64| timelapse_position(objects, z, [256.0, 256.0], 60.0);
        let benchy = [object([97.9995, 112.498, 0.0], [158.0005, 143.502, 48.0])];
        assert_eq!(at(&benchy, 0.2), Some([131, 186]));
        assert_eq!(at(&benchy, 48.0), Some([131, 186]));
        let glasses = [object([117.3979, 66.3341, 0.0], [138.6021, 189.6659, 50.5796])];
        assert_eq!(at(&glasses, 25.0), Some([181, 127]));
        let uobf = [object([84.0, 114.4957, 0.0], [172.0, 141.5043, 13.5])];
        assert_eq!(at(&uobf, 13.6), Some([127, 184]));
        // Twelve Benchys in a grid of three columns, 6 mm apart.
        let mut plate = Vec::new();
        for row in 0..4 {
            for col in 0..3 {
                let (x, y) = (31.9985 + 66.001 * col as f64, 168.004 - 37.004 * row as f64);
                plate.push(object([x, y, 0.0], [x + 60.001, y + 31.004, 48.0]));
            }
        }
        assert_eq!(at(&plate, 10.0), Some([130, 241]));
    }

    /// Line for line, leaving out Orca's progress lines (`M73 P… R…`), which its time estimator puts in wherever the
    /// percentage or the minutes left change, the start G-code too.
    fn assert_lines_eq(ours: &str, orca: &str) {
        let orca: String = orca.lines().filter(|l| !l.starts_with("M73 P")).map(|l| format!("{l}\n")).collect();
        for (n, (a, b)) in ours.lines().zip(orca.lines()).enumerate() {
            assert_eq!(a, b, "line {} differs", n + 1);
        }
        assert_eq!(ours.lines().count(), orca.lines().count());
    }
}
