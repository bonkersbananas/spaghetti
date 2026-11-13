import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// Hover is for a mouse, and a press look waits until a touch is a tap (lib/touch-press.ts): a finger that scrolls the
// list never flashes a card.

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

const ids: string[] = [];
test.afterEach(async ({ page }) => {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of ids.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
});

async function addIdeas(page: Page, count: number) {
  const headers = { Origin: new URL(page.url()).origin };
  for (let n = 0; n < count; n++) {
    const id = crypto.randomUUID();
    ids.push(id);
    await page.request.post("/api/items", { headers, data: { id, title: `Press ${n}`, note: "" } });
  }
  await page.goto("/ideas", { waitUntil: "networkidle" });
  await expect(page.getByRole("link", { name: /^Press 0/ })).toBeVisible();
}

const pressed = (page: Page) => page.locator("[data-pressed]:not([data-sg-fixture])").count();

test("a touch that turns into a scroll never shows the pressed look", { tag: "@phone" }, async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "touch");
  await addIdeas(page, 3);
  const link = page.getByRole("link", { name: /^Press 0/ });
  const box = (await link.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", ny: number) =>
    session.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: ny }],
    });

  await touch("touchStart", y);
  await page.waitForTimeout(30);
  for (let step = 1; step <= 6; step++) {
    await touch("touchMove", y - step * 12);
    await page.waitForTimeout(20);
  }
  // Well past the delay the look would have come in: it must not, because the finger moved.
  await page.waitForTimeout(250);
  expect(await pressed(page)).toBe(0);
  await touch("touchEnd", y);
  expect(await pressed(page)).toBe(0);
});

test("a held touch shows the pressed look, and a tap acts", { tag: "@phone" }, async ({ page, hasTouch }) => {
  test.skip(!hasTouch, "touch");
  await addIdeas(page, 1);
  const link = page.getByRole("link", { name: /^Press 0/ });
  const box = (await link.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const session = await page.context().newCDPSession(page);

  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await expect.poll(() => link.evaluate((el) => el.hasAttribute("data-pressed"))).toBe(true);
  await expect.poll(() => link.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(page).toHaveURL(/\/ideas\/[0-9a-f-]+/);
});

test("a mouse still lifts a card on hover", { tag: "@desktop" }, async ({ page, hasTouch }) => {
  test.skip(hasTouch, "mouse");
  await addIdeas(page, 1);
  const link = page.getByRole("link", { name: /^Press 0/ });
  const shadow = () => link.evaluate((el) => getComputedStyle(el).boxShadow);
  const before = await shadow();
  await link.hover();
  await expect.poll(shadow).not.toBe(before);
  // …and the pressed look still comes with :active, with no data-pressed from the touch code.
  await page.mouse.down();
  await expect.poll(() => link.evaluate((el) => getComputedStyle(el).transform)).not.toBe("none");
  expect(await pressed(page)).toBe(0);
  await page.mouse.up();
});
