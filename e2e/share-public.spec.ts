import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * Public links (decision 0075): one of the two people makes a public link to an idea, someone who isn't signed in
 * opens it and can only look, and stopping it ends the link at once, with Undo bringing the same one back.
 */

const TITLE = "Paddle steamer for the bath";

test.afterEach(async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const { shares } = await (await page.request.get("/api/shares")).json();
  for (const share of shares) await page.request.delete(`/api/shares/${share.id}`, { headers: { Origin: origin } });
  await clearIdeas(page);
});

/** Captures an idea with a camera photo (the fixture carries EXIF) and a title, and opens its page. */
async function ideaWithPhoto(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Photo 1" })).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill(TITLE);
  if (isMobile) await sheet.getByRole("button", { name: "Save idea" }).click();
  else await sheet.getByRole("textbox", { name: "Note" }).press("Enter");
  await expect(sheet).toBeHidden();
  // The photo is on the server (the outbox sends it in the background).
  await expect
    .poll(async () => (await (await page.request.get("/api/items")).json()).items[0]?.photos.length ?? 0)
    .toBe(1);
  const { items } = await (await page.request.get("/api/items")).json();
  const id = items[0].id as string;
  await page.request.patch(`/api/items/${id}`, {
    headers: { Origin: new URL(page.url()).origin },
    data: { title: TITLE },
  });
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(TITLE);
  return id;
}

test("a public link shows the idea read-only to a guest, and stopping it ends the link until Undo", {
  tag: "@phone",
}, async ({ page, browser, context, isMobile, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
  const id = await ideaWithPhoto(page, isMobile);

  // The share button offers both links; a public one is made on purpose.
  await page.getByRole("button", { name: "Share idea", exact: true }).click();
  await expect(page.getByText("Only the two of you")).toBeVisible();
  await page.getByRole("button", { name: "Make a link" }).click();
  await expect(page.getByText("Anyone with the link can look")).toBeVisible();
  const link = await page.getByTitle(/\/s\/[A-Za-z0-9_-]{24}$/).getAttribute("title");
  expect(link).toBeTruthy();
  const url = link as string;
  // Closed again, the page says it is shared (a phone's sheet hides the page behind it until then).
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share idea (anyone with the link can look)" })).toBeVisible();

  // A guest: a fresh browser with no session.
  const guestContext = await browser.newContext({ baseURL });
  const guest = await guestContext.newPage();
  const opened = await guest.goto(url);
  expect(opened?.status()).toBe(200);
  expect(opened?.headers()["x-robots-tag"]).toMatch(/noindex/);
  expect(opened?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(guest.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  const photo = guest.locator(".gp-strip img").first();
  await expect(photo).toBeVisible();
  // Only to look at: nothing to press that changes anything, and no app around it.
  await expect(guest.locator("button, input, textarea, select, form, script")).toHaveCount(0);
  await expect(guest.getByRole("navigation")).toHaveCount(0);
  // The photo came through the link, resized in the browser: no EXIF (the camera's file had some).
  const src = (await photo.getAttribute("src")) as string;
  const bytes = await (await guest.request.get(src)).body();
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.includes(Buffer.from("Exif"))).toBe(false);
  // The token reaches nothing of the API.
  expect((await guest.request.get(`/api/items/${id}`)).status()).toBe(401);

  // Someone signed in who opens it lands on the idea's own page.
  await page.goto(url);
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(TITLE);

  // Stop sharing: at once, with Undo.
  await page.getByRole("button", { name: "Share idea (anyone with the link can look)" }).click();
  await page.getByRole("button", { name: "Stop sharing" }).click();
  await expect(page.getByText("Stopped sharing")).toBeVisible();
  // The panel offers a new link again at once.
  await expect(page.getByRole("button", { name: "Make a link" })).toBeVisible();
  await expect.poll(async () => (await guest.goto(url))?.status()).toBe(404);
  await expect(guest.getByRole("heading", { name: "This isn't shared anymore" })).toBeVisible();
  await expect(guest.getByText(TITLE)).toHaveCount(0);
  expect((await guest.request.get(src)).status()).toBe(404);

  // Undo brings the same link back.
  await page.getByRole("button", { name: "Undo" }).click();
  // A toast is outside a desktop popover, which closes; a phone's sheet stays (and Escape on the page means back).
  if (isMobile) await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Share idea (anyone with the link can look)" })).toBeVisible();
  const { shares } = await (await page.request.get("/api/shares")).json();
  expect(shares.map((share: { token: string }) => url.endsWith(`/s/${share.token}`))).toEqual([true]);
  await expect.poll(async () => (await guest.goto(url))?.status()).toBe(200);
  await expect(guest.getByRole("heading", { level: 1, name: TITLE })).toBeVisible();
  await guestContext.close();
});
