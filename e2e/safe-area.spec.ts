import { expect, type Page, test } from "@playwright/test";
import { IPHONE_INSETS, simulateIphone } from "../scripts/lib/iphone.ts";
import { signIn } from "./helpers";

// Runs in the "iphone" project: 390 px wide, standalone, with a 59 px top and 34 px bottom safe area.

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ context, page }) => {
  await simulateIphone(context);
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const headers = { Origin: origin(page) };
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers });
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers });
});

/** Every floating action must end above the tab bar's top edge, and the page must scroll clear of it. */
async function expectAboveTabBar(page: Page) {
  const tabBar = await page.getByRole("navigation", { name: "Sections" }).boundingBox();
  expect(tabBar).not.toBeNull();
  // The tab bar reaches the bottom edge and holds the home indicator's room.
  expect(tabBar!.height).toBeGreaterThan(IPHONE_INSETS.bottom + 48);
  const bars = page.locator("[data-action-bar]");
  await expect(bars.first()).toBeVisible();
  for (const bar of await bars.all()) {
    const box = await bar.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y + 0.5);
    for (const button of await bar.getByRole("button").all()) {
      const buttonBox = await button.boundingBox();
      expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(tabBar!.y + 0.5);
    }
  }
  // The last of the page can be scrolled clear of the bars.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const last = await page.locator("main > div").last().boundingBox();
  const bar = await bars.first().boundingBox();
  expect(last!.y + last!.height).toBeGreaterThanOrEqual(0);
  expect(bar!.y).toBeLessThan(tabBar!.y);
}

test("the Pantry, idea and build actions sit above the tab bar", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Cable chain" } });
  await page.request.post("/api/spools", {
    headers,
    data: { id: crypto.randomUUID(), material: "PLA", colorName: "Blue" },
  });

  await page.goto("/pantry");
  await expect(page.getByRole("heading", { level: 1, name: "Pantry" })).toBeVisible();
  await expectAboveTabBar(page);

  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("button", { name: "Start building" })).toBeVisible();
  await expectAboveTabBar(page);

  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page.getByRole("button", { name: "Log attempt" })).toBeVisible();
  await expectAboveTabBar(page);
});

test("a page title is not under anything translucent at rest", async ({ page }) => {
  for (const [path, name] of [
    ["/today", "Today"],
    ["/ideas", "Ideas"],
    ["/agents", "Agents"],
  ] as const) {
    await page.goto(path);
    const title = page.getByRole("heading", { level: 1, name });
    await expect(title).toBeVisible();
    const box = await title.boundingBox();
    // Below the status bar's safe area.
    expect(box!.y).toBeGreaterThanOrEqual(IPHONE_INSETS.top);
    const covering = await title.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + 4, rect.top + rect.height / 2);
      for (let node = top; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node !== element && !element.contains(node) && style.backdropFilter !== "none") return true;
      }
      return false;
    });
    expect(covering).toBe(false);
  }
});

test("the page never scrolls past its content and the tab bar's bottom is on screen", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  for (const path of ["/today", "/ideas", "/builds", "/journal", "/agents"]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
    const { docHeight, viewport, barBottom, scrollable } = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="Sections"]')?.getBoundingClientRect();
      const doc = document.documentElement;
      return {
        docHeight: doc.scrollHeight,
        viewport: window.innerHeight,
        barBottom: bar?.bottom ?? 0,
        // Whether the page is scrollable only because of what it holds, never by a viewport-sized floor.
        scrollable: doc.scrollHeight > window.innerHeight,
      };
    });
    expect(barBottom).toBeLessThanOrEqual(viewport + 0.5);
    // A page that fits must not scroll at all; a longer one ends with its own content (not a bottom inset's extra).
    if (!scrollable) expect(docHeight).toBeLessThanOrEqual(viewport);
  }
  // A short page: the document is exactly the viewport, with no extra scroll.
  await page.goto("/agents");
  await page.evaluate(() => window.scrollTo(0, 1000));
  const scrolled = await page.evaluate(() => {
    const main = document.querySelector("main > div")?.getBoundingClientRect();
    return {
      y: window.scrollY,
      max: document.documentElement.scrollHeight - window.innerHeight,
      mainBottom: main?.bottom ?? 0,
    };
  });
  expect(scrolled.y).toBeLessThanOrEqual(Math.max(0, scrolled.max));
});

test("a card's avatar shows both initials and fits its circle", async ({ page }) => {
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id: crypto.randomUUID(), title: "Cable chain" } });
  await page.goto("/ideas");
  const card = page.getByRole("article").or(page.locator("li")).filter({ hasText: "Cable chain" }).first();
  const avatar = card.getByRole("img").last();
  await expect(avatar).toBeVisible();
  const { text, fits } = await avatar.evaluate((el) => ({
    text: el.textContent ?? "",
    fits: el.scrollWidth <= el.clientWidth,
  }));
  const name = (await avatar.getAttribute("aria-label")) ?? "";
  const words = name.trim().split(/\s+/);
  expect(text).toBe(((words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase());
  expect(fits).toBe(true);
});
