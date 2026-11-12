import { expect, type Page, test } from "@playwright/test";
import { signIn as signInThroughApi } from "./helpers";

const signIn = (page: Page) => signInThroughApi(page);

async function openCapture(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  return sheet;
}

const ideas = (page: Page) => page.getByRole("list", { name: "Ideas" });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Every test leaves the inbox empty again, as the smoke test expects it.
test.afterEach(async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
});

test("captures a note, which lands at the top of the inbox and stays", async ({ page, isMobile }) => {
  const sheet = await openCapture(page, isMobile);
  await expect(sheet.getByRole("button", { name: "Save idea" })).toBeDisabled();
  await sheet.getByRole("textbox", { name: "Note" }).fill("A hook for the AMS https://example.com/hook");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await expect(sheet).toBeHidden();

  const card = ideas(page).getByRole("link").first();
  await expect(card).toContainText("A hook for the AMS example.com/hook");
  await expect(page.getByText("First one in the pot")).toBeVisible();

  await expect.poll(async () => (await (await page.request.get("/api/items")).json()).items.length).toBe(1);
  await page.reload();
  await expect(ideas(page).getByRole("link").first()).toContainText("A hook for the AMS");

  // The note's link is clickable in the detail, and shows as a card under the note too.
  await ideas(page).getByRole("link").first().click();
  await expect(page.getByRole("link", { name: "example.com/hook", exact: true })).toHaveAttribute(
    "href",
    "https://example.com/hook",
  );
  await expect(page.getByRole("list", { name: "Links in the note" }).getByRole("link")).toHaveAttribute(
    "href",
    "https://example.com/hook",
  );
});

test("captures a photo from a file, uploads it in the background and keeps its capture time", async ({
  page,
  isMobile,
}) => {
  const sheet = await openCapture(page, isMobile);
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Photo 1" })).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill("Bath tugboat");
  if (isMobile) await sheet.getByRole("button", { name: "Save idea" }).click();
  else await sheet.getByRole("textbox", { name: "Note" }).press("Enter");
  await expect(sheet).toBeHidden();

  const card = ideas(page).getByRole("link", { name: /Bath tugboat/ });
  await expect(card.getByRole("img", { name: "Photo: Bath tugboat" })).toBeVisible();

  await expect
    .poll(async () => (await (await page.request.get("/api/items")).json()).items[0]?.photos.length ?? 0)
    .toBe(1);
  const { items } = await (await page.request.get("/api/items")).json();
  const [photo] = items[0].photos;
  // Resized in the browser: 1600×1200 stays under the 2048 px cap.
  expect([photo.width, photo.height]).toEqual([1600, 1200]);
  // From the fixture's EXIF DateTimeOriginal, 2026:10:31 18:04:59 in the browser's zone.
  expect(new Date(photo.takenAt).getFullYear()).toBe(2026);
  const served = await page.request.get(`/api/photos/${photo.id}/thumb`);
  expect(served.status()).toBe(200);
  expect(served.headers()["cache-control"]).toContain("immutable");

  // After a reload the photo comes from the server.
  await page.reload();
  await expect(
    ideas(page)
      .getByRole("link", { name: /Bath tugboat/ })
      .getByRole("img", { name: "Photo: Bath tugboat" }),
  ).toBeVisible();
});

test("edits the title and note with autosave", async ({ page, isMobile }) => {
  const sheet = await openCapture(page, isMobile);
  await sheet.getByRole("textbox", { name: "Note" }).fill("Spool holder");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await ideas(page)
    .getByRole("link", { name: /Spool holder/ })
    .click();

  await page.getByRole("textbox", { name: "Title" }).fill("Roller spool holder");
  await page.getByRole("button", { name: "Edit note" }).click();
  const note = page.getByRole("textbox", { name: "Note" });
  await expect(note).toBeFocused();
  await note.press("End");
  await note.pressSequentially(" for the shelf");
  await expect(page.getByText("Saved")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Roller spool holder");
  await expect(page.getByText("Spool holder for the shelf")).toBeVisible();
});

test("deletes an idea at once and brings it back with undo", async ({ page, isMobile }) => {
  const sheet = await openCapture(page, isMobile);
  await sheet.getByRole("textbox", { name: "Note" }).fill("Cable chain");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await ideas(page)
    .getByRole("link", { name: /Cable chain/ })
    .click();
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();

  if (isMobile) await page.getByRole("button", { name: "Delete idea" }).click();
  else await page.keyboard.press("Backspace");
  await expect(page).toHaveURL(/\/ideas$/);
  await expect(page.getByRole("heading", { name: "Nothing simmering yet" })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get("/api/items")).json()).items.length).toBe(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(ideas(page).getByRole("link", { name: /Cable chain/ })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get("/api/items")).json()).items.length).toBe(1);
});

test("holding the capture button opens the camera, and the photo lands in the sheet", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The capture button is the phone's tab bar");
  const camera = page.getByTestId("tabbar-camera-input");
  await expect(camera).toHaveAttribute("capture", "environment");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "New idea" }).click({ delay: 700 });
  await (await chooser).setFiles("e2e/fixtures/tugboat.jpg");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("img")).toHaveCount(1);
});

test("a plain tap on the capture button still opens the sheet without the camera", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The capture button is the phone's tab bar");
  let chosen = false;
  page.on("filechooser", () => {
    chosen = true;
  });
  await openCapture(page, true);
  expect(chosen).toBe(false);
});

test("a real touch hold on the capture button opens the camera too", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The capture button is the phone's tab bar");
  const box = await page.getByRole("button", { name: "New idea" }).boundingBox();
  if (!box) throw new Error("No capture button");
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 };
  const session = await page.context().newCDPSession(page);
  const chooser = page.waitForEvent("filechooser");
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(700);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await (await chooser).setFiles("e2e/fixtures/tugboat.jpg");
  await expect(page.getByRole("dialog", { name: "New idea" })).toBeVisible();
});

test("sliding off the capture button after the hold cancels it", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The capture button is the phone's tab bar");
  const button = page.getByRole("button", { name: "New idea" });
  const box = await button.boundingBox();
  if (!box) throw new Error("No capture button");
  const at = (x: number, y: number) => [{ x, y, id: 1 }];
  const session = await page.context().newCDPSession(page);
  let chosen = false;
  page.on("filechooser", () => {
    chosen = true;
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: at(box.x + box.width / 2, box.y + box.height / 2),
  });
  await page.waitForTimeout(700);
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(20, box.y + box.height / 2) });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(600);
  expect(chosen).toBe(false);
  // Nothing is left armed: the keyboard opens the sheet, not the camera.
  await expect(page.getByRole("button", { name: "New idea" }).locator("svg:visible")).toHaveCount(1);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "New idea" })).toBeVisible();
  expect(chosen).toBe(false);
});
