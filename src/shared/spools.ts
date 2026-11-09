/**
 * The shelf and the printer: spools, AMS slots, how the X2D is set up here,
 * matching a slicer file's filaments to spools, and the gentle checks shown
 * while logging an attempt. Shared by the Worker and the app; facts come from
 * docs/printer.md.
 */
import type { AttemptFilament, AttemptSettings, Nozzle } from "./attempts.ts";

/** Roughly how much is left on a spool. Never grams. */
export const REMAINING = ["full", "half", "low", "empty"] as const;
export type Remaining = (typeof REMAINING)[number];

export const REMAINING_LABELS: Record<Remaining, string> = {
  full: "Full",
  half: "Half",
  low: "Low",
  empty: "Empty",
};

/** Finishes people pick from; any other word is fine too. */
export const FINISHES = [
  "basic",
  "matte",
  "silk",
  "glossy",
  "sparkle",
  "marble",
  "translucent",
  "metal",
  "wood",
] as const;

export const FINISH_LABELS: Record<string, string> = {
  basic: "Basic",
  matte: "Matte",
  silk: "Silk",
  glossy: "Glossy",
  sparkle: "Sparkle",
  marble: "Marble",
  translucent: "Translucent",
  metal: "Metal",
  wood: "Wood",
};

export const finishLabel = (finish: string) =>
  FINISH_LABELS[finish] ?? finish.charAt(0).toUpperCase() + finish.slice(1);

/** Brands people are likely to type, offered as suggestions. */
export const BRANDS = ["Bambu", "Polymaker", "eSun", "Elegoo", "Sunlu", "Prusament", "Overture", "Jayo"] as const;

/** The printer, as docs/printer.md has it. Build volumes in mm, temperatures in °C. */
export const X2D = {
  name: "Bambu Lab X2D",
  buildVolume: { x: 256, y: 256, z: 260 },
  /** Printing with both nozzles leaves a little less room. */
  dualBuildVolume: { x: 235, y: 256, z: 256 },
  maxNozzleTemperature: 300,
  maxBedTemperature: 120,
  maxChamberTemperature: 65,
  maxAmsUnits: 4,
  slotsPerUnit: 4,
} as const;

export interface NozzleSetup {
  /** mm */
  diameter: number;
  hardened: boolean;
}

/** How the X2D is set up here. People change it when they swap nozzles or buy plates. */
export interface PrinterSetup {
  nozzles: Record<Nozzle, NozzleSetup>;
  /** The plates they own, as Bambu Studio names them ("Textured PEI Plate"). */
  plates: string[];
  /** AMS 2 Pro units attached: the Combo comes with one. */
  amsUnits: number;
}

export const DEFAULT_PRINTER: PrinterSetup = {
  nozzles: {
    main: { diameter: 0.4, hardened: true },
    auxiliary: { diameter: 0.4, hardened: true },
  },
  plates: ["Textured PEI Plate"],
  amsUnits: 1,
};

/** The external spool holder's slot id. */
export const EXTERNAL_SLOT = "Ext";
export const SLOT_PATTERN = /^(?:[A-D][1-4]|Ext)$/;
const UNIT_LETTERS = ["A", "B", "C", "D"] as const;

/** "A", "B"… for each AMS unit. */
export function amsUnitLetters(units: number): string[] {
  return UNIT_LETTERS.slice(0, Math.max(0, Math.min(X2D.maxAmsUnits, units)));
}

/** The four slots of one unit: "A1" to "A4". */
export const unitSlots = (letter: string) => [1, 2, 3, 4].map((n) => `${letter}${n}`);

/** Slots that exist with this many AMS units, then the external spool. */
export function slotIds(units: number): string[] {
  return [...amsUnitLetters(units).flatMap(unitSlots), EXTERNAL_SLOT];
}

export const isAmsSlot = (slot: string | undefined) => !!slot && /^[A-D][1-4]$/.test(slot);
export const slotLabel = (slot: string) => (slot === EXTERNAL_SLOT ? "External spool" : slot);

/** What matching and hints need of a spool. */
export interface SpoolLike {
  id: string;
  material: string;
  brand?: string | null;
  colorHex?: string | null;
  colorName?: string | null;
  finish?: string | null;
  remaining?: Remaining;
  /** Where it is loaded, if anywhere. */
  slot?: string | null;
}

/** "petg hf" → "PETG", "PLA Basic" → "PLA", "pa6-cf" → "PA6-CF": what a material is, to compare. */
export function materialKey(type: string | undefined | null): string {
  if (!type) return "";
  return type
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-(HF|BASIC|MATTE|SILK|\+)$/, "")
    .replace(/\+$/, "");
}

function rgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return null;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * How different two colors look, 0 (same) to about 765: the "redmean"
 * weighting, a cheap stand-in for a perceptual distance.
 */
export function colorDistance(a: string, b: string): number {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return Number.POSITIVE_INFINITY;
  const mean = (x[0] + y[0]) / 2;
  const dr = x[0] - y[0];
  const dg = x[1] - y[1];
  const db = x[2] - y[2];
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

/** Two filament colors that people would call the same: Bambu's white and a slightly warmer white. */
export const SAME_COLOR = 90;

/**
 * The spool a slicer file's filament most likely is: the same material in a
 * color people would call the same, preferring one with filament left, then
 * one loaded in the printer, then the closest color. Without a color in the file, only a lone spool of that
 * material counts.
 */
export function matchSpool<S extends SpoolLike>(
  filament: Pick<AttemptFilament, "type" | "colorHex">,
  spools: readonly S[],
  taken: ReadonlySet<string> = new Set(),
): S | null {
  const material = materialKey(filament.type);
  if (!material) return null;
  const candidates = spools.filter((spool) => materialKey(spool.material) === material && !taken.has(spool.id));
  if (!filament.colorHex) return candidates.length === 1 ? (candidates[0] ?? null) : null;
  const target = filament.colorHex;
  // Among colors people would call the same: a spool with filament left, then one loaded, then the closest.
  const rank = (spool: S) => (spool.remaining === "empty" ? 2 : 0) + (spool.slot ? 0 : 1);
  const scored = candidates
    .map((spool) => ({
      spool,
      distance: spool.colorHex ? colorDistance(spool.colorHex, target) : Number.POSITIVE_INFINITY,
    }))
    .filter((entry) => entry.distance <= SAME_COLOR)
    .sort((a, b) => rank(a.spool) - rank(b.spool) || a.distance - b.distance);
  return scored[0]?.spool ?? null;
}

/** Matches each of a file's filaments to a different spool, where one fits. */
export function matchFilaments<S extends SpoolLike>(
  filaments: ReadonlyArray<Pick<AttemptFilament, "type" | "colorHex">>,
  spools: readonly S[],
): Array<S | null> {
  const taken = new Set<string>();
  return filaments.map((filament) => {
    const spool = matchSpool(filament, spools, taken);
    if (spool) taken.add(spool.id);
    return spool;
  });
}

/** An attempt filament for a spool: its plain values (so the attempt reads well without it) and its id. */
export function filamentFromSpool(spool: SpoolLike, keep: AttemptFilament = {}): AttemptFilament {
  const filament: AttemptFilament = { ...keep, spoolId: spool.id, type: spool.material };
  for (const key of ["brand", "colorHex", "colorName"] as const) {
    const value = spool[key];
    if (value) filament[key] = value;
    else delete filament[key];
  }
  if (spool.slot) filament.amsSlot = spool.slot;
  return filament;
}

const COLOR_NAMES: Array<[string, string]> = [
  ["White", "#f4f4f0"],
  ["Ivory", "#efe6cf"],
  ["Black", "#1d1d1f"],
  ["Gray", "#8e9089"],
  ["Silver", "#b8bcc0"],
  ["Red", "#c12e1f"],
  ["Orange", "#f2711c"],
  ["Yellow", "#f0c330"],
  ["Green", "#00ae42"],
  ["Olive", "#6b7a3a"],
  ["Teal", "#168a8a"],
  ["Blue", "#0a2989"],
  ["Navy", "#111a40"],
  ["Sky blue", "#7ab8e8"],
  ["Purple", "#6c3a9c"],
  ["Pink", "#f19bbd"],
  ["Brown", "#7b4a2c"],
  ["Beige", "#d8c3a0"],
  ["Gold", "#c9a43b"],
];

/** A plain name for a color, for a spool added from a slicer file: "#00ae42" → "Green". */
export function nearestColorName(hex: string): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const [name, value] of COLOR_NAMES) {
    const distance = colorDistance(hex, value);
    if (!best || distance < best.distance) best = { name, distance };
  }
  return best?.name;
}

/**
 * A spool to add for a file's filament that isn't on the shelf: the
 * material, the color, and a brand and finish guessed from the filament
 * preset ("Bambu PLA Matte @BBL X2D" → Bambu, matte).
 */
export function spoolFromFilament(filament: AttemptFilament): Omit<SpoolLike, "id"> {
  const profile = (filament.profile ?? "").replace(/\s*@.*$/, "").trim();
  const words = profile.split(/\s+/).filter(Boolean);
  const first = words[0];
  const material = filament.type?.trim() || "PLA";
  const brand =
    first && !/^generic$/i.test(first) && materialKey(first) !== materialKey(material) ? first : filament.brand;
  const finish = FINISHES.find((word) => new RegExp(`\\b${word}\\b`, "i").test(profile));
  const colorName = filament.colorName ?? (filament.colorHex ? nearestColorName(filament.colorHex) : undefined);
  return {
    material,
    ...(brand ? { brand } : {}),
    ...(filament.colorHex ? { colorHex: filament.colorHex } : {}),
    ...(colorName ? { colorName } : {}),
    ...(finish ? { finish } : {}),
  };
}

/** "Jade white", "Bambu PLA Matte": a spool's name, in two lines. */
export function spoolName(spool: Pick<SpoolLike, "colorName" | "material" | "brand" | "finish">): {
  title: string;
  detail: string;
} {
  const kind = [
    spool.brand,
    spool.material,
    spool.finish && spool.finish !== "basic" ? finishLabel(spool.finish) : null,
  ]
    .filter(Boolean)
    .join(" ");
  return spool.colorName ? { title: spool.colorName, detail: kind } : { title: kind || spool.material, detail: "" };
}

/** One gentle check: a line beside a field, never a blocking dialog. */
export interface PrinterHint {
  field: "nozzleTemperature" | "bedTemperature" | "nozzle" | "nozzleDiameter" | "filament";
  /** For field "filament": which one (from 0). */
  filament?: number;
  text: string;
}

const isTpu = (type: string) => /^(TPU|TPE)/.test(type);
const isPva = (type: string) => /^(PVA|BVOH)/.test(type);
const isAbrasive = (type: string) => /-(CF|GF)\b|\b(CF|GF)$/.test(type);
const forAms = (filament: AttemptFilament) => /for\s*AMS/i.test(`${filament.profile ?? ""} ${filament.brand ?? ""}`);

/**
 * What docs/printer.md says to watch for, given the attempt's settings and
 * how the printer is set up: limits, TPU on the auxiliary nozzle or through
 * the AMS, materials the AMS can't feed, abrasive filament on a soft nozzle,
 * a nozzle size that isn't the one fitted.
 */
export function printerHints(settings: AttemptSettings, setup: PrinterSetup = DEFAULT_PRINTER): PrinterHint[] {
  const hints: PrinterHint[] = [];
  const nozzle: Nozzle = settings.nozzle ?? "main";
  const fitted = setup.nozzles[nozzle];
  if (settings.nozzleTemperature !== undefined && settings.nozzleTemperature > X2D.maxNozzleTemperature) {
    hints.push({ field: "nozzleTemperature", text: `The X2D's nozzles top out at ${X2D.maxNozzleTemperature} °C.` });
  }
  if (settings.bedTemperature !== undefined && settings.bedTemperature > X2D.maxBedTemperature) {
    hints.push({ field: "bedTemperature", text: `The bed tops out at ${X2D.maxBedTemperature} °C.` });
  }
  if (settings.nozzleDiameter !== undefined && fitted && settings.nozzleDiameter !== fitted.diameter) {
    hints.push({
      field: "nozzleDiameter",
      text: `The ${nozzle === "main" ? "main" : "auxiliary"} nozzle fitted is ${fitted.diameter} mm.`,
    });
  }
  const filaments = settings.filaments ?? [];
  filaments.forEach((filament, index) => {
    const type = materialKey(filament.type);
    if (!type) return;
    const name = filament.type?.trim() ?? type;
    if (type === "PPS") {
      hints.push({ field: "filament", filament: index, text: "The X2D doesn't print PPS." });
      return;
    }
    if (isTpu(type) && isAmsSlot(filament.amsSlot) && !forAms(filament)) {
      hints.push({
        field: "filament",
        filament: index,
        text: `${name} doesn't feed well through the AMS: the external spool is safer.`,
      });
    } else if (isPva(type) && isAmsSlot(filament.amsSlot)) {
      hints.push({ field: "filament", filament: index, text: `Only dry ${name} feeds through the AMS: damp jams it.` });
    }
    if (isAbrasive(type) && fitted && !fitted.hardened) {
      hints.push({
        field: "filament",
        filament: index,
        text: `${name} wears a nozzle that isn't hardened.`,
      });
    }
  });
  if (nozzle === "auxiliary") {
    const tpu = filaments.find((filament) => isTpu(materialKey(filament.type)));
    const ppa = filaments.find((filament) => /^PPA-(CF|GF)/.test(materialKey(filament.type)));
    if (tpu) {
      hints.push({
        field: "nozzle",
        text: `${tpu.type?.trim()} prints from the main nozzle: the auxiliary's Bowden path struggles with it.`,
      });
    } else if (ppa) {
      hints.push({ field: "nozzle", text: `${ppa.type?.trim()} prints from the main nozzle only.` });
    }
  }
  return hints;
}
