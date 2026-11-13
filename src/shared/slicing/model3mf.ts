import { strFromU8, unzipSync } from "fflate";
import type { Config } from "./gcode3mf.ts";

/**
 * Reads the geometry of a `.3mf` that has no G-code: a Bambu Studio or Orca project, or a plain 3MF from anywhere
 * else (PrusaSlicer, Fusion, a model site). Every printable object becomes one triangle soup in plate coordinates
 * (millimetres, the build item's transform applied). For a Bambu or Orca project with plates, only the objects of
 * its first plate are read, and its settings come along. Never throws: a file it can't read gives a reason.
 */

export interface ModelObject {
  name: string;
  /** Nine floats a triangle, in mm, where the file puts it. */
  positions: Float32Array;
  /** The filament the project gives it (1 is the first), when it says. */
  extruder?: number;
}

export interface Model3mf {
  objects: ModelObject[];
  /** A Bambu Studio or Orca project: its objects sit on its plate as laid out, and it may carry settings. */
  project: boolean;
  /** The project's settings (Metadata/project_settings.config), when it has them. */
  settings?: Config;
  /** True when the file has sliced G-code: then it isn't ours to slice. */
  sliced: boolean;
}

export type Model3mfProblem = "not-3mf" | "no-objects";

const UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

type Matrix = [number, number, number, number, number, number, number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

/** "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (3MF's row-vector 4×3). */
function matrix(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  const values = text.trim().split(/\s+/).map(Number);
  return values.length === 12 && values.every(Number.isFinite) ? (values as Matrix) : IDENTITY;
}

/** a then b: a point goes through a first. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const at = (m: Matrix, index: number) => m[index] as number;
  const out = new Array<number>(12);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        at(a, row * 3) * at(b, col) +
        at(a, row * 3 + 1) * at(b, 3 + col) +
        at(a, row * 3 + 2) * at(b, 6 + col) +
        (row < 3 ? 0 : at(b, 9 + col));
    }
  }
  return out as Matrix;
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[match[1] as string] = match[2] as string;
  return out;
}

interface Mesh {
  vertices: Float64Array;
  triangles: Uint32Array;
}

interface ObjectDef {
  id: string;
  name?: string;
  type: string;
  mesh?: Mesh;
  components: { file: string; id: string; transform: Matrix }[];
}

/** The objects of one model file, by id. */
function readModelFile(text: string, file: string, scale: { value: number }): Map<string, ObjectDef> {
  const objects = new Map<string, ObjectDef>();
  const unit = /<model\b[^>]*\bunit\s*=\s*"([^"]+)"/.exec(text)?.[1];
  if (unit && UNITS[unit] !== undefined && file === "3D/3dmodel.model") scale.value = UNITS[unit] as number;
  let at = 0;
  for (;;) {
    const start = text.indexOf("<object", at);
    if (start < 0) break;
    const headEnd = text.indexOf(">", start);
    if (headEnd < 0) break;
    const head = text.slice(start, headEnd + 1);
    const attrs = attributes(head);
    const selfClosing = head.endsWith("/>");
    const end = selfClosing ? headEnd + 1 : text.indexOf("</object>", headEnd);
    if (end < 0) break;
    const body = selfClosing ? "" : text.slice(headEnd + 1, end);
    at = end + 1;
    const def: ObjectDef = { id: attrs.id ?? "", type: attrs.type ?? "model", components: [] };
    if (attrs.name) def.name = attrs.name;
    if (body.includes("<mesh")) def.mesh = readMesh(body);
    for (const match of body.matchAll(/<component\b[^>]*>/g)) {
      const c = attributes(match[0]);
      const path = (c["p:path"] ?? c.path ?? "").replace(/^\/+/, "");
      def.components.push({ file: path || file, id: c.objectid ?? "", transform: matrix(c.transform) });
    }
    objects.set(def.id, def);
  }
  return objects;
}

function readMesh(body: string): Mesh {
  const vertices: number[] = [];
  const triangles: number[] = [];
  const number = (tag: string, name: string) => {
    const at = tag.indexOf(` ${name}="`);
    if (at < 0) return Number.NaN;
    const from = at + name.length + 3;
    return Number(tag.slice(from, tag.indexOf('"', from)));
  };
  let at = 0;
  for (;;) {
    const v = body.indexOf("<vertex", at);
    if (v < 0) break;
    const end = body.indexOf(">", v);
    const tag = body.slice(v, end);
    vertices.push(number(tag, "x"), number(tag, "y"), number(tag, "z"));
    at = end;
  }
  at = 0;
  for (;;) {
    const t = body.indexOf("<triangle", at);
    if (t < 0) break;
    const end = body.indexOf(">", t);
    const tag = body.slice(t, end);
    triangles.push(number(tag, "v1"), number(tag, "v2"), number(tag, "v3"));
    at = end;
  }
  return { vertices: Float64Array.from(vertices), triangles: Uint32Array.from(triangles) };
}

export function readModel3mf(input: Uint8Array): Model3mf | Model3mfProblem {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input, {
      // Geometry and the few settings files; never the G-code or pictures.
      filter: (entry) =>
        /\.model$/i.test(entry.name) || /^Metadata\/(model|project)_settings\.config$/.test(entry.name),
    });
  } catch {
    return "not-3mf";
  }
  const names = Object.keys(files);
  const root = names.find((name) => name.toLowerCase() === "3d/3dmodel.model");
  if (!root) return "not-3mf";
  let sliced = false;
  try {
    // Listing every entry is cheap: only the chosen ones were inflated.
    unzipSync(input, {
      filter: (entry) => {
        if (/^Metadata\/plate_\d+\.gcode$/.test(entry.name)) sliced = true;
        return false;
      },
    });
  } catch {
    // Already read above.
  }

  const scale = { value: 1 };
  const byFile = new Map<string, Map<string, ObjectDef>>();
  const modelFile = (name: string) => {
    let objects = byFile.get(name);
    if (!objects) {
      const bytes = files[name] ?? files[names.find((n) => n.toLowerCase() === name.toLowerCase()) ?? ""];
      objects = bytes ? readModelFile(strFromU8(bytes), name, scale) : new Map();
      byFile.set(name, objects);
    }
    return objects;
  };
  const rootObjects = modelFile(root);
  const rootText = strFromU8(files[root] as Uint8Array);
  const items = [...rootText.matchAll(/<item\b[^>]*>/g)].map((match) => attributes(match[0]));

  // Bambu and Orca projects: names, extruders and part kinds in model_settings.config, plates in it too.
  const settingsText = files["Metadata/model_settings.config"];
  const project = settingsText !== undefined;
  const objectInfo = new Map<string, { name?: string; extruder?: number; skipParts: Set<string> }>();
  let plateObjects: Set<string> | null = null;
  if (settingsText) {
    const text = strFromU8(settingsText);
    for (const match of text.matchAll(/<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const body = match[2] as string;
      const meta = (scope: string, key: string) =>
        new RegExp(`<metadata\\s+key="${key}"\\s+value="([^"]*)"`).exec(scope)?.[1];
      const head = body.split("<part")[0] ?? "";
      const skipParts = new Set<string>();
      for (const part of body.matchAll(/<part\s+id="([^"]+)"\s+subtype="([^"]+)"/g)) {
        if (part[2] !== "normal_part") skipParts.add(part[1] as string);
      }
      const extruder = Number(meta(head, "extruder"));
      objectInfo.set(match[1] as string, {
        name: meta(head, "name"),
        ...(Number.isInteger(extruder) && extruder > 0 ? { extruder } : {}),
        skipParts,
      });
    }
    const plate = /<plate>([\s\S]*?)<\/plate>/.exec(text)?.[1];
    if (plate) {
      plateObjects = new Set(
        [...plate.matchAll(/<metadata\s+key="object_id"\s+value="([^"]+)"/g)].map((m) => m[1] as string),
      );
    }
  }

  const out: ModelObject[] = [];
  for (const item of items) {
    const id = item.objectid ?? "";
    if (item.printable === "0") continue;
    if (plateObjects && plateObjects.size > 0 && !plateObjects.has(id)) continue;
    const def = rootObjects.get(id);
    if (!def || (def.type !== "model" && def.type !== "")) continue;
    const info = objectInfo.get(id);
    const triangles: number[] = [];
    const visit = (object: ObjectDef, transform: Matrix, depth: number) => {
      if (depth > 8) return;
      if (object.mesh) appendMesh(object.mesh, transform, scale.value, triangles);
      for (const component of object.components) {
        if (info?.skipParts.has(component.id)) continue;
        const child = modelFile(component.file).get(component.id);
        if (child && (child.type === "model" || child.type === "")) {
          visit(child, multiply(component.transform, transform), depth + 1);
        }
      }
    };
    visit(def, matrix(item.transform), 0);
    if (!triangles.length) continue;
    out.push({
      name: info?.name || def.name || `Object ${out.length + 1}`,
      positions: Float32Array.from(triangles),
      ...(info?.extruder ? { extruder: info.extruder } : {}),
    });
  }
  if (!out.length) return "no-objects";

  let settings: Config | undefined;
  const projectSettings = files["Metadata/project_settings.config"];
  if (projectSettings) {
    try {
      const parsed: unknown = JSON.parse(strFromU8(projectSettings));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        settings = parsed as Config;
      }
    } catch {
      // Settings we can't read: the defaults slice it.
    }
  }
  return { objects: out, project, ...(settings ? { settings } : {}), sliced };
}

function appendMesh(mesh: Mesh, m: Matrix, scale: number, out: number[]) {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const count = v.length / 3;
  for (let i = 0; i + 2 < t.length; i += 3) {
    const a = t[i] as number;
    const b = t[i + 1] as number;
    const c = t[i + 2] as number;
    if (a >= count || b >= count || c >= count) continue;
    for (const index of [a, b, c]) {
      const x = (v[index * 3] as number) * scale;
      const y = (v[index * 3 + 1] as number) * scale;
      const z = (v[index * 3 + 2] as number) * scale;
      out.push(
        x * m[0] + y * m[3] + z * m[6] + m[9] * scale,
        x * m[1] + y * m[4] + z * m[7] + m[10] * scale,
        x * m[2] + y * m[5] + z * m[8] + m[11] * scale,
      );
    }
  }
}
