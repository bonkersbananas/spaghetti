import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

const [, sam] = SEED_USERS;
const origin = (page: Page) => new URL(page.url()).origin;

async function newIdea(page: Page) {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Cable comb", note: "For the desk edge." },
  });
  expect(response.ok()).toBe(true);
  return id;
}

/** Sam, through the API in a context of his own: a comment, and a reaction. */
async function asSam(page: Page) {
  const context = await page
    .context()
    .browser()
    ?.newContext({ baseURL: origin(page) });
  if (!context) throw new Error("no browser");
  const request = context.request;
  const headers = { Origin: origin(page) };
  const signedIn = await request.post("/api/session", {
    headers,
    data: { username: sam.username, password: SEED_PASSWORD },
  });
  expect(signedIn.ok()).toBe(true);
  return {
    context,
    say: async (itemId: string, body: string) => {
      const id = crypto.randomUUID();
      expect((await request.post(`/api/items/${itemId}/comments`, { headers, data: { id, body } })).ok()).toBe(true);
      return id;
    },
    react: async (path: string, kind: string) =>
      expect((await request.put(`/api${path}/reactions/${kind}`, { headers })).ok()).toBe(true),
  };
}

const reactions = (page: Page) => page.getByRole("list", { name: "Reactions" });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("reacts to your own idea, keeps it, and takes it back with a tap", { tag: "@phone" }, async ({ page }) => {
  const id = await newIdea(page);
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "React to this idea" }).click();
  const picker = page.getByRole("group", { name: "Reactions" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button")).toHaveCount(6);
  // The pill shows at once (optimistic); a reload before the request lands would cancel it.
  const saved = page.waitForResponse((r) => r.url().includes("/reactions/") && r.request().method() === "PUT");
  await picker.getByRole("button", { name: "Chef's kiss" }).click();
  await expect(picker).toHaveCount(0);
  expect((await saved).ok()).toBe(true);

  const pill = reactions(page).getByRole("button", { name: /Chef's kiss, from You/ });
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(pill).toBeVisible();

  const removed = page.waitForResponse((r) => r.url().includes("/reactions/") && r.request().method() === "DELETE");
  await pill.click();
  await expect(reactions(page).getByRole("button", { name: /Chef's kiss/ })).toHaveCount(0);
  expect((await removed).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "React to this idea" })).toBeVisible();
  await expect(reactions(page).getByRole("button", { name: /Chef's kiss/ })).toHaveCount(0);
});

test("reacts to the other person's comment, and both reactions count", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.setTimeout(60_000);
  const id = await newIdea(page);
  const samSide = await asSam(page);
  const commentId = await samSide.say(id, "Printed a test clip, it holds.");
  await page.goto(`/ideas/${id}`);
  const message = page.getByRole("list", { name: "Comments" }).getByText("Printed a test clip, it holds.");
  await expect(message).toBeVisible();
  if (isMobile) await message.click();
  else {
    await message.hover();
    await page.getByRole("button", { name: /^React to .+'s comment$/ }).click();
  }
  const saved = page.waitForResponse((r) => r.url().includes("/reactions/") && r.request().method() === "PUT");
  await page.getByRole("group", { name: "Reactions" }).getByRole("button", { name: "Bravo" }).click();
  const pill = page.locator(`#comment-${commentId}`).getByRole("button", { name: /Bravo, from You/ });
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  expect((await saved).ok()).toBe(true);

  // Sam gives the same one: after the feed (or a reload) it reads "2", from both of you.
  await samSide.react(`/comments/${commentId}`, "bravo");
  await page.reload();
  const both = page.locator(`#comment-${commentId}`).getByRole("button", { name: /Bravo, from .+ and you/ });
  await expect(both).toBeVisible();
  await expect(both).toContainText("2");
  await samSide.context.close();
});
