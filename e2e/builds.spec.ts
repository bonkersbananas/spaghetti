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
  await expect(page.getByText("On the bed", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");

  // A failed attempt, with a failure tag, a photo and a bed temperature.
  if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
  else await page.keyboard.press("a");
  let sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Log attempt" })).toBeDisabled();
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
  await sheet.getByRole("button", { name: /^Settings(?! worth)/ }).click();
  await expect(sheet.getByLabel("Bed", { exact: true })).toHaveValue("55");
  await sheet.getByLabel("Bed", { exact: true }).fill("60");
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
  await expect(page.getByText("On the bed", { exact: true })).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");

  // It lives under Builds now, not Ideas.
  await page.goto("/builds");
  await expect(page.getByRole("list", { name: "On the bed" }).getByRole("link", { name: /Cable chain/ })).toBeVisible();
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

  // The builds list says how long is left instead of when it started.
  await page.goto("/builds");
  await expect(page.getByRole("link", { name: /Timed tugboat/ })).toContainText(/about .* left|done around/);

  // No estimate, nothing to measure: words only, no bar.
  await page.goto(`/builds/${untimed}`);
  await expect(page.getByText("On the bed now")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
});

test("a long build folds its earlier attempts, and picking one unfolds them and brings it into view", async ({
  page,
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

  // The summary's dot for the first attempt unfolds the story and scrolls to it.
  await page.getByRole("button", { name: "Attempt 1: spaghetti" }).click();
  await expect(story.getByRole("listitem")).toHaveCount(7);
  await expect(story.getByRole("listitem").last()).toBeInViewport();
});

test("the story column stays reachable in a short window", async ({ page, isMobile }) => {
  test.skip(isMobile, "the column only sticks beside the attempts on a laptop");
  const id = crypto.randomUUID();
  const note = Array.from({ length: 30 }, (_, line) => `Line ${line + 1} of a long plan for this build.`).join("\n");
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Tall notes", note, stage: "building" },
  });
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tall notes");
  // A sticky column taller than the window would leave its end out of reach while the attempts scroll: it fits the
  // window and scrolls inside itself instead.
  const column = page.locator("article .sticky-column");
  const box = await column.evaluate((el) => ({
    height: el.getBoundingClientRect().height,
    scrolls: el.scrollHeight > el.clientHeight,
  }));
  expect(box.height).toBeLessThanOrEqual(600);
  expect(box.scrolls).toBe(true);
});

test("the summary's attempt tiles are touch targets and mark the open attempt", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Desktop tiles are compact");
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
