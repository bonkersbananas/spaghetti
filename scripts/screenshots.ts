/**
 * pnpm screenshots — starts the app on a seeded throwaway database (the same
 * seed as pnpm dev:seed), signs in and saves each screen in
 * scripts/screenshot-routes.ts at phone and desktop width into ./screenshots
 * (gitignored). A shot that fails doesn't stop the others: every failure is
 * listed at the end and the exit code is 1.
 *
 *   pnpm screenshots                # every screen
 *   pnpm screenshots ideas capture  # only these
 *   pnpm screenshots --dark         # in dark mode (the system setting), files named ideas-dark-390.png
 *   pnpm screenshots --both         # light and dark in one run
 *   pnpm screenshots --built        # on the production build (service worker included): what offline screens really show
 *   pnpm screenshots --iphone       # as the Home Screen app on an iPhone: standalone, 59 px top and 34 px bottom safe area (files named ideas-iphone-390.png)
 *   pnpm screenshots --webkit       # in WebKit as Safari on an iPhone 17 Pro (402×874, the iPhone's insets; `pnpm exec playwright install webkit` first); phone only, files named ideas-webkit-402.png. --width 375 for the smallest iPhone
 *   pnpm screenshots --out DIR      # write somewhere else (default ./screenshots)
 *   pnpm screenshots --width 1440   # one width only (a width under 768 is a phone, any other number a desktop window of that width, 900 tall)
 *   pnpm screenshots --scale 1      # device pixel ratio 1 at both widths (default 3 on the phone, 2 on the desktop)
 *
 * Every theme and width is taken on its own freshly seeded app, so a shot that changes data (finishing a
 * print) can't leave it for the next pass. The browser's clock is fixed to the seed's date (SEED_NOW) and its time
 * zone to UTC, so the pictures don't depend on the day they are taken.
 * SPAGHETTI_BROWSER=/path/to/chromium uses an existing Chromium; SCREENSHOT_PORT picks the server port.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, devices, type Page, webkit } from "@playwright/test";
import { launchOptions } from "./lib/browser.ts";
import { simulateIphone } from "./lib/iphone.ts";
import { SEED_USERS } from "./lib/local-app.ts";
import { startSeededApp } from "./lib/seeded-app.ts";
import { root } from "./lib/wrangler.ts";
import { shots } from "./screenshot-routes.ts";
import { SEED_LOCALE, SEED_NOW } from "./seed/index.ts";

const allViewports = [
  { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  { width: 1440, height: 900, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
];
// The iPhone insets only mean something on the phone.
const widthArg = process.argv.includes("--width")
  ? Number(process.argv[process.argv.indexOf("--width") + 1])
  : undefined;
if (widthArg !== undefined && !(widthArg >= 320)) throw new Error("--width needs a number such as 390, 1280 or 1920.");
const webkitRun = process.argv.includes("--webkit");
// Safari on an iPhone 17 Pro: 402×874 CSS px at 3×, whatever the width option says about the height.
const iphoneViewport = {
  width: widthArg ?? 402,
  height: widthArg && widthArg !== 402 ? 812 : 874,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};
const viewports: typeof allViewports = webkitRun
  ? [iphoneViewport]
  : process.argv.includes("--iphone")
    ? allViewports.slice(0, 1)
    : widthArg === undefined
      ? allViewports
      : [
          allViewports.find((v) => v.width === widthArg) ?? {
            width: widthArg,
            height: 900,
            deviceScaleFactor: 2,
            isMobile: false,
            hasTouch: false,
          },
        ];

const argv = process.argv.slice(2);
const option = (name: string) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};
const optionValues = new Set(["--out", "--scale", "--width"].flatMap((name) => (option(name) ? [option(name)] : [])));
const themes: Array<"light" | "dark"> = argv.includes("--both")
  ? ["light", "dark"]
  : argv.includes("--dark")
    ? ["dark"]
    : ["light"];
const built = argv.includes("--built");
const iphone = argv.includes("--iphone") || webkitRun;
const suffix = (theme: string) =>
  `${theme === "dark" ? "-dark" : ""}${webkitRun ? "-webkit" : iphone ? "-iphone" : ""}`;
const scale = option("--scale") ? Number(option("--scale")) : undefined;
if (scale !== undefined && !(scale > 0)) throw new Error("--scale needs a number such as 1 or 2.");
const only = argv.filter((arg) => !arg.startsWith("--") && !optionValues.has(arg));
const unknown = only.filter((name) => !shots.some((shot) => shot.name === name));
if (unknown.length)
  throw new Error(`No screen called ${unknown.join(", ")}. Screens: ${shots.map((s) => s.name).join(", ")}`);
const selected = only.length ? shots.filter((s) => only.includes(s.name)) : shots;
const outDir = resolve(option("--out") ?? join(root, "screenshots"));
mkdirSync(outDir, { recursive: true });

if (built) {
  const build = spawnSync(join(root, "node_modules/.bin/vite"), ["build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
let port = Number(process.env.SCREENSHOT_PORT) || 5180 + Math.floor(Math.random() * 100);
let browser: Browser | undefined;
const failures: string[] = [];
let taken = 0;

try {
  browser = webkitRun ? await webkit.launch() : await chromium.launch(launchOptions());
  for (const theme of themes) {
    for (const viewport of viewports) {
      // Every pass gets its own freshly seeded app: a shot that changes data (finishing a print)
      // must not leave it for the next width or theme, which would then look different from run to run.
      const app = await startSeededApp({
        port: port++,
        built,
        now: SEED_NOW,
        log: (message) => console.log(`  ${message}`),
      });
      try {
        const { width, height, ...device } = viewport;
        const context = await browser.newContext({
          viewport: { width, height },
          ...device,
          ...(webkitRun ? { userAgent: devices["iPhone 15 Pro"].userAgent } : {}),
          ...(scale ? { deviceScaleFactor: scale } : {}),
          ...SEED_LOCALE,
          baseURL: app.url,
          reducedMotion: "reduce",
          colorScheme: theme,
          serviceWorkers: "allow",
        });
        context.setDefaultTimeout(20_000);
        if (iphone) await simulateIphone(context);
        await context.clock.setFixedTime(SEED_NOW);
        let page = await context.newPage();
        const user = SEED_USERS[0];

        for (const shot of selected.filter((s) => s.signedOut)) {
          page = await attempt(context, page, shot, width, theme);
        }

        const response = await page.request.post("/api/session", {
          data: { username: user.username, password: user.password },
          headers: { Origin: app.url },
        });
        if (!response.ok()) throw new Error(`Signing in failed: ${response.status()}`);

        for (const shot of selected.filter((s) => !s.signedOut)) {
          page = await attempt(context, page, shot, width, theme);
        }
        await context.close();
      } finally {
        app.stop();
      }
    }
  }
} finally {
  await browser?.close();
}

console.log(`\n${taken} screenshots in ${outDir}`);
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`);
  process.exitCode = 1;
}

/** Takes one shot; if it fails, notes why and gives the next shot a fresh page. */
async function attempt(
  context: BrowserContext,
  page: Page,
  shot: (typeof shots)[number],
  width: number,
  theme: "light" | "dark",
): Promise<Page> {
  const label = `${shot.name}${suffix(theme)}-${width}`;
  if (shot.width && shot.width !== (width < 768 ? 390 : 1440)) return page;
  try {
    await capture(page, shot, width, theme);
    taken++;
    return page;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = message.split("\n").slice(0, 3).join(" ").slice(0, 300);
    failures.push(`${label}: ${reason}`);
    console.error(`  ✗ ${label}: ${reason}`);
    // A failed shot may leave a sheet open or the browser offline: start the next one clean.
    await context.setOffline(false).catch(() => undefined);
    await page.close().catch(() => undefined);
    return context.newPage();
  }
}

async function capture(page: Page, shot: (typeof shots)[number], width: number, theme: "light" | "dark") {
  await page.goto(shot.path, { waitUntil: "networkidle" });
  // The built app: the service worker must be in charge, or photos can't come from its cache once offline.
  if (built) await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // Route chunks can still be rendering at network idle: wait for the screen's
  // heading, so the images below are in the page before we load them.
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  await shot.prepare?.(page);
  await loadAllImages(page, shot.name);
  await shot.beforeShot?.(page);
  // Let entrance animations and sheets settle.
  await page.waitForTimeout(600);
  const file = join(outDir, `${shot.name}${suffix(theme)}-${width}.png`);
  if (shot.selector) await page.locator(shot.selector).screenshot({ path: file });
  else await page.screenshot({ path: file, fullPage: shot.fullPage ?? false });
  await shot.cleanup?.(page);
  console.log(`  ${shot.name}${suffix(theme)}-${width}.png`);
}

/**
 * Full-page captures don't scroll, so lazy images below the fold would never
 * load and cards would show empty blocks. Load every image eagerly, wait for
 * it to decode, and fail on any that is broken rather than publish it.
 */
async function loadAllImages(page: Page, name: string) {
  const broken = await page.evaluate(async () => {
    const images = Array.from(document.images);
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    // The styleguide's avatar specimen shows a picture that can't load, on purpose (the initials stay).
    return images
      .filter((image) => (!image.complete || image.naturalWidth === 0) && !image.src.includes("/people/none/photo"))
      .map((image) => image.src);
  });
  if (broken.length) throw new Error(`${name}: images failed to load:\n${broken.join("\n")}`);
}
