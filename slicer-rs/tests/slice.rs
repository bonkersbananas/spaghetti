//! The whole job, from model files to a `.gcode.3mf`, on small models.

use md5::{Digest, Md5};
use spaghetti_slicer::region::Role;
use spaghetti_slicer::{Error, Input, Options, Settings, profile, setup, slice, zip};

/// A cube as a text STL, corners from 0 to `size`.
fn cube_stl(size: f32) -> Vec<u8> {
    let v = |x: f32, y: f32, z: f32| [x * size, y * size, z * size];
    let corners = [
        v(0., 0., 0.),
        v(1., 0., 0.),
        v(1., 1., 0.),
        v(0., 1., 0.),
        v(0., 0., 1.),
        v(1., 0., 1.),
        v(1., 1., 1.),
        v(0., 1., 1.),
    ];
    let faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    let mut text = String::from("solid cube\n");
    for f in faces {
        text.push_str(" facet normal 0 0 0\n  outer loop\n");
        for i in f {
            let p = corners[i];
            text.push_str(&format!("   vertex {} {} {}\n", p[0], p[1], p[2]));
        }
        text.push_str("  endloop\n endfacet\n");
    }
    text.push_str("endsolid cube\n");
    text.into_bytes()
}

fn entry(file: &[u8], name: &str) -> Vec<u8> {
    let entries = zip::entries(file).expect("a zip");
    entries.iter().find(|e| e.name == name).unwrap_or_else(|| panic!("no {name}")).read().expect("readable")
}

#[test]
fn a_cube_becomes_a_file_the_app_reads() {
    let stl = cube_stl(20.0);
    let out = slice(&[Input { name: "cube.stl", bytes: &stl }], &Settings::default(), &Options::default()).unwrap();
    let s = &out.stats;
    assert_eq!(s.layers, 100);
    // Native OrcaSlicer 2.5.0 with the same settings: 2865 mm³ of filament, 537 s printing (Nov 13).
    assert!(s.volume > 2865.0 * 0.95 && s.volume < 2865.0 * 1.05, "{} mm³", s.volume);
    assert!(s.model_time > 537.0 * 0.85 && s.model_time < 537.0 * 1.15, "{} s", s.model_time);

    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    assert_eq!(gcode.matches("; CHANGE_LAYER").count(), 100);
    for feature in
        ["Outer wall", "Inner wall", "Sparse infill", "Internal solid infill", "Top surface", "Bottom surface"]
    {
        assert!(gcode.contains(&format!("; FEATURE: {feature}\n")), "no {feature}");
    }
    assert!(gcode.contains("; total layer number: 100\n"));
    assert!(gcode.contains("M83 ; use relative distances for extrusion"));
    // Arranged in the middle of the plate.
    let xs: Vec<f64> = gcode
        .lines()
        .filter(|l| l.starts_with("G1 X") && l.contains(" E"))
        .filter_map(|l| l[4..].split(' ').next().and_then(|x| x.parse().ok()))
        .collect();
    let (lo, hi) = xs.iter().fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x)));
    assert!(lo > 117.0 && hi < 139.0, "x from {lo} to {hi}");

    // The archive holds what Spaghetti's reader and Bambu Studio look for.
    let names: Vec<String> = zip::entries(&out.file).unwrap().into_iter().map(|e| e.name).collect();
    for name in [
        "[Content_Types].xml",
        "_rels/.rels",
        "3D/3dmodel.model",
        "Metadata/plate_1.gcode",
        "Metadata/plate_1.gcode.md5",
        "Metadata/model_settings.config",
        "Metadata/slice_info.config",
        "Metadata/plate_1.json",
        "Metadata/filament_sequence.json",
        "Metadata/project_settings.config",
        "Metadata/plate_1.png",
    ] {
        assert!(names.iter().any(|n| n == name), "no {name}");
    }
    let inside = entry(&out.file, "Metadata/plate_1.gcode");
    assert_eq!(inside, out.gcode);
    let md5: String = Md5::digest(&inside).iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(String::from_utf8(entry(&out.file, "Metadata/plate_1.gcode.md5")).unwrap(), md5);
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(&format!(r#"<metadata key="prediction" value="{}"/>"#, s.total_time.round())));
    assert!(info.contains(r#"<object identify_id="1" name="cube.stl" skipped="false"/>"#));
    assert!(info.contains(r##"type="PLA" color="#F2754E""##));
    // What the printer maps the filament by, as Orca writes it for the X2D: Bambu PLA Basic on the left nozzle.
    assert!(info.contains(r#"<filament id="1" tray_info_idx="GFA00" type="PLA""#));
    assert!(info.contains(r#"<metadata key="filament_maps" value="1"/>"#));
    assert!(info.contains(r#"<nozzle id="0" extruder_id="1" nozzle_diameter="0.4" volume_type="Standard"/>"#));
    let png = entry(&out.file, "Metadata/plate_1.png");
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
}

#[test]
fn a_beam_between_two_pillars_is_bridged() {
    let stl = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/models/bridge.stl")).unwrap();
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "bridge.stl", bytes: &stl }], &Settings::default(), &options).unwrap();
    assert_eq!(out.stats.layers, 65);
    let gcode = String::from_utf8(out.gcode).unwrap();
    // The beam's first layer (z 10.2) prints its span over the gap as a bridge.
    let layer = gcode.split("; CHANGE_LAYER\n").find(|l| l.starts_with("; Z_HEIGHT: 10.2\n")).expect("layer at 10.2");
    assert!(layer.contains("; FEATURE: Bridge\n"));
    let bridge = out.stats.features[Role::ALL.iter().position(|&r| r == Role::Bridge).unwrap()];
    assert!(bridge.volume > 20.0, "{} mm³ of bridge", bridge.volume);
}

#[test]
fn the_same_models_give_the_same_file() {
    let stl = cube_stl(12.0);
    let a = slice(&[Input { name: "a.stl", bytes: &stl }], &Settings::default(), &Options::default()).unwrap();
    let b = slice(&[Input { name: "a.stl", bytes: &stl }], &Settings::default(), &Options::default()).unwrap();
    assert_eq!(a.file, b.file);
}

#[test]
fn models_that_cannot_print_are_refused() {
    let settings = Settings::default();
    let options = Options::default();
    let big = cube_stl(300.0);
    let tall = {
        let text = String::from_utf8(cube_stl(10.0)).unwrap().replace("vertex 0 0 10", "vertex 0 0 300");
        text.into_bytes()
    };
    let run = |bytes: &[u8]| slice(&[Input { name: "m.stl", bytes }], &settings, &options).err();
    assert_eq!(run(&big), Some(Error::TooBig));
    assert_eq!(run(&tall), Some(Error::TooTall));
    assert_eq!(run(b"not a model"), Some(Error::Unreadable));
    let many: Vec<Vec<u8>> = (0..40).map(|_| cube_stl(40.0)).collect();
    let inputs: Vec<Input> = many.iter().map(|b| Input { name: "c.stl", bytes: b }).collect();
    assert_eq!(slice(&inputs, &settings, &options).err(), Some(Error::TooMany));
}

#[test]
fn objects_kept_where_they_are_must_be_on_the_plate() {
    // Kept where the files put them, as a project's objects are: one partly off the plate stops the slice, as Orca
    // stops it; one wholly off it (on another of a project's plates) is left out, and with nothing on the plate there
    // is nothing to slice.
    let settings = Settings::default();
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let on = boxes_stl(&[([100., 100., 0.], [110., 110., 10.])]);
    let partly = boxes_stl(&[([250., 100., 0.], [260., 110., 10.])]);
    let off = boxes_stl(&[([300., 100., 0.], [310., 110., 10.])]);
    let run = |models: &[&[u8]]| {
        let inputs: Vec<Input> = models.iter().map(|bytes| Input { name: "box.stl", bytes }).collect();
        slice(&inputs, &settings, &options)
    };
    assert_eq!(run(&[&on, &partly]).err(), Some(Error::OffPlate));
    assert_eq!(run(&[&off]).err(), Some(Error::OffPlate));
    let out = run(&[&off, &on]).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    assert!(gcode.contains("; model label id: 1\n"), "one object");
    let layers = check_moves(&gcode, &settings);
    assert!(layers.iter().all(|l| l == &[1]));
    // Arranged, as the app's files are, the same objects all fit.
    let arranged = Options { arrange: true, ..options.clone() };
    let inputs = [Input { name: "a.stl", bytes: &on }, Input { name: "b.stl", bytes: &off }];
    assert!(slice(&inputs, &settings, &arranged).is_ok());
}

#[test]
fn an_inside_out_model_slices_as_if_right_way_out() {
    let stl = String::from_utf8(cube_stl(15.0)).unwrap();
    // Every facet's last two corners swapped: the same cube, wound the other way.
    let mut flipped = Vec::new();
    let mut corners: Vec<&str> = Vec::new();
    for line in stl.lines() {
        if line.trim_start().starts_with("vertex") {
            corners.push(line);
            if corners.len() == 3 {
                flipped.extend([corners[0], corners[2], corners[1]]);
                corners.clear();
            }
        } else {
            flipped.push(line);
        }
    }
    let flipped = flipped.join("\n").into_bytes();
    let run =
        |bytes: &[u8]| slice(&[Input { name: "c.stl", bytes }], &Settings::default(), &Options::default()).unwrap();
    let (a, b) = (run(stl.as_bytes()), run(&flipped));
    assert!(a.stats.volume > 500.0);
    assert_eq!(a.stats.layers, b.stats.layers);
    assert!(
        (a.stats.volume - b.stats.volume).abs() < a.stats.volume * 0.001,
        "{} against {}",
        a.stats.volume,
        b.stats.volume
    );
}

/// The value after `letter` in a G-code line's words, if it has one.
fn word(line: &str, letter: char) -> Option<f64> {
    line.split(';').next()?.split_whitespace().skip(1).find(|w| w.starts_with(letter)).and_then(|w| w[1..].parse().ok())
}

/// Walks every move between the printer's start and end G-code and checks what keeps a print safe: the nozzle
/// prints only at its layer's height and never travels below it, stays on the plate, retracts and pushes back the
/// filament in pairs, lifts by the z-hop in a spiral that stays on the plate, and every object's moves sit inside its
/// skip labels (a brim's outside them all, as Orca prints it). Returns the labels each layer printed.
fn check_moves(gcode: &str, s: &Settings) -> Vec<Vec<u32>> {
    let body = gcode.split("M981 S1 P20000 ;open spaghetti detector\n").nth(1).expect("the start G-code's end");
    let body = body.split("M981 S0 P20000 ; close spaghetti detector\n").next().expect("the end G-code's start");
    let (mut x, mut y, mut z) = (f64::NAN, f64::NAN, 1.0);
    let mut layer_z = f64::NAN;
    // Heights as the G-code writes them, to the micrometre (a layer of support may lie at 0.474286 mm).
    let written = |z: f64| (z * 1000.0).round() / 1000.0;
    let mut pulled: f64 = 0.0;
    let mut label: Option<u32> = None;
    let mut layers: Vec<Vec<u32>> = Vec::new();
    let mut in_photo = false;
    let mut feature = "";
    let r = s.z_hop / (2.0 * std::f64::consts::PI * s.travel_slope.to_radians().atan());
    for (n, line) in body.lines().enumerate() {
        let at = || format!("line {} of the body: {line}", n + 1);
        if line.starts_with("; SKIPPABLE_START") {
            in_photo = true;
        }
        if line.starts_with("; SKIPPABLE_END") {
            in_photo = false;
        }
        if in_photo {
            continue;
        }
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        }
        if let Some(h) = line.strip_prefix("; Z_HEIGHT: ") {
            let h: f64 = h.parse().unwrap();
            assert!(layer_z.is_nan() || h > layer_z, "layers go up: {}", at());
            layer_z = h;
            layers.push(Vec::new());
            assert_eq!(label, None, "a layer starts outside every label: {}", at());
        }
        if let Some(id) = line.strip_prefix("M624 ") {
            assert_eq!(label, None, "labels don't nest: {}", at());
            let mask = id.trim();
            // The one object of the mask is its bit; layer-wide masks (around a photo) don't come here.
            label = Some(mask.len() as u32);
            continue;
        }
        if line.starts_with("; start printing object, unique label id: ") {
            let id: u32 = line.rsplit(' ').next().unwrap().parse().unwrap();
            layers.last_mut().expect("a layer").push(id);
        }
        if line == "M625" {
            assert!(label.is_some(), "M625 closes a label: {}", at());
            label = None;
            continue;
        }
        let code = line.split(';').next().unwrap().trim();
        if code.starts_with("G1 ") || code.starts_with("G0 ") {
            let (nx, ny, nz) =
                (word(code, 'X').unwrap_or(x), word(code, 'Y').unwrap_or(y), word(code, 'Z').unwrap_or(z));
            let e = word(code, 'E').unwrap_or(0.0);
            let moves_xy = (word(code, 'X').is_some() || word(code, 'Y').is_some()) && (nx != x || ny != y);
            if moves_xy {
                assert!((0.0..=s.bed[0]).contains(&nx) && (0.0..=s.bed[1]).contains(&ny), "on the plate: {}", at());
                assert!(nz >= written(layer_z) - 1e-6, "never below the layer while moving: {}", at());
            }
            if e > 0.0 && moves_xy {
                assert!((nz - written(layer_z)).abs() < 1e-6, "prints at the layer's height: {}", at());
                assert!(pulled.abs() < 1e-4, "prints only with the filament pushed back: {}", at());
                if feature == "Brim" {
                    assert!(layers.len() == 1 && label.is_none(), "a brim prints first, outside the labels: {}", at());
                } else {
                    assert!(label.is_some(), "prints only inside an object's label: {}", at());
                }
            } else if e != 0.0 {
                pulled -= e;
                assert!(pulled > -1e-4 && pulled < s.retract_length + 1e-4, "{pulled} mm pulled back: {}", at());
            }
            (x, y, z) = (nx, ny, nz);
        } else if code.starts_with("G3 ") {
            let (i, j) = (word(code, 'I').unwrap(), word(code, 'J').unwrap());
            let nz = word(code, 'Z').unwrap();
            assert!((i.hypot(j) - r).abs() < 0.002, "a spiral of the z-hop's radius: {}", at());
            assert!((nz - written(layer_z + s.z_hop)).abs() < 1e-6, "lifts by the z-hop: {}", at());
            let (cx, cy) = (x + i, y + j);
            assert!(
                cx - r >= 0.0 && cy - r >= 0.0 && cx + r <= s.bed[0] && cy + r <= s.bed[1],
                "on the plate: {}",
                at()
            );
            assert!(code.ends_with(" P1  F60000"), "one turn at the travel speed: {}", at());
            z = nz;
        } else if code.starts_with("G2 ") || code.starts_with("G91") || code.starts_with("G92") {
            panic!("no {code} between the start and the end: {}", at());
        }
    }
    assert_eq!(label, None, "every label closed");
    layers
}

#[test]
fn the_x2d_gets_orcas_start_and_end_and_moves_it_can_print_safely() {
    let settings = Settings::default();
    let stl = cube_stl(20.0);
    let out = slice(&[Input { name: "cube.stl", bytes: &stl }], &settings, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    // The X2D's own start and end, in Orca's order, before and after the layers.
    let order = [
        "; HEADER_BLOCK_START\n",
        "; model label id: 1\n",
        "; EXECUTABLE_BLOCK_START\n",
        "M204 P20000 R30000 T20000\n",
        "; FEATURE: Custom\n",
        ";======== X2D start gcode==========\n",
        "; MACHINE_START_GCODE_END\n",
        "M981 S1 P20000 ;open spaghetti detector\n",
        "; CHANGE_LAYER\n",
        ";======== X2D layer_change gcode ==========\n",
        "M624 AQAAAAAAAAA=\n",
        ";======== X2D timelapse gcode ========\n",
        "M981 S0 P20000 ; close spaghetti detector\n",
        "; MACHINE_END_GCODE_START\n",
        "M73 P100 R0\n; EXECUTABLE_BLOCK_END\n",
    ];
    let mut from = 0;
    for part in order {
        let at = gcode[from..].find(part).unwrap_or_else(|| panic!("{part:?} after byte {from}"));
        from += at + part.len();
    }
    // The bed is levelled around the first layer, as Orca works the area out: its outline (the cube's 20 mm, less
    // nothing as the outline isn't pulled in) and the skirt distance on each side.
    let levelling = gcode.lines().find(|l| l.trim_start().starts_with("G29 A1 ")).unwrap();
    assert!(levelling.contains(" I24 J24 R"), "{levelling}");
    let layers = check_moves(&gcode, &settings);
    assert_eq!(layers.len(), 100);
    assert!(layers.iter().all(|l| l == &[1]));
    assert_eq!(gcode.matches(";======== X2D timelapse gcode ========").count(), 100);
}

/// Each of the X2D's nozzles with Bambu's presets for it (`profile::x2d_nozzle`: its Standard process and Bambu PLA
/// Basic), as the command line's `--nozzle` slices: a 20 mm cube in that process's layers, its moves as safe as the
/// 0.4 mm's, its lines as wide as the presets say, no faster than the filament flows through that nozzle, and within
/// 2 % of the plastic and printing time of native OrcaSlicer 2.5.0 with the same presets (Nov 14: all within 1.2 %).
#[test]
fn each_nozzle_slices_a_cube_with_bambus_presets_for_it() {
    let stl = cube_stl(20.0);
    for (nozzle, layers, width, orca_volume, orca_time) in [
        (0.2, 200, "0.22", 2647.6, 2069.1),
        (0.4, 100, "0.42", 2864.8, 537.5),
        (0.6, 67, "0.62", 3308.3, 359.0),
        (0.8, 50, "0.82", 3991.6, 288.0),
    ] {
        let settings = Settings::from_profile(profile::x2d_nozzle(nozzle).unwrap(), None);
        let out = slice(&[Input { name: "cube.stl", bytes: &stl }], &settings, &Options::default()).unwrap();
        let s = &out.stats;
        assert_eq!(s.layers, layers, "{nozzle} mm");
        let near = |ours: f64, orca: f64| (ours / orca - 1.0).abs() < 0.02;
        assert!(near(s.volume, orca_volume), "{nozzle} mm: {} mm³ against Orca's {orca_volume}", s.volume);
        assert!(near(s.model_time, orca_time), "{nozzle} mm: {} s against Orca's {orca_time}", s.model_time);
        let gcode = String::from_utf8(out.gcode.clone()).unwrap();
        assert_eq!(check_moves(&gcode, &settings).len(), layers);
        assert!(gcode.contains(&format!("; LINE_WIDTH: {width}\n")), "{nozzle} mm");
        // Every extrusion between the start and the end within the filament's volumetric speed for the nozzle
        // (2 mm³/s through the 0.2 mm).
        let body = gcode.split("M981 S1 P20000 ;open spaghetti detector\n").nth(1).unwrap();
        let body = body.split("M981 S0 P20000 ; close spaghetti detector\n").next().unwrap();
        let area = std::f64::consts::PI * (settings.filament_diameter / 2.0).powi(2);
        let (mut x, mut y, mut f, mut fastest) = (f64::NAN, f64::NAN, 0.0, 0.0f64);
        for line in body.lines().filter(|l| l.starts_with("G1 ")) {
            let (nx, ny) = (word(line, 'X').unwrap_or(x), word(line, 'Y').unwrap_or(y));
            f = word(line, 'F').unwrap_or(f);
            let length = (nx - x).hypot(ny - y);
            if let Some(e) = word(line, 'E').filter(|&e| e > 0.0 && length > 0.05) {
                fastest = fastest.max(e * area / length * f / 60.0);
            }
            (x, y) = (nx, ny);
        }
        assert!(fastest <= settings.max_volumetric_speed * 1.01, "{nozzle} mm: {fastest} mm³/s");
        let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
        assert!(info.contains(&format!(r#"nozzle_diameter="{nozzle}""#)), "{info}");
    }
}

/// Settings as the X2D's generic filaments have them: no lift of the filament's own, so the printer's Auto Lift.
fn auto_lift() -> Settings {
    setup::read(r#"{"filaments": [{"filament_z_hop_types": ["nil", "nil", "nil", "nil"]}]}"#).unwrap().settings
}

/// Each layer's height (`; Z_HEIGHT:`) and its travels' lifts: "spiral" (`G17`, `G3 Z…`, then the travel), "slope"
/// (a `G1 X Y Z F` up the slope, then the rest at that height) or "short" (one `G1 X Y Z F` to the travel's end),
/// each with how far it went across before it reached the lifted height.
fn lifts(gcode: &str) -> Vec<(f64, Vec<(&'static str, f64)>)> {
    let mut layers: Vec<(f64, Vec<(&'static str, f64)>)> = Vec::new();
    let lines: Vec<&str> = gcode.lines().collect();
    let (mut x, mut y) = (f64::NAN, f64::NAN);
    let mut k = 0;
    while k < lines.len() {
        let line = lines[k];
        if let Some(h) = line.strip_prefix("; Z_HEIGHT: ") {
            layers.push((h.parse().unwrap(), Vec::new()));
        }
        let travel = |l: &str| l.starts_with("G1 X") && word(l, 'Z').is_some() && word(l, 'E').is_none();
        if line == "G17" && lines.get(k + 2).is_some_and(|l| travel(l)) {
            layers.last_mut().unwrap().1.push(("spiral", 0.0));
        } else if travel(line) && word(line, 'F').is_some() && !layers.is_empty() {
            let (tx, ty) = (word(line, 'X').unwrap(), word(line, 'Y').unwrap());
            let across = (tx - x).hypot(ty - y);
            let next = lines.get(k + 1).copied().unwrap_or("");
            let kind = if travel(next) && word(next, 'F').is_none() { "slope" } else { "short" };
            layers.last_mut().unwrap().1.push((kind, across));
        }
        if line.starts_with("G1 ") || line.starts_with("G0 ") {
            (x, y) = (word(line, 'X').unwrap_or(x), word(line, 'Y').unwrap_or(y));
        }
        k += 1;
    }
    layers
}

#[test]
fn generic_filaments_lift_along_a_slope_and_in_a_spiral_over_an_overhang_as_orcas_auto_lift_does() {
    let settings = auto_lift();
    assert_eq!(settings.z_hop_type, "Auto Lift");
    // A block, and beside it a T: a 2 mm post holding up a slab 32 mm long from 6 mm, nearly all of it overhang.
    let block = boxes_stl(&[([140.0, 100.0, 0.0], [150.0, 110.0, 8.0])]);
    let tee = boxes_stl(&[([105.0, 100.0, 0.0], [107.0, 106.0, 6.0]), ([90.0, 100.0, 6.0], [122.0, 106.0, 8.0])]);
    let inputs = [Input { name: "block.stl", bytes: &block }, Input { name: "tee.stl", bytes: &tee }];
    let out = slice(&inputs, &settings, &Options { arrange: false, ..Options::default() }).unwrap();
    assert!(out.fallbacks.is_empty(), "{:?}", out.fallbacks);
    let gcode = String::from_utf8(out.gcode).unwrap();
    check_moves(&gcode, &settings);
    // A slope rises by the z-hop over 7.63 mm (Orca's 3° travel slope) and goes on at that height; a travel shorter
    // than that rises all the way to its end.
    let reach = settings.z_hop / settings.travel_slope.to_radians().tan();
    let layers = lifts(&gcode);
    let all: Vec<&(&str, f64)> = layers.iter().flat_map(|(_, l)| l).collect();
    assert!(all.iter().any(|(k, _)| *k == "slope") && all.iter().any(|(k, _)| *k == "short"));
    for (kind, across) in &all {
        match *kind {
            "slope" => assert!((across - reach).abs() < 0.002, "a slope {across} mm across"),
            "short" => assert!(*across <= reach + 0.002, "a short slope {across} mm across"),
            _ => {}
        }
    }
    // Spirals only where the travel sets off over the slab's overhang, on its first layer (6.2 mm) and those
    // within 0.4 mm above it, and there every travel between the two models.
    for (z, l) in &layers {
        let spirals = l.iter().filter(|(k, _)| *k == "spiral").count();
        if *z < 6.2 - 1e-6 || *z > 6.6 + 1e-6 {
            assert_eq!(spirals, 0, "{z} mm: {l:?}");
        }
    }
    let over: Vec<usize> = layers
        .iter()
        .filter(|(z, _)| (6.2 - 1e-6..=6.4 + 1e-6).contains(z))
        .map(|(_, l)| l.iter().filter(|(k, _)| *k == "spiral").count())
        .collect();
    assert!(over.len() == 2 && over.iter().all(|&n| n > 0), "{over:?}");
    // Native OrcaSlicer 2.5.0 with the same filament lifts the same way on every layer of this plate, and prints it
    // in 247.8 s (Nov 14).
    assert!((out.stats.model_time / 247.8 - 1.0).abs() < 0.03, "{} s", out.stats.model_time);
}

#[test]
fn each_object_on_a_plate_has_its_own_label() {
    let settings = Settings::default();
    let small = cube_stl(10.0);
    let tall = String::from_utf8(cube_stl(10.0)).unwrap().replace(" 10\n", " 20\n").into_bytes();
    let inputs = [Input { name: "small.stl", bytes: &small }, Input { name: "tall.stl", bytes: &tall }];
    let out = slice(&inputs, &settings, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    assert!(gcode.contains("; model label id: 1,2\n"));
    let layers = check_moves(&gcode, &settings);
    assert_eq!(layers.len(), 100);
    // Both cubes up to 10 mm, then only the tall one; each object once a layer.
    for (i, labels) in layers.iter().enumerate() {
        let mut sorted = labels.clone();
        sorted.sort();
        assert_eq!(sorted, if i < 50 { vec![1, 2] } else { vec![2] }, "layer {}", i + 1);
    }
    // The photo is skippable with the layer's objects: both bits, then the tall cube's alone.
    assert!(gcode.contains("; object ids of layer 1 start: 1,2\nM624 AwAAAAAAAAA=\n"));
    assert!(gcode.contains("; object ids of layer 100 start: 2\nM624 AgAAAAAAAAA=\n"));
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(r#"<object identify_id="1" name="small.stl" skipped="false"/>"#));
    assert!(info.contains(r#"<object identify_id="2" name="tall.stl" skipped="false"/>"#));
}

/// Boxes (lowest corner, highest corner) as one text STL.
fn boxes_stl(boxes: &[([f32; 3], [f32; 3])]) -> Vec<u8> {
    let mut text = String::from("solid boxes\n");
    for &(lo, hi) in boxes {
        let one = String::from_utf8(cube_stl(1.0)).unwrap();
        for line in one.lines().filter(|l| l.trim_start().starts_with("vertex")) {
            let v: Vec<f32> = line.split_whitespace().skip(1).map(|n| n.parse().unwrap()).collect();
            let p: Vec<f32> = (0..3).map(|k| lo[k] + v[k] * (hi[k] - lo[k])).collect();
            text.push_str(&format!("   vertex {} {} {}\n", p[0], p[1], p[2]));
        }
    }
    // Back into facets of three vertices each.
    let vertices: Vec<&str> = text.lines().skip(1).collect();
    let mut out = String::from("solid boxes\n");
    for facet in vertices.chunks(3) {
        out.push_str(" facet normal 0 0 0\n  outer loop\n");
        for v in facet {
            out.push_str(v);
            out.push('\n');
        }
        out.push_str("  endloop\n endfacet\n");
    }
    out.push_str("endsolid boxes\n");
    out.into_bytes()
}

#[test]
fn a_part_standing_in_a_frames_opening_keeps_its_own_label() {
    // A square frame (40 mm, 8 mm walls, 4 mm tall) and a 12 mm block 6 mm tall in its opening: the block's
    // bounding box lies inside the frame's, so only the slices say which moves are whose.
    let frame = boxes_stl(&[
        ([100., 100., 0.], [108., 140., 4.]),
        ([132., 100., 0.], [140., 140., 4.]),
        ([100., 100., 0.], [140., 108., 4.]),
        ([100., 132., 0.], [140., 140., 4.]),
    ]);
    let block = boxes_stl(&[([114., 114., 0.], [126., 126., 6.])]);
    let inputs = [Input { name: "frame.stl", bytes: &frame }, Input { name: "block.stl", bytes: &block }];
    let settings = Settings::default();
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&inputs, &settings, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers = check_moves(&gcode, &settings);
    assert_eq!(layers.len(), 30);
    for (i, labels) in layers.iter().enumerate() {
        let mut sorted = labels.clone();
        sorted.sort();
        assert_eq!(sorted, if i < 20 { vec![1, 2] } else { vec![2] }, "layer {}", i + 1);
    }
    // Every extrusion under the frame's label is on the frame, and every one under the block's on the block.
    let mut label = None;
    let mut printed = [0usize; 2];
    for line in gcode.lines() {
        if let Some(id) = line.strip_prefix("; start printing object, unique label id: ") {
            label = id.parse::<u32>().ok();
        } else if line.starts_with("; stop printing object, unique label id: ") {
            label = None;
        } else if let (Some(label), Some(rest)) = (label, line.strip_prefix("G1 X")) {
            let words: Vec<&str> = rest.split(' ').collect();
            let e: f64 = words.iter().find_map(|w| w.strip_prefix('E')).and_then(|e| e.parse().ok()).unwrap_or(0.0);
            if e <= 0.0 {
                continue;
            }
            let x: f64 = words[0].parse().unwrap();
            let y: f64 = words.iter().find_map(|w| w.strip_prefix('Y')).unwrap().parse().unwrap();
            let in_block = (113.9..=126.1).contains(&x) && (113.9..=126.1).contains(&y);
            let in_opening = (108.1..=131.9).contains(&x) && (108.1..=131.9).contains(&y);
            match label {
                1 => assert!(!in_opening, "the frame's label prints in its opening, at {x} {y}"),
                2 => assert!(in_block, "the block's label prints outside the block, at {x} {y}"),
                _ => panic!("label {label}"),
            }
            printed[label as usize - 1] += 1;
        }
    }
    assert!(printed[0] > 100 && printed[1] > 100, "{printed:?}");
    // The plate's description gives each object its own first layer.
    let plate = String::from_utf8(entry(&out.file, "Metadata/plate_1.json")).unwrap();
    let bbox_of = |id: u32| -> Vec<f64> {
        let at = plate.find(&format!(r#""id":{id},"#)).unwrap();
        let start = plate[..at].rfind(r#""bbox":["#).unwrap() + 8;
        let end = start + plate[start..].find(']').unwrap();
        plate[start..end].split(',').map(|n| n.parse().unwrap()).collect()
    };
    let near = |a: &[f64], b: [f64; 4]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 0.01);
    assert!(near(&bbox_of(1), [100., 100., 140., 140.]), "{:?}", bbox_of(1));
    assert!(near(&bbox_of(2), [114., 114., 126., 126.]), "{:?}", bbox_of(2));
}

#[test]
fn lightning_infill_holds_up_the_top_and_nothing_else() {
    // The Light strength's infill, 10 % lightning: a 20 mm cube's sparse infill is trees that reach in from the walls
    // under its top, shrinking a fifth of a millimetre a layer at each tip below it, so the lowest layers have none.
    // Native OrcaSlicer 2.5.0's start on the 28th layer (Nov 13).
    let stl = cube_stl(20.0);
    let with = |pattern: &str| {
        let s = Settings { sparse_infill_pattern: pattern.into(), sparse_density: 0.1, ..Settings::default() };
        slice(&[Input { name: "cube.stl", bytes: &stl }], &s, &Options::default()).unwrap()
    };
    let (lightning, crosshatch) = (with("lightning"), with("crosshatch"));
    assert!(!lightning.fallbacks.iter().any(|f| f.contains("lightning")), "{:?}", lightning.fallbacks);
    let gcode = String::from_utf8(lightning.gcode.clone()).unwrap();
    let layers: Vec<&str> = gcode.split("; CHANGE_LAYER\n").skip(1).collect();
    let sparse = |part: &str| part.contains("; FEATURE: Sparse infill\n");
    assert!(layers[85..94].iter().all(|part| sparse(part)), "no trees under the top");
    assert!(!layers[4..20].iter().any(|part| sparse(part)), "trees low down");
    let sparse_volume = |out: &spaghetti_slicer::Output| {
        out.stats.features[Role::ALL.iter().position(|&r| r == Role::SparseInfill).unwrap()].volume
    };
    let share = sparse_volume(&lightning) / sparse_volume(&crosshatch);
    assert!(share > 0.05 && share < 0.4, "lightning takes {share:.2} of crosshatch's plastic");
}

/// The first layer's brim loops, as printed: each a run of extrusions, between travels.
fn brim_loops(gcode: &str) -> Vec<Vec<[f64; 2]>> {
    first_layer_runs(gcode, "Brim")
}

/// The first layer's runs of extrusions of one feature, between travels.
fn first_layer_runs(gcode: &str, want: &str) -> Vec<Vec<[f64; 2]>> {
    let first = gcode.split("; CHANGE_LAYER\n").nth(1).expect("a first layer");
    let (mut x, mut y) = (f64::NAN, f64::NAN);
    let mut feature = "";
    let mut loops: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut extruding = false;
    for line in first.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        }
        let code = line.split(';').next().unwrap().trim();
        if !code.starts_with("G1 ") {
            continue;
        }
        let (nx, ny) = (word(code, 'X').unwrap_or(x), word(code, 'Y').unwrap_or(y));
        let moved = nx != x || ny != y;
        if moved && feature == want && word(code, 'E').is_some_and(|e| e > 0.0) {
            if !extruding {
                loops.push(vec![[x, y]]);
            }
            loops.last_mut().unwrap().push([nx, ny]);
            extruding = true;
        } else if moved {
            extruding = false;
        }
        (x, y) = (nx, ny);
    }
    loops
}

#[test]
fn walls_stop_the_seam_gap_short_of_where_they_start() {
    // A 20 mm cube's two walls on a layer of its middle: each loop ends a tenth of the nozzle short of its start,
    // as Orca's do (its seam gap).
    let cube = cube_stl(20.0);
    let settings = Settings::default();
    let out = slice(&[Input { name: "cube.stl", bytes: &cube }], &settings, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layer = gcode.split("; CHANGE_LAYER\n").nth(50).unwrap();
    let (mut x, mut y) = (f64::NAN, f64::NAN);
    let mut feature = "";
    let mut loops: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut extruding = false;
    for line in layer.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
            extruding = false;
        }
        let code = line.split(';').next().unwrap().trim();
        if !code.starts_with("G1 ") {
            continue;
        }
        let (nx, ny) = (word(code, 'X').unwrap_or(x), word(code, 'Y').unwrap_or(y));
        let moved = nx != x || ny != y;
        if moved && feature.ends_with("wall") && word(code, 'E').is_some_and(|e| e > 0.0) {
            if !extruding {
                loops.push(vec![[x, y]]);
            }
            loops.last_mut().unwrap().push([nx, ny]);
            extruding = true;
        } else if moved {
            extruding = false;
        }
        (x, y) = (nx, ny);
    }
    assert_eq!(loops.len(), 2);
    for l in &loops {
        let (a, b) = (l[0], l[l.len() - 1]);
        let gap = (a[0] - b[0]).hypot(a[1] - b[1]);
        assert!((gap - settings.seam_gap).abs() < 0.003, "{gap} mm between a wall's start and end");
    }
}

#[test]
fn a_tall_thin_model_gets_orcas_auto_brim_before_its_label() {
    // A fin 4 × 20 mm and 40 mm tall bends easily across its short side: Orca's auto brim gives it 9.4 mm at the X2D's
    // fastest speed (300 mm/s), which comes to 20 lines, 0.1 mm off the fin.
    let fin = boxes_stl(&[([100., 100., 0.], [104., 120., 40.])]);
    let settings = Settings::default();
    let spacing = Settings::spacing(settings.first_layer_width, settings.first_layer_height);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "fin.stl", bytes: &fin }], &settings, &options).unwrap();
    assert!(out.fallbacks.is_empty(), "{:?}", out.fallbacks);
    let gcode = String::from_utf8(out.gcode).unwrap();
    check_moves(&gcode, &settings);
    // First on the first layer, before the fin's label, and nowhere else.
    let first = gcode.split("; CHANGE_LAYER\n").nth(1).unwrap();
    let brim = first.find("; FEATURE: Brim\n").expect("a brim");
    assert!(brim < first.find("; start printing object, unique label id: 1\n").unwrap());
    assert_eq!(gcode.matches("; FEATURE: Brim\n").count(), 1);
    let loops = brim_loops(&gcode);
    assert_eq!(loops.len(), 20);
    // From the outside in, a line apart: the outermost reaches the gap, the brim's width and half a line less out.
    let left: Vec<f64> = loops.iter().map(|l| l.iter().map(|p| p[0]).fold(f64::MAX, f64::min)).collect();
    let outermost = settings.brim_object_gap + 20.0 * spacing - spacing / 2.0;
    assert!((left[0] - (100.0 - outermost)).abs() < 0.01, "{left:?}");
    assert!(left.windows(2).all(|w| (w[1] - w[0] - spacing).abs() < 0.01), "{left:?}");
    // Each loop stops the seam gap short of where it started.
    for l in &loops {
        let (a, b) = (l[0], l[l.len() - 1]);
        let gap = (a[0] - b[0]).hypot(a[1] - b[1]);
        assert!((gap - settings.seam_gap).abs() < 0.003, "{gap} mm between a loop's start and end");
    }
    let feature = |name: &str| out.stats.features[Role::ALL.iter().position(|r| r.feature() == name).unwrap()];
    assert!(feature("Brim").volume > 0.0 && feature("Brim").time > 0.0);
}

#[test]
fn a_brim_people_turn_on_rings_a_model_that_needs_none() {
    // A 20 mm cube stands on its own: the auto brim leaves it be, and a 5 mm brim turned on is 10 lines.
    let cube = cube_stl(20.0);
    let slice_with = |brim: &str| {
        let settings = Settings { brim_type: brim.into(), ..Settings::default() };
        let out = slice(&[Input { name: "cube.stl", bytes: &cube }], &settings, &Options::default()).unwrap();
        let gcode = String::from_utf8(out.gcode).unwrap();
        check_moves(&gcode, &settings);
        brim_loops(&gcode).len()
    };
    assert_eq!(slice_with("auto_brim"), 0);
    assert_eq!(slice_with("no_brim"), 0);
    assert_eq!(slice_with("outer_only"), 10);
}

/// A slice setup made by the app's own `sliceSetup` from its slicing settings (src/shared/slicing/settings.ts), as
/// it hands them to Orca's engine: Generic ABS in blue at 0.12 mm, four walls and 25 % gyroid on the Engineering
/// Plate, at 80 %. Made again with:
///
///     node slicer-rs/bench/setup.mts presets.json '{"layerHeight":0.12,"walls":4,"infill":25,"pattern":"gyroid",
///       "filaments":[{"material":"ABS","colorHex":"#2b6cb0"}],"plate":"Engineering Plate","scale":80}'
const ABS_SETUP: &str = include_str!("setups/abs-fine-strong.json");

#[test]
fn a_setup_made_from_the_apps_settings_slices_as_they_ask() {
    let setup = setup::read(ABS_SETUP).unwrap();
    let s = &setup.settings;
    assert_eq!((s.layer_height, s.wall_loops, s.sparse_density, setup.scale), (0.12, 4, 0.25, 80.0));
    assert_eq!((s.filament.as_str(), s.bed_type.as_str()), ("Generic ABS @BBL X2D 0.4 nozzle", "Engineering Plate"));
    let options = Options { scale: setup.scale, ..Options::default() };
    let cube = cube_stl(20.0);
    let out = slice(&[Input { name: "cube.stl", bytes: &cube }], s, &options).unwrap();
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    // 80 % of the 20 mm cube, in 0.12 mm layers over the 0.2 mm first one.
    assert!((out.stats.max_z - 16.0).abs() < 0.13, "{} mm tall", out.stats.max_z);
    assert!(gcode.contains("; LAYER_HEIGHT: 0.12\n"));
    let layers = check_moves(&gcode, s);
    assert_eq!(layers.len(), out.stats.layers);
    // Four walls: three inner loops for each outer one.
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    let walls = volume(Role::InnerWall) / volume(Role::OuterWall);
    assert!(walls > 2.7 && walls < 3.5, "inner walls {walls} times the outer");
    // The start heats the chamber for ABS and the Engineering Plate to 90 °C; the nozzle prints the first layer at
    // 260 °C and the rest at 270 °C, set at the second layer as Orca sets it.
    assert!(gcode.contains("M191 S60 ; wait for chamber temp\n"));
    assert!(gcode.contains("M190 S90"));
    assert!(gcode.contains("M104 S260 A\n"));
    let by_layer: Vec<&str> = gcode.split("; CHANGE_LAYER\n").collect();
    assert!(by_layer[2].contains("\nM104 S270 ; set nozzle temperature\n"), "{}", &by_layer[2][..600]);
    assert_eq!(gcode.matches("M104 S270 ; set nozzle temperature").count(), 1);
    // The part fan stays off for ABS's first three layers, then follows each layer's time (Orca's cooling).
    let fan_on = |part: &str| part.lines().any(|l| l.starts_with("M106 S") && l != "M106 S0");
    assert!(!by_layer[..3].iter().any(|part| fan_on(part)), "a fan before the fourth layer");
    assert!(fan_on(by_layer[3]), "no fan for the fourth layer");
    // The gyroid and the monotonic surfaces are drawn as asked, and the nozzle lifts as Generic ABS asks, with
    // Orca's Auto Lift: up the travel slope.
    assert!(out.fallbacks.is_empty(), "{:?}", out.fallbacks);
    let lifts = lifts(&gcode);
    assert!(lifts.iter().flat_map(|(_, l)| l).any(|(k, _)| *k == "slope"));
    // The plate's description: ABS in its colour, and no Bambu tray id for a generic filament.
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(r##"<filament id="1" tray_info_idx="" type="ABS" color="#2B6CB0""##), "{info}");
}

/// Settings with Orca's normal supports, as the app asks for them (its "normal" support style).
fn normal_supports() -> Settings {
    setup::read(r#"{"process": {"enable_support": "1", "support_type": "normal(auto)"}}"#).unwrap().settings
}

#[test]
fn normal_supports_hold_up_a_slab_from_layers_of_their_own() {
    // A T: a 10 mm pillar 20 mm tall under a 40 × 10 mm slab, 15 mm out on each side.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let s = normal_supports();
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &s, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers = check_moves(&gcode, &s);
    // Native OrcaSlicer 2.5.0 with these settings (Nov 13): 181 layers, the support's own 0.28 mm ones between the
    // object's 0.2 mm ones (0.2, 0.4, 0.48, 0.6, 0.76, 0.8…), 1358.6 mm³ of support and 90.7 mm³ of interface.
    assert_eq!(layers.len(), 181);
    let zs: Vec<f64> =
        gcode.lines().filter_map(|l| l.strip_prefix("; Z_HEIGHT: ")).map(|z| z.parse().unwrap()).collect();
    assert_eq!(&zs[..6], &[0.2, 0.4, 0.48, 0.6, 0.76, 0.8]);
    let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()];
    let near = |got: f64, want: f64| (got - want).abs() < want * 0.005;
    assert!(near(feature(Role::Support).volume, 1358.6), "{} mm³ of support", feature(Role::Support).volume);
    assert!(near(feature(Role::SupportInterface).volume, 90.7), "{} mm³", feature(Role::SupportInterface).volume);
    // A layer of the support's own prints support alone, at its own height, and inside the object's label.
    let own = gcode.split("; Z_HEIGHT: 0.48\n").nth(1).unwrap().split("; CHANGE_LAYER").next().unwrap();
    assert!(own.contains("; LAYER_HEIGHT: 0.08\n") && own.contains("; LAYER_HEIGHT: 0.28\n"));
    let features: Vec<&str> = own.lines().filter_map(|l| l.strip_prefix("; FEATURE: ")).collect();
    assert_eq!(features, ["Support"]);
    // The support stands clear of the pillar and only under the slab; its interface is the two layers under it.
    let mut feature = "";
    let mut z = 0.0;
    for line in gcode.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        } else if let Some(h) = line.strip_prefix("; Z_HEIGHT: ") {
            z = h.parse().unwrap();
        } else if let Some(rest) = line.strip_prefix("G1 X").filter(|_| feature.starts_with("Support")) {
            let words: Vec<&str> = rest.split(' ').collect();
            if !words.iter().any(|w| w.starts_with('E') && !w.starts_with("E-")) {
                continue;
            }
            let x: f64 = words[0].parse().unwrap();
            let y: f64 = words.iter().find_map(|w| w.strip_prefix('Y')).unwrap().parse().unwrap();
            assert!(!(114.8..=125.2).contains(&x) || !(122.8..=133.2).contains(&y), "support in the pillar at {x} {y}");
            assert!((97.0..=143.0).contains(&x) && (120.0..=136.0).contains(&y), "support at {x} {y}");
            if feature == "Support interface" {
                assert!([19.52, 19.8].contains(&z), "interface at {z} mm");
            }
        }
    }
}

#[test]
fn organic_trees_hold_up_a_slab_on_two_trunks() {
    // The T again, with the X2D's own supports: Orca's organic trees.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let s = setup::read(r#"{"process": {"enable_support": "1"}}"#).unwrap().settings;
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &s, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers = check_moves(&gcode, &s);
    // Native OrcaSlicer 2.5.0 (Nov 13): the trees on the object's own 125 layers, 768.7 mm³ of branches and 55.5 mm³
    // of interface, the roof's two layers at 19.6 and 19.8 mm, branches from 19.4 mm down to the plate. Ours are
    // the same trees but for where a few branches merge (Clipper's order decides it in Orca), 3.5 % less plastic.
    assert_eq!(layers.len(), 125);
    let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()];
    let near = |got: f64, want: f64, share: f64| (got - want).abs() < want * share;
    assert!(near(feature(Role::Support).volume, 768.7, 0.05), "{} mm³ of branches", feature(Role::Support).volume);
    assert!(
        near(feature(Role::SupportInterface).volume, 55.5, 0.005),
        "{} mm³",
        feature(Role::SupportInterface).volume
    );
    let mut feature = "";
    let mut z = 0.0;
    let mut first_layer_islands = 0;
    for line in gcode.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
            if feature == "Support" && z == 0.2 {
                first_layer_islands += 1;
            }
        } else if let Some(h) = line.strip_prefix("; Z_HEIGHT: ") {
            z = h.parse().unwrap();
        } else if let Some(rest) = line.strip_prefix("G1 X").filter(|_| feature.starts_with("Support")) {
            let words: Vec<&str> = rest.split(' ').collect();
            if !words.iter().any(|w| w.starts_with('E') && !w.starts_with("E-")) {
                continue;
            }
            let x: f64 = words[0].parse().unwrap();
            let y: f64 = words.iter().find_map(|w| w.strip_prefix('Y')).unwrap().parse().unwrap();
            assert!(!(114.8..=125.2).contains(&x) || !(122.8..=133.2).contains(&y), "support in the pillar at {x} {y}");
            match feature {
                "Support interface" => assert!([19.6, 19.8].contains(&z), "interface at {z} mm"),
                _ => assert!(z <= 19.4 + 1e-9, "a branch at {z} mm"),
            }
        }
    }
    // On the plate the two trunks' flanges, each with its brim-like ring and lines.
    assert!(first_layer_islands >= 1);
}

#[test]
fn supports_leave_a_model_that_needs_none_as_it_was() {
    let cube = cube_stl(20.0);
    let options = Options { thumbnail: false, ..Options::default() };
    let with = slice(&[Input { name: "cube.stl", bytes: &cube }], &normal_supports(), &options).unwrap();
    let without = slice(&[Input { name: "cube.stl", bytes: &cube }], &Settings::default(), &options).unwrap();
    assert_eq!((with.stats.layers, with.stats.volume), (without.stats.layers, without.stats.volume));
    assert!(!String::from_utf8(with.gcode).unwrap().contains("; FEATURE: Support"));
}

/// A model made of boxes (`boxes_stl`): each box's lowest and highest corners.
type Boxes<'a> = &'a [([f32; 3], [f32; 3])];

#[test]
fn without_supports_each_object_that_needs_them_is_warned_of_as_orca_warns() {
    let warnings = |models: &[(&str, Boxes)], s: &Settings| {
        let stls: Vec<Vec<u8>> = models.iter().map(|(_, boxes)| boxes_stl(boxes)).collect();
        let inputs: Vec<Input> =
            models.iter().zip(&stls).map(|((name, _), stl)| Input { name, bytes: stl.as_slice() }).collect();
        let out = slice(&inputs, s, &Options { thumbnail: false, ..Options::default() }).unwrap();
        out.warnings.into_iter().map(|w| (w.kind, w.message)).collect::<Vec<_>>()
    };
    let says = |name: &str, what: &str| {
        vec![(
            "need_support_on",
            format!("It seems object {name} {what}. Please re-orient the object or enable support generation."),
        )]
    };
    let none: Vec<(&str, String)> = Vec::new();
    // Native OrcaSlicer 2.5.0 (Nov 14) warns of each as here. The app's drying rack: an arm that starts in the air
    // 6 mm from its post.
    let rack: Boxes =
        &[([0., 0., 0.], [36., 36., 4.]), ([12., 12., 4.], [24., 24., 50.]), ([30., 15., 34.], [56., 21., 38.])];
    let off = Settings::default();
    assert_eq!(warnings(&[("rack.stl", rack)], &off), says("rack.stl", "has floating regions"));
    // A slab 15 mm out each side of its pillar, and a ledge 8 mm out from a wall: more than the 6 mm Orca lets be.
    let tee: Boxes = &[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])];
    assert_eq!(warnings(&[("tee.stl", tee)], &off), says("tee.stl", "has a floating cantilever"));
    let ledge = |out: f32| [([110., 120., 0.], [120., 140., 30.]), ([120., 120., 15.], [120. + out, 140., 19.])];
    assert_eq!(warnings(&[("ledge.stl", &ledge(8.0))], &off), says("ledge.stl", "has a floating cantilever"));
    // A ledge 5 mm out and a cube need none; on a plate with them, only the rack is warned of.
    let cube: Boxes = &[([0., 0., 0.], [20., 20., 20.])];
    assert_eq!(warnings(&[("ledge.stl", &ledge(5.0)), ("cube.stl", cube)], &off), none);
    assert_eq!(
        warnings(&[("cube.stl", cube), ("rack.stl", rack), ("ledge.stl", &ledge(5.0))], &off),
        says("rack.stl", "has floating regions")
    );
    // With supports, there is nothing to warn of.
    let on = setup::read(r#"{"process": {"enable_support": "1"}}"#).unwrap().settings;
    assert_eq!(warnings(&[("rack.stl", rack)], &on), none);
}

#[test]
fn a_brim_leaves_room_for_the_supports_flange() {
    // A fin 4 × 20 mm and 40 mm tall gets a brim; an arm off it 10 mm up has support down to the plate, whose flange
    // lies where the brim would go. Native OrcaSlicer 2.5.0 (Nov 13) keeps the brim out of what the flange prints:
    // 10 loops round it, 1,225.4 mm of line, where the fin alone gets 20.
    let model = boxes_stl(&[([100., 110., 0.], [104., 130., 40.]), ([104., 115., 10.], [114., 125., 14.])]);
    let s = normal_supports();
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "fin.stl", bytes: &model }], &s, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    check_moves(&gcode, &s);
    let loops = brim_loops(&gcode);
    assert_eq!(loops.len(), 10);
    let length =
        |run: &Vec<[f64; 2]>| run.windows(2).map(|w| (w[1][0] - w[0][0]).hypot(w[1][1] - w[0][1])).sum::<f64>();
    let total: f64 = loops.iter().map(length).sum();
    assert!((total - 1225.4).abs() < 1.5, "{total} mm of brim");
    // Nowhere does a brim line come near the flange's lines: they lie a line apart (0.46 mm), but at the corner where
    // the flange's loop starts and ends.
    let flange: Vec<[[f64; 2]; 2]> =
        first_layer_runs(&gcode, "Support").iter().flat_map(|run| run.windows(2).map(|w| [w[0], w[1]])).collect();
    assert!(!flange.is_empty());
    let to_flange = |p: [f64; 2]| {
        flange
            .iter()
            .map(|[a, b]| {
                let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
                let t = (((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy).max(1e-12)).clamp(0.0, 1.0);
                (p[0] - a[0] - t * dx).hypot(p[1] - a[1] - t * dy)
            })
            .fold(f64::MAX, f64::min)
    };
    for run in &loops {
        for w in run.windows(2) {
            for k in 0..=20 {
                let t = k as f64 / 20.0;
                let p = [w[0][0] + t * (w[1][0] - w[0][0]), w[0][1] + t * (w[1][1] - w[0][1])];
                assert!(to_flange(p) > 0.35, "brim at {p:?}, {} mm from the flange", to_flange(p));
            }
        }
    }
}

/// A 20 mm frame in filament 1 round the 10 mm square that fills it in filament 2, 4 mm tall: a Bambu Studio project
/// of two objects that each name their filament (tests/models/make.py).
const TWO_COLOURS: &[u8] = include_bytes!("models/two-colours.3mf");
const TWO_FILAMENTS: &str = r##"{"filaments": [{}, {}], "colours": ["#F2754E", "#4F7FC7"]}"##;

/// The tool each line runs with (`T…` lines change it), and the object label it is inside, for every line.
fn tools_and_labels(gcode: &str) -> Vec<(Option<usize>, Option<u32>, &str)> {
    let (mut tool, mut label) = (None, None);
    gcode
        .lines()
        .map(|line| {
            let code = line.split(';').next().unwrap_or("").trim();
            if let Some(t) = code.split_whitespace().next().and_then(|w| w.strip_prefix('T'))
                && let Ok(t) = t.parse::<usize>()
                && t < 16
            {
                tool = Some(t);
            }
            if let Some(id) = line.strip_prefix("; start printing object, unique label id: ") {
                label = id.trim().parse().ok();
            }
            if line.starts_with("; stop printing object") {
                label = None;
            }
            (tool, label, line)
        })
        .collect()
}

#[test]
fn two_filaments_change_once_a_layer_over_a_prime_tower() {
    let settings = setup::read(TWO_FILAMENTS).unwrap().settings;
    let input = || Input { name: "two-colours.3mf", bytes: TWO_COLOURS };
    let out = slice(&[input()], &settings, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    let s = &out.stats;
    assert_eq!(s.layers, 20);
    // As Orca groups two filaments on the X2D: each on a nozzle of its own, the first on the right one.
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(r#"<metadata key="filament_maps" value="2 1"/>"#), "{info}");
    assert!(info.contains(r##"<filament id="2" tray_info_idx="GFA00" type="PLA" color="#4F7FC7""##), "{info}");
    assert!(info.contains(r#"<nozzle id="1" extruder_id="2""#), "{info}");
    assert!(gcode.contains("\n; filament: 1,2\n"));
    // Every layer changes filament once, in a tool change on the tower, and prints the tower.
    let layers: Vec<&str> = gcode.split("; CHANGE_LAYER\n").skip(1).collect();
    assert_eq!(layers.len(), s.layers);
    for (i, layer) in layers.iter().enumerate() {
        let mut in_change = false;
        let mut changes = 0;
        for line in layer.lines() {
            match line {
                "; CP TOOLCHANGE START" => in_change = true,
                "; CP TOOLCHANGE END" => in_change = false,
                l if l.starts_with("T0 ") || l.starts_with("T1 ") => {
                    assert!(in_change, "layer {i} changes filament off the tower: {l}");
                    changes += 1;
                }
                _ => {}
            }
        }
        assert_eq!(changes, 1, "layer {i}");
        assert!(layer.contains("; FEATURE: Prime tower\n"), "layer {i} has no tower");
    }
    assert_eq!(s.tool_changes, 20);
    // Each object prints in its own filament (T0 the frame, T1 the square), and every move between the printer's start
    // and end G-code stays on the plate, tool changes and all.
    let mut printed = [0usize; 2];
    let mut in_body = false;
    for (tool, label, line) in tools_and_labels(&gcode) {
        match line {
            "M981 S1 P20000 ;open spaghetti detector" => in_body = true,
            "M981 S0 P20000 ; close spaghetti detector" => in_body = false,
            _ => {}
        }
        let code = line.split(';').next().unwrap_or("").trim();
        if !in_body || !(code.starts_with("G1 ") || code.starts_with("G0 ")) {
            continue;
        }
        let (x, y) = (word(code, 'X'), word(code, 'Y'));
        for (v, max) in [(x, settings.bed[0]), (y, settings.bed[1])] {
            assert!(v.is_none_or(|v| (0.0..=max).contains(&v)), "off the plate: {line}");
        }
        if let Some(label) = label
            && word(code, 'E').is_some_and(|e| e > 0.0)
            && (x.is_some() || y.is_some())
        {
            assert_eq!(tool, Some(label as usize - 1), "object {label} printed with T{tool:?}: {line}");
            printed[label as usize - 1] += 1;
        }
    }
    assert!(printed.iter().all(|&n| n > 100), "{printed:?}");
    // Each filament's use, the tower's included; nothing flushed (each has its nozzle); the totals add them up.
    assert_eq!(s.filaments.len(), 2);
    assert!(s.filaments.iter().all(|f| f.length > 100.0 && f.tower > 100.0 && f.flush == 0.0), "{:?}", s.filaments);
    let weight: f64 = s.filaments.iter().map(|f| f.weight).sum();
    assert!((weight - s.weight).abs() < 1e-9);
    let used: Vec<String> = s.filaments.iter().map(|f| format!(" {:.2}", f.length)).collect();
    assert!(gcode.contains(&format!("; filament used [mm] ={}\n", used.join(","))), "{}", &gcode[gcode.len() - 300..]);
    // The plate in one filament prints the same objects without the changes, the tower and their minutes.
    let one = slice(&[input()], &Settings::default(), &Options::default()).unwrap();
    assert!(s.total_time > one.stats.total_time + 20.0 * 5.0, "{} s against {} s", s.total_time, one.stats.total_time);
    assert!(!String::from_utf8(one.gcode).unwrap().contains("; FEATURE: Prime tower"));
}

#[test]
fn the_waiting_nozzle_cools_and_heats_again_as_orcas_does() {
    let settings = setup::read(TWO_FILAMENTS).unwrap().settings;
    let input = || Input { name: "two-colours.3mf", bytes: TWO_COLOURS };
    let out = slice(&[input()], &settings, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    let lines: Vec<&str> = gcode.lines().collect();
    // Orca's lines (`M104 T<nozzle> S<°C> N0 ;Multi extruder pre cooling` or `pre heating`): the nozzle a change of
    // nozzle leaves cools while it waits, and heats again to its printing temperature before it is needed (between the
    // M632 and M633 that let the printer skip it); the nozzle that waits at the end cools to 25 °C.
    let mut cooled: [Option<i64>; 2] = [None; 2];
    let (mut cools, mut heats, mut last) = (0, 0, 0);
    for (i, l) in lines.iter().enumerate() {
        let Some(rest) = l.strip_prefix("M104 T").filter(|_| l.contains(";Multi extruder pre")) else { continue };
        let words: Vec<&str> = rest.split_whitespace().collect();
        let (nozzle, temp): (usize, i64) = (words[0].parse().unwrap(), words[1][1..].parse().unwrap());
        assert_eq!(lines[i - 1], "M400", "line {i}");
        if l.ends_with("pre heating") {
            heats += 1;
            assert_eq!(temp, 220, "{l}");
            assert!(lines[i - 2].starts_with("M632 S") && lines[i + 1] == "M633", "line {i}");
            assert!(cooled[nozzle].take().is_some(), "nozzle {nozzle} heats without having cooled: line {i}");
        } else {
            cools += 1;
            assert!((25..220).contains(&temp), "{l}");
            cooled[nozzle] = Some(temp);
            last = temp;
        }
    }
    assert!(heats >= 15 && cools == heats + 1, "{cools} coolings, {heats} heatings");
    assert_eq!(last, 25);
    // They come after the estimate, as Orca's do: without them (`enable_pre_heating` off) the G-code is the same,
    // and so is every figure.
    let off = r##"{"filaments": [{}, {}], "colours": ["#F2754E", "#4F7FC7"], "machine": {"enable_pre_heating": "0"}}"##;
    let plain = slice(&[input()], &setup::read(off).unwrap().settings, &Options::default()).unwrap();
    assert_eq!(without_preheat(&gcode), String::from_utf8(plain.gcode).unwrap());
    assert_eq!(out.stats.total_time, plain.stats.total_time);
    assert_eq!(out.stats.weight, plain.stats.weight);
}

#[test]
fn two_filaments_on_one_nozzle_flush_between_them() {
    let setup = r##"{"process": {"filament_map_mode": "Manual", "filament_map": ["1", "1"]},
        "filaments": [{}, {}], "colours": ["#F2754E", "#4F7FC7"]}"##;
    let settings = setup::read(setup).unwrap().settings;
    let out = slice(&[Input { name: "two-colours.3mf", bytes: TWO_COLOURS }], &settings, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(r#"<metadata key="filament_maps" value="1 1"/>"#), "{info}");
    // The printer flushes at each change, as Orca's volumes for orange and blue on the left nozzle say (its least,
    // 100 mm³, one way; 423 mm³ times the left nozzle's 0.3 the other), and the estimate waits for it.
    assert!(gcode.contains("M620.10 A1 F523.843 L41.5752 "), "no 100 mm³ flush");
    assert!(gcode.contains("M620.10 A1 F523.843 L52.7589 "), "no 126.9 mm³ flush");
    let s = &out.stats;
    let flushed: f64 = s.filaments.iter().map(|f| f.flush).sum();
    assert!((flushed - 10.0 * 100.0 - 10.0 * 126.9).abs() < 1.0, "{flushed} mm³ flushed");
    // Flushing counts in the filament used.
    let printed: f64 = s.filaments.iter().map(|f| f.volume - f.flush).sum();
    assert!((s.volume - printed - flushed).abs() < 1e-6);
    // One nozzle never waits: nothing to cool or heat ahead.
    assert!(!gcode.contains(";Multi extruder pre"));
}

#[test]
fn parts_of_one_object_in_different_filaments_are_refused() {
    let mut w = zip::Writer::default();
    let cube = |at: f32| {
        format!(
            r#"<mesh><vertices><vertex x="{at}" y="0" z="0"/><vertex x="{x}" y="0" z="0"/><vertex x="{at}" y="10" z="0"/><vertex x="{at}" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh>"#,
            x = at + 10.0
        )
    };
    let model = format!(
        r#"<model unit="millimeter"><resources><object id="1" type="model">{}</object><object id="2" type="model">{}</object><object id="3" type="model"><components><component objectid="1"/><component objectid="2"/></components></object></resources><build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 100 100 0"/></build></model>"#,
        cube(0.0),
        cube(20.0)
    );
    let settings = r#"<config><object id="3"><metadata key="name" value="two parts"/><part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part><part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part></object></config>"#;
    w.add("3D/3dmodel.model", model.as_bytes(), 6);
    w.add("Metadata/model_settings.config", settings.as_bytes(), 6);
    let file = w.finish();
    let input = || Input { name: "parts.3mf", bytes: &file };
    let two = setup::read(TWO_FILAMENTS).unwrap().settings;
    let refused = slice(&[input()], &two, &Options::default()).err();
    assert_eq!(refused, Some(Error::Unsupported("parts of one object in different filaments")));
    // With one filament, all of it prints in that one, as Orca prints it.
    assert!(slice(&[input()], &Settings::default(), &Options::default()).is_ok());
}

#[test]
fn several_filaments_need_each_models_filament() {
    let two = setup::read(TWO_FILAMENTS).unwrap().settings;
    let cube = cube_stl(10.0);
    let input = || Input { name: "cube.stl", bytes: &cube };
    // An STL says nothing of its filament: with several, all of it would print in the first.
    let refused = slice(&[input(), input()], &two, &Options::default()).err();
    assert_eq!(refused, Some(Error::Unsupported("several filaments for models that don't say which they print in")));
    // Named, each prints in its own.
    let mut plate = spaghetti_slicer::Plate::default();
    plate.add_with_filament(&input(), Some(0)).unwrap();
    plate.add_with_filament(&input(), Some(1)).unwrap();
    let out = plate.slice(&two, &Options::default()).unwrap();
    assert_eq!(out.stats.tool_changes, out.stats.layers);
}

/// Orca's pre-cooling and pre-heating lines taken out of a G-code file (`M400` and `M104 … ;Multi extruder pre
/// cooling`, and `M632`, `M400`, `M104 … ;Multi extruder pre heating`, `M633`).
fn without_preheat(gcode: &str) -> String {
    let lines: Vec<&str> = gcode.split_inclusive('\n').collect();
    let mut out = String::with_capacity(gcode.len());
    let mut i = 0;
    while i < lines.len() {
        let at = |k: usize| lines.get(i + k).copied().unwrap_or("");
        if at(0).starts_with("M632 ") && at(1) == "M400\n" && at(2).contains(";Multi extruder pre heating") {
            i += 4;
        } else if at(0) == "M400\n" && at(1).contains(";Multi extruder pre cooling") {
            i += 2;
        } else {
            out.push_str(at(0));
            i += 1;
        }
    }
    out
}

/// Orca's pre-heating, run on G-code Orca wrote for the benchmark's plate in two colours (`bench/run.py`, model
/// "colour") with its lines taken out, puts them back where Orca did: every line, at its place or a move from it, its
/// temperature within 1 °C (where our estimator's time differs a little from Orca's). `PREHEAT_OUT` keeps ours.
/// `ORCA_GCODE=…/plate_1.gcode cargo test --release --test slice -- --ignored --nocapture preheat`
#[test]
#[ignore]
fn preheat_puts_back_orcas_lines() {
    let Ok(path) = std::env::var("ORCA_GCODE") else { return };
    let orca = std::fs::read_to_string(path).unwrap();
    // The plate's two PLA filaments at 220 °C, the first (filament 1) on the right extruder, as Orca grouped them.
    let p = spaghetti_slicer::preheat::Params {
        temperature: vec![220, 220],
        pre_cooling: vec![0, 0],
        preheat_delta: vec![0.0, 0.0],
        extruder_of: vec![1, 0],
        heating: vec![1.5, 1.5],
        cooling: vec![2.0, 2.0],
        physical: vec![1, 0],
        nozzles: vec![1],
        switcher_offset: None,
        change_secs: 5.0,
        load_secs: 29.0,
        unload_secs: 29.0,
    };
    let bare = without_preheat(&orca);
    assert!(bare.len() < orca.len(), "no pre-heating lines in the file");
    let ours = spaghetti_slicer::preheat::add_lines(bare.as_bytes(), &p, &Settings::default()).unwrap();
    let ours = String::from_utf8(ours).unwrap();
    if let Ok(path) = std::env::var("PREHEAT_OUT") {
        std::fs::write(path, &ours).unwrap();
    }
    // Each line: where it is, which nozzle, how hot, cooling or heating.
    let lines = |g: &str| -> Vec<(usize, String, i64, bool)> {
        g.lines()
            .enumerate()
            .filter(|(_, l)| l.contains(";Multi extruder pre"))
            .map(|(i, l)| {
                let w: Vec<&str> = l.split_whitespace().collect();
                (i, w[1].to_string(), w[2][1..].parse().unwrap(), l.ends_with("heating"))
            })
            .collect()
    };
    let (theirs, mine) = (lines(&orca), lines(&ours));
    assert_eq!(theirs.len(), mine.len());
    let mut same = 0;
    for (a, b) in theirs.iter().zip(&mine) {
        assert!(a.1 == b.1 && a.3 == b.3 && (a.2 - b.2).abs() <= 1 && a.0.abs_diff(b.0) <= 2, "Orca {a:?}, ours {b:?}");
        same += usize::from(a == b);
    }
    println!("{same} of {} lines exactly as Orca's", theirs.len());
}
