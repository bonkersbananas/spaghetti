import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other specs expect an empty workshop.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

async function buildWithThreeAttempts(page: Page) {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await page.request.post("/api/items", { headers, data: { id, title: "Cable chain", stage: "building" } });
  const log = (attemptId: string, outcome: string | null, note: string, settings: Record<string, unknown>) =>
    page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: attemptId, outcome, note, settings } });
  await log(ids[0] as string, "failed", "Corners lifted", {
    bedTemperature: 55,
    layerHeight: 0.2,
    actualMinutes: 120,
    weightGrams: 60,
  });
  // The second took no time and weighed nothing in the log: only an estimate.
  await log(ids[1] as string, "success", "Stayed down", {
    bedTemperature: 60,
    layerHeight: 0.2,
    estimatedMinutes: 90,
    brim: true,
  });
  // Nothing changed since the second, and it is still printing.
  await log(ids[2] as string, null, "", { bedTemperature: 60, layerHeight: 0.2, estimatedMinutes: 90, brim: true });
  return { id, ids };
}

test("the summary adds the attempts up, and its dots pick an attempt", async ({ page }) => {
  const { id, ids } = await buildWithThreeAttempts(page);
  await page.goto(`/builds/${id}`);
  const summary = page.getByRole("region", { name: "Summary" });
  await expect(summary.getByRole("heading", { name: "So far" })).toBeVisible();
  await expect(summary.getByText("1 spaghetti, 1 worked, printing now")).toBeVisible();
  // 120 min measured + 90 min estimated; one attempt has no weight, and the print on the bed counts for nothing yet.
  await expect(summary.getByText("about 3 h 30 min on the bed")).toBeVisible();
  await expect(summary.getByText("60 g of filament")).toBeVisible();
  await expect(summary.getByText("at least 60 g of filament")).toBeVisible();

  // A dot picks its attempt, like J and K.
  await summary.getByRole("button", { name: "Attempt 1: spaghetti" }).click();
  await expect(page.locator(`[data-attempt-id="${ids[0]}"]`)).toHaveAttribute("aria-current", "true");

  // Once the build is done the overline says so.
  await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { stage: "done" } });
  await page.reload();
  await expect(page.getByRole("region", { name: "Summary" }).getByRole("heading", { name: "In all" })).toBeVisible();
});

test("a build with one attempt has no summary", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Hook", stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "success", settings: { bedTemperature: 60 } },
  });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("heading", { level: 2, name: /^Attempts/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Summary" })).toHaveCount(0);
});

test("compares two attempts from the changes line and from the keyboard", async ({ page, isMobile }) => {
  const { id, ids } = await buildWithThreeAttempts(page);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");

  // The changes line is the way in; the dialog names both attempts, older first.
  await page
    .locator(`[data-attempt-id="${ids[1]}"]`)
    .getByRole("button", { name: /Compare$/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1 and attempt 2" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Cable chain")).toBeVisible();

  // What changed: the same words as the chips, as rows.
  const changed = sheet.getByRole("region", { name: "What changed" });
  await expect(changed.getByRole("row", { name: /Bed 55 °C 60 °C/ })).toBeVisible();
  await expect(changed.getByRole("row", { name: /Brim no brim brim/ })).toBeVisible();
  // How it went: time and weight, side by side.
  const went = sheet.getByRole("region", { name: "How it went" });
  await expect(went.getByRole("row", { name: /Time 2 h est\. 1 h 30 min/ })).toBeVisible();
  await expect(went.getByRole("row", { name: /Filament 60 g/ })).toBeVisible();
  // What stayed the same is one tap away.
  await sheet.getByRole("button", { name: /^Same in both/ }).click();
  await expect(sheet.getByText("Layers 0.20 mm")).toBeVisible();

  if (isMobile) {
    // Phones: a switch over one photo; the chosen attempt's words follow.
    await expect(sheet.getByRole("radio", { name: "Attempt 2" })).toBeChecked();
    await expect(sheet.getByText("Stayed down")).toBeVisible();
    await sheet.getByRole("radio", { name: "Attempt 1" }).click();
    await expect(sheet.getByText("Corners lifted")).toBeVisible();
  } else {
    // Desktop: both attempts' words, and each name opens a list that swaps that column.
    await expect(sheet.getByText("Corners lifted")).toBeVisible();
    await expect(sheet.getByText("Stayed down")).toBeVisible();
    await sheet.getByRole("button", { name: "Attempt 2" }).click();
    const list = page.getByRole("dialog", { name: "Pick the attempt to compare" });
    // The other side's attempt can't be picked twice.
    await expect(list.getByRole("button", { name: /Attempt 1/ })).toBeDisabled();
    await list.getByRole("button", { name: /Attempt 3/ }).click();
    const swapped = page.getByRole("dialog", { name: "Attempt 1 and attempt 3" });
    await expect(swapped).toBeVisible();
    // A print still on the bed can be compared: its chip, and no results of its own.
    await expect(swapped.getByText("Printing", { exact: true }).first()).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Nothing changed since attempt 2: the entry offers the plain comparison.
  await page.locator(`[data-attempt-id="${ids[2]}"]`).getByRole("button", { name: "Compare with attempt 2" }).click();
  await expect(page.getByRole("dialog", { name: "Attempt 2 and attempt 3" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  if (!isMobile) {
    // V compares the newest with the one before it (the picked attempt, when there is one).
    await page.keyboard.press("v");
    await expect(page.getByRole("dialog", { name: "Attempt 2 and attempt 3" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // With an attempt picked (a summary dot picks one), V compares that one with the one before it.
    await page.getByRole("button", { name: "Attempt 2: worked" }).click();
    await page.keyboard.press("v");
    await expect(page.getByRole("dialog", { name: "Attempt 1 and attempt 2" })).toBeVisible();
  }
});

test("the first attempt has nothing to compare with", async ({ page }) => {
  const { id, ids } = await buildWithThreeAttempts(page);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await expect(page.locator(`[data-attempt-id="${ids[0]}"]`).getByRole("button", { name: /Compare/ })).toHaveCount(0);
});

test("on a laptop What changed is in the first screen of the compare sheet, photos and all", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop layout");
  const { id, ids } = await buildWithThreeAttempts(page);
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  // The newer attempt has two photos (the thumbnail row), the older one: worst case for the height.
  for (const [attemptId, count] of [
    [ids[0], 1],
    [ids[1], 2],
  ] as const) {
    for (let index = 0; index < count; index++) {
      const response = await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
        headers: { Origin: origin(page) },
        multipart: {
          width: "1200",
          height: "1600",
          color: "#6b5a4a",
          position: String(index),
          attemptId: attemptId as string,
          large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
        },
      });
      expect(response.ok()).toBe(true);
    }
  }
  // 1440×900, and a short 1280×720 laptop window.
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(size);
    await page.goto(`/builds/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
    await page
      .locator(`[data-attempt-id="${ids[1]}"]`)
      .getByRole("button", { name: /Compare$/ })
      .click();
    const sheet = page.getByRole("dialog", { name: "Attempt 1 and attempt 2" });
    await expect(sheet.getByRole("img", { name: "Attempt 2", exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    const changed = await sheet.getByRole("region", { name: "What changed" }).boundingBox();
    const firstRow = await sheet.getByRole("row", { name: /Bed 55 °C 60 °C/ }).boundingBox();
    expect(changed).not.toBeNull();
    expect(firstRow).not.toBeNull();
    // On 1440×900 the heading and its first row are in view; on the short window the section may start just above the fold.
    expect(changed?.y ?? 9999).toBeLessThan(size.height);
    if (size.height >= 900) expect((firstRow?.y ?? 9999) + (firstRow?.height ?? 0)).toBeLessThanOrEqual(size.height);
    // The photos are whole, not cropped: contained in their frame.
    const fit = await sheet
      .getByRole("img", { name: "Attempt 2", exact: true })
      .evaluate((img) => getComputedStyle(img).objectFit);
    expect(fit).toBe("contain");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});
