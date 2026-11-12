import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("ideas with a model are marked, found with one tap, and show a model card on their page", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const withModel = crypto.randomUUID();
  const without = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers,
    data: { id: withModel, title: "Bins", note: "https://makerworld.com/en/models/487213-drawer-bins" },
  });
  await page.request.post("/api/items", {
    headers,
    data: { id: without, title: "Wobbly idea", note: "see https://makerworld.com/en/search/models?keyword=x" },
  });
  await page.goto("/ideas");
  const list = page.getByRole("list", { name: "Ideas" });
  await expect(list.getByText("MakerWorld")).toHaveCount(1);
  await page.getByRole("button", { name: /^Has a model/ }).click();
  await expect(list.getByRole("heading", { name: "Bins" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Wobbly idea" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Needs designing/ }).click();
  await expect(list.getByRole("heading", { name: "Wobbly idea" })).toBeVisible();
  await expect(list.getByRole("heading", { name: "Bins" })).toHaveCount(0);

  await page.goto(`/ideas/${withModel}`);
  const card = page.getByRole("link", { name: /Model on MakerWorld/ });
  await expect(card).toHaveAttribute("href", "https://makerworld.com/en/models/487213-drawer-bins");
  await expect(card).toHaveAttribute("target", "_blank");
  // The model's link isn't shown twice.
  await expect(page.getByRole("list", { name: "Links in the note" })).toHaveCount(0);
});
