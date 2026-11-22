import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

/** Whether the persisted query cache (IndexedDB) holds the text. */
const cacheHolds = (page: Page, text: string) =>
  page.evaluate(
    (needle) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("spaghetti-cache");
        open.onerror = () => resolve(false);
        open.onsuccess = () => {
          if (!open.result.objectStoreNames.contains("queries")) return resolve(false);
          const all = open.result.transaction("queries").objectStore("queries").getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result).includes(needle));
        };
      }),
    text,
  );

/** Rewrites what the persisted query cache holds with `edit`, once it holds the build. */
const rewriteCache = (page: Page, title: string, edit: string) =>
  page.evaluate(
    ({ needle, source }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("spaghetti-cache");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("queries", "readwrite").objectStore("queries");
          const get = store.get("client");
          get.onsuccess = () => {
            const stored = get.result;
            if (!JSON.stringify(stored).includes(needle)) return reject(new Error("not cached yet"));
            const change = new Function(`return ${source}`)() as (q: unknown) => void;
            for (const query of stored.client.clientState.queries) change(query.state.data);
            store.put(stored).onsuccess = () => resolve();
          };
        };
      }),
    { needle: title, source: edit },
  );

const shapes = {
  "an outcome the app has no word for": `(data) => {
    const each = (v) => { if (Array.isArray(v)) v.forEach(each); else if (v && typeof v === "object") { if ("outcome" in v && v.outcome) v.outcome = "mystery"; Object.values(v).forEach(each); } };
    each(data);
  }`,
  "an older shape, before printer prints": `(data) => {
    const each = (v) => { if (Array.isArray(v)) v.forEach(each); else if (v && typeof v === "object") { for (const k of ["print", "moved", "fromPrinter", "photoRead", "coach", "reasons"]) delete v[k]; Object.values(v).forEach(each); } };
    each(data);
  }`,
};

for (const [name, edit] of Object.entries(shapes)) {
  test(`@phone a build opens from a saved copy with ${name}`, async ({ page }) => {
    const headers = { Origin: origin(page) };
    const itemId = crypto.randomUUID();
    const attemptId = crypto.randomUUID();
    await page.request.post("/api/items", {
      headers,
      data: { id: itemId, title: "Stale glass markers", stage: "building" },
    });
    await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: { id: attemptId, printedAt: Date.now() - 86_400_000, outcome: "partial" },
    });
    await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), printedAt: Date.now() - 600_000 },
    });

    await page.goto(`/builds/${itemId}?attempt=${attemptId}`);
    await expect(page.getByRole("heading", { name: "Stale glass markers" })).toBeVisible();
    await expect.poll(() => cacheHolds(page, "Stale glass markers")).toBe(true);
    // Edited from another tab once this one is gone, so this one can't save its own copy over the edit.
    const other = await page.context().newPage();
    await other.goto("/printer");
    await page.close();
    await rewriteCache(other, "Stale glass markers", edit);
    page = other;

    // Only the saved copy answers: the network doesn't.
    await page.route(`**/api/items/${itemId}`, (route) => route.abort());
    await page.goto(`/builds/${itemId}?attempt=${attemptId}`);
    await expect(page.getByText("That got tangled")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Stale glass markers" })).toBeVisible();
  });
}

test("@phone a build opens with a queued attempt that has an outcome the app has no word for", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const itemId = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers,
    data: { id: itemId, title: "Queued glass markers", stage: "building" },
  });
  await page.goto(`/builds/${itemId}`);
  await expect(page.getByRole("heading", { name: "Queued glass markers" })).toBeVisible();
  await page.evaluate(
    (item) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("spaghetti", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("outbox", "readwrite");
          tx.objectStore("outbox").put({
            itemId: item,
            photos: [],
            queuedAt: Date.now(),
            attempts: [
              {
                id: crypto.randomUUID(),
                outcome: "mystery",
                printedAt: Date.now(),
                note: "kept words",
                failureTags: [],
                successNotes: [],
                settings: {},
                createdBy: "alex",
                createdAt: Date.now(),
              },
            ],
          });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    itemId,
  );
  await page.route(`**/api/items/${itemId}/attempts`, (route) => route.abort());
  await page.reload();
  await expect(page.getByText("That got tangled")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Queued glass markers" })).toBeVisible();
});

test("@phone the error screen's Copy details says where it broke", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "clipboard permissions are Chromium's");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/styleguide");
  const screen = page.locator("section#error");
  await screen.getByText("Details", { exact: true }).first().click();
  await screen.getByRole("button", { name: "Copy details" }).first().click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Cannot read properties of undefined");
  expect(copied).toMatch(/Version: \S+/);
  expect(copied).toContain("Route: /styleguide");
  expect(copied).toContain("Stack:");
});
