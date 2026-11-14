//! Packs one plate's G-code into a `.gcode.3mf` laid out the way Orca's own export is (the app's `gcode3mf.ts`,
//! ported): `Metadata/plate_1.gcode` with its `.md5`, `slice_info.config`, `project_settings.config`,
//! `model_settings.config`, `plate_1.json` and the plate picture, so the app's reader and 3D view, Bambu Studio and
//! Orca read it as a sliced file. It carries no meshes (the app keeps the original file beside it).

use crate::Object;
use crate::config::{Settings, Value};
use crate::gcode::{NAME, Stats, VERSION};
use crate::zip;
use md5::{Digest, Md5};

/// The Bambu Studio file version Orca 2.5 writes into its sliced files for the printers' sake.
const BBL_CLIENT_VERSION: &str = "02.08.01.55";

fn xml(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn json(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn round(v: f64, places: i32) -> f64 {
    let p = 10f64.powi(places);
    (v * p).round() / p
}

/// The `.gcode.3mf`. `title` names the archive inside (the original file's name).
pub fn gcode_3mf(
    gcode: &[u8],
    thumbnail: Option<&[u8]>,
    stats: &Stats,
    objects: &[Object],
    s: &Settings,
    title: &str,
    colours: Option<&crate::toolchange::Colours>,
) -> Vec<u8> {
    // Level 4: within 5% of level 6's size at a third of its time (Benchy's 2.8 MB of G-code: 762 against 725 kB).
    let (packed, md5) = crate::par::join(|| zip::deflate(gcode, 4), || hex(&Md5::digest(gcode)));
    let settings = match colours {
        Some(c) => c.project_settings(s),
        None => s.project_settings(),
    };
    let setting = |key: &str| settings.iter().find(|(k, _)| *k == key).map(|(_, v)| v.first().to_string());
    let nozzle = setting("nozzle_diameter").unwrap_or_else(|| "0.4".into());
    let bed_type = setting("curr_bed_type").unwrap_or_else(|| "Textured PEI Plate".into());
    // The first layer's extent: what Orca tells the printer the plate's objects cover.
    let mut bbox_all = if objects.is_empty() {
        [0.0; 4]
    } else {
        objects.iter().fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, o| {
            let f = o.first_layer;
            [b[0].min(f[0]), b[1].min(f[1]), b[2].max(f[2]), b[3].max(f[3])]
        })
    };
    // The prime tower's first layer is on the plate too.
    for p in colours.map_or(&[][..], |c| &c.first_layer_corners[..]) {
        bbox_all = [bbox_all[0].min(p[0]), bbox_all[1].min(p[1]), bbox_all[2].max(p[0]), bbox_all[3].max(p[1])];
    }
    // Orca's "first layer time" in the plate's description: the start and the first layer.
    let first_layer_time = stats.prepare_time + stats.layer_times.first().copied().unwrap_or(0.0);
    let x2d = &s.profile;
    // The X2D's two extruders, as Orca's enum numbers them, and each one's nozzle.
    let extruder_types: Vec<&str> =
        x2d.list("extruder_type").iter().map(|t| if *t == "Bowden" { "1" } else { "0" }).collect();
    let nozzles = x2d.list("nozzle_diameter").join(",");
    let grams = round(stats.weight, 2);
    let metres = round(stats.filament_mm / 1000.0, 2);

    let mut files: Vec<(&str, Vec<u8>)> = Vec::new();
    files.push((
        "[Content_Types].xml",
        [
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            r#"<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">"#,
            r#" <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>"#,
            r#" <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>"#,
            r#" <Default Extension="png" ContentType="image/png"/>"#,
            r#" <Default Extension="json" ContentType="application/json"/>"#,
            r#" <Default Extension="gcode" ContentType="text/x.gcode"/>"#,
            "</Types>",
            "",
        ]
        .join("\n")
        .into_bytes(),
    ));
    let mut rels = vec![
        r#"<?xml version="1.0" encoding="UTF-8"?>"#.to_string(),
        r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#.into(),
        r#" <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>"#.into(),
    ];
    if thumbnail.is_some() {
        rels.push(r#" <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>"#.into());
    }
    rels.push("</Relationships>".into());
    rels.push(String::new());
    files.push(("_rels/.rels", rels.join("\n").into_bytes()));
    files.push((
        "3D/3dmodel.model",
        [
            r#"<?xml version="1.0" encoding="UTF-8"?>"#.to_string(),
            r#"<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">"#.into(),
            format!(r#" <metadata name="Application">{}</metadata>"#, xml(&format!("{NAME}-{VERSION}"))),
            r#" <metadata name="BambuStudio:3mfVersion">1</metadata>"#.into(),
            format!(r#" <metadata name="Title">{}</metadata>"#, xml(title)),
            " <resources/>".into(),
            " <build/>".into(),
            "</model>".into(),
            String::new(),
        ]
        .join("\n")
        .into_bytes(),
    ));
    files.push(("Metadata/plate_1.gcode.md5", md5.into_bytes()));
    files.push((
        "Metadata/_rels/model_settings.config.rels",
        [
            r#"<?xml version="1.0" encoding="UTF-8"?>"#,
            r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">"#,
            r#" <Relationship Target="/Metadata/plate_1.gcode" Id="rel-1" Type="http://schemas.bambulab.com/package/2021/gcode"/>"#,
            "</Relationships>",
            "",
        ]
        .join("\n")
        .into_bytes(),
    ));
    let mut model_settings = vec![
        r#"<?xml version="1.0" encoding="UTF-8"?>"#.to_string(),
        "<config>".into(),
        "  <plate>".into(),
        r#"    <metadata key="plater_id" value="1"/>"#.into(),
        r#"    <metadata key="plater_name" value=""/>"#.into(),
        r#"    <metadata key="locked" value="false"/>"#.into(),
        r#"    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>"#.into(),
    ];
    if thumbnail.is_some() {
        model_settings.push(r#"    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>"#.into());
    }
    model_settings.extend(["  </plate>".into(), "</config>".into(), String::new()]);
    files.push(("Metadata/model_settings.config", model_settings.join("\n").into_bytes()));
    // As Orca writes it for the X2D with one filament on the left extruder (`filament_maps` 1), which is what
    // Bambu Studio and the printer read to map the filament to a nozzle and a tray.
    let mut slice_info = vec![
        r#"<?xml version="1.0" encoding="UTF-8"?>"#.to_string(),
        "<config>".into(),
        "  <header>".into(),
        r#"    <header_item key="X-BBL-Client-Type" value="slicer"/>"#.into(),
        format!(r#"    <header_item key="X-BBL-Client-Version" value="{BBL_CLIENT_VERSION}"/>"#),
        format!(r#"    <header_item key="Spaghetti-Slicer-Version" value="{VERSION}"/>"#),
        "  </header>".into(),
        "  <plate>".into(),
        r#"    <metadata key="index" value="1"/>"#.into(),
        format!(r#"    <metadata key="extruder_type" value="{}"/>"#, extruder_types.join(" ")),
        r#"    <metadata key="nozzle_volume_type" value="0"/>"#.into(),
        r#"    <metadata key="printer_model_id" value=""/>"#.into(),
        format!(r#"    <metadata key="nozzle_diameters" value="{}"/>"#, xml(&nozzles)),
        format!(r#"    <metadata key="timelapse_type" value="{}"/>"#, xml(x2d.text("timelapse_type"))),
        format!(r#"    <metadata key="prediction" value="{}"/>"#, stats.total_time.round()),
        format!(r#"    <metadata key="weight" value="{grams:.2}"/>"#),
        format!(r#"    <metadata key="first_layer_time" value="{first_layer_time:.6}"/>"#),
        r#"    <metadata key="outside" value="false"/>"#.into(),
        r#"    <metadata key="support_used" value="false"/>"#.into(),
        format!(r#"    <metadata key="label_object_enabled" value="{}"/>"#, objects.len() < 64),
        r#"    <metadata key="enable_filament_dynamic_map" value="false"/>"#.into(),
        r#"    <metadata key="has_filament_switcher" value="false"/>"#.into(),
    ];
    // Which nozzle each filament prints with (1 the left), as the printer and the app read it.
    match colours {
        Some(c) => {
            let maps: Vec<String> = c.extruder_of.iter().map(|e| (e + 1).to_string()).collect();
            slice_info.push(format!(r#"    <metadata key="filament_maps" value="{}"/>"#, maps.join(" ")));
            slice_info.push(format!(
                r#"    <metadata key="limit_filament_maps" value="{}"/>"#,
                vec!["0"; maps.len()].join(" ")
            ));
        }
        None => {
            slice_info.push(r#"    <metadata key="filament_maps" value="1"/>"#.into());
            slice_info.push(r#"    <metadata key="limit_filament_maps" value="0"/>"#.into());
        }
    }
    for o in objects {
        slice_info.push(format!(r#"    <object identify_id="{}" name="{}" skipped="false"/>"#, o.label, xml(&o.name)));
    }
    // Each filament the plate uses, with its nozzle (`group_id`), then each nozzle used, then which filaments each
    // run of layers prints with.
    let filament = |id: usize, fs: &Settings, metres: f64, grams: f64, group: usize| {
        format!(
            r#"    <filament id="{}" tray_info_idx="{}" type="{}" color="{}" used_m="{metres:.2}" used_g="{grams:.2}" group_id="{group}" nozzle_diameter="{:.2}" volume_type="Standard" used_for_object="true" used_for_support="false"/>"#,
            id + 1,
            xml(&fs.filament_tray),
            xml(&fs.filament_type),
            xml(&fs.filament_colour),
            fs.nozzle_diameter,
        )
    };
    let nozzle_entry = |e: usize, diameter: f64| {
        format!(
            r#"    <nozzle id="{e}" extruder_id="{}" nozzle_diameter="{}" volume_type="Standard"/>"#,
            e + 1,
            crate::template::format_g(diameter)
        )
    };
    let mut layer_lists: Vec<(String, usize, usize)> = Vec::new();
    match colours {
        Some(c) => {
            let used = c.used();
            for &f in &used {
                let u = stats.filaments.get(f).cloned().unwrap_or_default();
                slice_info.push(filament(
                    f,
                    &c.settings[f],
                    round(u.length / 1000.0, 2),
                    round(u.weight, 2),
                    c.extruder_of[f],
                ));
            }
            let mut extruders: Vec<usize> = used.iter().map(|&f| c.extruder_of[f]).collect();
            extruders.sort_unstable();
            extruders.dedup();
            for e in extruders {
                let f = used.iter().copied().find(|&f| c.extruder_of[f] == e).unwrap_or(0);
                slice_info.push(nozzle_entry(e, c.settings[f].nozzle_diameter));
            }
            for (g, order) in c.orders.iter().enumerate() {
                let mut set = order.clone();
                set.sort_unstable();
                set.dedup();
                let list: Vec<String> = set.iter().map(usize::to_string).collect();
                let list = list.join(" ");
                match layer_lists.last_mut() {
                    Some((l, _, to)) if *l == list && *to + 1 == g => *to = g,
                    _ => layer_lists.push((list, g, g)),
                }
            }
        }
        None => {
            slice_info.push(filament(0, s, metres, grams, 0));
            slice_info.push(nozzle_entry(0, s.nozzle_diameter));
            layer_lists.push(("0".into(), 0, stats.layers.saturating_sub(1)));
        }
    }
    slice_info.push("    <layer_filament_lists>".into());
    for (list, from, to) in &layer_lists {
        slice_info.push(format!(r#"      <layer_filament_list filament_list="{list}" layer_ranges="{from} {to}" />"#));
    }
    slice_info.push("    </layer_filament_lists>".into());
    slice_info.extend(["  </plate>".into(), "</config>".into(), String::new()]);
    files.push(("Metadata/slice_info.config", slice_info.join("\n").into_bytes()));
    let objects_json: Vec<String> = objects
        .iter()
        .map(|o| {
            let f = o.first_layer;
            format!(
                r#"{{"area":{},"bbox":[{},{},{},{}],"id":{},"layer_height":{},"name":{}}}"#,
                o.first_layer_area,
                f[0],
                f[1],
                f[2],
                f[3],
                o.label,
                s.first_layer_height,
                json(&o.name)
            )
        })
        .collect();
    files.push((
        "Metadata/plate_1.json",
        format!(
            r#"{{"bbox_all":[{},{},{},{}],"bbox_objects":[{}],"bed_type":{},"filament_colors":[{}],"filament_ids":[{}],"first_extruder":{},"first_layer_time":{},"is_seq_print":false,"nozzle_diameter":{},"version":2}}"#,
            bbox_all[0],
            bbox_all[1],
            bbox_all[2],
            bbox_all[3],
            objects_json.join(","),
            json(bed_type_key(&bed_type)),
            match colours {
                Some(c) => c.settings.iter().map(|fs| json(&fs.filament_colour)).collect::<Vec<_>>().join(","),
                None => json(&s.filament_colour),
            },
            colours.map_or("0".into(), |c| c.used().iter().map(usize::to_string).collect::<Vec<_>>().join(",")),
            colours.map_or(0, |c| c.first),
            first_layer_time,
            nozzle
        )
        .into_bytes(),
    ));
    // The filaments in the order they print (1-based), each one's nozzle then, and each filament's nozzle.
    let sequence = match colours {
        Some(c) => {
            let order = c.sequence();
            let list = |v: Vec<usize>| v.iter().map(usize::to_string).collect::<Vec<_>>().join(",");
            format!(
                r#"{{"plate_1":{{"nozzle_sequence":[{}],"optimal_assignment":[{}],"sequence":[{}]}}}}"#,
                list(order.iter().map(|&f| c.extruder_of[f]).collect()),
                list(c.extruder_of.clone()),
                list(order.iter().map(|f| f + 1).collect())
            )
        }
        None => r#"{"plate_1":{"nozzle_sequence":[0],"optimal_assignment":[0],"sequence":[1]}}"#.into(),
    };
    files.push(("Metadata/filament_sequence.json", sequence.into_bytes()));
    let mut project = String::from("{\n");
    for (i, (key, value)) in settings.iter().enumerate() {
        let v = match value {
            Value::One(v) => json(v),
            Value::List(list) => format!("[{}]", list.iter().map(|v| json(v)).collect::<Vec<_>>().join(", ")),
        };
        project.push_str(&format!("    {}: {}{}\n", json(key), v, if i + 1 < settings.len() { "," } else { "" }));
    }
    project.push_str("}\n");
    files.push(("Metadata/project_settings.config", project.into_bytes()));

    let mut w = zip::Writer::with_capacity(packed.len() + 64 * 1024);
    for (name, data) in &files[..3] {
        w.add(name, data, 6);
    }
    w.add_deflated("Metadata/plate_1.gcode", gcode.len(), crc32fast::hash(gcode), &packed);
    for (name, data) in &files[3..] {
        w.add(name, data, 6);
    }
    if let Some(png) = thumbnail {
        w.add("Metadata/plate_1.png", png, 0);
    }
    w.finish()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// "Textured PEI Plate" → "textured_plate", as plate_N.json names bed types.
fn bed_type_key(bed_type: &str) -> &'static str {
    match bed_type {
        "Cool Plate" => "cool_plate",
        "Engineering Plate" => "eng_plate",
        "High Temp Plate" => "hot_plate",
        "Supertack Plate" => "supertack_plate",
        "Textured Cool Plate" => "textured_cool_plate",
        _ => "textured_plate",
    }
}
