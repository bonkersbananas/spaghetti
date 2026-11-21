import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import { plateObjectIds, sizeFromModelXml } from "../slicing/size.ts";
import { GcodeReader, type ParseOptions } from "./parse.ts";
import { hex, type ProjectLists, parseProject, parseSliceInfo, type SliceInfo } from "./slice-config.ts";
import type { ToolpathFilament, Toolpaths } from "./types.ts";

/**
 * Reads the toolpaths of one plate out of a `.gcode.3mf`, streaming: the zip is inflated piece by piece and every
 * piece goes straight into the G-code reader, so a 100 MB file never exists whole in memory. Colours come from the
 * file's own filament list (project settings, then the slice's per-plate list) and, last, from `fallbackColors`
 * (the matched spools'), one per filament in the slicer's order.
 */

export interface ReadToolpathsOptions extends Pick<ParseOptions, "maxSegments" | "onLayer" | "keepLayers"> {
  /** The plate, counting from 1. Default: the first one with G-code. */
  plate?: number;
  /** How many copies of the plate's objects the file has: its size is of one. */
  copies?: number;
  /** Colours of the matched spools, by filament index, for filaments the file doesn't colour. */
  fallbackColors?: (string | null | undefined)[];
  /** 0–1 of the file read. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const SMALL = new Set([
  "Metadata/slice_info.config",
  "Metadata/project_settings.config",
  "3D/3dmodel.model",
  "Metadata/model_settings.config",
]);
const MAX_SMALL = 8 * 1024 * 1024;
/** The model's mesh can be bigger; one past this is left unread (no size) rather than read in part. */
const MAX_MODEL = 24 * 1024 * 1024;
const GCODE = /^Metadata\/plate_(\d+)\.gcode$/;

export class ToolpathError extends Error {}

/** A file as a blob, or as a stream with its length (a fetch's body, so nothing is held whole). */
export type ToolpathSource = Blob | { stream: ReadableStream<Uint8Array>; size: number };

export async function readToolpaths(file: ToolpathSource, options: ReadToolpathsOptions = {}): Promise<Toolpaths> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough); // stored entries, as re-zipped files have
  const small = new Map<string, Uint8Array[]>();
  const decoder = new TextDecoder();
  let reader: GcodeReader | null = null;
  let plate = 0;
  let sawGcode = false;
  let failure: Error | null = null;
  let tooBig = false;

  unzip.onfile = (entry) => {
    const name = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    if (SMALL.has(name)) {
      const parts: Uint8Array[] = [];
      small.set(name, parts);
      let size = 0;
      entry.ondata = (err, chunk) => {
        if (err) failure = err;
        else {
          size += chunk.length;
          if (size <= (name === "3D/3dmodel.model" ? MAX_MODEL : MAX_SMALL)) parts.push(chunk);
          else if (name === "3D/3dmodel.model") tooBig = true;
        }
      };
      entry.start();
      return;
    }
    const m = GCODE.exec(name);
    if (!m) return;
    const n = Number(m[1]);
    if (reader || (options.plate !== undefined && n !== options.plate)) return;
    sawGcode = true;
    plate = n;
    reader = new GcodeReader({
      // G-code deflates about 4:1; the local header says the real size unless a data descriptor follows.
      sourceBytes: entry.originalSize || (entry.size || 0) * 4 || undefined,
      maxSegments: options.maxSegments,
      onLayer: options.onLayer,
      keepLayers: options.keepLayers,
    });
    const r = reader;
    entry.ondata = (err, chunk, final) => {
      if (err) {
        failure = err;
        return;
      }
      r.write(decoder.decode(chunk, { stream: !final }));
    };
    entry.start();
  };

  const total = file.size;
  let done = 0;
  const source = (file instanceof Blob ? file.stream() : file.stream).getReader();
  try {
    for (;;) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const { value, done: finished } = await source.read();
      if (finished) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      unzip.push(value);
      done += value.length;
      options.onProgress?.(Math.min(1, done / total));
      if (failure) throw failure;
    }
  } catch (e) {
    source.cancel().catch(() => {});
    if ((e as Error).name === "AbortError") throw e;
    throw new ToolpathError(`Could not read the file: ${(e as Error).message}`);
  }
  if (!sawGcode || !reader) throw new ToolpathError("This file has no G-code (it was saved before slicing)");

  const text = (name: string): string | undefined => {
    const parts = small.get(name);
    if (!parts) return undefined;
    const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      all.set(p, at);
      at += p.length;
    }
    return decoder.decode(all);
  };
  const info = parseSliceInfo(text("Metadata/slice_info.config"), plate);
  const result = (reader as GcodeReader).end(plate);
  result.stats.sourceBytes = total;
  if (result.totalSeconds == null && info.prediction) result.totalSeconds = info.prediction;
  const model = text("3D/3dmodel.model");
  result.size =
    model && !tooBig
      ? sizeFromModelXml(model, options.copies, plateObjectIds(text("Metadata/model_settings.config"), plate))
      : null;
  applyFilaments(
    result.filaments,
    parseProject(text("Metadata/project_settings.config")),
    info,
    options.fallbackColors,
  );
  return result;
}

function applyFilaments(
  filaments: ToolpathFilament[],
  project: ProjectLists,
  info: SliceInfo,
  fallback: ReadToolpathsOptions["fallbackColors"],
) {
  filaments.forEach((f, i) => {
    const sliced = info.filaments.get(i + 1);
    f.color = hex(project.colors[i]) ?? sliced?.color ?? hex(fallback?.[i]) ?? null;
    const type = project.types[i] ?? sliced?.type;
    if (type) f.type = type;
    const nozzle = Number(info.nozzles?.[i] ?? project.nozzles[i]);
    if (nozzle === 1 || nozzle === 2) f.nozzle = nozzle === 1 ? 0 : 1;
  });
}
