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
    settings.set_palette(palette);
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
                            "ironing_pattern": "concentric", "seam_position": "random",
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
        assert_eq!(s.iron.surfaces, crate::config::IronWhere::Tops);
        assert!(s.fallbacks().iter().any(|f| f == "random seams placed as aligned ones"), "{:?}", s.fallbacks());
        assert!(!s.fallbacks().iter().any(|f| f.contains("ironing")), "concentric ironing is Orca's now");
        // Everything else is still the X2D's.
        assert_eq!(s.outer_wall_speed, 200.0);
    }

    #[test]
    fn elephants_foot_on_more_than_one_layer_is_noted() {
        // Pulled in on the first layer only, as the X2D's presets ask; Orca would pull in more layers by less each.
        let note = "elephant's foot compensated on the first layer only";
        let s = read(r#"{"process": {"elefant_foot_compensation_layers": "3"}}"#).unwrap().settings;
        assert!(s.fallbacks().iter().any(|f| f == note), "{:?}", s.fallbacks());
        let s = read("{}").unwrap().settings;
        assert!(!s.fallbacks().iter().any(|f| f == note), "{:?}", s.fallbacks());
    }

    #[test]
    fn what_this_cannot_slice_yet_is_refused_by_name() {
        let refused = |text: &str| read(text).err();
        // The X2D's supports are organic trees, which slice, as the classic slim, strong and hybrid ones do, and
        // normal ones in their grid and snug styles, on the plate only too.
        assert!(read(r#"{"process": {"enable_support": "1"}}"#).is_ok());
        let tree = |more: &str| format!(r#"{{"process": {{"enable_support": "1"{more}}}}}"#);
        for style in ["tree_slim", "tree_strong", "tree_hybrid"] {
            assert!(read(&tree(&format!(r#", "support_style": "{style}""#))).is_ok(), "{style}");
        }
        // Bambu Studio's name for organic trees, and a tree's style on normal supports, which Orca prints in the grid.
        let organic = read(&tree(r#", "support_style": "tree_organic""#)).unwrap().settings;
        assert!(organic.support.organic());
        for style in ["organic", "tree_organic", "tree_hybrid"] {
            let more = format!(r#", "support_type": "normal(auto)", "support_style": "{style}""#);
            let normal = read(&tree(&more)).unwrap().settings;
            assert!(
                !normal.support.organic() && !normal.support.snug() && normal.support.classic().is_none(),
                "{style}"
            );
        }
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_unknown""#)),
            Some(Error::Unsupported("this style of tree support"))
        );
        // Bridges left unsupported: normal supports leave them out (`support.rs`), and Orca's trees don't read it.
        for more in [r#", "support_type": "normal(auto)", "bridge_no_support": "1""#, r#", "bridge_no_support": "1""#] {
            assert!(read(&tree(more)).is_ok_and(|r| r.settings.unsupported().is_none()), "{more}");
        }
        // Classic trees draw their branches as walls and their interfaces in the default pattern only.
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_slim", "support_interface_pattern": "rectilinear""#)),
            Some(Error::Unsupported("this support pattern"))
        );
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_hybrid", "support_base_pattern": "lightning""#)),
            Some(Error::Unsupported("this support pattern"))
        );
        // A rectilinear base fills organic trees' branches inside their loops (support.rs); other patterns don't
        // slice yet, nor any on classic trees.
        assert!(read(r#"{"process": {"enable_support": "1", "support_base_pattern": "rectilinear"}}"#).is_ok());
        for base in ["honeycomb", "rectilinear-grid", "lightning"] {
            let json = format!(r#"{{"process": {{"enable_support": "1", "support_base_pattern": "{base}"}}}}"#);
            assert_eq!(refused(&json), Some(Error::Unsupported("this support pattern")), "{base}");
        }
        assert_eq!(
            refused(&tree(r#", "support_style": "tree_slim", "support_base_pattern": "rectilinear""#)),
            Some(Error::Unsupported("this support pattern"))
        );
        // Interfaces in Orca's grid (fill.rs, `support_grid`) under organic trees and normal supports; not yet under
        // classic trees, nor with a raft, whose contact layer would print in it too.
        for more in [
            r#", "support_interface_pattern": "grid""#,
            r#", "support_interface_pattern": "grid", "support_type": "normal(auto)""#,
            r#", "support_interface_pattern": "grid", "support_type": "normal(auto)", "support_style": "snug""#,
            r#", "support_interface_pattern": "grid", "support_interface_top_layers": "0""#,
        ] {
            assert!(read(&tree(more)).is_ok_and(|r| r.settings.unsupported().is_none()), "{more}");
        }
        for more in [
            r#", "support_interface_pattern": "grid", "support_style": "tree_hybrid""#,
            r#", "support_interface_pattern": "grid", "raft_layers": "2""#,
            r#", "support_interface_pattern": "grid", "support_type": "normal(auto)", "raft_layers": "2""#,
        ] {
            assert_eq!(refused(&tree(more)), Some(Error::Unsupported("this support pattern")), "{more}");
        }
        // The support pattern turned (`support_angle`) on organic trees (support.rs, `pattern_angles`); not yet on
        // normal supports, which would turn their grid too, on classic trees, or with a raft.
        assert!(read(&tree(r#", "support_angle": "45""#)).is_ok_and(|r| r.settings.unsupported().is_none()));
        for more in [
            r#", "support_angle": "45", "support_type": "normal(auto)""#,
            r#", "support_angle": "45", "support_style": "tree_hybrid""#,
            r#", "support_angle": "45", "raft_layers": "2""#,
        ] {
            assert_eq!(refused(&tree(more)), Some(Error::Unsupported("these support settings")), "{more}");
        }
        let normal =
            |more: &str| format!(r#"{{"process": {{"enable_support": "1", "support_type": "normal(auto)"{more}}}}}"#);
        assert!(read(&normal("")).is_ok());
        assert!(read(&normal(r#", "support_critical_regions_only": "1""#)).is_ok());
        assert!(read(&normal(r#", "support_style": "snug""#)).is_ok());
        assert!(read(&normal(r#", "support_on_build_plate_only": "1""#)).is_ok());
        // Supports only where painted, normal or trees, slice: the paint enforces and blocks them (support.rs, tree/).
        assert!(read(r#"{"process": {"enable_support": "1", "support_type": "normal(manual)"}}"#).is_ok());
        assert!(read(r#"{"process": {"enable_support": "1", "support_type": "tree(manual)"}}"#).is_ok());
        assert!(
            read(
                r#"{"process": {"enable_support": "1", "support_type": "tree(manual)", "support_style": "tree_slim"}}"#
            )
            .is_ok()
        );
        assert_eq!(
            refused(r#"{"process": {"brim_type": "painted"}}"#),
            Some(Error::Unsupported("brim ears painted on"))
        );
        // Spiral vase mode slices (spiral.rs), with one wall, no top shells and no sparse infill as Orca prints it.
        let spiral = read(r#"{"process": {"spiral_mode": "1", "wall_loops": "3", "sparse_infill_density": "20%"}}"#);
        assert!(spiral.is_ok_and(|s| s.settings.spiral_mode
            && s.settings.wall_loops == 1
            && s.settings.top_shell_layers == 0
            && s.settings.sparse_density == 0.0));
        // A raft slices (raft.rs) with supports off, as the generator Orca takes for the supports set makes it, under
        // normal supports and under organic trees; not yet where Orca's classic trees make it, with supports on or off.
        assert!(read(r#"{"process": {"raft_layers": "3"}}"#).is_ok());
        assert!(read(r#"{"process": {"raft_layers": "2", "support_type": "normal(auto)"}}"#).is_ok());
        assert!(read(&normal(r#", "raft_layers": "2""#)).is_ok());
        assert!(read(&tree(r#", "raft_layers": "2""#)).is_ok());
        for json in [
            r#"{"process": {"raft_layers": "2", "support_style": "tree_hybrid"}}"#,
            &tree(r#", "raft_layers": "2", "support_style": "tree_slim""#),
        ] {
            assert_eq!(refused(json), Some(Error::Unsupported("a raft in this style of tree support")), "{json}");
        }
        // Several filaments print a prime tower once the plate prints more than one of them (`Settings::for_filaments`),
        // and with it Orca's supports follow the object's layers: trees and normal supports slice, rafts don't yet.
        let several =
            |more: &str| format!(r#"{{"process": {{"enable_support": "1"{more}}}, "filaments": [{{}}, {{}}]}}"#);
        let on_two = |json: &str| read(json).unwrap().settings.for_filaments(2);
        assert!(!on_two(&several("")).support.independent_layer_height);
        assert_eq!(on_two(&several("")).unsupported(), None);
        assert_eq!(on_two(&several(r#", "support_style": "tree_hybrid""#)).unsupported(), None);
        assert_eq!(on_two(&several(r#", "support_type": "normal(auto)""#)).unsupported(), None);
        assert_eq!(
            on_two(&several(r#", "support_type": "normal(auto)", "support_style": "snug""#)).unsupported(),
            None
        );
        assert_eq!(
            on_two(r#"{"process": {"raft_layers": "2"}, "filaments": [{}, {}]}"#).unsupported(),
            Some("a raft with several filaments")
        );
        // A plate that prints in one of them prints no tower: its supports keep their own layers, as Orca's do.
        let one = read(&several(r#", "support_type": "normal(auto)""#)).unwrap().settings.for_filaments(1);
        assert!(one.support.independent_layer_height && one.unsupported().is_none());
        assert!(read(&normal("")).is_ok_and(|s| s.settings.support.independent_layer_height));
        // The command line's stand-in filaments too.
        let mut s = read(&normal("")).unwrap().settings;
        s.set_palette(Some(Arc::new(crate::filaments::palette_of(&s, 2))));
        assert_eq!(s.for_filaments(2).unsupported(), None);
        // In one filament, normal supports in step with the object's layers slice too, as a project may ask.
        assert!(read(&normal(r#", "independent_support_layer_height": "0""#)).is_ok());
        // Without a prime tower Orca changes filament where the nozzle is (`toolchange.rs`), and the supports keep
        // their own layers; with a smooth timelapse it prints a tower for one filament too, and with wrapping
        // detection where the printer has an area for it.
        let untowered = read(r#"{"process": {"enable_prime_tower": "0"}, "filaments": [{}, {}]}"#).unwrap().settings;
        assert_eq!(untowered.for_filaments(2).unsupported(), None);
        assert!(!untowered.for_filaments(2).prime_tower && untowered.for_filaments(2).support.independent_layer_height);
        assert_eq!(untowered.for_filaments(1).unsupported(), None);
        assert_eq!(refused(r#"{"process": {"timelapse_type": "1"}}"#), Some(Error::Unsupported("a smooth timelapse")));
        // Wrapping detection lifts the nozzle before each layer, where the printer has no G-code or area for it, as
        // the X2D (gcode.rs), and in several filaments before the layer's first visit to the prime tower, which it
        // reshapes (toolchange.rs, wipe_tower.rs), or without a tower before the layer's first filament; the
        // printer's own G-code and spiral vase mode don't slice yet.
        let wrapping = read(r#"{"process": {"enable_wrapping_detection": "1"}, "filaments": [{}, {}]}"#).unwrap();
        assert!(wrapping.settings.wrapping_detection && wrapping.settings.wrapping_layers == 20);
        assert_eq!(wrapping.settings.for_filaments(1).unsupported(), None);
        assert_eq!(wrapping.settings.for_filaments(2).unsupported(), None);
        let untowered =
            r#"{"process": {"enable_wrapping_detection": "1", "enable_prime_tower": "0"}, "filaments": [{}, {}]}"#;
        assert_eq!(read(untowered).unwrap().settings.for_filaments(2).unsupported(), None);
        for json in [
            r#"{"process": {"enable_wrapping_detection": "1", "spiral_mode": "1"}}"#,
            r#"{"machine": {"wrapping_detection_gcode": "M1002"}, "process": {"enable_wrapping_detection": "1"}}"#,
            r#"{"machine": {"wrapping_exclude_area": ["145x310", "256x310", "256x326", "145x326"]},
                "process": {"enable_wrapping_detection": "1"}}"#,
        ] {
            assert_eq!(refused(json), Some(Error::Unsupported("wrapping detection")), "{json}");
        }
        // Several filaments slice (filaments.rs, toolchange.rs).
        assert!(
            read(r#"{"filaments": [{}, {}]}"#).is_ok_and(|s| s.settings.palette.is_some_and(|p| p.profiles.len() == 2))
        );
        assert_eq!(refused("not json"), Some(Error::Setup));
        assert_eq!(refused(r#"{"process": []}"#), Some(Error::Setup));
        assert_eq!(refused(r#"{"slicing": {"scale": 0}}"#), Some(Error::Setup));
        // An auto brim, a brim people turn on round the outside, inside holes or both, brim ears and no brim slice.
        for brim in ["auto_brim", "outer_only", "inner_only", "outer_and_inner", "brim_ears", "no_brim"] {
            assert!(read(&format!(r#"{{"process": {{"brim_type": "{brim}"}}}}"#)).is_ok(), "{brim}");
        }
    }
}
