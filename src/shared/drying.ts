/** How long a dried spool stays dry, by material, and whether a spool is past its window. Pure, shared. */

/** Days a spool stays dry after drying (or from new). Starting values, [uncertain] for the X2D: people edit them (Printer, Drying). */
export const DRYING_DAYS: Readonly<Record<string, number>> = {
  PLA: 60,
  ABS: 30,
  ASA: 30,
  PETG: 21,
  PCTG: 21,
  PET: 14,
  TPU: 14,
  PC: 5,
  PA: 3,
  PPA: 3,
  PVA: 2,
  BVOH: 2,
};

/** The materials the table lists, in the order it shows them. */
export const DRYING_MATERIALS = Object.keys(DRYING_DAYS);

const normalize = (material: string) => material.trim().toUpperCase().replace(/\s+/g, " ");

/** The table's key for a spool's material: "PA6-CF" → PA, "PETG HF" → PETG, "PLA Silk" → PLA; null when unknown. */
export function dryingKey(material: string, keys: readonly string[] = DRYING_MATERIALS): string | null {
  const name = normalize(material);
  // The longest key the name starts with where a word (or a number) ends, so PETG isn't PET.
  const found = keys
    .filter((key) => name.startsWith(key) && !/^[A-Z]/.test(name.slice(key.length)))
    .sort((a, b) => b.length - a.length)[0];
  return found ?? null;
}

/** The days a material stays dry, with the person's own numbers laid over the starting ones; null when it isn't known. */
export function dryingWindow(material: string, overrides: Readonly<Record<string, number>> = {}): number | null {
  const table = { ...DRYING_DAYS, ...overrides };
  const key = dryingKey(material, Object.keys(table));
  return key ? (table[key] ?? null) : null;
}

const DAY = 24 * 3_600_000;

export interface DryingSpool {
  material: string;
  driedAt: number | null;
  createdAt: number;
  remaining?: string;
}

/**
 * Whether a spool is past its window: from the day it was dried, or from the day it came into the pantry when
 * never dried. An empty spool isn't asked to be dried, nor one whose material has no window.
 */
export function needsDrying(
  spool: DryingSpool,
  now: number,
  overrides: Readonly<Record<string, number>> = {},
): boolean {
  if (spool.remaining === "empty") return false;
  const window = dryingWindow(spool.material, overrides);
  if (window === null) return false;
  return now - (spool.driedAt ?? spool.createdAt) > window * DAY;
}

export const DRY_IT = "Dry it before printing";
