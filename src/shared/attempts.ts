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
  /** The spool on the shelf it came from, if picked from there. The values above stay, so the attempt reads the same without it. */
  spoolId?: string;
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
  /** Wall loops (perimeters). */
  wallLoops?: number;
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
/**
 * A plate as people say it: "Textured PEI Plate" → "Textured PEI", but
 * "Cool Plate" stays whole (plain "Cool" reads as a temperature).
 */
export const plateName = (bed: string) => {
  const short = bed.trim().replace(/\s+plate$/i, "");
  return /\bPEI$/i.test(short) ? short : bed.trim();
};
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

/** One known setting of an attempt, set against the same setting on another one. */
export interface SettingDiff {
  /** The setting: "bedTemperature", "brim", "filament.0". */
  key: string;
  /** What to call it in a table: "Bed", "Filament", "Plate". */
  label: string;
  /** How the first attempt had it, as words: "60 °C", "not dried", "none". */
  before: string;
  after: string;
  /** The two differ. */
  changed: boolean;
  /** Neither attempt says anything about it (so there is nothing to show, changed or not). */
  unset: boolean;
  /** The plain-words chips for what changed ("bed 60 → 65 °C"), empty when nothing did. */
  changes: SettingChange[];
}

function numberDiff(
  key: string,
  label: string,
  words: string,
  before: number | undefined,
  after: number | undefined,
  format: (value: number) => string,
  unit: string,
  cleared?: string,
  empty = "not set",
): SettingDiff {
  const show = (value: number | undefined) => (value === undefined ? empty : `${format(value)}${unit}`);
  const change = numberChange(key, words, before, after, format, unit, cleared);
  return {
    key,
    label,
    before: show(before),
    after: show(after),
    changed: change !== null,
    unset: before === undefined && after === undefined,
    changes: change ? [change] : [],
  };
}

function textDiff(
  key: string,
  label: string,
  before: string | undefined,
  after: string | undefined,
  show: (value: string) => string,
  phrase: (before: string | undefined, after: string | undefined) => string,
  empty = "not set",
): SettingDiff {
  const change = textChange(key, before, after, phrase);
  return {
    key,
    label,
    before: before ? show(before) : empty,
    after: after ? show(after) : empty,
    changed: change !== null,
    unset: !before && !after,
    changes: change ? [change] : [],
  };
}

function flagDiff(
  key: string,
  label: string,
  before: boolean | undefined,
  after: boolean | undefined,
  [off, on]: [string, string],
  phrase: [string, string],
): SettingDiff {
  const changed = !!before !== !!after;
  return {
    key,
    label,
    before: before ? on : off,
    after: after ? on : off,
    changed,
    unset: before === undefined && after === undefined,
    changes: changed ? [{ key, text: after ? phrase[1] : phrase[0] }] : [],
  };
}

function supportsDiff(before: AttemptSettings, after: AttemptSettings): SettingDiff {
  const show = (settings: AttemptSettings) =>
    settings.supportEnabled ? (settings.supportType === "tree" ? "tree" : "normal") : "none";
  const change = supportChange(before, after);
  return {
    key: "supports",
    label: "Supports",
    before: show(before),
    after: show(after),
    changed: change !== null,
    unset: before.supportEnabled === undefined && after.supportEnabled === undefined,
    changes: change ? [change] : [],
  };
}

function filamentDiffs(before: AttemptFilament[] = [], after: AttemptFilament[] = []): SettingDiff[] {
  const rows: SettingDiff[] = [];
  const count = Math.max(before.length, after.length);
  const all = filamentChanges(before, after);
  for (let i = 0; i < count; i++) {
    const key = `filaments.${i}`;
    const changes = all.filter((change) => change.key === key || change.key.startsWith(`${key}.`));
    const a = before[i];
    const b = after[i];
    rows.push({
      key,
      label: count > 1 ? `Filament ${i + 1}` : "Filament",
      before: a ? filamentName(a) : "none",
      after: b ? filamentName(b) : "none",
      changed: changes.length > 0,
      unset: !a && !b,
      changes,
    });
  }
  return rows;
}

/**
 * Every setting an attempt can carry, one against another: what the table in
 * the compare sheet shows, changed or not. `describeChanges` is made from
 * these rows, so the chips on an attempt and the table can never disagree.
 * Results (times, weight, where it failed) and AMS slots are not settings.
 */
export function diffSettings(before: AttemptSettings, after: AttemptSettings): SettingDiff[] {
  return [
    ...filamentDiffs(before.filaments, after.filaments),
    textDiff("bedType", "Plate", before.bedType, after.bedType, plateName, (a, b) =>
      b
        ? a
          ? `${plateName(a)} → ${plateName(b)}`
          : /plate$/i.test(plateName(b))
            ? plateName(b)
            : `${plateName(b)} plate`
        : "no plate set",
    ),
    textDiff(
      "nozzle",
      "Nozzle",
      before.nozzle,
      after.nozzle,
      (value) => value,
      (a, b) => (b ? (a ? `${a} → ${b} nozzle` : `${b} nozzle`) : "no nozzle set"),
    ),
    numberDiff(
      "nozzleDiameter",
      "Nozzle size",
      "nozzle",
      before.nozzleDiameter,
      after.nozzleDiameter,
      num,
      " mm",
      "no nozzle size",
    ),
    numberDiff("layerHeight", "Layers", "layers", before.layerHeight, after.layerHeight, mm2, " mm"),
    numberDiff("infillDensity", "Infill", "infill", before.infillDensity, after.infillDensity, num, "%"),
    numberDiff("wallLoops", "Walls", "walls", before.wallLoops, after.wallLoops, num, "", "no wall count"),
    supportsDiff(before, after),
    flagDiff("brim", "Brim", before.brim, after.brim, ["no brim", "brim"], ["no brim", "added a brim"]),
    textDiff("processPreset", "Profile", before.processPreset, after.processPreset, shortPreset, (a, b) =>
      b ? (a ? `${shortPreset(a)} → ${shortPreset(b)}` : `${shortPreset(b)} profile`) : "no profile set",
    ),
    numberDiff(
      "nozzleTemperature",
      "Nozzle temp",
      "nozzle",
      before.nozzleTemperature,
      after.nozzleTemperature,
      num,
      " °C",
      "no nozzle temperature",
    ),
    numberDiff(
      "bedTemperature",
      "Bed",
      "bed",
      before.bedTemperature,
      after.bedTemperature,
      num,
      " °C",
      "no bed temperature",
    ),
    numberDiff(
      "chamberTemperature",
      "Chamber",
      "chamber",
      before.chamberTemperature,
      after.chamberTemperature,
      num,
      " °C",
      "no chamber temperature",
      "none",
    ),
    flagDiff(
      "filamentDried",
      "Filament",
      before.filamentDried,
      after.filamentDried,
      ["not dried", "dried"],
      ["filament not dried", "dried the filament"],
    ),
  ];
}

/**
 * What someone tried differently from one attempt to the next, in a few
 * plain words each: "bed 60 → 65 °C", "added a brim", "PETG instead of PLA".
 * Results (times, weight, where it failed) and AMS slots are left out.
 */
export function describeChanges(before: AttemptSettings, after: AttemptSettings): SettingChange[] {
  return diffSettings(before, after).flatMap((row) => row.changes);
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

/**
 * Adds a line to an attempt's note without losing what is there: an empty
 * note takes it as is, and the same line twice (a retried request) stays once.
 */
export function mergeNote(existing: string, added: string): string {
  const line = added.trim();
  const before = existing.trim();
  if (!line) return existing;
  if (!before) return line;
  return before.includes(line) ? existing : `${before} · ${line}`;
}

/** Tag slugs of both lists, each once, in order. */
export const unionTags = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

/** The least summarizeBuild needs to know of an attempt. */
export interface SummarizableAttempt {
  /** Null while it is printing. */
  outcome: Outcome | null;
  /** When the printer bridge saw it stop: with no outcome yet, it is off the bed, not printing. */
  endedAt?: number | null;
  settings: AttemptSettings;
}

export interface BuildSummary {
  counts: Record<Outcome | "printing", number>;
  /** "1 spaghetti, 1 partly, printing now"; empty without attempts. */
  words: string;
  /**
   * Time on the bed from the finished attempts: what each took, else its
   * estimate (cut short to the point where it failed, when that is known). `approximate` when any of them had to be guessed or had nothing,
   * so it reads "about 6 h 22 min". Null when no figure is known at all.
   */
  minutes: { value: number; approximate: boolean } | null;
  /** Grams from the finished attempts; `atLeast` when some have none. Null when none has one. */
  grams: { value: number; atLeast: boolean } | null;
  /** Every filament used, once each (by spool, else by type and color), in the order first used. */
  filaments: AttemptFilament[];
}

const OUTCOME_WORDS: Array<[Outcome, string]> = [
  ["failed", "spaghetti"],
  ["partial", "partly"],
  ["success", "worked"],
];

/** "1 spaghetti, 1 partly, printing now". */
export function outcomeWords(counts: Record<Outcome | "printing", number>): string {
  const parts = OUTCOME_WORDS.filter(([outcome]) => counts[outcome] > 0).map(
    ([outcome, word]) => `${counts[outcome]} ${word}`,
  );
  if (counts.printing > 0) parts.push(counts.printing === 1 ? "printing now" : `${counts.printing} printing now`);
  return parts.join(", ");
}

const filamentIdentity = (filament: AttemptFilament) =>
  filament.spoolId
    ? `spool:${filament.spoolId}`
    : `${(filament.type ?? "").toLowerCase()}|${(filament.colorHex ?? filament.colorName ?? "").toLowerCase()}`;

/**
 * What a build's attempts add up to: how they went, the time and filament
 * spent, and what was used. An attempt still printing has spent nothing yet,
 * so it counts for the words but not the sums. Time never claims more than
 * it knows: a guess reads "about", and a total with gaps reads "at least".
 */
export function summarizeBuild(attempts: readonly SummarizableAttempt[]): BuildSummary {
  const counts: Record<Outcome | "printing", number> = { success: 0, partial: 0, failed: 0, printing: 0 };
  let offBed = 0;
  let minutes = 0;
  let minutesKnown = false;
  let minutesApproximate = false;
  let grams = 0;
  let gramsKnown = false;
  let gramsMissing = false;
  const filaments: AttemptFilament[] = [];
  const seen = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.outcome === null && attempt.endedAt != null) offBed += 1;
    else counts[attempt.outcome ?? "printing"] += 1;
    for (const filament of attempt.settings.filaments ?? []) {
      const identity = filamentIdentity(filament);
      if (identity === "|" || seen.has(identity)) continue;
      seen.add(identity);
      filaments.push(filament);
    }
    if (attempt.outcome === null) continue;
    const { actualMinutes, estimatedMinutes, weightGrams, failedAtPercent } = attempt.settings;
    if (actualMinutes !== undefined) {
      minutes += actualMinutes;
      minutesKnown = true;
    } else if (estimatedMinutes !== undefined) {
      // A print that failed part-way only ran that far, so the slicer's full estimate would overstate it.
      const ran = failedAtPercent === undefined ? 1 : Math.min(1, Math.max(0, failedAtPercent / 100));
      minutes += estimatedMinutes * ran;
      minutesKnown = true;
      minutesApproximate = true;
    } else {
      minutesApproximate = true;
    }
    if (weightGrams !== undefined) {
      grams += weightGrams;
      gramsKnown = true;
    } else {
      gramsMissing = true;
    }
  }
  return {
    counts,
    words: [outcomeWords(counts), offBed > 0 ? (offBed === 1 ? "off the bed" : `${offBed} off the bed`) : ""]
      .filter(Boolean)
      .join(", "),
    minutes: minutesKnown ? { value: minutes, approximate: minutesApproximate } : null,
    grams: gramsKnown ? { value: grams, atLeast: gramsMissing } : null,
    filaments,
  };
}
