import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signing in lands on Today; these tests start from the inbox.
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

const origin = (page: Page) => new URL(page.url()).origin;

async function getItem(page: Page, id: string) {
  return (await (await page.request.get(`/api/items/${id}`)).json()).item;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: the smoke test expects empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
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

  // Anywhere in the app, capture offers the print, with "New idea" a tap away.
  await page.goto("/ideas");
  // The app has to be on screen before its shortcut does anything.
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "Add to the print" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "New idea" })).toBeVisible();
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
