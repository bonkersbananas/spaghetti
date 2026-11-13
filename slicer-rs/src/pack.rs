//! Packs one plate's G-code into a `.gcode.3mf` laid out the way Orca's own export is (the app's `gcode3mf.ts`,
//! ported): `Metadata/plate_1.gcode` with its `.md5`, `slice_info.config`, `project_settings.config`,
//! `model_settings.config`, `plate_1.json` and the plate picture, so the app's reader and 3D view, Bambu Studio and
//! Orca read it as a sliced file. It carries no meshes (the app keeps the original file beside it).

use crate::config::{Settings, Value};
use crate::gcode::{NAME, Stats, VERSION};
use crate::zip;
use md5::{Digest, Md5};

/// An object as placed on the plate.
pub struct Object {
    pub name: String,
    /// min x, min y, max x, max y (mm).
    pub bbox: [f64; 4],
}

/// The Bambu Studio file version Orca 2.5 writes into its sliced files for the printers' sake.
const BBL_CLIENT_VERSION: &str = "02.08.01.55";

fn xml(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn json(value: &str) -> String {
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
) -> Vec<u8> {
    // Level 4: within 5% of level 6's size at a third of its time (Benchy's 2.8 MB of G-code: 762 against 725 kB).
    let (packed, md5) = crate::par::join(|| zip::deflate(gcode, 4), || hex(&Md5::digest(gcode)));
    let settings = s.project_settings();
    let setting = |key: &str| settings.iter().find(|(k, _)| *k == key).map(|(_, v)| v.first().to_string());
    let nozzle = setting("nozzle_diameter").unwrap_or_else(|| "0.4".into());
    let bed_type = setting("curr_bed_type").unwrap_or_else(|| "Textured PEI Plate".into());
    let bbox_all = if objects.is_empty() {
        [0.0; 4]
    } else {
        objects.iter().fold([f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY], |b, o| {
            [b[0].min(o.bbox[0]), b[1].min(o.bbox[1]), b[2].max(o.bbox[2]), b[3].max(o.bbox[3])]
        })
    };
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
        format!(r#"    <metadata key="nozzle_diameters" value="{}"/>"#, xml(&nozzle)),
        format!(r#"    <metadata key="prediction" value="{}"/>"#, stats.total_time.round()),
        format!(r#"    <metadata key="weight" value="{grams}"/>"#),
        r#"    <metadata key="outside" value="false"/>"#.into(),
        r#"    <metadata key="support_used" value="false"/>"#.into(),
        r#"    <metadata key="label_object_enabled" value="true"/>"#.into(),
    ];
    for (i, o) in objects.iter().enumerate() {
        slice_info.push(format!(r#"    <object identify_id="{}" name="{}" skipped="false"/>"#, i + 1, xml(&o.name)));
    }
    slice_info.push(format!(
        r#"    <filament id="1" type="{}" color="{}" used_m="{metres}" used_g="{grams}"/>"#,
        xml(s.filament_type),
        xml(s.filament_colour)
    ));
    slice_info.extend(["  </plate>".into(), "</config>".into(), String::new()]);
    files.push(("Metadata/slice_info.config", slice_info.join("\n").into_bytes()));
    let objects_json: Vec<String> = objects
        .iter()
        .enumerate()
        .map(|(i, o)| {
            format!(
                r#"{{"id":{},"name":{},"bbox":[{},{},{},{}],"layer_height":{}}}"#,
                i + 1,
                json(&o.name),
                o.bbox[0],
                o.bbox[1],
                o.bbox[2],
                o.bbox[3],
                s.layer_height
            )
        })
        .collect();
    files.push((
        "Metadata/plate_1.json",
        format!(
            r#"{{"bbox_all":[{},{},{},{}],"bbox_objects":[{}],"bed_type":{},"filament_colors":[{}],"filament_ids":[0],"first_extruder":0,"is_seq_print":false,"nozzle_diameter":{},"version":2}}"#,
            bbox_all[0],
            bbox_all[1],
            bbox_all[2],
            bbox_all[3],
            objects_json.join(","),
            json(bed_type_key(&bed_type)),
            json(s.filament_colour),
            nozzle
        )
        .into_bytes(),
    ));
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
