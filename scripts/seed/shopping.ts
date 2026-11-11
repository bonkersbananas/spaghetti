/**
 * The shopping list for screenshots: five things to buy (names, shop links, Prisjakt pages; one added as a bare link
 * that takes its page's title) and two bought ones, by both people. Added through the API, newest last so the first
 * is on top; who bought what and when is set in D1 afterwards, counted back from `now`.
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
];

const bought: Array<Thing & { by: string; ago: number }> = [
  {
    id: ID(6),
    name: "Textured PEI plate",
    link: "https://eu.store.bambulab.com/products/textured-pei-plate",
    by: "sam",
    ago: 2 * DAY,
  },
  { id: ID(7), name: "Isopropyl alcohol 99%", by: "alex", ago: 9 * DAY },
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
      // Everything was added over the last fortnight, not all at the seed's moment.
      `UPDATE shopping_items SET created_at = ${now - 14 * DAY}, updated_at = ${now - 14 * DAY};`,
    ].join("\n"),
    { persistTo: stateDir },
  );
}
