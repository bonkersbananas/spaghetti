/** What we can read from a Bambu Studio / Orca Slicer `.3mf`. Every field is optional on purpose. */

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp";

export interface Thumbnail {
  bytes: Uint8Array;
  mediaType: ImageMediaType;
}

export interface PlateObject {
  name: string;
  /** True when the object was skipped during the print (sliced files only). */
  skipped?: boolean;
}

export interface PlateFilament {
  /**
   * The project filament number, counting from 1 (slice_info's `id`). This is NOT the
   * physical AMS slot: that is chosen when the user presses Print, and no file records it.
   */
  slot: number;
  /** Material, e.g. "PLA", "PETG". */
  type?: string;
  /** Lowercase `#rrggbb` (the alpha channel, if the slicer wrote one, is dropped). */
  colorHex?: string;
  /** The filament preset name, e.g. "Bambu PLA Basic" (from project_settings). */
  profile?: string;
  usedGrams?: number;
  usedMeters?: number;
}

export interface Plate {
  /** Counting from 1. */
  index: number;
  name?: string;
  thumbnail?: Thumbnail;
  /** The slicer's print time estimate, in seconds (sliced files only). */
  predictedSeconds?: number;
  /** Estimated filament weight in grams (sliced files only). */
  weightGrams?: number;
  objects: PlateObject[];
  /**
   * Sliced files: the filaments the plate really uses. Project files: the filaments the plate's
   * objects are assigned to (the extruder each object uses), which is a good guess, not a slice.
   */
  filaments: PlateFilament[];
  bedType?: string;
  nozzleDiameter?: number;
  supportUsed?: boolean;
}

export interface PrintSettings {
  printerModel?: string;
  /** The printer preset's name, e.g. "Bambu Lab X2D 0.4 nozzle". */
  printerPreset?: string;
  /** The process preset's name, e.g. "0.20mm Standard @BBL X2D". */
  processPreset?: string;
  /** mm */
  layerHeight?: number;
  initialLayerHeight?: number;
  /** Percent, 0-100. */
  infillDensity?: number;
  infillPattern?: string;
  wallLoops?: number;
  supportEnabled?: boolean;
  supportType?: string;
  /** °C, one entry per project filament (index 0 is filament 1). */
  nozzleTemperature?: number[];
  nozzleTemperatureInitialLayer?: number[];
  /** °C for the selected bed type, one entry per project filament. */
  bedTemperature?: number[];
  /** e.g. "Textured PEI Plate". */
  bedType?: string;
  /** mm */
  nozzleDiameter?: number;
}

export type ThreeMfKind = "sliced" | "project" | "unknown";

export interface ThreeMfResult {
  /**
   * "sliced": has per-plate slice stats (slice_info.config). "project": has plates or settings but
   * was never sliced. "unknown": nothing we recognise (not a Bambu/Orca file, or broken).
   */
  kind: ThreeMfKind;
  /** Who wrote it, from the file's own Application metadata. */
  slicer?: { name: string; version?: string };
  plates: Plate[];
  settings: PrintSettings;
  /** Everything that went wrong or was skipped; the reader never throws. */
  warnings: string[];
}
