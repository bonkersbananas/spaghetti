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

test("reorders the queue from the card menu: Move up and Move down", { tag: "@phone" }, async ({ page }) => {
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
  await page.getByRole("button", { name: "For someone" }).click();
  const field = page.getByRole("textbox", { name: "For", exact: true });
  await field.fill("Mila");
  // Clearing the name to type another one doesn't close the field under the cursor.
  await field.fill("");
  await field.fill("Mila");
  await expect.poll(async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.forWhom).toBe("Mila");
  await page.goto("/ideas");
  await expect(page.getByRole("list", { name: "Ideas" }).getByText(/^for Mila/)).toBeVisible();
  await page.goto("/search?q=Mila");
  await expect(page.getByRole("link", { name: /Mug stand/ }).first()).toBeVisible();
});

test("Today shows the first three of the queue, in order, and nothing when it is empty", async ({ page }) => {
  await page.goto("/today");
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Up next" })).toHaveCount(0);

  for (const title of ["Alpha", "Bravo", "Charlie", "Delta"]) {
    const id = await makeIdea(page, title);
    await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { upNext: true } });
  }
  await page.goto("/today");
  const section = page.getByRole("region", { name: "Up next" });
  await expect(section.getByRole("link")).toHaveText([/Alpha/, /Bravo/, /Charlie/, /All 4 in Ideas/]);
  await section.getByRole("link", { name: /Bravo/ }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Bravo");
});

test("on phones Up next is one compact strip, in queue order, above the inbox", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The strip is the phone's layout.");
  const queued: string[] = [];
  for (const title of ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]) {
    const id = await makeIdea(page, title);
    queued.push(id);
    await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { upNext: true } });
  }
  await makeIdea(page, "Plain inbox idea");
  await page.goto("/ideas");
  await expect.poll(() => names(page)).toEqual(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);
  await expect(page.getByRole("heading", { level: 2, name: /^Up next/ })).toBeVisible();

  // One row that scrolls sideways, and the inbox starts on the first screen.
  const strip = upNext(page);
  const box = await strip.boundingBox();
  const head = await page.getByRole("heading", { level: 2, name: /^Up next/ }).boundingBox();
  const viewport = page.viewportSize();
  // The heading and the strip together take well under a third of the screen.
  expect(box && head && viewport && box.y + box.height - head.y < viewport.height / 3).toBe(true);
  const cards = await strip.getByRole("listitem").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(new Set(cards.map(Math.round)).size).toBe(1);
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByRole("heading", { name: "Plain inbox idea" })).toBeInViewport();

  // A tap opens the idea.
  await strip.getByRole("link", { name: /Bravo/ }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Bravo");
  await page.goBack();

  // The menu takes it off Up next.
  await page.getByRole("button", { name: "Options for Alpha" }).click();
  await page.getByRole("button", { name: "Take off Up next" }).click();
  await expect.poll(() => names(page)).toEqual(["Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);
  await expect.poll(() => serverQueue(page)).toEqual(["Bravo", "Charlie", "Delta", "Echo", "Foxtrot"]);
});

test("on desktop Up next is one compact row, and the inbox starts on the first screen", async ({ page, isMobile }) => {
  test.skip(isMobile, "Phones have their own check above.");
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const title of ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"]) {
    const id = await makeIdea(page, title);
    await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { upNext: true } });
  }
  await makeIdea(page, "Plain inbox idea");
  await page.goto("/ideas");
  await expect.poll(() => names(page)).toHaveLength(9);
  const strip = upNext(page);
  const tops = await strip
    .getByRole("listitem")
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const widths = await strip
    .getByRole("listitem")
    .first()
    .evaluate((el) => el.getBoundingClientRect().width);
  expect(widths).toBeLessThan(200);
  // More than fit: it scrolls, and the arrow shows the rest.
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.getByRole("button", { name: "Later in Up next" }).click();
  await expect.poll(() => strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
  // The inbox's first card is on the first screen.
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toBeInViewport();

  // Hovering a card shows its menu; it takes the idea off.
  await strip.getByRole("link", { name: /Nine/ }).hover();
  await page.getByRole("button", { name: "Options for Nine" }).click();
  await page.getByRole("button", { name: "Take off Up next" }).click();
  await expect.poll(() => serverQueue(page)).not.toContain("Nine");
});

test("the model filters narrow the inbox beside its heading, not Up next", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const queued = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: queued, title: "Queued sketch" } });
  await page.request.patch(`/api/items/${queued}`, { headers, data: { upNext: true } });
  await page.request.post("/api/items", {
    headers,
    data: { id: crypto.randomUUID(), title: "Bins", note: "https://makerworld.com/en/models/487213-drawer-bins" },
  });
  await makeIdea(page, "Loose idea");
  await page.goto("/ideas");
  const rest = page.getByRole("region", { name: "The rest" });
  const inbox = page.getByRole("list", { name: "Ideas" });
  await rest.getByRole("button", { name: /^Has a model/ }).click();
  await expect(rest.getByRole("button", { name: /^Has a model/ })).toHaveAttribute("aria-pressed", "true");
  await expect(inbox.getByRole("heading", { name: "Bins" })).toBeVisible();
  await expect(inbox.getByRole("heading", { name: "Loose idea" })).toHaveCount(0);
  // Up next stays as it is.
  await expect(upNext(page).getByRole("heading", { name: "Queued sketch" })).toBeVisible();
  // A second tap shows every idea again.
  await rest.getByRole("button", { name: /^Has a model/ }).click();
  await expect(inbox.getByRole("heading", { name: "Loose idea" })).toBeVisible();
});
