import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// A phone app doesn't zoom its page; its photos zoom in place (decision 0039). Real touch points through CDP.

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "Page zoom is a phone matter");
  await signIn(page);
});

test.afterEach(async ({ page, isMobile }) => {
  if (!isMobile) return;
  const origin = new URL(page.url()).origin;
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
});

async function addIdea(page: Page, photos: number) {
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Zoom me", note: "" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  for (let position = 0; position < photos; position++) {
    await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
      headers,
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
  return id;
}

test("the page can't be zoomed: viewport meta and touch-action", { tag: "@phone" }, async ({ page }) => {
  await page.goto("/today");
  const meta = await page.locator('meta[name="viewport"]').getAttribute("content");
  expect(meta).toContain("maximum-scale=1");
  expect(meta).toContain("user-scalable=no");
  const action = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
  expect(action).toContain("pan-x");
  expect(action).toContain("pan-y");
  expect(action).not.toContain("pinch-zoom");
  expect(action).not.toBe("manipulation");
});

const spread = (cx: number, cy: number, half: number) => [
  { x: cx - half, y: cy, id: 1 },
  { x: cx + half, y: cy, id: 2 },
];

async function figure(page: Page) {
  const frame = page.getByRole("figure", { name: "1 of 2" });
  await expect(frame).toHaveAttribute("data-zoom", "out", { timeout: 15_000 });
  return frame;
}

const scaleOf = (frame: ReturnType<Page["getByRole"]>) =>
  frame.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild as Element).transform).a);

test("pinching a photo zooms the photo, not the page, and a double tap zooms and back", { tag: "@phone" }, async ({
  page,
}) => {
  const id = await addIdea(page, 2);
  await page.goto(`/ideas/${id}`);
  const frame = await figure(page);
  const box = await frame.boundingBox();
  if (!box) throw new Error("No photo");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  const send = (type: string, touchPoints: object[]) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints } as never);

  await send("touchStart", spread(cx, cy, 30));
  for (let step = 1; step <= 10; step++) {
    await send("touchMove", spread(cx, cy, 30 + step * 12));
    await page.waitForTimeout(16);
  }
  await expect(frame).toHaveAttribute("data-zoom", "in");
  expect(await scaleOf(frame)).toBeGreaterThan(2);
  // The page around it stays put: no page zoom, no scroll, and the pull to go back never starts.
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await send("touchEnd", []);
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));

  // Pinching back in springs to fitted, and never below.
  await send("touchStart", spread(cx, cy, 150));
  for (let step = 1; step <= 14; step++) {
    await send("touchMove", spread(cx, cy, 150 - step * 10));
    await page.waitForTimeout(16);
  }
  await send("touchEnd", []);
  await expect.poll(() => scaleOf(frame)).toBeCloseTo(1, 1);
  await expect(frame).toHaveAttribute("data-zoom", "out");

  // Double tap in, double tap out.
  const tap = async () => {
    await send("touchStart", [{ x: cx + 40, y: cy, id: 1 }]);
    await send("touchEnd", []);
  };
  await tap();
  await page.waitForTimeout(80);
  await tap();
  await expect(frame).toHaveAttribute("data-zoom", "in");
  await expect.poll(() => scaleOf(frame)).toBeCloseTo(2.5, 1);
  await page.waitForTimeout(450);
  await tap();
  await page.waitForTimeout(80);
  await tap();
  await expect.poll(() => scaleOf(frame)).toBeCloseTo(1, 1);
  expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
});

test("a zoomed photo pans and springs back inside its edges", { tag: "@phone" }, async ({ page }) => {
  const id = await addIdea(page, 2);
  await page.goto(`/ideas/${id}`);
  const frame = await figure(page);
  const box = await frame.boundingBox();
  if (!box) throw new Error("No photo");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  const send = (type: string, touchPoints: object[]) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints } as never);
  const tap = async () => {
    await send("touchStart", [{ x: cx, y: cy, id: 1 }]);
    await send("touchEnd", []);
  };
  await tap();
  await page.waitForTimeout(80);
  await tap();
  // Wait for the zoom spring to finish: a touch that lands mid-spring freezes it there, and the edge is then measured at that scale.
  await expect.poll(() => scaleOf(frame)).toBeCloseTo(2.5, 3);
  // The browser takes touch-action from the next touch on: drag far past the edge, with a swipe that would turn the page.
  await send("touchStart", [{ x: cx, y: cy, id: 1 }]);
  for (let step = 1; step <= 12; step++) {
    await send("touchMove", [{ x: cx + step * 30, y: cy, id: 1 }]);
    await page.waitForTimeout(16);
  }
  await send("touchEnd", []);
  // Still the first photo, and the picture rests with its edge at the frame's edge: (2.5 - 1) / 2 × width.
  await expect
    .poll(() =>
      frame.evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el.firstElementChild as Element).transform).e),
    )
    .toBeCloseTo(((2.5 - 1) / 2) * box.width, 0);
  await expect(page.getByRole("figure", { name: "1 of 2" })).toBeInViewport({ ratio: 0.9 });
});
