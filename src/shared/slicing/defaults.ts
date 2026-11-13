import type { SliceOptions, SliceSettings } from "./types.ts";

/**
 * How Spaghetti slices a model nobody set up: one place, so these can become settings. The names are OrcaSlicer's
 * own presets for the X2D, flattened from the engine's Orca commit into its `presets.json` (docs/slicer.md).
 */
export const SLICING_DEFAULTS = {
  machine: "Bambu Lab X2D 0.4 nozzle",
  process: "0.20mm Standard @BBL X2D",
  filament: "Bambu PLA Basic @BBL X2D 0.4 nozzle",
  /** The X2D's stock plate. Its preset names none, and Orca would then pick the Cool Plate (35 °C for PLA). */
  bedType: "Textured PEI Plate",
  /** Off, as Orca's process presets have it; "Slice with supports" turns on Orca's tree supports for one file. */
  supports: false,
  /** Orca's own colour for a filament nobody coloured, then a few more for a project's other filaments. */
  colours: ["#F2754E", "#4F7FC7", "#6FA37A", "#E8A33D", "#A77FC2", "#8D9AA3", "#C2418A", "#3F8F86"],
  /** Objects on the plate are laid out this far apart, in mm. */
  gap: 6,
} as const;

/** The supports "Slice with supports" asks for: Orca's tree supports, placed where needed. */
export const SUPPORTS_ON = { enable_support: "1", support_type: "tree(auto)" } as const;

/**
 * The X2D filament preset for a material a project names ("PETG", "PLA-CF"…): Bambu's own PLA Basic for PLA, Orca's
 * generic preset for the others, and generic PLA for anything it doesn't know. Every name is in presets.json.
 */
export function filamentPresetFor(material: string | undefined): string {
  const key = (material ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const generic = (name: string) => `Generic ${name} @BBL X2D 0.4 nozzle`;
  if (!key || key === "PLA" || key === "PLA BASIC" || key === "PLA MATTE") return SLICING_DEFAULTS.filament;
  if (key.startsWith("PLA"))
    return key.includes("CF") ? generic("PLA-CF") : key.includes("SILK") ? generic("PLA Silk") : generic("PLA");
  if (key.startsWith("PETG") || key === "PET") return key.includes("CF") ? generic("PETG-CF") : generic("PETG");
  if (key.startsWith("PCTG")) return generic("PCTG");
  if (key.startsWith("ABS")) return generic("ABS");
  if (key.startsWith("ASA")) return generic("ASA");
  if (key.startsWith("TPU") || key.startsWith("TPE")) return generic("TPU");
  if (key.startsWith("PA") && !key.startsWith("PAHT")) return key.includes("CF") ? generic("PA-CF") : generic("PA");
  if (key.startsWith("PAHT")) return generic("PA-CF");
  if (key.startsWith("PC")) return generic("PC");
  if (key.startsWith("PVA")) return generic("PVA");
  if (key.startsWith("HIPS")) return generic("HIPS");
  if (key.startsWith("PP")) return generic("PP");
  return generic("PLA");
}

/** What the defaults say about a slice, before presets.json is at hand (a file that fails before it is read). */
export function defaultSettings(options: SliceOptions = {}): Omit<SliceSettings, "scale" | "engine" | "orca"> {
  return {
    machine: SLICING_DEFAULTS.machine,
    process: SLICING_DEFAULTS.process,
    filaments: [SLICING_DEFAULTS.filament],
    layerHeight: 0.2,
    materials: ["PLA"],
    bedType: SLICING_DEFAULTS.bedType,
    supports: !!options.supports,
  };
}
