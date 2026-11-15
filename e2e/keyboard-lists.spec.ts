import { expect, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "J and K are a desktop thing");

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("J and K walk the cards on Ideas, Enter opens one", async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const title of ["Third", "Second", "First"]) {
    await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title } });
  }
  await page.goto("/ideas");
  const cards = page.getByRole("list", { name: "Ideas" }).getByRole("link");
  await expect(cards).toHaveCount(3);

  await page.keyboard.press("j");
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(cards.nth(0)).toBeFocused();
  // The ends hold: no wrapping around.
  await page.keyboard.press("k");
  await expect(cards.nth(0)).toBeFocused();

  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ideas\/[0-9a-f-]+$/);
});

test("J and K walk Up next first, then the inbox", async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  const queued = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: queued, title: "Queued" } });
  await page.request.patch(`/api/items/${queued}`, { headers, data: { upNext: true } });
  await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title: "Inbox" } });
  await page.goto("/ideas");
  const strip = page.getByRole("list", { name: "Up next" }).getByRole("link");
  const inbox = page.getByRole("list", { name: "Ideas" }).getByRole("link");
  await expect(inbox).toHaveCount(1);
  await page.keyboard.press("j");
  await expect(strip.first()).toBeFocused();
  await page.keyboard.press("j");
  await expect(inbox.first()).toBeFocused();
  await page.keyboard.press("k");
  await expect(strip.first()).toBeFocused();
});

test("U queues the idea you're on, [ and ] reorder the queue, J and K walk ideas on an idea's page", async ({
  page,
}) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const title of ["Third", "Second", "First"]) {
    await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title } });
  }
  await page.goto("/ideas");
  const strip = page.getByRole("list", { name: "Up next" }).getByRole("link");
  const inbox = page.getByRole("list", { name: "Ideas" }).getByRole("link");
  await expect(inbox).toHaveCount(3);

  // Queue the second card, then the first: the queue is Second, First.
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("u");
  await expect(strip).toHaveCount(1);
  await expect(inbox).toHaveCount(2);
  await page.keyboard.press("j");
  await expect(inbox.first()).toBeFocused();
  await page.keyboard.press("u");
  await expect(strip).toHaveCount(2);
  // The card keeps the focus where it landed, and "[" moves it ahead of the other.
  await expect(strip.nth(1)).toBeFocused();
  await page.keyboard.press("[");
  await expect(strip.nth(0)).toBeFocused();

  // On an idea's page J goes to the next idea in the same order, K back, U takes it off the queue.
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ideas\/[0-9a-f-]+$/);
  const first = page.url();
  await page.keyboard.press("j");
  await expect(page).not.toHaveURL(first);
  await page.keyboard.press("k");
  await expect(page).toHaveURL(first);
  await page.keyboard.press("u");
  await expect(page.getByRole("button", { name: "Up next" })).toHaveAttribute("aria-pressed", "false");
});

test("J and K also walk Today's cards", async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Today's build" } });
  await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  const first = page.locator("main [data-picks] a[href]").first();
  // The build's card arrives after the heading: a J before it has nothing to walk to.
  await expect(first).toBeVisible();
  await page.keyboard.press("j");
  await expect(first).toBeFocused();
});

test("G J still goes to the journal from a list where J walks the cards", async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title: "Any idea" } });
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link")).toHaveCount(1);
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/journal$/);
  // And on its own, J still walks.
  await page.goto("/ideas");
  const card = page.getByRole("list", { name: "Ideas" }).getByRole("link").first();
  await expect(card).toBeVisible();
  await page.keyboard.press("j");
  await expect(card).toBeFocused();
});
