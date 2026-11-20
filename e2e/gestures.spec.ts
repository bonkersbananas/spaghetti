import { readFileSync } from "node:fs";
import { type CDPSession, expect, type Locator, type Page, test } from "@playwright/test";
import { TUGBOAT_FILE_NAME, tugboatFile } from "./fixtures/gcode-tugboat";
import { clearIdeas, signIn } from "./helpers";

// A finger's gestures, with real touches through the Chrome DevTools Protocol (Playwright's WebKit has no touch input):
// the drags that reorder rows, and what each one leaves on the server. A click or a key never proves these.

test.skip(({ isMobile }) => !isMobile, "A finger's gesture");

const headers = (page: Page) => ({ Origin: new URL(page.url()).origin });

const touch = (session: CDPSession, type: "touchStart" | "touchMove" | "touchEnd", x?: number, y?: number) =>
  session.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" || x === undefined || y === undefined ? [] : [{ x, y, id: 1 }],
  });

async function centre(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** One finger down at `from`, along to `to` in small steps, and up. */
async function swipe(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  { steps = 14, release = true }: { steps?: number; release?: boolean } = {},
) {
  const session = await page.context().newCDPSession(page);
  await touch(session, "touchStart", from.x, from.y);
  for (let step = 1; step <= steps; step++) {
    await touch(
      session,
      "touchMove",
      from.x + ((to.x - from.x) * step) / steps,
      from.y + ((to.y - from.y) * step) / steps,
    );
    await page.waitForTimeout(25);
  }
  await page.waitForTimeout(150);
  if (release) await touch(session, "touchEnd");
  return session;
}

test.describe("reordering rows with a finger on the drag handle", () => {
  const ideas: string[] = [];
  const shopping: string[] = [];
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await clearIdeas(page);
  });
  test.afterEach(async ({ page }) => {
    await clearIdeas(page);
    for (const id of shopping.splice(0))
      await page.request.delete(`/api/shopping-items/${id}`, { headers: headers(page) });
    ideas.length = 0;
  });

  test("a wishlist row dragged by its handle takes its new place on the server", { tag: "@phone" }, async ({
    page,
  }) => {
    const titles = ["Hose clip", "Lamp shade", "Soap dish"];
    for (const title of titles) {
      const id = crypto.randomUUID();
      ideas.push(id);
      expect((await page.request.post("/api/items", { headers: headers(page), data: { id, title } })).ok()).toBe(true);
      expect((await page.request.put(`/api/wishlists/me/items/${id}`, { headers: headers(page), data: {} })).ok()).toBe(
        true,
      );
    }
    const order = async () => {
      const { wishlists } = await (await page.request.get("/api/wishlists")).json();
      return wishlists[0].entries
        .map((entry: { itemId: string }) => ideas.indexOf(entry.itemId))
        .filter((n: number) => n >= 0);
    };
    expect(await order()).toEqual([0, 1, 2]);
    await page.goto("/wishlist");
    const list = page.getByRole("list", { name: "Your wishlist" });
    const handle = (name: string) => list.getByRole("button", { name: new RegExp(`^Move ${name}`) });
    await expect(handle("Soap dish")).toBeVisible();
    await page.waitForTimeout(600);

    const from = await centre(handle("Soap dish"));
    const to = await centre(handle("Hose clip"));
    // The last row up to the first place: the finger goes up the list, and the page behind doesn't scroll.
    const scrollBefore = await page.evaluate(() => scrollY);
    await swipe(page, from, { x: to.x, y: to.y - 8 });
    await expect.poll(order).toEqual([2, 0, 1]);
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore);
    await expect(handle("Soap dish")).toHaveAccessibleName(/at 1$/);
  });

  test("a shopping row dragged by its handle takes its new place on the server", { tag: "@phone" }, async ({
    page,
  }) => {
    const names = ["Glue stick", "Nozzle wipes", "Spare belt"];
    for (const name of names) {
      const id = crypto.randomUUID();
      shopping.push(id);
      expect(
        (await page.request.post("/api/shopping-items", { headers: headers(page), data: { id, name } })).ok(),
      ).toBe(true);
    }
    const order = async () => {
      const { shoppingItems } = (await (await page.request.get("/api/shopping-items")).json()) as {
        shoppingItems: { id: string; boughtAt?: unknown; bought?: boolean }[];
      };
      return shoppingItems.map((item) => shopping.indexOf(item.id)).filter((n) => n >= 0);
    };
    const before = await order();
    expect(before.length).toBe(3);
    await page.goto("/shopping");
    const list = page.getByRole("list", { name: "To buy" });
    const handle = (name: string) => list.getByRole("button", { name: new RegExp(`^Move ${name}`) });
    await expect(handle("Glue stick")).toBeVisible();
    await page.waitForTimeout(600);
    const first = before[0] as number;
    const last = before[2] as number;
    const named = (index: number) => names[index] as string;
    const from = await centre(handle(named(last)));
    const to = await centre(handle(named(first)));
    await swipe(page, from, { x: to.x, y: to.y - 8 });
    await expect.poll(order).toEqual([last, first, before[1]]);
  });
});

async function addIdea(page: Page, title: string, photos: number) {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers: headers(page), data: { id, title, note: "" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const photoIds: string[] = [];
  for (let position = 0; position < photos; position++) {
    const photoId = crypto.randomUUID();
    photoIds.push(photoId);
    await page.request.put(`/api/items/${id}/photos/${photoId}`, {
      headers: headers(page),
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
  return { id, photoIds };
}

test.describe("swiping between photos", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await clearIdeas(page);
  });
  test.afterEach(async ({ page }) => {
    await clearIdeas(page);
  });

  test("a finger's swipe on a card shows its next photo, and opens nothing", { tag: "@phone" }, async ({ page }) => {
    const { id, photoIds } = await addIdea(page, "Swipe the card", 3);
    await page.goto("/ideas", { waitUntil: "networkidle" });
    const card = page.getByRole("listitem").filter({ hasText: "Swipe the card" });
    await expect(card.locator("img")).toHaveCount(3);
    const frame = card.locator(".snap-x");
    const box = await frame.boundingBox();
    if (!box) throw new Error("No photo");
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + box.width * 0.8, y }, { x: box.x + box.width * 0.2, y });
    await expect(card.getByRole("link")).toHaveAttribute("href", `/ideas/${id}?photo=${photoIds[1]}`);
    // Letting go of a swipe is no tap: the idea's page stays shut.
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/ideas$/);
  });

  test("a finger's swipe in the viewer steps to the next photo and back", { tag: "@phone" }, async ({ page }) => {
    const { id } = await addIdea(page, "Swipe the viewer", 3);
    await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
    const second = page.getByRole("figure", { name: "2 of 3" });
    const first = page.getByRole("figure", { name: "1 of 3" });
    const box = await first.boundingBox();
    if (!box) throw new Error("No photo");
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + box.width * 0.85, y }, { x: box.x + box.width * 0.15, y });
    await expect(second).toBeInViewport({ ratio: 0.9 });
    await swipe(page, { x: box.x + box.width * 0.15, y }, { x: box.x + box.width * 0.85, y });
    await expect(first).toBeInViewport({ ratio: 0.9 });
    // Sideways never pulled the page or went back.
    await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  });
});

test.describe("dragging a sheet down", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("a finger pulling the capture sheet down closes it, and a short pull lets it spring back", {
    tag: "@phone",
  }, async ({ page }) => {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "New idea" }).tap();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(500);
    const box = await sheet.boundingBox();
    if (!box) throw new Error("No sheet");
    const x = box.x + box.width / 2;
    // The top of the sheet, above its fields: the grabber and the title.
    const top = box.y + 14;
    // A short pull, let go: it stays.
    await swipe(page, { x, y: top }, { x, y: top + 40 });
    await page.waitForTimeout(500);
    await expect(sheet).toBeVisible();
    // A long one, past a third of the sheet: it goes.
    const to = Math.min(843, top + box.height * 0.7);
    await swipe(page, { x, y: top }, { x, y: to });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/ideas$/);
  });

  test("a photo's menu sheet closes the same way", { tag: "@phone" }, async ({ page }) => {
    const { id } = await addIdea(page, "Sheet down", 2);
    try {
      await page.goto(`/ideas/${id}`, { waitUntil: "networkidle" });
      const order = page.getByRole("list", { name: "Photo order" });
      await expect(order.getByRole("listitem").first()).toHaveCSS("touch-action", "pan-y");
      await page.waitForTimeout(400);
      const thumb = page.getByRole("button", { name: "Photo 2", exact: true });
      await thumb.tap();
      await thumb.tap();
      const sheet = page.getByRole("dialog", { name: "Photo 2 of 2" });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(500);
      const box = await sheet.boundingBox();
      if (!box) throw new Error("No sheet");
      const x = box.x + box.width / 2;
      await swipe(page, { x, y: box.y + 14 }, { x, y: Math.min(843, box.y + box.height + 60) });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
    } finally {
      await page.request.delete(`/api/items/${id}`, { headers: headers(page) });
    }
  });
});

test("a finger's sideways swipe on the compare sheet's photo switches the attempt, a vertical one doesn't", {
  tag: "@phone",
}, async ({ page }) => {
  await signIn(page);
  const id = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  try {
    await page.request.post("/api/items", {
      headers: headers(page),
      data: { id, title: "Swipe compare", stage: "building" },
    });
    const notes = ["Corners lifted", "Stayed down"];
    for (const [index, attemptId] of ids.entries()) {
      await page.request.post(`/api/items/${id}/attempts`, {
        headers: headers(page),
        data: {
          id: attemptId,
          outcome: index ? "success" : "failed",
          note: notes[index],
          settings: { bedTemperature: 55 + index * 5 },
        },
      });
    }
    await page.goto(`/builds/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Swipe compare");
    await page
      .locator(`[data-attempt-id="${ids[1]}"]`)
      .getByRole("button", { name: /^Options for attempt/ })
      .tap();
    await page.getByRole("button", { name: /Compare$/ }).tap();
    const sheet = page.getByRole("dialog", { name: "Attempt 1 and attempt 2" });
    await expect(sheet.getByRole("radio", { name: "Attempt 2" })).toBeChecked();
    await page.waitForTimeout(600);
    const words = sheet.getByText("Stayed down");
    await expect(words).toBeVisible();
    // The photo's frame is the touch area; find it by the attempt's own words just below it.
    const frame = sheet.locator(".touch-pan-y");
    const box = await frame.boundingBox();
    if (!box) throw new Error("No photo");
    const y = box.y + box.height / 2;
    // Right: the older one.
    await swipe(page, { x: box.x + box.width * 0.2, y }, { x: box.x + box.width * 0.8, y });
    await expect(sheet.getByRole("radio", { name: "Attempt 1" })).toBeChecked();
    await expect(sheet.getByText("Corners lifted")).toBeVisible();
    // Down (a sheet drag, not a swipe between attempts): the same attempt stays, and a short pull springs back.
    await swipe(page, { x: box.x + box.width / 2, y }, { x: box.x + box.width / 2 + 10, y: y + 40 });
    await expect(sheet.getByRole("radio", { name: "Attempt 1" })).toBeChecked();
    // Left: the newer one.
    await swipe(page, { x: box.x + box.width * 0.8, y }, { x: box.x + box.width * 0.2, y });
    await expect(sheet.getByRole("radio", { name: "Attempt 2" })).toBeChecked();
    await expect(sheet.getByText("Stayed down")).toBeVisible();
  } finally {
    await page.request.delete(`/api/items/${id}`, { headers: headers(page) });
  }
});

test("a finger flicking a toast away dismisses it", { tag: "@phone" }, async ({ page }) => {
  await signIn(page);
  const id = crypto.randomUUID();
  const name = "Flick the toast";
  expect((await page.request.post("/api/shopping-items", { headers: headers(page), data: { id, name } })).ok()).toBe(
    true,
  );
  try {
    await page.goto("/shopping");
    await page.getByRole("list", { name: "To buy" }).getByRole("button", { name, exact: true }).tap();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).tap();
    const toast = page.locator("[data-sonner-toast]").first();
    await expect(toast).toBeVisible();
    await page.waitForTimeout(500);
    const box = await toast.boundingBox();
    if (!box) throw new Error("No toast");
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + 30, y }, { x: 420, y }, { steps: 8 });
    await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/shopping-items/${id}`, { headers: headers(page) });
  }
});

test("a finger placing the profile picture moves the picture, not the sheet under it", { tag: "@phone" }, async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signIn(page);
  try {
    await page.getByRole("button", { name: "Account" }).tap();
    const menu = page.getByRole("dialog", { name: "The kitchen" });
    await menu.getByTestId("profile-photo-input").setInputFiles("e2e/fixtures/portrait.jpg");
    const crop = page.getByRole("dialog", { name: "Your picture" });
    const frame = crop.getByTestId("crop-frame");
    await expect(frame.locator("img")).toBeVisible();
    // Zoom in so there is room to move the picture both ways.
    await crop.getByRole("slider", { name: "Zoom" }).fill("2.5");
    await page.waitForTimeout(1000);
    const at = () => frame.locator("img").evaluate((img) => (img as HTMLElement).style.transform);
    const before = await at();
    const sheetBefore = await crop.boundingBox();
    const centreOfFrame = await centre(frame);
    // Down, then up again: both ways would pull the sheet, if the sheet took the touch.
    await swipe(page, centreOfFrame, { x: centreOfFrame.x, y: centreOfFrame.y + 90 });
    const moved = await at();
    expect(moved).not.toBe(before);
    await page.waitForTimeout(400);
    await expect(crop).toBeVisible();
    // Not a pixel off (the sheet's own opening motion is long over).
    expect(Math.abs(((await crop.boundingBox())?.y ?? 0) - (sheetBefore?.y ?? 0))).toBeLessThan(1);
    await swipe(page, centreOfFrame, { x: centreOfFrame.x - 60, y: centreOfFrame.y });
    expect(await at()).not.toBe(moved);
    await expect(crop).toBeVisible();
  } finally {
    await page.request.delete("/api/people/me/photo", { headers: headers(page) });
  }
});

test("a finger scrubbing the layer slider changes the layer and leaves the 3D view open", { tag: "@phone" }, async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  try {
    await page.goto(`/builds/${itemId}`);
    await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).tap();
    const dialog = page.getByRole("dialog", { name: "3D view" });
    await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText("Layer 317 of 317")).toBeVisible();
    await page.waitForTimeout(500);
    const slider = dialog.getByRole("slider", { name: "Layer" });
    const box = await slider.boundingBox();
    if (!box) throw new Error("No slider");
    const y = box.y + box.height / 2;
    // From the right end (the top layer) to the middle, as a thumb does.
    await swipe(page, { x: box.x + box.width - 14, y }, { x: box.x + box.width / 2, y }, { steps: 10 });
    await expect(dialog.getByText(/^Layer (1[3-9]\d|2[01]\d) of 317/)).toBeVisible();
    await page.waitForTimeout(400);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/builds/${itemId}$`));
  } finally {
    await page.request.delete(`/api/items/${itemId}`, { headers: headers(page) });
  }
});

/** A build whose one attempt carries the tugboat's sliced file (as in viewer.spec.ts). */
async function buildWithTugboat(page: Page): Promise<string> {
  return page.evaluate(
    async ({ name, bytes }) => {
      const json = { "Content-Type": "application/json" };
      const itemId = crypto.randomUUID();
      await fetch("/api/items", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ id: itemId, note: "Tugboat" }),
      });
      const attemptId = crypto.randomUUID();
      await fetch(`/api/items/${itemId}/attempts`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ id: attemptId, outcome: "success", printedAt: Date.now() - 3600_000, settings: {} }),
      });
      const form = new FormData();
      form.set("id", crypto.randomUUID());
      form.set("name", name);
      form.set("size", String(bytes.length));
      form.set("plate", "1");
      form.set("plateCount", "1");
      form.set("slicer", "BambuStudio 02.01.00.00");
      form.set("prefill", JSON.stringify({ estimatedMinutes: 200 }));
      form.set("objects", JSON.stringify(["Tugboat"]));
      form.set("file", new Blob([new Uint8Array(bytes)]), name);
      const response = await fetch(`/api/attempts/${attemptId}/file`, { method: "PUT", body: form });
      if (!response.ok) throw new Error(`file upload ${response.status}`);
      return itemId;
    },
    { name: TUGBOAT_FILE_NAME, bytes: Array.from(tugboatFile()) },
  );
}

test("a finger's sideways swipe along Up next scrolls the strip, never the page or into an idea", {
  tag: "@phone",
}, async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  try {
    for (let index = 1; index <= 6; index++) {
      const id = crypto.randomUUID();
      const made = await page.request.post("/api/items", {
        headers: headers(page),
        data: { id, title: `Queued ${index}`, note: "n" },
      });
      expect(made.ok()).toBe(true);
      await page.request.patch(`/api/items/${id}`, { headers: headers(page), data: { upNext: true } });
    }
    await page.goto("/ideas", { waitUntil: "networkidle" });
    const strip = page.getByRole("list", { name: "Up next" });
    await expect(strip.getByRole("link")).toHaveCount(6);
    const box = await strip.boundingBox();
    if (!box) throw new Error("No strip");
    const y = box.y + box.height / 2;
    await swipe(page, { x: box.x + box.width * 0.85, y }, { x: box.x + box.width * 0.1, y });
    await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/ideas$/);
  } finally {
    await clearIdeas(page);
  }
});
