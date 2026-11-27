import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers.ts";

/**
 * The daily printer loop, walked as the two people live it: a print on the bed, filed with "Which build?", answered,
 * and the build finished. Each test pins a defect found on that walk.
 */

const origin = (page: Page) => new URL(page.url()).origin;
const tokens: string[] = [];
let hadBridge = false;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  hadBridge = !!(await (await page.request.get("/api/printer")).json()).bridge;
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  if (tokens.length && !hadBridge)
    await page.request.delete("/api/printer/bridge", { headers: { Origin: origin(page) } });
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
  tokens.splice(0);
});

async function build(page: Page, title: string) {
  const id = crypto.randomUUID();
  const made = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title, stage: "building" },
  });
  expect(made.ok()).toBe(true);
  return id;
}

async function attempt(page: Page, itemId: string, data: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const made = await page.request.post(`/api/items/${itemId}/attempts`, {
    headers: { Origin: origin(page) },
    data: { id, settings: { estimatedMinutes: 90 }, ...data },
  });
  expect(made.ok()).toBe(true);
  return id;
}

async function photo(page: Page, itemId: string, file: string, attemptId?: string) {
  const buffer = readFileSync(`e2e/fixtures/${file}`);
  const put = await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers: { Origin: origin(page) },
    multipart: {
      width: "1200",
      height: "900",
      color: "#6b5a4a",
      ...(attemptId ? { attemptId } : {}),
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });
  expect(put.ok()).toBe(true);
}

/** What the bridge does when a print starts that nothing matches: a build of its own, then the attempt. */
async function bridgeFiles(page: Page, name: string) {
  if (!tokens[0]) {
    const made = await page.request.post("/api/agents", {
      headers: { Origin: origin(page) },
      data: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
    });
    tokens.push((await made.json()).token);
    const told = await page.request.put("/api/printer/bridge", {
      headers: { Origin: origin(page), Authorization: `Bearer ${tokens[0]}` },
      data: {},
    });
    expect(told.ok()).toBe(true);
  }
  const headers = { Origin: origin(page), Authorization: `Bearer ${tokens[0]}` };
  const ownId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  expect(
    (await page.request.post("/api/items", { headers, data: { id: ownId, title: name, stage: "building" } })).ok(),
  ).toBe(true);
  const filed = await page.request.post(`/api/items/${ownId}/attempts`, {
    headers,
    data: {
      id: attemptId,
      printedAt: Date.now() - 5 * 60_000,
      print: { name, gcodeFile: "Metadata/plate_1.gcode", plate: 1, estimateMinutes: 40 },
    },
  });
  expect(filed.ok()).toBe(true);
  return { ownId, attemptId };
}

test("Finish build leads the open page with the final print at once, not the photo it opened with @phone", async ({
  page,
}) => {
  // An idea with a photo of its own grew into a build: that photo leads until the build is done.
  const id = await build(page, "Hinge pin");
  await photo(page, id, "portrait.jpg");
  const worked = await attempt(page, id, { outcome: "success", printedAt: Date.now() - 3_600_000 });
  await photo(page, id, "tugboat.jpg", worked);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hinge pin");
  await expect(page.getByText("Final print", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Finish build" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  // The final print leads now, as it does after a reload.
  await expect(page.getByText("Final print", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Final print", { exact: true })).toBeVisible();
});

test("the move sheet says every build with a print on the bed is on the bed, not only the newest", async ({ page }) => {
  const first = await build(page, "Spool holder");
  await attempt(page, first, { printedAt: Date.now() - 20 * 60_000 });
  const second = await build(page, "Desk clamp");
  await attempt(page, second, { printedAt: Date.now() - 10 * 60_000 });
  const mine = await build(page, "Cable comb");
  const answered = await attempt(page, mine, { outcome: "success", printedAt: Date.now() - 3_600_000 });

  await page.goto(`/builds/${mine}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable comb");
  await page
    .locator(`[data-attempt-id="${answered}"]`)
    .getByRole("button", { name: /Options for attempt/ })
    .click();
  await page.getByRole("button", { name: "Move to another build" }).click();
  const sheet = page.getByRole("dialog", { name: "Move attempt 1" });
  for (const name of ["Spool holder", "Desk clamp"])
    await expect(sheet.getByRole("button", { name: new RegExp(name) })).toContainText("On the bed");
});

test("moving a print with Which build? from the keyboard keeps the focus on its card", async ({ page, isMobile }) => {
  test.skip(isMobile, "The keyboard is the desktop's");
  await build(page, "Herb planter");
  await bridgeFiles(page, "planter-v2(2)");
  await page.goto("/today");
  const cardByName = page.locator("article").filter({ hasText: "planter-v2(2)" });
  const which = cardByName.getByRole("button", { name: "Which build?" });
  await expect(which).toBeVisible();
  await which.focus();
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Which build is this?" });
  await expect(sheet.getByRole("searchbox", { name: "Search builds" })).toBeFocused();
  await page.keyboard.type("herb");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Moved to Herb planter")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The question went with the move; the print's card (now the herb planter's) keeps the keyboard's place.
  const moved = page.locator("article").filter({ hasText: "Herb planter" });
  await expect(moved.getByRole("button", { name: "How did it go?" })).toBeVisible();
  await expect.poll(() => moved.evaluate((node) => node.contains(document.activeElement))).toBe(true);
});

test("a bed card's How did it go? stays held on a phone until the build page arrives @phone", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The held look after a lift is the phone's");
  const id = await build(page, "Hinge pin");
  await attempt(page, id, { printedAt: Date.now() - 5 * 60_000 });
  // The build page's code is slow to come: the tap's answer must not end before it does.
  const held: Array<() => void> = [];
  await page.route(/\/assets\/builds\._buildId-[\w-]+\.js$/, (route) => {
    held.push(() => void route.continue().catch(() => {}));
  });
  await page.goto("/journal");
  const ask = page.locator("article").filter({ hasText: "Hinge pin" }).getByRole("button", { name: "How did it go?" });
  await expect(ask).toBeVisible();
  await ask.tap();
  await expect(ask).toHaveAttribute("data-pressed", "held");
  // Past touch-press's own release of a quick tap (110 ms), it still looks pressed.
  await page.waitForTimeout(400);
  await expect(ask).toHaveAttribute("data-pressed", "held");
  for (const release of held.splice(0)) release();
  await page.unroute(/\/assets\/builds\._buildId-[\w-]+\.js$/);
  await expect(page.getByRole("dialog", { name: "Attempt 1" })).toBeVisible();
});
