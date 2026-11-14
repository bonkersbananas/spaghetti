/**
 * The one place that knows OrcaSlicer's names: which of its X2D presets a slice starts from (the engine's
 * presets.json, docs/slicer.md) and which of its config keys say each of Spaghetti's slicing settings (settings.ts),
 * both ways: settings onto the configs (`applySlicing`) and configs back to settings (`readSlicing`: what a 3MF
 * project says, and what a slice used). Every name and value here was tried on the engine (Orca 2.5.0-dev): "where
 * needed" is Orca's "support critical regions only" (floating parts and long ledges get supports, a steep slope
 * doesn't), "everywhere" its usual automatic supports. Pure.
 */
import { materialKey } from "../spools.ts";
import { DEFAULT_SLICING } from "./defaults.ts";
import type { Config, ConfigValue } from "./gcode3mf.ts";
import {
  type Brim,
  INFILL_PATTERNS,
  type InfillPattern,
  normalizeSlicing,
  type SlicingFilament,
  type SlicingSettings,
  type SupportPlacement,
  type SupportStyle,
} from "./settings.ts";
import type { SliceSettings } from "./types.ts";

/** "Bambu Lab X2D": the printer, as Orca's machine presets and a project's `printer_model` name it. */
export const ORCA_PRINTER = "Bambu Lab X2D";

/** The machine preset for a nozzle: "Bambu Lab X2D 0.4 nozzle". */
export const machinePreset = (nozzle: number) => `${ORCA_PRINTER} ${nozzle} nozzle`;

/**
 * The nozzle sizes the engine's release (scripts/slicer/engine.json) has presets for: all four of the X2D's since
 * release 2, whose presets.json has their machines, processes and filaments (resolve-presets.mjs).
 */
export const ENGINE_NOZZLES: readonly number[] = [0.2, 0.4, 0.6, 0.8];

/**
 * The filament presets' suffix for a nozzle: "@BBL X2D 0.4 nozzle", "@BBL X2D 0.2 nozzle"; Bambu's presets for the
 * 0.6 and 0.8 mm nozzles are one set, "@BBL X2D".
 */
const filamentSuffix = (nozzle: number) =>
  nozzle === 0.6 || nozzle === 0.8 ? "@BBL X2D" : `@BBL X2D ${nozzle} nozzle`;

/**
 * The materials Bambu has no 0.2 mm preset for, and what slices in their place: no carbon fibre (it clogs a nozzle
 * that fine), no TPU, PA, PP or PCTG. Silk is Bambu's own silk PLA there, the same thing under another name. `as` is
 * the stand-in's material in the words a note says it with.
 */
const SMALL_NOZZLE_STAND_INS: Readonly<Record<string, { preset: string; as?: string }>> = {
  "Generic PLA Silk": { preset: "Bambu PLA Silk" },
  "Generic PLA-CF": { preset: "Generic PLA", as: "PLA" },
  "Generic PETG-CF": { preset: "Generic PETG", as: "PETG" },
  "Generic PCTG": { preset: "Generic PETG", as: "PETG" },
  "Generic TPU": { preset: "Generic PLA", as: "PLA" },
  "Generic PA": { preset: "Generic PLA", as: "PLA" },
  "Generic PA-CF": { preset: "Generic PLA", as: "PLA" },
  "Generic PP": { preset: "Generic PLA", as: "PLA" },
};

/**
 * Orca's own colour for a filament nobody coloured, then a few more for a project's other filaments: only for the
 * pictures and the sliced file, never a choice anyone made.
 */
export const STAND_IN_COLOURS = [
  "#F2754E",
  "#4F7FC7",
  "#6FA37A",
  "#E8A33D",
  "#A77FC2",
  "#8D9AA3",
  "#C2418A",
  "#3F8F86",
] as const;

/** The default slice's presets, as the details of a slice that failed before the presets were at hand name them. */
export const DEFAULT_PRESETS = {
  machine: machinePreset(DEFAULT_SLICING.nozzle),
  process: "0.20mm Standard @BBL X2D",
  filament: `Bambu PLA Basic ${filamentSuffix(DEFAULT_SLICING.nozzle)}`,
} as const;

/** presets.json in the engine's release (scripts/slicer/resolve-presets.mjs). */
export interface PresetSet {
  format: number;
  orca: { version: string; commit: string; repository: string };
  machine: Record<string, Config>;
  process: Record<string, Config>;
  filament: Record<string, Config>;
}

export const first = (value: ConfigValue | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
const number = (value: ConfigValue | undefined): number => Number.parseFloat(first(value) ?? "");
/** Millimetres to a hundredth, as the settings keep layer heights. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The process preset a layer height starts from, among those for the machine: the one for that height (Orca's
 * Standard before its High Quality, as Bambu Studio offers them), else the nearest one, whose height `applySlicing`
 * then sets: Extra draft (0.28 mm) is the 0.24 mm Standard at 0.28.
 */
export function processPreset(presets: PresetSet, machine: string, layerHeight: number): string | undefined {
  const fits = Object.entries(presets.process).filter(([, config]) => {
    const printers = config.compatible_printers;
    return !printers || (Array.isArray(printers) ? printers : [printers]).includes(machine);
  });
  const ranked = fits
    .map(([name, config]) => ({
      name,
      distance: Math.abs(number(config.layer_height) - layerHeight),
      standard: /\bStandard\b/i.test(name) ? 0 : 1,
    }))
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((a, b) => a.distance - b.distance || a.standard - b.standard || a.name.localeCompare(b.name));
  return ranked[0]?.name;
}

/**
 * The kind of preset a filament slices with, without its nozzle: Bambu's own PLA Basic for Bambu's PLA (and a PLA
 * nobody named a brand for), Orca's generic preset for the rest (silk PLA has its own), and generic PLA for a
 * material it doesn't know.
 */
function filamentKind(filament: Pick<SlicingFilament, "material" | "brand" | "finish">): string {
  const key = materialKey(filament.material);
  const silk = filament.finish === "silk" || /\bSILK\b/i.test(filament.material);
  if (!key || key === "PLA") {
    if (silk) return "Generic PLA Silk";
    const bambu = !filament.brand || /^bambu/i.test(filament.brand);
    return bambu ? "Bambu PLA Basic" : "Generic PLA";
  }
  if (key.startsWith("PLA")) return key.includes("CF") ? "Generic PLA-CF" : silk ? "Generic PLA Silk" : "Generic PLA";
  if (key.startsWith("PETG") || key === "PET") return key.includes("CF") ? "Generic PETG-CF" : "Generic PETG";
  if (key.startsWith("PCTG")) return "Generic PCTG";
  if (key.startsWith("ABS")) return "Generic ABS";
  if (key.startsWith("ASA")) return "Generic ASA";
  if (key.startsWith("TPU") || key.startsWith("TPE")) return "Generic TPU";
  if (key.startsWith("PAHT")) return "Generic PA-CF";
  if (key.startsWith("PA")) return key.includes("CF") ? "Generic PA-CF" : "Generic PA";
  if (key.startsWith("PC")) return "Generic PC";
  if (key.startsWith("PVA")) return "Generic PVA";
  if (key.startsWith("HIPS")) return "Generic HIPS";
  if (key.startsWith("PP")) return "Generic PP";
  return "Generic PLA";
}

/**
 * The filament preset for a filament on a nozzle (filamentKind's, for that nozzle). On the 0.2 mm nozzle, a material
 * Bambu has no preset for slices with its nearest kin (`filamentStandIn` says which).
 */
export function filamentPreset(filament: Pick<SlicingFilament, "material" | "brand" | "finish">, nozzle: number) {
  const kind = filamentKind(filament);
  const preset = nozzle === 0.2 ? (SMALL_NOZZLE_STAND_INS[kind]?.preset ?? kind) : kind;
  return `${preset} ${filamentSuffix(nozzle)}`;
}

/**
 * When a filament slices as another material on a nozzle, because Bambu has no preset for it there: its material
 * and the stand-in's ("PETG-CF", "PETG"), for "No 0.2 mm preset for PETG-CF: sliced as PETG". Else null.
 */
export function filamentStandIn(
  filament: Pick<SlicingFilament, "material" | "brand" | "finish">,
  nozzle: number,
): { material: string; as: string } | null {
  if (nozzle !== 0.2) return null;
  const as = SMALL_NOZZLE_STAND_INS[filamentKind(filament)]?.as;
  return as ? { material: filament.material, as } : null;
}

/** Bambu Studio's plate names as Orca's `curr_bed_type` has them: the smooth PEI plate is its "High Temp Plate". */
export const orcaBedType = (plate: string) => (plate === "Smooth PEI Plate" ? "High Temp Plate" : plate);

/* Each setting and its keys -------------------------------------------------------------------------------- */

const SUPPORT_TYPES: Record<SupportStyle, { type: "tree" | "normal"; style: string }> = {
  tree: { type: "tree", style: "default" },
  "tree-slim": { type: "tree", style: "tree_slim" },
  "tree-strong": { type: "tree", style: "tree_strong" },
  "tree-hybrid": { type: "tree", style: "tree_hybrid" },
  normal: { type: "normal", style: "default" },
  snug: { type: "normal", style: "snug" },
};

const BRIM_TYPES: Record<Brim, string> = { auto: "auto_brim", on: "outer_only", off: "no_brim" };

/** The configs a slice is made from: the machine, the process, and one per filament. */
export interface OrcaConfigs {
  machine: Config;
  process: Config;
  filaments: Config[];
}

/** Which of Orca's keys say each setting (the filaments and the nozzle are presets, the scale is ours). */
export const ORCA_KEYS = {
  layerHeight: ["layer_height"],
  walls: ["wall_loops"],
  infill: ["sparse_infill_density"],
  pattern: ["sparse_infill_pattern"],
  supports: ["enable_support", "support_critical_regions_only"],
  supportStyle: ["support_type", "support_style"],
  brim: ["brim_type"],
  plate: ["curr_bed_type"],
} as const satisfies Partial<Record<keyof SlicingSettings, readonly string[]>>;

/** Fins are the model's own walls (Support Fins): Orca is told no supports. */
const orcasSupports = (placement: SupportPlacement): SupportPlacement => (placement === "fins" ? "off" : placement);

function supportsOf(process: Config): SupportPlacement {
  if (first(process.enable_support) !== "1") return "off";
  return first(process.support_critical_regions_only) === "1" ? "where-needed" : "everywhere";
}

function supportStyleOf(process: Config): SupportStyle {
  const type = first(process.support_type) ?? "";
  const style = first(process.support_style) ?? "default";
  if (/^normal/i.test(type)) return style === "snug" ? "snug" : "normal";
  if (style === "tree_slim") return "tree-slim";
  if (style === "tree_strong") return "tree-strong";
  if (style === "tree_hybrid") return "tree-hybrid";
  return "tree";
}

function brimOf(process: Config): Brim {
  const type = first(process.brim_type) ?? "auto_brim";
  return type === "auto_brim" ? "auto" : type === "no_brim" ? "off" : "on";
}

/** "#F2754EFF" or "#f2754e" → "#f2754e"; anything else → undefined. */
export function colourOf(value: string | undefined): string | undefined {
  const match = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec((value ?? "").trim());
  return match?.[1] ? `#${match[1].toLowerCase()}` : undefined;
}

/**
 * The settings the configs say. `hint` is what was asked: where it says the same thing in other words (the smooth
 * PEI plate, which Orca calls High Temp; a spool's brand, name and finish, which no config holds), its words are
 * kept. `chosen` says, per filament, whether its colour was chosen (a project's or a spool's) or is a stand-in's.
 */
export function readSlicing(
  configs: OrcaConfigs,
  hint: SlicingSettings = DEFAULT_SLICING,
  chosen: readonly boolean[] = [],
): SlicingSettings {
  const { machine, process } = configs;
  const pattern = first(process.sparse_infill_pattern);
  const bed = first(machine.curr_bed_type);
  const filaments = configs.filaments.map((config, index): SlicingFilament => {
    const material = first(config.filament_type) ?? "PLA";
    const colorHex = chosen[index] ? colourOf(first(config.filament_colour)) : undefined;
    const asked = hint.filaments[index];
    // A spool's own words, where the config is still that filament.
    const same =
      asked &&
      materialKey(asked.material) === materialKey(material) &&
      (!asked.colorHex || asked.colorHex === colorHex);
    return same ? { ...asked, ...(colorHex ? { colorHex } : {}) } : { material, ...(colorHex ? { colorHex } : {}) };
  });
  return normalizeSlicing(
    {
      layerHeight: number(process.layer_height),
      walls: number(process.wall_loops),
      infill: number(process.sparse_infill_density),
      pattern: INFILL_PATTERNS.includes(pattern as InfillPattern) ? pattern : hint.pattern,
      // Fins leave Orca's supports off: the asked-for words are kept while the configs say the same.
      supports: hint.supports === "fins" && supportsOf(process) === "off" ? "fins" : supportsOf(process),
      supportStyle: supportStyleOf(process),
      brim: brimOf(process),
      filaments,
      plate: bed && orcaBedType(hint.plate) === bed ? hint.plate : bed,
      nozzle: number(machine.nozzle_diameter),
      scale: hint.scale,
    },
    hint,
  );
}

/**
 * Writes the settings onto the configs (in place), each only where the configs say otherwise, so what the settings
 * can't tell apart stays as it was (a project's brim ears are a brim that is on; its own pattern names too). The
 * filaments and the nozzle are presets, chosen before (`sliceSetup`); the scale is the worker's.
 */
export function applySlicing(configs: Pick<OrcaConfigs, "machine" | "process">, settings: SlicingSettings): void {
  const { machine, process } = configs;
  // A value that reads as the setting is left as it is: a project's 12.5 % infill is "13 %" in the settings' words,
  // and stays 12.5 % unless someone picks another.
  if (round2(number(process.layer_height)) !== round2(settings.layerHeight)) {
    process.layer_height = String(settings.layerHeight);
  }
  if (Math.round(number(process.wall_loops)) !== settings.walls) process.wall_loops = String(settings.walls);
  if (Math.round(number(process.sparse_infill_density)) !== settings.infill) {
    process.sparse_infill_density = `${settings.infill}%`;
  }
  if (first(process.sparse_infill_pattern) !== settings.pattern) process.sparse_infill_pattern = settings.pattern;
  const supports = supportsOf(process);
  const wanted = orcasSupports(settings.supports);
  if (supports !== wanted) {
    process.enable_support = wanted === "off" ? "0" : "1";
    if (wanted !== "off") {
      process.support_critical_regions_only = wanted === "where-needed" ? "1" : "0";
    }
  }
  // Turned on here, supports are automatic (a project's own may be only where it painted them).
  const painted = /manual/i.test(first(process.support_type) ?? "");
  if (supportStyleOf(process) !== settings.supportStyle || (painted && supports !== wanted)) {
    const { type, style } = SUPPORT_TYPES[settings.supportStyle];
    process.support_type = `${type}(auto)`;
    process.support_style = style;
  }
  if (brimOf(process) !== settings.brim) process.brim_type = BRIM_TYPES[settings.brim];
  if (first(machine.curr_bed_type) !== orcaBedType(settings.plate)) machine.curr_bed_type = orcaBedType(settings.plate);
}

/**
 * The X2D's process presets in presets.json for each nozzle, by layer height, Standard where Bambu has two of a
 * height (processPreset picks from the file itself; this is for a slice that failed before it was at hand).
 */
const PROCESSES: Readonly<Record<string, ReadonlyArray<[number, string]>>> = {
  "0.2": [
    [0.08, "0.08mm High Quality @BBL X2D 0.2 nozzle"],
    [0.1, "0.10mm Standard @BBL X2D 0.2 nozzle"],
    [0.12, "0.12mm Balanced Quality @BBL X2D 0.2 nozzle"],
  ],
  "0.4": [
    [0.08, "0.08mm High Quality @BBL X2D"],
    [0.12, "0.12mm High Quality @BBL X2D"],
    [0.16, "0.16mm Standard @BBL X2D"],
    [0.2, "0.20mm Standard @BBL X2D"],
    [0.24, "0.24mm Standard @BBL X2D"],
  ],
  "0.6": [
    [0.18, "0.18mm Balanced Quality @BBL X2D 0.6 nozzle"],
    [0.24, "0.24mm Balanced Quality @BBL X2D 0.6 nozzle"],
    [0.3, "0.30mm Standard @BBL X2D 0.6 nozzle"],
  ],
  "0.8": [
    [0.24, "0.24mm Balanced Quality @BBL X2D 0.8 nozzle"],
    [0.32, "0.32mm Balanced Quality @BBL X2D 0.8 nozzle"],
    [0.4, "0.40mm Standard @BBL X2D 0.8 nozzle"],
  ],
};

/**
 * What a slice's record says about the presets (shared/slicing/types.ts SliceSettings), for a slice that failed
 * before presets.json was at hand: the presets the settings would have used.
 */
export function presetRecord(settings: SlicingSettings): Omit<SliceSettings, "scale" | "engine" | "orca"> {
  const heights = PROCESSES[String(settings.nozzle)] ?? PROCESSES["0.4"] ?? [];
  const nearest = heights.reduce<[number, string] | undefined>(
    (best, entry) =>
      !best || Math.abs(entry[0] - settings.layerHeight) < Math.abs(best[0] - settings.layerHeight) ? entry : best,
    undefined,
  );
  return {
    machine: machinePreset(settings.nozzle),
    process: nearest?.[1] ?? DEFAULT_PRESETS.process,
    filaments: settings.filaments.map((filament) => filamentPreset(filament, settings.nozzle)),
    layerHeight: settings.layerHeight,
    materials: settings.filaments.map((filament) => filament.material),
    bedType: orcaBedType(settings.plate),
    supports: orcasSupports(settings.supports) !== "off",
  };
}
