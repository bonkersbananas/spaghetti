import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// Removing a saved photo takes two deliberate steps (decision 0054): never from the hero, through the strip's menu
// (a second tap on the photo showing, a hold, a right click); the Undo toast stays.

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

test("nothing on the hero removes: the photo showing opens its menu, and Undo brings it back", async ({ page }) => {
  const { id } = await addIdea(page, "Menu to remove", 2);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
  const figures = page.getByRole("figure");
  await expect(figures).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Photos" }).getByRole("button", { name: /Remove/ })).toHaveCount(0);

  // The first tap on the photo showing opens its menu: Remove is the second step, and the first photo is the cover.
  await page.getByRole("button", { name: "Photo 1, the cover" }).click();
  const menu = page.getByRole("dialog", { name: "Photo 1 of 2" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: "Make cover" })).toHaveCount(0);
  await expect(figures).toHaveCount(2);

  await menu.getByRole("button", { name: "Remove photo" }).click();
  await expect(menu).toBeHidden();
  await expect(figures).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(figures).toHaveCount(2);
});

test("Make cover moves a photo first; a tap on another photo only shows it", async ({ page }) => {
  const { id, photoIds } = await addIdea(page, "Make it the cover", 3);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });

  // Not showing yet: a tap shows it, no menu.
  await page.getByRole("button", { name: "Photo 3" }).click();
  await expect(page.getByRole("button", { name: "Photo 3" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Photo 3" }).click();
  const menu = page.getByRole("dialog", { name: "Photo 3 of 3" });
  await menu.getByRole("button", { name: "Make cover" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("button", { name: "Photo 1, the cover" })).toHaveAttribute("aria-current", "true");
  await expect.poll(() => photoOrder(page, id)).toEqual([photoIds[2], photoIds[0], photoIds[1]]);
  await expect(page.getByRole("figure")).toHaveCount(3);
});

test("a right click opens a thumbnail's menu; Escape closes it and stays on the page", async ({ page }) => {
  const { id } = await addIdea(page, "Right click", 2);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Photo 2" }).click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "Photo 2 of 2" });
  await expect(menu.getByRole("button", { name: "Make cover" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Remove photo" })).toBeVisible();
  // It shows the photo it is about.
  await expect(page.getByRole("button", { name: "Photo 2" })).toHaveAttribute("aria-current", "true");

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}`));
  await expect(page.getByRole("figure")).toHaveCount(2);
});

test("the keyboard opens the menu with a second Enter, and focus comes back to the thumbnail", async ({ page }) => {
  const { id } = await addIdea(page, "Keyboard menu", 2);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
  const second = page.getByRole("button", { name: "Photo 2" });
  await second.focus();
  await page.keyboard.press("Enter");
  await expect(second).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Enter");
  const menu = page.getByRole("dialog", { name: "Photo 2 of 2" });
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(second).toBeFocused();
});

test("on a phone, a hold on a thumbnail opens its menu as a sheet", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "A finger's hold");
  const { id, photoIds } = await addIdea(page, "Hold to remove", 2);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
  const box = await page.getByRole("button", { name: "Photo 2" }).boundingBox();
  if (!box) throw new Error("No thumbnail");
  const session = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(700);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  const sheet = page.getByRole("dialog", { name: "Photo 2 of 2" });
  await expect(sheet).toBeVisible();
  // The lifting finger didn't also tap: the sheet stays, and the photo it is about is showing.
  await page.waitForTimeout(300);
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Remove photo" }).click();
  await expect(page.getByRole("figure")).toHaveCount(1);
  await expect.poll(() => photoOrder(page, id)).toEqual([photoIds[0]]);
});

test("Escape in an attempt's sheet cancels the question and keeps the sheet", async ({ page }) => {
  const { id } = await addIdea(page, "Sheet escape", 0);
  const headers = { Origin: new URL(page.url()).origin };
  const attemptId = crypto.randomUUID();
  await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: attemptId, outcome: "success" } });
  await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      width: "1200",
      height: "900",
      color: "#6b5a4a",
      attemptId,
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/tugboat.jpg") },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/tugboat.jpg") },
    },
  });
  await page.goto(`/builds/${id}`, { waitUntil: "networkidle" });
  // The card's corner: its middle is the photo, which opens large.
  await page.getByRole("button", { name: /Attempt 1/ }).click({ position: { x: 24, y: 24 } });
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /^Remove Attempt photo 1/ }).click();
  await expect(sheet.getByRole("button", { name: /Press again to remove/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("button", { name: /^Remove Attempt photo 1/ })).toBeVisible();
  await expect(sheet).toBeVisible();
});
