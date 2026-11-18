/**
 * Is a thing on the shopping list a spool of filament, and which one? "PLA Basic, Jade White" is: its material,
 * finish and colour fill the new-spool sheet once it's bought. A nozzle or a PEI plate is not. Reads the name only,
 * never guesses a material: no material word, no spool. Pure.
 */
import { brandIn, colourByName, FINISHES, SPOOL_MATERIALS } from "./spools.ts";

export interface FilamentFromName {
  material: string;
  brand: string | null;
  finish: string | null;
  colorName: string | null;
  colorHex: string | null;
}

// PA and PC are left out: as words they are a printer plate or a computer far more often than a filament.
const READ_MATERIALS = SPOOL_MATERIALS.filter((material) => material !== "PA" && material !== "PC").sort(
  (a, b) => b.length - a.length,
);

const esc = (word: string) => word.replace(/[+-]/g, "\\$&");
const wordRe = (word: string) => new RegExp(`(?<![A-Za-z0-9])${esc(word)}(?![A-Za-z0-9+])`, "i");

/** "PLA Basic, Jade White" → PLA, basic, Jade white; "0.4 mm nozzle" → null. */
export function filamentFromName(name: string): FilamentFromName | null {
  let rest = name.trim();
  const material = READ_MATERIALS.find((candidate) =>
    new RegExp(`(?<![A-Za-z0-9])${esc(candidate)}(?![A-Za-z0-9]|\\+)`, "i").test(rest),
  );
  if (!material) return null;
  rest = rest.replace(new RegExp(`(?<![A-Za-z0-9])${esc(material)}(?![A-Za-z0-9])`, "i"), " ");
  const brand = brandIn(rest) ?? null;
  if (brand)
    rest = rest.replace(new RegExp(`(?<![A-Za-z0-9])(bambu\\s?lab|${esc(brand)}|bambu)(?![A-Za-z0-9])`, "i"), " ");
  const finish = [...FINISHES].sort((a, b) => b.length - a.length).find((word) => wordRe(word).test(rest)) ?? null;
  if (finish) rest = rest.replace(wordRe(finish), " ");
  const colour = rest
    .replace(/\b\d+(?:[.,]\d+)?\s?(?:kg|g)\b/gi, " ")
    .replace(/\b(?:filament|spool|spools|hf|x\s?\d+)\b/gi, " ")
    .replace(/[,;:|·\-–()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const known = colour ? colourByName(colour) : undefined;
  const colorName = known?.name ?? (colour && colour.split(" ").length <= 3 ? sentence(colour) : null);
  return { material, brand, finish, colorName, colorHex: known?.hex ?? null };
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
