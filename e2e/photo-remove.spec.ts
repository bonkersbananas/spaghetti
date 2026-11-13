import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// Removing a saved photo takes two taps in place; the Undo toast stays.

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

test("a photo comes off on the second tap, and Undo brings it back", async ({ page }) => {
  const id = await addIdea(page, "Two taps to remove", 2);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
  const figures = page.getByRole("figure");
  await expect(figures).toHaveCount(2);

  await page.getByRole("button", { name: "Remove this photo" }).click();
  const confirm = page.getByRole("button", { name: /Press again to remove/ });
  await expect(confirm).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Tap again to remove" })).toBeAttached();
  await expect(figures).toHaveCount(2);

  await confirm.click();
  await expect(figures).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(figures).toHaveCount(2);
});

test("the pill falls back on its own, on Escape and on a tap elsewhere", async ({ page }) => {
  test.setTimeout(60_000);
  const id = await addIdea(page, "Pill falls back", 2);
  await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
  const ask = page.getByRole("button", { name: "Remove this photo", exact: true });
  const confirm = page.getByRole("button", { name: /Press again to remove/ });

  await ask.click();
  await expect(confirm).toBeVisible();
  await expect(ask).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("figure")).toHaveCount(2);

  await ask.click();
  await page.keyboard.press("Escape");
  await expect(ask).toBeVisible();

  await ask.click();
  await page.mouse.click(5, 300);
  await expect(ask).toBeVisible();
  await expect(page.getByRole("figure")).toHaveCount(2);
});

test("Escape in an attempt's sheet cancels the question and keeps the sheet", async ({ page }) => {
  const id = await addIdea(page, "Sheet escape", 0);
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
  await page.getByRole("button", { name: /Attempt 1/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /^Remove Attempt photo 1/ }).click();
  await expect(sheet.getByRole("button", { name: /Press again to remove/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet.getByRole("button", { name: /^Remove Attempt photo 1/ })).toBeVisible();
  await expect(sheet).toBeVisible();
});
