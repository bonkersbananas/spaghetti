import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn, strandedScrollers } from "./helpers";

// A row that scrolls sideways and holds nothing a keyboard can focus can't be scrolled with one (WCAG 2.1.1):
// it needs tabindex=0 and a name, or focusable items. This walks the phone screens and sheets and checks each row.

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "Rows scroll sideways on a phone");
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page, isMobile }) => {
  if (isMobile) await clearIdeas(page);
});

async function addIdea(page: Page, title: string, note: string, photos: number) {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title, note } });
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

test("every row that scrolls sideways can be reached with a keyboard", { tag: "@phone" }, async ({ page }) => {
  const id = await addIdea(page, "Tugboat", "Pull toy", 3);
  await addIdea(page, "", "A note without a title", 0);
  for (const path of ["/ideas", "/builds", "/journal", "/search", "/wishlist", `/ideas/${id}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect(await strandedScrollers(page), path).toEqual([]);
  }
});
