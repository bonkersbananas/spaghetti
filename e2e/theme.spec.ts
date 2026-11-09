import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const themeColor = (page: Page) =>
  page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.getAttribute("content"));

/** Opens the account sheet (phone) or the sidebar's account menu (desktop). */
async function openAppearance(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    return page.getByRole("dialog", { name: "The kitchen" });
  }
  await page.getByRole("button", { name: "Account menu" }).click();
  return page.getByRole("dialog", { name: "Account" });
}

test("follows the system, switches on request and remembers the choice per device", async ({ page, isMobile }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signIn(page);
  // No choice made yet: the system decides.
  expect(await theme(page)).toBe("dark");
  const darkColor = await themeColor(page);

  let panel = await openAppearance(page, isMobile);
  await expect(panel.getByRole("radio", { name: "System" })).toBeChecked();
  await panel.getByRole("radio", { name: "Light" }).check();
  await expect.poll(() => theme(page)).toBe("light");
  // The browser's toolbar / status bar color moves with the page.
  expect(await themeColor(page)).not.toBe(darkColor);

  // Remembered: still light after a reload, though the system is dark.
  await page.reload();
  expect(await theme(page)).toBe("light");
  panel = await openAppearance(page, isMobile);
  await expect(panel.getByRole("radio", { name: "Light" })).toBeChecked();

  // The install manifest follows too, so a dark install gets a dark splash.
  await panel.getByRole("radio", { name: "Dark" }).check();
  await expect.poll(() => theme(page)).toBe("dark");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest-dark.webmanifest");
  expect(await themeColor(page)).toBe(darkColor);

  // Back to System: follows the system again, live.
  await panel.getByRole("radio", { name: "System" }).check();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => theme(page)).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("sg-theme"))).toBeNull();
});

test("opens in the remembered theme without a flash of the other one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => localStorage.setItem("sg-theme", "dark"));
  await page.goto("/sign-in");
  expect(await theme(page)).toBe("dark");
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const html = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  // Warm brown, not white and not pure black.
  expect(html).toBe("rgb(27, 23, 20)");
  expect(background === "rgba(0, 0, 0, 0)" || background === html).toBe(true);
});
