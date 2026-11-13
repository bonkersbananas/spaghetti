/**
 * Model files: an `.stl` or a plain `.3mf` (no G-code) that Spaghetti slices in the browser with OrcaSlicer's engine
 * (docs/slicer.md, decision 0046). The original is the file row's bytes; the sliced `.gcode.3mf` is a second part
 * of the same row (`/api/files/<id>/sliced`), and `slice` on the row says how it went, with the settings it was sliced
 * with (decision 0047).
 */
import type { AttemptSettings } from "../attempts.ts";
import type { SlicingSettings } from "./settings.ts";

/** "slicer": a slicer's own file, kept as it is. "model": an `.stl` or plain `.3mf` that Spaghetti slices. */
export type FileKind = "slicer" | "model";

/** Why a model couldn't be sliced. The app says each in one short sentence (lib/slicing/words.ts). */
export type SliceProblem =
  /** Wider or deeper than the plate. */
  | "too-big"
  /** Taller than the printer prints. */
  | "too-tall"
  /** Each fits, but not all of them together on one plate. */
  | "too-many"
  /** Nothing printable in it. */
  | "no-model"
  /** Not an STL or a 3MF that can be read. */
  | "unreadable"
  /** The engine ran out of memory. */
  | "memory"
  /** The engine couldn't start (no connection the first time, or a browser that can't run it). */
  | "engine"
  /** OrcaSlicer refused it: `message` has its words. */
  | "orca"
  /** The engine's release has no presets for the nozzle asked for (it has the 0.4 mm one so far). */
  | "nozzle"
  /** The sliced file is over MAX_SLICER_FILE_BYTES. */
  | "too-large";

/** How a model was sliced (or was tried): what the card's "Sliced by Spaghetti" line and its details say. */
export interface SliceSettings {
  /** OrcaSlicer's preset names: "Bambu Lab X2D 0.4 nozzle", "0.20mm Standard @BBL X2D", "Bambu PLA Basic @BBL X2D 0.4 nozzle". */
  machine: string;
  process: string;
  filaments: string[];
  /** mm */
  layerHeight: number;
  /** "PLA", one per filament. */
  materials: string[];
  /** "Textured PEI Plate" */
  bedType: string;
  supports: boolean;
  /** Percent of the original size: 100 unless it was scaled. */
  scale: number;
  /** The settings it was sliced with, in people's words (decision 0047); absent on a slice made before them. */
  slicing?: SlicingSettings;
  /** A 3MF's own settings: "own" for a project made for this printer, "some" (layer height, walls, infill, supports) for another printer's. */
  project?: "own" | "some";
  /** The engine release (`/slicer/<version>/`) and OrcaSlicer's version that sliced it. */
  engine: string;
  orca: string;
}

/** Orca's cautions worth a line on the card: "floating", parts that start in the air while supports are off. */
export type SliceCaution = "floating";

/** A model file's slicing, kept on its row: absent until it is sliced, or until slicing fails. */
export interface FileSlice {
  status: "sliced" | "failed";
  settings: SliceSettings;
  /** The sliced `.gcode.3mf`'s size, in bytes. */
  bytes?: number;
  cautions?: SliceCaution[];
  problem?: SliceProblem;
  /** OrcaSlicer's own words, for "orca". */
  message?: string;
  /** For "too-big", "too-tall" and "too-many": the model's size in mm (x, y, z) as it would stand on the plate. */
  dimensions?: [number, number, number];
  /** The printer's build volume in mm (x, y, z), to say what it takes. */
  volume?: [number, number, number];
  /** The largest scale (percent, whole) at which it fits, for "Scale to 80 % and slice". */
  fitScale?: number;
  /** For "memory": what ran out. A laptop or desktop finishes what a phone couldn't. */
  device?: "phone" | "computer";
  /** When it was sliced or failed (epoch ms). */
  at: number;
}

/**
 * What a slice is asked for: the settings chosen, which win over a 3MF project's own and the defaults. All of them
 * once a model has been sliced and changed; none on its first slice ("Slice it"); one for a one-tap remedy of a slice
 * made before the settings existed ("Supports where needed", "Scale to 80 % and slice").
 */
export type SliceOptions = Partial<SlicingSettings>;

/** The slice a re-slice replaced, kept for its undo (one step back): its record, and what its sliced file said. */
export interface PreviousSlice {
  slice: FileSlice;
  prefill: AttemptSettings;
  objects: string[];
  slicer: string | null;
  hasThumb: boolean;
}
