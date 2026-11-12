import { expect, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

test.skip(({ viewport }) => (viewport?.width ?? 0) < 768, "Keyboard focus is a desktop thing");

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const create = async (page: import("@playwright/test").Page, title: string) => {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title },
  });
  expect(response.ok()).toBe(true);
  return id;
};

// The page takes focus only when the app asks (a permanent tabindex would catch taps), so a test asks the same way.
const focusPage = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    main.tabIndex = -1;
    main.focus();
  });

test("the first Tab offers to skip the sidebar, and the next Tab is in the page", async ({ page }) => {
  await create(page, "Skippable");
  await page.goto("/ideas");
  const card = page.getByRole("list", { name: "Ideas" }).getByRole("link").first();
  await expect(card).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(card).toBeFocused();
});

test("focus lands in the page after moving: opening an idea, going back, a section shortcut", async ({ page }) => {
  await create(page, "Wanders");
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toBeVisible();
  await page.waitForTimeout(500);
  await page.keyboard.press("j");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/ideas\/[0-9a-f-]+$/);
  await expect(page.locator("main")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/ideas$/);
  // Back on the list, the card that was opened has focus again.
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toBeFocused();

  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.locator("main")).toBeFocused();
});

test("deleting an idea with Delete, then Undo, never leaves focus on the page's body", async ({ page }) => {
  const id = await create(page, "Goes and comes back");
  await page.goto(`/ideas/${id}`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForTimeout(500);
  // Out of the note field, onto the page itself.
  await focusPage(page);
  await page.keyboard.press("Delete");
  await expect(page).toHaveURL(/\/ideas$/);
  await expect(page.locator("main")).toBeFocused();

  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(
    page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /Goes and comes back/ }),
  ).toBeVisible();
  // Tab goes on from the page, not from the top of the sidebar.
  await focusPage(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toBeFocused();
});
