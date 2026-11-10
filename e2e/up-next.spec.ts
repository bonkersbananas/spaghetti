import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

async function makeIdea(page: Page, title: string) {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title, note: `${title} note` },
  });
  expect(response.ok()).toBe(true);
  return id;
}

const upNext = (page: Page) => page.getByRole("list", { name: "Up next" });
const names = async (page: Page) => (await upNext(page).getByRole("heading").allTextContents()).map((t) => t.trim());
const serverQueue = async (page: Page) =>
  (await (await page.request.get("/api/items?stage=idea")).json()).items
    .filter((item: { upNext: number | null }) => item.upNext !== null)
    .sort((a: { upNext: number }, b: { upNext: number }) => a.upNext - b.upNext)
    .map((item: { title: string }) => item.title);

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("marks an idea Up next from its page, with an undo, and takes it off again", async ({ page }) => {
  const id = await makeIdea(page, "Hose clip");
  await page.goto(`/ideas/${id}`);
  const chip = page.getByRole("button", { name: "Up next", pressed: false });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hose clip");
  await chip.click();
  await expect(page.getByRole("button", { name: "Up next", pressed: true })).toBeVisible();
  await expect.poll(() => serverQueue(page)).toEqual(["Hose clip"]);

  // Undo, from the toast.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: "Up next", pressed: false })).toBeVisible();
  await expect.poll(() => serverQueue(page)).toEqual([]);

  // On the inbox it is a section on top.
  await page.getByRole("button", { name: "Up next", pressed: false }).click();
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 2, name: /^Up next/ })).toBeVisible();
  await expect(upNext(page).getByRole("heading", { name: "Hose clip" })).toBeVisible();

  // Taking it off from the card's menu, then undoing that, puts it back where it was.
  await page.getByRole("button", { name: "Options for Hose clip" }).click();
  await page.getByRole("button", { name: "Take off Up next" }).click();
  await expect(upNext(page)).toHaveCount(0);
  await expect.poll(() => serverQueue(page)).toEqual([]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(upNext(page).getByRole("heading", { name: "Hose clip" })).toBeVisible();
  await expect.poll(() => serverQueue(page)).toEqual(["Hose clip"]);
});

test("reorders the queue from the card menu: Move up and Move down", async ({ page }) => {
  for (const title of ["First", "Second", "Third"]) {
    const id = await makeIdea(page, title);
    await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { upNext: true } });
  }
  await page.goto("/ideas");
  await expect.poll(() => names(page)).toEqual(["First", "Second", "Third"]);

  await page.getByRole("button", { name: "Options for Third" }).click();
  await page.getByRole("button", { name: "Move up" }).click();
  await expect.poll(() => names(page)).toEqual(["First", "Third", "Second"]);
  await expect.poll(() => serverQueue(page)).toEqual(["First", "Third", "Second"]);

  await page.getByRole("button", { name: "Options for First" }).click();
  // The first can't go up.
  await expect(page.getByRole("button", { name: "Move up" })).toHaveCount(0);
  await page.getByRole("button", { name: "Move down" }).click();
  await expect.poll(() => names(page)).toEqual(["Third", "First", "Second"]);
  await expect.poll(() => serverQueue(page)).toEqual(["Third", "First", "Second"]);

  await page.reload();
  await expect.poll(() => names(page)).toEqual(["Third", "First", "Second"]);
});

test("reorders the queue by dragging on desktop", async ({ page, isMobile }) => {
  test.skip(isMobile, "Dragging is the desktop's way; phones use the menu.");
  for (const title of ["One", "Two", "Three"]) {
    const id = await makeIdea(page, title);
    await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { upNext: true } });
  }
  await page.goto("/ideas");
  await expect.poll(() => names(page)).toEqual(["One", "Two", "Three"]);
  const cards = upNext(page).getByRole("listitem");
  await cards.nth(2).locator("[draggable=true]").dragTo(cards.nth(0).locator("[draggable=true]"));
  await expect.poll(() => names(page)).toEqual(["Three", "One", "Two"]);
  await expect.poll(() => serverQueue(page)).toEqual(["Three", "One", "Two"]);
});

test("starting a build takes the idea off the queue", async ({ page }) => {
  const id = await makeIdea(page, "Bracket");
  await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { upNext: true } });
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("button", { name: "Up next", pressed: true })).toBeVisible();
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
  await expect.poll(() => serverQueue(page)).toEqual([]);
  // The undo puts it back on the queue.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => serverQueue(page)).toEqual(["Bracket"]);
});

test("who it is for shows under the title and is found by search", async ({ page }) => {
  const id = await makeIdea(page, "Mug stand");
  await page.goto(`/ideas/${id}`);
  await page.getByRole("textbox", { name: "For" }).fill("Mila");
  await expect.poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.forWhom).toBe("Mila");
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByText(/^for Mila/)).toBeVisible();
  await page.goto("/search?q=Mila");
  await expect(page.getByRole("link", { name: /Mug stand/ }).first()).toBeVisible();
});
