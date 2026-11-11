import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

const [, sam] = SEED_USERS;
const origin = (page: Page) => new URL(page.url()).origin;

async function newIdea(page: Page, title = "Bath tugboat", stage: "idea" | "building" = "idea") {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title, note: "Chunky enough for small hands.", stage },
  });
  expect(response.ok()).toBe(true);
  return id;
}

/** Sam, signed in through the API in a context of his own: what his phone does. */
async function samSession(page: Page) {
  const context = await page
    .context()
    .browser()
    ?.newContext({ baseURL: origin(page) });
  if (!context) throw new Error("no browser");
  const samPage = await context.newPage();
  await samPage.goto("/sign-in");
  const response = await samPage.request.post("/api/session", {
    headers: { Origin: origin(page) },
    data: { username: sam.username, password: SEED_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  return {
    context,
    say: async (itemId: string, body: string) => {
      const id = crypto.randomUUID();
      const result = await samPage.request.post(`/api/items/${itemId}/comments`, {
        headers: { Origin: origin(page) },
        data: { id, body },
      });
      expect(result.ok()).toBe(true);
      return id;
    },
  };
}

/** The thread's field: inline on a keyboard, in a sheet opened from a field-shaped button on a phone. */
async function openComposer(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: /Say something to/ }).click();
  const field = page.getByRole("textbox", { name: /Say something to/ });
  await expect(field).toBeVisible();
  return field;
}

async function send(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Send" }).click();
  else await page.getByRole("textbox", { name: /Say something to/ }).press("Enter");
}

/** Sending scrolls the new message into view, smoothly: let the page stop moving before pressing something that sits in it. */
const settle = (page: Page) =>
  page.waitForFunction(
    () =>
      new Promise<boolean>((resolve) => {
        const y = window.scrollY;
        setTimeout(() => resolve(window.scrollY === y), 300);
      }),
  );

/** Opens the menu of your message: a tap on it on a phone; on a keyboard the options button beside it (shown on hover). */
async function openMessageMenu(page: Page, isMobile: boolean, text: string) {
  const message = thread(page).getByText(text);
  if (isMobile) await message.click();
  else {
    await message.hover();
    await page.getByRole("button", { name: "Options for your comment" }).click();
  }
}

const thread = (page: Page) => page.getByRole("list", { name: "Comments" });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("writes a comment, edits it (shown as edited) and deletes it with an undo", async ({ page, isMobile }) => {
  const id = await newIdea(page);
  await page.goto(`/ideas/${id}`);
  // Nothing written yet: one quiet line, no heading and no empty box.
  await expect(
    page
      .getByRole("button", { name: /Say something to Sam/ })
      .or(page.getByRole("textbox", { name: /Say something to Sam/ }))
      .first(),
  ).toBeVisible();
  await expect(thread(page)).toHaveCount(0);

  const field = await openComposer(page, isMobile);
  await field.fill("Could you print this one in the blue PETG?");
  await send(page, isMobile);
  await expect(thread(page).getByText("Could you print this one in the blue PETG?")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // It is saved on the server, not just on screen.
  await page.reload();
  await expect(thread(page).getByText("Could you print this one in the blue PETG?")).toBeVisible();

  // Edit in place.
  await settle(page);
  await openMessageMenu(page, isMobile, "Could you print this one in the blue PETG?");
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit your comment" });
  await editor.fill("Could you print this one in the blue PETG, please?");
  await editor.evaluate((element) => (element as HTMLTextAreaElement).blur());
  await expect(thread(page).getByText("Could you print this one in the blue PETG, please?")).toBeVisible();
  await expect(thread(page).getByText("(edited)")).toBeVisible();

  // Delete, and take it back.
  await openMessageMenu(page, isMobile, "Could you print this one in the blue PETG, please?");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Comment deleted")).toBeVisible();
  await expect(thread(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(thread(page).getByText("Could you print this one in the blue PETG, please?")).toBeVisible();
  await page.reload();
  await expect(thread(page).getByText("Could you print this one in the blue PETG, please?")).toBeVisible();
});

test("a half-written comment survives leaving the page and a reload", async ({ page, isMobile }) => {
  const id = await newIdea(page);
  await page.goto(`/ideas/${id}`);
  const field = await openComposer(page, isMobile);
  await field.fill("Half a thought, and then");
  if (isMobile) await page.keyboard.press("Escape");
  await page.goto("/ideas");
  await page.goto(`/ideas/${id}`);
  if (isMobile) await expect(page.getByRole("button", { name: /Draft: Half a thought/ })).toBeVisible();
  else await expect(page.getByRole("textbox", { name: /Say something to/ })).toHaveValue("Half a thought, and then");
  await page.reload();
  if (isMobile) {
    await page.getByRole("button", { name: /Draft: Half a thought/ }).click();
    await expect(page.getByRole("textbox", { name: /Say something to/ })).toHaveValue("Half a thought, and then");
  } else {
    await expect(page.getByRole("textbox", { name: /Say something to/ })).toHaveValue("Half a thought, and then");
  }
});

test("the other person's comment shows up live, with a new marker on the card and in the thread, cleared once read", async ({
  page,
  browser,
  isMobile,
}) => {
  test.setTimeout(90_000);
  const id = await newIdea(page);
  const sams = await samSession(page);
  await page.goto("/ideas");
  const card = page.getByRole("link", { name: /Bath tugboat/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("new comment")).toHaveCount(0);

  await sams.say(id, "Started the hull tonight, first layer looks great.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.getByText("1 new comment")).toBeVisible({ timeout: 20_000 });

  await card.click();
  await expect(thread(page).getByText("Started the hull tonight, first layer looks great.")).toBeVisible();
  await expect(thread(page).getByText("New", { exact: true })).toBeVisible();

  // Open on the thread: a second comment lands live, under the same divider.
  await sams.say(id, "And the second one too.");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(thread(page).getByText("And the second one too.")).toBeVisible({ timeout: 20_000 });
  await expect(thread(page).getByText("New", { exact: true })).toHaveCount(1);

  // Reading is per person: back in the list the marker is gone, and Sam still has nothing new.
  await page.goto("/ideas");
  await expect(page.getByRole("link", { name: /Bath tugboat/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Bath tugboat/ }).getByText("new comment")).toHaveCount(0);
  await sams.context.close();
  void browser;
  void isMobile;
});

test("a keyboard writes without the mouse: M focuses, Enter sends, Shift+Enter breaks the line, Esc leaves", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Keyboard shortcuts are for desktop.");
  const id = await newIdea(page);
  await page.goto(`/ideas/${id}`);
  const field = page.getByRole("textbox", { name: /Say something to/ });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Bath tugboat");
  await page.keyboard.press("m");
  await expect(field).toBeFocused();
  await page.keyboard.type("First line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("Second line");
  await expect(field).toHaveValue("First line\nSecond line");
  await page.keyboard.press("Escape");
  await expect(field).not.toBeFocused();
  await page.keyboard.press("m");
  await page.keyboard.press("Enter");
  await expect(thread(page).getByText("First line")).toBeVisible();
  await expect(thread(page).getByText("Second line")).toBeVisible();
  await expect(field).toHaveValue("");
});

test("a build has its thread too, and the story includes it", async ({ page, isMobile }) => {
  const id = await newIdea(page, "Hook", "building");
  await page.goto(`/builds/${id}`);
  const field = await openComposer(page, isMobile);
  await field.fill("Printing the first one tonight.");
  await send(page, isMobile);
  await expect(thread(page).getByText("Printing the first one tonight.")).toBeVisible();
  const story = await (await page.request.get(`/api/builds/${id}/story.md`)).text();
  expect(story).toContain("Printing the first one tonight.");
});

test("a message that ends with a link shows a card in place of the address, and a link mid-sentence stays text", async ({
  page,
  isMobile,
}) => {
  const id = await newIdea(page);
  await page.goto(`/ideas/${id}`);
  const field = await openComposer(page, isMobile);
  await field.fill("These would fit https://example.com/models/7");
  await send(page, isMobile);
  await expect(thread(page).getByText("These would fit")).toBeVisible();
  await expect(thread(page).getByRole("link", { name: /example\.com\/models\/7/ })).toHaveCount(1);
  await expect(thread(page).getByText("https://example.com/models/7")).toHaveCount(0);
  await expect(page.getByRole("list", { name: /Links/ })).toHaveCount(0);
  const second = await openComposer(page, isMobile);
  await second.fill("See https://example.com/models/8 for the grid");
  await send(page, isMobile);
  const link = thread(page).getByRole("link", { name: "example.com/models/8" });
  await expect(link).toBeVisible();

  // A message that is only a link has no bubble to tap: its options button stays in view on a phone, and edits show "(edited)".
  const third = await openComposer(page, isMobile);
  await third.fill("https://example.com/models/9");
  await send(page, isMobile);
  const options = page.getByRole("button", { name: "Options for your comment" }).last();
  await expect(thread(page).getByRole("link", { name: /example\.com\/models\/9/ })).toBeVisible();
  await options.scrollIntoViewIfNeeded();
  await settle(page);
  if (!isMobile)
    await thread(page)
      .getByRole("link", { name: /example\.com\/models\/9/ })
      .hover();
  await options.click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit your comment" });
  await editor.fill("https://example.com/models/9 is the one");
  await editor.evaluate((element) => (element as HTMLTextAreaElement).blur());
  await expect(thread(page).getByText("(edited)")).toBeVisible();
});

test("Today's All quiet state shows the line for a new message too", async ({ page }) => {
  // Only a young idea, nothing printing or loaded, and no journal: the quiet kitchen.
  await page.route(/\/api\/journal\/summary/, (route) =>
    route.fulfill({ json: { summary: { prints: 0, worked: 0, partly: 0, spaghetti: 0, finished: [] } } }),
  );
  await page.route(/\/api\/journal\?/, (route) => route.fulfill({ json: { entries: [], items: [], next: null } }));
  const id = await newIdea(page, "Bath tugboat");
  await page.goto("/today");
  await expect(page.getByRole("heading", { name: "All quiet in the kitchen" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sam Okafor on/ })).toHaveCount(0);
  const sams = await samSession(page);
  await sams.say(id, "Could it be in blue PETG?");
  await page.reload();
  await expect(page.getByRole("heading", { name: "All quiet in the kitchen" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sam Okafor on Bath tugboat: Could it be in blue PETG/ })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(violations.map((violation) => `today: ${violation.id}`)).toEqual([]);
  await page.getByRole("link", { name: /Sam Okafor on Bath tugboat/ }).click();
  await expect(thread(page).getByText("Could it be in blue PETG?")).toBeVisible();
  await page.goto("/today");
  await expect(page.getByRole("link", { name: /Sam Okafor on/ })).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test(`Today has one quiet line for what Sam wrote, until it is read, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const id = await newIdea(page, "Bath tugboat", "building");
    const other = await newIdea(page, "Lamp base", "building");
    await page.goto("/today");
    const line = page.getByRole("link", { name: /on Bath tugboat/ });
    await expect(page.getByRole("link", { name: /new comments?/ })).toHaveCount(0);
    const sams = await samSession(page);
    await sams.say(id, "Started it tonight, the first layer looked great.");
    await page.reload();
    await expect(line).toHaveText(/Sam Okafor on Bath tugboat: Started it tonight/);
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(violations.map((violation) => `today: ${violation.id}`)).toEqual([]);

    // Several: the label counts them, and the one line is for the newest thread.
    await sams.say(other, "Could it be taller?");
    await sams.say(other, "Maybe 12 cm.");
    await page.reload();
    await expect(page.getByRole("heading", { name: /^New comments\s*3$/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Sam Okafor on Lamp base/ })).toHaveCount(1);

    // Reading a thread clears it from the line; reading all clears the line.
    await page.getByRole("link", { name: /^Sam Okafor on Lamp base/ }).click();
    await expect(thread(page).getByText("Maybe 12 cm.")).toBeVisible();
    await page.goto("/today");
    await expect(page.getByRole("link", { name: /on Bath tugboat: Started it tonight/ })).toBeVisible();
    await page.getByRole("link", { name: /on Bath tugboat/ }).click();
    await expect(thread(page).getByText("Started it tonight, the first layer looked great.")).toBeVisible();
    await page.goto("/today");
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByRole("link", { name: /on (Bath tugboat|Lamp base)/ })).toHaveCount(0);
  });

  test(`search finds a build by what Sam said and opens the thread at that comment, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const id = await newIdea(page, "Lamp base", "building");
    const sams = await samSession(page);
    const commentId = await sams.say(id, "Try the chunkier version in cobalt PETG next time.");
    await page.goto("/search");
    await page.getByRole("searchbox", { name: "Search" }).fill("chunkier");
    const result = page.getByRole("link", { name: /Lamp base/ });
    await expect(result).toBeVisible();
    await expect(result).toContainText("Sam");
    await expect(result.locator("mark")).toHaveText("chunkier");
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(violations.map((violation) => `search: ${violation.id}`)).toEqual([]);

    await result.click();
    await expect(page).toHaveURL(new RegExp(`comment=${commentId}`));
    const bubble = page.locator(`#comment-${commentId} > div`).first();
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/ring-semolina/);
    // The thread is in view, and the light goes out again.
    await expect(bubble).toBeInViewport();
    const lit = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(lit.violations.map((violation) => `thread: ${violation.id}`)).toEqual([]);
    await expect(bubble).not.toHaveClass(/ring-semolina/, { timeout: 8000 });
  });

  test(`axe: idea and build with a thread, the sheet and the menu, ${theme}`, async ({ page, isMobile }) => {
    await page.emulateMedia({ colorScheme: theme });
    const idea = await newIdea(page, "Bath tugboat");
    const build = await newIdea(page, "Hook", "building");
    const sams = await samSession(page);
    for (const id of [idea, build])
      await sams.say(id, "Could you print this one in the blue PETG? https://example.com/models/1");
    for (const [path, id] of [
      ["ideas", idea],
      ["builds", build],
    ] as const) {
      await page.goto(`/${path}/${id}`);
      await expect(thread(page).getByText("Could you print this one in the blue PETG?")).toBeVisible();
      const field = await openComposer(page, isMobile);
      await field.fill("Yes, tonight.");
      await send(page, isMobile);
      await expect(thread(page).getByText("Yes, tonight.")).toBeVisible();
      // The link card under Sam's message settles first, or it would push the menu button away from the click.
      await expect(
        thread(page)
          .getByRole("link", { name: /example\.com\/models\/1/ })
          .first(),
      ).toBeVisible();
      // So does the "New" line over it: the page has stopped moving.
      await expect(thread(page).getByText("New", { exact: true })).toBeVisible();
      await settle(page);
      await openMessageMenu(page, isMobile, "Yes, tonight.");
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze();
      expect(violations.map((violation) => `${path}: ${violation.id}`)).toEqual([]);
      await page.keyboard.press("Escape");
    }
    // The composer sheet on a phone, open with a draft in it.
    if (isMobile) {
      await page.getByRole("button", { name: /Say something to/ }).click();
      await page.getByRole("textbox", { name: /Say something to/ }).fill("Half written");
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
        .analyze();
      expect(violations.map((violation) => violation.id)).toEqual([]);
    }
    await sams.context.close();
  });
}
