import { expect, type Page, type Route, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * Principle 7 (never lose work), under bad networks: a save whose request or answer is late must neither be undone
 * by an older one nor dropped. Delays are made with page.route on a real server, so the order is the test's, not luck's.
 */
const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

async function makeIdea(page: Page, title: string, stage?: "building") {
  const id = crypto.randomUUID();
  const made = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title, note: "", ...(stage ? { stage } : {}) },
  });
  expect(made.ok()).toBe(true);
  return id;
}

const serverTitle = async (page: Page, id: string) =>
  ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: { title: string | null } }).item.title;

test("two title saves in flight: the first request arriving late doesn't undo the second", async ({ page }) => {
  const id = await makeIdea(page, "Start");
  await page.goto(`/ideas/${id}`);
  const title = page.getByRole("textbox", { name: "Title" });

  // Hold the first PATCH until a second one has been asked for (or a while has passed, for a save that waits its turn).
  const held: Route[] = [];
  let release: () => void = () => undefined;
  const second = new Promise<void>((resolve) => {
    release = resolve;
  });
  let patches = 0;
  await page.route(`**/api/items/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    patches += 1;
    if (patches === 1) {
      held.push(route);
      await Promise.race([second, new Promise((resolve) => setTimeout(resolve, 3000))]);
      return route.continue();
    }
    release();
    return route.continue();
  });

  await title.fill("First");
  await expect.poll(() => held.length).toBe(1);
  await title.fill("Second");
  await expect.poll(() => patches, { timeout: 8000 }).toBeGreaterThanOrEqual(2);
  await expect.poll(() => serverTitle(page, id), { timeout: 10_000 }).toBe("Second");
  // The screen agrees after a reload.
  await page.unroute(`**/api/items/${id}`);
  await page.reload();
  await expect(title).toHaveValue("Second");
});

test("a late answer to the first save doesn't put the old title back in the list", async ({ page }) => {
  const id = await makeIdea(page, "Start");
  await page.goto(`/ideas/${id}`);
  const title = page.getByRole("textbox", { name: "Title" });
  let first = true;
  let gate: () => void = () => undefined;
  const open = new Promise<void>((resolve) => {
    gate = resolve;
  });
  await page.route(`**/api/items/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    if (first) {
      first = false;
      const response = await route.fetch();
      await open;
      return route.fulfill({ response });
    }
    return route.continue();
  });
  await title.fill("First");
  await expect.poll(() => serverTitle(page, id)).toBe("First");
  await title.fill("Second");
  gate();
  await expect.poll(() => serverTitle(page, id)).toBe("Second");
  // The cache (what the inbox shows) keeps the newer title.
  await page.getByRole("link", { name: "Ideas" }).first().click();
  await expect(page.getByText("Second").first()).toBeVisible();
  await expect(page.getByText("First")).toHaveCount(0);
});

test("a title save that fails after leaving the screen is retried, not dropped", async ({ page }) => {
  const id = await makeIdea(page, "Start");
  await page.goto(`/ideas/${id}`);
  let fail = true;
  await page.route(`**/api/items/${id}`, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    if (fail) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    return route.continue();
  });
  await page.getByRole("textbox", { name: "Title" }).fill("Kept");
  // Leave the screen at once (client-side navigation): the save is flushed by the unmount and fails.
  await page.getByRole("link", { name: "Ideas" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  fail = false;
  await expect.poll(() => serverTitle(page, id), { timeout: 15_000 }).toBe("Kept");
});

test("deleting a build and pressing Undo brings back its photos, attempt and comment", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const id = await makeIdea(page, "Whole build", "building");
  const buffer = (await import("node:fs")).readFileSync("e2e/fixtures/tugboat.jpg");
  for (let position = 0; position < 2; position++) {
    await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
      headers,
      multipart: {
        width: "1200",
        height: "900",
        color: "#6b5a4a",
        position: String(position),
        large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
        thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
      },
    });
  }
  await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "failed", note: "Spaghetti at layer 40" },
  });
  await page.request.post(`/api/items/${id}/comments`, {
    headers,
    data: { id: crypto.randomUUID(), body: "Try a brim" },
  });

  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Delete build" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/items/${id}`);
      if (!response.ok()) return null;
      const { item } = await response.json();
      const comments = await (await page.request.get(`/api/items/${id}/comments`)).json();
      return [item.photos.length, item.attempts.length, item.attempts[0]?.note, comments.comments.length];
    })
    .toEqual([2, 1, "Spaghetti at layer 40", 1]);
});

test("words typed while the connection is down come back after the page is killed and reopened", async ({ page }) => {
  const id = await makeIdea(page, "Start");
  await page.goto(`/ideas/${id}`);
  let down = true;
  let refused = 0;
  await page.route(`**/api/items/${id}`, (route) => {
    if (route.request().method() !== "PATCH" || !down) return route.continue();
    refused += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.getByRole("textbox", { name: "Note" }).fill("Typed with no signal");
  await expect.poll(() => refused).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText("Typed with no signal")).toBeVisible();
  // Back online: the restored words are saved.
  down = false;
  await expect
    .poll(
      async () => ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: { note: string } }).item.note,
      {
        timeout: 15_000,
      },
    )
    .toBe("Typed with no signal");
});

test("a photo picked in the capture sheet is still there after a reload", async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img")).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const open = indexedDB.open("spaghetti-capture", 1);
            open.onerror = () => resolve(0);
            open.onsuccess = () => {
              const db = open.result;
              if (!db.objectStoreNames.contains("photos")) return resolve(0);
              const count = db.transaction("photos").objectStore("photos").count();
              count.onsuccess = () => resolve(count.result);
            };
          }),
      ),
    )
    .toBe(1);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  const again = page.getByRole("dialog", { name: "New idea" });
  await expect(async () => {
    if (!(await again.isVisible())) {
      if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
      else await page.keyboard.press("c");
    }
    await expect(again.getByRole("img")).toHaveCount(1, { timeout: 1500 });
  }).toPass();
});

test("a comment whose send failed is back in the box after a reload", async ({ page }) => {
  const id = await makeIdea(page, "Talk");
  await page.goto(`/ideas/${id}`);
  let refused = 0;
  await page.route(`**/api/items/${id}/comments`, (route) => {
    if (route.request().method() !== "POST") return route.continue();
    refused += 1;
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  const field = page.getByRole("textbox", { name: /Say something to/ });
  await field.fill("Don't lose me");
  await field.press("Enter");
  await expect.poll(() => refused).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("textbox", { name: /Say something to/ })).toHaveValue("Don't lose me");
});
