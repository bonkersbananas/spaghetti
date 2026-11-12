import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("workshop: four tiles lead to the pantry, the printer, the shopping list and the twists", async ({ page }) => {
  await signIn(page);
  await page.goto("/workshop");
  await expect(page.getByRole("heading", { level: 1, name: "Workshop" })).toBeVisible();
  for (const [name, path] of [
    ["Pantry", "/pantry"],
    ["Printer", "/printer"],
    ["Shopping list", "/shopping"],
    ["Twists", "/twists"],
  ] as const) {
    await expect(page.locator("main").getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
      "href",
      path,
    );
  }
  await page
    .locator("main")
    .getByRole("link", { name: /^Pantry/ })
    .click();
  await expect(page).toHaveURL(/\/pantry$/);
});
