import type { Layer, Toolpaths } from "@shared/gcode";
import type { ToolpathMessage, ToolpathRequest } from "./toolpath-worker";

/** What the viewer is told while a file is read: layers as they come, then the totals. */
export type ToolpathSummary = Omit<Toolpaths, "layers"> & { layerCount: number };

export interface ToolpathHandlers {
  onLayers: (layers: Layer[]) => void;
  onProgress: (fraction: number) => void;
  onDone: (summary: ToolpathSummary) => void;
  onError: (message: string) => void;
}

/** Fewer segments on phones: they have less memory and a smaller GPU. */
export function segmentBudget(): number {
  const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return phone ? 700_000 : 2_000_000;
}

/**
 * Starts reading a slicer file's G-code in a Web Worker (it fetches the file itself and streams it). Returns a
 * function that stops it. Loaded only when the viewer opens.
 */
export function loadToolpaths(request: ToolpathRequest, handlers: ToolpathHandlers): () => void {
  const worker = new Worker(new URL("./toolpath-worker.ts", import.meta.url), { type: "module" });
  let finished = false;
  const end = () => {
    finished = true;
    worker.terminate();
  };
  worker.onmessage = (event: MessageEvent<ToolpathMessage>) => {
    if (finished) return;
    const message = event.data;
    if (message.type === "layers") handlers.onLayers(message.layers);
    else if (message.type === "progress") handlers.onProgress(message.fraction);
    else if (message.type === "done") {
      end();
      handlers.onDone(message.paths);
    } else {
      end();
      handlers.onError(message.message);
    }
  };
  worker.onerror = () => {
    if (finished) return;
    end();
    handlers.onError("Could not read the file here.");
  };
  worker.postMessage({ maxSegments: segmentBudget(), ...request } satisfies ToolpathRequest);
  return () => {
    if (finished) return;
    worker.postMessage("cancel");
    end();
  };
}
