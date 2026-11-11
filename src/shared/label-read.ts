/**
 * Claude reading a spool's label from a photo and filling in what it says (docs/decisions/0027). It only fills what
 * is empty, marks what it filled as "from the label" until a person touches the field, and keeps the photo.
 */

/** Per day, for the whole workspace: its own cap, apart from the photo reads of attempts. */
export const LABEL_READS_PER_DAY = 20;

/** More spools than this on one photo and the rest are left for another photo. */
export const MAX_LABEL_SPOOLS = 4;

import { finishLabel } from "./spools.ts";

export { NO_LABEL } from "./no-label.ts";

/** The spool fields a label can fill, by their names in the spool's API object. */
export const LABEL_FIELDS = [
  "brand",
  "material",
  "finish",
  "colorName",
  "colorHex",
  "netGrams",
  "diameterMm",
  "nozzleTempMin",
  "nozzleTempMax",
  "bedTempMin",
  "bedTempMax",
  "dryTempC",
  "dryHours",
  "productCode",
] as const;
export type LabelField = (typeof LABEL_FIELDS)[number];

/** One spool as a label states it: every value is null when the label doesn't say. */
export interface LabelSpool {
  brand: string | null;
  /** "PLA", "PETG", "PLA-CF"… */
  material: string | null;
  /** The label's variant ("Basic", "Matte", "HF"), kept as the spool's finish. */
  finish: string | null;
  colorName: string | null;
  /** #rrggbb, Claude's closest guess to the colour's name or printed swatch. */
  colorHex: string | null;
  netGrams: number | null;
  /** mm: 1.75 or 2.85. */
  diameterMm: number | null;
  nozzleTempMin: number | null;
  nozzleTempMax: number | null;
  bedTempMin: number | null;
  bedTempMax: number | null;
  dryTempC: number | null;
  dryHours: number | null;
  /** Bambu's RFID or product code, when it is printed. */
  productCode: string | null;
}

/**
 * What a spool shows of its label read while it is going on or didn't work out. A read that filled the spool shows
 * only through `fromLabel`; one that was dismissed shows nothing.
 *
 * - reading: Claude is looking ("Reading the label…").
 * - multiple: the photo has several labels (`spools`), waiting for one tap to add them all.
 * - unreadable: Claude couldn't read a label in the photo; nothing was filled.
 * - failed: the call didn't work (a timeout, an error); nothing was filled.
 * - cap: today's reads are used up.
 */
export interface LabelRead {
  status: "reading" | "multiple" | "unreadable" | "failed" | "cap";
  /** The photo it looked at. */
  photoId: string;
  spools: LabelSpool[];
}

export const LABEL_FAILURE_LINES: Record<"unreadable" | "failed" | "cap", string> = {
  unreadable: "The label wasn't readable in that photo, so nothing was filled in.",
  failed: "Couldn't read the label just now. The spool is saved as it is.",
  cap: "Today's label reads are used up. The spool is saved as it is.",
};

/** The words for each field, as "from the label" lists them. */
export const LABEL_FIELD_NAMES: Record<LabelField, string> = {
  brand: "Brand",
  material: "Material",
  finish: "Finish",
  colorName: "Color name",
  colorHex: "Color",
  netGrams: "Weight",
  diameterMm: "Diameter",
  nozzleTempMin: "Nozzle temperature",
  nozzleTempMax: "Nozzle temperature",
  bedTempMin: "Bed temperature",
  bedTempMax: "Bed temperature",
  dryTempC: "Drying temperature",
  dryHours: "Drying time",
  productCode: "Product code",
};

/** "190–230 °C" for a range (or a single end), null when the label gave neither. */
export function tempRange(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min === null || max === null || min === max) return `${min ?? max} °C`;
  return `${min}–${max} °C`;
}

/** A short line for a found spool in the confirmation: "Bambu PLA Basic, Jade white, 1 kg". */
export function labelSpoolLine(spool: LabelSpool): { title: string; detail: string } {
  const kind = [spool.brand, spool.material, spool.finish ? finishLabel(spool.finish) : null].filter(Boolean).join(" ");
  const grams = spool.netGrams
    ? spool.netGrams % 1000 === 0
      ? `${spool.netGrams / 1000} kg`
      : `${spool.netGrams} g`
    : null;
  return {
    title: spool.colorName || kind || "A spool",
    detail: [spool.colorName ? kind : null, grams].filter(Boolean).join(" · "),
  };
}

export const emptyLabelSpool = (): LabelSpool => ({
  brand: null,
  material: null,
  finish: null,
  colorName: null,
  colorHex: null,
  netGrams: null,
  diameterMm: null,
  nozzleTempMin: null,
  nozzleTempMax: null,
  bedTempMin: null,
  bedTempMax: null,
  dryTempC: null,
  dryHours: null,
  productCode: null,
});
