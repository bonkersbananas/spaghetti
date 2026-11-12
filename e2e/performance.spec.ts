import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { installProbe, median, onScreen, PHONE, type TapResult, tapLatency, throttle } from "../scripts/lib/perf.ts";
import { clearIdeas, signIn } from "./helpers";

/**
 * Speed on the production build, measured: whether an inbox of a hundred photo ideas scrolls smoothly, the taps
 * people make most answer quickly and the installed app opens fast, on a mid-range phone profile (4× CPU). These need
 * a quiet machine, so CI runs them only for pushes to main, in a job of their own with one worker (E2E_SPEED=1 adds
 * this project; docs/ci.md). How much JavaScript each screen loads is e2e/first-load.spec.ts, on every pull request.
 */

const origin = (page: Page) => new URL(page.url()).origin;

test("an inbox of a hundred photo ideas scrolls smoothly on a mid-range phone", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await signIn(page);
  await clearIdeas(page);
  // Thumbnails the way the app makes them (600 px on the long edge, lib/images.ts), drawn in the browser.
  const large = readFileSync("e2e/fixtures/tugboat.jpg");
  const thumb = Buffer.from(
    await page.evaluate(async (base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
      const scale = 600 / Math.max(bitmap.width, bitmap.height);
      const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
      canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of buffer) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, large.toString("base64")),
    "base64",
  );
  const headers = { Origin: origin(page) };
  const now = Date.now();
  for (let i = 0; i < 100; i++) {
    const id = crypto.randomUUID();
    await page.request.post("/api/items", {
      headers,
      data: { id, title: i % 3 ? `Idea ${i + 1}` : null, note: "A quick sketch", createdAt: now - i * 60_000 },
    });
    await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
      headers,
      multipart: {
        width: "1200",
        height: "900",
        color: "#6b5a4a",
        position: "0",
        large: { name: "large.jpg", mimeType: "image/jpeg", buffer: large },
        thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: thumb },
      },
    });
  }

  const client = await context.newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const photos: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/photos\//.test(request.url())) photos.push(request.url());
  });
  await page.goto("/ideas");
  const cards = page.getByRole("list", { name: "Ideas" }).getByRole("link");
  await expect(cards).toHaveCount(100);
  await page.waitForLoadState("networkidle");

  // Lazy and correctly sized: only the cards near the first screen have loaded their pictures, every
  // card uses the thumbnail, and a thumbnail is at most twice the pixels its card shows.
  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>("main img")).map((img) => ({
      lazy: img.loading === "lazy",
      loaded: img.complete && img.naturalWidth > 0,
      thumb: img.src.includes("/thumb"),
      ratio: img.naturalWidth ? img.naturalWidth / (img.getBoundingClientRect().width * devicePixelRatio) : 1,
    })),
  );
  expect(images).toHaveLength(100);
  expect(images.filter((image) => !image.lazy)).toEqual([]);
  expect(images.filter((image) => !image.thumb)).toEqual([]);
  const loadedFirst = images.filter((image) => image.loaded).length;
  expect(loadedFirst, "pictures loaded before scrolling").toBeLessThan(30);
  for (const image of images.filter((i) => i.loaded)) expect(image.ratio).toBeLessThan(2.2);
  expect(
    photos.filter((url) => url.includes("/large")),
    "large photos fetched for the inbox",
  ).toEqual([]);

  // Scroll to the end the way a thumb does, counting frames that take long enough to stutter.
  const frames = await page.evaluate(async () => {
    const durations: number[] = [];
    let last = performance.now();
    let running = true;
    const tick = (time: number) => {
      durations.push(time - last);
      last = time;
      if (running) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const end = document.documentElement.scrollHeight - window.innerHeight;
    while (window.scrollY < end - 2) {
      window.scrollBy(0, 60);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    running = false;
    durations.sort((a, b) => a - b);
    const at = (q: number) => durations[Math.min(durations.length - 1, Math.floor(durations.length * q))] ?? 0;
    return { count: durations.length, p50: at(0.5), p95: at(0.95), long: durations.filter((d) => d > 50).length };
  });
  console.log(
    `Inbox, 100 photo ideas, 4× CPU: ${frames.count} frames, median ${frames.p50.toFixed(1)} ms, p95 ${frames.p95.toFixed(1)} ms, ${frames.long} over 50 ms; ${loadedFirst} pictures loaded before scrolling`,
  );
  // Here it runs at a steady 60 fps (p95 under 17 ms); the bounds leave room for a busy CI machine.
  expect(frames.p95, "95th percentile frame time while scrolling").toBeLessThan(50);
  expect(frames.long / frames.count, "share of frames over 50 ms").toBeLessThan(0.1);

  await clearIdeas(page);
  await context.close();
});

/**
 * How fast it feels (docs: AGENTS.md, "Measuring speed"; `pnpm perf` prints the whole table): on a phone profile
 * (390 px, touch, 4× CPU) the taps people make most must paint a reaction within a frame or two, and the installed
 * app must open from its caches. Budgets are the median of three, about twice what a quiet machine measures, so a
 * busy CI runner holds them and a real regression (a lazy chunk that blocks a screen, a network wait before a
 * tap shows) doesn't.
 */
/** The first ⌘K after a load, in ms, on the slow profile (set after measuring; see the test). */
const MAX_FIRST_PALETTE_MS = 1000;
const TAP_BUDGET_MS = { inp: 200, shown: 300 };

test("the taps people make most answer quickly on a mid-range phone", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, ...PHONE });
  await installProbe(context);
  const page = await context.newPage();
  await signIn(page);
  await clearIdeas(page);
  const headers = { Origin: origin(page) };
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await page.request.post("/api/items", { headers, data: { id, title: `Idea ${i + 1}`, note: "A quick sketch" } });
  }
  // Two of them become builds.
  for (const id of ids.slice(0, 2))
    await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
  await page.goto("/journal");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await throttle(page, { network: false });

  const tabs = page.getByRole("navigation", { name: "Sections" });
  const heading = (title: string) =>
    `document.querySelector('h1')?.textContent === ${JSON.stringify(title)} && !document.querySelector('.sg-skeleton')`;
  const taps: Record<string, TapResult[]> = {};
  const add = (name: string, tap: TapResult) => (taps[name] = [...(taps[name] ?? []), tap]);
  const settle = () => page.waitForTimeout(400);

  for (let run = 0; run < 3; run++) {
    await settle();
    add(
      "capture button → sheet",
      await tapLatency(page, () => tabs.getByRole("button", { name: "New idea" }).tap(), onScreen("[role=dialog]")),
    );
    await page.keyboard.press("Escape");
    await page.locator("[role=dialog]").waitFor({ state: "detached" });
    await settle();
    add(
      "tab Journal → Ideas",
      await tapLatency(page, () => tabs.getByRole("link", { name: "Ideas" }).tap(), heading("Ideas")),
    );
    await settle();
    add(
      "open an idea",
      await tapLatency(
        page,
        () => page.locator('main a[href^="/ideas/"]').first().tap(),
        `location.pathname.startsWith('/ideas/') && !!document.querySelector('textarea, input[type=text]')`,
      ),
    );
    await page.goBack();
    await tabs.getByRole("link", { name: "Builds" }).tap();
    await page.locator('main a[href^="/builds/"]').first().waitFor();
    await settle();
    add(
      "open a build",
      await tapLatency(
        page,
        () => page.locator('main a[href^="/builds/"]').first().tap(),
        `location.pathname.startsWith('/builds/') && !!document.querySelector('textarea, input[type=text]')`,
      ),
    );
    await page.getByRole("button", { name: "Log attempt" }).first().waitFor();
    await settle();
    add(
      "log attempt → sheet",
      await tapLatency(
        page,
        () => page.getByRole("button", { name: "Log attempt" }).first().tap(),
        onScreen("[role=dialog] [role=radio]"),
      ),
    );
    await settle();
    add(
      "pick an outcome",
      await tapLatency(
        page,
        () => page.getByRole("dialog").getByRole("radio", { name: "Worked" }).tap(),
        `document.querySelector('[role=dialog] [role=radio][aria-checked=true]')?.textContent?.includes('Worked')`,
      ),
    );
    await page.keyboard.press("Escape");
    await page.locator("[role=dialog]").waitFor({ state: "detached" });
    await tabs.getByRole("link", { name: "Journal" }).tap();
    await expect(page.locator("h1").first()).toHaveText("Journal");
  }
  const rows: string[] = [];
  const over: string[] = [];
  for (const [name, results] of Object.entries(taps)) {
    const inp = median(results.map((r) => r.inp));
    const shown = median(results.map((r) => r.shown));
    rows.push(
      `${name.padEnd(24)} input to paint ${inp.toFixed(0).padStart(4)} ms, tap to result ${shown.toFixed(0).padStart(4)} ms`,
    );
    if (inp > TAP_BUDGET_MS.inp) over.push(`${name}: ${inp} ms to the next paint, budget ${TAP_BUDGET_MS.inp}`);
    if (shown < 0 || shown > TAP_BUDGET_MS.shown)
      over.push(`${name}: ${shown} ms to the result, budget ${TAP_BUDGET_MS.shown}`);
  }
  console.log(`Taps on a phone, 4× CPU:\n${rows.join("\n")}`);
  expect(over, "slower than the budget").toEqual([]);
  await clearIdeas(page);
  await context.close();
});

test("capturing, queueing and starting an idea answer quickly on a mid-range phone", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({ baseURL, ...PHONE });
  await installProbe(context);
  const page = await context.newPage();
  await signIn(page);
  await clearIdeas(page);
  const headers = { Origin: origin(page) };
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await page.request.post("/api/items", { headers, data: { id, title: `Idea ${i + 1}`, note: "A quick sketch" } });
  }
  await page.goto("/ideas");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await throttle(page, { network: false });

  const taps: Record<string, TapResult[]> = {};
  const add = (name: string, tap: TapResult) => (taps[name] = [...(taps[name] ?? []), tap]);
  const settle = () => page.waitForTimeout(400);
  const dialog = page.getByRole("dialog");
  for (let run = 0; run < 3; run++) {
    await settle();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "New idea" }).tap();
    const note = dialog.getByRole("textbox", { name: "Note" });
    await note.tap();
    await settle();
    add(
      "capture: type a letter",
      await tapLatency(
        page,
        () => page.keyboard.press("t"),
        `document.querySelector('[role=dialog] textarea')?.value === 't'`,
      ),
    );
    await settle();
    // The sheet takes its time to slide away; what counts is that it starts at once and the idea is saved.
    add(
      "capture: Save idea",
      await tapLatency(page, () => dialog.getByRole("button", { name: "Save idea" }).tap(), "true"),
    );
    await dialog.waitFor({ state: "detached" });
    await page.goto(`/ideas/${ids[run]}`);
    const chip = page.getByRole("button", { name: "Up next", pressed: false });
    await chip.waitFor();
    await settle();
    add(
      "chip: Up next",
      await tapLatency(
        page,
        () => chip.tap(),
        `!!document.querySelector('button[aria-pressed=true]')?.textContent?.includes('Up next')`,
      ),
    );
    await settle();
    add(
      "Start building",
      await tapLatency(
        page,
        () => page.getByRole("button", { name: "Start building" }).tap(),
        `location.pathname.startsWith('/builds/') && !!document.querySelector('textarea, input[type=text]')`,
      ),
    );
    await page
      .getByRole("button", { name: /^(Log|Finish) attempt/ })
      .first()
      .waitFor();
    await page.goto("/ideas");
    await page.locator('main a[href^="/ideas/"]').first().waitFor();
  }
  const rows: string[] = [];
  const over: string[] = [];
  for (const [name, results] of Object.entries(taps)) {
    const inp = median(results.map((r) => r.inp));
    const shown = median(results.map((r) => r.shown));
    rows.push(
      `${name.padEnd(24)} input to paint ${inp.toFixed(0).padStart(4)} ms, tap to result ${shown.toFixed(0).padStart(4)} ms`,
    );
    if (inp > TAP_BUDGET_MS.inp) over.push(`${name}: ${inp} ms to the next paint, budget ${TAP_BUDGET_MS.inp}`);
    if (shown < 0 || shown > TAP_BUDGET_MS.shown)
      over.push(`${name}: ${shown} ms to the result, budget ${TAP_BUDGET_MS.shown}`);
  }
  console.log(`Capture, Up next and Start building on a phone, 4× CPU:\n${rows.join("\n")}`);
  expect(over, "slower than the budget").toEqual([]);
  await clearIdeas(page);
  await context.close();
});

test("the installed app opens from its caches, on a slow phone", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ baseURL, ...PHONE });
  const user = SEED_USERS[0];
  const signedIn = await context.request.post("/api/session", {
    data: { username: user.username, password: SEED_PASSWORD },
    headers: { Origin: new URL(baseURL ?? "").origin },
  });
  expect(signedIn.ok()).toBe(true);
  await installProbe(
    context,
    `document.querySelector('h1')?.textContent === 'Journal' && !document.querySelector('.sg-skeleton')`,
  );
  const first = await context.newPage();
  // The Home Screen icon opens /today, which phones turn into the Journal.
  await first.goto("/today");
  await first.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await first.waitForLoadState("networkidle");
  await first.waitForTimeout(2500);
  await first.close();
  const times: number[] = [];
  for (let run = 0; run < 3; run++) {
    const page = await context.newPage();
    await throttle(page);
    await page.goto("/today", { waitUntil: "commit" });
    await page.waitForFunction(() => window.__perf.ready >= 0, undefined, { timeout: 30_000 });
    times.push(await page.evaluate(() => window.__perf.ready));
    await page.close();
  }
  const resumed = median(times);
  console.log(`Installed app resumed, Journal useful: ${resumed.toFixed(0)} ms (4× CPU, slow 4G)`);
  // About 500 ms on a quiet machine; a first visit with nothing cached takes over 3 s on the same profile.
  expect(resumed, "The Journal on a resumed app").toBeLessThan(1500);
  await context.close();
});

test("the first ⌘K right after a page load opens the palette at once", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  // No service worker and no idle moment: the palette's code comes over the slow network after the press (the head start is the
  // key press itself), and its frame must not wait for the commands.
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 900 },
    serviceWorkers: "block",
  });
  const user = SEED_USERS[0];
  const signedIn = await context.request.post("/api/session", {
    data: { username: user.username, password: SEED_PASSWORD },
    headers: { Origin: new URL(baseURL ?? "").origin },
  });
  expect(signedIn.ok()).toBe(true);
  await installProbe(context);
  const times: number[] = [];
  for (let run = 0; run < 4; run++) {
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.requestIdleCallback = () => 0;
    });
    await throttle(page);
    await page.goto("/today");
    await expect(page.locator("h1").first()).toBeVisible();
    // The shell's key handlers bind just after the first screen; a person's first press is never that close.
    await page.waitForTimeout(300);
    const tap = await tapLatency(page, () => page.keyboard.press("Control+k"), onScreen("[role=dialog] input"));
    times.push(tap.shown);
    if (process.env.PERF_FILES) console.log("palette: search box shown after", tap.shown.toFixed(0), "ms");
    await page.close();
  }
  const opened = median(times);
  console.log(
    `First ⌘K after a load, 4× CPU, slow 4G, nothing cached: the palette's search box shows after ${opened.toFixed(0)} ms`,
  );
  expect(opened, "first ⌘K").toBeGreaterThan(0);
  expect(opened, "first ⌘K").toBeLessThan(MAX_FIRST_PALETTE_MS);
  await context.close();
});
