import { expect, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "J and K are a desktop thing");

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("J and K walk the cards on Ideas, Enter opens one", async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const title of ["Third", "Second", "First"]) {
    await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title } });
  }
  await page.goto("/ideas");
  const cards = page.getByRole("list", { name: "Ideas" }).getByRole("link");
  await expect(cards).toHaveCount(3);

  await page.keyboard.press("j");
  await expect(cards.nth(0)).toBeFocused();
  await page.keyboard.press("j");
  await expect(cards.nth(1)).toBeFocused();
  await page.keyboard.press("k");
  await expect(cards.nth(0)).toBeFocused();
  // The ends hold: no wrapping around.
  await page.keyboard.press("k");
  await expect(cards.nth(0)).toBeFocused();

  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ideas\/[0-9a-f-]+$/);
});
