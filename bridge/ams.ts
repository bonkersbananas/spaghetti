/**
 * The AMS sync, as a plan: what the printer's trays say against the pantry, and what to change to make the app
 * match. Pure, so the rules are tested without a printer or a server.
 *
 * A tray with an RFID tag (a Bambu spool) is found by its tray UUID, else by brand, material and colour, and a
 * Bambu spool that is nowhere in the pantry becomes a new spool. A tray without one (a third-party spool) is matched
 * the same way but never invented: when nothing fits, its slot is left alone and the app is told, so a person can
 * pick the spool.
 */
import type { Spool } from "../src/shared/api.ts";
import type { UnknownTray } from "../src/shared/bridge.ts";
import { colorDistance, materialKey, nearestColorName, type Remaining, SAME_COLOR } from "../src/shared/spools.ts";
import { stableId } from "./names.ts";
import type { PrintState, RawTray } from "./printer-state.ts";

export interface Tray {
  /** "A1" to "D4", or "Ext". */
  slot: string;
  /** Empty trays are left out before planning. */
  material: string;
  colorHex: string | null;
  /** "PLA Basic" */
  subBrand: string | null;
  /** The RFID tray UUID, only when the tray has a tag. */
  trayUuid: string | null;
  /** 0–100, or null when the printer doesn't know (-1). */
  remain: number | null;
}

const UNITS = ["A", "B", "C", "D"] as const;
const ZEROS = /^0*$/;

function toTray(slot: string, raw: RawTray | undefined): Tray | null {
  if (!raw?.tray_type) return null;
  const color = /^([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(raw.tray_color ?? "")?.[1];
  const uuid = raw.tray_uuid && !ZEROS.test(raw.tray_uuid) ? raw.tray_uuid.toUpperCase() : null;
  return {
    slot,
    material: raw.tray_type,
    colorHex: color ? `#${color.toLowerCase()}` : null,
    subBrand: raw.tray_sub_brands?.trim() || null,
    trayUuid: uuid,
    remain: typeof raw.remain === "number" && raw.remain >= 0 && raw.remain <= 100 ? raw.remain : null,
  };
}

/** The trays that hold filament, from the printer's AMS report and its external spool. */
export function traysOf(print: PrintState): Tray[] {
  const trays: Tray[] = [];
  for (const unit of print.ams?.ams ?? []) {
    // AMS units are numbered from 0: "0" is A. Other ids (the single-spool AMS HT, [uncertain]) aren't in the app's slots.
    const letter = UNITS[Number(unit.id)];
    if (!letter) continue;
    for (const raw of unit.tray ?? []) {
      const index = Number(raw.id);
      if (!Number.isInteger(index) || index < 0 || index > 3) continue;
      const tray = toTray(`${letter}${index + 1}`, raw);
      if (tray) trays.push(tray);
    }
  }
  const external = toTray("Ext", print.vt_tray);
  if (external) trays.push(external);
  return trays;
}

/** What the printer's percentage left means in the app's four levels. */
export function remainingFrom(percent: number): Remaining {
  if (percent >= 70) return "full";
  if (percent >= 30) return "half";
  if (percent >= 8) return "low";
  return "empty";
}

export type AmsAction =
  | { type: "createSpool"; spool: NewSpool }
  | { type: "load"; slot: string; spoolId: string }
  | { type: "setLevel"; spoolId: string; remaining: Remaining }
  | { type: "setTrayUuid"; spoolId: string; trayUuid: string };

export interface NewSpool {
  id: string;
  material: string;
  brand: string | null;
  colorName: string | null;
  colorHex: string | null;
  finish: string | null;
  remaining: Remaining;
  trayUuid: string;
}

export interface AmsPlan {
  actions: AmsAction[];
  unknown: UnknownTray[];
}

const BAMBU = "Bambu Lab";

/** "PLA Basic" → "basic"; "PLA Silk+" → "silk"; null when it only repeats the material. */
function finishOf(tray: Tray): string | null {
  const word = tray.subBrand
    ?.replace(new RegExp(`^(bambu\\s+)?${tray.material}\\s*`, "i"), "")
    .replace(/[+]/g, "")
    .trim()
    .toLowerCase();
  return word || null;
}

/**
 * A Bambu RFID tray is a Bambu spool (the tag carries no brand name, only the sub-brand), so it never matches
 * another maker's. Without a tag the printer knows no brand, and material and colour decide.
 */
const brandsAgree = (spoolBrand: string | null, tray: Tray) =>
  !tray.trayUuid || !spoolBrand || /bambu/i.test(spoolBrand);

/** Finds a tray's spool: its stored UUID first, then brand, material and colour. */
export function findSpool(tray: Tray, spools: readonly Spool[], claimed: ReadonlySet<string>): Spool | null {
  if (tray.trayUuid) {
    const byUuid = spools.find((spool) => spool.trayUuid?.toUpperCase() === tray.trayUuid && !claimed.has(spool.id));
    if (byUuid) return byUuid;
  }
  const material = materialKey(tray.material);
  const candidates = spools.filter(
    (spool) =>
      !claimed.has(spool.id) &&
      materialKey(spool.material) === material &&
      brandsAgree(spool.brand, tray) &&
      // A spool already tagged as another tray's is that tray's.
      (!spool.trayUuid || !tray.trayUuid),
  );
  const target = tray.colorHex;
  if (!target) return candidates.length === 1 ? (candidates[0] ?? null) : null;
  return (
    candidates
      .map((spool) => ({
        spool,
        distance: spool.colorHex ? colorDistance(spool.colorHex, target) : Number.POSITIVE_INFINITY,
      }))
      .filter((entry) => entry.distance <= SAME_COLOR)
      // The one already in this slot, then one with filament left, then the closest colour.
      .sort(
        (a, b) =>
          Number(b.spool.slot === tray.slot) - Number(a.spool.slot === tray.slot) ||
          Number(a.spool.remaining === "empty") - Number(b.spool.remaining === "empty") ||
          a.distance - b.distance,
      )[0]?.spool ?? null
  );
}

export function planAmsSync(trays: readonly Tray[], spools: readonly Spool[], printerId: string): AmsPlan {
  const actions: AmsAction[] = [];
  const unknown: UnknownTray[] = [];
  const claimed = new Set<string>();
  // Trays that already hold the spool the app says is in them claim it first, so a swap isn't shuffled around.
  const ordered = [...trays].sort(
    (a, b) =>
      Number(spools.some((s) => s.slot === b.slot && s.trayUuid === b.trayUuid && b.trayUuid)) -
      Number(spools.some((s) => s.slot === a.slot && s.trayUuid === a.trayUuid && a.trayUuid)),
  );
  for (const tray of ordered) {
    const found = findSpool(tray, spools, claimed);
    if (!found) {
      if (!tray.trayUuid) {
        // A person already put a spool of that material there: their pick stands, nothing to ask.
        const inSlot = spools.find((spool) => spool.slot === tray.slot);
        if (inSlot && materialKey(inSlot.material) === materialKey(tray.material)) continue;
        unknown.push({ slot: tray.slot, material: tray.material, colorHex: tray.colorHex, brand: tray.subBrand });
        continue;
      }
      const spool: NewSpool = {
        id: stableId(printerId, "spool", tray.trayUuid),
        material: tray.material,
        brand: BAMBU,
        colorName: tray.colorHex ? (nearestColorName(tray.colorHex) ?? null) : null,
        colorHex: tray.colorHex,
        finish: finishOf(tray),
        remaining: tray.remain === null ? "full" : remainingFrom(tray.remain),
        trayUuid: tray.trayUuid,
      };
      claimed.add(spool.id);
      actions.push({ type: "createSpool", spool }, { type: "load", slot: tray.slot, spoolId: spool.id });
      continue;
    }
    claimed.add(found.id);
    if (found.slot !== tray.slot) actions.push({ type: "load", slot: tray.slot, spoolId: found.id });
    if (tray.trayUuid && found.trayUuid?.toUpperCase() !== tray.trayUuid) {
      actions.push({ type: "setTrayUuid", spoolId: found.id, trayUuid: tray.trayUuid });
    }
    if (tray.remain !== null) {
      const level = remainingFrom(tray.remain);
      if (level !== found.remaining) actions.push({ type: "setLevel", spoolId: found.id, remaining: level });
    }
  }
  return { actions, unknown };
}

/** For the log: "Bambu Lab PLA Basic Jade white in A2". */
export const describeTray = (tray: Tray) => `${tray.subBrand ?? tray.material} in ${tray.slot}`;
