//! The presets this slices with, as OrcaSlicer's flattened JSON: the printer, the process and the filament. By
//! default they are the X2D's (Bambu Lab X2D 0.4 nozzle, 0.20mm Standard @BBL X2D, Bambu PLA Basic @BBL X2D 0.4
//! nozzle): the files the app's slicing engine ships (release slicer-v1, from OrcaSlicer 2.5.0-dev,
//! Muon-3D/OrcaSlicer 2d1163eb6f), copied verbatim into `profiles/x2d/`. A slice setup (`setup.rs`) brings others,
//! as the app's `sliceSetup` makes them from people's slicing settings. The settings (`config.rs`) and the
//! printer's start, end, layer change and timelapse G-code (`bambu.rs`) come from them.

use crate::json::{self, Json};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

#[derive(Debug)]
pub struct Profile {
    pub machine: BTreeMap<String, Json>,
    pub process: BTreeMap<String, Json>,
    pub filament: BTreeMap<String, Json>,
}

const MACHINE: &str = include_str!("../profiles/x2d/machine.json");
const PROCESS: &str = include_str!("../profiles/x2d/process.json");
const FILAMENT: &str = include_str!("../profiles/x2d/filament.json");

/// The X2D's presets (read once).
pub fn x2d() -> Arc<Profile> {
    static PROFILE: OnceLock<Arc<Profile>> = OnceLock::new();
    PROFILE
        .get_or_init(|| {
            let object = |text: &str| match json::parse(text) {
                Some(Json::Object(map)) => map,
                _ => panic!("a preset in profiles/x2d is not a JSON object"),
            };
            Arc::new(Profile { machine: object(MACHINE), process: object(PROCESS), filament: object(FILAMENT) })
        })
        .clone()
}

impl Profile {
    /// The X2D's presets with `machine`, `process` and `filament` laid over them key by key: what is given wins,
    /// and a key it leaves out keeps the X2D's value (so every setting this reads is there).
    pub fn over_x2d(
        machine: BTreeMap<String, Json>,
        process: BTreeMap<String, Json>,
        filament: BTreeMap<String, Json>,
    ) -> Profile {
        let base = x2d();
        let lay = |base: &BTreeMap<String, Json>, over: BTreeMap<String, Json>| {
            let mut map = base.clone();
            map.extend(over);
            map
        };
        Profile {
            machine: lay(&base.machine, machine),
            process: lay(&base.process, process),
            filament: lay(&base.filament, filament),
        }
    }

    /// A preset's name: its `*_settings_id` when the setup set one, else the name it has in the presets.
    pub fn name(map: &BTreeMap<String, Json>, id_key: &str) -> String {
        let text = |key: &str| match map.get(key) {
            Some(Json::String(s)) => s.clone(),
            Some(Json::Array(a)) => a.first().and_then(Json::as_str).unwrap_or("").to_string(),
            _ => String::new(),
        };
        let id = text(id_key);
        if id.is_empty() { text("name") } else { id }
    }

    /// The value of `key`, from the filament, the process or the printer (in that order, as Orca's full config
    /// takes them).
    pub fn get(&self, key: &str) -> Option<&Json> {
        self.filament.get(key).or_else(|| self.process.get(key)).or_else(|| self.machine.get(key))
    }

    /// A setting's text: a plain value, or the first of a list (the first filament, extruder or variant).
    pub fn text(&self, key: &str) -> &str {
        match self.get(key) {
            Some(Json::String(s)) => s,
            Some(Json::Array(a)) => a.first().and_then(Json::as_str).unwrap_or(""),
            _ => "",
        }
    }

    /// Every value of a list setting (or the one value of a plain one).
    pub fn list(&self, key: &str) -> Vec<&str> {
        match self.get(key) {
            Some(Json::String(s)) => vec![s.as_str()],
            Some(Json::Array(a)) => a.iter().filter_map(Json::as_str).collect(),
            _ => Vec::new(),
        }
    }

    pub fn float(&self, key: &str) -> f64 {
        self.text(key).trim_end_matches('%').parse().unwrap_or(0.0)
    }

    pub fn int(&self, key: &str) -> i64 {
        let t = self.text(key);
        t.parse().unwrap_or_else(|_| t.parse::<f64>().map(|f| f as i64).unwrap_or(0))
    }

    pub fn bool(&self, key: &str) -> bool {
        matches!(self.text(key), "1" | "true")
    }

    /// The `n`th value of a list setting, as a number.
    pub fn float_at(&self, key: &str, n: usize) -> f64 {
        self.list(key).get(n).and_then(|v| v.trim_end_matches('%').parse().ok()).unwrap_or(0.0)
    }

    /// The first value of a setting that may be a share of another: "150%" is 1.5 × `of`, "75" is 75.
    pub fn float_of(&self, key: &str, of: f64) -> f64 {
        let text = self.list(key).first().copied().unwrap_or("");
        match text.strip_suffix('%') {
            Some(percent) => percent.trim().parse::<f64>().map_or(0.0, |p| p / 100.0 * of),
            None => text.trim().parse().unwrap_or(0.0),
        }
    }

    /// A filament's own value of a machine setting (`filament_retraction_length` for `retraction_length`), unless it
    /// says "nil" (the machine's then), as Orca lays a filament's retraction over the printer's.
    pub fn filament_or_machine(&self, filament_key: &str, machine_key: &str) -> f64 {
        match self.list(filament_key).first() {
            Some(v) if *v != "nil" && !v.is_empty() => v.parse().unwrap_or(0.0),
            _ => self.float_at(machine_key, 0),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_x2d_presets_are_the_ones_the_app_ships() {
        let p = x2d();
        assert_eq!(p.text("name"), "Bambu PLA Basic @BBL X2D 0.4 nozzle");
        assert_eq!(p.machine["name"].as_str(), Some("Bambu Lab X2D 0.4 nozzle"));
        assert_eq!(p.process["name"].as_str(), Some("0.20mm Standard @BBL X2D"));
        assert!(p.text("machine_start_gcode").contains(";======== X2D start gcode=========="));
        assert_eq!(p.int("textured_plate_temp_initial_layer"), 55);
        assert_eq!(p.list("nozzle_diameter"), vec!["0.4", "0.4"]);
        assert_eq!(p.float("layer_height"), 0.2);
    }
}
