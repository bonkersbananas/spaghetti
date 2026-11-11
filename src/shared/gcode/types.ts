/** What the G-code reader produces: the extrusion moves of one plate, layer by layer, in typed arrays. */

/** Feature (move type) ids as stored in `Layer.feature`. Order is the legend's order. */
export const FEATURES = [
  "Other",
  "Outer wall",
  "Inner wall",
  "Overhang wall",
  "Sparse infill",
  "Solid infill",
  "Top surface",
  "Bottom surface",
  "Bridge",
  "Gap infill",
  "Support",
  "Support interface",
  "Skirt and brim",
  "Prime tower",
  "Ironing",
] as const;

export type FeatureName = (typeof FEATURES)[number];

export interface Layer {
  /** Counting from 0. */
  index: number;
  /** Height of the layer's top, in mm. */
  z: number;
  /** The layer's thickness in mm. */
  height: number;
  /** Seconds into the print when this layer starts, when the file says (M73 remaining time). */
  seconds: number | null;
  /** Number of segments. */
  count: number;
  /** Six floats per segment: x0 y0 z0 x1 y1 z1, in mm, printer coordinates (z up). */
  pos: Float32Array;
  /** One feature id (index into FEATURES) per segment. */
  feature: Uint8Array;
  /** One filament index (counting from 0, the slicer's T number) per segment. */
  filament: Uint8Array;
}

export interface ToolpathFilament {
  /** `#rrggbb`, or null when neither the file nor the matched spools say. */
  color: string | null;
  type?: string;
  /** The nozzle the filament prints with on a dual-nozzle printer: 0 is the left, 1 the right. Absent when the file doesn't say. */
  nozzle?: 0 | 1;
  /** Segments printed with it. */
  segments: number;
}

export interface Toolpaths {
  /** The plate, counting from 1. */
  plate: number;
  layers: Layer[];
  filaments: ToolpathFilament[];
  /** [minX, minY, minZ, maxX, maxY, maxZ] of everything kept, or null when nothing was. */
  bounds: [number, number, number, number, number, number] | null;
  /** The slicer's estimate for the whole print, in seconds, when known. */
  totalSeconds: number | null;
  /** Layer count the slicer announced (`layer num/total_layer_count`), which can exceed `layers` for a truncated file. */
  announcedLayers: number | null;
  /** Segments kept, and how many extrusion moves the file had. */
  stats: { segments: number; moves: number; decimated: boolean; truncated: boolean; sourceBytes: number };
  warnings: string[];
}

/** The buffers to hand to `postMessage` as transferables. */
export function toolpathBuffers(t: Toolpaths): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const l of t.layers) {
    out.push(l.pos.buffer as ArrayBuffer, l.feature.buffer as ArrayBuffer, l.filament.buffer as ArrayBuffer);
  }
  return out;
}
