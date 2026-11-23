import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// On a phone the big photo at the top of an idea or a build never scrolls inside its frame: a swipe up on it moves the
// page from the first pixel (the carousel scrolls sideways only), however the photo is shaped.

test.skip(({ isMobile }) => !isMobile, "A finger's swipe");

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page, isMobile }) => {
  if (!isMobile) return;
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) {
    await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: new URL(page.url()).origin } });
  }
});

async function putPhoto(page: Page, itemId: string, width: number, height: number) {
  const buffer = readFileSync("e2e/fixtures/portrait.jpg");
  const response = await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers: { Origin: new URL(page.url()).origin },
    multipart: {
      width: String(width),
      height: String(height),
      color: "#6b5a4a",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });
  expect(response.ok()).toBe(true);
}

async function make(page: Page, kind: "idea" | "build", width: number, height: number) {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers,
    data: {
      id,
      title: "Hero swipe",
      stage: kind === "build" ? "building" : "idea",
      note: "A long enough note. ".repeat(60),
    },
  });
  if (kind === "build") {
    const made = await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), outcome: "success", printedAt: Date.now() - 3_600_000 },
    });
    expect(made.ok()).toBe(true);
  }
  await putPhoto(page, id, width, height);
  return id;
}

const cases = [
  { kind: "build", shape: "square", width: 1254, height: 1254, viewport: 844 },
  { kind: "build", shape: "portrait", width: 800, height: 1000, viewport: 844 },
  { kind: "idea", shape: "portrait", width: 800, height: 1000, viewport: 660 },
  { kind: "idea", shape: "square", width: 1254, height: 1254, viewport: 660 },
] as const;

for (const { kind, shape, width, height, viewport } of cases) {
  test(`a ${shape} photo at the top of ${kind === "build" ? "a build" : "an idea"} leaves the swipe to the page`, {
    tag: "@phone",
  }, async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: viewport });
    const id = await make(page, kind, width, height);
    await page.goto(kind === "build" ? `/builds/${id}` : `/ideas/${id}`);
    const carousel = page.getByRole("region", { name: "Photos" }).locator("> div > div").first();
    await expect(carousel.locator("img").first()).toBeVisible();
    await expect.poll(() => carousel.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);

    // Playwright's WebKit has no touch input: the swipe is Chromium's (the sizes above are checked in both).
    if (browserName === "webkit") return;
    const box = await carousel.boundingBox();
    if (!box) throw new Error("no hero");
    const x = box.x + box.width / 2;
    const y = box.y + box.height * 0.8;
    const session = await page.context().newCDPSession(page);
    const send = (type: "touchStart" | "touchMove" | "touchEnd", py?: number) =>
      session.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: py === undefined ? [] : [{ x, y: py, id: 1 }],
      });
    await send("touchStart", y);
    for (let step = 1; step <= 10; step++) {
      await send("touchMove", y - step * 12);
      await page.waitForTimeout(20);
    }
    await send("touchEnd");

    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(40);
    expect(await carousel.evaluate((el) => el.scrollTop)).toBe(0);
  });
}
