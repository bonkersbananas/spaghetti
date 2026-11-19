import { expect, type Page, test } from "@playwright/test";
import { SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn as signInThroughApi } from "./helpers";

const user = SEED_USERS[0];

const signIn = (page: Page) => signInThroughApi(page, user);

const origin = (page: Page) => new URL(page.url()).origin;

async function getItem(page: Page, id: string) {
  return (await (await page.request.get(`/api/items/${id}`)).json()).item;
}

// Start from nothing, and leave nothing behind (the smoke test expects empty sections): clearing first too
// means a run that died before its cleanup can't leave a build for the next test or retry to trip over.
test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("1, 2, 3 answer the outcome, Enter logs it, and Spaghetti needs no Spaghetti tag", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keys are for the desktop");
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers: { Origin: origin(page) }, data: { id, title: "Hinge" } });
  await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { stage: "building" } });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hinge");
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("3");
  await expect(sheet.getByRole("radio", { name: "Spaghetti", checked: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Bed adhesion" })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Spaghetti", exact: true })).toHaveCount(0);
  // Focus follows the pick, and a key pick is a tap: the line for a failure is there.
  await expect(sheet.getByRole("radio", { name: "Spaghetti" })).toBeFocused();
  await expect(sheet.getByText("Good one to have on record.")).toBeVisible();
  await page.keyboard.press("2");
  await expect(sheet.getByRole("radio", { name: "Partly", checked: true })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "Partly" })).toBeFocused();
  await page.keyboard.press("3");
  // Focus is still on an outcome button: Enter logs the one picked, it doesn't pick the focused one.
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => (await getItem(page, id)).attempts.map((a: { outcome: string }) => a.outcome))
    .toEqual(["failed"]);
});

test("grows an idea into a build, logs a failure and a success, and finishes it", async ({ page, isMobile }) => {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Cable chain", note: "For the back of the X2D" },
  });

  // Start building from the idea: the same record moves on.
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");

  // A failed attempt, with a failure tag, a photo and a bed temperature.
  if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
  else await page.keyboard.press("a");
  let sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();
  // No outcome yet: the one primary button starts the print; picking an outcome turns it into "Log attempt".
  await expect(sheet.getByRole("button", { name: "Start print" })).toBeEnabled();
  await expect(sheet.getByRole("button", { name: "Log attempt" })).toHaveCount(0);
  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await sheet.getByRole("button", { name: "Bed adhesion" }).click();
  await sheet.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Attempt photo 1" })).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill("Let go of the bed at 40%");
  await sheet.getByRole("button", { name: /^Settings(?! worth)/ }).click();
  await sheet.getByLabel("Bed", { exact: true }).fill("55");
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(sheet).toBeHidden();

  const story = page.getByRole("list", { name: "Attempts, newest first" });
  const first = story.getByRole("listitem").filter({ hasText: "Attempt 1" });
  await expect(first).toContainText("Spaghetti");
  await expect(first).toContainText("Bed adhesion");
  await expect(first).toContainText("Let go of the bed at 40%");
  await expect(first.getByRole("img", { name: "Attempt 1" })).toBeVisible();
  await expect
    .poll(async () => {
      const item = await getItem(page, id);
      return item.photos.filter((photo: { attemptId: string | null }) => photo.attemptId === item.attempts[0]?.id)
        .length;
    })
    .toBe(1);

  // A successful attempt: same as last time, but a hotter bed and a brim.
  if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
  else await page.keyboard.press("a");
  sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Settings(?! worth)/ })).toContainText("Same as attempt 1");
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Great first layer" }).click();
  // What carried over is a chip: tap the bed, change it in place, the settings stay folded.
  await sheet.getByRole("button", { name: "Change Bed 55 °C" }).click();
  await expect(sheet.getByLabel("Bed", { exact: true })).toHaveValue("55");
  // Emptied to type a new number, the chip stays (in its place) and so does its field.
  await sheet.getByLabel("Bed", { exact: true }).fill("");
  await expect(sheet.getByRole("button", { name: "Change Bed" })).toBeVisible();
  await sheet.getByLabel("Bed", { exact: true }).fill("60");
  await sheet.getByRole("button", { name: /^Settings(?! worth)/ }).click();
  await sheet.getByRole("button", { name: "No brim" }).click();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(sheet).toBeHidden();

  // The timeline says what changed.
  const second = story.getByRole("listitem").filter({ hasText: "Attempt 2" });
  await expect(second).toContainText("Worked");
  await expect(second).toContainText("bed 55 → 60 °C");
  await expect(second).toContainText("added a brim");
  await expect(story.getByRole("listitem").first()).toContainText("Attempt 2");
  await expect
    .poll(async () => (await getItem(page, id)).attempts.map((a: { outcome: string }) => a.outcome))
    .toEqual(["failed", "success"]);

  // The newest answer is "Worked": Finish build leads (the bar on phones, the header on desktop), with another try beside it.
  await expect(page.getByRole("button", { name: "Finish build" })).toHaveCount(1);
  if (isMobile) await expect(page.getByRole("button", { name: "Log another try" })).toBeVisible();

  // Finish it: one action, a little delight after the spaghetti, and undo.
  await page.getByRole("button", { name: "Finish build" }).click();
  await expect(page.getByText("Al dente")).toBeVisible();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("done");
  const done = await getItem(page, id);
  expect(done.coverPhotoId).toBe(done.photos[0].id);

  await page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Al dente" })
    .getByRole("button", { name: "Undo" })
    .click();
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");

  // It lives under Builds now, not Ideas.
  await page.goto("/builds");
  await expect(
    page.getByRole("list", { name: "In progress" }).getByRole("link", { name: /Cable chain/ }),
  ).toBeVisible();
});

test("On the bed holds only what is on the plate; builds between prints are In progress", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  const headers = { Origin: origin(page) };
  const printing = crypto.randomUUID();
  const waiting = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: printing, title: "Hook", stage: "building" } });
  await page.request.post(`/api/items/${printing}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: null },
  });
  await page.request.post("/api/items", { headers, data: { id: waiting, title: "Cable chain", stage: "building" } });
  await page.request.post(`/api/items/${waiting}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), outcome: "failed", failureTags: ["bed-adhesion"] },
  });

  await page.goto("/builds");
  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByRole("link", { name: /Hook/ }).first()).toBeVisible();
  await expect(bed.getByRole("button", { name: "How did it go?" })).toBeVisible();
  await expect(bed.getByText("Cable chain")).toHaveCount(0);
  const inProgress = page.getByRole("list", { name: "In progress" });
  const card = inProgress.getByRole("link", { name: /Cable chain/ });
  await expect(card).toContainText("Spaghetti");
  await expect(card).toContainText("Bed adhesion");
  await expect(inProgress.getByRole("link", { name: /Hook/ })).toHaveCount(0);

  // On desktop J walks the prints on the bed first, by their names' links, then the In progress cards.
  if (!isMobile) {
    await page.keyboard.press("j");
    await expect(bed.getByRole("link", { name: /^Hook, attempt 1/ })).toBeFocused();
    await page.keyboard.press("j");
    await expect(card).toBeFocused();
  }

  // A build between prints says so on its page: it isn't on the bed.
  await card.click();
  await expect(page.getByText("In progress", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("On the bed", { exact: true })).toHaveCount(0);

  // Only the print left: no In progress section for nothing.
  await page.request.delete(`/api/items/${waiting}`, { headers });
  await page.goto("/builds");
  await expect(page.getByRole("region", { name: "On the bed" })).toBeVisible();
  await expect(page.getByRole("region", { name: /^In progress/ })).toHaveCount(0);
});

test("a print on the bed has one way to log it; closing the build waits in the … menu until it has its answer", async ({
  page,
  isMobile,
}) => {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Hook", stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: crypto.randomUUID(), outcome: null } });
  await page.goto(`/builds/${id}`);

  // One question for the print (its card on desktop, the action bar on phones), and nothing that ends the build beside it.
  const ask = page.getByRole("button", { name: "How did it go?" });
  await expect(ask).toHaveCount(1);
  await expect(ask).toBeVisible();
  await expect(page.getByRole("button", { name: /^Finish attempt/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finish build" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Shelve/ })).toHaveCount(0);

  // They are one menu away.
  await page.getByRole("button", { name: "More for this build" }).click();
  await expect(page.getByRole("button", { name: "Finish build" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Shelve build" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Shelve build" })).toHaveCount(0);

  // Desktop's A asks the same question.
  if (isMobile) await ask.click();
  else await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Finish attempt 1" });
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: /^(Done|Finish attempt)$/ }).click();
  await expect(sheet).toBeHidden();

  // It worked: Finish build is back and leads (desktop's bar; on phones the action bar), and the menu has gone.
  await expect(page.getByRole("button", { name: "Finish build" })).toBeVisible();
  await expect(page.getByRole("button", { name: "More for this build" })).toHaveCount(0);
  await expect(ask).toHaveCount(0);
  if (!isMobile) {
    await expect(page.getByRole("button", { name: "Log another try" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Shelve", exact: true })).toBeVisible();
  }
});

test("adds a capture to the print that's running and finishes it", async ({ page, isMobile }) => {
  const id = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Tugboat", stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: attemptId, outcome: null } });

  // Anywhere in the app, capture opens on "New idea" and offers the print a tap away.
  await page.goto("/ideas");
  // The app has to be on screen before its shortcut does anything.
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "New idea" })).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "New idea" })).toBeChecked();
  await sheet.getByRole("radio", { name: "This print" }).click();
  await expect(sheet.getByRole("heading", { name: "Add to the print" })).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill("Looks clean so far");
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Finish print" }).click();
  await expect(sheet).toBeHidden();

  await expect
    .poll(async () => {
      const [attempt] = (await getItem(page, id)).attempts;
      return [attempt.outcome, attempt.note];
    })
    .toEqual(["success", "Looks clean so far"]);
});

test("records what went wrong while finishing a print from the capture sheet", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Tugboat", stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: crypto.randomUUID(), outcome: null } });

  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "This print" }).click();
  // Nothing to answer yet: no tags until it went wrong.
  await expect(sheet.getByText("What went wrong?")).toHaveCount(0);
  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await expect(sheet.getByText("What went wrong?")).toBeVisible();
  await sheet.getByRole("button", { name: "Bed adhesion" }).click();
  // The tag question never gets the keyboard up on its own.
  await expect(sheet.getByRole("textbox", { name: "New failure tag" })).toHaveCount(0);
  // Closing the sheet half-answered loses nothing: the answer is back when it reopens on this print.
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  await sheet.getByRole("radio", { name: "This print" }).click();
  await expect(sheet.getByRole("radio", { name: "Spaghetti" })).toBeChecked();
  await expect(sheet.getByRole("button", { name: "Bed adhesion" })).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Finish print" }).click();
  await expect(sheet).toBeHidden();

  await expect
    .poll(async () => {
      const [attempt] = (await getItem(page, id)).attempts;
      return [attempt.outcome, attempt.failureTags];
    })
    .toEqual(["failed", ["bed-adhesion"]]);

  // Found where failures are looked up.
  await page.goto("/journal?outcome=failures");
  await expect(page.getByText("Tugboat").first()).toBeVisible();
});

test("capture opens on a new idea on an idea's page, with this idea one tap away", async ({ page, isMobile }) => {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Cable chain" } });
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("button", { name: "Start building" })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "New idea" })).toBeVisible();
  const options = sheet.getByRole("radio");
  await expect(options.first()).toHaveAccessibleName("New idea");
  await expect(options.first()).toBeChecked();
  await sheet.getByRole("radio", { name: "This idea" }).click();
  await expect(sheet.getByRole("heading", { name: "Add to Cable chain" })).toBeVisible();
});

test("a print on the bed shows its progress only when there is an estimate", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const timed = crypto.randomUUID();
  const untimed = crypto.randomUUID();
  for (const [id, title, settings] of [
    [timed, "Timed tugboat", { estimatedMinutes: 75 }],
    [untimed, "Untimed hook", {}],
  ] as const) {
    await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
    await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), outcome: null, settings },
    });
  }

  await page.goto(`/builds/${timed}`);
  const bar = page.getByRole("progressbar", { name: "Print progress" });
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("aria-valuetext", /^About \d+ (h \d+ )?min left$|^Done around /);
  await expect(page.getByText(/^About .* left$|^Done around /)).toBeVisible();

  // The builds list has it on the bed, saying how long is left instead of when it started.
  await page.goto("/builds");
  await expect(page.getByRole("region", { name: "On the bed" })).toContainText(/About .* left|Done around/);

  // No estimate, nothing to measure: words only, no bar.
  await page.goto(`/builds/${untimed}`);
  await expect(page.getByText("On the bed now")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("a long build folds its earlier attempts, and picking one unfolds them and brings it into view", async ({
  page,
  isMobile,
}) => {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Long story", note: "" } });
  for (const [index, outcome] of (
    ["failed", "partial", "failed", "partial", "failed", "success", "partial"] as const
  ).entries())
    await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), outcome, printedAt: Date.now() - (8 - index) * 3_600_000 },
    });
  await page.goto(`/builds/${id}`);
  const story = page.getByRole("list", { name: "Attempts, newest first" });
  await expect(story.getByRole("listitem")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "4 earlier attempts" })).toBeVisible();

  // The summary's step for the first attempt unfolds the story and scrolls to it. A phone's trail keeps one row (six
  // steps), so there it is folded too, a tap away.
  const trail = page.getByRole("group", { name: /^7 attempts/ });
  if (isMobile) await trail.getByRole("button", { name: "Show 2 earlier attempts" }).click();
  await trail.getByRole("button", { name: "Attempt 1: spaghetti" }).click();
  await expect(story.getByRole("listitem")).toHaveCount(7);
  await expect(story.getByRole("listitem").last()).toBeInViewport();
});

test("a story column taller than the window scrolls until its end is in view, then sticks", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "the column only sticks beside the attempts on a laptop");
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  const note = Array.from({ length: 30 }, (_, line) => `Line ${line + 1} of a long plan for this build.`).join("\n");
  await page.request.post("/api/items", { headers, data: { id, title: "Tall notes", note, stage: "building" } });
  // Attempts enough that the page is longer than the column.
  for (let number = 0; number < 8; number++) {
    await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), outcome: "failed", printedAt: Date.now() - (9 - number) * 3_600_000 },
    });
  }
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tall notes");
  const column = page.locator("article .sticky-column");
  const height = await column.evaluate((el) => el.getBoundingClientRect().height);
  expect(height).toBeGreaterThan(600);
  // Scrolled to the end of the page, the column's end is in view (not left below the window).
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(async () => column.evaluate((el) => Math.round(window.innerHeight - el.getBoundingClientRect().bottom)))
    .toBeGreaterThanOrEqual(24);
  // And it never scrolls inside itself.
  expect(await column.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
});

test("a build of many attempts folds its earliest steps in the trail, and the folded step unfolds them", async ({
  page,
  isMobile,
}) => {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Very long story", note: "" } });
  for (let index = 0; index < 14; index++)
    await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), outcome: "partial", printedAt: Date.now() - (15 - index) * 3_600_000 },
    });
  await page.goto(`/builds/${id}`);
  const trail = page.getByRole("group", { name: /^14 attempts/ });
  // One row: the newest five and a step for the nine before them on a phone, the newest nine and the five before on a laptop.
  const [shown, folded] = isMobile ? [5, 9] : [9, 5];
  await expect(trail.getByRole("button", { name: /^Attempt \d+: partly$/ })).toHaveCount(shown);
  await expect(trail.getByRole("button", { name: "Attempt 1: partly" })).toHaveCount(0);
  await trail.getByRole("button", { name: `Show ${folded} earlier attempts` }).click();
  await expect(trail.getByRole("button", { name: /^Attempt \d+: partly$/ })).toHaveCount(14);
  await trail.getByRole("button", { name: "Attempt 1: partly" }).click();
  await expect(trail.getByRole("button", { name: "Attempt 1: partly" })).toHaveAttribute("aria-current", "true");
});

test("the summary's attempt steps are touch targets and mark the open attempt", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Desktop steps are compact");
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Tiles", note: "" } });
  for (const [index, outcome] of (["failed", "partial", "success"] as const).entries())
    await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: { id: crypto.randomUUID(), outcome, printedAt: Date.now() - (4 - index) * 3_600_000 },
    });
  await page.goto(`/builds/${id}`);
  const tile = page.getByRole("group", { name: /^3 attempts/ }).getByRole("button", { name: "Attempt 2: partly" });
  const box = await tile.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(43.5);
  expect(box?.width).toBeGreaterThanOrEqual(43.5);
  await tile.click();
  await expect(tile).toHaveAttribute("aria-current", "true");
});

test("Enter in the note starts the print when no outcome is picked", async ({ page, isMobile }) => {
  test.skip(isMobile, "Keys are for the desktop");
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers: { Origin: origin(page) }, data: { id, title: "Latch" } });
  await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { stage: "building" } });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Latch");
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet.getByText("starts it")).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill("Printing now");
  await page.keyboard.press("Enter");
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => (await getItem(page, id)).attempts.map((a: { outcome: string | null }) => a.outcome))
    .toEqual([null]);
});

test("on a phone the outcome and the photo tiles sit at the foot of the sheet, and the when line says 'Printed … · change'", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The order is for phones");
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title: "Hinge", stage: "building" } });
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  const radio = sheet.getByRole("radio", { name: "Spaghetti" });
  const note = sheet.getByRole("textbox", { name: "Note" });
  const take = sheet.getByRole("button", { name: "Take photo" });
  const start = sheet.getByRole("button", { name: "Start print" });
  await expect(radio).toBeVisible();
  const [r, n, t, s] = await Promise.all([radio, note, take, start].map((l) => l.boundingBox()));
  // Bottom-up: the note, then the photo tiles, then the outcome, then the button.
  expect(n && t && r && s && n.y < t.y && t.y < r.y && r.y < s.y).toBe(true);
  await expect(sheet.getByText("Starting now")).toBeVisible();
  await radio.click();
  await expect(sheet.getByRole("button", { name: /Printed just now/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(sheet).toBeHidden();

  // Finishing it later: the date is the same quiet line, and Delete is behind "…", not beside Done.
  await expect.poll(async () => (await getItem(page, id)).attempts.length).toBe(1);
  await page
    .getByRole("button", { name: /Attempt 1/ })
    .first()
    .click();
  const edit = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(edit.getByRole("button", { name: /^Printed just now/ })).toBeVisible();
  await expect(edit.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await edit.getByRole("button", { name: "More for this attempt" }).click();
  await expect(page.getByRole("button", { name: "Delete attempt" })).toBeVisible();
});
