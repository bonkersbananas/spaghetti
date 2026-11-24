import { expect, type Page, test } from "@playwright/test";
import { SEED_USERS } from "../scripts/lib/local-app.ts";
import { slicerFile } from "./fixtures/slicer-file.ts";
import { clearIdeas, signIn } from "./helpers.ts";

/**
 * Which build a print belongs to (decision 0076): the printer bridge files a print in a build of its own, the app asks
 * "Which build is this?" (or puts it straight in the build it fits), a tap moves it with its photos, and Undo puts it
 * back as it was. On phones and desktops alike: it is answered standing at the printer as often as at the desk.
 */

const origin = (page: Page) => new URL(page.url()).origin;
const tokens: string[] = [];
let hadBridge = false;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  hadBridge = !!(await (await page.request.get("/api/printer")).json()).bridge;
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  // The test's bridge goes again where there was none.
  if (tokens.length && !hadBridge)
    await page.request.delete("/api/printer/bridge", { headers: { Origin: origin(page) } });
  // Leave no working token behind.
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
  tokens.splice(0);
});

async function bridgeToken(page: Page) {
  if (tokens[0]) return tokens[0];
  const made = await page.request.post("/api/agents", {
    headers: { Origin: origin(page) },
    data: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
  });
  expect(made.ok()).toBe(true);
  const { token } = await made.json();
  tokens.push(token);
  // The bridge says it is there, as a real one does: only its agent's prints are matched (decision 0076).
  const told = await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin(page), Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(told.ok()).toBe(true);
  return token as string;
}

/**
 * A build started half an hour ago (or `startedAgo` ms) keeping a slicer file named `fileName`, as Spaghetti or Bambu
 * Studio left it. Started within two hours of a print, a build is a step likelier to be its home (decision 0076).
 */
async function buildKeeping(
  page: Page,
  title: string,
  fileName: string,
  { startedAgo = 30 * 60_000, stage = "building" }: { startedAgo?: number; stage?: "building" | "idea" } = {},
) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  const made = await page.request.post("/api/items", {
    headers,
    data: { id, title, stage, createdAt: Date.now() - startedAgo },
  });
  expect(made.ok()).toBe(true);
  const bytes = slicerFile();
  const kept = await page.request.put(`/api/items/${id}/files/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      name: fileName,
      size: String(bytes.length),
      plate: "1",
      plateCount: "1",
      prefill: "{}",
      file: { name: fileName, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) },
    },
  });
  expect(kept.ok()).toBe(true);
  return id;
}

/** What the bridge does when a print starts: a build of its own, then the attempt with what the printer said. */
async function bridgeFiles(page: Page, name: string) {
  const headers = { Origin: origin(page), Authorization: `Bearer ${await bridgeToken(page)}` };
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
  const { attempt } = await filed.json();
  return { ownId, attemptId, itemId: attempt.itemId as string };
}

/** The build an attempt is in now, by the server. */
async function homeOf(page: Page, attemptId: string, ids: string[]) {
  for (const id of ids) {
    const response = await page.request.get(`/api/items/${id}`, { maxRedirects: 0 });
    if (!response.ok()) continue;
    const { item } = await response.json();
    const attempt = item.attempts.find((one: { id: string }) => one.id === attemptId);
    if (attempt) return { itemId: item.id as string, asking: !!attempt.print?.asking };
  }
  return null;
}

const DAYS = 24 * 60 * 60_000;

test("the build page asks which build a print is in one line: Yes puts it there, and Undo asks again", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  // One build keeps the print's file, another only has its name: close enough to ask, and the file is likelier.
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  const balcony = await buildKeeping(page, "Planter v2", "balcony.gcode.3mf", { startedAgo: 3 * DAYS });
  const { ownId, attemptId, itemId } = await bridgeFiles(page, "planter-v2(2)");
  expect(itemId).toBe(ownId);

  await page.goto(`/builds/${ownId}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  const question = entry.getByRole("region", { name: "Is this Herb planter?" });
  await expect(question).toBeVisible();
  await expect(question.getByText("Same file: planter-v2")).toBeVisible();
  const yes = question.getByRole("button", { name: "Yes" });
  // A real control of the system's size, not a link in a sentence: 32 px drawn, a thumb's 44 px on a phone.
  const box = await yes.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(32);
  if (isMobile) {
    const target = await yes.evaluate((node) => getComputedStyle(node, "::after").height);
    expect(Number.parseFloat(target)).toBeGreaterThanOrEqual(44);
  }
  await yes.click();

  // The printer's build went with it, and the page follows the print into the herb planter.
  await expect(page.getByText("Moved to Herb planter")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/builds/${planter}`));
  await expect(page.getByRole("heading", { level: 1, name: "Herb planter" })).toBeVisible();
  await expect
    .poll(() => homeOf(page, attemptId, [planter, ownId, balcony]))
    .toEqual({
      itemId: planter,
      asking: false,
    });
  // The printer's own build is gone with it: its address leads to the herb planter.
  const merged = await page.request.get(`/api/items/${ownId}`, { maxRedirects: 0 });
  expect(merged.status()).toBe(308);
  expect(merged.headers().location).toBe(`/api/items/${planter}`);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => homeOf(page, attemptId, [planter, ownId, balcony])).toEqual({ itemId: ownId, asking: true });
  await page.goto(`/builds/${ownId}`);
  await expect(page.getByRole("region", { name: "Is this Herb planter?" })).toBeVisible();
});

test("the print's card on Today and the Journal asks which build it is, next to How did it go: Yes files it for both people, Undo asks again", {
  tag: "@phone",
}, async ({ page, browser, isMobile }) => {
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  await buildKeeping(page, "Planter v2", "balcony.gcode.3mf", { startedAgo: 3 * DAYS });
  const { ownId, attemptId } = await bridgeFiles(page, "planter-v2(2)");

  // Phones have no Today: the Journal's Now shows the print on the bed.
  const where = isMobile ? "/journal" : "/today";
  // Sam has the same screen open.
  const samContext = await browser.newContext({
    baseURL: origin(page),
    viewport: page.viewportSize(),
    isMobile,
    hasTouch: isMobile,
  });
  const sam = await samContext.newPage();
  await signIn(sam, SEED_USERS[1], origin(page));
  await sam.goto(where);

  await page.goto(where);
  const question = page.getByRole("region", { name: "Is this Herb planter?" });
  await expect(question).toBeVisible();
  // It is asked where the print is answered: the card's own "How did it go?" is right there.
  const card = page.locator("article").filter({ has: question });
  await expect(card.getByRole("button", { name: "How did it go?" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "planter-v2(2)" })).toBeVisible();
  await expect(sam.getByRole("region", { name: "Is this Herb planter?" })).toBeVisible();

  const yes = question.getByRole("button", { name: "Yes" });
  if (isMobile) await yes.tap();
  else {
    // At the desk, by keyboard: the answer is a stop on the way through the card.
    await yes.focus();
    await expect(yes).toBeFocused();
    await page.keyboard.press("Enter");
  }
  // At once: the card is the herb planter's now, and the question is gone.
  await expect(page.getByText("Moved to Herb planter")).toBeVisible();
  await expect(question).toHaveCount(0);
  // The printer's build went with it: no card is called planter-v2(2) any more.
  await expect(page.getByRole("heading", { name: "planter-v2(2)" })).toHaveCount(0);
  await expect.poll(() => homeOf(page, attemptId, [planter, ownId])).toEqual({ itemId: planter, asking: false });
  // And for Sam too, by the change feed.
  await sam.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(sam.getByRole("region", { name: "Is this Herb planter?" })).toHaveCount(0);
  await expect(sam.getByRole("heading", { name: "planter-v2(2)" })).toHaveCount(0);
  await samContext.close();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => homeOf(page, attemptId, [planter, ownId])).toEqual({ itemId: ownId, asking: true });
  await expect(page.getByRole("region", { name: "Is this Herb planter?" })).toBeVisible();
});

test("“Another build” opens the sheet, likely builds first, and search finds the one to pick", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  const balcony = await buildKeeping(page, "Planter v2", "balcony.gcode.3mf", { startedAgo: 3 * DAYS });
  const shelf = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id: shelf, title: "Spice shelf", stage: "building", createdAt: Date.now() - 6 * DAYS },
  });
  const { ownId, attemptId } = await bridgeFiles(page, "planter-v2(2)");

  await page.goto(isMobile ? "/journal" : "/today");
  const question = page.getByRole("region", { name: "Is this Herb planter?" });
  await question.getByRole("button", { name: "Another build" }).click();
  const sheet = page.getByRole("dialog", { name: "Which build is this?" });
  // The other guess leads; the one passed over drops to its place among the builds in progress.
  await expect(sheet.getByText("Most likely")).toBeVisible();
  const other = sheet.getByRole("button", { name: /^Planter v2/ });
  const passed = sheet.getByRole("button", { name: /^Herb planter/ });
  await expect(other).toBeVisible();
  await expect(passed).toHaveCount(1);
  expect((await other.boundingBox())?.y ?? 0).toBeLessThan((await passed.boundingBox())?.y ?? 0);
  await expect(sheet.getByRole("button", { name: /^Spice shelf/ })).toBeAttached();

  const search = sheet.getByRole("searchbox", { name: "Search builds" });
  if (isMobile) {
    // Within the thumb's reach: the field is at the sheet's foot, under the list.
    const field = await search.boundingBox();
    const list = await sheet.getByRole("button", { name: /^Planter v2/ }).boundingBox();
    expect(field && list && field.y > list.y).toBe(true);
    await search.tap();
  } else await expect(search).toBeFocused();
  await search.fill("spice");
  await expect(sheet.getByRole("button", { name: /^Planter v2/ })).toHaveCount(0);
  if (isMobile) await sheet.getByRole("button", { name: /^Spice shelf/ }).tap();
  else await page.keyboard.press("Enter");

  await expect(sheet).toBeHidden();
  await expect(page.getByText("Moved to Spice shelf")).toBeVisible();
  await expect
    .poll(() => homeOf(page, attemptId, [shelf, planter, balcony, ownId]))
    .toEqual({ itemId: shelf, asking: false });
});

test("a print nothing matches asks “Which build?”, and search finds an idea to start with it", {
  tag: "@phone",
}, async ({ page }) => {
  const idea = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id: idea, title: "Spice jar lids", stage: "idea" },
  });
  const { ownId, attemptId } = await bridgeFiles(page, "cable-clip-v3");

  await page.goto(`/builds/${ownId}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  // The build is named after the job already, so the line doesn't say the name again.
  await expect(entry.getByText("Nothing matched this print.")).toBeVisible();
  await entry.getByRole("button", { name: "Which build?" }).click();
  const sheet = page.getByRole("dialog", { name: "Which build is this?" });
  // "Its own build" answers it as it stands.
  await expect(sheet.getByRole("button", { name: /^Its own build/ })).toBeVisible();
  await sheet.getByRole("searchbox", { name: "Search builds" }).fill("jar lids");
  await sheet.getByRole("button", { name: /^Spice jar lids/ }).click();
  await expect(page.getByText("Moved to Spice jar lids")).toBeVisible();
  await expect.poll(() => homeOf(page, attemptId, [idea, ownId])).toEqual({ itemId: idea, asking: false });
  const { item } = await (await page.request.get(`/api/items/${idea}`)).json();
  expect(item.stage).toBe("building");
});

test("an answered print still asks on Today and the Journal: two as likely are both offered, one tap each", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  // Both keep the file: as likely as each other, so the question names both.
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  const balcony = await buildKeeping(page, "Balcony planters", "planter-v2.gcode.3mf", { startedAgo: 3 * DAYS });
  const { ownId, attemptId } = await bridgeFiles(page, "planter-v2(2)");
  // People answer "How did it go?" first: the print is off the bed, and still in its own build.
  const answered = await page.request.patch(`/api/attempts/${attemptId}`, {
    headers: { Origin: origin(page) },
    data: { outcome: "success" },
  });
  expect(answered.ok()).toBe(true);

  await page.goto(isMobile ? "/journal" : "/today");
  const question = page.getByRole("region", { name: "Is this Herb planter or Balcony planters?" });
  await expect(question).toBeVisible();
  await expect(question.getByText("Both print planter-v2.")).toBeVisible();
  // Its card says how it went, and asks nothing else.
  const card = page.locator("article").filter({ has: question });
  await expect(card.getByText("Worked")).toBeVisible();
  await expect(card.getByRole("button", { name: "How did it go?" })).toHaveCount(0);

  await question.getByRole("button", { name: "Balcony planters" }).click();
  await expect(page.getByText("Moved to Balcony planters")).toBeVisible();
  // Placed: nothing is left to ask, so the card goes (the Journal's rows still name the build until they refresh).
  await expect(question).toHaveCount(0);
  // Undo while the toast is up (6 s): the question is back.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => homeOf(page, attemptId, [balcony, planter, ownId])).toEqual({ itemId: ownId, asking: true });
  await expect(page.getByRole("region", { name: "Is this Herb planter or Balcony planters?" })).toBeVisible();
});

test("the Journal's row for a print still asking shows the same line under its card, and Yes files it", async ({
  page,
  isMobile,
}) => {
  // Phones: the Journal's Now asks for a recent print, and its row is left out of the notebook under it.
  test.skip(isMobile, "the desktop Journal's row");
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  await buildKeeping(page, "Planter v2", "balcony.gcode.3mf", { startedAgo: 3 * DAYS });
  const { ownId, attemptId } = await bridgeFiles(page, "planter-v2(2)");
  await page.request.patch(`/api/attempts/${attemptId}`, {
    headers: { Origin: origin(page) },
    data: { outcome: "success" },
  });

  await page.goto("/journal");
  const question = page.getByRole("region", { name: "Is this Herb planter?" });
  await expect(question).toBeVisible();
  // Right under the card, not inside its link.
  expect(await question.evaluate((node) => node.closest("a"))).toBeNull();
  await question.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("Moved to Herb planter")).toBeVisible();
  await expect(question).toHaveCount(0);
  await expect.poll(() => homeOf(page, attemptId, [planter, ownId])).toEqual({ itemId: planter, asking: false });
});

test("the attempt's sheet asks it too: answering the outcome leaves the question, and Yes takes the sheet along", {
  tag: "@phone",
}, async ({ page }) => {
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  await buildKeeping(page, "Planter v2", "balcony.gcode.3mf", { startedAgo: 3 * DAYS });
  const { ownId, attemptId } = await bridgeFiles(page, "planter-v2(2)");

  // "How did it go?" from Today or the Journal lands here.
  await page.goto(`/builds/${ownId}?attempt=${attemptId}&finish=1`);
  // "Finish attempt 1" until the answer is saved, "Attempt 1" after.
  const sheet = page.getByRole("dialog", { name: /attempt 1$/i });
  const question = sheet.getByRole("region", { name: "Is this Herb planter?" });
  await expect(question).toBeVisible();
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await expect(sheet.getByRole("radio", { name: "Worked", checked: true })).toBeVisible();
  await expect(question).toBeVisible();
  const outcome = async () => {
    const response = await page.request.get(`/api/items/${planter}`);
    const { item } = await response.json();
    return item.attempts.find((one: { id: string }) => one.id === attemptId)?.outcome ?? null;
  };
  // The answer is saved before the print moves (autosave), and goes with it.
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${ownId}`)).json();
      return item.attempts[0].outcome;
    })
    .toBe("success");

  await question.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByText("Moved to Herb planter")).toBeVisible();
  // The sheet follows the print into the herb planter, answered, without the question.
  await expect(page).toHaveURL(new RegExp(`/builds/${planter}`));
  const there = page.getByRole("dialog", { name: /^Attempt 1/ });
  await expect(there).toBeVisible();
  await expect(there.getByRole("radio", { name: "Worked", checked: true })).toBeVisible();
  await expect(there.getByRole("region", { name: /^Is this / })).toHaveCount(0);
  await expect.poll(outcome).toBe("success");
});

test("a print that really is new is answered in one tap: “Keep it as its own”, with Undo", { tag: "@phone" }, async ({
  page,
}) => {
  const { ownId, attemptId } = await bridgeFiles(page, "cable-clip-v3");
  await page.goto(`/builds/${ownId}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  await entry.getByRole("button", { name: "Keep it as its own" }).click();
  await expect(page.getByText("Kept in its own build")).toBeVisible();
  await expect(entry.getByText("Nothing matched this print.")).toHaveCount(0);
  await expect.poll(() => homeOf(page, attemptId, [ownId])).toEqual({ itemId: ownId, asking: false });
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(entry.getByText("Nothing matched this print.")).toBeVisible();
  await expect.poll(() => homeOf(page, attemptId, [ownId])).toEqual({ itemId: ownId, asking: true });
});

test("a print the app placed says why, and “Not this build?” moves it with one tap", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  // Only one build keeps the ring's file, and it was started just before: the print goes straight in.
  const glass = await buildKeeping(page, "UÖBF glass markers", "UOBF-fit-test-ring.3mf");
  const coasters = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id: coasters, title: "Cork coasters", stage: "building" },
  });
  const { ownId, attemptId, itemId } = await bridgeFiles(page, "UOBF-fit-test-ring(2)");
  expect(itemId).toBe(glass);

  // The printer's build went into the glass markers: its address leads there, and the page takes the real one.
  await page.goto(`/builds/${ownId}`);
  await expect(page).toHaveURL(new RegExp(`/builds/${glass}`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("UÖBF glass markers");
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  await expect(entry.getByText("Filed here: it printed UOBF-fit-test-ring, this build's file.")).toBeVisible();
  const notThis = entry.getByRole("button", { name: "Not this build?" });
  if (isMobile) {
    // Words in a sentence, with a thumb's target all the same.
    const target = await notThis.evaluate((node) => getComputedStyle(node, "::after").height);
    expect(Number.parseFloat(target)).toBeGreaterThanOrEqual(44);
  }
  await notThis.click();

  const sheet = page.getByRole("dialog", { name: "Move attempt 1" });
  await expect(sheet.getByText("The printer calls it UOBF-fit-test-ring(2).", { exact: false })).toBeVisible();
  await sheet.getByRole("button", { name: /^Cork coasters/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Moved to Cork coasters")).toBeVisible();
  await expect
    .poll(() => homeOf(page, attemptId, [coasters, glass, ownId]))
    .toEqual({
      itemId: coasters,
      asking: false,
    });
  // The glass markers' page no longer shows it.
  await expect(entry).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => homeOf(page, attemptId, [coasters, glass, ownId]))
    .toEqual({
      itemId: glass,
      asking: false,
    });
  await expect(entry.getByText("Filed here: it printed UOBF-fit-test-ring, this build's file.")).toBeVisible();
});

test("a print from the printer names nobody until someone says who started it, with Undo", { tag: "@phone" }, async ({
  page,
}) => {
  // Two builds keep its file, so the printer asks which: who started it is never a second question beside that.
  await buildKeeping(page, "Desk cable clips", "cable-clip-v3.gcode.3mf");
  await buildKeeping(page, "Cable clips for the shelf", "cable-clip-v3.gcode.3mf");
  // Alex paired the bridge (its token is Alex's), but the print is the printer's: nobody is named for it.
  const { ownId, attemptId } = await bridgeFiles(page, "cable-clip-v3(2)");
  await page.goto(`/builds/${ownId}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  const nobody = entry.getByRole("button", { name: "From the printer. Say who started it" });
  await expect(nobody).toBeVisible();
  await expect(entry.getByRole("img", { name: /Alex Rivera/ })).toHaveCount(0);
  // The build the printer made says so too, and the question stays the only question on it.
  await expect(page.getByText(/^Made by the printer/)).toBeVisible();
  await expect(page.getByRole("region", { name: /^Is this / })).toBeVisible();

  const startedBy = async () =>
    (await (await page.request.get(`/api/items/${ownId}`)).json()).item.attempts[0].startedBy as string | null;

  await nobody.click();
  const picker = page.getByRole("dialog", { name: "Who started it?" });
  await picker.getByRole("button", { name: "Sam Okafor" }).click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("Started by Sam Okafor")).toBeVisible();
  const sam = entry.getByRole("button", { name: "Sam Okafor · from the printer. Change who started it" });
  await expect(sam).toBeVisible();
  await expect.poll(startedBy).not.toBeNull();

  // Undo: the printer's again.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(nobody).toBeVisible();
  await expect.poll(startedBy).toBeNull();

  // Naming yourself, after a reload: it holds.
  await nobody.click();
  await picker.getByRole("button", { name: "You" }).click();
  await expect(page.getByText("Started by you")).toBeVisible();
  await page.reload();
  await expect(
    entry.getByRole("button", { name: "Alex Rivera · from the printer. Change who started it" }),
  ).toBeVisible();
});

test("Today counts only what is on the bed: an answered print that asks which build waits under “Which build?”", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Phones have no Today: the Journal's Now block has no counts.");
  const headers = { Origin: origin(page) };
  for (const title of ["First plate", "Second plate"]) {
    const id = crypto.randomUUID();
    await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
    const made = await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        outcome: null,
        printedAt: Date.now() - 10 * 60_000,
        settings: { estimatedMinutes: 120 },
      },
    });
    expect(made.ok()).toBe(true);
  }
  const { attemptId } = await bridgeFiles(page, "cable-clip-v3");
  await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: { outcome: "success" } });

  await page.goto("/today");
  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByRole("heading", { name: "First plate" })).toBeVisible();
  await expect(bed.getByRole("heading", { name: "cable-clip-v3" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "On the bed" })).toContainText("2");
  await expect(bed.getByRole("article")).toHaveCount(2);
  const which = page.getByRole("region", { name: /^Which build\?/ });
  await expect(which.getByRole("article")).toHaveCount(1);
});

test("a hand-logged print is off the bed once the printer reports a later one", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const handItem = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: handItem, title: "Hand logged", stage: "building" } });
  await page.request.post(`/api/items/${handItem}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: null,
      printedAt: Date.now() - 60 * 60_000,
      settings: { estimatedMinutes: 240 },
    },
  });
  const { attemptId } = await bridgeFiles(page, "planter-v2(2)");
  const told = await page.request.put("/api/printer/bridge", {
    headers: { ...headers, Authorization: `Bearer ${await bridgeToken(page)}` },
    data: { printerState: "printing", progress: { attemptId, percent: 12, remainingMinutes: 30 } },
  });
  expect(told.ok()).toBe(true);

  const attempts = (await (await page.request.get(`/api/items/${handItem}`)).json()).item.attempts;
  expect(attempts[0].endedAt).not.toBeNull();
  await page.goto("/today");
  const card = page.getByRole("article").filter({ hasText: "Hand logged" });
  await expect(card.getByText(/Off the bed at .* · how did it go\?/)).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
});
