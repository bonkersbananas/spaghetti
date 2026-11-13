//! The presets this slices with, as OrcaSlicer's flattened JSON: the printer (Bambu Lab X2D 0.4 nozzle), the
//! process (0.20mm Standard @BBL X2D) and the filament (Bambu PLA Basic @BBL X2D 0.4 nozzle). They are the files the
//! app's slicing engine ships (release slicer-v1, from OrcaSlicer 2.5.0-dev, Muon-3D/OrcaSlicer 2d1163eb6f), copied
//! verbatim into `profiles/x2d/`; the printer's start, end, layer change and timelapse G-code come from them.

use crate::json::{self, Json};
use std::collections::BTreeMap;
use std::sync::OnceLock;

pub struct Profile {
    pub machine: BTreeMap<String, Json>,
    pub process: BTreeMap<String, Json>,
    pub filament: BTreeMap<String, Json>,
}

const MACHINE: &str = include_str!("../profiles/x2d/machine.json");
const PROCESS: &str = include_str!("../profiles/x2d/process.json");
const FILAMENT: &str = include_str!("../profiles/x2d/filament.json");

/// The X2D's presets (read once).
pub fn x2d() -> &'static Profile {
    static PROFILE: OnceLock<Profile> = OnceLock::new();
    PROFILE.get_or_init(|| {
        let object = |text: &str| match json::parse(text) {
            Some(Json::Object(map)) => map,
            _ => panic!("a preset in profiles/x2d is not a JSON object"),
        };
        Profile { machine: object(MACHINE), process: object(PROCESS), filament: object(FILAMENT) }
    })
}

impl Profile {
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
