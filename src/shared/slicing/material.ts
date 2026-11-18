/**
 * The page of a model (its MakerWorld or Printables draft) names a material; the slice uses a filament. When they
 * are different materials, one quiet line says so. Compared by family: "PLA Basic" and "PLA Matte" are both PLA, and
 * a page that names several ("PLA or PETG") is no mismatch while one of them matches. Pure.
 */
import { materialKey } from "../spools.ts";
import type { SlicingFilament } from "./settings.ts";

// What a material looks like once keyed: PLA, PETG, ABS, PETG-CF, PA6-CF… A sentence is not one.
const LOOKS_LIKE_MATERIAL = /^[A-Z]{2,5}\d?(?:-[A-Z]{2,3})?$/;

/** The materials a page names, as families: "PETG HF" → ["PETG"], "PLA / PETG" → ["PLA", "PETG"]. */
export function pageMaterials(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\s*(?:\/|,|;|\bor\b|\band\b|&)\s*/i)
    .map((part) => materialKey(part))
    .filter((key) => LOOKS_LIKE_MATERIAL.test(key));
}

export interface MaterialMismatch {
  /** The page's own words, the first material it names: "PETG". */
  page: string;
  /** The slice's filament that differs, and its material as the slice says it. */
  filament: SlicingFilament;
  material: string;
}

/** The mismatch between what the page says and what the slice prints with, or null when they agree or the page says nothing usable. */
export function materialMismatch(
  pageMaterial: string | null | undefined,
  filaments: readonly SlicingFilament[],
): MaterialMismatch | null {
  const wanted = pageMaterials(pageMaterial);
  const first = filaments[0];
  if (!wanted.length || !first) return null;
  const used = filaments.map((filament) => materialKey(filament.material));
  if (used.some((key) => wanted.includes(key))) return null;
  return { page: wanted[0] ?? "", filament: first, material: materialKey(first.material) };
}

/** "The page says PETG; A1 holds PLA." Where the filament is a loaded spool, its slot; else "this slice uses". */
export function materialMismatchSentence(mismatch: MaterialMismatch, slot?: string | null): string {
  const holder = slot ? `${slot === "Ext" ? "the external spool" : slot} holds` : "this slice uses";
  return `The page says ${mismatch.page}; ${holder} ${mismatch.material}.`;
}
