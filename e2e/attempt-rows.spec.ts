import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// A build's story keeps its newest attempt as a full card and folds the earlier ones into compact rows
// (components/builds/AttemptRow.tsx): a tap, a click, Enter or Space opens a row in place into its card, and the
// row's picture opens its photos large. When the page leads with one of the open card's photos, the card shows them
// as thumbnails, so no photo is large twice.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const ids: string[] = [];
test.afterEach(async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of ids.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
});

/** Taps on a phone, clicks with a mouse. */
const press = (target: Locator, isMobile: boolean) => (isMobile ? target.tap() : target.click());

/** A build with four attempts (spaghetti, partly, spaghetti, worked), one photo each but the third. */
async function fourAttempts(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  ids.push(id);
  await page.request.post("/api/items", { headers, data: { id, title: "Headphone hook", note: "" } });
  await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const attempts = [
    { outcome: "failed", note: "Let go of the bed at the back corner.", photos: 1 },
    { outcome: "partial", note: "Base held. The hook shifted.", photos: 1, settings: { bedTemperature: 60 } },
    { outcome: "failed", failureTags: ["stringing"], photos: 0, settings: { bedTemperature: 60 } },
    { outcome: "success", note: "Clean all the way up.", photos: 2, settings: { bedTemperature: 60 } },
  ];
  const attemptIds: string[] = [];
  for (const [index, attempt] of attempts.entries()) {
    const attemptId = crypto.randomUUID();
    attemptIds.push(attemptId);
    const created = await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: {
        id: attemptId,
        outcome: attempt.outcome,
        note: attempt.note ?? "",
        failureTags: attempt.failureTags ?? [],
        settings: { bedTemperature: 55, ...attempt.settings },
        printedAt: Date.now() - (4 - index) * 3_600_000,
      },
    });
    expect(created.ok()).toBe(true);
    // One at a time, each after the server has the one before: photos list in the order they were made.
    for (let n = 0; n < attempt.photos; n++) {
      const put = await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
        headers,
        multipart: {
          width: "1200",
          height: "900",
          color: "#6b5a4a",
          attemptId,
          large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
        },
      });
      expect(put.ok()).toBe(true);
    }
  }
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Headphone hook");
  return { id, attemptIds };
}

const row = (page: Page, number: number, outcome: string) =>
  page.getByRole("button", { name: `Attempt ${number}: ${outcome}. Expand`, exact: true });

test("earlier attempts are rows that open in place, and stay open across a reload @phone", async ({
  page,
  isMobile,
}) => {
  const { attemptIds } = await fourAttempts(page);
  // The newest is the full card; the three before it are rows, each with its one line and what it changed.
  await expect(page.getByRole("button", { name: "Attempt 4: success. Open" })).toBeVisible();
  await expect(page.locator("[data-attempt-row]")).toHaveCount(3);
  const second = page.locator(`[data-attempt-id="${attemptIds[1]}"]`);
  await expect(second.getByText("Base held. The hook shifted.")).toBeVisible();
  await expect(second.getByText("bed 55 → 60 °C")).toBeVisible();
  await expect(page.locator(`[data-attempt-id="${attemptIds[2]}"]`).getByText("Stringing")).toBeVisible();

  // A tap opens attempt 2 into its card, in place.
  await press(row(page, 2, "partial"), isMobile);
  await expect(page.getByRole("button", { name: "Attempt 2: partial. Open" })).toBeVisible();
  await expect(page.locator("[data-attempt-row]")).toHaveCount(2);
  await expect(page.locator("[data-attempt-id]").nth(2)).toHaveAttribute("data-attempt-id", attemptIds[1] ?? "");

  // Opened stays opened for the tab, across a reload.
  await page.reload();
  await expect(page.getByRole("button", { name: "Attempt 2: partial. Open" })).toBeVisible();

  // The caret folds it back.
  // The card's chip and name fold it back (its caret points up).
  await press(page.getByRole("button", { name: /Attempt 2$/, expanded: true }), isMobile);
  await expect(row(page, 2, "partial")).toBeVisible();
  await expect(page.locator("[data-attempt-row]")).toHaveCount(3);
});

test("a row opens with Enter or Space, and J then Enter opens a row before its sheet", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keys are for the desktop");
  await fourAttempts(page);
  const first = row(page, 1, "failed");
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Attempt 1: failed. Open" })).toBeVisible();
  // The focus went to the card it opened into.
  await expect(page.getByRole("button", { name: "Attempt 1: failed. Open" })).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await row(page, 3, "failed").focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("button", { name: "Attempt 3: failed. Open" })).toBeVisible();

  // J picks the newest, J again attempt 3 (a card now), J again attempt 2 (a row): Enter opens the row, then its sheet.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(row(page, 2, "partial")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Attempt 2: partial. Open" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Attempt 2" })).toBeVisible();
});

test("a row's picture and the open card's photos open large; the card shows small what the page leads with @phone", async ({
  page,
  isMobile,
}) => {
  await fourAttempts(page);
  // The page leads with the newest attempt's second photo. Beside it on a desktop, the card shows both of its photos
  // small; on a phone, far below it, the card leads large with the photo the hero isn't showing.
  const card = page.locator("[data-attempt-id]").first();
  await expect(card.getByRole("button", { name: "Open photo 1 of 2 large" })).toBeVisible();
  const widths = async () =>
    card
      .locator("button[data-photo-id]")
      .evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().width)));
  const sizes = await widths();
  expect(sizes).toHaveLength(2);
  if (isMobile) {
    expect(sizes[0]).toBeGreaterThan(200);
    expect(sizes[1]).toBeLessThanOrEqual(96);
  } else for (const width of sizes) expect(width).toBeLessThanOrEqual(96);

  // A row's picture opens its attempt's photos large, and the row stays a row.
  await press(page.getByRole("button", { name: "Open attempt 2's picture large" }), isMobile);
  const large = page.getByRole("dialog", { name: "Attempt 2" });
  await expect(large).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
  await expect(row(page, 2, "partial")).toBeVisible();

  // The open card's thumbnail opens its photos too, on the one picked.
  await press(card.getByRole("button", { name: "Open photo 2 of 2 large" }), isMobile);
  const newest = page.getByRole("dialog", { name: "Attempt 4" });
  await expect(newest.getByText("2 of 2")).toBeVisible();
});
