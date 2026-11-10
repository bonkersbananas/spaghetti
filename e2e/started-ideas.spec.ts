import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

const origin = (page: Page) => new URL(page.url()).origin;
const headers = (page: Page) => ({ Origin: origin(page) });

async function makeIdea(page: Page, title: string) {
  const id = crypto.randomUUID();
  // Captured a little while ago, so starting it later makes it a build that began as an idea.
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id, title, createdAt: Date.now() - 120_000 },
  });
  return id;
}

async function getItem(page: Page, id: string) {
  return (await (await page.request.get(`/api/items/${id}`)).json()).item;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: the smoke test expects empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: headers(page) });
});

test("an idea that was started stays in Ideas under Started, and opens its build", async ({ page }) => {
  const id = await makeIdea(page, "Flexi hummingbird");
  await makeIdea(page, "Still just an idea");
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  await expect(page.getByText("Started building")).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");

  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  // The unstarted idea comes first, in the inbox; the started one is under "Started", not in the inbox.
  await expect(
    page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /Still just an idea/ }),
  ).toBeVisible();
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /Flexi hummingbird/ })).toHaveCount(
    0,
  );
  const started = page.getByRole("list", { name: "Started", exact: true });
  await expect(started.getByRole("link", { name: /Flexi hummingbird/ })).toContainText("Building");
  await started.getByRole("link", { name: /Flexi hummingbird/ }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
});

test("scrapping a build that began as an idea sends it back to Ideas, and Undo brings the build back", async ({
  page,
}) => {
  const id = await makeIdea(page, "Flexi hummingbird");
  await page.request.patch(`/api/items/${id}`, { headers: headers(page), data: { stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, {
    headers: headers(page),
    data: { id: crypto.randomUUID(), outcome: null },
  });

  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Flexi hummingbird");
  await page.getByRole("button", { name: "Delete build" }).click();
  await expect(page.getByText("Build scrapped")).toBeVisible();
  await expect(page.getByText("Flexi hummingbird is back in Ideas")).toBeVisible();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("idea");
  expect((await getItem(page, id)).attempts).toHaveLength(0);

  await expect(
    page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /Flexi hummingbird/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(async () => (await getItem(page, id)).stage).toBe("building");
  expect((await getItem(page, id)).attempts).toHaveLength(1);
});

test("a build made from scratch is deleted as before", async ({ page }) => {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id, title: "From scratch", stage: "building" },
  });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("From scratch");
  await page.getByRole("button", { name: "Delete build" }).click();
  await expect(page.getByText("Build deleted")).toBeVisible();
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
});

test("Recently deleted lists what was deleted, and Restore brings it back", async ({ page }) => {
  const title = `Recently deleted chain ${crypto.randomUUID().slice(0, 8)}`;
  const id = await makeIdea(page, title);
  await page.request.delete(`/api/items/${id}`, { headers: headers(page) });

  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  await page.getByRole("link", { name: "Recently deleted" }).click();
  await expect(page).toHaveURL(/\/deleted$/);
  const row = page.getByRole("listitem").filter({ hasText: title });
  await expect(row).toContainText("goes for good in 30 days");
  await row.getByRole("button", { name: /^Restore/ }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(async () => (await getItem(page, id)).title).toBe(title);
});

test("a new build left empty removes itself without a toast, and isn't listed as deleted", async ({ page }) => {
  await page.goto("/builds");
  await expect(page.getByRole("heading", { level: 1, name: "Builds" })).toBeVisible();
  await page
    .getByRole("button", { name: /^(New build|Start a build)$/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/builds\/[0-9a-f-]+/);
  await expect(page.getByRole("textbox", { name: "Title" })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  // Wait until the server has it, then walk away.
  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(200);
  await page.getByRole("link", { name: "Builds" }).first().click();
  await expect(page).toHaveURL(/\/builds$/);

  await expect.poll(async () => (await page.request.get(`/api/items/${id}`)).status()).toBe(404);
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  const deleted = await (await page.request.get("/api/deleted")).json();
  expect(deleted.items.map((entry: { id: string }) => entry.id)).not.toContain(id);
});

test("a new build with a title is kept", async ({ page }) => {
  await page.goto("/builds");
  await page
    .getByRole("button", { name: /^(New build|Start a build)$/ })
    .first()
    .click();
  const title = page.getByRole("textbox", { name: "Title" });
  await title.fill("Spool holder");
  const id = new URL(page.url()).pathname.split("/").pop() as string;
  await expect.poll(async () => (await getItem(page, id)).title).toBe("Spool holder");
  await page.getByRole("link", { name: "Builds" }).first().click();
  await expect(page).toHaveURL(/\/builds$/);
  await page.waitForTimeout(500);
  expect((await page.request.get(`/api/items/${id}`)).status()).toBe(200);
});
