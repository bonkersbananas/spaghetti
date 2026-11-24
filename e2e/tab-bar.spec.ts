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
  // Capture is in the middle: two tabs either side of it.
  const x = async (locator: ReturnType<typeof tabs.getByRole>) => (await locator.boundingBox())?.x ?? 0;
  const capture = await x(tabs.getByRole("button", { name: "New idea" }));
  expect(await x(tabs.getByRole("link", { name: "Builds" }))).toBeLessThan(capture);
  expect(await x(tabs.getByRole("link", { name: "Journal" }))).toBeGreaterThan(capture);
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

test("phones: the tab bar is back at the bottom edge after the phone turns sideways and upright again", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The tab bar is the phone's.");
  const tabs = page.locator("nav.fixed").filter({ hasText: "Ideas" });
  await expect(tabs).toBeVisible();
  // Sideways the app is wide enough for the desktop layout (no tab bar); upright it comes back.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(tabs).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tabs).toBeVisible();
  await expect
    .poll(async () => {
      const box = await tabs.boundingBox();
      const height = await page.evaluate(() => window.innerHeight);
      return box ? Math.round(height - (box.y + box.height)) : null;
    })
    .toBe(0);
  const inset = await page.evaluate(() => document.documentElement.style.getPropertyValue("--sg-keyboard-inset"));
  expect(inset).toBe("0px");
});

/** Makes the open page tall enough to scroll (the seed's Workshop is short), then scrolls it down. */
async function scrollDown(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.setAttribute("data-test-spacer", "");
    spacer.style.height = "3000px";
    document.querySelector("main")?.append(spacer);
    window.scrollTo(0, 1200);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
}

const scrollTop = (page: import("@playwright/test").Page) => page.evaluate(() => window.scrollY);

for (const name of ["Ideas", "Builds", "Journal", "Workshop"]) {
  test(`phones: tapping the ${name} tab on ${name}, scrolled down, scrolls to the top`, { tag: "@phone" }, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "The tab bar is the phone's.");
    const tabs = page.getByRole("navigation", { name: "Sections" });
    await tabs.getByRole("link", { name }).tap();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await scrollDown(page);
    await tabs.getByRole("link", { name }).tap();
    await expect.poll(() => scrollTop(page), { timeout: 500 }).toBe(0);
    await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`));
    // At the top, a second tap does nothing new.
    await tabs.getByRole("link", { name }).tap();
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    expect(await scrollTop(page)).toBe(0);
  });
}

test("phones: from a page deeper in a tab, its tab still goes to the tab's own page", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The tab bar is the phone's.");
  const tabs = page.getByRole("navigation", { name: "Sections" });
  await tabs.getByRole("link", { name: "Workshop" }).tap();
  await page
    .locator("main")
    .getByRole("link", { name: /^Printer/ })
    .tap();
  await expect(page).toHaveURL(/\/printer$/);
  await tabs.getByRole("link", { name: "Workshop" }).tap();
  await expect(page).toHaveURL(/\/workshop$/);
  await expect(page.getByRole("heading", { level: 1, name: "Workshop" })).toBeVisible();
});

test("phones: with reduced motion the tab jumps to the top at once", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The tab bar is the phone's.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await scrollDown(page);
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Ideas" }).tap();
  // No frames in between: the very next read is already the top.
  await expect.poll(() => scrollTop(page), { timeout: 100 }).toBe(0);
});
