import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * Principle 7 (never lose work): a tap is final even when the app is reloaded (or swiped away) right after it.
 * Every step below reloads at once, without waiting for the request: lib/api.ts gives small writes `keepalive` so
 * the browser finishes them after the page is gone.
 */
const origin = (page: Page) => new URL(page.url()).origin;
const tag = () => Math.random().toString(36).slice(2, 7);

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("a reaction, a comment, a ticked shopping item and a rename survive an immediate reload", async ({ page }) => {
  test.setTimeout(90_000);
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  expect(
    (await page.request.post("/api/items", { headers, data: { id, title: "Cable comb", note: "For the desk." } })).ok(),
  ).toBe(true);
  const thing = `Glue ${tag()}`;
  expect(
    (await page.request.post("/api/shopping-items", { headers, data: { id: crypto.randomUUID(), name: thing } })).ok(),
  ).toBe(true);

  // A reaction, then a reload with no wait.
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "React to this idea" }).click();
  await page.getByRole("group", { name: "Reactions" }).getByRole("button", { name: "🤌" }).click();
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Reactions" }).getByRole("button", { name: /🤌, from You/ }),
  ).toBeVisible();

  // Taking it back, then reload (the race of #508).
  await page.getByRole("list", { name: "Reactions" }).getByRole("button", { name: /🤌/ }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "React to this idea" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Reactions" }).getByRole("button", { name: /🤌/ })).toHaveCount(0);

  // A comment.
  const field = page.getByRole("textbox", { name: /Say something to/ });
  await field.fill("Printed it, it holds.");
  await field.press("Enter");
  await page.reload();
  await expect(page.getByRole("list", { name: "Comments" }).getByText("Printed it, it holds.")).toBeVisible();

  // A rename: the autosave is flushed by the page hiding.
  await page.getByRole("textbox", { name: "Title" }).fill("Cable comb, wide");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable comb, wide");

  // A shopping item ticked off.
  await page.goto("/shopping");
  await page
    .getByRole("list", { name: "To buy" })
    .getByRole("checkbox", { name: `Bought: ${thing}` })
    .click();
  await page.reload();
  await expect(
    page.getByRole("list", { name: "Bought" }).getByRole("listitem").filter({ hasText: thing }).getByRole("checkbox"),
  ).toBeChecked();
});
