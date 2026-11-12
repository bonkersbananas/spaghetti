/**
 * The seed shared by pnpm screenshots and pnpm dev:seed: two people, a dozen
 * ideas, the pantry and builds with histories. Everything goes through the
 * real API, as a phone would.
 */
import { readFileSync } from "node:fs";
import { type APIRequestContext, type Browser, request } from "@playwright/test";
import { SEED_USERS } from "../lib/local-app.ts";
import { executeSql } from "../lib/wrangler.ts";
import { seedBridge, seedBuilds } from "./builds.ts";
import { seedComments } from "./comments.ts";
import { seedIdeas } from "./ideas.ts";
import { seedPantry } from "./pantry.ts";
import { seedRecipes } from "./recipes.ts";
import { seedShopping } from "./shopping.ts";
import { seedTwists } from "./twists.ts";
import { seedWishlists } from "./wishlists.ts";

/**
 * The instant the seed counts back from when screenshots are taken: a
 * Wednesday midday in the middle of a month, in the past (the API refuses
 * dates in the future). Dates in the seed are all "N days ago" from it, and
 * the screenshot browser's clock is set to it, so the journal groups the
 * same way on every day the script runs. Move it only together with a look
 * at every screenshot.
 */
export const SEED_NOW = Date.UTC(2026, 9, 21, 12, 0, 0);

/** The clock the screenshot browser runs on: the seed's "now" in a fixed zone and language. */
export const SEED_LOCALE = { locale: "en-US", timezoneId: "UTC" } as const;

/** Fills a migrated database (served at `origin`, state in `stateDir`) with the seed. */
export async function seedAll({
  browser,
  origin,
  stateDir,
  now,
}: {
  browser: Browser;
  origin: string;
  stateDir: string;
  /** What "now" is for the seed's dates: SEED_NOW, or the real time to explore a live-feeling app. */
  now: number;
}) {
  const [alex, sam] = await Promise.all(
    SEED_USERS.map(async (user) => {
      const context = await request.newContext({ baseURL: origin });
      const response = await context.post("/api/session", {
        data: { username: user.username, password: user.password },
        headers: { Origin: origin },
      });
      if (!response.ok()) throw new Error(`Signing in ${user.username} failed: ${response.status()}`);
      return context;
    }),
  );
  if (!alex || !sam) throw new Error("Seeding needs both people");
  try {
    await seedProfilePicture(alex, origin);
    await seedIdeas(browser, { alex, sam }, origin, now);
    await seedPantry(browser, alex, origin, stateDir, now);
    await seedBuilds(browser, { alex, sam }, origin, stateDir, now);
    await seedRecipes(alex, origin, stateDir);
    await seedTwists(alex, origin);
    await seedComments({ alex, sam }, origin, stateDir, now);
    await seedWishlists({ alex, sam }, origin);
    // What the link in the desk tidy-up note calls itself. The sandbox can't fetch pages, and a screenshot
    // shouldn't depend on one: the preview cache is filled as if it had (stamped with the real clock, so it stays fresh).
    executeSql(
      `INSERT OR REPLACE INTO link_previews (url, title, site, failed, fetched_at) VALUES ('https://makerworld.com/en/models/487213-drawer-bins', 'Drawer bins, 42 mm grid', 'MakerWorld', 0, ${Date.now()}), ('https://www.printables.com/model/512340-bath-tugboat', 'Bath tugboat, floats upright', 'Printables', 0, ${Date.now()});`,
      { persistTo: stateDir },
    );
    await seedBridge(alex, origin);
    await seedUpkeep(alex, stateDir);
    await seedShopping({ alex, sam }, origin, stateDir, now);
  } finally {
    await Promise.all([alex.dispose(), sam.dispose()]);
  }
}

/** Alex has a picture, Sam keeps initials, so the shots show both. */
async function seedProfilePicture(alex: APIRequestContext, origin: string) {
  const response = await alex.put("/api/people/me/photo", {
    headers: { Origin: origin },
    multipart: {
      photo: {
        name: "portrait.jpg",
        mimeType: "image/jpeg",
        buffer: readFileSync(new URL("../../e2e/fixtures/portrait.jpg", import.meta.url)),
      },
    },
  });
  if (!response.ok()) throw new Error(`Seeding the profile picture failed: ${response.status()}`);
}

const DAY = 24 * 3_600_000;

/**
 * The upkeep list: the first read seeds the starting tasks, then they are given ages (the server counts days
 * from the real clock), so the plate and the desiccant are due and the rest are part-way. One has a history.
 */
async function seedUpkeep(alex: APIRequestContext, stateDir: string) {
  const first = await alex.get("/api/printer/upkeep");
  if (!first.ok()) throw new Error(`Seeding upkeep failed: ${first.status()}`);
  const ages: Record<string, number> = {
    plate: 19,
    nozzle: 12,
    "purge-chute": 4,
    desiccant: 70,
    rods: 60,
    belts: 25,
    "air-filter": 30,
  };
  const at = Date.now();
  executeSql(
    Object.entries(ages)
      .map(([id, days]) => `UPDATE upkeep_tasks SET created_at = ${at - days * DAY} WHERE id = '${id}';`)
      .join("\n"),
    { persistTo: stateDir },
  );
  const done = await alex.post("/api/printer/upkeep/nozzle/done", {
    data: { id: crypto.randomUUID(), note: "Wiper swapped, nozzle tip wiped clean.", at: at - 9 * DAY },
  });
  if (!done.ok()) throw new Error(`Seeding upkeep failed: ${done.status()}`);
}
