import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// Pull down at the top of an idea (or build) page on a phone to go back. Real touch events through CDP.

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "Pulling down to go back is a phone gesture");
  await signIn(page);
});

test.afterEach(async ({ page, isMobile }) => {
  if (!isMobile) return;
  const origin = new URL(page.url()).origin;
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
});

const origin = (page: Page) => new URL(page.url()).origin;

async function addIdea(page: Page, title: string, photos = 0, note = "") {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title, note } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  for (let position = 0; position < photos; position++) {
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
  return id;
}

/** A touch that goes from (x, y) by (dx, dy) in small steps, stopping short of letting go if asked. */
async function drag(page: Page, from: { x: number; y: number }, by: { dx?: number; dy?: number }, release = true) {
  const session = await page.context().newCDPSession(page);
  const at = (x: number, y: number) => [{ x, y, id: 1 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(from.x, from.y) });
  const steps = 12;
  for (let step = 1; step <= steps; step++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: at(from.x + ((by.dx ?? 0) * step) / steps, from.y + ((by.dy ?? 0) * step) / steps),
    });
    await page.waitForTimeout(16);
  }
  if (release) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return session;
}

const LONG = "A longer note, so the page scrolls. ".repeat(60);

test("a pull past the threshold goes back to Ideas, with the same card in view", { tag: "@phone" }, async ({
  page,
}) => {
  const target = await addIdea(page, "Pulled pasta rack", 1);
  for (let n = 0; n < 12; n++) await addIdea(page, `Filler ${n}`);
  await page.goto("/ideas");
  const card = page.getByRole("link", { name: /Pulled pasta rack/ });
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200));
  await page.waitForTimeout(300);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${target}$`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Pulled pasta rack");
  await drag(page, { x: 195, y: 250 }, { dy: 200 });
  await expect(page).toHaveURL(/\/ideas$/);
  await expect(card).toBeInViewport();
});

test("a short pull springs back and stays", { tag: "@phone" }, async ({ page }) => {
  const id = await addIdea(page, "Short pull", 1);
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  const session = await drag(page, { x: 195, y: 250 }, { dy: 50 }, false);
  // Mid-pull the hint is up, not yet asking for a release.
  await expect(page.locator("[data-pull-hint=pulling]")).toBeAttached();
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(700);
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  const top = await page.getByRole("textbox", { name: "Title" }).boundingBox();
  expect(top).not.toBeNull();
  await expect(page.locator("[data-pull-hint]")).toHaveCount(0);
});

test("the same pull when scrolled down just scrolls", { tag: "@phone" }, async ({ page }) => {
  const id = await addIdea(page, "Scrolled", 1, LONG);
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForTimeout(200);
  await drag(page, { x: 195, y: 500 }, { dy: 200 });
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(400);
});

test("a sideways swipe on the photos still changes the photo", { tag: "@phone" }, async ({ page }) => {
  const id = await addIdea(page, "Two photos", 2);
  await page.goto(`/ideas/${id}`);
  const viewer = page.getByRole("region", { name: "Photos" });
  await expect(viewer.getByRole("figure", { name: "1 of 2" })).toBeVisible();
  const box = await viewer.boundingBox();
  if (!box) throw new Error("No photos");
  await drag(page, { x: 330, y: box.y + box.height / 2 }, { dx: -250, dy: 10 });
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  await expect.poll(() => viewer.locator("div.overflow-x-auto").evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
});

test("a pull goes back to the page it came from, and says so", { tag: "@phone" }, async ({ page }) => {
  await addIdea(page, "Searchable tugboat", 1);
  await page.goto("/search");
  await page.getByRole("searchbox").fill("Searchable");
  await page
    .getByRole("link", { name: /Searchable tugboat/ })
    .first()
    .click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Searchable tugboat");
  const session = await drag(page, { x: 195, y: 250 }, { dy: 200 }, false);
  await expect(page.locator("[data-pull-hint=ready]")).toContainText("Release for Search");
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page).toHaveURL(/\/search/);
});

test("with nothing before it in the app, a pull goes to Ideas", { tag: "@phone" }, async ({ page }) => {
  const id = await addIdea(page, "Deep link", 1);
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Deep link");
  const session = await drag(page, { x: 195, y: 250 }, { dy: 200 }, false);
  await expect(page.locator("[data-pull-hint=ready]")).toContainText("Release for Ideas");
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page).toHaveURL(/\/ideas$/);
});
