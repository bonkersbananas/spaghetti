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

test("a new attempt's sheet on a phone opens at its top, Claude's first idea whole @phone", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The phone's sheet");
  // "coach" in the title: the stand-in Claude suggests three ideas, which make the sheet taller than the screen.
  const id = await build(page, "Hook rail coach");
  await attempt(page, id, { outcome: "failed", printedAt: Date.now() - 3_600_000, note: "Corner lifted." });
  await expect
    .poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.attempts[0].coach?.status, {
      timeout: 30_000,
    })
    .toBe("ready");
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hook rail coach");
  await page.getByRole("button", { name: "Log attempt" }).last().tap();
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await expect(sheet).toBeVisible();
  // Past the sheet's opening and anything that settles after it: still at the top, the file row first in view.
  await page.waitForTimeout(1200);
  const top = await sheet.evaluate((node) => {
    const scroller = Array.from(node.querySelectorAll<HTMLElement>("*")).find(
      (element) => getComputedStyle(element).overflowY === "auto" && element.scrollHeight > element.clientHeight,
    );
    return scroller?.scrollTop ?? 0;
  });
  expect(top).toBe(0);
  await expect(sheet.getByText("Add a brim")).toBeVisible();
  // The sheet does scroll: what it holds is taller than the screen, so a scroll to its end would have shown.
  expect(
    await sheet.evaluate((node) =>
      Array.from(node.querySelectorAll<HTMLElement>("*")).some(
        (element) => getComputedStyle(element).overflowY === "auto" && element.scrollHeight > element.clientHeight + 40,
      ),
    ),
  ).toBe(true);
  await expect(sheet.getByRole("button", { name: /Add the slicer file/ })).toBeInViewport();
});

test("What worked says only what isn't already in view: no card beside a lone attempt, its note when it is further down @phone", async ({
  page,
}) => {
  const ms = 3_600_000;
  // One attempt, no settings: its card says Worked and its note right there, so there is no What worked card.
  const lone = await build(page, "Hook rail");
  await attempt(page, lone, {
    outcome: "success",
    printedAt: Date.now() - ms,
    note: "Snug on the rail.",
    settings: {},
  });
  await page.goto(`/builds/${lone}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hook rail");
  await expect(page.getByText("Snug on the rail.")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "What worked" })).toHaveCount(0);

  // Three attempts, the one in the middle worked: it is a row further down, so the card says its note.
  const three = await build(page, "Desk clamp");
  await attempt(page, three, { outcome: "failed", printedAt: Date.now() - 3 * ms, settings: {} });
  await attempt(page, three, {
    outcome: "success",
    printedAt: Date.now() - 2 * ms,
    note: "Tight on the desk.",
    settings: {},
  });
  await attempt(page, three, { outcome: "partial", printedAt: Date.now() - ms, settings: {} });
  await page.goto(`/builds/${three}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Desk clamp");
  const card = page.getByRole("region", { name: "What worked" });
  await expect(card).toContainText("What worked · attempt 2");
  await expect(card).toContainText("Tight on the desk.");

  // One attempt that worked with nothing to say: no card either.
  const bare = await build(page, "Spool holder");
  await attempt(page, bare, { outcome: "success", printedAt: Date.now() - ms, settings: {} });
  await page.goto(`/builds/${bare}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Spool holder");
  await expect(page.getByText("Attempt 1", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "What worked" })).toHaveCount(0);
});

test("a print stops asking which build it is once its build is done, on Today, the Journal and the build page @phone", async ({
  page,
  isMobile,
}) => {
  const { ownId, attemptId } = await bridgeFiles(page, "shelf-peg");
  const headers = { Origin: origin(page) };
  expect((await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: { outcome: "success" } })).ok()).toBe(
    true,
  );
  const where = isMobile ? "/journal" : "/today";
  const question = page.getByRole("region", { name: /Nothing matched/ });
  // Answered but not placed: it still asks.
  await page.goto(where);
  await expect(question.first()).toBeVisible();

  expect((await page.request.patch(`/api/items/${ownId}`, { headers, data: { stage: "done" } })).ok()).toBe(true);
  await page.goto(where);
  await expect(page.locator("h1").first()).toBeVisible();
  await expect(page.getByText("shelf-peg").first()).toBeVisible();
  // The question's code comes lazily: give it the moment it takes to show where it would.
  await page.waitForTimeout(1500);
  await expect(question).toHaveCount(0);
  if (!isMobile) {
    await expect(page.getByText("Which build?", { exact: true })).toHaveCount(0);
    await page.goto("/journal");
    await expect(page.getByText("shelf-peg").first()).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(question).toHaveCount(0);
  }
  await page.goto(`/builds/${ownId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("shelf-peg");
  await page.waitForTimeout(1500);
  await expect(question).toHaveCount(0);
});
