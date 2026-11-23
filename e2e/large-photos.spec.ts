import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// Any photo of an attempt opens large over the page: from the attempt card's lead photo or thumbnails, and from the
// Journal's attempt card. One photo at a time, the others a swipe, an arrow key or a thumbnail away; ×, Esc, a swipe
// down on a phone or Back close it, and focus goes back to the photo it was opened from.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const ids: string[] = [];
test.afterEach(async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of ids.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
});

/** A build with one attempt that worked and `photos` photos of it. */
async function buildWithPhotos(page: Page, title: string, photos: number) {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  ids.push(id);
  await page.request.post("/api/items", { headers, data: { id, title, note: "" } });
  await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: attemptId, outcome: "success" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  // One at a time, each after the server has the one before: photos list in the order they were made.
  for (let position = 0; position < photos; position++) {
    const response = await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
      headers,
      multipart: {
        width: "1200",
        height: "900",
        color: "#6b5a4a",
        position: String(position),
        attemptId,
        large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
        thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
      },
    });
    expect(response.ok()).toBe(true);
  }
  return id;
}

const viewer = (page: Page) => page.getByRole("dialog", { name: "Attempt 1" });

test("a thumbnail opens its photo large; arrows step, Esc and × close, focus comes back", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Keys and a mouse are for the desktop");
  const id = await buildWithPhotos(page, "Gear wall", 3);
  await page.goto(`/builds/${id}`);
  const thumb = page.getByRole("button", { name: "Open photo 2 of 3 large" });
  await thumb.click();

  const large = viewer(page);
  await expect(large).toBeVisible();
  await expect(large.getByText("2 of 3")).toBeVisible();
  await expect(large.getByRole("button", { name: "Photo 2" })).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("ArrowRight");
  await expect(large.getByText("3 of 3")).toBeVisible();
  // At the last photo there is no next one (the button steps aside).
  await expect(large.getByRole("button", { name: "Next photo (→)" })).toBeHidden();
  await large.getByRole("button", { name: "Previous photo (←)" }).click();
  await expect(large.getByText("2 of 3")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(thumb).toBeFocused();
  // Closing took the viewer's own history entry off without moving the page.
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));

  // The lead photo opens on the first, and × closes it.
  await page.getByRole("button", { name: "Open photo 1 of 3 large" }).click();
  await expect(large.getByText("1 of 3")).toBeVisible();
  await large.getByRole("button", { name: "Close (Esc)" }).click();
  await expect(large).toBeHidden();
  await expect(page.getByRole("button", { name: "Open photo 1 of 3 large" })).toBeFocused();

  // The rest of the card still opens the attempt.
  await page.getByRole("button", { name: "Attempt 1: success. Open" }).click({ position: { x: 24, y: 24 } });
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet.getByRole("button", { name: /^Remove Attempt photo 1/ })).toBeVisible();
});

test("on a phone a tap opens it, a swipe goes to the next, a swipe down closes it @phone", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Touch is for the phone");
  const id = await buildWithPhotos(page, "Gear wall", 3);
  await page.goto(`/builds/${id}`);
  const thumb = page.getByRole("button", { name: "Open photo 2 of 3 large" });
  await thumb.tap();

  const large = viewer(page);
  await expect(large.getByText("2 of 3")).toBeVisible();
  // No arrows on a phone: a swipe goes to the next photo.
  await expect(large.getByRole("button", { name: "Next photo (→)" })).toBeHidden();
  const session = await page.context().newCDPSession(page);
  const size = page.viewportSize();
  if (!size) throw new Error("no viewport");
  const middle = { x: Math.round(size.width / 2), y: Math.round(size.height / 2) };
  /** One finger down at `from`, along to `to` in small steps, and up. */
  const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const at = (t: number) => [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, id: 1 }];
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
    for (let step = 1; step <= 12; step++) {
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(step / 12) });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe({ x: middle.x + 150, y: middle.y }, { x: middle.x - 150, y: middle.y });
  await expect(large.getByText("3 of 3")).toBeVisible();

  // A swipe down closes it, and the page is where it was. (Android's Back closes it through a close watcher, which a
  // test can't press: history.back() is not a close request.)
  await swipe(middle, { x: middle.x, y: middle.y + 220 });
  await expect(large).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  await expect(thumb).toBeFocused();
});

test("the Journal's attempt card opens its photos large, and its words open the build @phone", async ({ page }) => {
  const id = await buildWithPhotos(page, "Gear wall", 2);
  await page.goto("/journal");
  const card = page.getByRole("link", { name: /Gear wall.*attempt 1/ });
  await card.locator("img").first().click();
  const large = page.getByRole("dialog", { name: "Gear wall · attempt 1" });
  await expect(large.getByText("1 of 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(page).toHaveURL(/\/journal/);
  await expect(card).toBeFocused();

  await card.getByText("attempt 1").click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
});
