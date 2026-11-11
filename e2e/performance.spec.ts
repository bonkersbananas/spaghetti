import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

/**
 * Performance on the production build (the "built" projects): how much
 * JavaScript each screen loads first, and whether an inbox of a hundred
 * photo ideas scrolls smoothly on a mid-range phone (4× CPU throttling).
 * A heavy import that slips into the first load fails here rather than on
 * a phone.
 */

const origin = (page: Page) => new URL(page.url()).origin;

/**
 * First-load JavaScript per screen, gzip, in kB: today's sizes plus about
 * 5 kB, so work in flight has room (it should still load what's rarely used on demand). PERF_FILES=1 prints each screen's files with their gzip sizes. Most of it is React, the router, TanStack Query, sheets (vaul and
 * Radix), toasts and motion, which every screen needs at once.
 */
// Recipes added about 1 kB of shared code to every screen (cache roots, change feed, an icon); its sheet and shelves load on demand, and search draws recipe results (about 4 kB).
const BUDGET_KB = {
  "/sign-in": 214,
  // Today pulls in the journal rows, the print card, the printer strip and the Up next row on top of what Ideas needs.
  "/today": 319,
  // The desktop account menu (its popover) and the change-password sheet load on demand, and no route checks its
  // search with zod (route checks load with the app): together about 35 kB gzip off every screen. Printer upkeep (#39) added about 3 kB to Today, Pantry and Printer.
  // Parts (#197) added about 1 kB: the part names that go with an attempt ("attempt 3 · Hull half") and the counting rules are shared. The editor loads on demand.
  "/ideas": 310,
  "/builds": 310,
  "/journal": 311,
  // Recently deleted adds a palette row and a menu item to the shell (its page loads on demand): about 0.5 kB.
  "/search": 316,
  "/pantry": 320,
  "/printer": 319,
} as const;

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
    files: [...bodies.keys()],
    zod: first.some(([, body]) => body.includes("ZodError")),
    raw: kb(first.reduce((sum, [, body]) => sum + body.length, 0)),
    gzip: kb(first.reduce((sum, [, body]) => sum + gzipSync(body).length, 0)),
  };
}

test("each screen's first load stays within its JavaScript budget, without the rarely used parts", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const rows: string[] = [];
  const over: string[] = [];
  for (const [path, budget] of Object.entries(BUDGET_KB)) {
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
    rows.push(`${path.padEnd(10)} ${raw.toFixed(0).padStart(5)} kB  ${gzip.toFixed(0).padStart(4)} kB gzip`);
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
    over.push(...(gzip > budget ? [`${path}: ${gzip.toFixed(0)} kB gzip, budget ${budget} kB`] : []));
    await context.close();
  }
  console.log(`First-load JavaScript per screen:\n${rows.join("\n")}`);
  expect(over, "over budget").toEqual([]);
});

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
