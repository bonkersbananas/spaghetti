import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/** Principle 7, second part: the sheets, the other screens' autosaves and two tabs. */
const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

async function makeBuild(page: Page) {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Sheet build", stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: { id: attemptId, outcome: "failed", note: "First note" },
  });
  return { id, attemptId };
}

const attemptNote = async (page: Page, id: string, attemptId: string) =>
  (
    (await (await page.request.get(`/api/items/${id}`)).json()) as {
      item: { attempts: Array<{ id: string; note: string }> };
    }
  ).item.attempts.find((a) => a.id === attemptId)?.note;

const openAttempt = async (page: Page) => {
  await page
    .getByRole("button", { name: /Attempt 1/ })
    .first()
    .click();
  const note = page.getByRole("textbox", { name: "Note" });
  await expect(note).toBeVisible();
  return note;
};

/**
 * What a killed tab leaves behind: the unsent words in localStorage (lib/unsent.ts). Playwright can't make a request
 * truly fail (a keepalive one still reaches the server), so the leftovers are written the way the app writes them.
 */
const leaveUnsent = (page: Page, name: string, value: Record<string, unknown>) =>
  page.addInitScript(
    ([key, text]) => localStorage.setItem(key as string, text as string),
    [`spaghetti:unsent:${name}`, JSON.stringify({ at: Date.now(), value })],
  );

test("an attempt note left unsent by a killed tab comes back and is saved", async ({ page }) => {
  const { id, attemptId } = await makeBuild(page);
  await leaveUnsent(page, `attempt:${attemptId}`, { note: "Typed at the printer with no signal" });
  await page.goto(`/builds/${id}`);
  await expect(await openAttempt(page)).toHaveValue("Typed at the printer with no signal");
  await expect
    .poll(() => attemptNote(page, id, attemptId), { timeout: 15_000 })
    .toBe("Typed at the printer with no signal");
});

test("closing the attempt sheet right after typing still saves the note", async ({ page }) => {
  const { id, attemptId } = await makeBuild(page);
  await page.goto(`/builds/${id}`);
  await (await openAttempt(page)).fill("Closed before the pause");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => attemptNote(page, id, attemptId)).toBe("Closed before the pause");
});

test("a spool note left unsent by a killed tab comes back and is saved", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const spoolId = crypto.randomUUID();
  await page.request.post("/api/spools", { headers, data: { id: spoolId, material: "PLA", note: "" } });
  await leaveUnsent(page, `spool:${spoolId}`, { note: "Dry it before use" });
  await page.goto(`/pantry/${spoolId}`);
  await expect(page.getByText("Dry it before use")).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/spools/${spoolId}`)).json()) as { spool: { note: string } }).spool.note,
      { timeout: 15_000 },
    )
    .toBe("Dry it before use");
  await page.request.delete(`/api/spools/${spoolId}`, { headers });
});

test("closing the capture sheet mid-note keeps the note for the next opening, even after a reload", async ({
  page,
  isMobile,
}) => {
  const open = async () => {
    if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
    else await page.keyboard.press("c");
    const sheet = page.getByRole("dialog", { name: "New idea" });
    await expect(sheet).toBeVisible();
    return sheet;
  };
  const sheet = await open();
  await sheet.getByRole("textbox", { name: "Note" }).fill("Half a thought");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  await expect(async () => {
    const again = await open();
    await expect(again.getByRole("textbox", { name: "Note" })).toHaveValue("Half a thought", { timeout: 1500 });
  }).toPass();
});

test("saved things are read-only with no connection, and editable again once it is back", async ({ page, context }) => {
  const { id } = await makeBuild(page);
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("button", { name: "Finish build" })).toBeEnabled();
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Finish build" })).toBeDisabled();
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Finish build" })).toBeEnabled();
  await page.getByRole("textbox", { name: "Title" }).fill("Back online");
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: { title: string } }).item.title,
    )
    .toBe("Back online");
});

test("two tabs on one idea: the later edit wins, and a tab never sends back what it hadn't touched", async ({
  page,
  context,
}) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Start", note: "Start note" } });
  const other = await context.newPage();
  await page.goto(`/ideas/${id}`);
  await other.goto(`/ideas/${id}`);
  const server = async () =>
    ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: { title: string; note: string } }).item;

  // The first tab edits the note; the second tab, still showing the old note, edits only the title.
  await page.getByRole("button", { name: "Edit note" }).click();
  await page.getByRole("textbox", { name: "Note" }).fill("Note from tab one");
  await expect.poll(async () => (await server()).note).toBe("Note from tab one");
  await other.getByRole("textbox", { name: "Title" }).fill("Title from tab two");
  await expect.poll(async () => (await server()).title).toBe("Title from tab two");
  expect((await server()).note).toBe("Note from tab one");

  // Both edit the title: the later one wins on the server, and in the earlier tab after it hears of it.
  await page.getByRole("textbox", { name: "Title" }).fill("First of the two");
  await expect.poll(async () => (await server()).title).toBe("First of the two");
  await other.getByRole("textbox", { name: "Title" }).fill("Last of the two");
  await expect.poll(async () => (await server()).title).toBe("Last of the two");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Last of the two");
});

test("a tick's late answer doesn't undo a rename made meanwhile", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  const thing = `Glue ${id.slice(0, 6)}`;
  await page.request.post("/api/shopping-items", { headers, data: { id, name: thing } });
  await page.goto("/shopping");
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held = 0;
  await page.route(`**/api/shopping-items/${id}`, async (route) => {
    const body = route.request().postDataJSON() as { bought?: boolean };
    if (route.request().method() !== "PATCH" || body.bought === undefined) return route.continue();
    held += 1;
    const response = await route.fetch();
    await gate;
    return route.fulfill({ response });
  });
  await page.getByRole("checkbox", { name: `Bought: ${thing}` }).click();
  await expect.poll(() => held).toBe(1);
  // Renamed in the sheet while the tick's answer is still on its way.
  await page.getByRole("list", { name: "Bought" }).getByRole("button", { name: thing, exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name").fill(`${thing} stick`);
  await expect
    .poll(async () => {
      const list = (await (await page.request.get("/api/shopping-items")).json()) as {
        shoppingItems: Array<{ id: string; name: string }>;
      };
      return list.shoppingItems.find((item) => item.id === id)?.name;
    })
    .toBe(`${thing} stick`);
  const answered = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/shopping-items/${id}`) &&
      response.request().method() === "PATCH" &&
      (response.request().postDataJSON() as { bought?: boolean }).bought !== undefined,
  );
  release();
  await answered;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("list", { name: "Bought" }).getByText(`${thing} stick`)).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole("list", { name: "Bought" }).getByText(thing, { exact: true })).toHaveCount(0);
  await page.request.delete(`/api/shopping-items/${id}`, { headers });
});
