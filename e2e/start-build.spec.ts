import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

const headers = (page: Page) => ({ Origin: new URL(page.url()).origin });

async function makeIdea(page: Page, title: string, extra: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id, title, createdAt: Date.now() - 120_000, ...extra },
  });
  return id;
}

async function getItem(page: Page, id: string) {
  return (await (await page.request.get(`/api/items/${id}`)).json()).item;
}

async function openPicker(page: Page) {
  await page.goto("/builds");
  await expect(page.getByRole("heading", { level: 1, name: "Builds" })).toBeVisible();
  await page
    .getByRole("button", { name: /^(New build|Pick an idea to print)$/ })
    .first()
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "What are you printing?" })).toBeVisible();
  return sheet;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("picking an idea starts building it and opens its build", async ({ page }) => {
  const id = await makeIdea(page, "Cable comb");
  await makeIdea(page, "Plant saucer");
  const sheet = await openPicker(page);
  await sheet.getByRole("textbox", { name: "Search ideas" }).fill("cable");
  await expect(sheet.getByRole("button", { name: /Plant saucer/ })).toHaveCount(0);
  await sheet.getByRole("button", { name: /Cable comb/ }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");
});

test("Enter in the search takes the first idea, Up next first", async ({ page }) => {
  await makeIdea(page, "Older idea");
  const queued = await makeIdea(page, "Queued idea");
  await page.request.patch(`/api/items/${queued}`, { headers: headers(page), data: { upNext: 1 } });
  const sheet = await openPicker(page);
  await expect(sheet.getByText("Up next")).toBeVisible();
  await sheet.getByRole("textbox", { name: "Search ideas" }).press("Enter");
  await expect(page).toHaveURL(new RegExp(`/builds/${queued}`));
});

test("arrow keys move the ringed tile and Enter starts that one", async ({ page }) => {
  await makeIdea(page, "First idea");
  const second = await makeIdea(page, "Second idea");
  const sheet = await openPicker(page);
  // Newest first: Second idea is ringed on open. Right goes to the next tile.
  const search = sheet.getByRole("textbox", { name: "Search ideas" });
  await search.press("ArrowRight");
  await search.press("ArrowLeft");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/builds/${second}`));
});

test("a model link starts a build that has the link", async ({ page }) => {
  await makeIdea(page, "Something else");
  const sheet = await openPicker(page);
  await sheet.getByRole("button", { name: "Link or file" }).click();
  const url = "https://makerworld.com/en/models/1234567-benchy";
  await sheet.getByRole("textbox", { name: "Model link" }).fill(url);
  await sheet.getByRole("button", { name: "Start with this link" }).click();
  await expect(page).toHaveURL(/\/builds\/[0-9a-f-]{36}/);
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  await expect.poll(async () => (await getItem(page, id))?.note).toContain("1234567");
});

test("with no ideas the sheet says so and goes to link and file", async ({ page }) => {
  const sheet = await openPicker(page);
  await expect(sheet.getByText("No ideas yet")).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Model link" })).toBeVisible();
});

test("From scratch left empty leaves nothing behind", async ({ page }) => {
  await makeIdea(page, "An idea");
  const sheet = await openPicker(page);
  await sheet.getByRole("button", { name: "From scratch" }).click();
  await expect(page).toHaveURL(/\/builds\/[0-9a-f-]{36}/);
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(200);
  // Walking away from it empty removes it.
  await page.getByRole("link", { name: "Builds" }).first().click();
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
});

test("a build left by a closed tab is swept on the next visit to Builds", async ({ page }) => {
  await makeIdea(page, "An idea");
  const sheet = await openPicker(page);
  await sheet.getByRole("button", { name: "From scratch" }).click();
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(200);
  // A reload is a closed tab: the page's own cleanup never runs.
  await page.reload();
  await page.goto("/builds");
  await expect(page.getByRole("heading", { level: 1, name: "Builds" })).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
});

// The Builds list on screen may be older than the build (restored from the device, or fetched before it existed):
// the sweep asks the server about each blank build it remembers instead of trusting that list.
async function staleBuildsList(page: Page, stale: unknown[]) {
  await page.route(/\/api\/items\?stage=building/, (route) =>
    route.fulfill({ json: { items: stale }, headers: { "content-type": "application/json" } }),
  );
}
async function rememberAsBlank(page: Page, id: string) {
  await page.addInitScript((id) => {
    if (!localStorage.getItem("spaghetti.fresh-builds"))
      localStorage.setItem("spaghetti.fresh-builds", JSON.stringify([{ id, tab: "closed-tab" }]));
  }, id);
}

test("a blank build missing from a stale Builds list is still swept", async ({ page }) => {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id, stage: "building", createdAt: Date.now() - 120_000 },
  });
  await rememberAsBlank(page, id);
  await staleBuildsList(page, []);
  await page.goto("/builds");
  await expect(page.getByRole("heading", { level: 1, name: "Builds" })).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
});

test("a build that has words on the server is kept even when a stale list shows it blank", async ({ page }) => {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id, stage: "building", createdAt: Date.now() - 120_000 },
  });
  const blank = (await getItem(page, id)) as Record<string, unknown>;
  await page.request.patch(`/api/items/${id}`, { headers: headers(page), data: { note: "Added from my phone" } });
  await rememberAsBlank(page, id);
  await staleBuildsList(page, [blank]);
  await page.goto("/builds");
  await expect(page.getByRole("heading", { level: 1, name: "Builds" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("spaghetti.fresh-builds"))).toBeNull();
  expect((await page.request.get(`/api/items/${id}`)).status()).toBe(200);
});
