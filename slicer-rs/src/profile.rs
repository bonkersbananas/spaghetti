//! The presets this slices with, as OrcaSlicer's flattened JSON: the printer, the process and the filament. By
//! default they are the X2D's (Bambu Lab X2D 0.4 nozzle, 0.20mm Standard @BBL X2D, Bambu PLA Basic @BBL X2D 0.4
//! nozzle): the files the app's slicing engine ships (its `presets.json`, in releases slicer-v1 and slicer-v2, from
//! OrcaSlicer 2.5.0-dev, Muon-3D/OrcaSlicer 2d1163eb6f), copied verbatim into `profiles/x2d/`. Natively it also
//! knows Bambu's presets for the X2D's other nozzles, from slicer-v2 (`profiles/x2d-0.2/`, `x2d-0.6/`, `x2d-0.8/`):
//! each one's machine, its Standard process and Bambu PLA Basic for it. A slice setup (`setup.rs`) brings others, as
//! the app's `sliceSetup` makes them from people's slicing settings (whole presets, for any nozzle). The settings
//! (`config.rs`) and the printer's start, end, layer change and timelapse G-code (`bambu.rs`) come from them.

use crate::json::{self, Json};
use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

#[derive(Debug)]
pub struct Profile {
    pub machine: BTreeMap<String, Json>,
    pub process: BTreeMap<String, Json>,
    pub filament: BTreeMap<String, Json>,
}

/// A nozzle's presets as the files hold them: its machine, process and filament.
struct Presets {
    nozzle: f64,
    machine: &'static str,
    process: &'static str,
    filament: &'static str,
}

const X2D: Presets = Presets {
    nozzle: 0.4,
    machine: include_str!("../profiles/x2d/machine.json"),
    process: include_str!("../profiles/x2d/process.json"),
    filament: include_str!("../profiles/x2d/filament.json"),
};

/// The other nozzles' presets, natively only: the WebAssembly module slices what the app's setup brings, which
/// carries whole presets for every nozzle, so it would only grow by them.
#[cfg(not(target_arch = "wasm32"))]
const OTHER_NOZZLES: [Presets; 3] = [
    Presets {
        nozzle: 0.2,
        machine: include_str!("../profiles/x2d-0.2/machine.json"),
        process: include_str!("../profiles/x2d-0.2/process.json"),
        filament: include_str!("../profiles/x2d-0.2/filament.json"),
    },
    Presets {
        nozzle: 0.6,
        machine: include_str!("../profiles/x2d-0.6/machine.json"),
        process: include_str!("../profiles/x2d-0.6/process.json"),
        filament: include_str!("../profiles/x2d-0.6/filament.json"),
    },
    Presets {
        nozzle: 0.8,
        machine: include_str!("../profiles/x2d-0.8/machine.json"),
        process: include_str!("../profiles/x2d-0.8/process.json"),
        filament: include_str!("../profiles/x2d-0.8/filament.json"),
    },
];

impl Presets {
    fn read(&self) -> Arc<Profile> {
        let object = |text: &str| match json::parse(text) {
            Some(Json::Object(map)) => map,
            _ => panic!("a preset in profiles/ for the {} mm nozzle is not a JSON object", self.nozzle),
        };
        Arc::new(Profile {
            machine: object(self.machine),
            process: object(self.process),
            filament: object(self.filament),
        })
    }
}

/// The X2D's presets for its 0.4 mm nozzle (read once).
pub fn x2d() -> Arc<Profile> {
    static PROFILE: OnceLock<Arc<Profile>> = OnceLock::new();
    PROFILE.get_or_init(|| X2D.read()).clone()
}

/// The X2D's presets for a nozzle `diameter` mm wide (read once): Bambu's own for 0.2, 0.4, 0.6 and 0.8 mm, natively;
/// in WebAssembly only the 0.4 mm's. `None` for any other.
pub fn x2d_nozzle(diameter: f64) -> Option<Arc<Profile>> {
    let is = |nozzle: f64| (diameter - nozzle).abs() < 1e-6;
    if is(X2D.nozzle) {
        return Some(x2d());
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        static OTHERS: [OnceLock<Arc<Profile>>; 3] = [const { OnceLock::new() }; 3];
        if let Some(k) = OTHER_NOZZLES.iter().position(|p| is(p.nozzle)) {
            return Some(OTHERS[k].get_or_init(|| OTHER_NOZZLES[k].read()).clone());
        }
    }
    None
}

impl Profile {
    /// The X2D's presets with `machine`, `process` and `filament` laid over them key by key: what is given wins,
    /// and a key it leaves out keeps the X2D's value (so every setting this reads is there).
    pub fn over_x2d(
        machine: BTreeMap<String, Json>,
        process: BTreeMap<String, Json>,
        filament: BTreeMap<String, Json>,
    ) -> Profile {
        Profile::over(&x2d(), machine, process, filament)
    }

    /// `base` with `machine`, `process` and `filament` laid over it key by key, as `over_x2d` lays them over the
    /// X2D's 0.4 mm presets.
    pub fn over(
        base: &Profile,
        machine: BTreeMap<String, Json>,
        process: BTreeMap<String, Json>,
        filament: BTreeMap<String, Json>,
    ) -> Profile {
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

    #[test]
    fn each_nozzle_has_bambus_own_presets() {
        for (nozzle, machine, process, filament, layer) in [
            (
                0.2,
                "Bambu Lab X2D 0.2 nozzle",
                "0.10mm Standard @BBL X2D 0.2 nozzle",
                "Bambu PLA Basic @BBL X2D 0.2 nozzle",
                0.1,
            ),
            (0.4, "Bambu Lab X2D 0.4 nozzle", "0.20mm Standard @BBL X2D", "Bambu PLA Basic @BBL X2D 0.4 nozzle", 0.2),
            (0.6, "Bambu Lab X2D 0.6 nozzle", "0.30mm Standard @BBL X2D 0.6 nozzle", "Bambu PLA Basic @BBL X2D", 0.3),
            (0.8, "Bambu Lab X2D 0.8 nozzle", "0.40mm Standard @BBL X2D 0.8 nozzle", "Bambu PLA Basic @BBL X2D", 0.4),
        ] {
            let p = x2d_nozzle(nozzle).unwrap();
            assert_eq!(p.machine["name"].as_str(), Some(machine));
            assert_eq!(p.process["name"].as_str(), Some(process));
            assert_eq!(p.filament["name"].as_str(), Some(filament));
            let width = format!("{nozzle}");
            assert_eq!(p.list("nozzle_diameter"), vec![width.as_str(), width.as_str()]);
            assert_eq!(p.float("layer_height"), layer);
            assert!(p.text("machine_start_gcode").contains(";======== X2D start gcode=========="));
            // Read once.
            assert!(Arc::ptr_eq(&p, &x2d_nozzle(nozzle).unwrap()));
        }
        assert!(Arc::ptr_eq(&x2d_nozzle(0.4).unwrap(), &x2d()));
        assert!(x2d_nozzle(0.3).is_none());
        assert!(x2d_nozzle(1.0).is_none());
    }
}
