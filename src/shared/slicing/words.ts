/**
 * What the app (and Claude, through MCP) says about a model's slicing: one quiet line for how it was sliced, and one
 * short human sentence for why it couldn't be.
 */
import type { FileSlice, SliceSettings } from "./types.ts";

/** "Bambu Lab X2D 0.4 nozzle" → "X2D". */
export function printerName(machine: string): string {
  return machine.replace(/^Bambu Lab\s+/i, "").replace(/\s+[\d.]+\s*(mm\s+)?nozzle$/i, "") || machine;
}

/** "0.2" → "0.20 mm", as slicers write layer heights (the details' "Layers" line). */
export const layerHeightText = (millimetres: number) => `${millimetres.toFixed(2)} mm`;

/** "0.2" → "0.2 mm layers", "0.16" → "0.16 mm layers": the layer height in plain words, for the card's line. */
export const layersText = (millimetres: number) => `${Number(millimetres.toFixed(2))} mm layers`;

/**
 * The quality word of a process preset, "0.20mm Standard @BBL X2D" → "Standard", when the preset is for the layer
 * height the slice used (a project from another printer keeps its own height under our preset): else null.
 */
export function processQuality(process: string, layerHeight: number): string | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*mm\s+([^@]+?)\s*(?:@.*)?$/i.exec(process);
  if (!match?.[2] || Math.abs(Number(match[1]) - layerHeight) > 0.001) return null;
  return match[2];
}

/** The details' "Layers" line: "0.20 mm (Standard)", or only the height when the preset's word doesn't apply. */
export function layersDetail(settings: Pick<SliceSettings, "process" | "layerHeight">): string {
  const quality = processQuality(settings.process, settings.layerHeight);
  return quality ? `${layerHeightText(settings.layerHeight)} (${quality})` : layerHeightText(settings.layerHeight);
}

/** "PLA", "PLA + PETG", "PLA ×3": the materials of a slice, said once each. */
export function materialsText(materials: string[]): string {
  const unique = [...new Set(materials)];
  if (unique.length === 1 && materials.length > 1) return `${unique[0]} ×${materials.length}`;
  return unique.join(" + ") || "PLA";
}

/** The card's line after "Sliced by Spaghetti": "PLA · 0.2 mm layers", with supports or a scale when it had them. */
export function sliceSummary(settings: SliceSettings): string[] {
  return [
    materialsText(settings.materials),
    layersText(settings.layerHeight),
    settings.supports ? "supports" : "",
    settings.scale !== 100 ? `${settings.scale}%` : "",
  ].filter(Boolean);
}

/** "312 mm" */
const mm = (value: number) => `${Math.round(value)} mm`;

/** Why a model couldn't be sliced, in one short sentence. `phone` says it about the device in hand. */
export function problemSentence(slice: FileSlice, options: { phone?: boolean } = {}): string {
  const printer = `the ${printerName(slice.settings.machine)}`;
  const [x = 0, y = 0, z = 0] = slice.dimensions ?? [];
  const [width = 256, depth = 256, height = 256] = slice.volume ?? [];
  switch (slice.problem) {
    case "too-big": {
      const across = x / width >= y / depth;
      return `Too big for the plate: ${mm(across ? x : y)} ${across ? "wide" : "deep"}, ${printer} takes ${Math.round(across ? width : depth)}.`;
    }
    case "too-tall":
      return `Too tall for ${printer}: ${mm(z)} high, it prints ${Math.round(height)}.`;
    case "too-many":
      return "Too many objects for one plate.";
    case "no-model":
      return "This file has no model in it.";
    case "unreadable":
      return "Spaghetti can't read this file as an STL or a 3MF.";
    case "memory":
      return slice.device === "phone"
        ? `Slicing ran out of memory on ${options.phone ? "this" : "a"} phone. It will finish on a laptop or desktop.`
        : "Slicing ran out of memory.";
    case "engine":
      return "The slicer couldn't start. It needs a connection the first time.";
    case "too-large":
      return "The sliced file is over 25 MB, too large to keep.";
    default: {
      const said = (slice.message ?? "").trim().replace(/\s+/g, " ");
      return said ? `OrcaSlicer couldn't slice it: ${said.replace(/[.!]*$/, "")}.` : "OrcaSlicer couldn't slice it.";
    }
  }
}

/** Whether slicing it again the same way could go differently (the engine or memory), so "Try again" makes sense. */
export const worthRetrying = (slice: FileSlice) => slice.problem === "engine" || slice.problem === "memory";

/** A phone that ran out of memory: a laptop or desktop that shows the file slices it by itself. */
export const finishesOnComputer = (slice: FileSlice | null | undefined) =>
  slice?.status === "failed" && slice.problem === "memory" && slice.device === "phone";
