//! The whole job, from model files to a `.gcode.3mf`, on small models.

use md5::{Digest, Md5};
use spaghetti_slicer::region::Role;
use spaghetti_slicer::{Error, Input, Options, Settings, slice, zip};

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
    let png = entry(&out.file, "Metadata/plate_1.png");
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
}

#[test]
fn a_beam_between_two_pillars_is_bridged() {
    let stl = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/models/bridge.stl")).unwrap();
    let options = Options { arrange: false, thumbnail: false };
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
