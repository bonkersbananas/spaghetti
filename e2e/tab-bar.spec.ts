import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("phones: the tab bar is Ideas, Builds, Journal and Workshop around capture, and search is in the header", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The tab bar is the phone's.");
  const tabs = page.getByRole("navigation", { name: "Sections" });
  await expect(tabs.getByRole("link")).toHaveText(["Ideas", "Builds", "Journal", "Workshop"]);
  await tabs.getByRole("link", { name: "Workshop" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Workshop" })).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: /^Printer/ })).toHaveAttribute("href", "/printer");
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeFocused();
  // Search itself has no search button.
  await expect(page.getByRole("link", { name: "Search" })).toHaveCount(0);
});

test("phones: /today leads to the Journal, which is where the app opens", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Phones only.");
  await page.goto("/today");
  await expect(page).toHaveURL(/\/journal$/);
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/journal$/);
});

test("desktop: Today stays, the sidebar lists the workshop, and the app opens on Today", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "Desktop only.");
  await page.goto("/");
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByRole("complementary").getByRole("link", { name: "Pantry" })).toBeVisible();
});
