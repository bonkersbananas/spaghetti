import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const [alex, sam] = SEED_USERS;

async function signInAs(page: Page, user: { username: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

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

  // Alex's screen follows on its own (the feed is asked every ten seconds), with one quiet word.
  const attempts = page.getByRole("list", { name: "Attempts, newest first" });
  await expect(attempts.getByText("Let go of the bed at 40%")).toBeVisible({ timeout: 25_000 });
  await expect(attempts.getByRole("img", { name: "Attempt 1" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Sam logged an attempt")).toBeVisible();
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

  // A photo on its own: "Sam added a photo".
  await samPage.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
    headers: { Origin: origin(samPage) },
    multipart: await photoParts(samPage),
  });
  await focus(page);
  await expect(page.getByText("Sam added a photo")).toBeVisible();

  // Deleted by the other person while it is open: the screen closes with a quiet word, no error.
  await samPage.request.delete(`/api/items/${id}`, { headers: { Origin: origin(samPage) } });
  await focus(page);
  await expect(page).toHaveURL(/\/builds$/);
  await expect(page.getByText("Sam deleted this build")).toBeVisible();
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
  // Their avatar is on the card, as on any idea.
  await expect(ideas.getByRole("link", { name: /Sam's spool holder/ }).getByText("S", { exact: true })).toBeVisible();
  // Nobody asked for a toast for a card landing.
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  // The card Alex was looking at stayed where it was.
  await page.waitForTimeout(800);
  const after = await watched.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThan(2);
  await samContext.close();
});
