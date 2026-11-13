/**
 * Slicing settings: what people change when Spaghetti slices a model, in one shape (decision 0047). The app shows
 * them and keeps them per model, the Worker stores them with the model's slice, MCP reports them, and a slicer takes
 * them: OrcaSlicer's engine through orca.ts (the one place that knows its presets and keys), and later the Rust
 * slicer (slicer-rs). Plain JSON: millimetres and percents as numbers, choices as short words; once normalized every
 * field is there. Pure and small, so the cards and sheets can import it.
 */
import { BED_TYPES, NOZZLE_DIAMETERS } from "../attempts.ts";
import { finishLabel } from "../spools.ts";
import { DEFAULT_SLICING, STAND_IN_FILAMENT } from "./defaults.ts";

/**
 * Off, only under what would otherwise fall (floating parts, long ledges), under every steep overhang, or fins:
 * breakaway walls built into the model itself (Support Fins, decision 0052), with the slicer's own supports off.
 */
export type SupportPlacement = "off" | "where-needed" | "everywhere" | "fins";
export const SUPPORT_PLACEMENT_IDS = ["off", "where-needed", "everywhere", "fins"] as const;
/**
 * How supports are built, as OrcaSlicer offers them: trees (organic branches, its default, or its slim, strong and
 * hybrid trees) or normal supports (straight columns on a grid, or snug ones that follow the model's outline).
 */
export type SupportStyle = "tree" | "tree-slim" | "tree-strong" | "tree-hybrid" | "normal" | "snug";
export const SUPPORT_STYLE_IDS = ["tree", "tree-slim", "tree-strong", "tree-hybrid", "normal", "snug"] as const;
/** A brim where a small footprint needs one (the slicer decides), always, or never. */
export type Brim = "auto" | "on" | "off";

/**
 * The sparse infill patterns a slicer may be asked for, as OrcaSlicer's configs name them ("zig-zag" is Orca's
 * rectilinear). People pick from `PATTERNS`; the rest are here because a 3MF project may use them.
 */
export const INFILL_PATTERNS = [
  "crosshatch",
  "gyroid",
  "grid",
  "cubic",
  "honeycomb",
  "lightning",
  "zig-zag",
  "line",
  "triangles",
  "tri-hexagon",
  "adaptivecubic",
  "quartercubic",
  "supportcubic",
  "alignedrectilinear",
  "3dhoneycomb",
  "hilbertcurve",
  "archimedeanchords",
  "octagramspiral",
  "concentric",
  "tpmsd",
] as const;
export type InfillPattern = (typeof INFILL_PATTERNS)[number];

/** One filament the plate prints with: from the Pantry, a 3MF's own, or the stand-in nobody chose. */
export interface SlicingFilament {
  /** "PLA", "PETG-CF": what the slicer's filament preset is picked by. */
  material: string;
  /** Lowercase "#rrggbb": what the plate picture and the sliced file show. None for the stand-in. */
  colorHex?: string;
  /** What people call the colour: "Orange". */
  colorName?: string;
  /** "Bambu", "Polymaker"… */
  brand?: string;
  /** The Pantry's finish: "basic", "matte", "silk"… */
  finish?: string;
  /** The Pantry's spool, when it was picked from there. The values above stay, so a slice reads the same without it. */
  spoolId?: string;
}

export interface SlicingSettings {
  /** mm. Fine 0.12, Standard 0.20, Draft 0.24, Extra draft 0.28 (`QUALITIES`); another (a project's 0.16) is fine. */
  layerHeight: number;
  /** Wall loops round the outside. */
  walls: number;
  /** How much of the inside is filled, in percent (0-100). */
  infill: number;
  pattern: InfillPattern;
  supports: SupportPlacement;
  supportStyle: SupportStyle;
  brim: Brim;
  /** One per filament the plate prints with, filament 1 first: one for an STL. */
  filaments: SlicingFilament[];
  /** The plate, as Bambu Studio names it: "Textured PEI Plate". */
  plate: string;
  /** The nozzle's diameter, in mm. */
  nozzle: number;
  /** Percent of the model's own size. */
  scale: number;
  /**
   * The face the model rests on, as the direction in the model's own axes (a unit vector) that points down: null
   * lays it as the file does. The original file stays as it is; only the slice is turned (`layMeshDown`).
   */
  orientation: Orientation | null;
}

/** A direction in the model's own axes: [x, y, z], unit length. */
export type Orientation = [number, number, number];

export type SlicingKey = keyof SlicingSettings;

/* The choices people make, with what each does in plain words ------------------------------------------------- */

export interface Choice<Id extends string> {
  id: Id;
  label: string;
  /** What it does, lowercase, to follow the label: "Fine · slower, smoother". */
  effect: string;
}

export type QualityId = "fine" | "standard" | "draft" | "extra-draft";
export interface Quality extends Choice<QualityId> {
  /** mm */
  layerHeight: number;
}

/** Layer heights by name. The mm is shown beside the name. */
export const QUALITIES: readonly Quality[] = [
  { id: "fine", label: "Fine", layerHeight: 0.12, effect: "slower, smoother" },
  { id: "standard", label: "Standard", layerHeight: 0.2, effect: "the usual balance" },
  { id: "draft", label: "Draft", layerHeight: 0.24, effect: "quicker, lines show" },
  { id: "extra-draft", label: "Extra draft", layerHeight: 0.28, effect: "quickest, roughest" },
];

export type StrengthId = "light" | "standard" | "strong";
export interface Strength extends Choice<StrengthId> {
  walls: number;
  infill: number;
  pattern: InfillPattern;
}

/** Walls, infill and its pattern together. Exact numbers are under "More". */
export const STRENGTHS: readonly Strength[] = [
  { id: "light", label: "Light", walls: 2, infill: 10, pattern: "lightning", effect: "for looking at, quickest" },
  { id: "standard", label: "Everyday", walls: 2, infill: 15, pattern: "crosshatch", effect: "for most prints" },
  { id: "strong", label: "Strong", walls: 4, infill: 25, pattern: "gyroid", effect: "for parts that take a load" },
];

export const SUPPORT_PLACEMENTS: readonly Choice<SupportPlacement>[] = [
  { id: "off", label: "Off", effect: "for models that stand on their own" },
  { id: "where-needed", label: "Where needed", effect: "only under parts that would fall" },
  { id: "everywhere", label: "Everywhere", effect: "under every steep overhang" },
  { id: "fins", label: "Fins", effect: "breakaway fins built into the model" },
];

/** Tree and Normal first: the two most people choose between. */
export const SUPPORT_STYLES: readonly Choice<SupportStyle>[] = [
  { id: "tree", label: "Tree", effect: "branches that snap off cleanly" },
  { id: "normal", label: "Normal", effect: "straight columns, sturdy" },
  { id: "tree-slim", label: "Slim tree", effect: "thinner branches" },
  { id: "tree-strong", label: "Strong tree", effect: "thicker branches, for heavy parts" },
  { id: "tree-hybrid", label: "Hybrid", effect: "branches, and columns under big flat parts" },
  { id: "snug", label: "Snug", effect: "hugs the model, less to print" },
];

export const BRIMS: readonly Choice<Brim>[] = [
  { id: "auto", label: "Auto", effect: "where a small footprint needs one" },
  { id: "on", label: "On", effect: "a ring that holds the edges down" },
  { id: "off", label: "Off", effect: "nothing round the edges" },
];

/** The infill patterns people pick from, in plain words. */
export const PATTERNS: readonly Choice<InfillPattern>[] = [
  { id: "crosshatch", label: "Crosshatch", effect: "the X2D's usual" },
  { id: "gyroid", label: "Gyroid", effect: "strong every way" },
  { id: "grid", label: "Grid", effect: "simple and stiff" },
  { id: "cubic", label: "Cubic", effect: "strong, and quick" },
  { id: "honeycomb", label: "Honeycomb", effect: "stiff, slower" },
  { id: "lightning", label: "Lightning", effect: "only holds up the top" },
];

/** The plates a model can be sliced for: the Printer page's, and Bambu's textured cool plate. */
export const SLICING_PLATES: readonly string[] = [...BED_TYPES, "Textured Cool Plate"];

/** The X2D's nozzle sizes, in mm. */
export const SLICING_NOZZLES: readonly number[] = NOZZLE_DIAMETERS;

/** Limits a slicer can work within; a nozzle takes layers from a fifth to seven tenths of its width. */
export const LIMITS = {
  walls: { min: 1, max: 12 },
  infill: { min: 0, max: 100 },
  scale: { min: 1, max: 1000 },
  filaments: { max: 16 },
} as const;

/** The layer heights a nozzle prints, in mm: 0.08 to 0.28 for the 0.4 mm nozzle. */
export function layerRange(nozzle: number): { min: number; max: number } {
  return { min: round2(nozzle * 0.2), max: round2(nozzle * 0.7) };
}

/** The named quality of a layer height ("Fine" for 0.12 mm), or null for another height. */
export const qualityOf = (layerHeight: number): Quality | null =>
  QUALITIES.find((quality) => Math.abs(quality.layerHeight - layerHeight) < 0.001) ?? null;

/** The named strength of walls, infill and pattern together, or null when they are set by hand. */
export const strengthOf = (settings: Pick<SlicingSettings, "walls" | "infill" | "pattern">): Strength | null =>
  STRENGTHS.find(
    (strength) =>
      strength.walls === settings.walls && strength.infill === settings.infill && strength.pattern === settings.pattern,
  ) ?? null;

/* Checking what comes in -------------------------------------------------------------------------------------- */

const round2 = (value: number) => Math.round(value * 100) / 100;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const oneOf = <T extends string>(options: readonly T[], value: unknown): T | undefined =>
  options.includes(value as T) ? (value as T) : undefined;
const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

/** A direction as given, as a unit vector rounded to 4 decimals; undefined when it isn't three finite numbers. */
export function orientationOf(value: unknown): Orientation | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const [x, y, z] = value as unknown[];
  if (![x, y, z].every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  const length = Math.hypot(x as number, y as number, z as number);
  if (!(length > 1e-6)) return undefined;
  const unit = [x, y, z].map((v) => Math.round(((v as number) / length) * 1e4) / 1e4 + 0) as Orientation;
  // Straight down is how a file lies already.
  return unit[0] === 0 && unit[1] === 0 && unit[2] === -1 ? null : unit;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const SPOOL_ID = /^[\w-]{1,64}$/;

/** A filament as given, or null when it says no material. Unknown fields are dropped. */
export function slicingFilament(value: unknown): SlicingFilament | null {
  if (!isRecord(value)) return null;
  const material = text(value.material, 40);
  if (!material) return null;
  const colorHex = typeof value.colorHex === "string" && COLOR.test(value.colorHex) ? value.colorHex : undefined;
  const colorName = text(value.colorName, 40);
  const brand = text(value.brand, 60);
  const finish = text(value.finish, 40);
  const spoolId = typeof value.spoolId === "string" && SPOOL_ID.test(value.spoolId) ? value.spoolId : undefined;
  return {
    material,
    ...(colorHex ? { colorHex: colorHex.toLowerCase() } : {}),
    ...(colorName ? { colorName } : {}),
    ...(brand ? { brand } : {}),
    ...(finish ? { finish: finish.toLowerCase() } : {}),
    ...(spoolId ? { spoolId } : {}),
  };
}

/**
 * What is wrong with settings as given (an API body, a stored row), one plain line each; empty when they are whole
 * and right. `normalizeSlicing` mends instead of refusing.
 */
export function slicingProblems(value: unknown): string[] {
  if (!isRecord(value)) return ["Slicing settings are an object."];
  const problems: string[] = [];
  const nozzle = number(value.nozzle);
  if (nozzle === undefined || !SLICING_NOZZLES.includes(nozzle)) {
    problems.push(`nozzle is one of ${SLICING_NOZZLES.join(", ")} (mm).`);
  }
  const range = layerRange(nozzle !== undefined && SLICING_NOZZLES.includes(nozzle) ? nozzle : DEFAULT_SLICING.nozzle);
  const layerHeight = number(value.layerHeight);
  if (layerHeight === undefined || layerHeight < range.min - 1e-9 || layerHeight > range.max + 1e-9) {
    problems.push(`layerHeight is from ${range.min} to ${range.max} mm for this nozzle.`);
  }
  for (const key of ["walls", "infill", "scale"] as const) {
    const limits = LIMITS[key];
    const given = number(value[key]);
    if (given === undefined || !Number.isInteger(given) || given < limits.min || given > limits.max) {
      problems.push(`${key} is a whole number from ${limits.min} to ${limits.max}.`);
    }
  }
  if (!oneOf(INFILL_PATTERNS, value.pattern)) problems.push(`pattern is one of ${INFILL_PATTERNS.join(", ")}.`);
  if (!oneOf(SUPPORT_PLACEMENT_IDS, value.supports)) {
    problems.push("supports is off, where-needed, everywhere or fins.");
  }
  if (!oneOf(SUPPORT_STYLE_IDS, value.supportStyle)) {
    problems.push(`supportStyle is one of ${SUPPORT_STYLE_IDS.join(", ")}.`);
  }
  if (!oneOf(["auto", "on", "off"], value.brim)) problems.push("brim is auto, on or off.");
  if (!oneOf(SLICING_PLATES, value.plate)) problems.push(`plate is one of ${SLICING_PLATES.join(", ")}.`);
  const filaments = value.filaments;
  if (!Array.isArray(filaments) || !filaments.length || filaments.length > LIMITS.filaments.max) {
    problems.push(`filaments lists 1 to ${LIMITS.filaments.max} filaments.`);
  } else if (filaments.some((filament) => !slicingFilament(filament))) {
    problems.push("Each filament has a material (and a colorHex like #f2754e, if any).");
  }
  if (value.orientation !== undefined && orientationOf(value.orientation) === undefined) {
    problems.push("orientation is null, or [x, y, z]: the direction in the model that points down.");
  }
  const known = new Set<string>(Object.keys(DEFAULT_SLICING));
  for (const key of Object.keys(value)) if (!known.has(key)) problems.push(`${key} isn't a slicing setting.`);
  return problems;
}

/**
 * Settings from anything (a stored row from an older version, a partial change): each field that is missing or
 * not right is `base`'s, so the result is always whole. Layer heights the nozzle can't print are brought within it.
 */
export function normalizeSlicing(value: unknown, base: SlicingSettings = DEFAULT_SLICING): SlicingSettings {
  const given = isRecord(value) ? value : {};
  const nozzle = number(given.nozzle);
  const nozzleOk = nozzle !== undefined && SLICING_NOZZLES.includes(nozzle) ? nozzle : base.nozzle;
  const range = layerRange(nozzleOk);
  const layer = number(given.layerHeight) ?? base.layerHeight;
  const whole = (key: "walls" | "infill" | "scale") => {
    const raw = number(given[key]);
    const { min, max } = LIMITS[key];
    return raw === undefined ? base[key] : Math.min(max, Math.max(min, Math.round(raw)));
  };
  const filaments = Array.isArray(given.filaments)
    ? given.filaments
        .slice(0, LIMITS.filaments.max)
        .map(slicingFilament)
        .filter((filament): filament is SlicingFilament => !!filament)
    : [];
  return {
    layerHeight: round2(Math.min(range.max, Math.max(range.min, layer))),
    walls: whole("walls"),
    infill: whole("infill"),
    pattern: oneOf(INFILL_PATTERNS, given.pattern) ?? base.pattern,
    supports: oneOf(SUPPORT_PLACEMENT_IDS, given.supports) ?? base.supports,
    supportStyle: oneOf(SUPPORT_STYLE_IDS, given.supportStyle) ?? base.supportStyle,
    brim: oneOf(["auto", "on", "off"] as const, given.brim) ?? base.brim,
    filaments: filaments.length ? filaments : base.filaments,
    plate: oneOf(SLICING_PLATES, given.plate) ?? base.plate,
    nozzle: nozzleOk,
    scale: whole("scale"),
    orientation:
      orientationOf(given.orientation) === undefined ? base.orientation : (orientationOf(given.orientation) ?? null),
  };
}

/** Whether two settings slice the same (a spool picked again, or the same values in another order, are the same). */
export function sameSlicing(a: SlicingSettings, b: SlicingSettings): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function canonical(settings: SlicingSettings) {
  return Object.fromEntries(
    Object.keys(DEFAULT_SLICING).map((key) => [
      key,
      key === "filaments"
        ? settings.filaments.map((filament) =>
            Object.fromEntries(Object.entries(filament).sort(([x], [y]) => x.localeCompare(y))),
          )
        : settings[key as SlicingKey],
    ]),
  );
}

/** The settings that differ between two, in the order they are shown. */
export function changedSlicing(before: SlicingSettings, after: SlicingSettings): SlicingKey[] {
  return (Object.keys(DEFAULT_SLICING) as SlicingKey[]).filter(
    (key) => JSON.stringify(canonical(before)[key]) !== JSON.stringify(canonical(after)[key]),
  );
}

/* Saying it -------------------------------------------------------------------------------------------------- */

/**
 * "Fine", "Standard quality" (a line can't say which Standard it means otherwise: the strength has one too), or
 * "0.16 mm layers" for a height without a name.
 */
export function qualityWords(layerHeight: number): string {
  const quality = qualityOf(layerHeight);
  if (!quality) return `${Number(layerHeight.toFixed(2))} mm layers`;
  return quality.id === "standard" ? "Standard quality" : quality.label;
}

/** "Strong", or "Everyday strength" (the quality has the Standard, so the strength has its own word). */
export const strengthWords = (strength: Strength) =>
  strength.id === "standard" ? "Everyday strength" : strength.label;

/** "on its side", "upside down": how a model lying on another face is said; empty as designed. */
export function orientationWords(settings: Pick<SlicingSettings, "orientation">): string {
  const down = settings.orientation;
  if (!down) return "";
  return down[2] > 0.9 ? "upside down" : "on its side";
}

/** "0.12 mm": a layer height as slicers write it, beside its name. */
export const layerMillimetres = (layerHeight: number) => `${layerHeight.toFixed(2)} mm`;

/** "PLA Basic orange", "PETG black", "PLA": a filament the way people say it, for one quiet line. */
export function filamentWords(filament: SlicingFilament): string {
  const colour = filament.colorHex ? (filament.colorName ?? "").toLowerCase() : "";
  return [filament.material, filament.finish ? finishLabel(filament.finish) : "", colour].filter(Boolean).join(" ");
}

/** "gyroid", "zig-zag": a pattern's name, lowercase, as the line says it. */
export const patternWords = (pattern: InfillPattern) =>
  (PATTERNS.find((choice) => choice.id === pattern)?.label ?? pattern).toLowerCase();

/** "slim tree": a support style's name, lowercase, as a line says it. */
export const supportStyleWords = (style: SupportStyle) =>
  (SUPPORT_STYLES.find((choice) => choice.id === style)?.label ?? style).toLowerCase();

/** "supports where needed", or with `style` "slim tree supports everywhere"; empty when off. */
export function supportWords(settings: Pick<SlicingSettings, "supports" | "supportStyle">, style = false): string {
  if (settings.supports === "off") return "";
  if (settings.supports === "fins") return "fins";
  const where = settings.supports === "where-needed" ? "where needed" : "everywhere";
  return `${style ? `${supportStyleWords(settings.supportStyle)} ` : ""}supports ${where}`;
}

/**
 * The card's line after "Sliced by Spaghetti": "Fine · PLA Basic orange · supports where needed", with the strength
 * when it isn't the usual, more filaments, and the size when the model was scaled.
 */
export function slicingLine(settings: SlicingSettings): string[] {
  const [first, ...others] = settings.filaments;
  const strength = strengthOf(settings);
  return [
    qualityWords(settings.layerHeight),
    first ? filamentWords(first) : "",
    others.length ? `+${others.length} more` : "",
    supportWords(settings),
    strength
      ? strength.id === "standard"
        ? ""
        : strength.label
      : `${settings.walls} walls, ${settings.infill}% ${patternWords(settings.pattern)}`,
    orientationWords(settings),
    settings.scale !== 100 ? `${settings.scale}%` : "",
  ].filter(Boolean);
}

/**
 * What a model is sliced with, in a line a person can read at a glance: "Standard · Everyday strength · No supports ·
 * PLA Basic jade white", with the way it lies and its size when they aren't the usual. The settings row on the card
 * says it; the Printer page's folded defaults use the same words without the filament.
 */
export function slicingSummary(settings: SlicingSettings): string[] {
  const [first, ...others] = settings.filaments;
  const strength = strengthOf(settings);
  const supports = supportWords(settings);
  return [
    qualityOf(settings.layerHeight)?.label ?? `${Number(settings.layerHeight.toFixed(2))} mm layers`,
    strength
      ? strengthWords(strength)
      : `${settings.walls} walls, ${settings.infill}% ${patternWords(settings.pattern)}`,
    supports ? `${supports.charAt(0).toUpperCase()}${supports.slice(1)}` : "No supports",
    first ? filamentWords(first) : "",
    others.length ? `+${others.length} more` : "",
    orientationWords(settings),
    settings.scale !== 100 ? `${settings.scale}%` : "",
  ].filter(Boolean);
}

/* What older slices said -------------------------------------------------------------------------------------- */

/**
 * The settings of a slice from before these settings existed (decision 0046's record: a layer height, supports
 * on or off, Orca's tree supports under every steep overhang, materials and a scale), so it can be sliced again
 * the same way and changed from there.
 */
export function slicingFromRecord(record: {
  layerHeight?: number;
  supports?: boolean;
  materials?: string[];
  bedType?: string;
  scale?: number;
}): SlicingSettings {
  return normalizeSlicing({
    ...(record.layerHeight !== undefined ? { layerHeight: record.layerHeight } : {}),
    supports: record.supports ? "everywhere" : "off",
    ...(record.materials?.length
      ? {
          filaments: record.materials.map((material) =>
            material.toUpperCase() === "PLA" ? STAND_IN_FILAMENT : { material },
          ),
        }
      : {}),
    ...(record.bedType ? { plate: record.bedType } : {}),
    ...(record.scale !== undefined ? { scale: record.scale } : {}),
  });
}

/* The workspace's defaults -------------------------------------------------------------------------------- */

/**
 * The settings a workspace sets for models nobody set up (the Printer page, decision 0051): how a model prints, not
 * with what. The filament comes from the Pantry, the plate and the nozzle from the Printer page.
 */
export const DEFAULT_KEYS = ["layerHeight", "walls", "infill", "pattern", "supports", "supportStyle", "brim"] as const;
export type SlicingDefaults = Pick<SlicingSettings, (typeof DEFAULT_KEYS)[number]>;

/** The part of a whole set of settings a workspace keeps as its defaults. */
export function slicingDefaultsOf(settings: SlicingSettings): SlicingDefaults {
  return Object.fromEntries(DEFAULT_KEYS.map((key) => [key, settings[key]])) as SlicingDefaults;
}

/** The whole settings for what was chosen, with the defaults for the rest. */
export const slicingFor = (chosen: Partial<SlicingSettings>, defaults: SlicingSettings = DEFAULT_SLICING) =>
  normalizeSlicing({ ...defaults, ...chosen }, defaults);
