/**
 * The shopping list for screenshots, about as long as the real one: 21 things to buy (names, some long; shop links;
 * eight with a Prisjakt page and its prices and picture, eight with a page the search found to confirm, five it found
 * nothing for; one added as a bare link that takes its page's title) and six bought ones, by both people. Added
 * through the API, newest last so the first is on top; who bought what and when is set in D1 afterwards, counted back
 * from `now`.
 */
import type { APIRequestContext } from "@playwright/test";
import { executeSql } from "../lib/wrangler.ts";

const ID = (n: number) => `5eed0000-0000-4000-8000-0000000e00${String(n).padStart(2, "0")}`;
const DAY = 24 * 60 * 60 * 1000;

export const SEED_SHOPPING_IDS = { glue: ID(1), pla: ID(2) };

const GLUE = "https://eu.store.bambulab.com/products/liquid-glue-for-build-plate";
const PLA = "https://eu.store.bambulab.com/products/pla-basic-filament";

interface Thing {
  id: string;
  name: string;
  link?: string;
  priceLink?: string;
  /** The search for its Prisjakt page found nothing (the stand-in finds one for any name). */
  noMatch?: boolean;
}

/** Top of the list first. */
const toBuy: Thing[] = [
  {
    id: ID(1),
    name: "Liquid glue for the build plate",
    link: GLUE,
    priceLink: "https://www.prisjakt.nu/produkt.php?p=13366548",
  },
  { id: ID(2), name: "", link: PLA, priceLink: "https://www.prisjakt.nu/produkt.php?p=12086734" },
  {
    id: ID(3),
    name: "Hardened steel nozzle, 0.4 mm",
    link: "https://eu.store.bambulab.com/products/hardened-steel-nozzle",
  },
  { id: ID(4), name: "Silica gel for the dry box" },
  { id: ID(5), name: "PETG HF, translucent orange", priceLink: "https://www.prisjakt.nu/produkt.php?p=14402211" },
  { id: ID(8), name: "PTFE tube, 1 m" },
  { id: ID(9), name: "Hex key set", noMatch: true },
  { id: ID(10), name: "ASA, 1 kg, ash grey", priceLink: "https://www.prisjakt.nu/produkt.php?p=15011223" },
  {
    id: ID(11),
    name: "Velcro cable ties, 50 pcs",
    link: "https://eu.store.bambulab.com/products/velcro-cable-ties",
  },
  { id: ID(12), name: "Craft knife with snap-off blades", noMatch: true },
  {
    id: ID(13),
    name: "AMS Lite replacement feeder assembly with hub and buffer, complete kit",
    priceLink: "https://www.prisjakt.nu/produkt.php?p=15011225",
  },
  { id: ID(14), name: "Bed adhesion spray" },
  { id: ID(15), name: "TPU 95A, 500 g, translucent", priceLink: "https://www.prisjakt.nu/produkt.php?p=15011224" },
  { id: ID(16), name: "Lubricant for linear rails, PTFE-based, 50 ml", noMatch: true },
  { id: ID(17), name: "Super Lube synthetic multi-purpose grease with PTFE, 85 g tube" },
  { id: ID(18), name: "PLA Silk, gold, 1 kg" },
  {
    id: ID(19),
    name: "Magnetic build plate sticker, 256 × 256 mm",
    priceLink: "https://www.prisjakt.nu/produkt.php?p=15011226",
  },
  { id: ID(20), name: "Nozzle wiping brush, brass", noMatch: true },
  { id: ID(21), name: "M3 heat-set inserts, assorted pack of 200" },
  {
    id: ID(22),
    name: "Digital caliper, 150 mm, stainless steel with LCD display and depth rod",
    noMatch: true,
  },
  {
    id: ID(23),
    name: "Desiccant beads, orange indicating, 1 kg",
    priceLink: "https://www.prisjakt.nu/produkt.php?p=15011227",
  },
];

const bought: Array<Thing & { by: string; ago: number }> = [
  { id: ID(24), name: "Glue sticks, 3-pack", by: "sam", ago: 3 * 60 * 60 * 1000, noMatch: true },
  {
    id: ID(6),
    name: "Textured PEI plate",
    link: "https://eu.store.bambulab.com/products/textured-pei-plate",
    by: "sam",
    ago: 2 * DAY,
  },
  { id: ID(25), name: "Spare hotend thermistor", by: "alex", ago: 4 * DAY, noMatch: true },
  { id: ID(7), name: "Isopropyl alcohol 99%", by: "alex", ago: 9 * DAY },
  { id: ID(26), name: "Kapton tape, 20 mm", by: "sam", ago: 12 * DAY, noMatch: true },
  { id: ID(27), name: "Flush cutters", by: "alex", ago: 20 * DAY, noMatch: true },
];

export async function seedShopping(
  people: { alex: APIRequestContext; sam: APIRequestContext },
  origin: string,
  stateDir: string,
  now: number,
) {
  const all = [...bought, ...[...toBuy].reverse()];
  for (const [index, { id, name, link, priceLink }] of all.entries()) {
    const as = index % 2 ? people.sam : people.alex;
    const response = await as.post("/api/shopping-items", {
      headers: { Origin: origin },
      data: { id, ...(name && { name }), ...(link && { link }), ...(priceLink && { priceLink }) },
    });
    if (!response.ok())
      throw new Error(`Seeding "${name || link}" failed: ${response.status()} ${await response.text()}`);
  }
  executeSql(
    [
      // What the bare link calls itself (the sandbox can't fetch pages), stamped with the real clock so it stays fresh.
      `INSERT OR REPLACE INTO link_previews (url, title, site, failed, fetched_at) VALUES ('${PLA}', 'PLA Basic, Jade White | Bambu Lab EU', 'Bambu Lab EU', 0, ${Date.now()});`,
      ...bought.map(
        (thing) =>
          `UPDATE shopping_items SET bought_at = ${now - thing.ago}, bought_by = (SELECT id FROM users WHERE username = '${thing.by}') WHERE id = '${thing.id}';`,
      ),
      // The searches that found nothing (the stand-in's own answer is a match for every name).
      ...[...toBuy, ...bought]
        .filter((thing) => thing.noMatch)
        .map(
          (thing) =>
            `UPDATE shopping_items SET suggestion = NULL, suggestion_claimed_at = ${now}, suggestion_done_at = ${now} WHERE id = '${thing.id}';`,
        ),
      // Everything was added over the last fortnight, not all at the seed's moment.
      `UPDATE shopping_items SET created_at = ${now - 14 * DAY}, updated_at = ${now - 14 * DAY};`,
    ].join("\n"),
    { persistTo: stateDir },
  );
}
