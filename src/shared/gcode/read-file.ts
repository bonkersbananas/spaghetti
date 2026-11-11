import { Unzip, UnzipInflate } from "fflate";
import { GcodeReader, type ParseOptions } from "./parse.ts";
import type { ToolpathFilament, Toolpaths } from "./types.ts";

/**
 * Reads the toolpaths of one plate out of a `.gcode.3mf`, streaming: the zip is inflated piece by piece and every
 * piece goes straight into the G-code reader, so a 100 MB file never exists whole in memory. Colours come from the
 * file's own filament list (project settings, then the slice's per-plate list) and, last, from `fallbackColors`
 * (the matched spools'), one per filament in the slicer's order.
 */

export interface ReadToolpathsOptions extends Pick<ParseOptions, "maxSegments" | "onLayer"> {
  /** The plate, counting from 1. Default: the first one with G-code. */
  plate?: number;
  /** Colours of the matched spools, by filament index, for filaments the file doesn't colour. */
  fallbackColors?: (string | null | undefined)[];
  /** 0–1 of the file read. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const SMALL = new Set(["Metadata/slice_info.config", "Metadata/project_settings.config"]);
const MAX_SMALL = 8 * 1024 * 1024;
const GCODE = /^Metadata\/plate_(\d+)\.gcode$/;

export class ToolpathError extends Error {}

export async function readToolpaths(file: Blob, options: ReadToolpathsOptions = {}): Promise<Toolpaths> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  const small = new Map<string, Uint8Array[]>();
  const decoder = new TextDecoder();
  let reader: GcodeReader | null = null;
  let plate = 0;
  let sawGcode = false;
  let failure: Error | null = null;

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
          if (size <= MAX_SMALL) parts.push(chunk);
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
  const source = file.stream().getReader();
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
  applyFilaments(
    result.filaments,
    parseProject(text("Metadata/project_settings.config")),
    info,
    options.fallbackColors,
  );
  return result;
}

interface SliceInfo {
  prediction?: number;
  filaments: Map<number, { color?: string; type?: string }>;
  nozzles?: number[];
}

/** The `<plate>` of slice_info.config that says `index = plate`, read with patterns (it is a small, regular file). */
export function parseSliceInfo(xml: string | undefined, plate: number): SliceInfo {
  const out: SliceInfo = { filaments: new Map() };
  if (!xml) return out;
  for (const block of xml.match(/<plate>[\s\S]*?<\/plate>/g) ?? []) {
    const index = /key="index"\s+value="(\d+)"/.exec(block)?.[1];
    if (Number(index) !== plate) continue;
    const prediction = Number(/key="prediction"\s+value="([\d.]+)"/.exec(block)?.[1]);
    if (prediction > 0) out.prediction = Math.round(prediction);
    const maps = /key="filament_maps"\s+value="([\d\s]+)"/.exec(block)?.[1];
    if (maps) out.nozzles = maps.trim().split(/\s+/).map(Number);
    for (const f of block.match(/<filament\b[^>]*>/g) ?? []) {
      const id = Number(/\bid="(\d+)"/.exec(f)?.[1]);
      if (!id) continue;
      out.filaments.set(id, { color: hex(/\bcolor="([^"]+)"/.exec(f)?.[1]), type: /\btype="([^"]+)"/.exec(f)?.[1] });
    }
  }
  return out;
}

interface ProjectLists {
  colors: string[];
  types: string[];
  nozzles: string[];
}

function parseProject(json: string | undefined): ProjectLists {
  const out: ProjectLists = { colors: [], types: [], nozzles: [] };
  if (!json) return out;
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
    out.colors = list(o.filament_colour);
    out.types = list(o.filament_type);
    // Dual-nozzle files say which nozzle each filament uses (1 left, 2 right) **[uncertain for the X2D]**.
    out.nozzles = list(o.filament_map);
  } catch {
    // Settings we can't read just mean no colours from here.
  }
  return out;
}

function hex(v: string | undefined | null): string | undefined {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((v ?? "").trim());
  return m ? `#${m[1]?.toLowerCase()}` : undefined;
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
