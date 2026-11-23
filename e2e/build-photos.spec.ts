import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// The top of a build shows every photo it has, its own and its attempts' (a print's photo from the printer
// included): adding one never hides another.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) {
    await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: new URL(page.url()).origin } });
  }
});

async function putPhoto(page: Page, itemId: string, attemptId?: string) {
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const photoId = crypto.randomUUID();
  const response = await page.request.put(`/api/items/${itemId}/photos/${photoId}`, {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      width: "1200",
      height: "900",
      color: "#6b5a4a",
      ...(attemptId ? { attemptId } : {}),
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });
  expect(response.ok()).toBe(true);
  return photoId;
}

test("a photo added at the top of a build leaves its attempts' photos in the strip", { tag: "@phone" }, async ({
  page,
}) => {
  const headers = { Origin: new URL(page.url()).origin };
  const itemId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: itemId, title: "Tomato mascot", stage: "building" } });
  const attemptId = crypto.randomUUID();
  const made = await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, outcome: "success", printedAt: Date.now() - 3_600_000 },
  });
  expect(made.ok()).toBe(true);
  await putPhoto(page, itemId, attemptId);

  await page.goto(`/builds/${itemId}`);
  const strip = page.getByRole("list", { name: "Attempts' photos" });
  await expect(strip.getByRole("button", { name: /attempt 1/ })).toBeVisible();

  // Someone adds their own photo to the build: the attempt's stays in the strip, after theirs.
  await putPhoto(page, itemId);
  await page.reload();
  await expect(page.getByRole("list", { name: "Photo order" }).getByRole("button")).toHaveCount(1);
  await expect(strip.getByRole("button", { name: /attempt 1/ })).toBeVisible();
});

test("a long strip still shows its add tiles without scrolling on a phone", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Phones lead the strip with its add tiles; desktop closes it");
  const headers = { Origin: new URL(page.url()).origin };
  const itemId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: itemId, title: "Tomato mascot", stage: "building" } });
  const attemptId = crypto.randomUUID();
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, outcome: "success", printedAt: Date.now() - 3_600_000 },
  });
  for (let i = 0; i < 6; i++) await putPhoto(page, itemId);
  for (let i = 0; i < 4; i++) await putPhoto(page, itemId, attemptId);

  await page.goto(`/builds/${itemId}`);
  await expect(page.getByRole("list", { name: "Photo order" }).getByRole("button")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "Add photos" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Photo 6" })).not.toBeInViewport();
});
