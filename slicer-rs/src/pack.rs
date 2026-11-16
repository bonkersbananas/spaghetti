//! Packs one plate's G-code into a `.gcode.3mf` laid out the way Orca's own export is (the app's `gcode3mf.ts`,
//! ported): `Metadata/plate_1.gcode` with its `.md5`, `slice_info.config`, `project_settings.config`,
//! `model_settings.config`, `plate_1.json` and the plate picture, so the app's reader and 3D view, Bambu Studio and
//! Orca read it as a sliced file. It carries no meshes (the app keeps the original file beside it).

use crate::Object;
use crate::config::{Settings, Value};
use crate::gcode::{Stats, VERSION};
use crate::zip;
use md5::{Digest, Md5};

/// The Bambu Studio file version Orca 2.5 writes into its sliced files for the printers' sake.
const BBL_CLIENT_VERSION: &str = "02.08.01.55";

/// What Bambu Studio's reader needs in `Application`: only a generator starting with "BambuStudio-" is trusted with
/// the file's config, G-code and slice info (`_handle_end_metadata`, then `dont_load_config`); with another name it
/// loads no G-code and says "The file does not contain any geometry data." Who made the G-code is in slice_info's
/// header and the G-code's first line. 2.0.0 is the oldest version it takes as current.
const BAMBU_STUDIO_APPLICATION: &str = "BambuStudio-02.00.00.00";

/// Bambu Studio's `model_id` of the printer: what a file's `printer_model_id` must say for Studio's send dialog to
/// take the file for the printer's (an empty one reads "incompatible with the print file configuration").
fn printer_model_id(model: &str) -> &'static str {
    match model {
        "Bambu Lab X2D" => "N6",
        _ => "",
    }
}

/// The X2D's filaments' ids in Bambu Studio's own profiles (`filament_id`, by the preset's name without its
/// "@BBL X2D …"): the id the AMS mapping and the printer match a file's filament to a tray's by, which the engine's
/// presets (Orca's) don't carry. Kept equal to the app's `bambu-ids.ts` (a test there reads this table).
const FILAMENT_IDS: &[(&str, &str)] = &[
    ("Bambu ABS", "GFB00"),
    ("Bambu ABS-GF", "GFB50"),
    ("Bambu ASA", "GFB01"),
    ("Bambu ASA-Aero", "GFB02"),
    ("Bambu ASA-CF", "GFB51"),
    ("Bambu PA-CF", "GFN03"),
    ("Bambu PA6-CF", "GFN05"),
    ("Bambu PA6-GF", "GFN08"),
    ("Bambu PAHT-CF", "GFN04"),
    ("Bambu PC", "GFC00"),
    ("Bambu PC FR", "GFC01"),
    ("Bambu PET-CF", "GFT01"),
    ("Bambu PETG Basic", "GFG00"),
    ("Bambu PETG HF", "GFG02"),
    ("Bambu PETG Matte", "GFG03"),
    ("Bambu PETG Translucent", "GFG01"),
    ("Bambu PETG-CF", "GFG50"),
    ("Bambu PLA Aero", "GFA11"),
    ("Bambu PLA Basic", "GFA00"),
    ("Bambu PLA Dynamic", "GFA13"),
    ("Bambu PLA Galaxy", "GFA15"),
    ("Bambu PLA Glow", "GFA12"),
    ("Bambu PLA Lite", "GFA18"),
    ("Bambu PLA Marble", "GFA07"),
    ("Bambu PLA Matte", "GFA01"),
    ("Bambu PLA Metal", "GFA02"),
    ("Bambu PLA Palette", "GFA20"),
    ("Bambu PLA Pure", "GFA19"),
    ("Bambu PLA Silk", "GFA05"),
    ("Bambu PLA Silk+", "GFA06"),
    ("Bambu PLA Sparkle", "GFA08"),
    ("Bambu PLA Tough", "GFA09"),
    ("Bambu PLA Tough+", "GFA10"),
    ("Bambu PLA Translucent", "GFA17"),
    ("Bambu PLA Wood", "GFA16"),
    ("Bambu PLA-CF", "GFA50"),
    ("Bambu PPA-CF", "GFN06"),
    ("Bambu PVA", "GFS04"),
    ("Bambu Support For PA/PET", "GFS03"),
    ("Bambu Support For PLA", "GFS02"),
    ("Bambu Support For PLA/PETG", "GFS05"),
    ("Bambu Support G", "GFS01"),
    ("Bambu Support W", "GFS00"),
    ("Bambu Support for ABS", "GFS06"),
    ("Bambu TPU 85A", "GFU04"),
    ("Bambu TPU 90A", "GFU03"),
    ("Bambu TPU 95A", "GFU01"),
    ("Bambu TPU 95A HF", "GFU00"),
    ("Bambu TPU for AMS", "GFU02"),
    ("Generic ABS", "GFB99"),
    ("Generic ASA", "GFB98"),
    ("Generic BVOH", "GFS97"),
    ("Generic EVA", "GFR99"),
    ("Generic HIPS", "GFS98"),
    ("Generic PA", "GFN99"),
    ("Generic PA-CF", "GFN98"),
    ("Generic PC", "GFC99"),
    ("Generic PCTG", "GFG97"),
    ("Generic PE", "GFP99"),
    ("Generic PE-CF", "GFP98"),
    ("Generic PETG", "GFG99"),
    ("Generic PETG HF", "GFG96"),
    ("Generic PETG-CF", "GFG98"),
    ("Generic PHA", "GFR98"),
    ("Generic PLA", "GFL99"),
    ("Generic PLA High Speed", "GFL95"),
    ("Generic PLA Silk", "GFL96"),
    ("Generic PLA-CF", "GFL98"),
    ("Generic PP", "GFP97"),
    ("Generic PP-CF", "GFP96"),
    ("Generic PP-GF", "GFP95"),
    ("Generic PPA-CF", "GFN97"),
    ("Generic PPA-GF", "GFN96"),
    ("Generic PVA", "GFS99"),
    ("Generic TPU", "GFU99"),
    ("Generic TPU for AMS", "GFU98"),
];

/// "Bambu PLA Basic @BBL X2D 0.4 nozzle" → "GFA00"; "" for a filament Studio has no id for.
fn bambu_filament_id(preset: &str) -> &'static str {
    let family = preset.split(" @BBL X2D").next().unwrap_or(preset);
    FILAMENT_IDS.iter().find(|(name, _)| *name == family).map_or("", |(_, id)| id)
}

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

/// The printer preset's settings Bambu Studio reads to understand a two-extruder plate.
const PRINTER_KEYS: [&str; 10] = [
    "gcode_flavor",
    "printable_area",
    "master_extruder_id",
    "extruder_type",
    "extruder_offset",
    "physical_extruder_map",
    "printer_extruder_id",
    "printer_extruder_variant",
    "machine_load_filament_time",
    "machine_unload_filament_time",
];

/// The plate's meshes, as the file carries them for Bambu Studio (see `model_xml`).
pub struct Model<'a> {
    pub meshes: &'a [crate::mesh::Mesh],
    /// The meshes of each of the plate's objects, in the order of the objects.
    pub members: &'a [Vec<usize>],
    /// The filament each mesh prints in (0 is the first).
    pub filaments: &'a [usize],
}

/// The model of the sliced file, laid out as Bambu Studio's own: each mesh a part (a mesh object), an object of several
/// parts a wrapper of components, a build item for each object, and what `model_settings.config` says of them (name,
/// filament, parts) and of the plate (which objects are on it, by the labels the G-code carries). Without it Studio
/// shows the sliced preview, but drops it when anything changes (a filament, say) and finds an empty plate.
/// Writes the resources and build to `out` (a big mesh's run to over 100 MB of text, packed as they are written) and
/// returns the objects' settings and the plate's instances.
fn model_xml(out: &mut impl std::fmt::Write, model: &Model, objects: &[Object]) -> (String, String) {
    use std::fmt::Write;
    let (mut build, mut settings, mut instances) = (String::new(), String::new(), String::new());
    let mut next = 1;
    let _ = out.write_str(" <resources>\n");
    for (g, members) in model.members.iter().enumerate() {
        let Some(object) = objects.iter().find(|o| o.group as usize == g) else { continue };
        let extruder = |m: usize| model.filaments.get(m).copied().unwrap_or(0) + 1;
        let mut parts = String::new();
        let mut ids = Vec::new();
        let mut faces = 0;
        for &m in members {
            let mesh = &model.meshes[m];
            let id = next;
            next += 1;
            ids.push(id);
            let _ = writeln!(out, r#"  <object id="{id}" name="{}" type="model">"#, xml(&mesh.name));
            let _ = out.write_str("   <mesh>\n    <vertices>\n");
            for v in &mesh.vertices {
                let _ = writeln!(out, r#"     <vertex x="{}" y="{}" z="{}"/>"#, v[0], v[1], v[2]);
            }
            let _ = out.write_str("    </vertices>\n    <triangles>\n");
            for t in &mesh.triangles {
                let _ = writeln!(out, r#"     <triangle v1="{}" v2="{}" v3="{}"/>"#, t[0], t[1], t[2]);
            }
            let _ = out.write_str("    </triangles>\n   </mesh>\n  </object>\n");
            faces += mesh.triangles.len();
            let _ = write!(
                parts,
                "    <part id=\"{id}\" subtype=\"normal_part\">\n      <metadata key=\"name\" value=\"{}\"/>\n      <metadata key=\"matrix\" value=\"1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1\"/>\n      <metadata key=\"extruder\" value=\"{}\"/>\n      <mesh_stat face_count=\"{}\" edges_fixed=\"0\" degenerate_facets=\"0\" facets_removed=\"0\" facets_reversed=\"0\" backwards_edges=\"0\"/>\n    </part>\n",
                xml(&mesh.name),
                extruder(m),
                mesh.triangles.len()
            );
        }
        let Some(&first) = ids.first() else { continue };
        let mut object_id = first;
        if ids.len() > 1 {
            object_id = next;
            next += 1;
            let _ = writeln!(out, r#"  <object id="{object_id}" name="{}" type="model">"#, xml(&object.name));
            let _ = out.write_str("   <components>\n");
            for id in &ids {
                let _ = writeln!(out, r#"    <component objectid="{id}"/>"#);
            }
            let _ = out.write_str("   </components>\n  </object>\n");
        }
        let _ =
            writeln!(build, r#"  <item objectid="{object_id}" transform="1 0 0 0 1 0 0 0 1 0 0 0" printable="1"/>"#);
        let _ = write!(
            settings,
            "  <object id=\"{object_id}\">\n    <metadata key=\"name\" value=\"{}\"/>\n    <metadata key=\"extruder\" value=\"{}\"/>\n    <metadata face_count=\"{faces}\"/>\n{parts}  </object>\n",
            xml(&object.name),
            extruder(members[0])
        );
        let _ = write!(
            instances,
            "    <model_instance>\n      <metadata key=\"object_id\" value=\"{object_id}\"/>\n      <metadata key=\"instance_id\" value=\"0\"/>\n      <metadata key=\"identify_id\" value=\"{}\"/>\n    </model_instance>\n",
            object.label
        );
    }
    let _ = write!(out, " </resources>\n <build>\n{build} </build>\n");
    (settings, instances)
}

/// The `.gcode.3mf`. `title` names the archive inside (the original file's name).
#[allow(clippy::too_many_arguments)]
pub fn gcode_3mf(
    gcode: &[u8],
    thumbnail: Option<&[u8]>,
    stats: &Stats,
    objects: &[Object],
    s: &Settings,
    title: &str,
    colours: Option<&crate::toolchange::Colours>,
    model: &Model,
) -> Vec<u8> {
    // Level 4: within 5% of level 6's size at a third of its time (Benchy's 2.8 MB of G-code: 762 against 725 kB).
    let (packed, md5) = crate::par::join(|| zip::deflate(gcode, 4), || hex(&Md5::digest(gcode)));
    let mut settings = match colours {
        Some(c) => c.project_settings(s),
        None => s.project_settings(),
    };
    // Bambu's id of each filament, as Studio's own project settings list them (`filament_ids`).
    let filament_ids: Vec<String> = match colours {
        Some(c) => c.settings.iter().map(|fs| bambu_filament_id(&fs.filament).to_string()).collect(),
        None => vec![bambu_filament_id(&s.filament).to_string()],
    };
    settings.push(("filament_ids", Value::List(filament_ids)));
    // What Studio's G-code reader needs to know the X2D's two extruders (which tool is which, the bed, the flavour):
    // Orca writes the whole printer preset, ours listed only what a slice used.
    for &key in &PRINTER_KEYS {
        if settings.iter().any(|(k, _)| *k == key) {
            continue;
        }
        let values = s.profile.list(key);
        match values.len() {
            0 => {}
            1 if !matches!(s.profile.get(key), Some(crate::json::Json::Array(_))) => {
                settings.push((key, Value::One(values[0].to_string())))
            }
            _ => settings.push((key, Value::List(values.into_iter().map(String::from).collect()))),
        }
    }
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
    // The model, packed as it is written (`model_xml`): the same bytes as the whole text packed at once.
    let mut model_entry = zip::Deflater::new(6);
    model_entry.write(
        [
            r#"<?xml version="1.0" encoding="UTF-8"?>"#.to_string(),
            r#"<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">"#.into(),
            format!(r#" <metadata name="Application">{BAMBU_STUDIO_APPLICATION}</metadata>"#),
            r#" <metadata name="BambuStudio:3mfVersion">1</metadata>"#.into(),
            format!(r#" <metadata name="Title">{}</metadata>"#, xml(title)),
            String::new(),
        ]
        .join("\n")
        .as_bytes(),
    );
    let (object_settings, instances) = model_xml(&mut model_entry, model, objects);
    model_entry.write(b"\n</model>\n");
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
        object_settings.trim_end().to_string(),
        "  <plate>".into(),
        r#"    <metadata key="plater_id" value="1"/>"#.into(),
        r#"    <metadata key="plater_name" value=""/>"#.into(),
        r#"    <metadata key="locked" value="false"/>"#.into(),
        r#"    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>"#.into(),
    ];
    if thumbnail.is_some() {
        model_settings.push(r#"    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>"#.into());
    }
    model_settings.push(instances.trim_end().to_string());
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
        format!(r#"    <metadata key="printer_model_id" value="{}"/>"#, printer_model_id(x2d.text("printer_model"))),
        format!(r#"    <metadata key="nozzle_diameters" value="{}"/>"#, xml(&nozzles)),
        format!(r#"    <metadata key="timelapse_type" value="{}"/>"#, xml(x2d.text("timelapse_type"))),
        format!(r#"    <metadata key="prediction" value="{}"/>"#, stats.total_time.round()),
        format!(r#"    <metadata key="weight" value="{grams:.2}"/>"#),
        format!(r#"    <metadata key="first_layer_time" value="{first_layer_time:.6}"/>"#),
        r#"    <metadata key="outside" value="false"/>"#.into(),
        format!(r#"    <metadata key="support_used" value="{}"/>"#, s.enable_support),
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
            xml(bambu_filament_id(&fs.filament)),
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
    for (name, data) in &files[..2] {
        w.add(name, data, 6);
    }
    let (packed_model, model_size, model_crc) = model_entry.finish();
    w.add_deflated("3D/3dmodel.model", model_size, model_crc, &packed_model);
    drop(packed_model);
    w.add_deflated("Metadata/plate_1.gcode", gcode.len(), crc32fast::hash(gcode), &packed);
    for (name, data) in &files[2..] {
        w.add(name, data, 6);
    }
    if let Some(png) = thumbnail {
        w.add("Metadata/plate_1.png", png, 0);
    }
    w.finish()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02X}")).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bambu_knows_the_filaments_and_the_printer_by_its_own_ids() {
        assert_eq!(bambu_filament_id("Bambu PLA Basic @BBL X2D 0.4 nozzle"), "GFA00");
        assert_eq!(bambu_filament_id("Bambu PLA Silk+ @BBL X2D"), "GFA06");
        assert_eq!(bambu_filament_id("Generic PETG @BBL X2D 0.2 nozzle"), "GFG99");
        // A preset Studio has no id for gets none, rather than Orca's.
        assert_eq!(bambu_filament_id("My own PLA"), "");
        assert_eq!(printer_model_id("Bambu Lab X2D"), "N6");
        assert_eq!(printer_model_id("Prusa MK4"), "");
    }

    #[test]
    fn the_gcodes_md5_is_written_in_capitals_as_bambu_studio_writes_it() {
        assert_eq!(hex(&Md5::digest(b"")), "D41D8CD98F00B204E9800998ECF8427E");
    }
}
