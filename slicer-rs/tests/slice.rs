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
    // Bambu Studio opens a zip as a sliced plate only when its generator is "BambuStudio-<version>" (its reader
    // `_handle_end_metadata`; otherwise it loads no config or G-code and says "The file does not contain any
    // geometry data"), with a non-empty project config and the plate's G-code named in model_settings.config.
    let model = String::from_utf8(entry(&out.file, "3D/3dmodel.model")).unwrap();
    assert!(model.contains(r#"<metadata name="Application">BambuStudio-02.00.00.00</metadata>"#), "{model}");
    let project = String::from_utf8(entry(&out.file, "Metadata/project_settings.config")).unwrap();
    assert!(project.trim_start().starts_with('{') && project.len() > 100);
    let model_settings = String::from_utf8(entry(&out.file, "Metadata/model_settings.config")).unwrap();
    assert!(model_settings.contains(r#"<metadata key="gcode_file" value="Metadata/plate_1.gcode"/>"#));
    let inside = entry(&out.file, "Metadata/plate_1.gcode");
    assert_eq!(inside, out.gcode);
    let md5: String = Md5::digest(&inside).iter().map(|b| format!("{b:02X}")).collect();
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
fn painted_cubes_slice_unless_their_filaments_interlock() {
    use spaghetti_slicer::{Plate, paint::Paint};
    let cube = cube_stl(10.0);
    // Paint as the app hands it: the STL's 12th triangle (index 11), its left side's last, in filament 2.
    let mut bytes = Vec::new();
    for word in [1u32, 11, 1] {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    bytes.push(b'8');
    let painted = |settings: &Settings, paint: &[u8]| {
        let mut plate = Plate::default();
        plate.add_part(&Input { name: "c.stl", bytes: &cube }, 0, true).expect("a cube");
        let taken = plate.paint(&Paint::from_bytes(paint).expect("paint"));
        (taken, plate.slice(settings, &Options::default()).err())
    };
    // In one filament everything prints in it, as Orca prints it; in two the paint prints too.
    assert_eq!(painted(&Settings::default(), &bytes), (true, None));
    let mut two = setup::read(TWO_FILAMENTS).unwrap().settings;
    assert_eq!(painted(&two, &bytes), (true, None));
    // Orca's beams where an object's filaments meet aren't ported: refused by name.
    two.interlocking_beam = true;
    assert_eq!(painted(&two, &bytes), (true, Some(Error::Unsupported("interlocking beams"))));
    // Paint for triangles the STL doesn't have isn't taken; nor is paint after a 3MF, which brings its own.
    let mut past = bytes.clone();
    past[4..8].copy_from_slice(&12u32.to_le_bytes());
    assert_eq!(painted(&Settings::default(), &past), (false, None));
}

/// An extrusion: the tool, the feature, and the move's ends in mm.
type Extrusion = (Option<usize>, String, [f64; 2], [f64; 2]);

/// Each layer's extrusions (`G1` moves that push filament and go somewhere).
fn extrusions(gcode: &str) -> Vec<Vec<Extrusion>> {
    let mut layers: Vec<Vec<Extrusion>> = Vec::new();
    let (mut tool, mut feature, mut at) = (None, String::new(), [0.0, 0.0]);
    for line in gcode.lines() {
        if line == "; CHANGE_LAYER" {
            layers.push(Vec::new());
        } else if let Some(name) = line.strip_prefix("; FEATURE: ") {
            feature = name.to_string();
        }
        let code = line.split(';').next().unwrap_or("").trim();
        if let Some(t) = code.split_whitespace().next().and_then(|w| w.strip_prefix('T'))
            && let Ok(t) = t.parse::<usize>()
            && t < 16
        {
            tool = Some(t);
        }
        if !["G0 ", "G1 ", "G2 ", "G3 "].iter().any(|g| code.starts_with(g)) {
            continue;
        }
        let to = [word(code, 'X').unwrap_or(at[0]), word(code, 'Y').unwrap_or(at[1])];
        if code.starts_with("G1 ")
            && word(code, 'E').is_some_and(|e| e > 0.0)
            && to != at
            && let Some(layer) = layers.last_mut()
        {
            layer.push((tool, feature.clone(), at, to));
        }
        at = to;
    }
    layers
}

/// A model (an STL) kept where it is, its `triangles` painted in filament 2 ("8"), sliced in two filaments: each
/// layer's extrusions.
fn painted_layers(model: &[u8], triangles: &[u32]) -> Vec<Vec<Extrusion>> {
    use spaghetti_slicer::{Plate, paint::Paint};
    let settings = setup::read(TWO_FILAMENTS).unwrap().settings;
    let mut bytes = (triangles.len() as u32).to_le_bytes().to_vec();
    for &t in triangles {
        bytes.extend_from_slice(&t.to_le_bytes());
    }
    for end in 1..=triangles.len() as u32 {
        bytes.extend_from_slice(&end.to_le_bytes());
    }
    bytes.extend(std::iter::repeat_n(b'8', triangles.len()));
    let mut plate = Plate::default();
    plate.add_part(&Input { name: "model.stl", bytes: model }, 0, true).expect("a model");
    assert!(plate.paint(&Paint::from_bytes(&bytes).expect("paint")));
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    extrusions(&String::from_utf8(plate.slice(&settings, &options).expect("sliced").gcode).unwrap())
}

/// The lowest and highest of the points' x (`k` 0) or y (`k` 1).
fn range(points: &[[f64; 2]], k: usize) -> (f64, f64) {
    points.iter().fold((f64::MAX, f64::MIN), |(lo, hi), p| (lo.min(p[k]), hi.max(p[k])))
}

#[test]
fn painted_sides_print_in_their_filament_as_orca_splits_them() {
    // A 20 mm box 10 mm tall, kept where it is, its front (y = 100, triangles 4 and 5) painted in filament 2.
    let box_stl = boxes_stl(&[([100., 100., 0.], [120., 120., 10.])]);
    let sliced = painted_layers;
    let walls = |layer: &[Extrusion], tool: usize| -> Vec<[f64; 2]> {
        layer.iter().filter(|m| m.0 == Some(tool) && m.1 == "Outer wall").flat_map(|m| [m.2, m.3]).collect()
    };
    let near = |a: f64, b: f64| (a - b).abs() < 0.02;

    // The whole front: as Orca splits the box (the region nearer the painted side than any other), the front
    // quarter of each layer prints in filament 2, a triangle from the front corners to the middle, walls round it;
    // the rest in filament 1, which never reaches the front.
    let layers = sliced(&box_stl, &[4, 5]);
    assert_eq!(layers.len(), 50);
    for (i, layer) in layers.iter().enumerate().take(45).skip(5) {
        let (front, rest) = (walls(layer, 1), walls(layer, 0));
        assert!(!front.is_empty() && !rest.is_empty(), "layer {i}");
        let (ys, xs) = (range(&front, 1), range(&front, 0));
        assert!(near(ys.0, 100.21) && near(ys.1, 110.0 - 0.21 * 2f64.sqrt()), "layer {i}: {ys:?}");
        // Its front corners are 45°: the wall's corners there stand 0.21 / tan 22.5° in.
        let corner = 0.21 / (std::f64::consts::PI / 8.0).tan();
        assert!(near(xs.0, 100.0 + corner) && near(xs.1, 120.0 - corner), "layer {i}: {xs:?}");
        let ys = range(&rest, 1);
        assert!(ys.0 > 100.4 && near(ys.1, 119.79), "layer {i}: {ys:?}");
    }

    // Half the front, cut along its diagonal (triangle 5: from the bottom left corner to the top right): the
    // painted stretch of each layer's front edge runs from x = 100 to 100 + 2 z, and so does the region in
    // filament 2. Its edge moves from layer to layer, where each region has walls: as Orca finds the shells over
    // the whole object, those call for no solid infill.
    let layers = sliced(&box_stl, &[5]);
    for (i, layer) in layers.iter().enumerate().take(44).skip(20) {
        let z = 0.2 * i as f64 + 0.1;
        let xs = range(&walls(layer, 1), 0);
        assert!(near(xs.1, 100.0 + 2.0 * z - 0.21), "layer {i}: {xs:?}");
        assert!(layer.iter().all(|m| m.1 != "Internal solid infill"), "layer {i} has solid infill");
    }

    // A 24-sided prism (radius 12 round x = y = 110) painted on four sides, from 45° to 105°: filament 2 takes the
    // sector between them, and filament 1's wall turns round its tip at a sharp corner on the sector's middle, 0.21
    // / sin 30° from the axis, as Orca's does: the split leaves points a hair apart there, which would make it a flat
    // if the regions weren't simplified as Orca's walls simplify them.
    let mut prism = String::from("solid prism\n");
    let corner = |k: usize, z: f64| {
        let a = 2.0 * std::f64::consts::PI * (k % 24) as f64 / 24.0;
        [110.0 + 12.0 * a.cos(), 110.0 + 12.0 * a.sin(), z]
    };
    for k in 0..24 {
        let (b0, b1, t0, t1) = (corner(k, 0.0), corner(k + 1, 0.0), corner(k, 10.0), corner(k + 1, 10.0));
        for facet in [[[110.0, 110.0, 0.0], b1, b0], [[110.0, 110.0, 10.0], t0, t1], [b0, b1, t1], [b0, t1, t0]] {
            prism.push_str(" facet normal 0 0 0\n  outer loop\n");
            for v in facet {
                prism.push_str(&format!("   vertex {} {} {}\n", v[0], v[1], v[2]));
            }
            prism.push_str("  endloop\n endfacet\n");
        }
    }
    prism.push_str("endsolid prism\n");
    let sides: Vec<u32> = (3..=6).flat_map(|k| [4 * k + 2, 4 * k + 3]).collect();
    let layers = sliced(prism.as_bytes(), &sides);
    let middle = 75f64.to_radians();
    let tip = [110.0 - 0.42 * middle.cos(), 110.0 - 0.42 * middle.sin()];
    for (i, layer) in layers.iter().enumerate().take(44).skip(6) {
        let rest = walls(layer, 0);
        let nearest = rest.iter().map(|p| (p[0] - tip[0]).hypot(p[1] - tip[1])).fold(f64::MAX, f64::min);
        assert!(nearest < 0.005, "layer {i}: filament 1's wall passes {nearest} mm from the corner");
    }
}

#[test]
fn painted_tops_and_bottoms_colour_their_shells_as_orca_does() {
    // The 20 mm box 10 mm tall (50 layers, 5 top shells and 3 bottom ones): each painted top or bottom colours its
    // own layer whole, and the shell layers under (over) it one outer wall's width and spacing (0.797 mm) further in
    // on each, as Orca's segmentation colours them; an unpainted one does so in the object's own filament.
    let box_stl = boxes_stl(&[([100., 100., 0.], [120., 120., 10.])]);
    let step = 0.42 + (0.42 - 0.2 * (1.0 - std::f64::consts::FRAC_PI_4));
    // Each filament's extrusions on the object (the prime tower's left out).
    let points = |layer: &[Extrusion], tool: usize| -> Vec<[f64; 2]> {
        layer.iter().filter(|m| m.0 == Some(tool) && m.1 != "Prime tower").flat_map(|m| [m.2, m.3]).collect()
    };
    let inside = |points: &[[f64; 2]], inset: f64| {
        let (xs, ys) = (range(points, 0), range(points, 1));
        let (lo, hi) = (100.0 + inset - 1e-3, 120.0 - inset + 1e-3);
        xs.0 >= lo && xs.1 <= hi && ys.0 >= lo && ys.1 <= hi
    };

    // Its top painted (triangles 2 and 3): the last layer prints in filament 2 alone, the four under it have it
    // inside an inset growing by a step a layer, in filament 1's walls; below them, none.
    let layers = painted_layers(&box_stl, &[2, 3]);
    assert_eq!(layers.len(), 50);
    assert!(points(&layers[49], 0).is_empty() && !points(&layers[49], 1).is_empty());
    for (i, layer) in layers.iter().enumerate().take(49).skip(45) {
        let (mine, painted) = (points(layer, 0), points(layer, 1));
        assert!(!mine.is_empty() && !painted.is_empty(), "layer {i}");
        assert!(
            inside(&painted, (49 - i) as f64 * step),
            "layer {i}: {:?} {:?}",
            range(&painted, 0),
            range(&painted, 1)
        );
    }
    assert!(layers[..45].iter().all(|layer| points(layer, 1).is_empty()));

    // Its bottom painted (triangles 0 and 1): the first layer in filament 2 alone, the two over it inside the inset.
    let layers = painted_layers(&box_stl, &[0, 1]);
    assert!(points(&layers[0], 0).is_empty() && !points(&layers[0], 1).is_empty());
    for (i, layer) in layers.iter().enumerate().take(3).skip(1) {
        let painted = points(layer, 1);
        assert!(!painted.is_empty() && inside(&painted, i as f64 * step), "layer {i}");
    }
    assert!(layers[3..].iter().all(|layer| points(layer, 1).is_empty()));

    // Its front painted, its top and bottom not: those take back the painted side's first and last layers in
    // filament 1, and the shells next to them keep the paint only along the front, as deep as their inset.
    let layers = painted_layers(&box_stl, &[4, 5]);
    for (i, layer) in layers.iter().enumerate() {
        let painted = points(layer, 1);
        let depth = match i {
            0 | 49 => {
                assert!(painted.is_empty(), "layer {i} prints filament 2");
                continue;
            }
            1 | 2 => i as f64 * step,
            45..=48 => (49 - i) as f64 * step,
            _ => continue,
        };
        assert!(!painted.is_empty() && range(&painted, 1).1 <= 100.0 + depth + 1e-3, "layer {i}");
    }
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
    // Heights as the G-code writes them, to the micrometre (a layer of support may lie at 0.474286 mm), next to the
    // layer's own, which its header gives to six figures: above 10 mm, to a tenth of a micrometre, which may round
    // the other way (11.5685 for a layer the moves put at 11.568).
    let at_height =
        |written: f64, z: f64| (written - (z * 1000.0).round() / 1000.0).abs() < 1e-6 || (written - z).abs() < 5.1e-4;
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
                assert!(nz > layer_z || at_height(nz, layer_z), "never below the layer while moving: {}", at());
                assert!(e > 0.0 || nz >= z - 1e-9, "a lifted travel comes down at its end, not on the way: {}", at());
            }
            if e > 0.0 && moves_xy {
                assert!(at_height(nz, layer_z), "prints at the layer's height: {}", at());
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
            assert!(at_height(nz, layer_z + s.z_hop), "lifts by the z-hop: {}", at());
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

/// The first travel between the printer's start and end G-code that comes down on the way (a move across to a lower
/// height that extrudes nothing), and how many travels come down at their end (across, then down): a lifted nozzle
/// travels at its height and comes down where it's going, as Orca 2.5.1 has it (`descend_after_xy`, its #16933).
fn travels_down(gcode: &str) -> (Option<&str>, usize) {
    let body = gcode.split("M981 S1 P20000 ;open spaghetti detector\n").nth(1).expect("the start G-code's end");
    let body = body.split("M981 S0 P20000 ; close spaghetti detector\n").next().expect("the end G-code's start");
    let (mut z, mut across, mut at_end) = (f64::NAN, false, 0);
    for line in body.lines() {
        let code = line.split(';').next().unwrap_or("").trim();
        if !["G0 ", "G1 ", "G2 ", "G3 "].iter().any(|g| code.starts_with(g)) {
            continue;
        }
        let xy = word(code, 'X').is_some() || word(code, 'Y').is_some();
        let travel =
            xy && !word(code, 'E').is_some_and(|e| e > 0.0) && !code.starts_with("G2") && !code.starts_with("G3");
        if let Some(nz) = word(code, 'Z') {
            if nz < z - 1e-9 {
                if travel {
                    return (Some(line), at_end);
                }
                if !xy && across {
                    at_end += 1;
                }
            }
            z = nz;
        }
        across = travel;
    }
    (None, at_end)
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
    // The plate's description: ABS in its colour, with the id Bambu Studio gives Generic ABS.
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert!(info.contains(r##"<filament id="1" tray_info_idx="GFB99" type="ABS" color="#2B6CB0""##), "{info}");
}

/// Settings with Orca's normal supports, as the app asks for them (its "normal" support style).
fn normal_supports() -> Settings {
    setup::read(r#"{"process": {"enable_support": "1", "support_type": "normal(auto)"}}"#).unwrap().settings
}

#[test]
fn normal_supports_leave_bridges_unsupported_as_orca_does() {
    // Orca 2.5's "don't support bridges" (`bridge_no_support`): its normal supports leave out of the overhangs what
    // the layer bridges (`remove_bridges_from_contacts`): its bottom bridges, and its walls where they span a gap
    // straight and are held up at both ends. Its trees don't read the setting.
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let settings = |style: &str, off: &str| {
        let json = format!(
            r#"{{"process": {{"enable_support": "1", "support_type": "normal(auto)", "support_style": "{style}", "bridge_no_support": "{off}"}}}}"#
        );
        setup::read(&json).unwrap().settings
    };
    let volumes = |s: &Settings, name: &str, bytes: &[u8]| -> (f64, f64) {
        let out = slice(&[Input { name, bytes }], s, &options).unwrap();
        let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
        (feature(Role::Support), feature(Role::SupportInterface))
    };
    // Two pillars under a beam: Orca holds the beam up (437 mm³ of support) unless bridges go unsupported, then
    // prints no support at all.
    let bridge: &[u8] = include_bytes!("models/bridge.stl");
    assert!(volumes(&settings("default", "0"), "bridge.stl", bridge).0 > 400.0);
    assert_eq!(volumes(&settings("default", "1"), "bridge.stl", bridge), (0.0, 0.0));
    // The T: the slab's bottom bridges go unsupported; its walls, held up at one end only, keep their support. Orca's
    // support and interface (mm³): 1193.25 and 63.54, snug 1031.57 and 24.79 (1358.6 and 90.7 with bridges held up).
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    for (style, support, interface) in [("default", 1193.25, 63.54), ("snug", 1031.57, 24.79)] {
        let (got, got_interface) = volumes(&settings(style, "1"), "tee.stl", &tee);
        assert!((got - support).abs() < 0.05, "{style}: {got} mm³ of support");
        assert!((got_interface - interface).abs() < 0.05, "{style}: {got_interface} mm³ of interface");
    }
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
fn snug_supports_hug_the_slab_and_take_less_plastic() {
    // The T again, with Orca's snug style of normal supports: they follow the overhang, closed and rounded off,
    // rather than the support grid.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let s =
        setup::read(r#"{"process": {"enable_support": "1", "support_type": "normal(auto)", "support_style": "snug"}}"#)
            .unwrap()
            .settings;
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &s, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers = check_moves(&gcode, &s);
    // Native OrcaSlicer 2.5.0 with these settings (Nov 14): 181 layers, 1221.3 mm³ of support and 74.4 mm³ of
    // interface (on the grid, 1358.6 and 90.7).
    assert_eq!(layers.len(), 181);
    let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()];
    let near = |got: f64, want: f64| (got - want).abs() < want * 0.005;
    assert!(near(feature(Role::Support).volume, 1221.3), "{} mm³ of support", feature(Role::Support).volume);
    assert!(near(feature(Role::SupportInterface).volume, 74.4), "{} mm³", feature(Role::SupportInterface).volume);
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
fn classic_trees_hold_up_a_slab_as_orcas_do() {
    // The T again, with Orca's classic trees in each of their styles. Native OrcaSlicer 2.5.0 (Nov 14): 181 layers
    // each; mm³ of branches and of interface. The trees are Orca's to the nanometre (every branch's every point, by
    // Orca's own log); their loops print 0.4 % less, as chords where Orca fits arcs.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    for (style, support, interface) in
        [("tree_slim", 604.9, 90.7), ("tree_strong", 747.9, 91.3), ("tree_hybrid", 1272.8, 84.5)]
    {
        let json = format!(r#"{{"process": {{"enable_support": "1", "support_style": "{style}"}}}}"#);
        let s = setup::read(&json).unwrap().settings;
        let options = Options { arrange: false, thumbnail: false, ..Options::default() };
        let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &s, &options).unwrap();
        assert!(out.fallbacks.is_empty(), "{style}: {:?}", out.fallbacks);
        let gcode = String::from_utf8(out.gcode).unwrap();
        let layers = check_moves(&gcode, &s);
        assert_eq!(layers.len(), 181, "{style}");
        let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()];
        let near = |got: f64, want: f64, share: f64| (got - want).abs() < want * share;
        let (got, got_interface) = (feature(Role::Support).volume, feature(Role::SupportInterface).volume);
        assert!(near(got, support, 0.01), "{style}: {got} mm³ of branches");
        assert!(near(got_interface, interface, 0.005), "{style}: {got_interface} mm³ of interface");
        // Nothing in the pillar.
        let mut feature = "";
        for line in gcode.lines() {
            if let Some(f) = line.strip_prefix("; FEATURE: ") {
                feature = f;
            } else if let Some(rest) = line.strip_prefix("G1 X").filter(|_| feature.starts_with("Support")) {
                let words: Vec<&str> = rest.split(' ').collect();
                if !words.iter().any(|w| w.starts_with('E') && !w.starts_with("E-")) {
                    continue;
                }
                let x: f64 = words[0].parse().unwrap();
                let y: f64 = words.iter().find_map(|w| w.strip_prefix('Y')).unwrap().parse().unwrap();
                assert!(
                    !(114.8..=125.2).contains(&x) || !(122.8..=133.2).contains(&y),
                    "{style}: support in the pillar at {x} {y}"
                );
            }
        }
    }
}

/// Each support extrusion's height and ends (mm): `Support` and `Support interface` lines, as the G-code gives them.
fn support_lines(gcode: &str) -> Vec<(f64, [f64; 2], [f64; 2])> {
    let (mut z, mut feature, mut at, mut out) = (0.0, "", [0.0, 0.0], Vec::new());
    for line in gcode.lines() {
        if let Some(h) = line.strip_prefix("; Z_HEIGHT: ") {
            z = h.parse().unwrap();
        } else if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        }
        let code = line.split(';').next().unwrap_or("").trim();
        if !code.starts_with("G1 ") {
            continue;
        }
        let to = [word(code, 'X').unwrap_or(at[0]), word(code, 'Y').unwrap_or(at[1])];
        if feature.starts_with("Support") && word(code, 'E').is_some_and(|e| e > 0.0) && to != at {
            out.push((z, at, to));
        }
        at = to;
    }
    out
}

#[test]
fn supports_on_the_plate_only_never_stand_on_the_object() {
    // A table on a block: a slab 30 mm square on a post, over a block 40 mm square and 15 mm tall; and a ledge 16 mm
    // out from a wall, 20 mm up, over a step 10 mm out and 5 mm tall at the wall's foot.
    let table = boxes_stl(&[
        ([108., 108., 0.], [148., 148., 15.]),
        ([126., 126., 15.], [130., 130., 25.]),
        ([113., 113., 25.], [143., 143., 28.]),
    ]);
    let step = boxes_stl(&[
        ([110., 120., 0.], [120., 140., 30.]),
        ([120., 120., 0.], [130., 140., 5.]),
        ([120., 120., 20.], [136., 140., 24.]),
    ]);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let on_plate = |more: &str| {
        let json = format!(r#"{{"process": {{"enable_support": "1", "support_on_build_plate_only": "1"{more}}}}}"#);
        setup::read(&json).unwrap().settings
    };
    let sliced = |model: &[u8], s: &Settings| {
        let out = slice(&[Input { name: "model.stl", bytes: model }], s, &options).unwrap();
        let gcode = String::from_utf8(out.gcode).unwrap();
        check_moves(&gcode, s);
        let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
        (feature(Role::Support), feature(Role::SupportInterface), support_lines(&gcode))
    };
    let near = |got: f64, want: f64, share: f64| (got - want).abs() <= want * share;
    // Each against native OrcaSlicer 2.5.0 with the same settings (Nov 14), in mm³ of support and interface.
    // Normal supports: none under the table's slab, which lies wholly over the block, and under the ledge only
    // beyond the step, from the plate up (Orca: 663.28 and 48.60), with no bottom interface on the step.
    let normal = on_plate(r#", "support_type": "normal(auto)""#);
    assert!(sliced(&table, &normal).2.is_empty(), "normal supports stand on the block");
    let (support, interface, lines) = sliced(&step, &normal);
    assert!(near(support, 663.28, 0.005) && near(interface, 48.60, 0.005), "{support} and {interface} mm³");
    let over_step = |p: [f64; 2]| (120.5..129.5).contains(&p[0]) && (120.5..139.5).contains(&p[1]);
    assert!(lines.iter().all(|&(_, a, b)| !over_step(a) && !over_step(b)), "support over the step");
    // Snug ones the same way (Orca: 512.82 and 32.28).
    let (support, interface, _) =
        sliced(&step, &on_plate(r#", "support_type": "normal(auto)", "support_style": "snug""#));
    assert!(near(support, 512.82, 0.005) && near(interface, 32.28, 0.005), "{support} and {interface} mm³");
    // Organic trees lean out round the block to the plate (Orca: 2066.94 and 55.43, without plate-only 1334.63 and
    // 202.38); slim trees too (Orca: 2519.50 and 50.03, without it 3263.33 and 324.29). Just over the block's top
    // no branch stands on it: those beside it reach a little over its edge, as Orca's do, none further in. With a
    // rectilinear base, organic trees print each branch as a loop round the support's lines (Orca 2.5.1, Nov 15:
    // 2908.09 and 55.43, without plate-only 1859.90 and 202.38).
    for (style, style_json, want_support, want_interface, share) in [
        ("tree_organic", "", 2066.94, 55.43, 0.03),
        ("tree_slim", r#", "support_style": "tree_slim""#, 2519.50, 50.03, 0.01),
        ("rectilinear", r#", "support_base_pattern": "rectilinear""#, 2908.09, 55.43, 0.03),
    ] {
        let (support, interface, lines) =
            sliced(&table, &on_plate(&format!(r#", "support_type": "tree(auto)"{style_json}"#)));
        assert!(near(support, want_support, share), "{style}: {support} mm³ of support");
        assert!(near(interface, want_interface, 0.01), "{style}: {interface} mm³ of interface");
        let over_block = |p: [f64; 2]| (112.0..144.0).contains(&p[0]) && (112.0..144.0).contains(&p[1]);
        for &(z, a, b) in &lines {
            assert!(
                !(15.0..15.7).contains(&z) || !(over_block(a) || over_block(b)),
                "{style}: on the block at {z}: {a:?}"
            );
        }
    }
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
    // After each change the nozzle comes round the tower to the gap in its wall from where Orca's reader of the
    // change G-code says it is: at the plate's left edge (x 0, as the change moves only Y) and the change's last Y.
    // So where it reaches the tower's box lies on the line from there to where it goes in, round the box between.
    let mut routed = 0;
    let body = gcode.split("M981 S0 P20000 ; close spaghetti detector\n").next().unwrap();
    for change in body.split("\nM621 S").skip(1) {
        let (mut read_y, mut points) = (None, Vec::new());
        for line in change.lines() {
            let code = line.split(';').next().unwrap_or("").trim();
            if !code.starts_with("G1 ") {
                continue;
            }
            let (x, y) = (word(code, 'X'), word(code, 'Y'));
            if word(code, 'E').is_some_and(|e| e > 0.0) && (x.is_some() || y.is_some()) {
                break;
            }
            match (x, y) {
                (None, Some(y)) if points.is_empty() => read_y = Some(y),
                (Some(x), Some(y)) => points.push([x, y]),
                _ => {}
            }
        }
        let from = [0.0, read_y.expect("the change's last Y")];
        if let [reach, .., enter, _purge] = points[..] {
            let (a, b) = ([reach[0] - from[0], reach[1] - from[1]], [enter[0] - from[0], enter[1] - from[1]]);
            let off = (a[0] * b[1] - a[1] * b[0]).abs() / b[0].hypot(b[1]);
            assert!(off < 0.002, "{off} mm off the line from {from:?}: {points:?}");
            routed += 1;
        }
    }
    assert!(routed >= 10, "{routed} changes come round the tower");
    // To the tower and back, a lifted nozzle goes over at its height and comes down at the end.
    let (on_the_way, at_end) = travels_down(&gcode);
    assert_eq!(on_the_way, None);
    assert!(at_end >= 40, "{at_end} travels come down at their end");
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

/// The moves of each layer's prime tower: the lines of its `; FEATURE: Prime tower` sections.
fn tower_moves(gcode: &str) -> Vec<Vec<&str>> {
    gcode
        .split("; CHANGE_LAYER\n")
        .skip(1)
        .map(|layer| {
            let mut on = false;
            let mut moves = Vec::new();
            for line in layer.lines() {
                if let Some(feature) = line.strip_prefix("; FEATURE: ") {
                    on = feature == "Prime tower";
                } else if on && line.starts_with('G') {
                    moves.push(line);
                }
            }
            moves
        })
        .collect()
}

/// Where an arc (`G2` clockwise, `G3` counter-clockwise) from (x, y) round the centre (x + i, y + j) to (tx, ty)
/// reaches: its ends, and each axis' extreme its sweep passes.
fn arc_extent(from: [f64; 2], to: [f64; 2], i: f64, j: f64, clockwise: bool) -> [f64; 4] {
    let c = [from[0] + i, from[1] + j];
    let r = i.hypot(j);
    let (a0, a1) = ((from[1] - c[1]).atan2(from[0] - c[0]), (to[1] - c[1]).atan2(to[0] - c[0]));
    let tau = std::f64::consts::TAU;
    // The sweep counter-clockwise from `lo` to `hi`.
    let (lo, hi) = if clockwise { (a1, a0) } else { (a0, a1) };
    let span = (hi - lo).rem_euclid(tau);
    let mut b = [from[0].min(to[0]), from[1].min(to[1]), from[0].max(to[0]), from[1].max(to[1])];
    for (k, q) in [[c[0] + r, c[1]], [c[0], c[1] + r], [c[0] - r, c[1]], [c[0], c[1] - r]].iter().enumerate() {
        if (k as f64 * tau / 4.0 - lo).rem_euclid(tau) <= span {
            b = [b[0].min(q[0]), b[1].min(q[1]), b[2].max(q[0]), b[3].max(q[1])];
        }
    }
    b
}

#[test]
fn the_towers_curved_walls_are_arcs_as_orcas_unless_arc_fitting_is_off() {
    let input = || Input { name: "two-colours.3mf", bytes: TWO_COLOURS };
    let tower = |setup: &str| {
        let settings = setup::read(setup).unwrap().settings;
        let out = slice(&[input()], &settings, &Options::default()).unwrap();
        (settings, String::from_utf8(out.gcode).unwrap())
    };
    let extrudes = |l: &str| word(l, 'E').is_some_and(|e| e > 0.0);
    // The X2D's process fits arcs, and Orca's tower takes them: every layer's filleted wall, and on the first layer
    // its brim, in arcs (`G2`/`G3` with a centre), each sweeping only over the plate.
    let (settings, gcode) = tower(TWO_FILAMENTS);
    let layers = tower_moves(&gcode);
    assert_eq!(layers.len(), 20);
    let arcs: Vec<usize> = layers
        .iter()
        .map(|moves| moves.iter().filter(|l| (l.starts_with("G2 ") || l.starts_with("G3 ")) && extrudes(l)).count())
        .collect();
    assert!(arcs.iter().all(|&n| n >= 16), "{arcs:?}");
    assert!(arcs[0] > 2 * arcs[1], "the first layer's brim in arcs too: {arcs:?}");
    let (mut x, mut y) = (f64::NAN, f64::NAN);
    for line in gcode.lines() {
        let code = line.split(';').next().unwrap_or("").trim();
        let (nx, ny) = (word(code, 'X').unwrap_or(x), word(code, 'Y').unwrap_or(y));
        if (code.starts_with("G2 ") || code.starts_with("G3 ")) && word(code, 'P').is_none() && extrudes(code) {
            let (i, j) = (word(code, 'I').unwrap(), word(code, 'J').unwrap());
            let b = arc_extent([x, y], [nx, ny], i, j, code.starts_with("G2"));
            assert!(b[0] >= 0.0 && b[1] >= 0.0 && b[2] <= settings.bed[0] && b[3] <= settings.bed[1], "{line}: {b:?}");
        }
        if code.starts_with('G') {
            (x, y) = (nx, ny);
        }
    }
    // With arc fitting off, the same walls in straight lines.
    let (_, lines) = tower(
        r##"{"filaments": [{}, {}], "colours": ["#F2754E", "#4F7FC7"], "process": {"enable_arc_fitting": "0"}}"##,
    );
    let off = tower_moves(&lines);
    assert_eq!(off.len(), 20);
    for (k, moves) in off.iter().enumerate() {
        assert!(!moves.iter().any(|l| (l.starts_with("G2 ") || l.starts_with("G3 ")) && extrudes(l)), "layer {k}");
        assert!(moves.iter().filter(|l| l.starts_with("G1 ") && extrudes(l)).count() > arcs[k], "layer {k}");
    }
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

/// The speeds (mm/min) a layer's extrusions slowed down to, as `G1 F…` lines below the fastest speed Orca writes.
fn slowed_speeds(layer: &str) -> Vec<i64> {
    let mut speeds: Vec<i64> = layer
        .lines()
        .filter_map(|l| l.strip_prefix("G1 F").and_then(|f| f.parse::<f64>().ok()))
        .filter(|&f| f.fract() == 0.0 && f < 12000.0 && ![3000.0, 6300.0, 1645.0, 1672.0].contains(&f))
        .map(|f| f as i64)
        .collect();
    speeds.sort_unstable();
    speeds.dedup();
    speeds
}

#[test]
fn two_filaments_without_a_prime_tower_change_where_the_nozzle_is() {
    // Orca 2.5 on the X2D without a prime tower (`enable_prime_tower` off) changes filament where the nozzle is
    // (`GCode::set_extruder`); its G-code for this project's frame and insert as two models is what this holds to.
    let setup = |more: &str| {
        format!(
            r##"{{"process": {{"enable_prime_tower": "0"{more}}}, "filaments": [{{}}, {{}}], "colours": ["#F2754E", "#4F7FC7"]}}"##
        )
    };
    let sliced = |more: &str| {
        let settings = setup::read(&setup(more)).unwrap().settings;
        let out = slice(&[Input { name: "two-colours.3mf", bytes: TWO_COLOURS }], &settings, &Options::default());
        let out = out.unwrap();
        let gcode = String::from_utf8(out.gcode.clone()).unwrap();
        (out, gcode)
    };
    let (out, gcode) = sliced("");
    // No tower: every layer changes filament once, in the printer's own change G-code where the frame ended.
    assert!(!gcode.contains("; FEATURE: Prime tower") && !gcode.contains("; CP TOOLCHANGE START"));
    assert_eq!(out.stats.tool_changes, 20);
    assert_eq!(gcode.matches("\n======== X2D filament_change gcode ==========\n").count(), 20);
    // Each filament on a nozzle of its own: a change into a nozzle that holds no filament yet, or holds it already,
    // flushes nothing, as Orca's 20 changes say.
    assert_eq!(gcode.matches("\nM620.10 A1 F523.843 L0 ").count(), 20);
    assert!(out.stats.filaments.iter().all(|f| f.flush == 0.0));
    // As Orca writes it: the timelapse photo before the change from the frame's filament (on the camera's nozzle), the
    // filament's end G-code, a lift by the z-hop again (straight up, as Orca's writer doesn't know where the nozzle is
    // after the photo), the change, the new filament's temperature and start G-code, and the travel to the insert at
    // the change's height, down to the layer and down once more.
    assert!(
        gcode.contains("; filament end gcode \n\nG1 Z1\n======== X2D filament_change gcode"),
        "no lift after the photo"
    );
    let after = gcode.split("M104 S220 ; set nozzle temperature\n; filament start gcode\n").nth(1).unwrap();
    let travel = &after[..after.find("; FEATURE").unwrap()];
    assert!(travel.contains(" F60000\nG1 Z.2\nG1 Z.2\nG1 E.4 F1800\n"), "{travel}");
    // Orca's estimate is 14.18 min (in one filament ours is 1.2 % short, as here).
    let minutes = out.stats.total_time / 60.0;
    assert!((minutes / 14.18 - 1.0).abs() < 0.015, "{minutes} min");

    // On one nozzle each change flushes, as Orca's volumes for the two say (36.0457 and 52.7589 mm of filament).
    let (one, gcode) = sliced(r#", "filament_map_mode": "Manual", "filament_map": ["1", "1"]"#);
    assert_eq!(gcode.matches("\nM620.10 A1 F523.843 L36.0457 ").count(), 10);
    assert_eq!(gcode.matches("\nM620.10 A1 F523.843 L52.7589 ").count(), 10);
    // The nozzle holds one retraction for both filaments, as Orca's shared extruders do: the photo's 0.4 mm topped up
    // to the change's 2 mm, which the new filament then pushes back.
    assert!(gcode.contains("M625\nG1 E-1.6 F1800\n; filament end gcode \n\nG1 Z1 F60000\n"), "no top-up");
    assert!(gcode.contains("\nG1 Z.2\nG1 Z.2\nG1 E2 F1800\n"), "no push-back from the shared nozzle");
    // Orca's cooling slows each filament on a short layer apart, the second it comes to once more by about its other
    // moves' time: two speeds a layer, as Orca's.
    let layers: Vec<&str> = gcode.split("; CHANGE_LAYER\n").skip(1).collect();
    for (i, layer) in layers.iter().enumerate().take(11).skip(3) {
        assert_eq!(slowed_speeds(layer).len(), 2, "layer {i}: {:?}", slowed_speeds(layer));
    }
    // Orca's estimate is 32.12 min.
    let minutes = one.stats.total_time / 60.0;
    assert!((minutes / 32.12 - 1.0).abs() < 0.01, "{minutes} min");
}

/// A project of one object, "two parts": two tetrahedra 10 mm on a side, the second 20 mm right of the first (or
/// `overlap` mm less, into it), the first part in filament 1 and the second in filament 2.
fn two_part_object(overlap: f32) -> Vec<u8> {
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
        cube(20.0 - overlap)
    );
    let settings = r#"<config><object id="3"><metadata key="name" value="two parts"/><part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part><part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part></object></config>"#;
    w.add("3D/3dmodel.model", model.as_bytes(), 6);
    w.add("Metadata/model_settings.config", settings.as_bytes(), 6);
    w.finish()
}

#[test]
fn parts_of_one_object_print_in_their_filaments() {
    let file = two_part_object(0.0);
    let input = || Input { name: "parts.3mf", bytes: &file };
    let two = setup::read(TWO_FILAMENTS).unwrap().settings;
    let out = slice(&[input()], &two, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    // Each part in its filament, over the prime tower, as Orca prints an object of two regions.
    assert!(out.stats.filaments.iter().all(|f| f.volume > 0.0), "{:?}", out.stats.filaments);
    assert!(out.stats.tool_changes > 0);
    let walls: Vec<Option<usize>> =
        tools_and_labels(&gcode).windows(2).filter(|w| w[0].2 == "; FEATURE: Outer wall").map(|w| w[1].0).collect();
    assert!(walls.contains(&Some(0)) && walls.contains(&Some(1)), "{walls:?}");
    // One object, with one label and one name, whichever filament prints it.
    assert!(gcode.contains("\n; model label id: 1\n"));
    assert!(tools_and_labels(&gcode).iter().all(|(_, label, _)| label.is_none_or(|l| l == 1)));
    assert!(gcode.contains("; printing object two parts id:0 copy 0"));
    assert!(!gcode.contains(" id:1 copy 0"));
    let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
    assert_eq!(info.matches("<object identify_id=").count(), 1, "{info}");
    // With one filament, all of it prints in that one, as Orca prints it.
    let one = slice(&[input()], &Settings::default(), &Options::default()).unwrap();
    assert_eq!(one.stats.tool_changes, 0);
}

const T_PARTS: &[u8] = include_bytes!("models/t-parts.3mf");
const TEES: &[u8] = include_bytes!("models/tees.3mf");

/// Each layer's first filament printing anything but the tower, and the filaments its support prints in.
fn layer_supports(gcode: &str) -> Vec<(Option<usize>, Vec<usize>)> {
    let (mut layers, mut feature) = (Vec::new(), "");
    for (tool, _, line) in tools_and_labels(gcode) {
        if line.starts_with("; CHANGE_LAYER") {
            layers.push((None, Vec::new()));
        }
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        }
        let extrudes =
            ["G1 ", "G2 ", "G3 "].iter().any(|g| line.starts_with(g)) && line.contains(" E") && !line.contains(" E-");
        if let (Some((first, support)), Some(tool)) = (layers.last_mut(), tool)
            && extrudes
            && feature != "Custom"
            && feature != "Prime tower"
        {
            first.get_or_insert(tool);
            if feature.starts_with("Support") && !support.contains(&tool) {
                support.push(tool);
            }
        }
    }
    layers.into_iter().filter(|(_, support)| !support.is_empty()).collect()
}

/// Hybrid tree supports with the tower where the app puts it, in `filaments` filaments of Orca's colours.
fn trees_in(filaments: usize) -> Settings {
    let colours = ["#F2754E", "#4F7FC7", "#5FB36B"][..filaments].iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>();
    let setup = format!(
        r#"{{"process": {{"enable_support": "1", "support_type": "tree(auto)", "support_style": "tree_hybrid",
        "wipe_tower_x": ["211"], "wipe_tower_y": ["196"]}}, "filaments": [{}], "colours": [{}]}}"#,
        vec!["{}"; filaments].join(", "),
        colours.join(", ")
    );
    setup::read(&setup).unwrap().settings
}

#[test]
fn supports_for_an_object_in_parts_print_in_the_filament_each_layer_starts_with() {
    // Orca works the supports out for the whole object, and prints them in whichever filament each layer starts
    // with, not one of their own ("don't care", `support_filament` 0), so they add no filament change.
    let out = slice(&[Input { name: "t-parts.3mf", bytes: T_PARTS }], &trees_in(2), &Options::default()).unwrap();
    // Orca 2.5 (the X2D's presets): 125 layers, 1844.84 mm³ of support and 76.48 of interface, and 5490.57 of tower.
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    assert_eq!(out.stats.layers, 125);
    assert!((volume(Role::Support) / 1844.84 - 1.0).abs() < 1e-3, "{}", volume(Role::Support));
    assert!((volume(Role::SupportInterface) / 76.479 - 1.0).abs() < 1e-3, "{}", volume(Role::SupportInterface));
    assert!((volume(Role::PrimeTower) / 5490.567 - 1.0).abs() < 1e-4, "{}", volume(Role::PrimeTower));
    // Each layer's support in the filament the layer starts with, which alternates as Orca's order does.
    let layers = layer_supports(&String::from_utf8(out.gcode).unwrap());
    assert!(layers.len() > 90, "{} layers with support", layers.len());
    assert!(layers.iter().all(|(first, support)| support.len() == 1 && first == &Some(support[0])), "{layers:?}");
    assert!(layers.iter().any(|(_, s)| s[0] == 0) && layers.iter().any(|(_, s)| s[0] == 1));
}

#[test]
fn normal_supports_in_several_filaments_print_on_the_objects_layers() {
    // A T in filament 1 and a ledge over a step in filament 2, the tower where the app puts it. With a prime tower
    // Orca turns the support's own layer heights off (`independent_support_layer_height`): normal supports then print
    // on the objects' layers, their gaps rounded to whole layers (`synchronize_layers`), and so do one filament's
    // where a project turns them off.
    let tee = boxes_stl(&[([70., 123., 0.], [80., 133., 20.]), ([55., 123., 20.], [95., 133., 25.])]);
    let step = boxes_stl(&[
        ([130., 120., 0.], [140., 140., 30.]),
        ([140., 120., 0.], [150., 140., 5.]),
        ([140., 120., 20.], [156., 140., 24.]),
    ]);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let volume = |out: &spaghetti_slicer::Output, role: Role| {
        out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume
    };
    let near = |got: f64, want: f64, share: f64| (got - want).abs() <= want * share;
    let on_layers = |out: &spaghetti_slicer::Output| {
        let lines = support_lines(&String::from_utf8(out.gcode.clone()).unwrap());
        !lines.is_empty() && lines.iter().all(|&(z, _, _)| ((z / 0.2) - (z / 0.2).round()).abs() < 1e-6)
    };
    let two = setup::read(
        r##"{"process": {"enable_support": "1", "support_type": "normal(auto)", "wipe_tower_x": ["211"],
        "wipe_tower_y": ["196"]}, "filaments": [{}, {}], "colours": ["#F2754E", "#4F7FC7"]}"##,
    )
    .unwrap()
    .settings;
    let mut plate = spaghetti_slicer::Plate::default();
    plate.add_with_filament(&Input { name: "tee.stl", bytes: &tee }, Some(0)).unwrap();
    plate.add_with_filament(&Input { name: "step.stl", bytes: &step }, Some(1)).unwrap();
    let out = plate.slice(&two, &options).unwrap();
    // Native OrcaSlicer 2.5.0 (Nov 14): 150 layers, 2682.87 mm³ of support, 179.96 of interface and 6891.08 of tower.
    assert_eq!(out.stats.layers, 150);
    let (support, interface) = (volume(&out, Role::Support), volume(&out, Role::SupportInterface));
    assert!(near(support, 2682.87, 1e-3) && near(interface, 179.96, 1e-3), "{support} and {interface} mm³");
    assert!(near(volume(&out, Role::PrimeTower), 6891.08, 1e-4), "{}", volume(&out, Role::PrimeTower));
    assert!(on_layers(&out), "support between the objects' layers");
    // One filament with the support's own layer heights off, as a project may have them (Orca: 1429.38 and 67.90).
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let one = setup::read(
        r#"{"process": {"enable_support": "1", "support_type": "normal(auto)", "independent_support_layer_height": "0"}}"#,
    )
    .unwrap()
    .settings;
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &one, &options).unwrap();
    let (support, interface) = (volume(&out, Role::Support), volume(&out, Role::SupportInterface));
    assert!(near(support, 1429.38, 1e-3) && near(interface, 67.90, 1e-3), "{support} and {interface} mm³");
    assert!(on_layers(&out), "support between the object's layers");
}

#[test]
fn supports_in_filaments_of_their_own_print_as_orcas_do() {
    // A T in filament 1 of two, the tower where the app puts it, its support's interface (and base) in filament 2.
    // Where the interface has a filament of its own, Orca prints the interface layer under each contact as base
    // interface: in the base's filament, at the interface's spacing (`num_top_base_interface_layers`).
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let slice_with = |process: &str, filaments: usize| {
        let setup = format!(
            r#"{{"process": {{"enable_support": "1", "wipe_tower_x": ["211"], "wipe_tower_y": ["196"], {process}}},
            "filaments": [{}], "colours": [{}]}}"#,
            vec!["{}"; filaments].join(", "),
            ["\"#F2754E\"", "\"#4F7FC7\""][..filaments].join(", ")
        );
        let settings = setup::read(&setup).unwrap().settings;
        let mut plate = spaghetti_slicer::Plate::default();
        plate.add_with_filament(&Input { name: "tee.stl", bytes: &tee }, Some(0)).unwrap();
        plate.slice(&settings, &options).unwrap()
    };
    let volume = |out: &spaghetti_slicer::Output, role: Role| {
        out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume
    };
    let near = |got: f64, want: f64, share: f64| (got - want).abs() <= want * share;
    // Native OrcaSlicer 2.5.0 (Nov 15): support, interface and tower (mm³), and its 125 layers.
    let cases = [
        (r#""support_type": "normal(auto)", "support_interface_filament": "2""#, 1463.33, 33.95, 2141.72, 1e-3),
        (
            r#""support_type": "normal(auto)", "support_filament": "2", "support_interface_filament": "2""#,
            1429.38,
            67.90,
            5490.57,
            1e-3,
        ),
        (r#""support_type": "normal(auto)", "support_filament": "2""#, 1429.38, 67.90, 5348.23, 1e-3),
        (
            r#""support_type": "normal(auto)", "support_style": "snug", "support_interface_filament": "2""#,
            1313.29,
            27.82,
            2141.72,
            1e-3,
        ),
        // Organic trees come as close as they do in one filament.
        (r#""support_type": "tree(auto)", "support_interface_filament": "2""#, 793.46, 27.74, 2141.72, 0.025),
        (
            r#""support_type": "tree(auto)", "support_style": "tree_hybrid", "support_interface_filament": "2""#,
            1369.04,
            29.79,
            2141.72,
            1e-3,
        ),
    ];
    for (process, support, interface, tower, share) in cases {
        let out = slice_with(process, 2);
        assert_eq!(out.stats.layers, 125, "{process}");
        let (s, i, t) =
            (volume(&out, Role::Support), volume(&out, Role::SupportInterface), volume(&out, Role::PrimeTower));
        assert!(near(s, support, share) && near(i, interface, 1e-3), "{process}: {s} and {i} mm³");
        assert!(near(t, tower, 1e-4), "{process}: {t} mm³ of tower");
    }
    // The interface in filament 2 and the base in "don't care" filament: the base in the T's (the first, which the
    // file starts with), the interface in filament 2.
    let out = slice_with(r#""support_type": "normal(auto)", "support_interface_filament": "2""#, 2);
    let gcode = String::from_utf8(out.gcode).unwrap();
    let (mut feature, mut tools) = ("", std::collections::BTreeSet::new());
    for (tool, _, line) in tools_and_labels(&gcode) {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        }
        if line.starts_with("G1 ") && line.contains(" E") && !line.contains(" E-") && feature.starts_with("Support") {
            tools.insert((feature.to_string(), tool.unwrap_or(0)));
        }
    }
    let want = [("Support".to_string(), 0), ("Support interface".to_string(), 1)];
    assert_eq!(tools.into_iter().collect::<Vec<_>>(), want);
    // In one filament, an interface in filament 1 still makes base interface layers (Orca: 1403.94 and 45.37).
    let out = slice_with(r#""support_type": "normal(auto)", "support_interface_filament": "1""#, 1);
    let (s, i) = (volume(&out, Role::Support), volume(&out, Role::SupportInterface));
    assert!(near(s, 1403.94, 1e-3) && near(i, 45.37, 1e-3), "{s} and {i} mm³");
}

/// Each layer's main direction (degrees, 0 to 179, by length) of the lines of `feature`, from the bottom up.
fn feature_directions(gcode: &str, feature: &str) -> Vec<i64> {
    let mut out: Vec<std::collections::BTreeMap<i64, f64>> = Vec::new();
    let (mut current, mut layer) = ("", None::<usize>);
    let (mut x, mut y) = (f64::NAN, f64::NAN);
    for line in gcode.lines() {
        if line.starts_with("; CHANGE_LAYER") {
            layer = None;
        }
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            current = f;
        }
        if !(line.starts_with("G1 ") || line.starts_with("G0 ")) {
            continue;
        }
        let code = line.split(';').next().unwrap_or("");
        let value =
            |axis: char| code.split_whitespace().find_map(|w| w.strip_prefix(axis).and_then(|v| v.parse::<f64>().ok()));
        let (nx, ny) = (value('X').unwrap_or(x), value('Y').unwrap_or(y));
        if current == feature && value('E').is_some_and(|e| e > 0.0) && (nx, ny) != (x, y) && x.is_finite() {
            let k = *layer.get_or_insert_with(|| {
                out.push(Default::default());
                out.len() - 1
            });
            let angle = (ny - y).atan2(nx - x).to_degrees().rem_euclid(180.0).round() as i64 % 180;
            *out[k].entry(angle).or_default() += (nx - x).hypot(ny - y);
        }
        (x, y) = (nx, ny);
    }
    out.iter().map(|d| d.iter().max_by(|a, b| a.1.total_cmp(b.1)).map_or(-1, |(a, _)| *a)).collect()
}

#[test]
fn support_materials_interfaces_print_as_orcas_do() {
    // A support material's interface as Bambu Studio sets it: dense (`support_interface_spacing` 0), in straight
    // lines turned an eighth of a turn either way from one interface layer to the next (`rectilinear_interlaced`).
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let slice_with = |process: &str| {
        let setup = format!(r#"{{"process": {{"enable_support": "1", {process}}}}}"#);
        let settings = setup::read(&setup).unwrap().settings;
        slice(&[Input { name: "tee.stl", bytes: &tee }], &settings, &options).unwrap()
    };
    let interface = |out: &spaghetti_slicer::Output| {
        out.stats.features[Role::ALL.iter().position(|&r| r == Role::SupportInterface).unwrap()].volume
    };
    // Native OrcaSlicer 2.5.0 (Nov 15): the interface (mm³), and its two layers' lines at 45° and then 135°.
    let interlaced = r#""support_interface_pattern": "rectilinear_interlaced", "support_interface_spacing": "0""#;
    for (style, want) in [
        (r#""support_type": "normal(auto)""#, 189.51),
        (r#""support_type": "normal(auto)", "support_style": "snug""#, 153.35),
        (r#""support_type": "tree(auto)""#, 112.60),
        (r#""support_type": "tree(auto)", "support_style": "tree_hybrid""#, 175.97),
    ] {
        let out = slice_with(&format!("{style}, {interlaced}"));
        let got = interface(&out);
        assert!((got - want).abs() <= want * 1e-3, "{style}: {got} mm³ of interface");
        let directions = feature_directions(&String::from_utf8(out.gcode).unwrap(), "Support interface");
        assert_eq!(directions, [45, 135], "{style}");
    }
    // Dense interfaces in the auto pattern print in straight lines too, a quarter turn from the columns' (Orca:
    // 185.89 mm³).
    let out = slice_with(r#""support_type": "normal(auto)", "support_interface_spacing": "0""#);
    assert!((interface(&out) - 185.89).abs() <= 0.19, "{} mm³ of interface", interface(&out));
}

#[test]
fn supports_without_a_gap_hold_the_object_as_orcas_do() {
    // A support material's interface meets the object without a gap (`support_top_z_distance` 0): the contact is the
    // object's layer right under the overhang, and the overhang prints as a bottom surface on it, not as a bridge.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let setup = r#"{"process": {"enable_support": "1", "support_type": "normal(auto)", "support_top_z_distance": "0",
        "support_interface_spacing": "0", "support_interface_pattern": "rectilinear_interlaced"}}"#;
    let settings = setup::read(setup).unwrap().settings;
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &settings, &options).unwrap();
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    // Native OrcaSlicer 2.5.0 (Nov 15), mm³.
    for (role, orca) in [(Role::Support, 1377.00), (Role::SupportInterface, 165.66), (Role::BottomSurface, 62.13)] {
        assert!((volume(role) / orca - 1.0).abs() < 1.5e-3, "{role:?}: {} mm³", volume(role));
    }
    assert_eq!(volume(Role::Bridge), 0.0);
    let gcode = String::from_utf8(out.gcode).unwrap();
    assert_eq!(feature_directions(&gcode, "Support interface"), [45, 135]);
    // Its two layers are the object's last two under the overhang, which starts at 20 mm.
    let layers: Vec<&str> = gcode
        .split("; Z_HEIGHT: ")
        .skip(1)
        .filter(|layer| layer.contains("; FEATURE: Support interface"))
        .map(|layer| layer.lines().next().unwrap())
        .collect();
    assert_eq!(layers, ["19.8", "20"]);

    // Classic trees too, here hybrid ones (Orca: 1286.15 mm³ of support, 175.27 of interface).
    let trees = setup.replace("normal(auto)", "tree(auto)");
    let hybrid = setup::read(
        &trees.replace(r#""support_top_z_distance""#, r#""support_style": "tree_hybrid", "support_top_z_distance""#),
    )
    .unwrap()
    .settings;
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &hybrid, &options).unwrap();
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    for (role, orca) in [(Role::Support, 1286.15), (Role::SupportInterface, 175.27), (Role::BottomSurface, 62.13)] {
        assert!((volume(role) / orca - 1.0).abs() < 1.5e-3, "hybrid {role:?}: {} mm³", volume(role));
    }
    assert_eq!(feature_directions(&String::from_utf8(out.gcode).unwrap(), "Support interface"), [45, 135]);

    // And organic trees (Orca: 759.13 mm³ of support, 112.60 of interface): the same interface, under trees 1.2 %
    // heavier than Orca's (1.9 % with a gap).
    let organic = setup::read(&trees).unwrap().settings;
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &organic, &options).unwrap();
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    assert!(
        (volume(Role::SupportInterface) - 112.60).abs() < 0.05,
        "organic interface: {}",
        volume(Role::SupportInterface)
    );
    assert!((volume(Role::Support) / 759.13 - 1.0).abs() < 0.015, "organic support: {}", volume(Role::Support));
    assert_eq!(feature_directions(&String::from_utf8(out.gcode).unwrap(), "Support interface"), [45, 135]);
}

/// A closed solid of these triangles, as an ASCII STL.
fn solid_stl(vertices: &[[f32; 3]], faces: &[[usize; 3]]) -> Vec<u8> {
    let mut out = String::from("solid mesh\n");
    for face in faces {
        out.push_str(" facet normal 0 0 0\n  outer loop\n");
        for &v in face {
            let [x, y, z] = vertices[v];
            out.push_str(&format!("   vertex {x} {y} {z}\n"));
        }
        out.push_str("  endloop\n endfacet\n");
    }
    out.push_str("endsolid mesh\n");
    out.into_bytes()
}

#[test]
fn organic_trees_without_a_gap_end_in_roofs() {
    // A block whose side leans out 70° from upright for 6 mm over a 4 mm foot: each layer overhangs the one below by
    // a band 0.2 mm wide, too thin for a roof of its own. Without a gap, Orca forces every tip into a roof
    // (`force_tip_to_roof`): a circle of the tip's radius on the layer under the overhang and the next one down, the
    // tip a layer lower still. With a gap, the tips print as base, with no interface at all.
    let lean = 2.0 * (70f32).to_radians().tan() * 3.0;
    let vertices = [
        [110., 110., 0.],
        [120., 110., 0.],
        [120., 130., 0.],
        [110., 130., 0.],
        [110., 110., 4.],
        [120., 110., 4.],
        [120., 130., 4.],
        [110., 130., 4.],
        [110., 110., 10.],
        [120. + lean, 110., 10.],
        [120. + lean, 130., 10.],
        [110., 130., 10.],
    ];
    let faces = [
        [0, 2, 1],
        [0, 3, 2],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
        [4, 5, 9],
        [4, 9, 8],
        [5, 6, 10],
        [5, 10, 9],
        [6, 7, 11],
        [6, 11, 10],
        [7, 4, 8],
        [7, 8, 11],
        [8, 9, 10],
        [8, 10, 11],
    ];
    let stl = solid_stl(&vertices, &faces);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let organic = r#"{"process": {"enable_support": "1", "support_type": "tree(auto)", "support_style": "tree_organic",
        "support_interface_spacing": "0", "support_interface_pattern": "rectilinear_interlaced"GAP}}"#;
    let run = |gap: &str| {
        let settings = setup::read(&organic.replace("GAP", gap)).unwrap().settings;
        slice(&[Input { name: "lean.stl", bytes: &stl }], &settings, &options).unwrap()
    };
    let out = run(r#", "support_top_z_distance": "0""#);
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    // Native OrcaSlicer 2.5.0 (Nov 15): 677.46 mm³ of support and 93.31 of interface, on the 30 layers from 4 mm to
    // 9.8 mm, each turned as ours. Ours prints as much plastic, a little less of it as interface.
    assert!((volume(Role::Support) / 677.46 - 1.0).abs() < 0.005, "support: {}", volume(Role::Support));
    assert!(
        (volume(Role::SupportInterface) / 93.31 - 1.0).abs() < 0.09,
        "interface: {}",
        volume(Role::SupportInterface)
    );
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers: Vec<&str> = gcode
        .split("; Z_HEIGHT: ")
        .skip(1)
        .filter(|layer| layer.contains("; FEATURE: Support interface"))
        .map(|layer| layer.lines().next().unwrap())
        .collect();
    assert_eq!(layers.len(), 30, "{layers:?}");
    assert_eq!((layers[0], layers[29]), ("4", "9.8"));

    let out = run("");
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    // Orca: 730.93 mm³ of support, no interface.
    assert_eq!(volume(Role::SupportInterface), 0.0);
    assert!((volume(Role::Support) / 730.93 - 1.0).abs() < 0.015, "with a gap: {}", volume(Role::Support));
}

#[test]
fn contacts_without_interface_layers_print_as_base() {
    // Without interface layers on its side, a contact is base support to Orca, merged into the base beside it
    // (`generate_support_toolpaths`): on the step, the support standing on its lower step without bottom interfaces,
    // and the one under its arm without top ones, come to Orca's to the line, in the grid and snug styles.
    let step = boxes_stl(&[
        ([110., 120., 0.], [120., 140., 30.]),
        ([120., 120., 0.], [130., 140., 5.]),
        ([120., 120., 20.], [136., 140., 24.]),
    ]);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    // Native OrcaSlicer 2.5.0 (Nov 15): mm³ of support and of interface.
    for (style, side, orca) in [
        ("default", "bottom", (1204.70, 98.24)),
        ("snug", "bottom", (947.59, 76.12)),
        ("default", "top", (1224.55, 43.99)),
        ("snug", "top", (960.92, 45.02)),
    ] {
        let setup = format!(
            r#"{{"process": {{"enable_support": "1", "support_type": "normal(auto)", "support_style": "{style}",
                "support_interface_{side}_layers": "0"}}}}"#
        );
        let settings = setup::read(&setup).unwrap().settings;
        let out = slice(&[Input { name: "step.stl", bytes: &step }], &settings, &options).unwrap();
        let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
        let (support, interface) = (volume(Role::Support), volume(Role::SupportInterface));
        assert!((support - orca.0).abs() < 0.05, "{style} {side}: {support} mm³ of support");
        assert!((interface - orca.1).abs() < 0.05, "{style} {side}: {interface} mm³ of interface");
    }
}

#[test]
fn a_filament_change_flushes_into_the_supports_first() {
    // Three Ts in three filaments: two share a nozzle, and each layer's change between them flushes into the layer's
    // supports (`flush_into_support`), which then print right after the change in the filament flushed into, as
    // Orca's do: on every layer above the first, in a filament after the layer's first. On the first, the flush goes
    // into one T's support, and the others print in the layer's first filament.
    let out = slice(&[Input { name: "tees.3mf", bytes: TEES }], &trees_in(3), &Options::default()).unwrap();
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    // Orca 2.5: 4011.14 mm³ of support, 11204.76 of tower, and each filament's use.
    assert!((volume(Role::Support) / 4011.143 - 1.0).abs() < 1e-3, "{}", volume(Role::Support));
    assert!((volume(Role::PrimeTower) / 11204.756 - 1.0).abs() < 1e-4, "{}", volume(Role::PrimeTower));
    let used: Vec<f64> = out.stats.filaments.iter().map(|f| f.volume).collect();
    for (ours, orca) in used.iter().zip([6356.831, 14935.225, 12138.624]) {
        assert!((ours / orca - 1.0).abs() < 3e-3, "{used:?}");
    }
    let layers = layer_supports(&String::from_utf8(out.gcode).unwrap());
    assert_eq!(layers.len(), 99);
    assert!(layers[1..].iter().all(|(first, support)| support.len() == 1 && Some(support[0]) != *first), "{layers:?}");
    assert_eq!(layers[0], (Some(0), vec![0, 2]));
}

#[test]
fn a_later_part_cuts_into_the_one_before() {
    // The second part reaches 7 mm into the first, a third of the first's volume: the first gives way there, as Orca
    // has the later part win, and the second prints all of itself.
    let two = setup::read(TWO_FILAMENTS).unwrap().settings;
    let apart = slice(&[Input { name: "parts.3mf", bytes: &two_part_object(0.0) }], &two, &Options::default());
    let into = slice(&[Input { name: "parts.3mf", bytes: &two_part_object(17.0) }], &two, &Options::default());
    let (apart, into) = (apart.unwrap().stats, into.unwrap().stats);
    let printed = |s: &spaghetti_slicer::Stats, k: usize| {
        let f = &s.filaments[k];
        f.volume - f.flush - f.tower
    };
    assert!(printed(&into, 0) < printed(&apart, 0) * 0.9, "{} vs {}", printed(&into, 0), printed(&apart, 0));
    assert!((printed(&into, 1) - printed(&apart, 1)).abs() < printed(&apart, 1) * 0.02);
}

#[test]
fn parts_added_one_by_one_make_one_object() {
    // A slab in filament 1 and a cube sunk 3 mm into its top in filament 2, added as the parts of one object, then a
    // block of its own: the cube stays where it is (not dropped onto the bed on its own), and the plate has two
    // objects, the first in both filaments.
    let slab = boxes_stl(&[([0.0, 0.0, 0.0], [20.0, 20.0, 5.0])]);
    let cube = boxes_stl(&[([5.0, 5.0, 2.0], [15.0, 15.0, 12.0])]);
    let block = boxes_stl(&[([40.0, 0.0, 0.0], [50.0, 10.0, 4.0])]);
    let two = setup::read(TWO_FILAMENTS).unwrap().settings;
    let mut plate = spaghetti_slicer::Plate::default();
    plate.add_part(&Input { name: "slab.stl", bytes: &slab }, 0, true).unwrap();
    plate.add_part(&Input { name: "cube.stl", bytes: &cube }, 1, false).unwrap();
    plate.add_part(&Input { name: "block.stl", bytes: &block }, 1, true).unwrap();
    let out = plate.slice(&two, &Options::default()).unwrap();
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    assert!(gcode.contains("\n; max_z_height: 12.00\n"));
    assert!(gcode.contains("\n; model label id: 1,2\n"));
    let labelled: Vec<(Option<usize>, Option<u32>)> = tools_and_labels(&gcode)
        .windows(2)
        .filter(|w| w[0].2 == "; FEATURE: Outer wall")
        .map(|w| (w[1].0, w[1].1))
        .collect();
    for want in [(Some(0), Some(1)), (Some(1), Some(1)), (Some(1), Some(2))] {
        assert!(labelled.contains(&want), "no outer wall in T{:?} of object {:?}", want.0, want.1);
    }
    assert!(!labelled.contains(&(Some(0), Some(2))));
}

#[test]
fn seams_hide_where_an_objects_parts_meet() {
    // A slab in filament 1 and a cube in filament 2 reaching 5 mm into its back, as parts of one object, with seams at
    // the back: each part's outer walls start in the join, where the other part covers them (Orca's points embedded
    // in the object's slice come first), not at the back where back seams would go.
    let slab = boxes_stl(&[([100.0, 100.0, 0.0], [120.0, 120.0, 4.0])]);
    let cube = boxes_stl(&[([105.0, 115.0, 0.0], [115.0, 125.0, 4.0])]);
    let setup = r##"{"filaments": [{}, {}], "colours": ["#F2754E", "#4F7FC7"], "process": {"seam_position": "back"}}"##;
    let settings = setup::read(setup).unwrap().settings;
    let mut plate = spaghetti_slicer::Plate::default();
    plate.add_part(&Input { name: "slab.stl", bytes: &slab }, 0, true).unwrap();
    plate.add_part(&Input { name: "cube.stl", bytes: &cube }, 1, false).unwrap();
    let out = plate.slice(&settings, &Options { arrange: false, ..Options::default() }).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    // Where each outer wall starts, with its tool.
    let (mut at, mut feature, mut begun) = ((0.0f64, 0.0f64), "", false);
    let mut starts: Vec<(Option<usize>, f64)> = Vec::new();
    for (tool, _, line) in tools_and_labels(&gcode) {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            (feature, begun) = (f, false);
            continue;
        }
        if !line.starts_with("G1 ") {
            continue;
        }
        let word = |c: char| line.split_whitespace().find_map(|w| w.strip_prefix(c)?.parse::<f64>().ok());
        let to = (word('X').unwrap_or(at.0), word('Y').unwrap_or(at.1));
        if feature == "Outer wall" && !begun && word('E').is_some_and(|e| e > 0.0) && to != at {
            starts.push((tool, at.1));
            begun = true;
        }
        at = to;
    }
    assert!(starts.iter().any(|s| s.0 == Some(0)) && starts.iter().any(|s| s.0 == Some(1)), "{starts:?}");
    // The join runs at y = 115 to 120: the slab's walls start in its notch there, the cube's on its front side.
    for (tool, y) in starts {
        assert!(y < 116.0, "an outer wall in T{tool:?} starts at y = {y}");
    }
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

/// 15 mm blocks, each `heights[k]` mm tall in filament `k` (in `colours`), four to a row from (`x0`, 20) 30 mm apart,
/// sliced where they stand with the prime tower at (150, 90).
fn blocks_in_filaments(x0: f32, colours: &[&str], heights: &[f32]) -> spaghetti_slicer::Output {
    let filaments = vec!["{}"; colours.len()].join(", ");
    let colours = colours.iter().map(|c| format!("\"{c}\"")).collect::<Vec<_>>().join(", ");
    let setup = format!(
        r#"{{"filaments": [{filaments}], "colours": [{colours}],
            "process": {{"wipe_tower_x": ["150"], "wipe_tower_y": ["90"]}}}}"#
    );
    let settings = setup::read(&setup).unwrap().settings;
    let mut plate = spaghetti_slicer::Plate::default();
    for (k, &h) in heights.iter().enumerate() {
        let (x, y) = (x0 + 30.0 * (k % 4) as f32, 20.0 + 30.0 * (k / 4) as f32);
        let block = boxes_stl(&[([x, y, 0.0], [x + 15.0, y + 15.0, h])]);
        plate.add_with_filament(&Input { name: &format!("block-{k}.stl"), bytes: &block }, Some(k)).unwrap();
    }
    plate.slice(&settings, &Options { arrange: false, ..Options::default() }).unwrap()
}

/// A plate of blocks native Orca 2.5 sliced alike (`blocks_in_filaments`), and what it made of it: its filament map,
/// tool changes and the grams of each filament.
struct OrcaPlate {
    x0: f32,
    colours: &'static [&'static str],
    heights: &'static [f32],
    map: &'static str,
    changes: usize,
    grams: &'static [f64],
}

#[test]
fn several_filaments_go_on_the_nozzles_as_orcas_grouping_puts_them() {
    let plates = [
        // Eight filaments: the first column stands at x = 20 mm, where the right nozzle can't reach (it prints from
        // 20.5 mm), so its two stay on the left; each nozzle takes four, one 4-slot AMS's worth; and of what is left
        // Orca's flush and loading time pick this.
        OrcaPlate {
            x0: 20.0,
            colours: &["#F7D4E0", "#8E9089", "#5B3A29", "#FFE600", "#00AE42", "#000000", "#C12E1F", "#F2754E"],
            heights: &[10.0, 6.0, 4.0, 10.0, 8.0, 6.0, 4.0, 4.0],
            map: "1 1 2 2 1 2 2 1",
            changes: 210,
            grams: &[8.45, 6.01, 7.99, 12.01, 4.69, 5.55, 6.56, 3.98],
        },
        // Clear of that strip, the flush and loading time alone decide.
        OrcaPlate {
            x0: 80.0,
            colours: &["#FFFFFF", "#000000", "#4F7FC7", "#C12E1F"],
            heights: &[4.0, 10.0, 4.0, 6.0],
            map: "1 1 1 2",
            changes: 70,
            grams: &[4.48, 5.34, 3.60, 1.85],
        },
        OrcaPlate {
            x0: 80.0,
            colours: &["#F7D4E0", "#F2754E", "#FFE600"],
            heights: &[10.0, 6.0, 4.0],
            map: "2 1 1",
            changes: 50,
            grams: &[2.57, 3.46, 2.65],
        },
    ];
    for p in plates {
        let out = blocks_in_filaments(p.x0, p.colours, p.heights);
        let info = String::from_utf8(entry(&out.file, "Metadata/slice_info.config")).unwrap();
        let map = format!(r#"<metadata key="filament_maps" value="{}"/>"#, p.map);
        assert!(info.contains(&map), "{:?}: {info}", p.colours);
        assert_eq!(out.stats.tool_changes, p.changes, "{:?}", p.colours);
        // A filament's grams take in the flushes counted to it, as Orca counts them; the rest is our sparse infill.
        for (f, (got, want)) in out.stats.filaments.iter().zip(p.grams).enumerate() {
            assert!((got.weight - want).abs() < 0.015, "{:?}: filament {f} {} g, Orca {want} g", p.colours, got.weight);
        }
    }
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

#[test]
fn a_vase_climbs_in_one_spiral_above_its_bottom_and_is_alone_on_its_plate() {
    // Spiral vase mode, as a project asks for it: Orca's settings for it, one wall and nothing inside.
    let settings = setup::read(r#"{"process": {"spiral_mode": "1"}}"#).unwrap().settings;
    assert_eq!(settings.unsupported(), None);
    assert_eq!((settings.wall_loops, settings.top_shell_layers, settings.sparse_density), (1, 0, 0.0));
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let block = boxes_stl(&[([116., 116., 0.], [140., 140., 10.])]);
    let out = slice(&[Input { name: "vase.stl", bytes: &block }], &settings, &options).unwrap();
    assert!(out.fallbacks.is_empty(), "{:?}", out.fallbacks);
    let gcode = String::from_utf8(out.gcode).unwrap();
    // Each layer's height, its extrusions' heights and whether it retracts.
    let mut layers: Vec<(f64, Vec<f64>, bool)> = Vec::new();
    let mut z = 0.0;
    for line in gcode.lines() {
        if let Some(h) = line.strip_prefix("; Z_HEIGHT: ") {
            layers.push((h.parse().unwrap(), Vec::new(), false));
        }
        if !line.starts_with("G1 ") {
            continue;
        }
        z = word(line, 'Z').unwrap_or(z);
        if let Some(layer) = layers.last_mut() {
            match word(line, 'E') {
                Some(e) if e > 0.0 && word(line, 'X').or(word(line, 'Y')).is_some() => layer.1.push(z),
                Some(e) if e < 0.0 => layer.2 = true,
                _ => {}
            }
        }
    }
    // 50 layers, and the last one's turn again, flat, as Orca ends a vase (and counts it).
    assert_eq!(layers.len(), 51);
    let bottom = settings.bottom_shell_layers;
    for (i, (top, zs, retracts)) in layers.iter().enumerate() {
        assert!(!zs.is_empty(), "layer {i}");
        if i < bottom || i == 50 {
            // The bottom layers print flat, as any print's, and so does the last turn's copy.
            assert!(zs.iter().all(|z| (z - top).abs() < 1e-9), "layer {i} at {top}: {zs:?}");
        } else {
            // Above them each turn rises from the layer below to its own height as it goes round, never retracting.
            assert!(!retracts, "layer {i} retracts");
            assert!(zs.windows(2).all(|w| w[1] > w[0]), "layer {i} rises: {zs:?}");
            assert!(zs[0] > top - 0.2 && (zs[zs.len() - 1] - top).abs() < 1e-9, "layer {i} at {top}: {zs:?}");
        }
    }
    // An object that stands on two feet travels between them on its bottom layers, lifted: over at its height and
    // down at the end, as Orca 2.5.1 does it (2.5.0 came down on the way there).
    let feet = boxes_stl(&[([116., 116., 0.], [124., 140., 10.]), ([132., 116., 0.], [140., 140., 10.])]);
    let out = slice(&[Input { name: "feet.stl", bytes: &feet }], &settings, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let (on_the_way, at_end) = travels_down(&gcode);
    assert_eq!(on_the_way, None);
    assert!(at_end >= 1, "{at_end} travels come down at their end");
    // A vase that widens as it rises (a cone opening upwards, 30° out from upright): above its bottom Orca finds no
    // shells (its `discover_vertical_shells` stops at the bottom's layers), so every layer there is its loop alone,
    // with no solid infill under the part that overhangs the layer below.
    let n = 64;
    let ring = |r: f32, z: f32| -> Vec<[f32; 3]> {
        (0..n)
            .map(|k| {
                let a = k as f32 * std::f32::consts::TAU / n as f32;
                [128. + r * a.cos(), 128. + r * a.sin(), z]
            })
            .collect()
    };
    let (r0, height) = (10., 20.);
    let mut vertices = ring(r0, 0.);
    vertices.extend(ring(r0 + height * 30f32.to_radians().tan(), height));
    vertices.extend([[128., 128., 0.], [128., 128., height]]);
    let mut faces = Vec::new();
    for k in 0..n {
        let next = (k + 1) % n;
        faces.extend([[2 * n, next, k], [2 * n + 1, n + k, n + next], [k, next, n + next], [k, n + next, n + k]]);
    }
    let cone = solid_stl(&vertices, &faces);
    let out = slice(&[Input { name: "cone.stl", bytes: &cone }], &settings, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    // What each layer above the bottom prints other than its wall (a rising loop's moves name their height first).
    let (mut layer, mut feature, mut other) = (0, "", Vec::new());
    for line in gcode.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        } else if line.starts_with("; CHANGE_LAYER") {
            layer += 1;
        } else if line.starts_with("G1 ")
            && word(line, 'E').is_some_and(|e| e > 0.0)
            && word(line, 'X').or(word(line, 'Y')).is_some()
            && layer > bottom
            && feature != "Outer wall"
        {
            other.push((layer - 1, feature));
        }
    }
    assert_eq!(other, []);
    assert_eq!(layer, 101);
    // Orca prints one object in spiral vase mode, and stops the slice when there are more: so do we.
    let beside = boxes_stl(&[([150., 116., 0.], [160., 126., 10.])]);
    let two = [Input { name: "vase.stl", bytes: &block }, Input { name: "cup.stl", bytes: &beside }];
    assert_eq!(slice(&two, &settings, &options).err(), Some(Error::Unsupported("several objects in spiral vase mode")));
}

/// Each layer's features, in the order its extrusions first take them.
fn layer_features(gcode: &str) -> Vec<Vec<&str>> {
    let mut layers: Vec<Vec<&str>> = Vec::new();
    let mut feature = "";
    for line in gcode.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        } else if line.starts_with("; CHANGE_LAYER") {
            layers.push(Vec::new());
        } else if line.starts_with("G1 X")
            && word(line, 'E').is_some_and(|e| e > 0.0)
            && let Some(layer) = layers.last_mut().filter(|l| !l.contains(&feature))
        {
            layer.push(feature);
        }
    }
    layers
}

#[test]
fn a_raft_lifts_a_model_off_the_plate_as_orcas_does() {
    // Three layers of raft under a 24 mm block, with supports off: the X2D's organic trees make it, as Orca's do.
    let block = boxes_stl(&[([116., 116., 0.], [140., 140., 10.])]);
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let s = setup::read(r#"{"process": {"raft_layers": "3"}}"#).unwrap().settings;
    let out = slice(&[Input { name: "block.stl", bytes: &block }], &s, &options).unwrap();
    assert!(out.fallbacks.is_empty(), "{:?}", out.fallbacks);
    let gcode = String::from_utf8(out.gcode.clone()).unwrap();
    let layers = check_moves(&gcode, &s);
    // Native OrcaSlicer 2.5.0 with these settings (Nov 14): 53 layers, the raft's at 0.2, 0.5 and 0.8 mm and the
    // block's from 1.1 mm, 0.1 mm over it; 170.0 mm³ of support and 186.8 mm³ of interface.
    assert_eq!(layers.len(), 53);
    let zs: Vec<f64> =
        gcode.lines().filter_map(|l| l.strip_prefix("; Z_HEIGHT: ")).map(|z| z.parse().unwrap()).collect();
    assert_eq!(&zs[..5], &[0.2, 0.5, 0.8, 1.1, 1.3]);
    let feature = |out: &spaghetti_slicer::Output, role: Role| {
        out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume
    };
    let near = |got: f64, want: f64| (got - want).abs() < want * 0.005;
    assert!(near(feature(&out, Role::Support), 169.96), "{} mm³ of support", feature(&out, Role::Support));
    assert!(near(feature(&out, Role::SupportInterface), 186.85), "{} mm³", feature(&out, Role::SupportInterface));
    // The raft's base, its interface and its contact layer; then the block, with no brim, its first layer as a
    // first layer's speeds have it but not on the plate.
    let features = layer_features(&gcode);
    assert_eq!(features[..3], [vec!["Support"], vec!["Support interface"], vec!["Support interface"]]);
    assert!(features[3].contains(&"Outer wall") && !features[3].iter().any(|f| f.starts_with("Support")));
    assert!(!gcode.contains("; FEATURE: Brim"));
    let first_object_layer = gcode.split("; CHANGE_LAYER").nth(4).unwrap();
    let outer = first_object_layer.split("; FEATURE: Outer wall\n").nth(1).unwrap();
    let speed = outer.lines().find_map(|l| l.strip_prefix("G1 F")).unwrap();
    assert_eq!(speed.parse::<f64>().unwrap(), s.first_layer_speed * 60.0);
    // Orca's normal supports put the raft on their grid, which takes a little more: 193.7 and 216.7 mm³ in Orca.
    let s = setup::read(r#"{"process": {"raft_layers": "3", "support_type": "normal(auto)"}}"#).unwrap().settings;
    let out = slice(&[Input { name: "block.stl", bytes: &block }], &s, &options).unwrap();
    assert!(near(feature(&out, Role::Support), 193.71), "{} mm³ of support", feature(&out, Role::Support));
    assert!(near(feature(&out, Role::SupportInterface), 216.70), "{} mm³", feature(&out, Role::SupportInterface));
}

#[test]
fn normal_supports_stand_on_a_raft_as_orcas_do() {
    // The T of `normal_supports_hold_up_a_slab_from_layers_of_their_own` on a raft of three layers.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let s = setup::read(r#"{"process": {"enable_support": "1", "support_type": "normal(auto)", "raft_layers": "3"}}"#)
        .unwrap()
        .settings;
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &s, &options).unwrap();
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers = check_moves(&gcode, &s);
    // Native OrcaSlicer 2.5.0 (Nov 14): 200 layers, the columns' own from the raft's interface (0.5 mm) up between
    // the raft's contact layer and the T's; 1444.4 mm³ of support and 172.9 mm³ of interface.
    assert_eq!(layers.len(), 200);
    let zs: Vec<f64> =
        gcode.lines().filter_map(|l| l.strip_prefix("; Z_HEIGHT: ")).map(|z| z.parse().unwrap()).collect();
    assert_eq!(&zs[..7], &[0.2, 0.5, 0.776712, 0.8, 1.05342, 1.1, 1.3]);
    let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    let near = |got: f64, want: f64| (got - want).abs() < want * 0.005;
    assert!(near(feature(Role::Support), 1444.4), "{} mm³ of support", feature(Role::Support));
    assert!(near(feature(Role::SupportInterface), 172.9), "{} mm³", feature(Role::SupportInterface));
    // Orca cools the first three support layers each on its own, the columns' first among them: too quick, it slows.
    let columns = gcode.split("; Z_HEIGHT: 0.776712\n").nth(1).unwrap().split("; CHANGE_LAYER").next().unwrap();
    let (mut f, mut speeds) = (0.0, Vec::new());
    for line in columns.lines() {
        if let Some(v) = line.strip_prefix("G1 F") {
            f = v.parse().unwrap();
        } else if line.starts_with("G1 X") && word(line, 'E').is_some_and(|e| e > 0.0) {
            speeds.push(f);
        }
    }
    assert!(!speeds.is_empty() && speeds.iter().all(|&f| f < 2100.0), "{speeds:?}");
}

#[test]
fn organic_trees_stand_on_a_raft_as_orcas_do() {
    // The T of `organic_trees_hold_up_a_slab_on_two_trunks` on a raft of three layers.
    let tee = boxes_stl(&[([115., 123., 0.], [125., 133., 20.]), ([100., 123., 20.], [140., 133., 25.])]);
    let s = setup::read(r#"{"process": {"enable_support": "1", "raft_layers": "3"}}"#).unwrap().settings;
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = slice(&[Input { name: "tee.stl", bytes: &tee }], &s, &options).unwrap();
    assert!(out.fallbacks.is_empty(), "{:?}", out.fallbacks);
    let gcode = String::from_utf8(out.gcode).unwrap();
    let layers = check_moves(&gcode, &s);
    // Native OrcaSlicer 2.5.0 (Nov 14): 129 layers, the raft's at 0.2, 0.5 and 0.8 mm, one of branches alone in the
    // gap over its contact layer, then the T's from 1.1 mm; 824.1 mm³ of support and 102.2 mm³ of interface. Ours
    // are the same raft and trees, 2 % lighter where branches merge, as without a raft.
    assert_eq!(layers.len(), 129);
    let zs: Vec<f64> =
        gcode.lines().filter_map(|l| l.strip_prefix("; Z_HEIGHT: ")).map(|z| z.parse().unwrap()).collect();
    assert_eq!(&zs[..6], &[0.2, 0.5, 0.8, 0.9, 1.1, 1.3]);
    let feature = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    let near = |got: f64, want: f64, share: f64| (got - want).abs() < want * share;
    assert!(near(feature(Role::Support), 824.1, 0.05), "{} mm³ of support", feature(Role::Support));
    assert!(near(feature(Role::SupportInterface), 102.2, 0.005), "{} mm³", feature(Role::SupportInterface));
    // The trees stand on the plate under the raft's first layer and cut through the layers above it, which print
    // round them: branches and the raft's interface on its second and third layers, branches alone in the gap.
    let mut features: Vec<Vec<&str>> = Vec::new();
    let mut feature = "";
    for line in gcode.lines() {
        if let Some(f) = line.strip_prefix("; FEATURE: ") {
            feature = f;
        } else if line.starts_with("; CHANGE_LAYER") {
            features.push(Vec::new());
        } else if (line.starts_with("G1 X") || line.starts_with("G2 ") || line.starts_with("G3 "))
            && word(line, 'E').is_some_and(|e| e > 0.0)
            && let Some(layer) = features.last_mut().filter(|l| !l.contains(&feature))
        {
            layer.push(feature);
        }
    }
    assert_eq!(
        features[..4],
        [vec!["Support"], vec!["Support", "Support interface"], vec!["Support", "Support interface"], vec!["Support"]]
    );
    assert!(features[4].contains(&"Outer wall"));
}

/// The T of the support tests as four boxes (pillar, left arm, middle, right arm), its `painted` triangles' supports
/// painted with `code` ("4" enforces, "8" blocks), sliced with `process`: its support and interface (mm³).
fn painted_tee(painted: &[u32], code: u8, process: &str) -> (f64, f64) {
    use spaghetti_slicer::{Plate, paint::Paint};
    let tee = boxes_stl(&[
        ([115., 123., 0.], [125., 133., 20.]),
        ([100., 123., 20.], [115., 133., 25.]),
        ([115., 123., 20.], [125., 133., 25.]),
        ([125., 123., 20.], [140., 133., 25.]),
    ]);
    let settings = setup::read(&format!(r#"{{"process": {{"enable_support": "1", {process}}}}}"#)).unwrap().settings;
    let mut bytes = (painted.len() as u32).to_le_bytes().to_vec();
    for &t in painted {
        bytes.extend_from_slice(&t.to_le_bytes());
    }
    for end in 1..=painted.len() as u32 {
        bytes.extend_from_slice(&end.to_le_bytes());
    }
    bytes.extend(std::iter::repeat_n(code, painted.len()));
    let mut plate = Plate::default();
    plate.add_part(&Input { name: "tee.stl", bytes: &tee }, 0, true).expect("a model");
    assert!(plate.paint_supports(&Paint::from_bytes(&bytes).expect("paint")));
    let options = Options { arrange: false, thumbnail: false, ..Options::default() };
    let out = plate.slice(&settings, &options).expect("sliced");
    let volume = |role: Role| out.stats.features[Role::ALL.iter().position(|&r| r == role).unwrap()].volume;
    (volume(Role::Support), volume(Role::SupportInterface))
}

#[test]
fn painted_supports_enforce_and_block_support_as_orcas_do() {
    // The T's left arm painted underneath to enforce support (its box's first two triangles, 12 and 13), or its right
    // arm's to block it (36 and 37). Against native OrcaSlicer 2.5.0 (Nov 15), the same T as a project of four parts.
    let near = |(support, interface): (f64, f64), want: (f64, f64), share: f64| {
        assert!(
            (support - want.0).abs() <= want.0 * share && (interface - want.1).abs() <= want.1 * share,
            "{support} and {interface} mm³ against {want:?}"
        );
    };
    let left = [12, 13];
    // Normal supports only where painted: under the left arm alone, 681.94 mm³ and 45.37 of interface; and where
    // needed but blocked under the right arm, the same.
    near(painted_tee(&left, b'4', r#""support_type": "normal(manual)""#), (681.94, 45.37), 1e-3);
    near(painted_tee(&[36, 37], b'8', r#""support_type": "normal(auto)""#), (681.94, 45.37), 1e-3);
    // Snug: 610.67 and 37.18.
    let snug = r#""support_type": "normal(manual)", "support_style": "snug""#;
    near(painted_tee(&left, b'4', snug), (610.67, 37.18), 1e-3);
    // Hybrid trees only where painted: 680.83 and 52.92; organic ones 449.33 and 33.77 (theirs as the trees' own
    // differ from Orca's, section 3 of the proposal).
    let hybrid = r#""support_type": "tree(manual)", "support_style": "tree_hybrid""#;
    near(painted_tee(&left, b'4', hybrid), (680.83, 52.92), 1e-3);
    near(painted_tee(&left, b'4', r#""support_type": "tree(manual)""#), (449.33, 33.77), 5e-3);
    // Nothing painted where supports are only where painted: none.
    near(painted_tee(&[36, 37], b'8', r#""support_type": "normal(manual)""#), (0.0, 0.0), 0.0);
}
