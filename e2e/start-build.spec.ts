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
  const sheet = page.getByRole("dialog", { name: "What are you printing?" });
  await expect(sheet).toBeVisible();
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

test("Something new left empty leaves nothing behind", async ({ page }) => {
  await makeIdea(page, "An idea");
  const sheet = await openPicker(page);
  await sheet.getByRole("button", { name: "Something new" }).click();
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
  await sheet.getByRole("button", { name: "Something new" }).click();
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(200);
  // A reload is a closed tab: the page's own cleanup never runs.
  await page.reload();
  await page.goto("/builds");
  await expect(page.getByRole("heading", { level: 1, name: "Builds" })).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
});
