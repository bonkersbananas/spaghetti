/**
 * Looking colours and brands up by name: what the new-spool sheet and the shopping row use, kept out of spools.ts so
 * the screens that only list spools don't load it.
 */
import { BRAND_SPELLINGS, COLOR_NAMES, EXTERNAL_SLOT, nearestColorName, QUICK_COLORS, slotIds } from "./spools.ts";

/**
 * What a colour is called: the name of a quick colour when it is exactly that one ("#f4f1ea" → "Jade white", which
 * is not just "White"), else the plainest name ("#00ae42" → "Green").
 */
export function colourNameOf(hex: string): string | undefined {
  const wanted = hex.trim().toLowerCase();
  return QUICK_COLORS.find((color) => color.hex === wanted)?.name ?? nearestColorName(hex);
}

/** The colour a name says, if it is one we know ("Jade white", "black"). */
export function colourByName(name: string): { name: string; hex: string } | undefined {
  const wanted = name.trim().toLowerCase();
  const quick = QUICK_COLORS.find((color) => color.name.toLowerCase() === wanted);
  if (quick) return quick;
  const plain = COLOR_NAMES.find(([known]) => known.toLowerCase() === wanted);
  return plain ? { name: plain[0], hex: plain[1] } : undefined;
}

/** The maker a line of words names ("Bambu Lab PLA Basic" → "Bambu Lab"), as it spells itself. */
export function brandIn(text: string): string | undefined {
  const lower = text.toLowerCase();
  const hit = Object.entries(BRAND_SPELLINGS)
    .filter(([key]) => new RegExp(`(?<![a-z0-9])${key}(?![a-z0-9])`).test(lower))
    .sort((a, b) => b[0].length - a[0].length)[0];
  return hit?.[1];
}

/** The next empty AMS slot after this one, in the unit's order (A1…A4, then B1…); null past the last empty one. */
export function nextEmptySlot(slot: string, slots: Record<string, string>, amsUnits: number): string | null {
  const order = slotIds(amsUnits).filter((id) => id !== EXTERNAL_SLOT);
  const at = order.indexOf(slot);
  if (at < 0) return null;
  return order.slice(at + 1).find((id) => !slots[id]) ?? null;
}
