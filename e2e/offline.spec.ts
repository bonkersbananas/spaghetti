import { expect, type Page, test } from "@playwright/test";
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
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  const attempts = page.getByRole("list", { name: "Attempts, newest first" });
  await expect(attempts.getByRole("listitem")).toHaveCount(2);
  await expect.poll(() => cacheHolds(page, "Brim and a hotter bed did it")).toBe(true);
  await expect.poll(() => cacheHolds(page, "Spool holder")).toBe(true);
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
  await expect(page.getByRole("button", { name: "Delete build" })).toBeDisabled();
  // Logging an attempt still works.
  await expect(page.getByRole("button", { name: "Log attempt" })).toBeEnabled();

  // The inbox, opened offline from the same visit.
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
  await expect(notice).toContainText("Showing what you saw");

  // The connection is back; the other person has renamed the build meanwhile. The marker goes, and the server's title replaces what was kept.
  await context.setOffline(false);
  await page.request.patch(`/api/items/${buildId}`, { headers, data: { title: "Cable chain v2" } });
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain v2");
  await expect(notice).toBeHidden();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveJSProperty("readOnly", false);

  // Signing out forgets all of it.
  await page.goto("/ideas");
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect.poll(() => cacheHolds(page)).toBe(false);
  await context.setOffline(true);
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Spaghetti" })).toBeVisible();
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
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/ideas", theme_color: color });
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
