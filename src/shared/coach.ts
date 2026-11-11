/**
 * The failure coach (docs/decisions/0027): after an attempt comes out Partly or Spaghetti, Claude suggests two or
 * three things to change for the next try. It only ever suggests: nothing is set until a person taps "Use this".
 */
import { type AttemptSettings, BED_TYPES, describeChanges, LAYER_HEIGHTS, NOZZLE_DIAMETERS } from "./attempts.ts";

/** Per day, for the whole workspace: its own cap, beside the drafts' and the photo reads'. */
export const COACH_PER_DAY = 20;
/** At most this many suggestions, short ones. */
export const COACH_MAX_ITEMS = 3;

/** The settings a suggestion may change: the ones the attempt sheet has fields for and the X2D really has. */
export const COACH_SETTING_KEYS = [
  "bedTemperature",
  "nozzleTemperature",
  "chamberTemperature",
  "brim",
  "supportEnabled",
  "supportType",
  "layerHeight",
  "infillDensity",
  "wallLoops",
  "filamentDried",
  "bedType",
  "nozzleDiameter",
] as const satisfies ReadonlyArray<keyof AttemptSettings>;
export type CoachSettingKey = (typeof COACH_SETTING_KEYS)[number];

/** What the X2D can do (docs/printer.md section 1): a suggestion beyond it is dropped, never trimmed to fit. */
export const PRINTER_LIMITS = { nozzleTemperature: 300, bedTemperature: 120, chamberTemperature: 65 } as const;

/** One suggestion: what to change, in a few words, and why in one line. */
export interface CoachItem {
  /** Stable within the attempt ("s1", "s2"…), what dismissing names. */
  id: string;
  /** "Add a brim" · "Dry the PETG first". */
  title: string;
  /** One line: "The stern lifted both times". */
  why: string;
  /** The settings it changes, when settings can say it; "Use this" sets exactly these. */
  settings: Partial<AttemptSettings> | null;
  /** A line for the next attempt's note, for what settings can't say ("Outer wall 60 mm/s"). */
  note: string | null;
  dismissed: boolean;
}

/** What an attempt shows of its coach: "thinking" while Claude works, "ready" with the suggestions it made. */
export interface Coach {
  status: "thinking" | "ready";
  items: CoachItem[];
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/**
 * What Claude proposed as settings, cleaned: only keys a suggestion may change, only values the printer has, and
 * nothing that is already so. Returns null when nothing is left.
 */
export function sanitizeCoachSettings(raw: unknown, current: AttemptSettings): Partial<AttemptSettings> | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const within = (key: "bedTemperature" | "nozzleTemperature" | "chamberTemperature", min: number) => {
    const value = num(input[key]);
    if (value !== undefined && value >= min && value <= PRINTER_LIMITS[key]) out[key] = Math.round(value);
  };
  within("bedTemperature", 20);
  within("nozzleTemperature", 150);
  within("chamberTemperature", 0);
  for (const key of ["brim", "supportEnabled", "filamentDried"] as const) {
    if (typeof input[key] === "boolean") out[key] = input[key];
  }
  if (input.supportType === "normal" || input.supportType === "tree") out.supportType = input.supportType;
  const layer = num(input.layerHeight);
  if (layer !== undefined && layer >= Math.min(...LAYER_HEIGHTS) && layer <= Math.max(...LAYER_HEIGHTS)) {
    out.layerHeight = Math.round(layer * 100) / 100;
  }
  const infill = num(input.infillDensity);
  if (infill !== undefined && infill >= 0 && infill <= 100) out.infillDensity = Math.round(infill);
  const walls = num(input.wallLoops);
  if (walls !== undefined && walls >= 1 && walls <= 12) out.wallLoops = Math.round(walls);
  const nozzle = num(input.nozzleDiameter);
  if (nozzle !== undefined && (NOZZLE_DIAMETERS as readonly number[]).includes(nozzle)) out.nozzleDiameter = nozzle;
  if (typeof input.bedType === "string" && (BED_TYPES as readonly string[]).includes(input.bedType)) {
    out.bedType = input.bedType;
  }
  // Not a change: already how the attempt was printed.
  for (const key of Object.keys(out)) {
    if (JSON.stringify(out[key]) === JSON.stringify(current[key as keyof AttemptSettings])) delete out[key];
  }
  return Object.keys(out).length ? (out as Partial<AttemptSettings>) : null;
}

/** The settings with a suggestion applied. */
export const applyCoachSettings = (settings: AttemptSettings, item: Pick<CoachItem, "settings">): AttemptSettings => ({
  ...settings,
  ...(item.settings ?? {}),
});

/**
 * What "Use this" does, in the words the attempt's changes use: "added a brim", "bed 55 → 60 °C"; for a suggestion
 * that settings can't say, its note line.
 */
export function coachChangeWords(item: Pick<CoachItem, "settings" | "note">, settings: AttemptSettings): string[] {
  const changes = item.settings ? describeChanges(settings, applyCoachSettings(settings, item)).map((c) => c.text) : [];
  if (changes.length) return changes;
  return item.note ? [item.note] : [];
}

/** Whether tapping would change anything right now: false once the sheet already has it. */
export function coachApplies(
  item: Pick<CoachItem, "settings" | "note">,
  settings: AttemptSettings,
  note: string,
): boolean {
  if (item.settings && describeChanges(settings, applyCoachSettings(settings, item)).length) return true;
  return !!item.note && !note.includes(item.note);
}

/** The suggestions still on offer (not dismissed). */
export const liveCoachItems = (coach: Coach | null | undefined): CoachItem[] =>
  coach?.items.filter((item) => !item.dismissed) ?? [];
