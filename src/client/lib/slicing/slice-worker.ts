/// <reference lib="webworker" />
import { MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { layMeshDown, parseStl, scaleMesh } from "@shared/mesh";
import { arrangeOnPlate, type Box, boundsOf, fitsAsPlaced, plateArea, translate } from "@shared/slicing/arrange.ts";
import { type ColourUse, type ProjectFilament, planColours, planProject, slotKey } from "@shared/slicing/colours.ts";
import { MissingPreset, mergedSettings, type PresetSet, type SliceSetup, sliceSetup } from "@shared/slicing/configs.ts";
import { withoutStandIns } from "@shared/slicing/filaments.ts";
import { finiteTriangles, fitPercent, sizeOf } from "@shared/slicing/fit.ts";
import type { Config } from "@shared/slicing/gcode3mf.ts";
import { packGcode3mf, summarizeGcode } from "@shared/slicing/gcode3mf.ts";
import { colourHex, type ModelColourRun, readModel3mf } from "@shared/slicing/model3mf.ts";
import { presetRecord, STAND_IN_COLOURS } from "@shared/slicing/orca.ts";
import { type ModelPaint, paintBetween, paintLeaves, paintWithin } from "@shared/slicing/paint.ts";
import { renderPlate } from "@shared/slicing/render.ts";
import { type SlicerId, type SlicingSettings, slicingFor } from "@shared/slicing/settings.ts";
import { cautionsOf, rustEstimateMs, type SlicerWarning } from "@shared/slicing/slicers.ts";
import type {
  FileSlice,
  SliceCaution,
  SliceColour,
  SliceFallback,
  SliceOptions,
  SliceProblem,
  SliceSettings,
} from "@shared/slicing/types.ts";
import type { SpoolLike } from "@shared/spools.ts";
import { settingsFromFile, slicerName } from "@shared/threemf/prefill.ts";
import { readThreeMf } from "@shared/threemf/read.ts";
import { withFins } from "./fins";
import { type OurObject, type OurPart, type OursAnswer, sliceOurs } from "./ours";

/**
 * Slices one model off the main thread: reads the .stl or .3mf, puts its objects on the X2D's plate, draws the plate
 * picture, and slices it with the slicer asked for (decision 0055): Spaghetti's own (its WebAssembly module, run here,
 * ours.ts), which packs its own .gcode.3mf, or OrcaSlicer's engine (its host is a worker of its own, started here by
 * URL, docs/slicer.md), whose G-code is packed here. What ours can't slice yet, the engine slices. Everything it says
 * comes back as messages; `sliceModel` (slice-model.ts) is the way in.
 */

export interface SliceRequest {
  file: Blob;
  name: string;
  /** The settings chosen: they win over a 3MF project's own and `defaults`. */
  chosen: SliceOptions;
  /** What the rest is sliced with: the workshop's defaults (shared/slicing/pantry.ts). */
  defaults: SlicingSettings;
  /** The Pantry's spools: a model with colours of its own is matched to them. */
  spools: SpoolLike[];
  /** Where the engine is (absolute `base`, the host's file name in it) and its release. */
  engine: { base: string; host: string; version: string };
  /** Where Spaghetti's own slicer is (absolute `base`, its module's file in it) and its release; null where it isn't served. */
  rust: { base: string; wasm: string; version: string } | null;
}

export type SlicePhase = "reading" | "engine" | "slicing" | "packing";

export type SliceMessage =
  /** `expectMs`: a step that can't say how far it is takes about this long (our slicer's one call). */
  | { type: "progress"; phase: SlicePhase; fraction: number; expectMs?: number }
  | { type: "picture"; png: Blob }
  | {
      type: "done";
      sliced: Uint8Array;
      png: Blob | null;
      /** The plate in the model's own colours, when it has colours that were matched. */
      originalPng?: Blob | null;
      slice: FileSlice;
      prefill: AttemptSettings;
      objects: string[];
      slicer: string | null;
    }
  | { type: "failed"; slice: FileSlice; png: Blob | null };

/** A project's filament that says no colour: a neutral grey, for its swatch and the picture. */
const NO_COLOUR = "#8c8c8c"; // design-lint-ignore: a filament's colour is data

/** A filament's colour when nothing says one (the stand-in's first: Orca's own). */
const FALLBACK_COLOUR = STAND_IN_COLOURS[0];
/** Plate pictures are drawn at the size Bambu Studio and Orca use. */
const PICTURE = 512;
/** Room kept free round the edge of the plate when scaling to fit, in mm. */
const FIT_MARGIN = 5;

interface Placed {
  name: string;
  positions: Float32Array;
  /** Filament number, from 1. */
  extruder: number;
  /**
   * A project's object made of parts in different filaments: each part's triangles of `positions` (`from` the first,
   * `to` past the last) and its filament. Turning, scaling and placing keep the triangles in order; fins are added
   * after the last part.
   */
  parts?: { from: number; to: number; extruder: number }[];
  /**
   * A project's painted colours on it, in the filaments the project lists: either slicer prints them. Its triangles
   * are those of `positions`, which turning, scaling and placing keep in order (fins are added after them).
   */
  paint?: ModelPaint;
  /** The colours the model gives it, as runs of its triangles (a plain 3MF's, matched to filaments by `matchColours`). */
  colours?: ModelColourRun[];
  /** Its parts print in the filaments its colours were matched to: the engine gets each part as an object. */
  byColour?: boolean;
}

class Problem extends Error {
  readonly problem: SliceProblem;
  readonly extra: Partial<FileSlice>;
  constructor(problem: SliceProblem, extra: Partial<FileSlice> = {}) {
    super(problem);
    this.problem = problem;
    this.extra = extra;
  }
}

let host: Worker | null = null;

self.onmessage = (event: MessageEvent<SliceRequest | "cancel">) => {
  if (event.data === "cancel") {
    host?.terminate();
    self.close();
    return;
  }
  void run(event.data);
};

function post(message: SliceMessage, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer });
}

let lastProgress = 0;
function progress(phase: SlicePhase, fraction: number) {
  const now = performance.now();
  if (now - lastProgress < 120 && fraction < 1) return;
  lastProgress = now;
  post({ type: "progress", phase, fraction: Math.max(0, Math.min(1, fraction)) });
}

async function run(request: SliceRequest) {
  const { chosen, defaults, engine } = request;
  // What it is asked for, whole; once the presets are read, what it is sliced with (a project's own included).
  let slicing = slicingFor(chosen, defaults);
  const scale = slicing.scale;
  let settings: Omit<SliceSettings, "scale" | "engine" | "orca"> = presetRecord(slicing);
  let orca = "";
  let png: Blob | null = null;
  // The slicer that made it, once one has; why the engine stepped in for ours, when it did.
  let by: SlicerId | null = null;
  let fallback: SliceFallback | undefined;
  let colourRows: SliceColour[] | undefined;
  let originalPng: Blob | null = null;
  let plateOf: FileSlice["plate"];
  const slice = (extra: Omit<FileSlice, "settings" | "at">): FileSlice => ({
    ...extra,
    ...(fallback ? { fallback } : {}),
    ...(colourRows ? { colours: colourRows, ...(originalPng ? { originalPicture: true } : {}) } : {}),
    ...(plateOf ? { plate: plateOf } : {}),
    settings: {
      ...settings,
      scale,
      engine: engine.version,
      orca,
      slicing,
      ...(by ? { slicer: by } : {}),
      ...(by === "spaghetti" && request.rust ? { rust: request.rust.version } : {}),
    },
    at: Date.now(),
  });
  try {
    progress("reading", 0);
    const bytes = new Uint8Array(await request.file.arrayBuffer());
    const read = readModel(bytes, request.name, chosen.modelPlate);
    // A model with colours of its own prints each in the filament matched to it.
    // A project in several filaments prints each in the spool matched to it, its numbers kept.
    const matched = read.project
      ? matchProject(read.objects, read.settings, read.painted, request.spools, chosen)
      : matchColours(read.objects, request.spools, chosen);
    colourRows = matched?.rows;
    plateOf = read.plate;
    const asked: SliceOptions = matched ? { ...chosen, filaments: matched.filaments } : chosen;
    progress("reading", 0.5);

    const presets = await fetchJson<PresetSet>(new URL("presets.json", engine.base));
    orca = presets.orca.version;
    // The filaments the objects print in, and those painted on them.
    const filamentCount = Math.max(
      ...read.objects.map((object) => object.extruder),
      read.painted,
      matched?.filaments.length ?? 0,
    );
    const setup = sliceSetup(presets, {
      settings: asked,
      defaults,
      ...(read.settings ? { project: { settings: read.settings } } : {}),
      filaments: filamentCount,
    });
    settings = setup.settings;
    slicing = withChoices(setup.slicing, chosen);
    const oursSlices = slicing.slicer === "spaghetti";
    // Ours prints each part of an object made of parts in its own filament (add_part), so its setup has every
    // filament the parts use; OrcaSlicer's engine gets each object whole, in the object's filament, as before.
    const partFilaments = Math.max(
      filamentCount,
      ...read.objects.flatMap((object) => object.parts?.map((part) => part.extruder) ?? []),
    );
    const oursSetup =
      oursSlices && partFilaments > filamentCount
        ? sliceSetup(presets, {
            settings: asked,
            defaults,
            ...(read.settings ? { project: { settings: read.settings } } : {}),
            filaments: partFilaments,
          })
        : setup;
    const plate = plateArea(setup.machine.printable_area, first(setup.machine.printable_height));
    const volume: [number, number, number] = [plate.maxX - plate.minX, plate.maxY - plate.minY, plate.height];

    // Laid on another face (settings.ts `orientation`): every object turned the same way, then set on the plate.
    const down = slicing.orientation;
    const objects = read.objects.map((object) => {
      const turned = down ? layMeshDown({ positions: object.positions }, down).positions : object.positions;
      // Scaled about the origin (shared/mesh.ts, as Twists scales): the plate's arrangement places it after.
      return { ...object, positions: scale === 100 ? turned : scaleMesh({ positions: turned }, scale / 100).positions };
    });
    // Ours prints an object made of parts in different filaments part by part, so its picture shows the parts in their
    // colours (the engine prints it whole: drawn again if it steps in).
    const byParts = (oursSlices || !!matched) && objects.some((object) => partsOf(object));
    try {
      place(objects, plate, volume, read.project && scale === 100 && !down, scale);
    } catch (error) {
      // A model that doesn't fit still gets its picture, as it is.
      png = await picture(objects, oursSetup, byParts);
      throw error;
    }
    // Fins are the model's own walls: built on the part as it lies on the plate, appended to it.
    if (slicing.supports === "fins") {
      for (const object of objects) {
        object.positions = await withFins(object.positions, {
          layerHeight: slicing.layerHeight,
          nozzle: slicing.nozzle,
        }).then((fins) => fins.positions);
      }
    }
    progress("reading", 1);

    // The picture as it will print: with ours, an object's parts each in its filament's colour.
    png = await picture(objects, oursSetup, byParts);
    if (png) post({ type: "picture", png });
    if (matched) {
      const project = (matched as { originalColours?: string[] }).originalColours;
      originalPng = project
        ? await picture(objects, { ...oursSetup, colours: project }, byParts)
        : await originalPicture(objects, oursSetup);
    }

    for (const each of new Set([setup, oursSetup])) {
      const tower = objects.length && each.filaments.length > 1 ? towerSpot(objects, plate, each) : null;
      if (tower) {
        each.process.wipe_tower_x = [String(Math.round(tower.x))];
        each.process.wipe_tower_y = [String(Math.round(tower.y))];
      }
    }
    // Spaghetti's own slicer when it is asked for; OrcaSlicer's engine for what ours can't slice yet (decision 0055).
    const ours = oursSlices ? await withOurs(request, oursSetup, objects, slicing) : null;
    if (ours && !ours.ok) fallback = ours.fallback;
    if (ours?.ok && oursSetup !== setup) {
      settings = oursSetup.settings;
      slicing = withChoices(oursSetup.slicing, chosen);
    } else if (ours && !ours.ok && byParts && !matched) {
      // The engine prints each object in its own filament: so does the picture.
      png = await picture(objects, setup, false);
      if (png) post({ type: "picture", png });
    }
    let sliced: Uint8Array;
    let ms: number;
    let cautions: SliceCaution[] = [];
    if (ours?.ok) {
      ({ sliced, ms } = ours);
      by = "spaghetti";
      cautions = cautionsOf(ours.warnings, slicing.supports);
    } else {
      const result = await sliceWithEngineFitted(engine, setup, objects, plate);
      by = "orca";
      cautions = cautionsOf(result.warnings, slicing.supports);
      progress("packing", 0);
      const packing = performance.now();
      const summary = summarizeGcode(result.gcode);
      sliced = packGcode3mf({
        gcode: result.gcode,
        ...(png ? { thumbnail: new Uint8Array(await png.arrayBuffer()) } : {}),
        seconds: result.stats.printTimeSeconds ?? summary.seconds,
        grams: result.stats.filamentG ?? null,
        layers: summary.layers,
        objects: objects.map((object, index) => ({
          name: object.name,
          box: boundsOf(object.positions),
          // The ids Orca labels the objects with in the G-code, which the printer skips them by.
          ...(summary.labels.length === objects.length ? { id: summary.labels[index] as number } : {}),
        })),
        settings: mergedSettings(setup),
        filaments: setup.filaments.map((filament, index) => ({
          type: first(filament.filament_type) ?? "PLA",
          colour: setup.colours[index] ?? FALLBACK_COLOUR,
          ...(summary.grams[index] !== undefined ? { usedGrams: summary.grams[index] } : {}),
          ...(summary.millimetres[index] !== undefined ? { usedMeters: (summary.millimetres[index] ?? 0) / 1000 } : {}),
        })),
        slicer: { name: "OrcaSlicer", version: orca },
        title: request.name,
      });
      ms = result.ms + (performance.now() - packing);
    }
    if (sliced.byteLength > MAX_SLICER_FILE_BYTES) throw new Problem("too-large");
    // What the app's own reader makes of it: the same settings a dropped .gcode.3mf would give.
    const reading = readThreeMf(sliced);
    progress("packing", 1);
    post(
      {
        type: "done",
        sliced,
        png,
        ...(colourRows && originalPng ? { originalPng } : {}),
        slice: slice({
          status: "sliced",
          bytes: sliced.byteLength,
          ...(cautions.length ? { cautions } : {}),
          ...(ours?.ok && ours.notes.length ? { notes: ours.notes } : {}),
          ms: Math.round(ms),
        }),
        prefill: withoutStandIns(settingsFromFile(reading, 1), (ours?.ok ? oursSetup : setup).chosen),
        objects: objects.map((object) => object.name),
        slicer: slicerName(reading) ?? null,
      },
      [sliced.buffer],
    );
  } catch (error) {
    const problem =
      error instanceof Problem
        ? { problem: error.problem, ...error.extra }
        : error instanceof EngineError
          ? engineProblem(error)
          : error instanceof MissingPreset
            ? { problem: "nozzle" as const }
            : { problem: "engine" as const };
    post({ type: "failed", slice: slice({ status: "failed", ...problem }), png });
  } finally {
    host?.terminate();
    host = null;
  }
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function fetchJson<T>(url: URL): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Problem("engine");
  }
  if (!response.ok) throw new Problem("engine");
  return (await response.json()) as T;
}

/**
 * Slices the placed objects with Spaghetti's own slicer, or says why the engine should (decision 0055): what ours
 * refuses or fails on. It warns of parts that float in the air as the engine does. Ours keeps the objects where they
 * were put and at the size they are (the setup's scale is 100: they are scaled already).
 */
async function withOurs(
  request: SliceRequest,
  setup: SliceSetup,
  objects: Placed[],
  slicing: SlicingSettings,
): Promise<OursAnswer> {
  const rust = request.rust;
  if (!rust) return { ok: false, fallback: { why: "unloaded" } };
  progress("engine", 0);
  const json = JSON.stringify({
    machine: setup.machine,
    process: setup.process,
    filaments: setup.filaments,
    colours: setup.colours,
    slicing: { ...setup.slicing, scale: 100 },
  });
  // On a plate in several filaments each object says which it prints in, as Orca's engine is told (`extruder`), and
  // an object made of parts in different filaments goes in part by part, each in its own. A project's painted colours
  // go with the object, or with each part, as the engine gets them (`paint.filaments`).
  const several = setup.filaments.length > 1;
  const ours: OurObject[] = objects.map((object) => {
    const parts = several ? partsOf(object) : null;
    return {
      name: object.name,
      positions: object.positions,
      ...(several ? { filament: object.extruder } : {}),
      ...(object.paint ? { paint: object.paint } : {}),
      ...(parts ? { parts } : {}),
    };
  });
  return sliceOurs(new URL(rust.wasm, rust.base), json, ours, () => {
    // Its one call can't say how far it is: the page paces the ring by about how long it takes.
    const layers = objects.reduce((sum, object) => sum + boundsOf(object.positions).max[2] / slicing.layerHeight, 0);
    const triangles = objects.reduce((sum, object) => sum + object.positions.length / 9, 0);
    post({ type: "progress", phase: "slicing", fraction: 0, expectMs: rustEstimateMs({ layers, triangles }) });
  });
}

/**
 * An object's parts as meshes of their own, each with its filament and the paint on it, when they print in more than
 * one (else null): the triangles after the last part (its fins) print with the object's filament.
 */
function partsOf(object: Placed): OurPart[] | null {
  const parts = object.parts;
  if (!parts?.length || new Set(parts.map((part) => part.extruder)).size < 2) return null;
  const out = parts.map((part): OurPart => {
    const paint = object.paint ? paintBetween(object.paint, part.from, part.to) : null;
    return {
      positions: object.positions.subarray(part.from * 9, part.to * 9),
      filament: part.extruder,
      ...(paint ? { paint } : {}),
    };
  });
  const end = Math.max(...parts.map((part) => part.to)) * 9;
  if (end < object.positions.length) out.push({ positions: object.positions.subarray(end), filament: object.extruder });
  return out;
}

/**
 * Matches the colours the objects bring to the Pantry's spools (or stand-ins) and sets each object's, and each run's,
 * filament. Null, leaving the objects as they are, when the model has fewer than two colours after simplifying (an
 * STL, a project, a one-colour model: it prints as it always did). A project keeps its own filaments.
 */
function matchColours(objects: Placed[], spools: readonly SpoolLike[], chosen: SliceOptions) {
  const uses: ColourUse[] = [];
  for (const object of objects) {
    for (const run of object.colours ?? []) {
      uses.push({
        hex: run.colour.hex,
        ...(run.colour.name ? { name: run.colour.name } : {}),
        area: runArea(object.positions, run),
      });
    }
  }
  if (!uses.length) return null;
  const plan = planColours(uses, spools, chosen.colours);
  if (plan.groups.length < 2) return null;
  for (const object of objects) {
    const runs = object.colours;
    if (!runs?.length) continue;
    // The object's own filament: where most of it is. Triangles no run covers print in it.
    const weight = new Map<number, number>();
    for (const run of runs) {
      const filament = (plan.filamentOf.get(run.colour.hex) ?? 0) + 1;
      weight.set(filament, (weight.get(filament) ?? 0) + runArea(object.positions, run));
    }
    object.extruder = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
    const parts: { from: number; to: number; extruder: number }[] = [];
    let at = 0;
    const push = (from: number, to: number, extruder: number) => {
      const last = parts[parts.length - 1];
      if (last && last.extruder === extruder && last.to === from) last.to = to;
      else if (to > from) parts.push({ from, to, extruder });
    };
    for (const run of runs) {
      push(at, run.from, object.extruder);
      push(run.from, run.to, (plan.filamentOf.get(run.colour.hex) ?? 0) + 1);
      at = run.to;
    }
    push(at, object.positions.length / 9, object.extruder);
    if (new Set(parts.map((part) => part.extruder)).size > 1) {
      object.parts = parts;
      object.byColour = true;
    }
  }
  const total = plan.groups.reduce((sum, group) => sum + group.area, 0) || 1;
  const rows: SliceColour[] = plan.groups.map((group) => {
    const merged = group.members.slice(1).map((member) => member.name ?? member.hex);
    return {
      hex: group.hex,
      ...(group.name ? { name: group.name } : {}),
      ...(merged.length ? { merged } : {}),
      share: Math.round((group.area / total) * 100),
      filament: group.filament,
      inPantry: group.inPantry,
      ...(group.chosen ? { chosen: true } : {}),
    };
  });
  return { filaments: plan.filaments, rows };
}

/**
 * A project's filaments, each matched to the Pantry spool nearest its colour (of its own material first), a choice
 * winning; null, leaving the project as it is, when its objects use fewer than two filaments. The filaments keep their
 * numbers, so each object, part and painted triangle prints where the project put it, in the spool chosen for it.
 */
function matchProject(
  objects: Placed[],
  settings: Config | undefined,
  painted: number,
  spools: readonly SpoolLike[],
  chosen: SliceOptions,
) {
  if (!settings) return null;
  const types = [settings.filament_type ?? []].flat();
  const colours = [settings.filament_colour ?? []].flat();
  const used = new Set<number>();
  for (const object of objects) {
    used.add(object.extruder);
    for (const part of object.parts ?? []) used.add(part.extruder);
  }
  for (let state = 1; state <= painted; state++) used.add(state);
  if (used.size < 2) return null;
  const count = Math.max(types.length, ...used);
  const listed: ProjectFilament[] = [];
  for (let slot = 1; slot <= count; slot++) {
    const hex = colourHex(colours[slot - 1]);
    listed.push({ slot, material: types[slot - 1] ?? types[0] ?? "PLA", ...(hex ? { hex } : {}) });
  }
  const plan = planProject(listed, used, spools, chosen.colours);
  const rows: SliceColour[] = plan.rows.map((row) => ({
    hex: row.hex ?? NO_COLOUR,
    name: `Filament ${row.slot}`,
    slot: row.slot,
    material: row.material,
    share: 0,
    filament: row.match.filament,
    inPantry: row.match.inPantry,
    ...(row.chosen ? { chosen: true } : {}),
  }));
  // The project's own colours, for the picture of the plate as it has them.
  const originalColours = listed.map((filament) => filament.hex ?? NO_COLOUR);
  // OrcaSlicer's engine takes an object made of parts in several filaments whole, its parts painted in theirs.
  for (const object of objects) {
    if (new Set(object.parts?.map((part) => part.extruder)).size > 1) object.byColour = true;
  }
  return { filaments: plan.filaments, rows, originalColours };
}

/** The surface of a run of an object's triangles, in mm². */
function runArea(positions: Float32Array, run: { from: number; to: number }): number {
  let area = 0;
  for (let t = run.from; t < run.to; t++) {
    const o = t * 9;
    const p = (i: number) => positions[o + i] as number;
    const ux = p(3) - p(0);
    const uy = p(4) - p(1);
    const uz = p(5) - p(2);
    const vx = p(6) - p(0);
    const vy = p(7) - p(1);
    const vz = p(8) - p(2);
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

/** The settings a slice is made with, and the colours and plate someone chose (the setup's own don't keep them). */
function withChoices(slicing: SlicingSettings, chosen: SliceOptions): SlicingSettings {
  return {
    ...slicing,
    ...(chosen.colours?.length ? { colours: chosen.colours } : {}),
    ...(chosen.modelPlate ? { modelPlate: chosen.modelPlate } : {}),
  };
}

/**
 * What the engine is given: an object whose parts print in the filaments its colours were matched to goes in whole
 * (one object, so a part in the air still sits on what holds it), its parts painted in their filaments as a project's
 * painted colours are, which Orca's own segmentation prints. Triangles in the object's own filament stay unpainted.
 */
function engineObjects(objects: Placed[]): Placed[] {
  return objects.map((object) => {
    if (!object.byColour || !object.parts) return object;
    const triangles: number[] = [];
    const codes: string[] = [];
    for (const part of object.parts) {
      if (part.extruder === object.extruder) continue;
      const code = paintCode(part.extruder);
      for (let t = part.from; t < part.to; t++) {
        triangles.push(t);
        codes.push(code);
      }
    }
    if (!triangles.length) return object;
    const ends: number[] = [];
    let length = 0;
    for (const code of codes) {
      length += code.length;
      ends.push(length);
    }
    return {
      ...object,
      paint: { triangles: Uint32Array.from(triangles), codes: codes.join(""), ends: Uint32Array.from(ends) },
    };
  });
}

/** Orca's code for a whole triangle painted in a filament (paint.ts: states 1 and 2 are one digit, 3 and up two). */
function paintCode(filament: number): string {
  if (filament <= 2) return String(filament * 4);
  return `${(filament - 3).toString(16).toUpperCase()}C`;
}

/** The objects of an .stl or a .3mf, each with its filament (and a project's object made of parts, theirs). */
function readModel(bytes: Uint8Array, name: string, plate?: number) {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!zip) {
    const parsed = parseStl(bytes);
    const positions = parsed.ok ? finiteTriangles(parsed.mesh.positions) : null;
    if (!positions) throw new Problem("unreadable");
    if (!positions.length) throw new Problem("no-model");
    return {
      objects: [{ name, positions, extruder: 1 }],
      project: false,
      settings: undefined,
      painted: 0,
      plate: undefined,
    };
  }
  const model = readModel3mf(bytes, { plate });
  if (model === "not-3mf") throw new Problem("unreadable");
  if (model === "no-objects") throw new Problem("no-model");
  // Filaments beyond what the project lists fall back to its first.
  const listed = model.settings ? [model.settings.filament_type ?? []].flat().length : 0;
  const filament = (extruder: number | undefined) => (extruder && extruder <= Math.max(1, listed) ? extruder : 1);
  // The highest filament painted on any object, of those the project lists.
  let painted = 0;
  return {
    objects: model.objects.map((object): Placed => {
      const extruder = filament(object.extruder);
      const paint = object.paint ? paintWithin(object.paint, Math.max(1, listed)) : null;
      if (paint) painted = Math.max(painted, paint.highest);
      return {
        name: object.name,
        positions: object.positions,
        extruder,
        ...(object.parts
          ? {
              parts: object.parts.map((part) => ({
                from: part.from,
                to: part.to,
                extruder: part.extruder ? filament(part.extruder) : extruder,
              })),
            }
          : {}),
        ...(paint ? { paint: paint.paint } : {}),
        ...(object.colours ? { colours: object.colours } : {}),
      };
    }),
    project: model.project,
    settings: model.settings,
    painted,
    // Which plate of how many, when the project has several.
    ...(model.plates.length > 1
      ? {
          plate: {
            index: model.plate,
            count: model.plates.length,
            height:
              Math.round((model.plates.find((candidate) => candidate.index === model.plate)?.height ?? 0) * 10) / 10,
          },
        }
      : {}),
  };
}

/**
 * Puts the objects on the plate (in place): a project laid out for this plate stays as it is (on the bed), anything
 * else is arranged. When they can't fit, says why, with the scale at which they would.
 */
function place(
  objects: Placed[],
  plate: ReturnType<typeof plateArea>,
  volume: [number, number, number],
  keepLayout: boolean,
  scale: number,
) {
  const boxes = objects.map((object) => boundsOf(object.positions));
  if (keepLayout && fitsAsPlaced(boxes, plate)) {
    for (const [index, object] of objects.entries()) translate(object.positions, 0, 0, -(boxes[index] as Box).min[2]);
    return;
  }
  const problem = arrangeOnPlate(objects, plate);
  if (!problem) return;
  if (problem === "too-many") {
    const fits = (percent: number) =>
      !arrangeOnPlate(
        boxes.map((box) => ({ positions: boxCorners(box, percent / 100) })),
        plate,
      );
    let low = 0;
    let high = 100;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (fits(middle)) low = middle;
      else high = middle;
    }
    throw new Problem("too-many", {
      volume,
      ...(low >= 1 ? { fitScale: Math.floor((low * scale) / 100) } : {}),
    });
  }
  // The object that fits worst says how much smaller everything must be.
  const sizes = boxes.map(sizeOf);
  const worst = sizes.reduce((a, b) => (fitPercent(b, volume, FIT_MARGIN) < fitPercent(a, volume, FIT_MARGIN) ? b : a));
  const percent = fitPercent(worst, volume, FIT_MARGIN);
  throw new Problem(problem, {
    dimensions: worst.map((length) => Math.round(length)) as [number, number, number],
    volume,
    ...(percent >= 1 ? { fitScale: Math.max(1, Math.floor((percent * scale) / 100)) } : {}),
  });
}

/** A box as two points, scaled about its centre: enough for the arrangement to measure. */
function boxCorners(box: Box, factor: number): Float32Array {
  const out = new Float32Array(6);
  for (let axis = 0; axis < 3; axis++) {
    const min = box.min[axis] as number;
    const max = box.max[axis] as number;
    const centre = (min + max) / 2;
    out[axis] = centre + (min - centre) * factor;
    out[axis + 3] = centre + (max - centre) * factor;
  }
  return out;
}

/**
 * Where the prime tower goes once two filaments print: where the project put it, else the first corner of the
 * plate that no object comes near (the back right first, where Bambu Studio puts it).
 */
function towerSpot(objects: Placed[], plate: ReturnType<typeof plateArea>, setup: SliceSetup) {
  if (setup.tower) return setup.tower;
  const width = Number(first(setup.process.prime_tower_width)) || 35;
  const depth = 50;
  const margin = 10;
  const boxes = objects.map((object) => boundsOf(object.positions));
  const corners = [
    { x: plate.maxX - width - margin, y: plate.maxY - depth - margin },
    { x: plate.minX + margin, y: plate.maxY - depth - margin },
    { x: plate.maxX - width - margin, y: plate.minY + margin },
    { x: plate.minX + margin, y: plate.minY + margin },
  ];
  const clear = (spot: { x: number; y: number }) =>
    boxes.every(
      (box) =>
        box.max[0] + 5 < spot.x ||
        box.min[0] - 5 > spot.x + width ||
        box.max[1] + 5 < spot.y ||
        box.min[1] - 5 > spot.y + depth,
    );
  return corners.find(clear) ?? corners[0];
}

/**
 * The plate picture as a PNG, in the filaments' colours (with `parts`, an object made of parts in different filaments
 * in theirs; a painted object in its paint); null where the browser can't encode one in a worker.
 */
async function picture(objects: Placed[], setup: SliceSetup, parts: boolean): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "function") return null;
  try {
    const meshes = objects.flatMap(
      (object) =>
        (object.paint && paintedMeshes(object, object.paint, setup.filaments.length)) ||
        (parts && partsOf(object)?.map((part) => ({ positions: part.positions, extruder: part.filament }))) || [object],
    );
    const pixels = renderPlate(
      meshes.map((mesh) => mesh.positions),
      {
        size: PICTURE,
        colour: setup.colours[0] ?? FALLBACK_COLOUR,
        colours: meshes.map((mesh) => setup.colours[mesh.extruder - 1]),
      },
    );
    const canvas = new OffscreenCanvas(PICTURE, PICTURE);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), PICTURE, PICTURE), 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } catch {
    return null;
  }
}

/**
 * The plate picture with the model's own colours, for the before and after of colour matching: each run of an
 * object's triangles in the colour the file gives it (the rest, fins included, in the first filament's).
 */
async function originalPicture(objects: Placed[], setup: SliceSetup): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "function") return null;
  try {
    const meshes: { positions: Float32Array; colour: string | undefined }[] = [];
    for (const object of objects) {
      let at = 0;
      for (const run of object.colours ?? []) {
        if (run.from > at)
          meshes.push({ positions: object.positions.subarray(at * 9, run.from * 9), colour: undefined });
        meshes.push({ positions: object.positions.subarray(run.from * 9, run.to * 9), colour: run.colour.hex });
        at = run.to;
      }
      if (at * 9 < object.positions.length) {
        meshes.push({ positions: object.positions.subarray(at * 9), colour: undefined });
      }
    }
    const pixels = renderPlate(
      meshes.map((mesh) => mesh.positions),
      {
        size: PICTURE,
        colour: setup.colours[0] ?? FALLBACK_COLOUR,
        colours: meshes.map((mesh) => mesh.colour),
      },
    );
    const canvas = new OffscreenCanvas(PICTURE, PICTURE);
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.putImageData(new ImageData(new Uint8ClampedArray(pixels), PICTURE, PICTURE), 0, 0);
    return await canvas.convertToBlob({ type: "image/png" });
  } catch {
    return null;
  }
}

/**
 * A painted object as meshes, one a filament: its unpainted triangles in its own, each painted piece in the one it
 * is painted with (a filament past the setup's, or none, its own), split as Orca splits it.
 */
function paintedMeshes(
  object: Placed,
  paint: ModelPaint,
  filaments: number,
): { positions: Float32Array; extruder: number }[] {
  const positions = object.positions;
  const count = positions.length / 9;
  const plain = new Float32Array((count - paint.triangles.length) * 9);
  const pieces = new Map<number, number[]>();
  const piece = (state: number) => {
    const extruder = state >= 1 && state <= filaments ? state : object.extruder;
    const out = pieces.get(extruder) ?? [];
    pieces.set(extruder, out);
    return out;
  };
  let at = 0;
  let next = 0;
  let from = 0;
  for (let triangle = 0; triangle < count; triangle++) {
    const base = triangle * 9;
    if (paint.triangles[next] !== triangle) {
      plain.set(positions.subarray(base, base + 9), at);
      at += 9;
      continue;
    }
    const to = paint.ends[next] as number;
    const corner = (k: number): [number, number, number] => [
      positions[base + k * 3] as number,
      positions[base + k * 3 + 1] as number,
      positions[base + k * 3 + 2] as number,
    ];
    paintLeaves(paint.codes, from, to, [corner(0), corner(1), corner(2)], (a, b, c, state) =>
      piece(state).push(...a, ...b, ...c),
    );
    from = to;
    next++;
  }
  const own = { positions: plain, extruder: object.extruder };
  return [own, ...[...pieces].map(([extruder, out]) => ({ positions: Float32Array.from(out), extruder }))];
}

/* The engine's host, spoken to with protocol v2 messages ---------------------------------------------------------- */

/**
 * Slices with the engine; when it says the prime tower is partly off the plate (many filaments, or ones that purge a
 * lot, such as TPU beside PLA, make it deep), tries again with a wider one, which is shallower, put where it fits.
 */
async function sliceWithEngineFitted(
  engine: SliceRequest["engine"],
  setup: SliceSetup,
  objects: Placed[],
  plate: ReturnType<typeof plateArea>,
) {
  try {
    return await sliceWithEngine(engine, setup, objects);
  } catch (error) {
    const outside = error instanceof Error && /prime tower is partially outside/i.test(error.message);
    if (!outside || setup.tower || setup.filaments.length < 2) throw error;
    let last: unknown = error;
    for (const width of [60, 90]) {
      setup.process.prime_tower_width = [String(width)];
      const tower = towerSpot(objects, plate, setup);
      if (!tower) break;
      setup.process.wipe_tower_x = [String(Math.round(tower.x))];
      setup.process.wipe_tower_y = [String(Math.round(tower.y))];
      try {
        return await sliceWithEngine(engine, setup, objects);
      } catch (again) {
        last = again;
      }
    }
    throw last;
  }
}

class EngineError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface EngineResult {
  gcode: Uint8Array;
  stats: { printTimeSeconds?: number; filamentG?: number };
  warnings: SlicerWarning[];
  /** How long the engine took to slice, in ms (its loading not counted). */
  ms: number;
}

function engineProblem(error: EngineError): Pick<FileSlice, "problem" | "message"> {
  if (error.code === 2) return { problem: "memory" };
  if (error.code === 6 || error.code === 7 || error.code === 4) return { problem: "engine" };
  return { problem: "orca", message: error.message.slice(0, 300) };
}

async function sliceWithEngine(engine: SliceRequest["engine"], setup: SliceSetup, objects: Placed[]) {
  progress("engine", 0);
  // An engine from an attempt before this one (a retry with a wider prime tower) is let go: one at a time in memory.
  host?.terminate();
  const worker = new Worker(new URL(engine.host, engine.base), { type: "module", name: "slicer-engine" });
  host = worker;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: (value: unknown) => void }
  >();
  let next = 1;
  const failAll = (error: Error) => {
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  };
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as {
      v?: number;
      id?: number;
      kind?: string;
      result?: unknown;
      error?: { code: number; message: string };
      progress?: unknown;
      state?: { state: string; loadedBytes?: number; totalBytes?: number; code?: number; message?: string };
    };
    if (data?.v !== 2) return;
    if (data.kind === "state" && data.state?.state === "loading" && data.state.totalBytes) {
      progress("engine", (data.state.loadedBytes ?? 0) / data.state.totalBytes);
      return;
    }
    if (data.kind === "state" && data.state?.state === "fatal") {
      failAll(new EngineError(data.state.code ?? 1, data.state.message ?? "The engine stopped."));
      return;
    }
    const entry = data.id !== undefined ? pending.get(data.id) : undefined;
    if (!entry) return;
    if (data.kind === "progress") entry.onProgress?.(data.progress);
    else if (data.kind === "result") {
      pending.delete(data.id as number);
      entry.resolve(data.result);
    } else if (data.kind === "error") {
      pending.delete(data.id as number);
      entry.reject(new EngineError(data.error?.code ?? 1, data.error?.message ?? "The engine failed."));
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    const memory = /memory/i.test(event.message ?? "");
    failAll(new EngineError(memory ? 2 : 6, event.message || "The engine couldn't start."));
  };
  const call = (op: string, params: unknown, onProgress?: (value: unknown) => void) =>
    new Promise<unknown>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject, ...(onProgress ? { onProgress } : {}) });
      worker.postMessage({ v: 2, id, op, params });
    });

  await call("hello", { protocol: { major: 2 }, client: { name: "spaghetti", version: engine.version } });
  await call("load", { variant: "st" });
  progress("slicing", 0);
  const multi = setup.filaments.length > 1;
  const started = performance.now();
  const result = (await call(
    "slice",
    {
      configs: { machine: setup.machine, process: setup.process, filaments: setup.filaments },
      objects: engineObjects(objects).map((object) => ({
        name: object.name,
        mesh: { positions: object.positions },
        ...(multi ? { config: { extruder: String(object.extruder) } } : {}),
        // A project's painted colours, as Orca reads them from it: Orca's own segmentation prints them.
        ...(object.paint ? { paint: { filaments: object.paint } } : {}),
      })),
      output: { toolpaths: false },
    },
    (value) => {
      const percent = (value as { percent?: number })?.percent;
      if (typeof percent === "number") progress("slicing", percent / 100);
    },
  )) as Omit<EngineResult, "ms">;
  return { ...result, ms: performance.now() - started };
}
