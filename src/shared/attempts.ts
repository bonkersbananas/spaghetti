/**
 * Print attempts: outcomes, settings, failure tags and success notes, and
 * "what changed since the attempt before". Shared by the Worker and the app.
 *
 * Settings use the names of the .3mf reader's output (src/shared/threemf/types.ts)
 * where they overlap, so phase 5 can prefill an attempt from a slicer file.
 */

/** How an attempt went. A printing attempt has no outcome yet (null). */
export const OUTCOMES = ["success", "partial", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_LABELS: Record<Outcome, string> = {
  success: "Worked",
  partial: "Partly",
  failed: "Spaghetti",
};

/** One spool used by an attempt. */
export interface AttemptFilament {
  /** Material, such as "PLA" or "PETG" (the reader's PlateFilament.type). */
  type?: string;
  /** "Bambu", "Polymaker"… */
  brand?: string;
  /** Lowercase #rrggbb (the reader's PlateFilament.colorHex). */
  colorHex?: string;
  /** What people call the color: "Jade white". */
  colorName?: string;
  /** The filament preset, such as "Bambu PLA Basic" (the reader's PlateFilament.profile). */
  profile?: string;
  /** The physical AMS slot, such as "A2", or "Ext" for the external spool. */
  amsSlot?: string;
}

export const NOZZLES = ["main", "auxiliary"] as const;
export type Nozzle = (typeof NOZZLES)[number];

export const SUPPORT_TYPES = ["normal", "tree"] as const;
export type SupportType = (typeof SUPPORT_TYPES)[number];

/**
 * What was printed and how. Every field is optional: people fill in what they
 * know. Plain values only, never an id that only makes sense in Bambu's cloud.
 */
export interface AttemptSettings {
  filaments?: AttemptFilament[];
  /** The plate, such as "Textured PEI Plate" (the reader's bedType). */
  bedType?: string;
  nozzle?: Nozzle;
  /** mm */
  nozzleDiameter?: number;
  /** mm */
  layerHeight?: number;
  /** Percent, 0-100. */
  infillDensity?: number;
  supportEnabled?: boolean;
  supportType?: SupportType;
  brim?: boolean;
  /** The process preset, such as "0.20mm Standard @BBL X2D". */
  processPreset?: string;
  /** °C */
  nozzleTemperature?: number;
  bedTemperature?: number;
  chamberTemperature?: number;
  /** The slicer's estimate, in minutes. */
  estimatedMinutes?: number;
  actualMinutes?: number;
  /** Grams of filament used. */
  weightGrams?: number;
  /** Where it failed, if it did: percent of the print, or layer number. */
  failedAtPercent?: number;
  failedAtLayer?: number;
  filamentDried?: boolean;
}

/**
 * What happened on one attempt rather than what was chosen for it: these are
 * not carried over to the next attempt and not part of "what changed".
 */
export const RESULT_KEYS = [
  "estimatedMinutes",
  "actualMinutes",
  "weightGrams",
  "failedAtPercent",
  "failedAtLayer",
] as const satisfies ReadonlyArray<keyof AttemptSettings>;

/** "Same as last time": the settings a new attempt starts from. */
export function carryOver(settings: AttemptSettings | undefined): AttemptSettings {
  const next: AttemptSettings = { ...settings };
  for (const key of RESULT_KEYS) delete next[key];
  if (next.filaments) next.filaments = next.filaments.map((filament) => ({ ...filament }));
  return next;
}

/** Plates Bambu Studio offers; people can type another. */
export const BED_TYPES = [
  "Textured PEI Plate",
  "Smooth PEI Plate",
  "Cool Plate",
  "Engineering Plate",
  "High Temp Plate",
  "Supertack Plate",
] as const;

export const FILAMENT_TYPES = ["PLA", "PETG", "ABS", "ASA", "TPU", "PA", "PC", "PVA", "PLA-CF", "PETG-CF"] as const;
export const NOZZLE_DIAMETERS = [0.2, 0.4, 0.6, 0.8] as const;
export const LAYER_HEIGHTS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28] as const;

export type TagKind = "failure" | "success";

export interface TagDefinition {
  slug: string;
  label: string;
}

/** Failure tags from docs/printer.md, section 7. Slugs are stable; labels can change. */
export const FAILURE_TAGS: readonly TagDefinition[] = [
  { slug: "spaghetti", label: "Spaghetti" },
  { slug: "bed-adhesion", label: "Bed adhesion" },
  { slug: "warping", label: "Warping" },
  { slug: "layer-shift", label: "Layer shift" },
  { slug: "clog", label: "Clog" },
  { slug: "under-extrusion", label: "Under-extrusion" },
  { slug: "over-extrusion", label: "Over-extrusion" },
  { slug: "stringing", label: "Stringing" },
  { slug: "elephants-foot", label: "Elephant's foot" },
  { slug: "ams-feed", label: "AMS feed" },
  { slug: "ams-tangle", label: "AMS tangle" },
  { slug: "purge-chute-jam", label: "Purge chute jam" },
  { slug: "wet-filament", label: "Wet filament" },
  { slug: "bad-overhang", label: "Bad overhang" },
  { slug: "support-trouble", label: "Support trouble" },
  { slug: "color-bleed", label: "Color bleed" },
  { slug: "seam-or-banding", label: "Seam or banding" },
  { slug: "power-or-pause", label: "Power or pause" },
  { slug: "other", label: "Something else" },
];

/** Success notes from docs/printer.md, section 7: what worked, to find again later. */
export const SUCCESS_NOTES: readonly TagDefinition[] = [
  { slug: "great-first-layer", label: "Great first layer" },
  { slug: "clean-supports", label: "Clean supports" },
  { slug: "strong-and-tight-fit", label: "Strong, tight fit" },
  { slug: "nice-surface", label: "Nice surface" },
  { slug: "colors-crisp", label: "Crisp colors" },
  { slug: "fast-profile-ok", label: "Fast profile was fine" },
  { slug: "dried-filament-helped", label: "Drying helped" },
  { slug: "settings-worth-reusing", label: "Settings worth reusing" },
  { slug: "would-print-again", label: "Would print again" },
];

export const BUILT_IN_TAGS: Record<TagKind, readonly TagDefinition[]> = {
  failure: FAILURE_TAGS,
  success: SUCCESS_NOTES,
};

/** "Nozzle hit the part!" → "nozzle-hit-the-part". Empty when nothing usable is left. */
export function slugify(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
}

/** A tag's label: built in, one people added, or the slug made readable. */
export function tagLabel(kind: TagKind, slug: string, custom: readonly TagDefinition[] = []): string {
  const found = BUILT_IN_TAGS[kind].find((tag) => tag.slug === slug) ?? custom.find((tag) => tag.slug === slug);
  if (found) return found.label;
  const words = slug.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** One line of "what changed since the attempt before", such as "bed 60 → 65 °C". */
export interface SettingChange {
  key: string;
  text: string;
}

const num = (value: number) => String(Number(value.toFixed(2)));
const mm2 = (value: number) => value.toFixed(2);
/** "Textured PEI Plate" → "Textured PEI". */
export const shortPlate = (bed: string) => bed.replace(/\s+plate$/i, "");
/** "0.20mm Standard @BBL X2D" → "0.20mm Standard". */
export const shortPreset = (preset: string) => preset.replace(/\s*@.*$/, "");

function numberChange(
  key: string,
  label: string,
  before: number | undefined,
  after: number | undefined,
  format: (value: number) => string,
  unit: string,
  /** What it reads as once cleared, when "no <label>" would be unclear. */
  cleared = `no ${label}`,
): SettingChange | null {
  if (before === after) return null;
  if (after === undefined) return { key, text: cleared };
  if (before === undefined) return { key, text: `${label} ${format(after)}${unit}` };
  return { key, text: `${label} ${format(before)} → ${format(after)}${unit}` };
}

function textChange(
  key: string,
  before: string | undefined,
  after: string | undefined,
  phrase: (before: string | undefined, after: string | undefined) => string,
): SettingChange | null {
  if ((before ?? "") === (after ?? "")) return null;
  return { key, text: phrase(before || undefined, after || undefined) };
}

function filamentName(filament: AttemptFilament): string {
  const parts = [filament.colorName, filament.brand, filament.type].filter(Boolean);
  return parts.length ? parts.join(" ") : "a filament";
}

function filamentChanges(before: AttemptFilament[] = [], after: AttemptFilament[] = []): SettingChange[] {
  const changes: SettingChange[] = [];
  const many = Math.max(before.length, after.length) > 1;
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = before[i];
    const b = after[i];
    const key = `filaments.${i}`;
    if (!a && b) {
      changes.push({ key, text: `added ${filamentName(b)}` });
      continue;
    }
    if (a && !b) {
      changes.push({ key, text: `dropped ${filamentName(a)}` });
      continue;
    }
    if (!a || !b) continue;
    const prefix = many ? `filament ${i + 1}: ` : "";
    if ((a.type ?? "") !== (b.type ?? "") && b.type) {
      changes.push({ key: `${key}.type`, text: `${prefix}${b.type}${a.type ? ` instead of ${a.type}` : ""}` });
    }
    if ((a.brand ?? "") !== (b.brand ?? "") && b.brand) {
      changes.push({ key: `${key}.brand`, text: `${prefix}${b.brand}${a.brand ? ` instead of ${a.brand}` : ""}` });
    }
    if ((a.profile ?? "") !== (b.profile ?? "") && b.profile) {
      changes.push({ key: `${key}.profile`, text: `${prefix}${a.profile ? `${a.profile} → ` : ""}${b.profile}` });
    }
    if ((a.colorHex ?? "") !== (b.colorHex ?? "") || (a.colorName ?? "") !== (b.colorName ?? "")) {
      const text =
        a.colorName && b.colorName ? `${a.colorName} → ${b.colorName}` : b.colorName ? b.colorName : "another color";
      changes.push({ key: `${key}.color`, text: `${prefix}${text}` });
    }
  }
  return changes;
}

/**
 * What someone tried differently from one attempt to the next, in a few
 * plain words each: "bed 60 → 65 °C", "added a brim", "PETG instead of PLA".
 * Results (times, weight, where it failed) and AMS slots are left out.
 */
export function describeChanges(before: AttemptSettings, after: AttemptSettings): SettingChange[] {
  const changes: Array<SettingChange | null> = [
    ...filamentChanges(before.filaments, after.filaments),
    textChange("bedType", before.bedType, after.bedType, (a, b) =>
      b ? (a ? `${shortPlate(a)} → ${shortPlate(b)} plate` : `${shortPlate(b)} plate`) : "no plate set",
    ),
    textChange("nozzle", before.nozzle, after.nozzle, (a, b) =>
      b ? (a ? `${a} → ${b} nozzle` : `${b} nozzle`) : "no nozzle set",
    ),
    numberChange("nozzleDiameter", "nozzle", before.nozzleDiameter, after.nozzleDiameter, num, " mm", "no nozzle size"),
    numberChange("layerHeight", "layers", before.layerHeight, after.layerHeight, mm2, " mm"),
    numberChange("infillDensity", "infill", before.infillDensity, after.infillDensity, num, "%"),
    supportChange(before, after),
    before.brim === after.brim || (!before.brim && !after.brim)
      ? null
      : { key: "brim", text: after.brim ? "added a brim" : "no brim" },
    textChange("processPreset", before.processPreset, after.processPreset, (a, b) =>
      b ? (a ? `${shortPreset(a)} → ${shortPreset(b)}` : `${shortPreset(b)} profile`) : "no profile set",
    ),
    numberChange(
      "nozzleTemperature",
      "nozzle",
      before.nozzleTemperature,
      after.nozzleTemperature,
      num,
      " °C",
      "no nozzle temperature",
    ),
    numberChange(
      "bedTemperature",
      "bed",
      before.bedTemperature,
      after.bedTemperature,
      num,
      " °C",
      "no bed temperature",
    ),
    numberChange(
      "chamberTemperature",
      "chamber",
      before.chamberTemperature,
      after.chamberTemperature,
      num,
      " °C",
      "no chamber temperature",
    ),
    before.filamentDried === after.filamentDried || (!before.filamentDried && !after.filamentDried)
      ? null
      : { key: "filamentDried", text: after.filamentDried ? "dried the filament" : "filament not dried" },
  ];
  return changes.filter((change): change is SettingChange => change !== null);
}

function supportChange(before: AttemptSettings, after: AttemptSettings): SettingChange | null {
  const a = before.supportEnabled ? (before.supportType ?? "normal") : null;
  const b = after.supportEnabled ? (after.supportType ?? "normal") : null;
  if (a === b) return null;
  if (!b) return { key: "supports", text: "no supports" };
  if (!a) return { key: "supports", text: b === "tree" ? "added tree supports" : "added supports" };
  return { key: "supports", text: `${a} → ${b} supports` };
}

/** Attempts in the order they were printed: the first is attempt 1. */
export function byPrintTime<T extends { printedAt: number; createdAt: number; id: string }>(attempts: T[]): T[] {
  return [...attempts].sort((a, b) => a.printedAt - b.printedAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}
