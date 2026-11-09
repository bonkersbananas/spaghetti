/**
 * pnpm screenshots — starts the app on a seeded throwaway database, signs in
 * and saves each screen in scripts/screenshot-routes.ts at phone and desktop
 * width into ./screenshots (gitignored).
 *
 *   pnpm screenshots              # every screen
 *   pnpm screenshots ideas capture  # only these
 *   pnpm screenshots --dark         # in dark mode (the system setting), files named ideas-dark-390.png
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium, request } from "@playwright/test";
import { SEED_USERS, seedThrowawayState, startDevServer } from "./lib/local-app.ts";
import { root } from "./lib/wrangler.ts";
import { shots } from "./screenshot-routes.ts";
import { seedBuilds } from "./seed/builds.ts";
import { seedIdeas } from "./seed/ideas.ts";

const viewports = [
  { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
];

const dark = process.argv.includes("--dark");
const only = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const selected = only.length ? shots.filter((s) => only.includes(s.name)) : shots;
const outDir = join(root, "screenshots");
mkdirSync(outDir, { recursive: true });

const state = await seedThrowawayState();
const server = await startDevServer({ port: 5180 + Math.floor(Math.random() * 100), stateDir: state.dir });
let browser: Browser | undefined;

try {
  browser = await chromium.launch();
  await seed(browser);
  for (const viewport of viewports) {
    const { width, height, ...device } = viewport;
    const context = await browser.newContext({
      viewport: { width, height },
      ...device,
      baseURL: server.url,
      reducedMotion: "reduce",
      colorScheme: dark ? "dark" : "light",
    });
    const page = await context.newPage();
    const user = SEED_USERS[0];

    for (const shot of selected.filter((s) => s.signedOut)) {
      await capture(page, shot, width);
    }

    const response = await page.request.post("/api/session", {
      data: { username: user.username, password: user.password },
      headers: { Origin: server.url },
    });
    if (!response.ok()) throw new Error(`Signing in failed: ${response.status()}`);

    for (const shot of selected.filter((s) => !s.signedOut)) {
      await capture(page, shot, width);
    }
    await context.close();
  }
  console.log(`✓ Screenshots in ${outDir}`);
} finally {
  await browser?.close();
  server.stop();
  state.cleanup();
}

async function capture(page: import("@playwright/test").Page, shot: (typeof shots)[number], width: number) {
  if (shot.width && shot.width !== width) return;
  await page.goto(shot.path, { waitUntil: "networkidle" });
  // Route chunks can still be rendering at network idle: wait for the screen's
  // heading, so the images below are in the page before we load them.
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await shot.prepare?.(page);
  await loadAllImages(page, shot.name);
  await shot.beforeShot?.(page);
  // Let entrance animations and sheets settle.
  await page.waitForTimeout(600);
  const file = join(outDir, `${shot.name}${dark ? "-dark" : ""}-${width}.png`);
  if (shot.selector) await page.locator(shot.selector).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
  await shot.cleanup?.(page);
  console.log(`  ${shot.name}${dark ? "-dark" : ""}-${width}.png`);
}

/**
 * Full-page captures don't scroll, so lazy images below the fold would never
 * load and cards would show empty blocks. Load every image eagerly, wait for
 * it to decode, and fail on any that is broken rather than publish it.
 */
async function loadAllImages(page: import("@playwright/test").Page, name: string) {
  const broken = await page.evaluate(async () => {
    const images = Array.from(document.images);
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    return images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src);
  });
  if (broken.length) throw new Error(`${name}: images failed to load:\n${broken.join("\n")}`);
}

/** Fills the throwaway database with a dozen ideas, captured by both people, some grown into builds. */
async function seed(browser: Browser) {
  if (!server) return;
  const [alex, sam] = await Promise.all(
    SEED_USERS.map(async (user) => {
      const context = await request.newContext({ baseURL: server.url });
      const response = await context.post("/api/session", {
        data: { username: user.username, password: user.password },
        headers: { Origin: server.url },
      });
      if (!response.ok()) throw new Error(`Signing in ${user.username} failed: ${response.status()}`);
      return context;
    }),
  );
  if (!alex || !sam) throw new Error("Seeding needs both people");
  await seedIdeas(browser, { alex, sam }, server.url);
  await seedBuilds(browser, { alex, sam }, server.url, state.dir);
  await Promise.all([alex.dispose(), sam.dispose()]);
  console.log("  seeded ideas and builds");
}
