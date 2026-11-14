import { strFromU8, unzipSync } from "fflate";
import { boundsOf, plateArea, translate } from "./arrange.ts";
import type { Config } from "./gcode3mf.ts";
import { type ModelPaint, paintCodeStates } from "./paint.ts";

/**
 * Reads the geometry of a `.3mf` that has no G-code: a Bambu Studio or Orca project, or a plain 3MF from anywhere
 * else (PrusaSlicer, Fusion, a model site). Every printable object becomes one triangle soup in plate coordinates
 * (millimetres, the build item's transform applied). For a Bambu or Orca project with plates, only the objects of
 * one plate are read (the first, unless asked for another), moved from the plate's spot in Bambu's grid onto the
 * bed, and its settings come along. Never throws: a file it can't read gives a reason.
 */

/** One plate of a Bambu or Orca project. */
export interface ModelPlate {
  /** The project's own number for it (1 is the first): what Bambu Studio shows as "01". */
  index: number;
  /** What the project calls it; empty when it doesn't (as most don't). */
  name: string;
  /** The names of the objects on it, in the file's order. */
  objects: string[];
  /** The top of its tallest object, in mm. */
  height: number;
  /** Where its picture is in the file (Metadata/plate_N.png), when it has one: see readModelPlatePicture. */
  picture?: string;
}

/** A colour a model brings: lowercase "#rrggbb" (alpha dropped) and the name the file gives it, when it does. */
export interface ModelColour {
  hex: string;
  name?: string;
}

/** The triangles `from` (the first) `to` (past the last) of an object's `positions` that print in one colour. */
export interface ModelColourRun {
  from: number;
  to: number;
  colour: ModelColour;
}

export interface ModelObject {
  name: string;
  /** Nine floats a triangle, in mm, where the file puts it. */
  positions: Float32Array;
  /** The filament the project gives it (1 is the first), when it says. */
  extruder?: number;
  /**
   * When a project's object is made of parts that print in different filaments: each part, in the object's order of
   * them, as the triangles of `positions` it is (its own and its sub-parts', one after another).
   */
  parts?: ModelPart[];
  /**
   * A project's painted colours on it (each painted triangle's `paint_color`, as Orca reads it), when it has any:
   * codes that aren't ones, or paint nothing, are left out, as Orca leaves them.
   */
  paint?: ModelPaint;
  /**
   * The colours the model gives it, as runs of its triangles in order (one run covering all of them when it is one
   * colour; triangles in none have no colour of their own). From the 3MF core's `basematerials` an object (or the
   * component it comes through) points at, or, in a Bambu or Orca project, from the colour of the filament it prints
   * in. A colour on single triangles (`colorgroup`) and painted colours aren't read here.
   */
  colours?: ModelColourRun[];
}

/** A part of an object: its triangles `from` (the first) `to` (past the last), and its filament, when it says. */
export interface ModelPart {
  from: number;
  to: number;
  /** Its own filament (1 is the first), else its object's. */
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
  /** Every plate of a project that lists them (one or more, in order); none for any other file. */
  plates: ModelPlate[];
  /** The plate `objects` are of: its `index`; 0 when the file has no plates. */
  plate: number;
}

export interface ReadOptions {
  /** The plate to read (a `ModelPlate.index`); the first when absent or not one of them. */
  plate?: number;
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

/** "#D2281EFF", "#d2281e" or "D2281E" as "#d2281e" (alpha dropped); undefined for anything else. */
export function colourHex(text: string | undefined): string | undefined {
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((text ?? "").trim());
  return match ? `#${(match[1] as string).toLowerCase()}` : undefined;
}

/** The `basematerials` groups of one model file: id, then each base's colour in order (undefined: unreadable). */
function readMaterials(text: string): Map<string, (ModelColour | undefined)[]> {
  const groups = new Map<string, (ModelColour | undefined)[]>();
  for (const match of text.matchAll(/<(?:\w+:)?basematerials\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?basematerials>/g)) {
    const id = attributes(match[1] as string).id;
    if (id === undefined) continue;
    const bases: (ModelColour | undefined)[] = [];
    for (const base of (match[2] as string).matchAll(/<(?:\w+:)?base\b[^>]*>/g)) {
      const attrs = attributes(base[0]);
      const hex = colourHex(attrs.displaycolor);
      const name = attrs.name?.trim();
      bases.push(hex ? { hex, ...(name ? { name: decodeXml(name) } : {}) } : undefined);
    }
    groups.set(id, bases);
  }
  return groups;
}

function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface Mesh {
  vertices: Float64Array;
  /** Corner indices, three a triangle (NaN where a file wrote something else). */
  triangles: Float64Array;
  /** Painted triangles' codes (`paint_color`), by their index in the mesh. */
  paint?: Map<number, string>;
}

interface ObjectDef {
  id: string;
  name?: string;
  /** The colour its `pid` and `pindex` point at, in this file's `basematerials`. */
  colour?: ModelColour;
  type: string;
  mesh?: Mesh;
  components: { file: string; id: string; transform: Matrix }[];
}

/** The objects of one model file, by id. */
function readModelFile(text: string, file: string, scale: { value: number }): Map<string, ObjectDef> {
  const objects = new Map<string, ObjectDef>();
  const materials = readMaterials(text);
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
    const own = attrs.pid === undefined ? undefined : materials.get(attrs.pid)?.[Number(attrs.pindex ?? 0)];
    if (own) def.colour = own;
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
  /** Each `<name …>` element (not `<names>`: the list around them starts the same). */
  const each = (name: string, visit: (tag: string) => void) => {
    let at = 0;
    for (;;) {
      const start = body.indexOf(`<${name}`, at);
      if (start < 0) break;
      const end = body.indexOf(">", start);
      if (end < 0) break;
      const next = body.charAt(start + name.length + 1);
      if (next === " " || next === "\t" || next === "\n" || next === "\r" || next === "/")
        visit(body.slice(start, end));
      at = end;
    }
  };
  const paint = new Map<number, string>();
  each("vertex", (tag) => vertices.push(number(tag, "x"), number(tag, "y"), number(tag, "z")));
  each("triangle", (tag) => {
    // Bambu Studio and Orca write a painted triangle's colours in its `paint_color`.
    const at = tag.indexOf(' paint_color="');
    if (at >= 0) {
      const code = tag.slice(at + 14, tag.indexOf('"', at + 14));
      if (code) paint.set(triangles.length / 3, code);
    }
    triangles.push(number(tag, "v1"), number(tag, "v2"), number(tag, "v3"));
  });
  return {
    vertices: Float64Array.from(vertices),
    triangles: Float64Array.from(triangles),
    ...(paint.size ? { paint } : {}),
  };
}

export function readModel3mf(input: Uint8Array, options: ReadOptions = {}): Model3mf | Model3mfProblem {
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
  const objectInfo = new Map<
    string,
    { name?: string; extruder?: number; skipParts: Set<string>; partExtruders: Map<string, number> }
  >();
  /** The plates a project lists, and which plate each object's instance (object id, then ":", then its number) is on. */
  const plateList: (ModelPlate & { name: string })[] = [];
  const plateOf = new Map<string, number>();
  if (settingsText) {
    const text = strFromU8(settingsText);
    for (const match of text.matchAll(/<object\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/object>/g)) {
      const body = match[2] as string;
      const meta = (scope: string, key: string) =>
        new RegExp(`<metadata\\s+key="${key}"\\s+value="([^"]*)"`).exec(scope)?.[1];
      const head = body.split("<part")[0] ?? "";
      const skipParts = new Set<string>();
      const partExtruders = new Map<string, number>();
      // Each part, with its settings when it has any (`<part …/>` has none).
      for (const part of body.matchAll(/<part\s+id="([^"]+)"\s+subtype="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/part>)/g)) {
        if (part[2] !== "normal_part") skipParts.add(part[1] as string);
        const own = Number(meta(part[3] ?? "", "extruder"));
        if (Number.isInteger(own) && own > 0) partExtruders.set(part[1] as string, own);
      }
      const extruder = Number(meta(head, "extruder"));
      objectInfo.set(match[1] as string, {
        name: meta(head, "name"),
        ...(Number.isInteger(extruder) && extruder > 0 ? { extruder } : {}),
        skipParts,
        partExtruders,
      });
    }
    for (const match of text.matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
      const body = match[1] as string;
      const meta = (scope: string, key: string) =>
        new RegExp(`<metadata\\s+key="${key}"\\s+value="([^"]*)"`).exec(scope)?.[1];
      const index = Number(meta(body.split("<model_instance")[0] ?? "", "plater_id"));
      if (!Number.isInteger(index) || index < 1 || plateList.some((plate) => plate.index === index)) continue;
      for (const instance of body.matchAll(/<model_instance>([\s\S]*?)<\/model_instance>/g)) {
        const object = meta(instance[1] as string, "object_id");
        if (object !== undefined) plateOf.set(`${object}:${meta(instance[1] as string, "instance_id") ?? 0}`, index);
      }
      const picture = meta(body, "thumbnail_file") ?? meta(body, "top_file");
      plateList.push({
        index,
        name: decodeXml(meta(body, "plater_name") ?? "").trim(),
        objects: [],
        height: 0,
        ...(picture ? { picture } : {}),
      });
    }
    plateList.sort((a, b) => a.index - b.index);
  }

  // The colours of the filaments a project lists, filament 1 first.
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
  const filamentColours = [settings?.filament_colour ?? []].flat().map((hex) => colourHex(hex));

  // Bambu lays its plates out in a grid, columns left to right and rows going down (y falling), each 1.2 bed
  // sizes from the next: a plate's objects sit at its grid spot, and go back to the first plate's when sliced.
  const bed = plateArea(settings?.printable_area, undefined);
  const columns = gridColumns(plateList.length);
  const chosen = plateList.find((plate) => plate.index === options.plate) ?? plateList[0];
  const out: ModelObject[] = [];
  const instances = new Map<string, number>();
  for (const item of items) {
    const id = item.objectid ?? "";
    const instance = instances.get(id) ?? 0;
    instances.set(id, instance + 1);
    if (item.printable === "0") continue;
    const plateIndex = plateOf.get(`${id}:${instance}`);
    if (plateList.length > 0 && plateIndex === undefined) continue;
    const def = rootObjects.get(id);
    if (!def || (def.type !== "model" && def.type !== "")) continue;
    const info = objectInfo.get(id);
    const triangles: number[] = [];
    // Which part each run of triangles is of: the object's own component it comes through (null: the object's own).
    const runs: { part: string | null; from: number; to: number; colour?: ModelColour }[] = [];
    const painted: Painted = { triangles: [], codes: [] };
    const visit = (
      object: ObjectDef,
      transform: Matrix,
      depth: number,
      part: string | null,
      inherited: ModelColour | undefined,
    ) => {
      if (depth > 8) return;
      // An object's own colour covers what is under it, unless that has one of its own.
      const colour = object.colour ?? inherited;
      if (object.mesh) {
        const from = triangles.length / 9;
        appendMesh(object.mesh, transform, scale.value, triangles, painted);
        if (triangles.length / 9 > from)
          runs.push({ part, from, to: triangles.length / 9, ...(colour ? { colour } : {}) });
      }
      for (const component of object.components) {
        if (info?.skipParts.has(component.id)) continue;
        const child = modelFile(component.file).get(component.id);
        if (child && (child.type === "model" || child.type === "")) {
          visit(child, multiply(component.transform, transform), depth + 1, part ?? component.id, colour);
        }
      }
    };
    visit(def, matrix(item.transform), 0, null, undefined);
    if (!triangles.length) continue;
    const parts = partsOf(runs, info);
    const paint = paintOf(painted);
    const plate = plateList.find((candidate) => candidate.index === plateIndex);
    const positions = Float32Array.from(triangles);
    if (plate) {
      const spot = plateList.indexOf(plate);
      translate(
        positions,
        -(spot % columns) * 1.2 * (bed.maxX - bed.minX),
        Math.floor(spot / columns) * 1.2 * (bed.maxY - bed.minY),
        0,
      );
    }
    const name = info?.name || def.name || `Object ${out.length + 1}`;
    if (plate) {
      plate.objects.push(name);
      plate.height = Math.max(plate.height, boundsOf(positions).max[2]);
    }
    if (plate !== chosen) continue;
    const colours = coloursOf(runs, info, filamentColours, project);
    out.push({
      name,
      positions,
      ...(info?.extruder ? { extruder: info.extruder } : {}),
      ...(parts ? { parts } : {}),
      ...(paint ? { paint } : {}),
      ...(colours ? { colours } : {}),
    });
  }
  if (!out.length) return "no-objects";
  return {
    objects: out,
    project,
    ...(settings ? { settings } : {}),
    sliced,
    plates: plateList,
    plate: chosen?.index ?? 0,
  };
}

/** How many columns Bambu Studio's grid of `count` plates has: the square root, rounded, and one more if that fell short. */
function gridColumns(count: number): number {
  const root = Math.sqrt(count);
  const rounded = Math.round(root);
  return Math.max(1, root > rounded ? rounded + 1 : rounded);
}

/** A plate's picture out of a project (`ModelPlate.picture`'s path): the PNG's bytes, if the file has it. */
export function readModelPlatePicture(input: Uint8Array, picture: string): Uint8Array | undefined {
  try {
    const found = unzipSync(input, { filter: (entry) => entry.name === picture });
    return found[picture];
  } catch {
    return undefined;
  }
}

/**
 * The colours an object's triangles print in, as runs (neighbours of one colour joined). A Bambu or Orca project
 * prints each part in its filament, so there the filament's colour is the part's; any other file says its own, in the
 * materials its objects point at. Triangles that have none are left out of the runs.
 */
function coloursOf(
  runs: { part: string | null; from: number; to: number; colour?: ModelColour }[],
  info: { extruder?: number; partExtruders: Map<string, number> } | undefined,
  filamentColours: (string | undefined)[],
  project: boolean,
): ModelColourRun[] | undefined {
  const out: ModelColourRun[] = [];
  for (const run of runs) {
    const extruder = (run.part === null ? undefined : info?.partExtruders.get(run.part)) ?? info?.extruder ?? 1;
    const hex = project ? filamentColours[extruder - 1] : undefined;
    const colour = hex ? { hex } : run.colour;
    if (!colour) continue;
    const last = out[out.length - 1];
    if (last && last.to === run.from && last.colour.hex === colour.hex && last.colour.name === colour.name) {
      last.to = run.to;
    } else out.push({ from: run.from, to: run.to, colour });
  }
  return out.length ? out : undefined;
}

/**
 * An object's parts, when they print in different filaments (else undefined): each run of triangles of one part,
 * runs of the same part one after another joined, with the part's filament (its own, else the object's).
 */
function partsOf(
  runs: { part: string | null; from: number; to: number }[],
  info: { extruder?: number; partExtruders: Map<string, number> } | undefined,
): ModelPart[] | undefined {
  const extruderOf = (part: string | null) =>
    (part === null ? undefined : info?.partExtruders.get(part)) ?? info?.extruder;
  const parts: (ModelPart & { part: string | null })[] = [];
  for (const run of runs) {
    const last = parts[parts.length - 1];
    if (last && last.part === run.part && last.to === run.from) {
      last.to = run.to;
      continue;
    }
    const extruder = extruderOf(run.part);
    parts.push({ part: run.part, from: run.from, to: run.to, ...(extruder ? { extruder } : {}) });
  }
  const filaments = new Set(parts.map((part) => part.extruder ?? 1));
  if (filaments.size < 2) return undefined;
  return parts.map(({ from, to, extruder }) => ({ from, to, ...(extruder ? { extruder } : {}) }));
}

/** An object's painted triangles as they are read: each one's index in the object, and its code. */
interface Painted {
  triangles: number[];
  codes: string[];
}

/** The paint of an object, its codes checked (none: undefined). */
function paintOf(painted: Painted): ModelPaint | undefined {
  const triangles: number[] = [];
  const ends: number[] = [];
  let codes = "";
  for (const [index, code] of painted.codes.entries()) {
    const states = paintCodeStates(code);
    // A code Orca can't read, or one that paints nothing (state 0 only): the triangle is the object's own.
    if (states === null || states <= 1) continue;
    triangles.push(painted.triangles[index] as number);
    codes += code;
    ends.push(codes.length);
  }
  if (!triangles.length) return undefined;
  return { triangles: Uint32Array.from(triangles), codes, ends: Uint32Array.from(ends) };
}

function appendMesh(mesh: Mesh, m: Matrix, scale: number, out: number[], painted?: Painted) {
  const v = mesh.vertices;
  const t = mesh.triangles;
  const count = v.length / 3;
  for (let i = 0; i + 2 < t.length; i += 3) {
    const a = t[i] as number;
    const b = t[i + 1] as number;
    const c = t[i + 2] as number;
    // A corner that isn't one of the mesh's vertices leaves the triangle out.
    if (![a, b, c].every((index) => Number.isInteger(index) && index >= 0 && index < count)) continue;
    const code = mesh.paint?.get(i / 3);
    if (code !== undefined && painted) {
      painted.triangles.push(out.length / 9);
      painted.codes.push(code);
    }
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
