import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * iOS raises the keyboard only for a field focused inside the tap itself, and keeps it up while focus moves from one
 * text field to another by script (lib/keyboard-proxy.ts). No headless browser shows a keyboard, so this proves what
 * the keyboard depends on: an editable field has the focus while the tap's click is still being handled, and from
 * there the focus goes only through text fields to the one to type in. A real iPhone is the check for the keyboard.
 */

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "a laptop's focus raises no keyboard");
  // Every focus change, and what had the focus when a click had been handled by the page (React's handler runs on
  // the root, before this listener on the window), still inside the tap.
  await page.addInitScript(() => {
    const describeFocus = (element: Element | null) => {
      if (!element || element === document.body) return { what: "body", editable: false };
      const editable =
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLInputElement && /^(text|search|)$/.test(element.getAttribute("type") ?? ""));
      const what = element.hasAttribute("data-keyboard-proxy")
        ? "proxy"
        : element.getAttribute("aria-label") || element.getAttribute("role") || element.tagName.toLowerCase();
      return { what, editable };
    };
    const log: Array<{ event: string; what: string; editable: boolean }> = [];
    (window as unknown as { focusLog: typeof log }).focusLog = log;
    document.addEventListener("focusin", (event) =>
      log.push({ event: "focusin", ...describeFocus(event.target as Element) }),
    );
    window.addEventListener("click", () =>
      log.push({ event: "click handled", ...describeFocus(document.activeElement) }),
    );
  });
  await signIn(page);
  await clearIdeas(page);
  await expect(
    page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "New idea" }),
  ).toBeVisible();
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

type Entry = { event: string; what: string; editable: boolean };
const focusLog = (page: Page) => page.evaluate(() => (window as unknown as { focusLog: Entry[] }).focusLog.slice());
const clear = (page: Page) => page.evaluate(() => (window as unknown as { focusLog: Entry[] }).focusLog.splice(0));

/**
 * From the tap on: the stand-in took the focus inside the tap, the tap's click was handled with an editable field
 * focused (the stand-in, or the field itself when its screen came at once), and every focus after the stand-in's was
 * a text field, the last one `last`.
 */
async function expectHeldThrough(page: Page, last: string) {
  const log = await focusLog(page);
  const why = JSON.stringify(log);
  const held = log.findIndex((entry) => entry.event === "focusin" && entry.what === "proxy");
  const click = log.findIndex((entry) => entry.event === "click handled");
  expect(held, why).toBeGreaterThanOrEqual(0);
  expect(click, why).toBeGreaterThan(held);
  expect(log[click]?.editable, why).toBe(true);
  const after = log.slice(held + 1).filter((entry) => entry.event === "focusin");
  expect(after.length, why).toBeGreaterThan(0);
  expect(
    after.every((entry) => entry.editable),
    why,
  ).toBe(true);
  expect(after.at(-1)?.what, why).toBe(last);
}

const plus = (page: Page) =>
  page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "New idea" });

test("the tab bar's + focuses a field inside the tap, which hands the focus to the note @phone", async ({
  page,
  browserName,
}) => {
  await clear(page);
  await plus(page).click();
  const note = page.getByRole("dialog", { name: "New idea" }).getByRole("textbox", { name: "Note" });
  await expect(note).toBeFocused({ timeout: 3000 });
  await expectHeldThrough(page, "Note");
  // The stand-in is gone, and typing lands in the note.
  await expect(page.locator("[data-keyboard-proxy]")).toHaveCount(0);
  await page.keyboard.type("A kettle handle");
  await expect(note).toHaveValue("A kettle handle");
  // It rose already laid out for typing, with the slim photo row in view above where the keyboard is.
  await expect(page.getByRole("button", { name: "Take photo" })).toBeInViewport();
  // Closed, focus goes back to what had it before the tap (the + where a tap focuses buttons), not to the stand-in.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-keyboard-proxy]")).toHaveCount(0);
  if (browserName === "chromium") await expect(plus(page)).toBeFocused();
});

test("what is typed before the sheet has settled lands in the note @phone", async ({ page }) => {
  await plus(page).click();
  // At once, while the sheet is still rising and the stand-in has the focus.
  await page.keyboard.type("Hook");
  const note = page.getByRole("dialog", { name: "New idea" }).getByRole("textbox", { name: "Note" });
  await expect(note).toBeFocused();
  await page.keyboard.type(" for the shed");
  await expect(note).toHaveValue("Hook for the shed");
});

test("closing the sheet before the note takes over lets the keyboard go @phone", async ({ page }) => {
  await plus(page).click();
  await expect(page.getByRole("dialog", { name: "New idea" })).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-keyboard-proxy"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-keyboard-proxy]")).toHaveCount(0);
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 300))).not.toContain("<textarea");
  expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-keyboard-proxy"))).toBeFalsy();
});

test("a photo tile tapped while the sheet rises keeps the note from taking over @phone", async ({ page }) => {
  await plus(page).click();
  const sheet = page.getByRole("dialog", { name: "New idea" });
  // Before the sheet settles (600 ms at most), while it is still rising out of reach of a pointer click: the tile's
  // touch is where the person wants to be.
  const tile = sheet.getByRole("button", { name: "From library" });
  await tile.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, bubbles: true });
  await tile.dispatchEvent("click");
  await page.waitForTimeout(800);
  await expect(sheet.getByRole("textbox", { name: "Note" })).not.toBeFocused();
  await expect(page.locator("[data-keyboard-proxy]")).toHaveCount(0);
});

test("search from the page header opens ready to type, the keyboard raised inside the tap @phone", async ({ page }) => {
  await clear(page);
  await page.getByRole("link", { name: "Search" }).click();
  const box = page.getByRole("searchbox", { name: "Search" }).or(page.getByRole("textbox", { name: "Search" }));
  await expect(box).toBeFocused();
  await expectHeldThrough(page, "Search");
  await page.keyboard.type("PETG");
  await expect(box).toHaveValue("PETG");
});
