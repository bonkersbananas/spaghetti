import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

test("opens the year from the journal and says what fixed a failure", async ({ page }) => {
  await signIn(page);
  const headers = { Origin: new URL(page.url()).origin };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Year test cube", stage: "building" } });
  const settings = (bed: number) => ({ bedTemperature: bed, filaments: [{ type: "PLA" }], bedType: "Cool Plate" });
  for (const [outcome, bed, ago, failureTags] of [
    ["failed", 50, 2, ["stringing"]],
    ["success", 70, 1, []],
  ] as const) {
    const response = await page.request.post(`/api/items/${id}/attempts`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        outcome,
        failureTags,
        settings: settings(bed),
        printedAt: Date.now() - ago * 60_000,
      },
    });
    expect(response.ok()).toBe(true);
  }

  await page.goto("/journal");
  await page.getByRole("link", { name: "See the year" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /so far$/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Prints by month" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "By material" })).toBeVisible();
  await expect(page.getByText(/Fixed .*by a warmer bed/).first()).toBeVisible();
  // Nothing on a bar is interactive: the months are described in words for screen readers.
  await expect(page.getByRole("list", { name: "Prints by month" }).locator("li").first()).toBeAttached();
});
