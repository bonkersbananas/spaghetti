//! Reads the geometry of a `.3mf` without G-code: a plain 3MF from anywhere, or a Bambu Studio or Orca project (the
//! app's `model3mf.ts`, ported). Every printable build item becomes one mesh in plate coordinates (millimetres,
//! the item's transform and its components' applied). For a project with plates, only its first plate's objects
//! are read. A plain scanner, not an XML parser: 3MF files are machine-written, and this reads them fast.

use crate::Error;
use crate::mesh::Mesh;
use crate::zip;
use std::collections::HashMap;

pub struct Model {
    pub meshes: Vec<Mesh>,
    /// A Bambu Studio or Orca project: its objects sit where its plate has them.
    pub project: bool,
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

fn unit_scale(text: &str) -> f64 {
    let head_end = text.find("<model").and_then(|s| text[s..].find('>').map(|e| s + e)).unwrap_or(0);
    let head = text.find("<model").map(|s| &text[s..=head_end]).unwrap_or("");
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
            info.insert(id, Info { name, skip_parts });
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
        // Depth-first through components (at most 8 deep), loading other model files as they are named.
        let mut stack: Vec<(String, String, Matrix, usize)> = vec![(root_name.clone(), id.clone(), transform, 0)];
        while let Some((file, object_id, m, depth)) = stack.pop() {
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
            for v in &object.vertices {
                let (x, y, z) = (v[0] * scale, v[1] * scale, v[2] * scale);
                vertices.push([
                    (x * m[0] + y * m[3] + z * m[6] + m[9] * scale) as f32,
                    (x * m[1] + y * m[4] + z * m[7] + m[10] * scale) as f32,
                    (x * m[2] + y * m[5] + z * m[8] + m[11] * scale) as f32,
                ]);
            }
            let flip = det(&m) < 0.0;
            for t in &object.triangles {
                let t = [t[0] + base, t[1] + base, t[2] + base];
                triangles.push(if flip { [t[0], t[2], t[1]] } else { t });
            }
            for (path, child, ct) in object.components.iter().rev() {
                if item_info.is_some_and(|i| i.skip_parts.contains(child)) {
                    continue;
                }
                stack.push((path.clone(), child.clone(), multiply(ct, &m), depth + 1));
            }
        }
        if triangles.is_empty() || vertices.iter().any(|v| !v.iter().all(|c| c.is_finite())) {
            continue;
        }
        let name = item_info
            .and_then(|i| i.name.clone())
            .or(def_name)
            .unwrap_or_else(|| format!("Object {}", meshes.len() + 1));
        meshes.push(Mesh { name, vertices, triangles }.welded());
    }
    if meshes.is_empty() {
        return Err(Error::NoModel);
    }
    Ok(Model { meshes, project })
}

fn det(m: &Matrix) -> f64 {
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn three_mf(model: &str) -> Vec<u8> {
        let mut w = zip::Writer::default();
        w.add("[Content_Types].xml", b"<Types/>", 6);
        w.add("3D/3dmodel.model", model.as_bytes(), 6);
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
        assert_eq!(m.meshes[0].vertices[1], [110.0, 20.0, 30.0]);
        assert_eq!(m.meshes[1].vertices[0], [50.0, 0.0, 0.0]);
        assert_eq!(m.meshes[1].triangles.len(), 4);
    }

    #[test]
    fn a_sliced_file_or_one_without_objects_is_refused() {
        let empty = three_mf(r#"<model unit="millimeter"><resources/><build/></model>"#);
        assert_eq!(read(&empty).err(), Some(Error::NoModel));
        assert_eq!(read(b"solid nothing").err(), Some(Error::Unreadable));
    }
}
