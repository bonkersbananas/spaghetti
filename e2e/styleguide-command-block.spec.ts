import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The CommandBlock specimen on /styleguide: it renders and passes axe, in both themes.
for (const theme of ["light", "dark"] as const) {
  test(`command-block: styleguide specimen, ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signIn(page);
    await page.goto("/styleguide#command-block");
    const section = page.locator("#command-block");
    await expect(section).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .include("#command-block")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(violations.map((violation) => violation.id)).toEqual([]);
  });
}
