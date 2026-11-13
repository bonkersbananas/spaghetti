import engine from "virtual:slicer-engine";
import type { AttemptSettings } from "@shared/attempts";
import { presetRecord } from "@shared/slicing/orca.ts";
import { chosenFromOptions, slicingFor } from "@shared/slicing/settings.ts";
import type { FileSlice, SliceOptions, SliceProblem } from "@shared/slicing/types.ts";
import type { SliceMessage, SlicePhase, SliceRequest } from "./slice-worker";

/** A model sliced: the .gcode.3mf, its plate picture, how it went, and what the app's reader makes of it. */
export interface Sliced {
  ok: true;
  sliced: Blob;
  png: Blob | null;
  slice: FileSlice;
  /** The settings a dropped .gcode.3mf would give an attempt. */
  prefill: AttemptSettings;
  objects: string[];
  /** "OrcaSlicer 2.5.0-dev" */
  slicer: string | null;
}

/** A model that couldn't be sliced: why (`slice.problem`), and its picture when it got that far. */
export interface NotSliced {
  ok: false;
  slice: FileSlice;
  png: Blob | null;
}

export type SliceOutcome = Sliced | NotSliced;

export interface SliceHandlers {
  /** 0-1 for the whole job, and the step it is on. */
  onProgress?: (fraction: number, phase: SlicePhase) => void;
  /** The plate picture, as soon as the model is on the plate (before the engine slices it). */
  onPicture?: (png: Blob) => void;
}

/** How much of a job each step takes, roughly: the engine's slicing is most of it. */
const PHASES: Record<SlicePhase, [number, number]> = {
  reading: [0, 0.05],
  engine: [0.05, 0.15],
  slicing: [0.15, 0.96],
  packing: [0.96, 1],
};

const failed = (problem: SliceProblem, options: SliceOptions): NotSliced => ({
  ok: false,
  png: null,
  slice: {
    status: "failed",
    problem,
    settings: {
      ...presetRecord(slicingFor(chosenFromOptions(options))),
      scale: options.scale ?? 100,
      engine: engine.version,
      orca: engine.orca.version,
    },
    at: Date.now(),
  },
});

/**
 * Slices an .stl or a plain .3mf into a .gcode.3mf with OrcaSlicer's engine, off the main thread (slice-worker.ts),
 * with the defaults of shared/slicing/defaults.ts and `options`. Never rejects but for `signal`: a model it can't
 * slice resolves with the reason. Loaded only when something is sliced; Twists can slice through it too.
 */
export function sliceModel(
  file: Blob,
  name: string,
  options: SliceOptions = {},
  handlers: SliceHandlers = {},
  signal?: AbortSignal,
): Promise<SliceOutcome> {
  if (!engine.base) return Promise.resolve(failed("engine", options));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./slice-worker.ts", import.meta.url), { type: "module", name: "slicing" });
    let settled = false;
    const end = () => {
      settled = true;
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (settled) return;
      worker.postMessage("cancel");
      end();
      reject(new DOMException("The slice was cancelled.", "AbortError"));
    };
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort);
    worker.onmessage = (event: MessageEvent<SliceMessage>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === "progress") {
        const [from, to] = PHASES[message.phase];
        handlers.onProgress?.(from + (to - from) * message.fraction, message.phase);
      } else if (message.type === "picture") {
        handlers.onPicture?.(message.png);
      } else if (message.type === "done") {
        end();
        resolve({
          ok: true,
          sliced: new Blob([message.sliced as BlobPart], { type: "model/3mf" }),
          png: message.png,
          slice: message.slice,
          prefill: message.prefill,
          objects: message.objects,
          slicer: message.slicer,
        });
      } else {
        end();
        resolve({ ok: false, slice: message.slice, png: message.png });
      }
    };
    worker.onerror = (event) => {
      if (settled) return;
      end();
      resolve(failed(/memory/i.test(event.message ?? "") ? "memory" : "engine", options));
    };
    const base = new URL(engine.base as string, location.href).href;
    worker.postMessage({
      file,
      name,
      options,
      engine: { base, host: engine.host, version: engine.version },
    } satisfies SliceRequest);
  });
}
