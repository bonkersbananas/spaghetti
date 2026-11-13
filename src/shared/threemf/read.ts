import type {
  ImageMediaType,
  Plate,
  PlateFilament,
  PlateObject,
  PrintSettings,
  ThreeMfKind,
  ThreeMfResult,
  Thumbnail,
} from "./types.ts";
import { childrenNamed, metadataMap, parseXml, type XmlNode } from "./xml.ts";
import { type EntryRule, readEntries } from "./zip.ts";

const KB = 1024;
const MB = 1024 * KB;

const SLICE_INFO = "Metadata/slice_info.config";
const MODEL_SETTINGS = "Metadata/model_settings.config";
const PROJECT_SETTINGS = "Metadata/project_settings.config";
const MODEL_HEAD = "3D/3dmodel.model";

const MAX_PLATES = 64;

/** Which entries to unpack, and how much of each. G-code and geometry are never in this list. */
function rule(name: string): EntryRule | undefined {
  if (name === SLICE_INFO || name === MODEL_SETTINGS) return { limit: 4 * MB };
  if (name === PROJECT_SETTINGS) return { limit: 8 * MB };
  // The top-level model holds the slicer's name up front; its geometry can be huge.
  if (name === MODEL_HEAD) return { limit: 16 * KB, truncate: true };
  if (/^Metadata\/plate_\d+\.json$/.test(name)) return { limit: 1 * MB };
  if (/^Metadata\/(plate_\d+|plate_no_light_\d+|top_\d+)\.(png|jpe?g|webp)$/i.test(name)) return { limit: 4 * MB };
  return undefined;
}

/**
 * Reads what Spaghetti cares about from a Bambu Studio or Orca Slicer `.3mf` (project or sliced).
 * Works on the bytes, with no network. Never throws: a broken or foreign file gives
 * `kind: "unknown"` or a partial result, with the reasons in `warnings`.
 */
export function readThreeMf(input: Uint8Array | ArrayBuffer): ThreeMfResult {
  const warnings: string[] = [];
  const result: ThreeMfResult = { kind: "unknown", plates: [], settings: {}, warnings };
  try {
    const data = input instanceof Uint8Array ? input : new Uint8Array(input);
    read(data, result);
  } catch (e) {
    warnings.push(`Unexpected error while reading: ${(e as Error).message}`);
  }
  return result;
}

/** Convenience for a dropped file or a fetched blob. */
export async function readThreeMfFile(file: Blob): Promise<ThreeMfResult> {
  try {
    return readThreeMf(await file.arrayBuffer());
  } catch (e) {
    return {
      kind: "unknown",
      plates: [],
      settings: {},
      warnings: [`Could not read the file: ${(e as Error).message}`],
    };
  }
}

function read(data: Uint8Array, out: ThreeMfResult): void {
  const warnings = out.warnings;
  const { files, names, warnings: zipWarnings } = readEntries(data, rule);
  warnings.push(...zipWarnings);
  if (names.length === 0) {
    if (zipWarnings.length === 0) warnings.push("This does not look like a .3mf (zip) file");
    return;
  }

  const text = (name: string): string | undefined => {
    const bytes = files.get(name);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  };
  const xml = (name: string): XmlNode | undefined => {
    const t = text(name);
    if (t === undefined) return undefined;
    const { root, truncated } = parseXml(t);
    if (truncated) warnings.push(`${name} is damaged; read what was possible`);
    return root;
  };

  const slicer = readSlicer(text(MODEL_HEAD));
  if (slicer) out.slicer = slicer;

  // Settings (JSON).
  let project: Record<string, unknown> | undefined;
  const projectText = text(PROJECT_SETTINGS);
  if (projectText !== undefined) {
    try {
      const parsed: unknown = JSON.parse(projectText);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) project = parsed as Record<string, unknown>;
      else warnings.push("project_settings.config is not a settings object");
    } catch {
      warnings.push("project_settings.config is not valid JSON");
    }
  }
  if (project) out.settings = readSettings(project);

  // Plates: model_settings (names, objects, project filaments), then slice_info (the slice).
  const plates = new Map<number, Plate>();
  let overflowed = false;
  const plate = (index: number): Plate | undefined => {
    let p = plates.get(index);
    if (!p) {
      if (plates.size >= MAX_PLATES) {
        if (!overflowed) warnings.push(`More than ${MAX_PLATES} plates; the rest are ignored`);
        overflowed = true;
        return undefined;
      }
      p = { index, objects: [], filaments: [] };
      plates.set(index, p);
    }
    return p;
  };

  const modelRoot = xml(MODEL_SETTINGS);
  const config = modelRoot && childrenNamed(modelRoot, "config")[0];
  const objectInfo = new Map<string, { name?: string; extruder?: number }>();
  const thumbFiles = new Map<number, string>();
  const projectFilamentsByPlate = new Map<number, Set<number>>();
  if (config) {
    for (const o of childrenNamed(config, "object")) {
      const id = o.attrs.id;
      if (id === undefined) continue;
      const meta = metadataMap(o);
      let extruder = toNum(meta.get("extruder"));
      for (const v of childrenNamed(o, "part")) extruder ??= toNum(metadataMap(v).get("extruder"));
      objectInfo.set(id, { name: meta.get("name"), extruder });
    }
    for (const pl of childrenNamed(config, "plate")) {
      const meta = metadataMap(pl);
      const index = toInt(meta.get("plater_id")) ?? toInt(meta.get("index"));
      if (index === undefined || index < 1) continue;
      const p = plate(index);
      if (!p) continue;
      const name = meta.get("plater_name");
      if (name) p.name = name;
      const bed = meta.get("bed_type");
      if (bed) p.bedType = bedTypeName(bed);
      const thumb = meta.get("thumbnail_file");
      if (thumb) thumbFiles.set(index, thumb.replace(/^\/+/, ""));
      const used = new Set<number>();
      for (const inst of childrenNamed(pl, "model_instance")) {
        const m = metadataMap(inst);
        const info = objectInfo.get(m.get("object_id") ?? "");
        if (!info) continue;
        p.objects.push({ name: info.name ?? "Object" });
        used.add(info.extruder ?? 1);
      }
      projectFilamentsByPlate.set(index, used);
    }
  }

  // Slice info.
  const sliceRoot = xml(SLICE_INFO);
  const sliceConfig = sliceRoot && childrenNamed(sliceRoot, "config")[0];
  let sliced = false;
  if (sliceConfig) {
    for (const pl of childrenNamed(sliceConfig, "plate")) {
      const meta = metadataMap(pl);
      const index = toInt(meta.get("index"));
      if (index === undefined || index < 1) {
        warnings.push("A plate in slice_info.config has no valid index; skipped");
        continue;
      }
      const p = plate(index);
      if (!p) continue;
      sliced = true;
      const seconds = toNum(meta.get("prediction"));
      if (seconds !== undefined) p.predictedSeconds = seconds;
      const grams = toNum(meta.get("weight"));
      if (grams !== undefined) p.weightGrams = grams;
      const support = toBool(meta.get("support_used"));
      if (support !== undefined) p.supportUsed = support;
      const nozzle = firstNum(meta.get("nozzle_diameters"));
      if (nozzle !== undefined) p.nozzleDiameter = nozzle;
      const sliceObjects: PlateObject[] = childrenNamed(pl, "object").map((o) => {
        const obj: PlateObject = { name: o.attrs.name || "Object" };
        if (o.attrs.skipped === "true") obj.skipped = true;
        return obj;
      });
      if (sliceObjects.length > 0) p.objects = sliceObjects;
      const filaments: PlateFilament[] = [];
      for (const f of childrenNamed(pl, "filament")) {
        const slot = toInt(f.attrs.id);
        if (slot === undefined || slot < 1) continue;
        const fil: PlateFilament = { slot };
        if (f.attrs.type) fil.type = f.attrs.type;
        const color = normalizeColor(f.attrs.color);
        if (color) fil.colorHex = color;
        const g = toNum(f.attrs.used_g);
        if (g !== undefined) fil.usedGrams = g;
        const m = toNum(f.attrs.used_m);
        if (m !== undefined) fil.usedMeters = m;
        filaments.push(fil);
      }
      filaments.sort((a, b) => a.slot - b.slot);
      p.filaments = filaments;
    }
  }

  // plate_N.json (layout): fills in what the other files left out.
  const plateFileRe = /^Metadata\/plate_(\d+)\.(json|png|jpe?g|webp)$/i;
  for (const name of names) {
    const m = plateFileRe.exec(name);
    if (m && Number(m[1]) >= 1 && !plates.has(Number(m[1]))) plate(Number(m[1]));
  }
  const bedTypeOverall = out.settings.bedType;
  for (const p of plates.values()) {
    const json = text(`Metadata/plate_${p.index}.json`);
    if (json !== undefined) {
      try {
        const j: unknown = JSON.parse(json);
        if (j && typeof j === "object") {
          const o = j as Record<string, unknown>;
          if (typeof o.bed_type === "string" && o.bed_type && !p.bedType) p.bedType = bedTypeName(o.bed_type);
          const nd = toNum(o.nozzle_diameter);
          if (nd !== undefined && p.nozzleDiameter === undefined) p.nozzleDiameter = round(nd);
        }
      } catch {
        warnings.push(`Metadata/plate_${p.index}.json is not valid JSON`);
      }
    }
    p.bedType ??= bedTypeOverall;
    const thumb = findThumbnail(p.index, thumbFiles.get(p.index), files);
    if (thumb) p.thumbnail = thumb;

    // A project file has no slice: guess the filaments from the objects' extruders.
    if (p.filaments.length === 0 && !sliced) {
      const types = project ? asStrings(project.filament_type) : [];
      const colours = project ? asStrings(project.filament_colour) : [];
      const profiles = project ? asStrings(project.filament_settings_id) : [];
      const slots = [...(projectFilamentsByPlate.get(p.index) ?? [])].sort((a, b) => a - b);
      p.filaments = slots.map((slot) => {
        const f: PlateFilament = { slot };
        if (types[slot - 1]) f.type = types[slot - 1];
        const c = normalizeColor(colours[slot - 1]);
        if (c) f.colorHex = c;
        if (profiles[slot - 1]) f.profile = profiles[slot - 1];
        return f;
      });
    } else if (project) {
      const profiles = asStrings(project.filament_settings_id);
      const types = asStrings(project.filament_type);
      const colours = asStrings(project.filament_colour);
      for (const f of p.filaments) {
        if (profiles[f.slot - 1]) f.profile = profiles[f.slot - 1];
        f.type ??= types[f.slot - 1] || undefined;
        f.colorHex ??= normalizeColor(colours[f.slot - 1]);
        if (f.type === undefined) delete f.type;
        if (f.colorHex === undefined) delete f.colorHex;
      }
    }
    if (p.nozzleDiameter === undefined && out.settings.nozzleDiameter !== undefined) {
      p.nozzleDiameter = out.settings.nozzleDiameter;
    }
  }

  out.plates = [...plates.values()].sort((a, b) => a.index - b.index);
  const kind: ThreeMfKind = sliced ? "sliced" : out.plates.length > 0 || project ? "project" : "unknown";
  out.kind = kind;
  if (kind === "unknown" && warnings.length === 0)
    warnings.push("No Bambu Studio or Orca Slicer data found in this file");
}

function readSlicer(head: string | undefined): { name: string; version?: string } | undefined {
  if (!head) return undefined;
  const m = /<metadata\s+name="Application"[^>]*>([^<]*)</.exec(head);
  const app = m?.[1]?.trim();
  if (!app) return undefined;
  // "BambuStudio-02.01.00.00", "OrcaSlicer-2.3.0", "OrcaSlicer-2.5.0-dev"
  const v = /^(.*?)[-\s]v?(\d+(?:\.\d+)+[\w.-]*)$/.exec(app);
  return v?.[1] ? { name: v[1], version: v[2] } : { name: app };
}

function findThumbnail(
  index: number,
  declared: string | undefined,
  files: Map<string, Uint8Array>,
): Thumbnail | undefined {
  const candidates = [
    declared,
    `Metadata/plate_${index}.png`,
    `Metadata/plate_no_light_${index}.png`,
    `Metadata/top_${index}.png`,
  ];
  for (const c of candidates) {
    const bytes = c ? files.get(c) : undefined;
    const mediaType = bytes && sniffImage(bytes);
    if (bytes && mediaType) return { bytes, mediaType };
  }
  return undefined;
}

export function sniffImage(b: Uint8Array): ImageMediaType | undefined {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length > 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45
  )
    return "image/webp";
  return undefined;
}

/**
 * A plate's bed type as the settings name it ("Textured PEI Plate"): plate_N.json and a plate's metadata write the
 * short key ("textured_plate") instead.
 */
const BED_TYPE_NAMES: Record<string, string> = {
  cool_plate: "Cool Plate",
  eng_plate: "Engineering Plate",
  hot_plate: "High Temp Plate",
  textured_plate: "Textured PEI Plate",
  supertack_plate: "Supertack Plate",
  textured_cool_plate: "Textured Cool Plate",
};
const bedTypeName = (value: string) => BED_TYPE_NAMES[value] ?? value;

// Bed temperature key per bed type name (PrintConfig.cpp, s_keys_map_BedType).
const BED_TEMP_KEYS: Record<string, string> = {
  "Cool Plate": "cool_plate_temp",
  "Engineering Plate": "eng_plate_temp",
  "High Temp Plate": "hot_plate_temp",
  "Textured PEI Plate": "textured_plate_temp",
  "Supertack Plate": "supertack_plate_temp",
};

function readSettings(p: Record<string, unknown>): PrintSettings {
  const s: PrintSettings = {};
  const set = <K extends keyof PrintSettings>(k: K, v: PrintSettings[K] | undefined) => {
    if (v !== undefined && !(Array.isArray(v) && v.length === 0)) s[k] = v;
  };
  set("printerModel", str(p.printer_model));
  set("printerPreset", str(p.printer_settings_id));
  set("processPreset", str(p.print_settings_id));
  set("layerHeight", toNum(first(p.layer_height)));
  set("initialLayerHeight", toNum(first(p.initial_layer_print_height)));
  set("infillDensity", toNum(String(first(p.sparse_infill_density) ?? "").replace("%", "")));
  set("infillPattern", str(p.sparse_infill_pattern));
  set("wallLoops", toInt(first(p.wall_loops)));
  set("supportEnabled", toBool(first(p.enable_support)));
  set("supportType", str(p.support_type));
  set("nozzleTemperature", numbers(p.nozzle_temperature));
  set("nozzleTemperatureInitialLayer", numbers(p.nozzle_temperature_initial_layer));
  const bed = str(p.curr_bed_type);
  set("bedType", bed);
  const bedKey = bed ? BED_TEMP_KEYS[bed] : undefined;
  if (bedKey) set("bedTemperature", numbers(p[bedKey]));
  set("nozzleDiameter", toNum(first(p.nozzle_diameter)));
  return s;
}

// ---- value helpers: settings are strings or arrays of strings; XML values are strings.

function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function str(v: unknown): string | undefined {
  const x = first(v);
  return typeof x === "string" && x !== "" ? x : undefined;
}

function asStrings(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : ""));
  return typeof v === "string" ? [v] : [];
}

function numbers(v: unknown): number[] | undefined {
  const list = Array.isArray(v) ? v : v === undefined ? [] : [v];
  const out = list.map(toNum);
  return out.length > 0 && out.every((n) => n !== undefined) ? (out as number[]) : undefined;
}

function toNum(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string" || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toInt(v: unknown): number | undefined {
  const n = toNum(v);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function toBool(v: unknown): boolean | undefined {
  const x = first(v);
  if (x === true || x === "1" || x === "true") return true;
  if (x === false || x === "0" || x === "false") return false;
  return undefined;
}

/** "0.4" or "0.4,0.4" (slice_info) → first number. */
function firstNum(v: string | undefined): number | undefined {
  return v === undefined ? undefined : toNum(v.split(/[,\s]+/)[0]);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "#00AE42", "#00AE42FF", "00AE42" → "#00ae42". */
function normalizeColor(v: string | undefined): string | undefined {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v?.trim() ?? "");
  return m?.[1] ? `#${m[1].toLowerCase()}` : undefined;
}
