import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("shopping: opens, and has no accessibility violations", async ({ page }) => {
  await signIn(page);
  await page.goto("/shopping");
  await expect(page.getByRole("heading", { level: 1, name: "Shopping" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(violations.map((violation) => violation.id)).toEqual([]);
});
