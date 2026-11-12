import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other specs expect an empty workshop.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

async function ideaWithPhoto(page: Page) {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Tugboat", note: "A boat" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const response = await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      width: "1600",
      height: "1200",
      color: "#6b5a4a",
      position: "0",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });
  expect(response.ok()).toBe(true);
  return id;
}

test("a tapped card's photo travels to its page: one name, on the hero, let go a moment later", async ({ page }) => {
  const id = await ideaWithPhoto(page);
  // The idea page's code is loaded before the tap: the name is let go 800 ms after it, and a page whose code arrives
  // later (a busy runner) is not named at all, which is not what this test is about.
  await page.goto(`/ideas/${id}`);
  const hero = page.getByRole("region", { name: "Photos" }).getByRole("figure");
  await expect(hero.first()).toBeVisible();
  await page.getByRole("link", { name: "Ideas", exact: true }).first().click();
  const card = page.getByRole("link", { name: /Tugboat/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  // The page's hero photo carries the transition's name while the transition runs, and only it.
  await expect(hero.first()).toHaveCSS("view-transition-name", "hero-photo");
  expect(await page.evaluate(() => document.querySelectorAll("[style*='hero-photo']").length)).toBe(1);
  await expect(hero.first()).toHaveCSS("view-transition-name", "none", { timeout: 4000 });
});

test("with reduced motion nothing is named, so nothing travels", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await ideaWithPhoto(page);
  await page.goto("/ideas");
  await page.getByRole("link", { name: /Tugboat/ }).click();
  await expect(page.getByRole("region", { name: "Photos" })).toBeVisible();
  expect(await page.evaluate(() => document.querySelectorAll("[style*='hero-photo']").length)).toBe(0);
  // And the stylesheet turns every view-transition animation off, inside its reduced-motion rule.
  const off = await page.evaluate(() =>
    Array.from(document.styleSheets).some((sheet) =>
      Array.from(sheet.cssRules).some(
        (rule) =>
          rule instanceof CSSMediaRule &&
          rule.media.mediaText.includes("prefers-reduced-motion") &&
          rule.cssText.includes("::view-transition-group(*)") &&
          /animation:[^;]*none[^;]*!important/.test(rule.cssText),
      ),
    ),
  );
  expect(off).toBe(true);
});

async function buildWithAttempts(page: Page, count = 3) {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  const ids: string[] = [];
  await page.request.post("/api/items", { headers, data: { id, title: "Cable chain", stage: "building" } });
  for (let index = 0; index < count; index++) {
    const attemptId = crypto.randomUUID();
    ids.push(attemptId);
    await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: attemptId, outcome: "partial", note: `Note ${index + 1}`, settings: { bedTemperature: 55 + index } },
    });
  }
  return { id, ids };
}

test("an outcome answers the tap with a short vibration, unless motion is reduced", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Phones");
  for (const reduced of [false, true]) {
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.addInitScript(() => {
      const buzzes: unknown[] = [];
      (window as unknown as { buzzes: unknown[] }).buzzes = buzzes;
      navigator.vibrate = (pattern) => {
        buzzes.push(pattern);
        return true;
      };
    });
    const { id } = await buildWithAttempts(page, 1);
    await page.goto(`/builds/${id}`);
    await page
      .getByRole("button", { name: /^Log attempt/ })
      .first()
      .click();
    const sheet = page.getByRole("dialog", { name: "Attempt 2" });
    await sheet.getByRole("radio", { name: "Worked" }).click();
    await expect(sheet.getByRole("radio", { name: "Worked" })).toBeChecked();
    const buzzes = await page.evaluate(() => (window as unknown as { buzzes: unknown[] }).buzzes);
    expect(buzzes).toEqual(reduced ? [] : [10]);
    // The spring only scales the icon, and it rests at its own size (never left mid-way, with or without motion).
    await page.waitForTimeout(600);
    expect(
      await sheet
        .getByRole("radio", { name: "Worked" })
        .locator("span")
        .first()
        .evaluate((el) => getComputedStyle(el).transform),
    ).toBe("none");
    await page.keyboard.press("Escape");
  }
});

test("the attempt sheet steps between attempts, saving as it goes, and not while logging a new one", async ({
  page,
}) => {
  const { id, ids } = await buildWithAttempts(page);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");

  // Logging a new attempt: no arrows.
  await page
    .getByRole("button", { name: /^Log attempt/ })
    .first()
    .click();
  await expect(page.getByRole("dialog", { name: "Attempt 4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous attempt" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A saved attempt: arrows, disabled at the ends.
  await page
    .locator(`[data-attempt-id="${ids[1]}"]`)
    .getByRole("button", { name: /Open$/ })
    .click({ position: { x: 6, y: 6 } });
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await expect(sheet).toBeVisible();
  const note = sheet.getByRole("textbox", { name: "Note" });
  await expect(note).toHaveValue("Note 2");
  await note.fill("Note 2, edited on the way");
  await sheet.getByRole("button", { name: "Previous attempt" }).click();
  const first = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(first).toBeVisible();
  await expect(first.getByRole("textbox", { name: "Note" })).toHaveValue("Note 1");
  await expect(first.getByRole("button", { name: "Previous attempt" })).toBeDisabled();
  // What was typed on attempt 2 was saved as it was left.
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${id}`)).json();
      return item.attempts.find((attempt: { id: string }) => attempt.id === ids[1]).note;
    })
    .toBe("Note 2, edited on the way");
  const open = page.getByRole("dialog");
  await open.getByRole("button", { name: "Next attempt" }).click();
  await expect(page.getByRole("dialog", { name: "Attempt 2" })).toBeVisible();
  await expect(open.getByRole("textbox", { name: "Note" })).toHaveValue("Note 2, edited on the way");
  await open.getByRole("button", { name: "Next attempt" }).click();
  const last = page.getByRole("dialog", { name: "Attempt 3" });
  await expect(last).toBeVisible();
  await expect(last.getByRole("textbox", { name: "Note" })).toHaveValue("Note 3");
  await expect(last.getByRole("button", { name: "Next attempt" })).toBeDisabled();
  // The footer is still the sheet's own: Done closes it.
  await last.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a build with one attempt has no arrows", async ({ page }) => {
  const { id, ids } = await buildWithAttempts(page, 1);
  await page.goto(`/builds/${id}`);
  await page
    .locator(`[data-attempt-id="${ids[0]}"]`)
    .getByRole("button", { name: /Open$/ })
    .click({ position: { x: 6, y: 6 } });
  await expect(page.getByRole("dialog", { name: "Attempt 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next attempt" })).toHaveCount(0);
});

test("the back arrow goes back in history from the list it came from, not onto a new page", async ({ page }) => {
  const id = await ideaWithPhoto(page);
  await page.goto("/ideas");
  await page.getByRole("link", { name: /Tugboat/ }).click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  const place = () => page.evaluate(() => (history.state as { __TSR_index?: number }).__TSR_index);
  const opened = await place();
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Ideas/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/ideas$/);
  // A step back (a pushed page would be one entry further on, and the list's scroll would be lost).
  expect(await place()).toBe((opened ?? 0) - 1);
  // Opened by a link from elsewhere (no list before it), the arrow still takes you to the list.
  await page.goto(`/ideas/${id}`);
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Ideas/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/ideas$/);
});

test("only a step back slides the page away: Start building and a tab switch don't", async ({ page }) => {
  const id = await ideaWithPhoto(page);
  const other = await ideaWithPhoto(page);
  // Records what each page move asks of the View Transitions API.
  await page.addInitScript(() => {
    const calls: string[][] = [];
    (window as unknown as { __vt: string[][] }).__vt = calls;
    const original = document.startViewTransition?.bind(document);
    if (!original) return;
    document.startViewTransition = ((arg: unknown) => {
      calls.push([...((arg as { types?: string[] })?.types ?? [])]);
      return original(arg as never);
    }) as typeof document.startViewTransition;
  });
  const slides = () =>
    page.evaluate(() => (window as unknown as { __vt: string[][] }).__vt.filter((t) => t.includes("back")).length);
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(/\/builds\//);
  await page.getByRole("link", { name: "Ideas", exact: true }).first().click();
  await expect(page).toHaveURL(/\/ideas$/);
  expect(await slides()).toBe(0);
  // The back arrow, from a page opened off the list, does.
  await page.locator(`a[href="/ideas/${other}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${other}$`));
  await page
    .getByRole("main")
    .getByRole("link", { name: /^Ideas/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/ideas$/);
  expect(await slides()).toBe(1);
});

test("Worked throws a pinch of parmesan and spaghetti is met kindly, only for a pick made in the sheet", async ({
  page,
}) => {
  const { id } = await buildWithAttempts(page, 1);
  await page.goto(`/builds/${id}`);
  await page
    .getByRole("button", { name: /^Log attempt/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  const kind = sheet.getByText("Good one to have on record");
  await expect(kind).toHaveCount(0);
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await expect(sheet.locator(".sg-speck")).toHaveCount(6);
  await expect(kind).toHaveCount(0);
  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await expect(kind).toBeVisible();
  await expect(sheet.locator(".sg-speck")).toHaveCount(0);
  await sheet.getByRole("radio", { name: "Partly" }).click();
  await expect(kind).toHaveCount(0);
  // Opening an attempt that already was spaghetti says nothing: the line answers a pick, it isn't a label.
  const headers = { Origin: origin(page) };
  const failed = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: failed, title: "Hinge", stage: "building" } });
  await page.request.post(`/api/items/${failed}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "failed", note: "Off the bed" },
  });
  await page.goto(`/builds/${failed}`);
  await page.getByRole("button", { name: /^Attempt 1: / }).click();
  await expect(page.getByRole("dialog", { name: "Attempt 1" }).getByRole("radio", { name: "Spaghetti" })).toBeChecked();
  await expect(page.getByText("Good one to have on record")).toHaveCount(0);
});

test("the keyboard's inset eases, so a phone sheet rides up with it, and is instant with reduced motion", async ({
  page,
}) => {
  const transition = () =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return { property: style.transitionProperty, duration: style.transitionDuration };
    });
  await page.goto("/ideas");
  expect((await transition()).property).toContain("--sg-keyboard-inset");
  // The height above the keyboard moves with it, so a tall sheet's top and bottom ease together.
  expect((await transition()).property).toContain("--sg-visible-height");
  expect((await transition()).duration).not.toBe("0s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(Number.parseFloat((await transition()).duration)).toBeLessThan(0.001);
});
