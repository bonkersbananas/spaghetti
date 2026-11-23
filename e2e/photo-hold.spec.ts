import { readFileSync } from "node:fs";
import { type CDPSession, expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// On a phone a hold on a photo in the strip lifts it (as iOS Photos and the Home Screen do): moving the finger then
// takes it to a new place, and letting go where it was opens its Make cover / Remove menu. A swipe without the hold
// scrolls the strip, wherever it starts. Real touches through CDP.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const ids: string[] = [];
test.afterEach(async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of ids.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
});

async function addIdea(page: Page, title: string, photos: number) {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  ids.push(id);
  await page.request.post("/api/items", { headers, data: { id, title, note: "" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const photoIds: string[] = [];
  for (let position = 0; position < photos; position++) {
    const photoId = crypto.randomUUID();
    photoIds.push(photoId);
    await page.request.put(`/api/items/${id}/photos/${photoId}`, {
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
  return { id, photoIds };
}

/** The ids of an item's own photos, in the server's order. */
async function photoOrder(page: Page, id: string): Promise<string[]> {
  const { item } = (await (await page.request.get(`/api/items/${id}`)).json()) as {
    item: { photos: { id: string; attemptId: string | null }[] };
  };
  return item.photos.filter((photo) => !photo.attemptId).map((photo) => photo.id);
}

/** Opens the idea and waits until its strip can be dragged (that joins after the first paint) and motion is still. */
async function openStrip(page: Page, id: string) {
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
  await expect(page.locator("ul[data-movable] li").first()).toBeVisible();
  await page.waitForTimeout(400);
}

async function centre(page: Page, name: string) {
  const box = await page.getByRole("button", { name, exact: true }).boundingBox();
  if (!box) throw new Error(`No ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function touch(session: CDPSession, type: "touchStart" | "touchMove", x: number, y: number) {
  await session.send("Input.dispatchTouchEvent", { type, touchPoints: [{ x, y, id: 1 }] });
}

/** The lifted look: the item holding the thumbnail is scaled up. (By its label: a modal sheet hides it from roles.) */
async function scaleOf(page: Page, name: string) {
  return page
    .locator(`button[aria-label="${name}"]`)
    .evaluate((button) => new DOMMatrix(getComputedStyle(button.closest("li") as Element).transform).a);
}

for (const when of ["after the hold", "a moment after it lifts"] as const) {
  test(`a held photo follows the finger to a new place (moving ${when})`, { tag: "@phone" }, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "A finger's hold");
    const { id, photoIds } = await addIdea(page, `Hold and move ${when}`, 3);
    await openStrip(page, id);
    const from = await centre(page, "Photo 1, the cover");
    const next = await centre(page, "Photo 2");
    const session = await page.context().newCDPSession(page);

    await touch(session, "touchStart", from.x, from.y);
    await page.waitForTimeout(when === "after the hold" ? 600 : 560);
    if (when === "after the hold") {
      // Lifted, and no menu while the finger is still down.
      await expect.poll(() => scaleOf(page, "Photo 1, the cover")).toBeGreaterThan(1.02);
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    // A little way down first, as a thumb does, then along to the next place.
    const distance = next.x - from.x + 12;
    await touch(session, "touchMove", from.x + 2, from.y + 6);
    for (let step = 1; step <= 12; step++) {
      await touch(session, "touchMove", from.x + 2 + (distance * step) / 12, from.y + 10);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(when === "after the hold" ? 100 : 400);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

    await expect.poll(() => photoOrder(page, id)).toEqual([photoIds[1], photoIds[0], photoIds[2]]);
    await expect(page.getByRole("button", { name: "Photo 2" })).toHaveAttribute("aria-current", "true");
    // Letting go after a move opens nothing, and the page didn't go back.
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/ideas/${id}`));
  });
}

test("a sideways swipe that starts on a photo scrolls the strip, and nothing moves", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "A finger's swipe");
  const { id, photoIds } = await addIdea(page, "Swipe the strip", 8);
  await openStrip(page, id);
  const strip = page.locator("ul[data-movable]").locator("..");
  const before = await strip.evaluate((element) => element.scrollLeft);
  const from = await centre(page, "Photo 2");
  const session = await page.context().newCDPSession(page);

  // A quick swipe to the left, as a thumb flicks: no hold first.
  await touch(session, "touchStart", from.x, from.y);
  for (let step = 1; step <= 10; step++) {
    await touch(session, "touchMove", from.x - step * 20, from.y + 2);
    await page.waitForTimeout(16);
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 60);
  await page.waitForTimeout(500);
  expect(await scaleOf(page, "Photo 2")).toBeCloseTo(1, 2);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await photoOrder(page, id)).toEqual(photoIds);
  // The swipe wasn't a tap either: the first photo is still the one showing.
  await expect(page.locator('button[aria-label="Photo 1, the cover"]')).toHaveAttribute("aria-current", "true");
});

test("a hold let go without moving opens the photo's menu, and nothing moves", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "A finger's hold");
  const { id, photoIds } = await addIdea(page, "Hold and let go", 3);
  await openStrip(page, id);
  const at = await centre(page, "Photo 2");
  const session = await page.context().newCDPSession(page);

  await touch(session, "touchStart", at.x, at.y);
  await page.waitForTimeout(600);
  await expect.poll(() => scaleOf(page, "Photo 2")).toBeGreaterThan(1.02);
  await touch(session, "touchMove", at.x + 2, at.y + 1);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  const sheet = page.getByRole("dialog", { name: "Photo 2 of 3" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Make cover" })).toBeVisible();
  // The lifting finger didn't also tap, and the photo settled back.
  await page.waitForTimeout(400);
  await expect(sheet).toBeVisible();
  await expect.poll(() => scaleOf(page, "Photo 2")).toBeCloseTo(1, 2);
  expect(await photoOrder(page, id)).toEqual(photoIds);
});

test("a quick tap still shows a photo, and a second tap on it opens its menu", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "A finger's hold");
  const { id, photoIds } = await addIdea(page, "Tap, tap", 2);
  await openStrip(page, id);
  const second = page.getByRole("button", { name: "Photo 2", exact: true });
  await second.tap();
  await expect(second).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await second.tap();
  await expect(page.getByRole("dialog", { name: "Photo 2 of 2" })).toBeVisible();
  expect(await photoOrder(page, id)).toEqual(photoIds);
});

test("with a mouse, a photo dragged along the strip takes its new place", async ({ page, isMobile }) => {
  test.skip(isMobile, "A mouse");
  const { id, photoIds } = await addIdea(page, "Drag with a mouse", 3);
  await openStrip(page, id);
  const from = await centre(page, "Photo 1, the cover");
  const next = await centre(page, "Photo 2");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    await page.mouse.move(from.x + ((next.x - from.x + 12) * step) / 12, from.y);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
  await expect.poll(() => photoOrder(page, id)).toEqual([photoIds[1], photoIds[0], photoIds[2]]);
});
