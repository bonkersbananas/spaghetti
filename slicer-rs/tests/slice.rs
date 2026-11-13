//! The whole job, from model files to a `.gcode.3mf`, on small models.

use md5::{Digest, Md5};
use spaghetti_slicer::region::Role;
use spaghetti_slicer::{Error, Input, Options, Settings, setup, slice, zip};

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
/// skip labels. Returns the labels each layer printed.
fn check_moves(gcode: &str, s: &Settings) -> Vec<Vec<u32>> {
    let body = gcode.split("M981 S1 P20000 ;open spaghetti detector\n").nth(1).expect("the start G-code's end");
    let body = body.split("M981 S0 P20000 ; close spaghetti detector\n").next().expect("the end G-code's start");
    let (mut x, mut y, mut z) = (f64::NAN, f64::NAN, 1.0);
    let mut layer_z = f64::NAN;
    let mut pulled: f64 = 0.0;
    let mut label: Option<u32> = None;
    let mut layers: Vec<Vec<u32>> = Vec::new();
    let mut in_photo = false;
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
                assert!(nz >= layer_z - 1e-6, "never below the layer while moving: {}", at());
            }
            if e > 0.0 && moves_xy {
                assert!((nz - layer_z).abs() < 1e-6, "prints at the layer's height: {}", at());
                assert!(pulled.abs() < 1e-4, "prints only with the filament pushed back: {}", at());
                assert!(label.is_some(), "prints only inside an object's label: {}", at());
            } else if e != 0.0 {
                pulled -= e;
                assert!(pulled > -1e-4 && pulled < s.retract_length + 1e-4, "{pulled} mm pulled back: {}", at());
            }
            (x, y, z) = (nx, ny, nz);
        } else if code.starts_with("G3 ") {
            let (i, j) = (word(code, 'I').unwrap(), word(code, 'J').unwrap());
            let nz = word(code, 'Z').unwrap();
            assert!((i.hypot(j) - r).abs() < 0.002, "a spiral of the z-hop's radius: {}", at());
            assert!((nz - (layer_z + s.z_hop)).abs() < 1e-6, "lifts by the z-hop: {}", at());
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
    // What it printed otherwise than asked, it says.
    assert!(out.fallbacks.iter().any(|f| f == "gyroid sparse infill printed as straight lines"), "{:?}", out.fallbacks);
    // The plate's description: ABS in its colour, and no Bambu tray id for a generic filament.
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(r##"<filament id="1" tray_info_idx="" type="ABS" color="#2B6CB0""##), "{info}");
}
