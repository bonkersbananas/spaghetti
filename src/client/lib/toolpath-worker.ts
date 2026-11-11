/// <reference lib="webworker" />
import { type Layer, readToolpaths, type Toolpaths, toolpathBuffers } from "@shared/gcode";

/**
 * Reads a slicer file's G-code off the main thread: fetches it, streams it through the reader and posts the layers
 * back in batches (their buffers are moved, not copied), so the viewer can start drawing before the file is read.
 */

export interface ToolpathRequest {
  url: string;
  plate: number;
  fallbackColors?: (string | null | undefined)[];
  /** The most segments to keep: phones get fewer. */
  maxSegments?: number;
}

export type ToolpathMessage =
  | { type: "layers"; layers: Layer[] }
  | { type: "progress"; fraction: number }
  | { type: "done"; paths: Omit<Toolpaths, "layers"> & { layerCount: number } }
  | { type: "error"; message: string };

const BATCH_SEGMENTS = 40_000;

let controller: AbortController | null = null;

self.onmessage = async (event: MessageEvent<ToolpathRequest | "cancel">) => {
  if (event.data === "cancel") {
    controller?.abort();
    return;
  }
  const request = event.data;
  controller = new AbortController();
  const post = (message: ToolpathMessage, transfer: ArrayBuffer[] = []) => self.postMessage(message, { transfer });
  let batch: Layer[] = [];
  let batched = 0;
  const flush = () => {
    if (!batch.length) return;
    const out = batch;
    batch = [];
    batched = 0;
    post({ type: "layers", layers: out }, toolpathBuffers({ layers: out } as Toolpaths));
  };
  try {
    const response = await fetch(request.url, { signal: controller.signal, credentials: "same-origin" });
    if (!response.ok || !response.body) {
      throw new Error(
        response.status === 404 ? "That file isn't kept on the server." : `The server said ${response.status}.`,
      );
    }
    const size = Number(response.headers.get("content-length")) || 0;
    const paths = await readToolpaths(
      { stream: response.body, size: size || 1 },
      {
        plate: request.plate,
        fallbackColors: request.fallbackColors,
        maxSegments: request.maxSegments,
        signal: controller.signal,
        keepLayers: false,
        onProgress: (fraction) => post({ type: "progress", fraction: size ? fraction : 0 }),
        onLayer: (layer) => {
          batch.push(layer);
          batched += layer.count;
          if (batched >= BATCH_SEGMENTS) flush();
        },
      },
    );
    flush();
    const { layers: _kept, ...rest } = paths;
    post({ type: "done", paths: { ...rest, layerCount: paths.stats.layers } });
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    post({ type: "error", message: (error as Error).message || "Could not read the file." });
  }
};
