import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// More places where a photo of a print opens large (ui/LargePhotos.tsx; the attempt cards, the Journal and the attempt
// sheet are e2e/large-photos.spec.ts): the compare sheet, Search's attempt results, the printing card and the idea's
// and build's hero. On a phone the hero keeps its pinch, double tap and swipe (decision 0039): a button in its corner
// opens it. The shared page opens its photos with no script (a :target view), so it needs nothing here.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const origin = (page: Page) => new URL(page.url()).origin;
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

/** Taps on a phone, clicks with a mouse. */
const press = (target: Locator, isMobile: boolean) => (isMobile ? target.tap() : target.click());

/** A build, one attempt per entry of `attempts` (its outcome, note and how many photos it has). */
async function build(page: Page, title: string, attempts: { outcome: string | null; note?: string; photos: number }[]) {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title, note: "" } });
  await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  let position = 0;
  for (const entry of attempts) {
    const attemptId = crypto.randomUUID();
    const response = await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: attemptId, outcome: entry.outcome, note: entry.note ?? "", printedAt: Date.now() - 60_000 },
    });
    expect(response.ok()).toBe(true);
    // One at a time, each after the server has the one before: photos list in the order they were made.
    for (let n = 0; n < entry.photos; n++) {
      const put = await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
        headers,
        multipart: {
          width: "1200",
          height: "900",
          color: "#6b5a4a",
          position: String(position++),
          attemptId,
          large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
        },
      });
      expect(put.ok()).toBe(true);
    }
  }
  return id;
}

const viewer = (page: Page, name: string) => page.getByRole("dialog", { name });

test("the compare sheet's photo opens large, with its attempt's others, and the sheet stays @phone", async ({
  page,
  isMobile,
}) => {
  const id = await build(page, "Cable chain", [
    { outcome: "failed", photos: 1 },
    { outcome: "success", photos: 2 },
  ]);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await page
    .locator("[data-attempt-id]")
    .filter({ hasText: "Attempt 2" })
    .getByRole("button", { name: /^Options for attempt/ })
    .click();
  await page.getByRole("button", { name: /^Compare/ }).click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1 and attempt 2" });
  const photo = sheet.getByRole("button", { name: "Open attempt 2 photo large" });
  await press(photo, isMobile);

  const large = viewer(page, "Cable chain · attempt 2");
  await expect(large.getByText("1 of 2")).toBeVisible();
  // The thumbnail row of the viewer goes to the other photo.
  await press(large.getByRole("button", { name: "Photo 2" }), isMobile);
  await expect(large.getByText("2 of 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(sheet).toBeVisible();
  await expect(photo).toBeFocused();

  // The older attempt's photo opens its own (on a phone: after the switch).
  if (isMobile) await sheet.getByRole("radio", { name: "Attempt 1" }).tap();
  await press(sheet.getByRole("button", { name: "Open attempt 1 photo large" }), isMobile);
  await expect(viewer(page, "Cable chain · attempt 1")).toBeVisible();
});

test("a search result's photo opens its attempt's photos; the words still open the build @phone", async ({
  page,
  isMobile,
}) => {
  const id = await build(page, "Gear wall", [{ outcome: "failed", note: "stringing everywhere", photos: 3 }]);
  await page.goto("/search?q=stringing");
  const row = page.getByRole("link", { name: /Gear wall/ }).first();
  await expect(row).toBeVisible();
  await press(row.locator("img").first(), isMobile);

  const large = viewer(page, "Gear wall · attempt 1");
  await expect(large).toBeVisible();
  // The result had one photo; the attempt's others join it once the build has come.
  await expect(large.getByText("1 of 3")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(page).toHaveURL(/\/search/);
  await expect(row).toBeFocused();

  await press(row.getByText("attempt 1"), isMobile);
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
});

test("the printing card's photo opens large, and the card still leads to the build @phone", async ({
  page,
  isMobile,
}) => {
  const id = await build(page, "Bath tugboat", [{ outcome: null, photos: 2 }]);
  // Phones have the Journal for Today: its Now block draws the same card.
  await page.goto(isMobile ? "/journal" : "/today");
  // Pointer only (Enter on the name leads to the build): the picture is the card's own link, marked data-large.
  const photo = page.locator("a[data-large]").first();
  await expect(photo).toBeVisible();
  await press(photo, isMobile);
  const large = viewer(page, "Bath tugboat · attempt 1");
  // It opens on the photo the card shows (the newest of the attempt's), the attempt's others around it.
  await expect(large.getByText("2 of 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(page).toHaveURL(isMobile ? /\/journal/ : /\/today/);
  await expect(photo).toBeFocused();

  await press(page.getByRole("link", { name: /Bath tugboat, attempt 1/ }).first(), isMobile);
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
});

test("the hero opens all the photos large: a click on a computer, the corner button on a phone @phone", async ({
  page,
  isMobile,
}) => {
  const id = await build(page, "Gear wall", [{ outcome: "success", photos: 3 }]);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Gear wall");
  const large = viewer(page, "Gear wall");
  if (isMobile) {
    await expect(page.getByRole("button", { name: /^Enlarge picture \d of \d$/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Enlarge picture", exact: true }).tap();
  } else {
    await page.getByRole("button", { name: "Enlarge picture 1 of 3" }).click();
  }
  // On the photo the hero showed (the best one), the other two around it.
  await expect(large.getByText(/^\d of 3$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
});

test("an idea's hero opens its photos large @phone", async ({ page, isMobile }) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Hook rail", note: "" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
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
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hook rail");
  await press(
    isMobile
      ? page.getByRole("button", { name: "Enlarge picture", exact: true })
      : page.getByRole("button", { name: "Enlarge picture 1 of 2" }),
    isMobile,
  );
  await expect(viewer(page, "Hook rail").getByText("1 of 2")).toBeVisible();
});
