import { readFileSync } from "node:fs";
import { expect, type Page, request, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

// These run against the production build (the dev server has no service worker).

async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const serverIdeas = async (page: Page) => (await (await page.request.get("/api/items")).json()).items;

test.afterEach(async ({ page, context }) => {
  await context.setOffline(false);
  await clearIdeas(page);
});

test("opens with no connection after a first visit, and a capture made offline lands when it's back", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();
  // The app opens, still signed in, and says once that it is offline.
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  const notice = page.getByRole("status").filter({ hasText: "Offline" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("heading", { name: "The pot is out of reach" })).toBeVisible();

  // Capture, in an app that was opened offline.
  await page.getByRole("button", { name: "New idea" }).click();
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await sheet.getByRole("textbox", { name: "Note" }).fill("Spool holder, drawn at the printer");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
  await expect(notice).toContainText("1 capture is waiting");
  expect(await serverIdeas(page)).toHaveLength(0);

  // Connection back: it goes up by itself.
  await context.setOffline(false);
  await expect.poll(async () => (await serverIdeas(page)).length).toBe(1);
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
});

test("never serves the API from a cache, but keeps photos already seen", async ({ page, context }) => {
  await signIn(page);
  await waitForServiceWorker(page);

  await page.getByRole("button", { name: "New idea" }).click();
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await sheet.getByRole("textbox", { name: "Note" }).fill("Bath tugboat");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await expect.poll(async () => (await serverIdeas(page))[0]?.photos.length ?? 0).toBe(1);
  const [{ id: photoId }] = (await serverIdeas(page))[0].photos;

  // Seen once, as a person looks at it.
  await page.reload();
  await expect(page.getByRole("img", { name: "Photo: Bath tugboat" })).toBeVisible();
  await page.evaluate((id) => fetch(`/api/photos/${id}/thumb`).then((r) => r.blob()), photoId);

  await context.setOffline(true);
  const [photo, items] = await page.evaluate(async (id) => {
    const status = async (url: string) => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return "unreachable";
      }
    };
    return [await status(`/api/photos/${id}/thumb`), await status("/api/items")];
  }, photoId);
  expect(photo).toBe(true);
  expect(items).toBe("unreachable");
});

/** Whether the persisted query cache (IndexedDB) holds the text, or anything at all when none is given. */
const cacheHolds = (page: Page, text?: string) =>
  page.evaluate(
    (needle) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("spaghetti-cache");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains("queries")) return resolve(false);
          const all = db.transaction("queries").objectStore("queries").getAll();
          all.onsuccess = () => resolve(needle ? JSON.stringify(all.result).includes(needle) : all.result.length > 0);
          all.onerror = () => resolve(false);
        };
      }),
    text,
  );

test("shows a build and the inbox as last seen with no connection, read-only, and sign-out forgets them", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const headers = { Origin: new URL(page.url()).origin };

  // A build with two attempts, and an idea, as the other person might have left them.
  const buildId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Cable chain", stage: "building" } });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "failed", note: "Let go of the bed at 40%", settings: { bedTemp: 55 } },
  });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: "success",
      note: "Brim and a hotter bed did it",
      settings: { bedTemp: 60 },
    },
  });
  await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title: "Spool holder" } });

  // Looked at once, online.
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
  // The saved copy is written about a second after the data arrives: leaving the page sooner loses the inbox.
  await expect.poll(() => cacheHolds(page, "Spool holder")).toBe(true);
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  const attempts = page.getByRole("list", { name: "Attempts, newest first" });
  await expect(attempts.getByRole("listitem")).toHaveCount(2);
  await expect.poll(() => cacheHolds(page, "Brim and a hotter bed did it")).toBe(true);
  // The journal, looked at once online (its last results are kept like the rest).
  await page.goto("/journal");
  await expect(page.getByText("Brim and a hotter bed did it").first()).toBeVisible();
  await expect.poll(() => cacheHolds(page, '"journal"')).toBe(true);
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  // Nothing in the notice while the connection is there.
  await expect(page.getByRole("status").filter({ hasText: "Showing what you saw" })).toHaveCount(0);

  // Reloaded with no signal, as next to the printer.
  await context.setOffline(true);
  await page.reload();
  const notice = page.getByRole("status").filter({ hasText: "Offline" });
  await expect(notice).toContainText("Showing what you saw");
  await expect(notice).toContainText("read-only");
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await expect(attempts.getByRole("listitem")).toHaveCount(2);
  await expect(attempts).toContainText("Brim and a hotter bed did it");
  await expect(page.getByText("What worked · attempt 2")).toBeVisible();
  // Saved fields don't pretend to save.
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveJSProperty("readOnly", true);
  await expect(page.getByRole("button", { name: "Finish build" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^(Delete|Scrap) build$/ })).toBeDisabled();
  // Logging an attempt still works.
  await expect(page.getByRole("button", { name: "Log attempt" })).toBeEnabled();

  // Reloaded offline again: the failed refetch must not have wiped what was kept.
  // (The refetch retries once after a second, and the copy is written at most once a second.)
  await page.waitForTimeout(3500);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await expect(attempts.getByRole("listitem")).toHaveCount(2);
  await expect(notice).toContainText("Showing what you saw");

  // The inbox, opened offline from the same visit.
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
  await expect(notice).toContainText("Showing what you saw");

  // The journal, from what was last seen.
  await page.goto("/journal");
  await expect(page.getByText("Brim and a hotter bed did it").first()).toBeVisible();
  await expect(notice).toContainText("Showing what you saw");

  // The connection is back; the other person has renamed the build meanwhile. The marker goes, and the server's title replaces what was kept.
  await context.setOffline(false);
  await page.request.patch(`/api/items/${buildId}`, { headers, data: { title: "Cable chain v2" } });
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain v2");
  await expect(notice).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveJSProperty("readOnly", false);

  // Signing out forgets all of it (after clearing the test's data, which needs the session).
  await clearIdeas(page);
  await page.goto("/ideas");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect.poll(() => cacheHolds(page)).toBe(false);
  await context.setOffline(true);
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Spaghetti" })).toBeVisible();
});

const tugboat = readFileSync("e2e/fixtures/tugboat.jpg");

/** Puts a photo on an item (or one of its attempts) through the API, as the app's own upload does. */
async function addPhoto(page: Page, itemId: string, attemptId?: string) {
  const id = crypto.randomUUID();
  const file = (name: string) => ({ name, mimeType: "image/jpeg", buffer: tugboat });
  const response = await page.request.put(`/api/items/${itemId}/photos/${id}`, {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      width: "1200",
      height: "800",
      color: "#c07040",
      ...(attemptId ? { attemptId } : {}),
      large: file("large"),
      thumb: file("thumb"),
    },
  });
  expect(response.ok()).toBe(true);
  return id;
}

const cachedPhotos = (page: Page) =>
  page.evaluate(async () =>
    (await (await caches.open("sg-photos")).keys()).map((request) => new URL(request.url).pathname),
  );

/** Every picture in the main area has loaded (none is a flat color block). */
const picturesLoaded = (page: Page) =>
  page.evaluate(() => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("main img"));
    return images.length > 0 && images.every((img) => img.complete && img.naturalWidth > 0);
  });

test("photos seen online, and the thumbnails below the fold, show with no connection on the inbox, builds and a build", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const headers = { Origin: new URL(page.url()).origin };

  // Forty ideas with a photo each (the last ones are far below the fold on a phone), and a build with photos.
  const ideaPhotos: string[] = [];
  for (let n = 0; n < 40; n++) {
    const id = crypto.randomUUID();
    await page.request.post("/api/items", { headers, data: { id, title: `Idea ${n}` } });
    ideaPhotos.push(await addPhoto(page, id));
  }
  const buildId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Tugboat", stage: "building" } });
  const cover = await addPhoto(page, buildId);
  const attemptId = crypto.randomUUID();
  await page.request.post(`/api/items/${buildId}/attempts`, { headers, data: { id: attemptId, outcome: "success" } });
  const attemptPhoto = await addPhoto(page, buildId, attemptId);

  // Only looked at as lists and one build page; nothing scrolled.
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link")).toHaveCount(40);
  // The prefetch runs in the background of this page, so it is left to finish before moving on.
  const missing = async (paths: string[]) => {
    const have = new Set(await cachedPhotos(page));
    return paths.filter((path) => !have.has(path));
  };
  await expect.poll(() => missing(ideaPhotos.map((id) => `/api/photos/${id}/thumb`))).toEqual([]);
  await page.goto("/builds");
  await expect(page.getByRole("link", { name: /Tugboat/ }).first()).toBeVisible();
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tugboat");
  await expect.poll(() => picturesLoaded(page)).toBe(true);
  // The prefetch has fetched the cover and the attempt's large photo too.
  await expect
    .poll(() =>
      missing([`/api/photos/${cover}/thumb`, `/api/photos/${cover}/large`, `/api/photos/${attemptPhoto}/large`]),
    )
    .toEqual([]);

  await context.setOffline(true);
  await page.goto("/ideas");
  await expect(page.getByRole("status").filter({ hasText: "Showing what you saw" })).toBeVisible();
  const last = page.getByRole("list", { name: "Ideas" }).getByRole("link").last();
  await last.scrollIntoViewIfNeeded();
  await expect.poll(() => picturesLoaded(page)).toBe(true);
  await page.reload();
  await page.getByRole("list", { name: "Ideas" }).getByRole("link").last().scrollIntoViewIfNeeded();
  await expect.poll(() => picturesLoaded(page)).toBe(true);

  await page.goto("/builds");
  await expect(page.getByRole("link", { name: /Tugboat/ }).first()).toBeVisible();
  await expect.poll(() => picturesLoaded(page)).toBe(true);

  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tugboat");
  await expect.poll(() => picturesLoaded(page)).toBe(true);
});

/** A build whose attempt 1 failed and attempt 2 is still printing, opened online and then read with no signal. */
async function printingBuild(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  const buildId = crypto.randomUUID();
  const printing = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Cable chain", stage: "building" } });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "failed", note: "Let go of the bed", printedAt: Date.now() - 3_600_000 },
  });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: { id: printing, outcome: null, note: "Brim on" },
  });
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("list", { name: "Attempts, newest first" }).getByRole("listitem")).toHaveCount(2);
  await expect.poll(() => cacheHolds(page, "Brim on")).toBe(true);
  return { buildId, printing, headers };
}

const serverAttempt = async (page: Page, buildId: string, id: string) =>
  (await (await page.request.get(`/api/items/${buildId}`)).json()).item.attempts.find(
    (a: { id: string }) => a.id === id,
  );

test("finishes a print that is printing with no signal: outcome, note and photo wait in the outbox and go up when it's back", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const { buildId, printing } = await printingBuild(page);

  await context.setOffline(true);
  await page.reload();
  const notice = page.getByRole("status").filter({ hasText: "Offline" });
  await expect(notice).toContainText("Showing what you saw");
  // The main action is there, not greyed out.
  const finish = page.getByRole("button", { name: "Finish attempt 2" });
  await expect(finish).toBeEnabled();
  await finish.click();
  const sheet = page.getByRole("dialog", { name: "Finish attempt 2" });
  await sheet.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Attempt photo 1" })).toBeVisible();
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("textbox", { name: "Note" }).press("End");
  await sheet.getByRole("textbox", { name: "Note" }).pressSequentially(" and a hotter bed");
  // What isn't about finishing stays read-only.
  await expect(sheet.getByRole("button", { name: "Delete" })).toBeDisabled();
  await sheet.getByRole("button", { name: "Finish attempt" }).click();
  await expect(sheet).toBeHidden();

  // It shows as finished at once, and the strip says it is waiting.
  const story = page.getByRole("list", { name: "Attempts, newest first" });
  await expect(story.getByRole("listitem").first()).toContainText("Brim on · and a hotter bed");
  await expect(story.getByRole("listitem").first()).toContainText("Worked");
  await expect(notice).toContainText("1 finished print is waiting");
  expect((await serverAttempt(page, buildId, printing)).outcome).toBeNull();

  // Back online: it lands, with its photo.
  await context.setOffline(false);
  await expect.poll(async () => (await serverAttempt(page, buildId, printing)).outcome).toBe("success");
  const landed = await serverAttempt(page, buildId, printing);
  expect(landed.note).toBe("Brim on · and a hotter bed");
  expect(landed.finishedBy).toBeTruthy();
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${buildId}`)).json();
      return item.photos.filter((p: { attemptId: string }) => p.attemptId === printing).length;
    })
    .toBe(1);
  await expect(notice).toBeHidden();
});

test("a finish queued offline keeps the other person's outcome, adds the photo and note, and says so", async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const { buildId, printing } = await printingBuild(page);

  await context.setOffline(true);
  await page.reload();
  await page.getByRole("button", { name: "Finish attempt 2" }).click();
  const sheet = page.getByRole("dialog", { name: "Finish attempt 2" });
  await sheet.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Attempt photo 1" })).toBeVisible();
  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await sheet.getByRole("textbox", { name: "Note" }).press("End");
  await sheet.getByRole("textbox", { name: "Note" }).pressSequentially(" then it let go");
  await sheet.getByRole("button", { name: "Finish attempt" }).click();
  await expect(sheet).toBeHidden();

  // Meanwhile Sam finishes it from the other phone.
  const sam = await request.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL ?? "" } });
  expect(
    (await sam.post("/api/session", { data: { username: SEED_USERS[1].username, password: SEED_PASSWORD } })).ok(),
  ).toBe(true);
  expect((await sam.patch(`/api/attempts/${printing}`, { data: { outcome: "success" } })).ok()).toBe(true);
  await sam.dispose();

  await context.setOffline(false);
  await expect(page.getByText("Sam Okafor had already finished attempt 2")).toBeVisible();
  await expect(page.getByText("Your photo and note were added.")).toBeVisible();
  await expect.poll(async () => (await serverAttempt(page, buildId, printing)).note).toBe("Brim on · then it let go");
  const landed = await serverAttempt(page, buildId, printing);
  expect(landed.outcome).toBe("success");
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${buildId}`)).json();
      return item.photos.filter((p: { attemptId: string }) => p.attemptId === printing).length;
    })
    .toBe(1);
});

test("is installable: manifests for both themes, maskable icons, and a worker that precaches the shell", async ({
  page,
}) => {
  await page.goto("/sign-in");
  for (const [file, color] of [
    ["manifest.webmanifest", "#f6f1e8"],
    ["manifest-dark.webmanifest", "#1b1714"],
  ] as const) {
    const manifest = await (await page.request.get(`/${file}`)).json();
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/today", theme_color: color });
    expect(manifest.background_color).toBe(color);
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain("maskable");
    for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  }
  const worker = await (await page.request.get("/sw.js")).text();
  expect(worker).toContain("__BUILD__");
  expect(worker).toContain("/manifest.webmanifest");
  expect(worker).toMatch(/\/assets\/index-[\w-]+\.js/);
  expect(worker).toMatch(/\.woff2/);
});

test("shows the pantry as last seen with no connection, read-only", async ({ page, context }) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const headers = { Origin: new URL(page.url()).origin };
  const spoolId = crypto.randomUUID();
  await page.request.post("/api/spools", {
    headers,
    data: { id: spoolId, material: "PLA", colorName: "Jade white", colorHex: "#f4f1ea" },
  });
  try {
    // Looked at once, online.
    await page.goto(`/pantry/${spoolId}`);
    await expect(page.getByRole("button", { name: "Take out of the pantry" })).toBeEnabled();
    await page.goto("/pantry");
    await expect(page.getByRole("link", { name: /Jade white PLA/ })).toBeVisible();
    await expect.poll(() => cacheHolds(page, "Jade white")).toBe(true);

    // Reloaded with no signal: the pantry is there to read, not to change.
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("link", { name: /Jade white PLA/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add spool" }).filter({ visible: true }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: /^A1 Empty/ })).toBeDisabled();
    await page.getByRole("link", { name: /Jade white PLA/ }).click();
    await expect(page.getByRole("button", { name: "Take out of the pantry" })).toBeDisabled();
    await expect(page.getByRole("radio", { name: "Half" })).toBeDisabled();

    await context.setOffline(false);
    await expect(page.getByRole("button", { name: "Take out of the pantry" })).toBeEnabled();
  } finally {
    await context.setOffline(false);
    await page.request.delete(`/api/spools/${spoolId}`, { headers });
  }
});

test("Today opens with no connection from what was last seen, and a print can still be finished", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  const headers = { Origin: new URL(page.url()).origin };
  const buildId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Bath tugboat", stage: "building" } });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: null,
      printedAt: Date.now() - 20 * 60_000,
      settings: { estimatedMinutes: 120 },
    },
  });

  // Looked at once, online: its queries are kept on the device.
  await page.goto("/today");
  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  await expect.poll(() => cacheHolds(page, "Bath tugboat")).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Offline" })).toContainText("Showing what you saw");
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  // Finishing goes through the outbox, so it is still possible next to the printer.
  await bed.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("dialog", { name: "Finish attempt 1" })).toBeVisible();
});
