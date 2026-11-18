/// <reference lib="webworker" />
import { writeStl } from "@shared/mesh";
import { type ModelPaint, paintBytes } from "@shared/slicing/paint.ts";
import { fallbackOf, notesOf, type SlicerWarning, warningsOf } from "@shared/slicing/slicers.ts";
import type { SliceFallback } from "@shared/slicing/types.ts";

/**
 * Spaghetti's own slicer (slicer-rs in WebAssembly, decision 0055) in the slice worker: its module, fetched by URL
 * from where the app serves it (/slicer/rust-<version>/, docs/slicer.md) and spoken to through its plain C interface
 * (slicer-rs/src/wasm.rs). It gets what OrcaSlicer's engine gets: the setup the app made (`sliceSetup`) and the
 * objects as the worker laid them on the plate, turned, scaled and with their fins, so it keeps their places (flag 1)
 * and their size (the setup's scale is 100), each with its filament on a plate in several (an object made of parts
 * in different filaments, part by part, each with its own) and a project's painted colours on it. It answers with the
 * packed .gcode.3mf and what it warns of (Orca's warnings: an object that needs supports), or why OrcaSlicer's engine
 * slices it instead.
 */

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  setup(ptr: number, len: number): number;
  add(name: number, nameLen: number, data: number, dataLen: number): number;
  /** As `add`, with the filament the object prints in (from 1); in releases from slicer-rs-v4 on. */
  add_in?(name: number, nameLen: number, data: number, dataLen: number, filament: number): number;
  /**
   * A part of an object made of parts, in its filament (from 1): `first` (not 0) starts the object, else the part
   * joins the one added just before. Where parts overlap, the later one prints. In releases from slicer-rs-v16 on.
   */
  add_part?(name: number, nameLen: number, data: number, dataLen: number, filament: number, first: number): number;
  /**
   * Paints the STL added just before with a project's painted colours (`paintBytes`): 0, or 1 when they aren't paint
   * for it. A module from before slicer-rs-v22 refuses a painted plate when it slices (code 8, "painted colours").
   */
  paint?(data: number, len: number): number;
  /**
   * As `paint`, with a project's painted supports (`paintBytes`; state 1 enforces support, 2 blocks it). No module has
   * it yet: one without it can't print painted supports, which OrcaSlicer's engine then slices.
   */
  paint_supports?(data: number, len: number): number;
  /** As `paint`, with a project's painted seams (state 1 enforces the seam, 2 blocks it): from release 41. */
  paint_seam?(data: number, len: number): number;
  slice(flags: number): number;
  output_ptr(): number;
  output_len(): number;
  summary_ptr(): number;
  summary_len(): number;
}

/** `slice`'s flag: the objects stay where the worker put them. */
const KEEP_PLACEMENT = 1;
/** Not one of the module's codes: paint it wouldn't take (a fallback that says the slice failed). */
const PAINT_REFUSED = -1;

export type OursAnswer =
  | { ok: true; sliced: Uint8Array; ms: number; notes: string[]; warnings: SlicerWarning[] }
  | { ok: false; fallback: SliceFallback };

/** The module, compiled once per worker (a worker slices one model). */
async function load(url: URL): Promise<Exports> {
  const imports = { env: { now_ms: () => performance.now() } };
  const response = await fetch(url);
  if (!response.ok) throw new Error(String(response.status));
  // Streaming compiles while it downloads, where the server says it is WebAssembly; else from its bytes.
  const { instance } = response.headers.get("content-type")?.startsWith("application/wasm")
    ? await WebAssembly.instantiateStreaming(response, imports)
    : await WebAssembly.instantiate(await response.arrayBuffer(), imports);
  return instance.exports as unknown as Exports;
}

/**
 * An object as the worker laid it on the plate; on a plate in several filaments, the one it prints in (from 1), and
 * when it is made of parts in different filaments, each part with its own. Painted, its paint, and each part's.
 */
export interface OurObject {
  name: string;
  positions: Float32Array;
  filament?: number;
  paint?: ModelPaint;
  /** Its painted supports, while supports are on (an object made of parts has each part's). */
  supports?: ModelPaint;
  /** Its painted seams (an object made of parts has each part's). */
  seams?: ModelPaint;
  parts?: OurPart[];
}

/** A part of an object made of parts: its mesh, the filament it prints in (from 1) and the paint on it. */
export interface OurPart {
  positions: Float32Array;
  filament: number;
  paint?: ModelPaint;
  supports?: ModelPaint;
  seams?: ModelPaint;
}

/**
 * Slices the placed objects with our slicer. `setup` is the app's setup as JSON (its scale 100); `beforeSlice` is
 * called just before the one long call, which can't report how far it is. Never throws: what it can't do is a fallback.
 */
export async function sliceOurs(
  url: URL,
  setup: string,
  objects: readonly OurObject[],
  beforeSlice: () => void,
): Promise<OursAnswer> {
  let module: Exports;
  try {
    module = await load(url);
  } catch {
    return { ok: false, fallback: { why: "unloaded" } };
  }
  try {
    const started = performance.now();
    const encoder = new TextEncoder();
    // Copies bytes into the module's memory for one call, and frees them after.
    const withBytes = (bytes: Uint8Array, use: (ptr: number) => number) => {
      const ptr = module.alloc(bytes.length);
      new Uint8Array(module.memory.buffer, ptr, bytes.length).set(bytes);
      try {
        return use(ptr);
      } finally {
        module.dealloc(ptr, bytes.length);
      }
    };
    const said = () =>
      new TextDecoder().decode(new Uint8Array(module.memory.buffer, module.summary_ptr(), module.summary_len()));
    // A module that can't be handed paint can't print it: OrcaSlicer's engine slices the plate, and the card says why.
    const paintIt = module.paint;
    if (!paintIt && objects.some((object) => object.paint || object.parts?.some((part) => part.paint))) {
      return { ok: false, fallback: { why: "unsupported", what: "painted colours" } };
    }
    // Painted supports likewise, in the words ours refuses a project's supports "painted on" with.
    const supportIt = module.paint_supports;
    if (!supportIt && objects.some((object) => object.supports || object.parts?.some((part) => part.supports))) {
      return { ok: false, fallback: { why: "unsupported", what: "supports painted on" } };
    }
    // Painted seams: a module without `paint_seam` places them as it places any, as Orca does with none painted.
    const seamIt = module.paint_seam;
    // Paints the STL added just before (its colours, then its supports, then its seams); paint it won't take is a
    // slice that failed.
    const painted = (paint: ModelPaint | undefined, supports?: ModelPaint, seams?: ModelPaint) => {
      if (paint && paintIt) {
        const bytes = paintBytes(paint);
        if (withBytes(bytes, (ptr) => paintIt(ptr, bytes.length))) return PAINT_REFUSED;
      }
      if (supports && supportIt) {
        const bytes = paintBytes(supports);
        if (withBytes(bytes, (ptr) => supportIt(ptr, bytes.length))) return PAINT_REFUSED;
      }
      if (seams && seamIt) {
        const bytes = paintBytes(seams);
        if (withBytes(bytes, (ptr) => seamIt(ptr, bytes.length))) return PAINT_REFUSED;
      }
      return 0;
    };
    const settings = encoder.encode(setup);
    let code = withBytes(settings, (ptr) => module.setup(ptr, settings.length));
    for (const object of objects) {
      if (code) break;
      const name = encoder.encode(object.name);
      // An object made of parts in different filaments goes in part by part. A module from before add_part takes it
      // whole, in the object's filament.
      if (object.parts && module.add_part) {
        const addPart = module.add_part;
        for (const [index, part] of object.parts.entries()) {
          if (code) break;
          const stl = writeStl({ positions: part.positions }, object.name);
          code = withBytes(name, (namePtr) =>
            withBytes(stl, (stlPtr) =>
              addPart(namePtr, name.length, stlPtr, stl.length, part.filament, index === 0 ? 1 : 0),
            ),
          );
          if (!code) code = painted(part.paint, part.supports, part.seams);
        }
        continue;
      }
      const stl = writeStl({ positions: object.positions }, object.name);
      // An object of a plate in several filaments says which it prints in. A module from before add_in can't be told,
      // and refuses such a plate (code 8), which OrcaSlicer's engine then slices.
      const { filament } = object;
      code = withBytes(name, (namePtr) =>
        withBytes(stl, (stlPtr) =>
          filament && module.add_in
            ? module.add_in(namePtr, name.length, stlPtr, stl.length, filament)
            : module.add(namePtr, name.length, stlPtr, stl.length),
        ),
      );
      if (!code) code = painted(object.paint, object.supports, object.seams);
    }
    if (code) return { ok: false, fallback: fallbackOf(code, said()) ?? { why: "failed" } };
    beforeSlice();
    code = module.slice(KEEP_PLACEMENT);
    if (code) return { ok: false, fallback: fallbackOf(code, said()) ?? { why: "failed" } };
    const sliced = new Uint8Array(module.memory.buffer, module.output_ptr(), module.output_len()).slice();
    const summary = JSON.parse(said()) as { fallbacks?: unknown; warnings?: unknown };
    return {
      ok: true,
      sliced,
      ms: performance.now() - started,
      notes: notesOf(summary.fallbacks),
      warnings: warningsOf(summary.warnings),
    };
  } catch {
    // A crash in the module (it aborts on a panic), or memory it couldn't grow.
    return { ok: false, fallback: { why: "failed" } };
  }
}
