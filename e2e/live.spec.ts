import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { signIn as signInThroughApi } from "./helpers";

const [alex, sam] = SEED_USERS;

const signInAs = (page: Page, user: { username: string }) => signInThroughApi(page, user);

/** The app's origin (the pages may not have loaded anything yet). */
const origin = (_page?: Page) => new URL(test.info().project.use.baseURL ?? "").origin;

/** What the app does when the window regains focus: ask the feed right away. */
const focus = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("focus")));

/** What the other person's phone does, through the API with their own session. */
async function create(as: Page, data: Record<string, unknown>) {
  const response = await as.request.post("/api/items", { headers: { Origin: origin(as) }, data });
  expect(response.ok()).toBe(true);
}

const photoParts = async (page: Page) => {
  const buffer = await (await import("node:fs/promises")).readFile("e2e/fixtures/tugboat.jpg");
  return {
    width: "1600",
    height: "1200",
    color: "#a08060",
    large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
    thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
  };
};

test.afterEach(async ({ browser }) => {
  // Leave nothing behind: the other specs expect an empty workshop.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.request.post("/api/session", {
    headers: { Origin: origin(page) },
    data: { username: alex.username, password: SEED_PASSWORD },
  });
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
  await context.close();
});

test("one person's attempt and photo show up on the other's open build, without touching what they are typing", async ({
  page,
  browser,
}) => {
  const samContext = await browser.newContext({ viewport: page.viewportSize(), baseURL: origin() });
  const samPage = await samContext.newPage();
  await signInAs(page, alex);
  await signInAs(samPage, sam);

  const id = crypto.randomUUID();
  await create(page, { id, title: "Cable chain", note: "For the back of the X2D", stage: "building" });
  await page.goto(`/builds/${id}`);
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue("Cable chain");
  await expect(page.getByRole("img", { name: /Attempt 1/ })).toHaveCount(0);

  // Alex is typing in the title; Sam renames the build, logs an attempt and adds a photo to it.
  await title.focus();
  await title.press("End");
  await title.pressSequentially(" v2");
  const attemptId = crypto.randomUUID();
  const sent = [
    await samPage.request.patch(`/api/items/${id}`, {
      headers: { Origin: origin(samPage) },
      data: { note: "For the back of the X2D, with a clip" },
    }),
    await samPage.request.post(`/api/items/${id}/attempts`, {
      headers: { Origin: origin(samPage) },
      data: { id: attemptId, outcome: "failed", note: "Let go of the bed at 40%" },
    }),
    await samPage.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
      headers: { Origin: origin(samPage) },
      multipart: { ...(await photoParts(samPage)), attemptId },
    }),
  ];
  for (const response of sent) expect(response.ok()).toBe(true);

  // Alex's screen follows on its own, with one quiet word (the feed is asked every ten seconds and when the window
  // regains focus: the test wakes it the way coming back to the tab does, instead of waiting for the next round).
  await focus(page);
  const attempts = page.getByRole("list", { name: "Attempts, newest first" });
  await expect(attempts.getByText("Let go of the bed at 40%")).toBeVisible();
  await expect(attempts.getByRole("img", { name: "Attempt 1" })).toBeVisible();
  await expect(page.getByText("Sam Okafor logged an attempt")).toBeVisible();
  // What Alex was typing is theirs: kept as typed, and saved.
  await expect(title).toHaveValue("Cable chain v2");
  await expect(title).toBeFocused();
  // The note Sam edited, which Alex wasn't touching, followed.
  await page.getByRole("button", { name: "Edit note" }).click();
  await expect(page.getByRole("textbox", { name: "Note" })).toHaveValue("For the back of the X2D, with a clip");
  await page.keyboard.press("Escape");
  await expect
    .poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.title)
    .toBe("Cable chain v2");

  // A photo on its own: "Sam Okafor added a photo".
  await samPage.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
    headers: { Origin: origin(samPage) },
    multipart: await photoParts(samPage),
  });
  await focus(page);
  await expect(page.getByText("Sam Okafor added a photo")).toBeVisible();

  // Deleted by the other person while it is open: the screen closes with a quiet word, no error.
  await samPage.request.delete(`/api/items/${id}`, { headers: { Origin: origin(samPage) } });
  await focus(page);
  await expect(page).toHaveURL(/\/builds$/);
  await expect(page.getByText("Sam Okafor deleted this build")).toBeVisible();
  await expect(page.getByText("went wrong")).toHaveCount(0);
  await samContext.close();
});

test("a new idea from the other person lands in the inbox, and the list keeps its place", async ({ page, browser }) => {
  const samContext = await browser.newContext({ viewport: page.viewportSize(), baseURL: origin() });
  const samPage = await samContext.newPage();
  await signInAs(page, alex);
  await signInAs(samPage, sam);

  for (let index = 0; index < 14; index++) {
    await create(page, {
      id: crypto.randomUUID(),
      note: `Idea number ${index}`,
      createdAt: Date.now() - 60_000 * (index + 1),
    });
  }
  await page.reload();
  const ideas = page.getByRole("list", { name: "Ideas" });
  await expect(ideas.getByRole("link")).toHaveCount(14);

  // Alex is scrolled down the inbox, looking at one card.
  const watched = ideas.getByRole("link", { name: /Idea number 8/ });
  await watched.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 150));
  const before = await watched.boundingBox();

  await create(samPage, { id: crypto.randomUUID(), note: "Sam's spool holder" });
  await focus(page);
  await expect(ideas.getByRole("link", { name: /Sam's spool holder/ })).toHaveCount(1);
  await expect(ideas.getByRole("link")).toHaveCount(15);
  // Their avatar is on the card, as on any idea (named by their full name).
  await expect(
    ideas.getByRole("link", { name: /Sam's spool holder/ }).getByRole("img", { name: /^Sam/ }),
  ).toBeVisible();
  // Nobody asked for a toast for a card landing.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  // The card Alex was looking at stayed where it was.
  await page.waitForTimeout(800);
  const after = await watched.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  await samContext.close();
});

test("the spool page and the printer setup follow the other person's edits, and a save sends only what was changed here", async ({
  page,
  browser,
}) => {
  const samContext = await browser.newContext({ viewport: page.viewportSize(), baseURL: origin() });
  const samPage = await samContext.newPage();
  await signInAs(page, alex);
  await signInAs(samPage, sam);
  const headers = { Origin: origin() };
  const spoolId = crypto.randomUUID();
  const created = await page.request.post("/api/spools", {
    headers,
    data: { id: spoolId, material: "PLA", brand: "Bambu", colorName: "Jade white", remaining: "full" },
  });
  expect(created.ok()).toBe(true);
  const spoolOnServer = async () =>
    (await (await page.request.get("/api/spools")).json()).spools.find((spool: { id: string }) => spool.id === spoolId);

  try {
    // Alex has the spool open. Sam marks it low and writes a note, from his own screen.
    await page.goto(`/pantry/${spoolId}`);
    const brand = page.getByRole("textbox", { name: "Brand" });
    await expect(brand).toHaveValue("Bambu");
    const patched = await samPage.request.patch(`/api/spools/${spoolId}`, {
      headers,
      data: { remaining: "low", note: "Dry it first" },
    });
    expect(patched.ok()).toBe(true);

    // Before Alex's screen has heard, Alex adds to the brand: that save carries the brand and nothing else.
    await brand.focus();
    await brand.press("End");
    await brand.pressSequentially(" Eco");
    await expect.poll(async () => (await spoolOnServer()).brand).toBe("Bambu Eco");
    const after = await spoolOnServer();
    expect(after.remaining).toBe("low");
    expect(after.note).toBe("Dry it first");

    // Alex's screen takes Sam's edits on its own (the window regaining focus asks the feed at once, as it does
    // for a person coming back to the tab), and what Alex typed stays.
    await focus(page);
    await expect(page.getByRole("radio", { name: "Low" })).toBeChecked();
    await expect(brand).toHaveValue("Bambu Eco");

    // The printer's setup works the same way, a part at a time.
    await page.goto("/printer");
    await expect(page.getByText("Combo · 1 AMS 2 Pro")).toBeVisible();
    const sent = await samPage.request.put("/api/printer", { headers, data: { amsUnits: 2 } });
    expect(sent.ok()).toBe(true);
    await page.getByRole("button", { name: "Cool Plate" }).click();
    await expect
      .poll(async () => (await (await page.request.get("/api/printer")).json()).setup.plates)
      .toContain("Cool Plate");
    // Alex's save didn't undo Sam's change, and Alex's screen shows it.
    expect((await (await page.request.get("/api/printer")).json()).setup.amsUnits).toBe(2);
    await focus(page);
    await expect(page.getByText("Combo · 2 AMS 2 Pro")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cool Plate" })).toHaveAttribute("aria-pressed", "true");
  } finally {
    await page.request.delete(`/api/spools/${spoolId}`, { headers });
    await page.request.put("/api/printer", {
      headers,
      data: { amsUnits: 1, plates: ["Textured PEI Plate"] },
    });
    await samContext.close();
  }
});

test("the attempt sheet follows the other person's edits and the printer's report, and a save sends only what was changed here", async ({
  page,
  browser,
}) => {
  const samContext = await browser.newContext({ viewport: page.viewportSize(), baseURL: origin() });
  const samPage = await samContext.newPage();
  await signInAs(page, alex);
  await signInAs(samPage, sam);
  const headers = { Origin: origin() };
  const buildId = crypto.randomUUID();
  const finished = crypto.randomUUID();
  const printing = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Cable chain", stage: "building" } });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: finished,
      outcome: "partial",
      note: "Original",
      settings: { bedTemperature: 60, layerHeight: 0.2, infillDensity: 15 },
    },
  });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: { id: printing, outcome: null, settings: { estimatedMinutes: 90 } },
  });
  const attemptOnServer = async (id: string) =>
    (await (await page.request.get(`/api/items/${buildId}`)).json()).item.attempts.find(
      (attempt: { id: string }) => attempt.id === id,
    );

  // Alex has the finished attempt open, with its settings showing.
  await page.goto(`/builds/${buildId}`);
  await page
    .locator(`[data-attempt-id="${finished}"]`)
    .getByRole("button", { name: /Open$/ })
    .click({ position: { x: 6, y: 6 } });
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet.getByRole("textbox", { name: "Note" })).toHaveValue("Original");
  await sheet.getByRole("button", { name: /^Settings \d/ }).click();
  await expect(sheet.getByLabel("Infill", { exact: true })).toHaveValue("15");

  // Sam, meanwhile: a success note, a nozzle temperature and a finer layer height.
  const sent = await samPage.request.patch(`/api/attempts/${finished}`, {
    headers,
    data: {
      successNotes: ["great-first-layer"],
      settingsMerge: { set: { nozzleTemperature: 230, layerHeight: 0.16 } },
    },
  });
  expect(sent.ok()).toBe(true);

  // Before Alex's screen has heard, Alex changes the infill and adds to the note. Those saves carry those two
  // fields and nothing else: Sam's tag and settings are still there afterwards.
  const infill = sheet.getByLabel("Infill", { exact: true });
  await infill.fill("20");
  const note = sheet.getByRole("textbox", { name: "Note" });
  await note.focus();
  await note.press("End");
  await note.pressSequentially(" plus");
  await expect.poll(async () => (await attemptOnServer(finished)).note).toBe("Original plus");
  await expect.poll(async () => (await attemptOnServer(finished)).settings.infillDensity).toBe(20);
  const after = await attemptOnServer(finished);
  expect(after.successNotes).toEqual(["great-first-layer"]);
  expect(after.settings).toMatchObject({ bedTemperature: 60, layerHeight: 0.16, nozzleTemperature: 230 });

  // Alex's sheet takes what Sam did on its own, and keeps what Alex typed.
  await focus(page);
  await expect(sheet.getByRole("button", { name: "Great first layer" })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("button", { name: "0.16 mm" })).toHaveAttribute("aria-pressed", "true");
  await expect(infill).toHaveValue("20");
  await expect(note).toHaveValue("Original plus");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The printer reports on the print still on the bed (the bridge's endedAt and a suggested tag) while its sheet is open.
  await page
    .locator(`[data-attempt-id="${printing}"]`)
    .getByRole("button", { name: /Open$/ })
    .click({ position: { x: 6, y: 6 } });
  const finishing = page.getByRole("dialog", { name: "Finish attempt 2" });
  await expect(finishing).toBeVisible();
  const reported = await samPage.request.patch(`/api/attempts/${printing}`, {
    headers,
    data: { endedAt: Date.now() - 1000, suggestedFailureTag: "warping" },
  });
  expect(reported.ok()).toBe(true);
  await focus(page);
  await expect(finishing.getByText(/off the bed at/i)).toBeVisible();
  // Picking "Spaghetti" now offers the tag the printer suggested.
  await finishing.getByRole("radio", { name: "Spaghetti" }).click();
  await expect(finishing.getByRole("button", { name: "Warping" })).toHaveAttribute("aria-pressed", "true");
  await samContext.close();
});
