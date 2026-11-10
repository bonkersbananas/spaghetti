/**
 * The pantry for screenshots: the spools on the shelf (the ones the seeded
 * attempts printed with, and a few more), two with a photo of the label,
 * the AMS loaded as on a Combo, and the printer's setup. Through the API,
 * like the rest of the seed; dates the API sets to "now" are backdated after.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Browser } from "@playwright/test";
import type { AttemptSettings } from "../../src/shared/attempts.ts";
import type { PrinterSetup, Remaining } from "../../src/shared/spools.ts";
import { executeSql, root } from "../lib/wrangler.ts";
import { render } from "./ideas.ts";

const DAY = 24 * 60 * 60 * 1000;

interface SeedSpool {
  id: string;
  material: string;
  brand?: string;
  colorName: string;
  colorHex: string;
  finish?: string;
  remaining: Remaining;
  slot?: string;
  driedAgo?: number;
  addedAgo: number;
  note?: string;
  /** Counted in grams: what it held when new, and the weighing that set what was left (days ago). */
  grams?: { net: number; left: number; weighedAgo: number };
  /** Light and dark shades of the filament for the label photo. */
  photo?: { light: string; dark: string };
}

const id = (n: number) => `5eed0000-0000-4000-8000-000000005${String(n).padStart(3, "0")}`;

export const SEED_SPOOL_IDS = {
  jadeWhite: id(1),
  sunflower: id(2),
  black: id(3),
  bluePetg: id(4),
  silkGold: id(5),
  bambuGreen: id(6),
};

export const SEED_SPOOLS: SeedSpool[] = [
  {
    id: SEED_SPOOL_IDS.jadeWhite,
    material: "PLA",
    brand: "Bambu",
    colorName: "Jade white",
    colorHex: "#f4f1ea",
    finish: "basic",
    remaining: "half",
    slot: "A1",
    addedAgo: 120 * DAY,
    grams: { net: 1000, left: 520, weighedAgo: 10 * DAY },
    photo: { light: "#ffffff", dark: "#cfc9bc" },
  },
  {
    id: SEED_SPOOL_IDS.sunflower,
    material: "PLA",
    brand: "Bambu",
    colorName: "Sunflower yellow",
    colorHex: "#f2c230",
    finish: "basic",
    remaining: "low",
    slot: "A2",
    addedAgo: 60 * DAY,
    grams: { net: 1000, left: 140, weighedAgo: 4 * DAY },
  },
  {
    id: SEED_SPOOL_IDS.black,
    material: "PLA",
    brand: "Bambu",
    colorName: "Black",
    colorHex: "#1d1d1f",
    finish: "basic",
    remaining: "full",
    slot: "A3",
    addedAgo: 110 * DAY,
    grams: { net: 1000, left: 880, weighedAgo: 12 * DAY },
  },
  {
    id: SEED_SPOOL_IDS.bluePetg,
    material: "PETG",
    brand: "Bambu",
    colorName: "Blue",
    colorHex: "#2f6f9f",
    remaining: "half",
    slot: "A4",
    driedAgo: 3 * DAY,
    addedAgo: 50 * DAY,
    grams: { net: 1000, left: 430, weighedAgo: 6 * DAY },
    note: "Dry it first: it strings when it has sat out a week. 245 °C, 70 °C bed on textured PEI.",
  },
  {
    id: SEED_SPOOL_IDS.silkGold,
    material: "PLA",
    brand: "Eryone",
    colorName: "Silk gold",
    colorHex: "#c9a46b",
    finish: "silk",
    remaining: "full",
    slot: "Ext",
    addedAgo: 25 * DAY,
    note: "Gorgeous in vase mode. Slow the outer wall down or it goes dull.",
    photo: { light: "#ecd29d", dark: "#9a7738" },
  },
  {
    id: SEED_SPOOL_IDS.bambuGreen,
    material: "PLA",
    brand: "Bambu",
    colorName: "Bambu green",
    colorHex: "#00ae42",
    finish: "basic",
    remaining: "half",
    addedAgo: 100 * DAY,
  },
  {
    id: id(7),
    material: "PLA",
    brand: "Bambu",
    colorName: "Charcoal matte",
    colorHex: "#3b3a38",
    finish: "matte",
    remaining: "low",
    addedAgo: 40 * DAY,
    grams: { net: 1000, left: 85, weighedAgo: DAY / 48 },
  },
  {
    id: id(8),
    material: "PLA",
    brand: "Polymaker",
    colorName: "Terracotta",
    colorHex: "#b5603c",
    finish: "matte",
    remaining: "full",
    addedAgo: 30 * DAY,
  },
  {
    id: id(9),
    material: "PLA",
    brand: "Bambu",
    colorName: "Gray",
    colorHex: "#8e9089",
    remaining: "empty",
    addedAgo: 140 * DAY,
  },
  {
    id: id(10),
    material: "PETG",
    brand: "Polymaker",
    colorName: "Teal",
    colorHex: "#2c8a87",
    remaining: "full",
    driedAgo: 20 * DAY,
    addedAgo: 45 * DAY,
  },
  {
    id: id(11),
    material: "PETG",
    brand: "Bambu",
    colorName: "Black",
    colorHex: "#1d1d1f",
    remaining: "low",
    addedAgo: 70 * DAY,
  },
  {
    id: id(12),
    material: "TPU",
    brand: "Bambu",
    colorName: "Snow white",
    colorHex: "#f6f6f2",
    remaining: "full",
    addedAgo: 15 * DAY,
    note: "95A. Main nozzle, external spool, slow.",
  },
];

/** The seeded attempts' filaments, linked to these spools (same material and color name). */
export function linkSeedSpools(settings: AttemptSettings): AttemptSettings {
  if (!settings.filaments) return settings;
  return {
    ...settings,
    filaments: settings.filaments.map((filament) => {
      const spool = SEED_SPOOLS.find(
        (s) => s.material === filament.type && s.colorName === filament.colorName && s.brand === filament.brand,
      );
      return spool ? { ...filament, spoolId: spool.id } : filament;
    }),
  };
}

const SETUP: PrinterSetup = {
  nozzles: { main: { diameter: 0.4, hardened: true }, auxiliary: { diameter: 0.4, hardened: true } },
  plates: ["Textured PEI Plate", "Smooth PEI Plate", "Cool Plate"],
  amsUnits: 1,
};

export async function seedPantry(
  browser: Browser,
  request: APIRequestContext,
  origin: string,
  stateDir: string,
  now: number,
) {
  const headers = { Origin: origin };
  const sql: string[] = [];
  const svg = readFileSync(join(root, "scripts/seed/photos/spool-label.svg"), "utf8");
  for (const spool of SEED_SPOOLS) {
    const created = await request.post("/api/spools", {
      headers,
      data: {
        id: spool.id,
        material: spool.material,
        brand: spool.brand ?? null,
        colorName: spool.colorName,
        colorHex: spool.colorHex,
        finish: spool.finish ?? null,
        remaining: spool.remaining,
        netGrams: spool.grams?.net ?? null,
        note: spool.note ?? "",
        createdAt: now - spool.addedAgo,
        driedAt: spool.driedAgo ? now - spool.driedAgo : null,
      },
    });
    if (!created.ok()) throw new Error(`Seeding spool ${spool.colorName} failed: ${created.status()}`);
    if (spool.photo) {
      const filled = svg
        .replaceAll("FIL_LIGHT", spool.photo.light)
        .replaceAll("FIL_DARK", spool.photo.dark)
        .replaceAll("FIL", spool.colorHex);
      const large = await render(browser, filled, 1600);
      const thumb = await render(browser, filled, 600);
      const uploaded = await request.put(`/api/spools/${spool.id}/photo/${crypto.randomUUID()}`, {
        headers,
        multipart: {
          width: String(large.width),
          height: String(large.height),
          color: "#8a6a48",
          large: { name: "large.jpg", mimeType: "image/jpeg", buffer: large.jpeg },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: thumb.jpeg },
        },
      });
      if (!uploaded.ok()) throw new Error(`Uploading the label of ${spool.colorName} failed: ${uploaded.status()}`);
    }
    if (spool.grams) {
      const weighed = await request.post(`/api/spools/${spool.id}/weighings`, {
        headers,
        data: {
          id: crypto.randomUUID(),
          gramsLeft: spool.grams.left,
          tareGrams: 250,
          at: now - spool.grams.weighedAgo,
        },
      });
      if (!weighed.ok()) throw new Error(`Weighing ${spool.colorName} failed: ${weighed.status()}`);
    }
    if (spool.slot) {
      const loaded = await request.put(`/api/printer/slots/${spool.slot}`, { headers, data: { spoolId: spool.id } });
      if (!loaded.ok()) throw new Error(`Loading ${spool.colorName} failed: ${loaded.status()}`);
    }
    sql.push(`UPDATE spools SET updated_at = ${now - spool.addedAgo} WHERE id = '${spool.id}';`);
  }
  const printer = await request.put("/api/printer", { headers, data: SETUP });
  if (!printer.ok()) throw new Error(`Setting up the printer failed: ${printer.status()}`);
  executeSql(sql.join("\n"), { persistTo: stateDir });
}
