import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

/**
 * How much JavaScript each screen loads before it first shows (gzip, kB), on the production build with no service
 * worker: a heavy import that slips into every screen fails here rather than on a phone. Most of it is React, the
 * router, TanStack Query, sheets (vaul and Radix), toasts and motion, which every screen needs at once.
 *
 * Each screen has a ceiling, all of them in CEILING_KB. A pull request is held only to the screens it makes heavier:
 * CI hands this test main's latest sizes (E2E_FIRST_LOAD_BASE; main's own runs keep them in the Actions cache, see
 * docs/ci.md), so a screen that only main made heavier never fails someone else's pull request. Without main's sizes
 * (a run on your machine) every screen is held to its ceiling.
 *
 * Over a ceiling: move what the first view doesn't show out of the first load (a dynamic import, a lazy sheet, a file
 * of its own: see AGENTS.md and the notes on illustrations, Chip, sonner and lib/pantry-queries), or, when it belongs
 * there, raise that screen's ceiling and say why in the pull request. PERF_FILES=1 prints each screen's files with
 * their gzip sizes: diff them against a main worktree to see what grew.
 */

/**
 * Main's size plus 5 kB of room, rounded up. Measured on main on 2026-11-12, after #631 (gzip kB):

 * Raised by 2 kB for /today, /ideas and /builds with Twists (#722): the sidebar's entry brings its icon
 * (0.9 kB gzip, all six weights in one file) into every first load, and the two route stubs a little more. Main was
 * then 281.5 / 268.5 / 268.1; with Twists 282.9 / 269.8 / 269.4.
 *   /sign-in 178.1   /today 276.9   /ideas 263.5   /builds 263.4   /journal 263.4   /search 272.4   /pantry 272.2   /printer 272.0
 */
const CEILING_KB = {
  "/sign-in": 184,
  // 283: the Workshop route adds a lazy chunk to the entry (+0.5 kB), and the journal's Now block shares the print card with Today, which gives it a chunk of its own (+0.3 kB).
  // Twists (#722) adds its sidebar icon and two route stubs to every screen (+1.3 to 1.8 kB): today 286, ideas and builds 272.
  "/today": 286,
  // 270: the Workshop tab's Toolbox icon is in every screen's tab bar (+0.7 kB).
  "/ideas": 272,
  "/builds": 272,
  "/journal": 270,
  "/search": 278,
  "/pantry": 278,
  "/printer": 278,
} as const;

/** Changes smaller than this don't make a screen heavier: a renamed chunk moves a few bytes in every screen. */
const GREW_KB = 0.5;

/** Main's sizes, when CI has them: { sizes: { "/today": 296.9, … } }. */
function mainSizes(): Record<string, number> | undefined {
  const file = process.env.E2E_FIRST_LOAD_BASE;
  if (!file || !existsSync(file)) return undefined;
  return (JSON.parse(readFileSync(file, "utf8")) as { sizes: Record<string, number> }).sizes;
}

/** Keeps this run's sizes where CI saves them for the runs after it (main's pushes only). */
function keepSizes(sizes: Record<string, number>) {
  const file = process.env.E2E_FIRST_LOAD_OUT;
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ sizes }, null, 2)}\n`);
}

/**
 * The .js a screen needs before it first shows (its heading appears), with
 * sizes before and after gzip. What starts later (section code preloaded
 * once the tab bar is visible, motion's features) doesn't hold the screen up.
 */
async function scriptsLoadedBy(page: Page, path: string, ready: () => Promise<void>) {
  const bodies = new Map<string, Buffer>();
  const pending: Promise<void>[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith(".js") || url.pathname === "/sw.js") return;
    pending.push(
      response
        .body()
        .then((body) => void bodies.set(url.pathname, body))
        .catch(() => undefined),
    );
  });
  await page.goto(path);
  await ready();
  await page.waitForLoadState("networkidle");
  await Promise.all(pending);
  const before = new Set(
    await page.evaluate(() => {
      const shown = (window as Window & { __shownAt?: number }).__shownAt ?? performance.now();
      return performance
        .getEntriesByType("resource")
        .filter((entry) => entry.startTime <= shown)
        .map((entry) => new URL(entry.name).pathname);
    }),
  );
  const first = [...bodies].filter(([file]) => before.has(file));
  const kb = (bytes: number) => bytes / 1024;
  if (process.env.PERF_FILES) {
    const sizes = first.map(([file, body]) => `${(gzipSync(body).length / 1024).toFixed(1).padStart(6)} ${file}`);
    console.log(`${path}:\n${sizes.sort().reverse().join("\n")}`);
  }
  return {
    files: first.map(([file]) => file),
    zod: first.some(([, body]) => body.includes("ZodError")),
    raw: kb(first.reduce((sum, [, body]) => sum + body.length, 0)),
    gzip: kb(first.reduce((sum, [, body]) => sum + gzipSync(body).length, 0)),
  };
}

test("no screen's first load grows past its ceiling, and none loads the rarely used parts", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const main = mainSizes();
  const sizes: Record<string, number> = {};
  const rows: string[] = [];
  const over: string[] = [];
  for (const [path, ceiling] of Object.entries(CEILING_KB)) {
    // A fresh context per screen, with no service worker: what a first visit downloads.
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    if (path !== "/sign-in") {
      const user = SEED_USERS[0];
      const response = await context.request.post("/api/session", {
        data: { username: user.username, password: SEED_PASSWORD },
        headers: { Origin: new URL(baseURL ?? "").origin },
      });
      expect(response.ok()).toBe(true);
    }
    // Nothing that waits for an idle moment (warming the palette's code, photos for offline) counts as first load.
    await context.addInitScript(() => {
      window.requestIdleCallback = () => 0;
      // When the screen first shows: its heading is in the page.
      const observer = new MutationObserver(() => {
        if (!document.querySelector("h1")) return;
        (window as Window & { __shownAt?: number }).__shownAt = performance.now();
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    const page = await context.newPage();
    const { files, zod, raw, gzip } = await scriptsLoadedBy(page, path, async () => {
      await expect(page.locator("h1").first()).toBeVisible();
    });
    if (process.env.PERF_FILES) console.log(path, files.map((f) => f.split("/").pop()).join(" "));
    sizes[path] = Number(gzip.toFixed(2));
    const was = main?.[path];
    const change = was === undefined ? "" : `  ${gzip - was >= 0 ? "+" : ""}${(gzip - was).toFixed(1)} on main`;
    rows.push(`${path.padEnd(10)} ${raw.toFixed(0).padStart(5)} kB  ${gzip.toFixed(1).padStart(6)} kB gzip${change}`);
    // The styleguide, the .3mf reader, the command palette and the shortcut list wait until they are needed
    // (nothing loads them until asked, except the palette's idle prefetch, switched off here).
    for (const lazy of ["styleguide", "/read-", "CommandPalette", "ShortcutOverlay"]) {
      expect(
        files.filter((file) => file.includes(lazy) && !file.includes("read-only")),
        `${path} loads ${lazy}`,
      ).toEqual([]);
    }
    // zod is for the Worker; a route's validateSearch loads with the app, so the client checks search params by hand.
    expect(zod, `${path} loads zod`).toBe(false);
    // Held to the ceiling only where this change made the screen heavier (or with nothing to compare with).
    const heavier = was === undefined || gzip - was > GREW_KB;
    if (heavier && gzip > ceiling) {
      over.push(
        `${path}: ${gzip.toFixed(1)} kB gzip, ceiling ${ceiling} kB${was === undefined ? "" : ` (main: ${was.toFixed(1)})`}`,
      );
    }
    await context.close();
  }
  keepSizes(sizes);
  console.log(`First-load JavaScript per screen${main ? ", against main" : ""}:\n${rows.join("\n")}`);
  expect(over, "over the ceiling").toEqual([]);
});
