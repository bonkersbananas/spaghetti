import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * One name for an idea, everywhere (shared/item-name.ts): an untitled link idea goes by what its link says (here its
 * address's words: the test's app can't fetch the page) on its card, on its page and in the tab's title, and in
 * search, never by its raw address. Its title stays empty, with the name as the field's placeholder.
 */

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other specs expect an empty workshop.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("an untitled link idea reads the same on its card, its page and in search", async ({ page }) => {
  const id = crypto.randomUUID();
  const link = "https://www.printables.com/model/424242-gridfinity-baseplate-4x4";
  const name = "Gridfinity baseplate 4x4";
  const created = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: null, note: link },
  });
  expect(created.ok()).toBe(true);

  await page.goto("/ideas");
  const card = page.locator(`a[href="/ideas/${id}"]`).first();
  await expect(card).toContainText(name);
  await expect(card).not.toContainText("printables.com/model");

  await card.click();
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue("");
  await expect(title).toHaveAttribute("placeholder", name);
  await expect(page.locator("h1").first()).toHaveText(name);
  await expect(page).toHaveTitle(`${name} · Spaghetti`);

  await page.goto("/search?q=gridfinity");
  const result = page.getByRole("region", { name: "Ideas" }).locator(`a[href^="/ideas/${id}"]`);
  await expect(result).toContainText(name);
  await expect(result).not.toContainText("424242");

  // Naming it is one tap in the empty field: the name typed wins everywhere.
  await page.goto(`/ideas/${id}`);
  await title.fill("Baseplate for the drawer");
  await title.blur();
  await expect(page).toHaveTitle("Baseplate for the drawer · Spaghetti");
  await page.goto("/ideas");
  await expect(page.locator(`a[href="/ideas/${id}"]`).first()).toContainText("Baseplate for the drawer");
});
