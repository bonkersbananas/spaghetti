/**
 * The seed shared by pnpm screenshots and pnpm dev:seed: two people, a dozen
 * ideas, the pantry and builds with histories. Everything goes through the
 * real API, as a phone would.
 */
import { type Browser, request } from "@playwright/test";
import { SEED_USERS } from "../lib/local-app.ts";
import { executeSql } from "../lib/wrangler.ts";
import { seedBuilds } from "./builds.ts";
import { seedIdeas } from "./ideas.ts";
import { seedPantry } from "./pantry.ts";

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
    await seedIdeas(browser, { alex, sam }, origin, now);
    await seedPantry(browser, alex, origin, stateDir, now);
    await seedBuilds(browser, { alex, sam }, origin, stateDir, now);
    // What the link in the desk tidy-up note calls itself. The sandbox can't fetch pages, and a screenshot
    // shouldn't depend on one: the preview cache is filled as if it had (stamped with the real clock, so it stays fresh).
    executeSql(
      `INSERT OR REPLACE INTO link_previews (url, title, site, failed, fetched_at) VALUES ('https://makerworld.com/en/models/drawer-bins', 'Drawer bins, 42 mm grid', 'MakerWorld', 0, ${Date.now()});`,
      { persistTo: stateDir },
    );
  } finally {
    await Promise.all([alex.dispose(), sam.dispose()]);
  }
}
