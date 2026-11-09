/**
 * pnpm screenshots — starts the app on a seeded throwaway database, signs in
 * and saves each screen in scripts/screenshot-routes.ts at phone and desktop
 * width into ./screenshots (gitignored).
 *
 *   pnpm screenshots              # every screen
 *   pnpm screenshots ideas capture  # only these
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, chromium } from "@playwright/test";
import { SEED_USERS, seedThrowawayState, startDevServer } from "./lib/local-app.ts";
import { root } from "./lib/wrangler.ts";
import { shots } from "./screenshot-routes.ts";

const viewports = [
  { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
];

const only = process.argv.slice(2);
const selected = only.length ? shots.filter((s) => only.includes(s.name)) : shots;
const outDir = join(root, "screenshots");
mkdirSync(outDir, { recursive: true });

const state = await seedThrowawayState();
const server = await startDevServer({ port: 5180 + Math.floor(Math.random() * 100), stateDir: state.dir });
let browser: Browser | undefined;

try {
  browser = await chromium.launch();
  for (const viewport of viewports) {
    const { width, height, ...device } = viewport;
    const context = await browser.newContext({
      viewport: { width, height },
      ...device,
      baseURL: server.url,
      reducedMotion: "reduce",
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
  await page.evaluate(() => document.fonts.ready);
  await shot.prepare?.(page);
  // Let entrance animations and sheets settle.
  await page.waitForTimeout(600);
  const file = join(outDir, `${shot.name}-${width}.png`);
  await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
  console.log(`  ${shot.name}-${width}.png`);
}
