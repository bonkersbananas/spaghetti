/// <reference lib="webworker" />
import { writeStl } from "@shared/mesh";
import { fallbackOf, notesOf } from "@shared/slicing/slicers.ts";
import type { SliceFallback } from "@shared/slicing/types.ts";

/**
 * Spaghetti's own slicer (slicer-rs in WebAssembly, decision 0055) in the slice worker: its module, fetched by URL
 * from where the app serves it (/slicer/rust-<version>/, docs/slicer.md) and spoken to through its plain C interface
 * (slicer-rs/src/wasm.rs). It gets what OrcaSlicer's engine gets: the setup the app made (`sliceSetup`) and the
 * objects as the worker laid them on the plate, turned, scaled and with their fins, so it keeps their places (flag 1)
 * and their size (the setup's scale is 100), each with its filament on a plate in several. It answers with the packed .gcode.3mf, or why OrcaSlicer's engine slices
 * it instead.
 */

interface Exports {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  setup(ptr: number, len: number): number;
  add(name: number, nameLen: number, data: number, dataLen: number): number;
  /** As `add`, with the filament the object prints in (from 1); in releases from slicer-rs PR #265 on. */
  add_in?(name: number, nameLen: number, data: number, dataLen: number, filament: number): number;
  slice(flags: number): number;
  output_ptr(): number;
  output_len(): number;
  summary_ptr(): number;
  summary_len(): number;
}

/** `slice`'s flag: the objects stay where the worker put them. */
const KEEP_PLACEMENT = 1;

export type OursAnswer =
  | { ok: true; sliced: Uint8Array; ms: number; notes: string[] }
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

/** An object as the worker laid it on the plate; on a plate in several filaments, the one it prints in (from 1). */
export interface OurObject {
  name: string;
  positions: Float32Array;
  filament?: number;
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
    const settings = encoder.encode(setup);
    let code = withBytes(settings, (ptr) => module.setup(ptr, settings.length));
    for (const object of objects) {
      if (code) break;
      const name = encoder.encode(object.name);
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
    }
    if (code) return { ok: false, fallback: fallbackOf(code, said()) ?? { why: "failed" } };
    beforeSlice();
    code = module.slice(KEEP_PLACEMENT);
    if (code) return { ok: false, fallback: fallbackOf(code, said()) ?? { why: "failed" } };
    const sliced = new Uint8Array(module.memory.buffer, module.output_ptr(), module.output_len()).slice();
    const summary = JSON.parse(said()) as { fallbacks?: unknown };
    return { ok: true, sliced, ms: performance.now() - started, notes: notesOf(summary.fallbacks) };
  } catch {
    // A crash in the module (it aborts on a panic), or memory it couldn't grow.
    return { ok: false, fallback: { why: "failed" } };
  }
}
