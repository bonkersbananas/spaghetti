import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// An idea card with several photos swipes between them, and opens its page on the one showing.

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

test("a card swipes to its second photo and opens the idea there", { tag: "@phone" }, async ({ page, isMobile }) => {
  const { id, photoIds } = await addIdea(page, "Three photo carousel", 3);
  await page.goto("/ideas", { waitUntil: "networkidle" });
  const card = page.getByRole("listitem").filter({ hasText: "Three photo carousel" });
  await expect(card.locator("img")).toHaveCount(3);

  if (isMobile) {
    // A finger's swipe ends where native snapping puts it: the same as scrolling the frame by its width.
    await card.locator(".snap-x").evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: "instant" }));
  } else {
    await card.hover();
    await expect(card.getByTitle("Previous photo")).toBeHidden();
    await card.getByTitle("Next photo").click();
  }
  await expect(card.getByRole("link")).toHaveAttribute("href", `/ideas/${id}?photo=${photoIds[1]}`);

  await card.getByRole("link").click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}\\?photo=${photoIds[1]}`));
  await expect(page.getByRole("figure", { name: "2 of 3" })).toBeInViewport({ ratio: 0.9 });
});
