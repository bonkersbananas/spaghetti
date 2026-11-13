/// <reference lib="webworker" />
import { MAX_SLICER_FILE_BYTES } from "@shared/api";
import type { AttemptSettings } from "@shared/attempts";
import { arrangeOnPlate, type Box, boundsOf, fitsAsPlaced, plateArea, translate } from "@shared/slicing/arrange.ts";
import { mergedSettings, type PresetSet, type SliceSetup, sliceSetup } from "@shared/slicing/configs.ts";
import { defaultSettings, SLICING_DEFAULTS } from "@shared/slicing/defaults.ts";
import { packGcode3mf, summarizeGcode } from "@shared/slicing/gcode3mf.ts";
import { readModel3mf } from "@shared/slicing/model3mf.ts";
import { renderPlate } from "@shared/slicing/render.ts";
import { readStl } from "@shared/slicing/stl.ts";
import { fitPercent, scaleMesh, sizeOf } from "@shared/slicing/transform.ts";
import type { FileSlice, SliceOptions, SliceProblem, SliceSettings } from "@shared/slicing/types.ts";
import { settingsFromFile, slicerName } from "@shared/threemf/prefill.ts";
import { readThreeMf } from "@shared/threemf/read.ts";

/**
 * Slices one model off the main thread: reads the .stl or .3mf, puts its objects on the X2D's plate, draws the plate
 * picture, slices it with OrcaSlicer's engine (its host is a worker of its own, started here by URL, docs/slicer.md),
 * and packs the G-code into a .gcode.3mf. Everything it says comes back as messages; `sliceModel` (slice-model.ts)
 * is the way in.
 */

export interface SliceRequest {
  file: Blob;
  name: string;
  options: SliceOptions;
  /** Where the engine is (absolute `base`, the host's file name in it) and its release. */
  engine: { base: string; host: string; version: string };
}

export type SlicePhase = "reading" | "engine" | "slicing" | "packing";

export type SliceMessage =
  | { type: "progress"; phase: SlicePhase; fraction: number }
  | { type: "picture"; png: Blob }
  | {
      type: "done";
      sliced: Uint8Array;
      png: Blob | null;
      slice: FileSlice;
      prefill: AttemptSettings;
      objects: string[];
      slicer: string | null;
    }
  | { type: "failed"; slice: FileSlice; png: Blob | null };

/** A filament's colour when nothing says one (the defaults' first: Orca's own). */
const FALLBACK_COLOUR = SLICING_DEFAULTS.colours[0];
/** Plate pictures are drawn at the size Bambu Studio and Orca use. */
const PICTURE = 512;
/** Room kept free round the edge of the plate when scaling to fit, in mm. */
const FIT_MARGIN = 5;

interface Placed {
  name: string;
  positions: Float32Array;
  /** Filament number, from 1. */
  extruder: number;
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
  const { options, engine } = request;
  const scale = Math.max(1, Math.min(100, Math.round(options.scale ?? 100)));
  let settings: Omit<SliceSettings, "scale" | "engine" | "orca"> = defaultSettings(options);
  let orca = "";
  let png: Blob | null = null;
  const slice = (extra: Omit<FileSlice, "settings" | "at">): FileSlice => ({
    ...extra,
    settings: { ...settings, scale, engine: engine.version, orca },
    at: Date.now(),
  });
  try {
    progress("reading", 0);
    const bytes = new Uint8Array(await request.file.arrayBuffer());
    const read = readModel(bytes, request.name);
    progress("reading", 0.5);

    const presets = await fetchJson<PresetSet>(new URL("presets.json", engine.base));
    orca = presets.orca.version;
    const filamentCount = Math.max(...read.objects.map((object) => object.extruder));
    const setup = sliceSetup(presets, {
      ...options,
      ...(read.settings ? { project: { settings: read.settings } } : {}),
      filaments: filamentCount,
    });
    settings = setup.settings;
    const plate = plateArea(setup.machine.printable_area, first(setup.machine.printable_height));
    const volume: [number, number, number] = [plate.maxX - plate.minX, plate.maxY - plate.minY, plate.height];

    const objects = read.objects.map((object) => ({
      ...object,
      positions: scale === 100 ? object.positions : scaleMesh(object.positions, scale / 100),
    }));
    try {
      place(objects, plate, volume, read.project && scale === 100, scale);
    } catch (error) {
      // A model that doesn't fit still gets its picture, as it is.
      png = await picture(objects, setup);
      throw error;
    }
    progress("reading", 1);

    png = await picture(objects, setup);
    if (png) post({ type: "picture", png });

    const tower = objects.length && setup.filaments.length > 1 ? towerSpot(objects, plate, setup) : null;
    if (tower) {
      setup.process.wipe_tower_x = [String(Math.round(tower.x))];
      setup.process.wipe_tower_y = [String(Math.round(tower.y))];
    }
    const result = await sliceWithEngine(engine, setup, objects);
    const cautions =
      !settings.supports && result.warnings.some((warning) => warning.kind === "need_support_on")
        ? (["floating"] as const)
        : [];

    progress("packing", 0);
    const summary = summarizeGcode(result.gcode);
    const sliced = packGcode3mf({
      gcode: result.gcode,
      ...(png ? { thumbnail: new Uint8Array(await png.arrayBuffer()) } : {}),
      seconds: result.stats.printTimeSeconds ?? summary.seconds,
      grams: result.stats.filamentG ?? null,
      objects: objects.map((object) => ({ name: object.name, box: boundsOf(object.positions) })),
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
    if (sliced.byteLength > MAX_SLICER_FILE_BYTES) throw new Problem("too-large");
    // What the app's own reader makes of it: the same settings a dropped .gcode.3mf would give.
    const reading = readThreeMf(sliced);
    progress("packing", 1);
    post(
      {
        type: "done",
        sliced,
        png,
        slice: slice({
          status: "sliced",
          bytes: sliced.byteLength,
          ...(cautions.length ? { cautions: [...cautions] } : {}),
        }),
        prefill: settingsFromFile(reading, 1),
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

/** The objects of an .stl or a .3mf, each with its filament. */
function readModel(bytes: Uint8Array, name: string) {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (!zip) {
    const mesh = readStl(bytes);
    if (!mesh) throw new Problem("unreadable");
    return { objects: [{ name, positions: mesh.positions, extruder: 1 }], project: false, settings: undefined };
  }
  const model = readModel3mf(bytes);
  if (model === "not-3mf") throw new Problem("unreadable");
  if (model === "no-objects") throw new Problem("no-model");
  // Filaments beyond what the project lists fall back to its first.
  const listed = model.settings ? [model.settings.filament_type ?? []].flat().length : 0;
  return {
    objects: model.objects.map((object) => ({
      name: object.name,
      positions: object.positions,
      extruder: object.extruder && object.extruder <= Math.max(1, listed) ? object.extruder : 1,
    })),
    project: model.project,
    settings: model.settings,
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

/** The plate picture as a PNG, in the filaments' colours; null where the browser can't encode one in a worker. */
async function picture(objects: Placed[], setup: SliceSetup): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "function") return null;
  try {
    const pixels = renderPlate(
      objects.map((object) => object.positions),
      {
        size: PICTURE,
        colour: setup.colours[0] ?? FALLBACK_COLOUR,
        colours: objects.map((object) => setup.colours[object.extruder - 1]),
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

/* The engine's host, spoken to with protocol v2 messages ---------------------------------------------------------- */

class EngineError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

interface EngineWarning {
  kind: string;
  message: string;
}

interface EngineResult {
  gcode: Uint8Array;
  stats: { printTimeSeconds?: number; filamentG?: number };
  warnings: EngineWarning[];
}

function engineProblem(error: EngineError): Pick<FileSlice, "problem" | "message"> {
  if (error.code === 2) return { problem: "memory" };
  if (error.code === 6 || error.code === 7 || error.code === 4) return { problem: "engine" };
  return { problem: "orca", message: error.message.slice(0, 300) };
}

async function sliceWithEngine(engine: SliceRequest["engine"], setup: SliceSetup, objects: Placed[]) {
  progress("engine", 0);
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
  const result = (await call(
    "slice",
    {
      configs: { machine: setup.machine, process: setup.process, filaments: setup.filaments },
      objects: objects.map((object) => ({
        name: object.name,
        mesh: { positions: object.positions },
        ...(multi ? { config: { extruder: String(object.extruder) } } : {}),
      })),
      output: { toolpaths: false },
    },
    (value) => {
      const percent = (value as { percent?: number })?.percent;
      if (typeof percent === "number") progress("slicing", percent / 100);
    },
  )) as EngineResult;
  return result;
}
