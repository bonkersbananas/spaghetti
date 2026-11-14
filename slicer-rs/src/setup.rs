//! A slice setup: what the app's `sliceSetup` (src/shared/slicing/configs.ts) makes from people's slicing settings
//! (src/shared/slicing/settings.ts, decision 0047) through `orca.ts`, the one place that knows OrcaSlicer's
//! presets and keys. It is the same object the app hands Orca's engine, as JSON:
//!
//! ```json
//! { "machine": {…}, "process": {…}, "filaments": [{…}], "colours": ["#F2754E"], "slicing": { "scale": 100, … } }
//! ```
//!
//! `machine`, `process` and each filament are Orca's flattened presets with the settings written onto them; this
//! reads them by Orca's keys (`config.rs`), laid over the X2D's own presets so a key a setup leaves out keeps the
//! X2D's value. `colours` gives each filament's colour; `slicing` is the settings themselves, of which only the
//! scale isn't in the presets. The app's other fields (`chosen`, `tower`, `settings`) are not needed here.

use crate::Error;
use crate::config::Settings;
use crate::json::{self, Json};
use crate::profile::Profile;
use std::collections::BTreeMap;
use std::sync::Arc;

/// What a setup says: the settings, and the scale in percent of the models' own size.
#[derive(Clone, Debug)]
pub struct Setup {
    pub settings: Settings,
    pub scale: f64,
}

impl Default for Setup {
    fn default() -> Self {
        Setup { settings: Settings::default(), scale: 100.0 }
    }
}

/// Reads a setup. A setup this can't read is `Error::Setup`; one it can't slice yet (tree supports, a raft…) is
/// `Error::Unsupported`, which says what.
pub fn read(text: &str) -> Result<Setup, Error> {
    read_over(text, &crate::profile::x2d())
}

/// Reads a setup laid over `base` instead of the X2D's 0.4 mm presets (another nozzle's, `profile::x2d_nozzle`).
pub fn read_over(text: &str, base: &Profile) -> Result<Setup, Error> {
    let Some(Json::Object(mut root)) = json::parse(text) else { return Err(Error::Setup) };
    let mut object = |key: &str| match root.remove(key) {
        Some(Json::Object(map)) => Ok(map),
        None => Ok(BTreeMap::new()),
        Some(_) => Err(Error::Setup),
    };
    let machine = object("machine")?;
    let process = object("process")?;
    let slicing = object("slicing")?;
    let filaments: Vec<BTreeMap<String, Json>> = match root.remove("filaments") {
        Some(Json::Array(list)) => list
            .into_iter()
            .map(|f| match f {
                Json::Object(map) => Ok(map),
                _ => Err(Error::Setup),
            })
            .collect::<Result<_, _>>()?,
        None => Vec::new(),
        Some(_) => return Err(Error::Setup),
    };
    let colours: Vec<String> = match root.get("colours") {
        Some(Json::Array(list)) => list.iter().filter_map(Json::as_str).map(str::to_string).collect(),
        _ => Vec::new(),
    };
    let colour = colours.first().cloned();
    // Several filaments (as many as sliceSetup counts for the plate's objects): each with the machine and process.
    let palette = (filaments.len() > 1).then(|| {
        let manual = |map: &BTreeMap<String, Json>| -> Option<Vec<usize>> {
            let mode = map.get("filament_map_mode").and_then(|v| match v {
                Json::Array(a) => a.first().and_then(Json::as_str),
                other => other.as_str(),
            });
            if mode != Some("Manual") {
                return None;
            }
            let list = match map.get("filament_map")? {
                Json::Array(a) => a.iter().filter_map(Json::as_str).filter_map(|v| v.parse::<usize>().ok()).collect(),
                other => other.as_str()?.split(',').filter_map(|v| v.trim().parse::<usize>().ok()).collect::<Vec<_>>(),
            };
            Some(list.into_iter().map(|e| e.max(1) - 1).collect())
        };
        let manual_map = manual(&process).or_else(|| manual(&machine));
        let profiles = filaments
            .iter()
            .map(|f| Arc::new(Profile::over(base, machine.clone(), process.clone(), f.clone())))
            .collect();
        let colours = (0..filaments.len())
            .map(|i| colours.get(i).cloned().unwrap_or_else(|| crate::filaments::stand_in(i).to_string()))
            .collect();
        // The tower goes where the setup puts it (the app places it), else where the app would.
        let place_tower = !(process.contains_key("wipe_tower_x") && process.contains_key("wipe_tower_y"));
        Arc::new(crate::filaments::Palette { profiles, colours, manual_map, place_tower })
    });
    let scale = match slicing.get("scale") {
        Some(Json::Number(n)) if *n > 0.0 => *n,
        Some(Json::Number(_)) | Some(_) => return Err(Error::Setup),
        None => 100.0,
    };
    let filament = filaments.into_iter().next().unwrap_or_default();
    let profile = Arc::new(Profile::over(base, machine, process, filament));
    let mut settings = Settings::from_profile(profile, colour.as_deref());
    settings.palette = palette;
    if let Some(what) = settings.unsupported() {
        return Err(Error::Unsupported(what));
    }
    Ok(Setup { settings, scale })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_setup_is_the_x2d_default() {
        let setup = read("{}").unwrap();
        let d = Settings::default();
        assert_eq!(setup.scale, 100.0);
        assert_eq!(setup.settings.layer_height, d.layer_height);
        assert_eq!(setup.settings.process, "0.20mm Standard @BBL X2D");
        assert_eq!(setup.settings.filament_colour, "#F2754E");
    }

    #[test]
    fn what_a_setup_says_wins_key_by_key() {
        let setup = read(
            r##"{"machine": {"curr_bed_type": "Cool Plate"},
                "process": {"layer_height": "0.12", "wall_loops": "4", "sparse_infill_density": "25%",
                            "sparse_infill_pattern": "gyroid", "ironing_type": "top",
                            "print_settings_id": "0.12mm High Quality @BBL X2D"},
                "filaments": [{"filament_type": ["PETG"], "nozzle_temperature": ["255", "255", "255", "255"],
                               "nozzle_temperature_initial_layer": ["250", "250", "250", "250"],
                               "cool_plate_temp": ["70"], "cool_plate_temp_initial_layer": ["70"],
                               "filament_settings_id": ["Generic PETG @BBL X2D 0.4 nozzle"]}],
                "colours": ["#336699"], "slicing": {"scale": 80}}"##,
        )
        .unwrap();
        let s = &setup.settings;
        assert_eq!(setup.scale, 80.0);
        assert_eq!((s.layer_height, s.wall_loops, s.sparse_density), (0.12, 4, 0.25));
        assert_eq!(s.process, "0.12mm High Quality @BBL X2D");
        assert_eq!((s.filament_type.as_str(), s.filament.as_str()), ("PETG", "Generic PETG @BBL X2D 0.4 nozzle"));
        assert_eq!((s.first_layer_nozzle_temperature, s.nozzle_temperature), (250.0, 255.0));
        assert_eq!((s.bed_type.as_str(), s.bed_temperature), ("Cool Plate", 70.0));
        assert_eq!(s.filament_colour, "#336699");
        // Bambu's tray id is known only for its PLA Basic.
        assert_eq!(s.filament_tray, "");
        // What it doesn't print as asked, it says.
        assert_eq!(s.sparse_infill_pattern, "gyroid");
        assert!(s.fallbacks().iter().any(|f| f == "no ironing"), "{:?}", s.fallbacks());
        // Everything else is still the X2D's.
        assert_eq!(s.outer_wall_speed, 200.0);
    }

    #[test]
    fn what_this_cannot_slice_yet_is_refused_by_name() {
        let refused = |text: &str| read(text).err();
        // The X2D's supports are organic trees, which slice, as the classic slim, strong and hybrid ones do, and
        // normal ones in their grid and snug styles; not supports on the plate only.
        assert!(read(r#"{"process": {"enable_support": "1"}}"#).is_ok());
        let tree = |more: &str| format!(r#"{{"process": {{"enable_support": "1"{more}}}}}"#);
        for style in ["tree_slim", "tree_strong", "tree_hybrid"] {
            assert!(read(&tree(&format!(r#", "support_style": "{style}""#))).is_ok(), "{style}");
        }
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_unknown""#)),
            Some(Error::Unsupported("this style of tree support"))
        );
        // Classic trees draw their branches as walls and their interfaces in the default pattern only.
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_slim", "support_interface_pattern": "rectilinear""#)),
            Some(Error::Unsupported("this support pattern"))
        );
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_hybrid", "support_base_pattern": "lightning""#)),
            Some(Error::Unsupported("this support pattern"))
        );
        assert_eq!(
            refused(r#"{"process": {"enable_support": "1", "support_base_pattern": "rectilinear"}}"#),
            Some(Error::Unsupported("this support pattern"))
        );
        let normal =
            |more: &str| format!(r#"{{"process": {{"enable_support": "1", "support_type": "normal(auto)"{more}}}}}"#);
        assert!(read(&normal("")).is_ok());
        assert!(read(&normal(r#", "support_critical_regions_only": "1""#)).is_ok());
        assert!(read(&normal(r#", "support_style": "snug""#)).is_ok());
        assert_eq!(
            read(&normal(r#", "support_on_build_plate_only": "1""#)).err(),
            Some(Error::Unsupported("supports on the plate only"))
        );
        assert_eq!(
            read(r#"{"process": {"enable_support": "1", "support_type": "normal(manual)"}}"#).err(),
            Some(Error::Unsupported("supports painted on"))
        );
        assert_eq!(refused(r#"{"process": {"brim_type": "brim_ears"}}"#), Some(Error::Unsupported("brim ears")));
        assert_eq!(
            refused(r#"{"process": {"brim_type": "outer_and_inner"}}"#),
            Some(Error::Unsupported("a brim inside holes"))
        );
        assert_eq!(refused(r#"{"process": {"spiral_mode": "1"}}"#), Some(Error::Unsupported("spiral vase mode")));
        // A raft prints with supports off too.
        assert_eq!(refused(r#"{"process": {"raft_layers": "3"}}"#), Some(Error::Unsupported("a raft")));
        // Several filaments slice (filaments.rs, toolchange.rs).
        assert!(
            read(r#"{"filaments": [{}, {}]}"#).is_ok_and(|s| s.settings.palette.is_some_and(|p| p.profiles.len() == 2))
        );
        assert_eq!(refused("not json"), Some(Error::Setup));
        assert_eq!(refused(r#"{"process": []}"#), Some(Error::Setup));
        assert_eq!(refused(r#"{"slicing": {"scale": 0}}"#), Some(Error::Setup));
        // An auto brim, a brim people turn on and no brim slice.
        for brim in ["auto_brim", "outer_only", "no_brim"] {
            assert!(read(&format!(r#"{{"process": {{"brim_type": "{brim}"}}}}"#)).is_ok(), "{brim}");
        }
    }
}
