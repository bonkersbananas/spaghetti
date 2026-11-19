import { expect, type Locator, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

const headers = (page: Page) => ({ Origin: new URL(page.url()).origin });

async function make(page: Page, data: Record<string, unknown>) {
  const response = await page.request.post("/api/items", {
    headers: headers(page),
    data: { id: crypto.randomUUID(), createdAt: Date.now() - 120_000, ...data },
  });
  expect(response.ok()).toBe(true);
}

/** Ideas without a photo of every kind the pickers must hold: a bare link, a note, a long title, a short one. */
async function makeIdeas(page: Page) {
  await make(page, {
    note: "https://www.printables.com/model/1234567-modular-wall-hook-system-for-garage-pegboards?utm=x",
  });
  await make(page, { note: "Spice rack for the drawer: three rows, 40 mm deep, no screws, and a lip at the front" });
  await make(page, {
    title: "An extremely long title that goes on and on about a modular wall hook system for the garage",
  });
  await make(page, { title: "Hose clip", note: "Fits 25 mm hose." });
  await make(page, { title: "Seed tray" });
}

/** Every tile is the same size, keeps to the sheet, and none overlaps another; the sheet never scrolls sideways. */
async function expectTidyTiles(sheet: Locator, tiles: Locator, count: number) {
  await expect(tiles).toHaveCount(count);
  // The sheet opens with a motion: measure once it has stopped.
  let last = "";
  await expect
    .poll(async () => {
      const now = JSON.stringify(await sheet.boundingBox());
      const still = now === last;
      last = now;
      return still;
    })
    .toBe(true);
  const sheetBox = await sheet.boundingBox();
  if (!sheetBox) throw new Error("no sheet");
  const boxes = await tiles.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, name: el.getAttribute("aria-label") ?? el.textContent ?? "" };
    }),
  );
  for (const a of boxes) {
    expect(a.x, a.name).toBeGreaterThanOrEqual(sheetBox.x - 0.5);
    expect(a.x + a.w, a.name).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 0.5);
  }
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const apart =
        a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5 || a.y + a.h <= b.y + 0.5 || b.y + b.h <= a.y + 0.5;
      expect(apart, `${a.name} overlaps ${b.name}`).toBe(true);
    }
  }
  // The first tile's square sets the size: every other one has the same width.
  const first = boxes[0]?.w ?? 0;
  for (const box of boxes) expect(Math.abs(box.w - first), box.name).toBeLessThan(1);
  expect(await sheet.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  await makeIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("the Start a build picker's tiles share one size and keep to their cells", { tag: "@phone" }, async ({ page }) => {
  await page.goto("/builds");
  await page
    .getByRole("button", { name: /^(New build|Pick an idea to print)$/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "What are you printing?" })).toBeVisible();
  await expectTidyTiles(sheet, sheet.locator("[data-tile] > button"), 5);
  // A link is named in words, never as an address; a note says its words once (the face), not again as a caption.
  await expect(sheet.getByText("https://", { exact: false })).toHaveCount(0);
  await expect(sheet.getByText(/^Spice rack for the drawer/)).toHaveCount(1);
});

test("the wishlist picker's tiles share one size and keep to their cells", { tag: "@phone" }, async ({ page }) => {
  await page.goto("/wishlist");
  await page.getByRole("button", { name: "Pick ideas" }).click();
  const sheet = page.getByRole("dialog", { name: "Pick your top ideas" });
  await expectTidyTiles(sheet, sheet.getByRole("list", { name: "Ideas" }).locator("li > button"), 5);
  await expect(sheet.getByText("https://", { exact: false })).toHaveCount(0);
  await expect(sheet.getByText(/^Spice rack for the drawer/)).toHaveCount(1);
});
