//! Reads the geometry of a `.3mf` without G-code: a plain 3MF from anywhere, or a Bambu Studio or Orca project (the
//! app's `model3mf.ts`, ported). Every printable build item becomes one mesh in plate coordinates (millimetres,
//! the item's transform and its components' applied). For a project with plates, only its first plate's objects
//! are read. A plain scanner, not an XML parser: 3MF files are machine-written, and this reads them fast.

use crate::Error;
use crate::mesh::Mesh;
use crate::paint::Paint;
use crate::zip;
use std::collections::HashMap;

pub struct Model {
    pub meshes: Vec<Mesh>,
    /// A Bambu Studio or Orca project: its objects sit where its plate has them.
    pub project: bool,
    /// Each mesh's filament (0-based), as a project gives it (its object's `extruder`, else its first part's, as the
    /// app counts them); 0 otherwise.
    pub filaments: Vec<usize>,
    /// Which of the plate's objects each mesh is of: an object whose parts print in different filaments comes as one
    /// mesh for each part, in the object's order of them, each in its part's filament.
    pub groups: Vec<usize>,
    /// Each mesh's painted colours, when it has any: each painted triangle's `paint_color`, Orca's code.
    pub paints: Vec<Option<Paint>>,
    /// Each mesh's painted supports, when it has any: each painted triangle's `paint_supports` (state 1 enforces
    /// support there, 2 blocks it).
    pub support_paints: Vec<Option<Paint>>,
    /// Each mesh's painted seams, when it has any: each painted triangle's `paint_seam` (state 1 enforces a seam
    /// there, 2 blocks it).
    pub seam_paints: Vec<Option<Paint>>,
}

type Matrix = [f64; 12];
const IDENTITY: Matrix = [1., 0., 0., 0., 1., 0., 0., 0., 1., 0., 0., 0.];

/// "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (3MF's row-vector 4×3).
fn matrix(text: Option<&str>) -> Matrix {
    let Some(text) = text else { return IDENTITY };
    let values: Vec<f64> = text.split_ascii_whitespace().filter_map(|v| v.parse().ok()).collect();
    if values.len() == 12 && values.iter().all(|v| v.is_finite()) { values.try_into().unwrap() } else { IDENTITY }
}

/// a, then b.
fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    let mut out = [0.0; 12];
    for row in 0..4 {
        for col in 0..3 {
            out[row * 3 + col] = a[row * 3] * b[col]
                + a[row * 3 + 1] * b[3 + col]
                + a[row * 3 + 2] * b[6 + col]
                + if row < 3 { 0.0 } else { b[9 + col] };
        }
    }
    out
}

/// The value of `name="…"` in a tag.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let bytes = tag.as_bytes();
    let mut from = 0;
    while let Some(at) = tag[from..].find(name) {
        let start = from + at;
        let end = start + name.len();
        let before_ok = start > 0 && bytes[start - 1].is_ascii_whitespace();
        let rest = tag[end..].trim_start();
        if before_ok && rest.starts_with('=') {
            let rest = rest[1..].trim_start();
            if let Some(stripped) = rest.strip_prefix('"') {
                return stripped.find('"').map(|q| &stripped[..q]);
            }
        }
        from = end;
    }
    None
}

/// Each `<name …>` tag in `text` (not `<names>`), as the text between `<` and `>`.
fn tags<'a>(text: &'a str, name: &'a str) -> impl Iterator<Item = &'a str> + 'a {
    let open = format!("<{name}");
    let mut at = 0;
    std::iter::from_fn(move || {
        loop {
            let start = at + text[at..].find(&open)?;
            let end = start + text[start..].find('>')?;
            at = end + 1;
            let next = text.as_bytes().get(start + open.len()).copied().unwrap_or(b'>');
            if next.is_ascii_whitespace() || next == b'/' || next == b'>' {
                return Some(&text[start..=end]);
            }
        }
    })
}

struct ObjectDef {
    name: Option<String>,
    kind: String,
    vertices: Vec<[f64; 3]>,
    triangles: Vec<[u32; 3]>,
    /// Painted triangles (their index in `triangles`) and their codes.
    paint: Vec<(u32, String)>,
    /// Triangles with painted supports (their index in `triangles`) and their codes.
    support_paint: Vec<(u32, String)>,
    seam_paint: Vec<(u32, String)>,
    components: Vec<(String, String, Matrix)>,
}

fn read_model_file(text: &str, file: &str) -> HashMap<String, ObjectDef> {
    let mut objects = HashMap::new();
    let mut at = 0;
    while let Some(found) = text[at..].find("<object") {
        let start = at + found;
        let Some(head_len) = text[start..].find('>') else { break };
        let head = &text[start..=start + head_len];
        let self_closing = head.ends_with("/>");
        let body_start = start + head_len + 1;
        let end = if self_closing {
            body_start
        } else {
            match text[body_start..].find("</object>") {
                Some(e) => body_start + e,
                None => break,
            }
        };
        let body = &text[body_start..end];
        at = end.max(start + 1);
        let id = attr(head, "id").unwrap_or("").to_string();
        let mut def = ObjectDef {
            name: attr(head, "name").map(str::to_string),
            kind: attr(head, "type").unwrap_or("model").to_string(),
            vertices: Vec::new(),
            triangles: Vec::new(),
            paint: Vec::new(),
            support_paint: Vec::new(),
            seam_paint: Vec::new(),
            components: Vec::new(),
        };
        if body.contains("<mesh") {
            for tag in tags(body, "vertex") {
                let n = |k| attr(tag, k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(f64::NAN);
                def.vertices.push([n("x"), n("y"), n("z")]);
            }
            let count = def.vertices.len() as u32;
            for tag in tags(body, "triangle") {
                let n = |k| attr(tag, k).and_then(|v| v.parse::<u32>().ok()).unwrap_or(u32::MAX);
                let t = [n("v1"), n("v2"), n("v3")];
                // A corner that isn't one of the mesh's vertices leaves the triangle out.
                if t.iter().all(|&i| i < count) {
                    if let Some(code) = attr(tag, "paint_color").filter(|c| !c.is_empty()) {
                        def.paint.push((def.triangles.len() as u32, code.to_string()));
                    }
                    if let Some(code) = attr(tag, "paint_supports").filter(|c| !c.is_empty()) {
                        def.support_paint.push((def.triangles.len() as u32, code.to_string()));
                    }
                    if let Some(code) = attr(tag, "paint_seam").filter(|c| !c.is_empty()) {
                        def.seam_paint.push((def.triangles.len() as u32, code.to_string()));
                    }
                    def.triangles.push(t);
                }
            }
        }
        for tag in tags(body, "component") {
            let path = attr(tag, "p:path").or_else(|| attr(tag, "path")).unwrap_or("").trim_start_matches('/');
            let path = if path.is_empty() { file.to_string() } else { path.to_string() };
            def.components.push((
                path,
                attr(tag, "objectid").unwrap_or("").to_string(),
                matrix(attr(tag, "transform")),
            ));
        }
        objects.insert(id, def);
    }
    objects
}

/// Millimetres per unit of the model, from its `<model unit="…">` (millimetres when it says none).
fn unit_scale(text: &str) -> f64 {
    // The model's tag, to its `>` (or to the end of a file cut short).
    let head = text.find("<model").map_or("", |s| {
        let rest = &text[s..];
        rest.find('>').map_or(rest, |e| &rest[..=e])
    });
    match attr(head, "unit") {
        Some("micron") => 0.001,
        Some("centimeter") => 10.0,
        Some("inch") => 25.4,
        Some("foot") => 304.8,
        Some("meter") => 1000.0,
        _ => 1.0,
    }
}

struct Info {
    name: Option<String>,
    skip_parts: Vec<String>,
    /// The object's filament, 1-based.
    extruder: Option<usize>,
    /// Each model part's filament (1-based, its own else the object's), by the part's id.
    part_extruders: HashMap<String, Option<usize>>,
    /// Whether its parts name different filaments.
    mixed: bool,
}

pub fn read(bytes: &[u8]) -> Result<Model, Error> {
    let entries = zip::entries(bytes).ok_or(Error::Unreadable)?;
    let find = |name: &str| entries.iter().find(|e| e.name.eq_ignore_ascii_case(name));
    let root_entry = find("3D/3dmodel.model").ok_or(Error::Unreadable)?;
    if entries.iter().any(|e| e.name.starts_with("Metadata/plate_") && e.name.ends_with(".gcode")) {
        // Already sliced: not ours to slice.
        return Err(Error::Unreadable);
    }
    let text_of = |name: &str| -> Option<String> {
        let bytes = find(name)?.read()?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    };
    let root_name = root_entry.name.clone();
    let root_text = text_of(&root_name).ok_or(Error::Unreadable)?;
    let scale = unit_scale(&root_text);
    let mut files: HashMap<String, HashMap<String, ObjectDef>> = HashMap::new();
    files.insert(root_name.clone(), read_model_file(&root_text, &root_name));

    // Bambu and Orca projects: names, part kinds and plates in model_settings.config.
    let settings = text_of("Metadata/model_settings.config");
    let project = settings.is_some();
    let mut info: HashMap<String, Info> = HashMap::new();
    let mut plate_objects: Option<Vec<String>> = None;
    if let Some(text) = &settings {
        let mut at = 0;
        while let Some(found) = text[at..].find("<object ") {
            let start = at + found;
            let Some(end) = text[start..].find("</object>").map(|e| start + e) else { break };
            let block = &text[start..end];
            at = end;
            let head_end = block.find('>').unwrap_or(block.len());
            let id = attr(&block[..=head_end.min(block.len() - 1)], "id").unwrap_or("").to_string();
            let before_parts = block.split("<part").next().unwrap_or("");
            let name = tags(before_parts, "metadata")
                .find(|t| attr(t, "key") == Some("name"))
                .and_then(|t| attr(t, "value"))
                .map(str::to_string);
            let skip_parts = tags(block, "part")
                .filter(|t| attr(t, "subtype").is_some_and(|s| s != "normal_part"))
                .filter_map(|t| attr(t, "id").map(str::to_string))
                .collect();
            let extruder_of = |text: &str| {
                tags(text, "metadata")
                    .find(|t| attr(t, "key") == Some("extruder"))
                    .and_then(|t| attr(t, "value"))
                    .and_then(|v| v.trim().parse::<usize>().ok())
            };
            let own = extruder_of(before_parts);
            // Each model part's filament: its own, else the object's.
            let parts: Vec<(Option<String>, Option<usize>)> = block
                .split("<part")
                .skip(1)
                .filter(|part| attr(part, "subtype").is_none_or(|s| s == "normal_part"))
                .map(|part| (attr(part, "id").map(str::to_string), extruder_of(part).or(own)))
                .collect();
            let extruder = own.or_else(|| parts.iter().find_map(|p| p.1));
            let mixed = parts.iter().any(|p| p.1.unwrap_or(1) != parts[0].1.unwrap_or(1));
            let part_extruders = parts.into_iter().filter_map(|(id, e)| Some((id?, e))).collect();
            info.insert(id, Info { name, skip_parts, extruder, part_extruders, mixed });
        }
        if let Some(start) = text.find("<plate>") {
            let end = text[start..].find("</plate>").map(|e| start + e).unwrap_or(text.len());
            let ids: Vec<String> = tags(&text[start..end], "metadata")
                .filter(|t| attr(t, "key") == Some("object_id"))
                .filter_map(|t| attr(t, "value").map(str::to_string))
                .collect();
            if !ids.is_empty() {
                plate_objects = Some(ids);
            }
        }
    }

    let items: Vec<(String, Matrix)> = tags(&root_text, "item")
        .filter(|t| attr(t, "printable") != Some("0"))
        .map(|t| (attr(t, "objectid").unwrap_or("").to_string(), matrix(attr(t, "transform"))))
        .collect();
    let mut meshes = Vec::new();
    let mut filaments = Vec::new();
    let mut groups = Vec::new();
    let mut paints = Vec::new();
    let mut support_paints = Vec::new();
    let mut seam_paints = Vec::new();
    let mut objects = 0;
    for (id, transform) in items {
        if plate_objects.as_ref().is_some_and(|ids| !ids.contains(&id)) {
            continue;
        }
        let Some(def) = files[&root_name].get(&id) else { continue };
        if def.kind != "model" && !def.kind.is_empty() {
            continue;
        }
        let def_name = def.name.clone();
        let item_info = info.get(&id);
        let mut vertices: Vec<[f32; 3]> = Vec::new();
        let mut triangles: Vec<[u32; 3]> = Vec::new();
        // Each part's corners, how far its transform lifts it and its heights as the file has them: Orca's heights
        // (`settle_heights`) where every part is only moved.
        let mut parts: Vec<(std::ops::Range<usize>, f64)> = Vec::new();
        let mut heights: Vec<f32> = Vec::new();
        let mut settle = true;
        // Which of the object's parts (its own components, by id) each triangle is of.
        let mut part_ids: Vec<String> = Vec::new();
        let mut triangle_part: Vec<usize> = Vec::new();
        // Painted triangles: their index in `triangles`, code, and whether their corners were turned (a mirrored part).
        let mut painted: Vec<(u32, String, bool)> = Vec::new();
        let mut supported: Vec<(u32, String, bool)> = Vec::new();
        let mut seamed: Vec<(u32, String, bool)> = Vec::new();
        // Depth-first through components (at most 8 deep), loading other model files as they are named.
        let mut stack: Vec<(String, String, Matrix, usize, Option<String>)> =
            vec![(root_name.clone(), id.clone(), transform, 0, None)];
        while let Some((file, object_id, m, depth, part)) = stack.pop() {
            if depth > 8 {
                continue;
            }
            if !files.contains_key(&file) {
                let parsed = text_of(&file).map(|t| read_model_file(&t, &file)).unwrap_or_default();
                files.insert(file.clone(), parsed);
            }
            let Some(object) = files[&file].get(&object_id) else { continue };
            if object.kind != "model" && !object.kind.is_empty() {
                continue;
            }
            let base = vertices.len() as u32;
            settle &= m[..9] == [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
            for v in &object.vertices {
                let (x, y, z) = (v[0] * scale, v[1] * scale, v[2] * scale);
                vertices.push([
                    (x * m[0] + y * m[3] + z * m[6] + m[9] * scale) as f32,
                    (x * m[1] + y * m[4] + z * m[7] + m[10] * scale) as f32,
                    (x * m[2] + y * m[5] + z * m[8] + m[11] * scale) as f32,
                ]);
                heights.push(z as f32);
            }
            parts.push((base as usize..vertices.len(), m[11] * scale));
            let flip = det(&m) < 0.0;
            let part_index = match &part {
                Some(p) => part_ids.iter().position(|q| q == p).unwrap_or_else(|| {
                    part_ids.push(p.clone());
                    part_ids.len() - 1
                }),
                None => usize::MAX,
            };
            let first = triangles.len() as u32;
            for t in &object.triangles {
                let t = [t[0] + base, t[1] + base, t[2] + base];
                triangles.push(if flip { [t[0], t[2], t[1]] } else { t });
                triangle_part.push(part_index);
            }
            painted.extend(object.paint.iter().map(|(t, code)| (first + t, code.clone(), flip)));
            supported.extend(object.support_paint.iter().map(|(t, code)| (first + t, code.clone(), flip)));
            seamed.extend(object.seam_paint.iter().map(|(t, code)| (first + t, code.clone(), flip)));
            for (path, child, ct) in object.components.iter().rev() {
                if item_info.is_some_and(|i| i.skip_parts.contains(child)) {
                    continue;
                }
                // The object's own components are its parts; deeper ones belong to theirs.
                let part = part.clone().or_else(|| Some(child.clone()));
                stack.push((path.clone(), child.clone(), multiply(ct, &m), depth + 1, part));
            }
        }
        if triangles.is_empty() || vertices.iter().any(|v| !v.iter().all(|c| c.is_finite())) {
            continue;
        }
        if settle {
            for (v, &z) in vertices.iter_mut().zip(&heights) {
                v[2] = z;
            }
            // Orca puts other programs' models on the bed; a project's sit where it has them.
            crate::mesh::settle_heights(&mut vertices, &parts, !project);
        }
        let name =
            item_info.and_then(|i| i.name.clone()).or(def_name).unwrap_or_else(|| format!("Object {}", objects + 1));
        let filament = |e: Option<usize>| e.map_or(0, |e| e.max(1) - 1);
        match item_info.filter(|i| i.mixed && !part_ids.is_empty()) {
            // Parts in different filaments: each part a mesh of its own, in its filament (the object's own triangles,
            // if it has any beside its parts, in the object's).
            Some(info) => {
                let own = triangle_part.contains(&usize::MAX).then_some((usize::MAX, None));
                let each = part_ids.iter().enumerate().map(|(k, part)| (k, Some(part)));
                for (k, part) in own.into_iter().chain(each) {
                    let mut index: HashMap<u32, u32> = HashMap::new();
                    let mut part_vertices = Vec::new();
                    // Each of the object's triangles in this part: its index among the part's.
                    let mut in_part: HashMap<u32, u32> = HashMap::new();
                    let part_triangles: Vec<[u32; 3]> = triangles
                        .iter()
                        .zip(&triangle_part)
                        .enumerate()
                        .filter(|&(_, (_, &p))| p == k)
                        .map(|(t, (corners, _))| {
                            in_part.insert(t as u32, in_part.len() as u32);
                            corners.map(|v| {
                                *index.entry(v).or_insert_with(|| {
                                    part_vertices.push(vertices[v as usize]);
                                    (part_vertices.len() - 1) as u32
                                })
                            })
                        })
                        .collect();
                    if part_triangles.is_empty() {
                        continue;
                    }
                    let e = part.and_then(|p| info.part_extruders.get(p).copied().flatten()).or(info.extruder);
                    let (mesh, moves) =
                        Mesh { name: name.clone(), vertices: part_vertices, triangles: part_triangles }.welded_moved();
                    meshes.push(mesh);
                    paints.push(paint_of(&painted, |t| in_part.get(&t).copied(), &moves));
                    support_paints.push(paint_of(&supported, |t| in_part.get(&t).copied(), &moves));
                    seam_paints.push(paint_of(&seamed, |t| in_part.get(&t).copied(), &moves));
                    filaments.push(filament(e));
                    groups.push(objects);
                }
            }
            None => {
                let (mesh, moves) = Mesh { name, vertices, triangles }.welded_moved();
                meshes.push(mesh);
                paints.push(paint_of(&painted, Some, &moves));
                support_paints.push(paint_of(&supported, Some, &moves));
                seam_paints.push(paint_of(&seamed, Some, &moves));
                filaments.push(filament(item_info.and_then(|i| i.extruder)));
                groups.push(objects);
            }
        }
        objects += 1;
    }
    if meshes.is_empty() {
        return Err(Error::NoModel);
    }
    Ok(Model { meshes, project, filaments, groups, paints, support_paints, seam_paints })
}

/// A mesh's paint, from its object's painted triangles: `place` gives an object's triangle's place among the mesh's
/// (None: not the mesh's), `moves` where the mesh's went as it was welded. None when nothing is painted.
fn paint_of(
    painted: &[(u32, String, bool)],
    place: impl Fn(u32) -> Option<u32>,
    moves: &crate::mesh::Moves,
) -> Option<Paint> {
    let now = moves.new_places();
    let mut kept: Vec<(u32, &str, bool)> = painted
        .iter()
        .filter_map(|(t, code, turned)| place(*t).and_then(&now).map(|n| (n, code.as_str(), *turned)))
        .collect();
    kept.sort_by_key(|k| k.0);
    let mut paint = Paint::default();
    for (t, code, turned) in kept {
        paint.push(t, code.as_bytes(), turned);
    }
    (!paint.is_empty()).then_some(paint)
}

fn det(m: &Matrix) -> f64 {
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn three_mf(model: &str) -> Vec<u8> {
        project(model, None)
    }

    /// A 3MF, and a Bambu project's settings when given.
    fn project(model: &str, settings: Option<&str>) -> Vec<u8> {
        let mut w = zip::Writer::default();
        w.add("[Content_Types].xml", b"<Types/>", 6);
        w.add("3D/3dmodel.model", model.as_bytes(), 6);
        if let Some(settings) = settings {
            w.add("Metadata/model_settings.config", settings.as_bytes(), 6);
        }
        w.finish()
    }

    const TETRA: &str = r#"<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh>"#;

    #[test]
    fn reads_items_with_their_transforms_and_units() {
        let model = format!(
            r#"<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model" name="Tetra">{TETRA}</object><object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></components></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 1 2 3"/><item objectid="2"/><item objectid="1" printable="0"/></build></model>"#
        );
        let m = read(&three_mf(&model)).expect("a model");
        assert!(!m.project);
        assert_eq!(m.meshes.len(), 2);
        assert_eq!(m.meshes[0].name, "Tetra");
        // Put down on the bed, as Orca puts another program's model.
        assert_eq!(m.meshes[0].vertices[1], [110.0, 20.0, 0.0]);
        assert_eq!(m.meshes[1].vertices[0], [50.0, 0.0, 0.0]);
        assert_eq!(m.meshes[1].triangles.len(), 4);
    }

    #[test]
    fn reads_painted_colours_with_their_triangles_wherever_they_go() {
        // A collapsed triangle first (dropped), then the tetra with two painted triangles; a second tetra, mirrored,
        // one triangle painted (its corners turned back outward, its code still going by the file's order).
        let painted = r#"<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/></vertices><triangles><triangle v1="0" v2="0" v3="1"/><triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3" paint_color="8"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2" paint_color="081"/></triangles></mesh>"#;
        let other =
            TETRA.replace(r#"<triangle v1="0" v2="2" v3="1"/>"#, r#"<triangle v1="0" v2="2" v3="1" paint_color="4"/>"#);
        let model = format!(
            r#"<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model">{painted}</object><object id="2" type="model">{other}</object><object id="3" type="model"><components><component objectid="1"/><component objectid="2" transform="-1 0 0 0 1 0 0 0 1 30 0 0"/></components></object></resources><build><item objectid="3"/></build></model>"#
        );
        let codes = |p: &Paint| {
            p.iter()
                .map(|(t, code, turned)| (t, String::from_utf8_lossy(code).into_owned(), turned))
                .collect::<Vec<_>>()
        };
        // One mesh: the collapsed triangle gone, the others keep their order.
        let whole = read(&three_mf(&model)).expect("a model");
        assert_eq!(whole.meshes.len(), 1);
        assert_eq!(whole.meshes[0].triangles.len(), 8);
        let paint = whole.paints[0].as_ref().expect("paint");
        assert_eq!(codes(paint), vec![(1, "8".into(), false), (3, "081".into(), false), (4, "4".into(), true)]);
        // Parts in different filaments: each part a mesh with its own paint.
        let settings = r#"<?xml version="1.0"?><config><object id="3"><metadata key="name" value="Painted"/><part id="1" subtype="normal_part"><metadata key="extruder" value="1"/></part><part id="2" subtype="normal_part"><metadata key="extruder" value="2"/></part></object></config>"#;
        let parts = read(&project(&model, Some(settings))).expect("a model");
        assert_eq!(parts.meshes.len(), 2);
        assert_eq!(
            codes(parts.paints[0].as_ref().expect("paint")),
            vec![(1, "8".into(), false), (3, "081".into(), false)]
        );
        assert_eq!(codes(parts.paints[1].as_ref().expect("paint")), vec![(0, "4".into(), true)]);
        // Unpainted models have none.
        let plain = format!(
            r#"<?xml version="1.0"?><model unit="millimeter"><resources><object id="1" type="model">{TETRA}</object></resources><build><item objectid="1"/></build></model>"#
        );
        assert_eq!(read(&three_mf(&plain)).expect("a model").paints, vec![None]);
    }

    #[test]
    fn a_sliced_file_or_one_without_objects_is_refused() {
        let empty = three_mf(r#"<model unit="millimeter"><resources/><build/></model>"#);
        assert_eq!(read(&empty).err(), Some(Error::NoModel));
        assert_eq!(read(b"solid nothing").err(), Some(Error::Unreadable));
    }

    #[test]
    fn a_model_tag_that_never_closes_is_read_as_far_as_it_goes() {
        assert_eq!(unit_scale(r#"<?xml version="1.0"?><model unit="inch""#), 25.4);
        assert_eq!(unit_scale("<?xml version=\"1.0\"?><model"), 1.0);
        assert_eq!(unit_scale("no model at all"), 1.0);
        assert_eq!(read(&three_mf(r#"<?xml version="1.0"?><model unit="inch""#)).err(), Some(Error::NoModel));
    }

    /// Whatever a damaged file holds, reading it gives a model or an error, never a crash (which would end the
    /// command line, or the whole WebAssembly module, since a release build aborts on a panic).
    #[test]
    fn a_file_cut_short_or_damaged_anywhere_is_never_a_crash() {
        let model = format!(
            r#"<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model" name="Tetra">{TETRA}</object><object id="2" type="model"><components><component objectid="1" transform="1 0 0 0 1 0 0 0 1 5 0 0"/><component objectid="1"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 1 2 3"/><item objectid="1"/></build></model>"#
        );
        let settings = r#"<?xml version="1.0"?><config><object id="2"><metadata key="name" value="Pair"/><part id="1" subtype="normal_part"><metadata key="name" value="Tetra"/></part></object><plate><metadata key="plater_id" value="1"/><metadata key="object_id" value="2"/></plate></config>"#;
        assert_eq!(read(&project(&model, Some(settings))).expect("the whole file reads").meshes.len(), 1);
        for cut in (0..=model.len()).filter(|&i| model.is_char_boundary(i)) {
            let _ = read(&three_mf(&model[..cut]));
        }
        for cut in 0..=settings.len() {
            let _ = read(&project(&model, Some(&settings[..cut])));
        }
        let file = project(&model, Some(settings));
        for cut in 0..file.len() {
            let _ = read(&file[..cut]);
            let mut damaged = file.clone();
            damaged[cut] ^= 0xa5;
            let _ = read(&damaged);
        }
    }
}
