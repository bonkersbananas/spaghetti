import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * "Find what worked last time in one search": the questions people ask, answered with what worked first and the
 * words that matched in view, then one tap to start again. At desktop width; the @phone tests in journal-search.spec.ts
 * search on a phone.
 */

const origin = (page: Page) => new URL(page.url()).origin;
const MINUTE = 60_000;

async function post(page: Page, url: string, data: object) {
  const response = await page.request.post(url, { headers: { Origin: origin(page) }, data });
  expect(response.ok(), `${url}: ${response.status()} ${await response.text()}`).toBe(true);
  return response;
}

const petg = (bed: number) => ({
  filaments: [{ type: "PETG", brand: "Bambu", colorName: "Blue", colorHex: "#2f6f9f" }],
  bedType: "Textured PEI Plate",
  bedTemperature: bed,
  nozzleDiameter: 0.4,
});

async function seed(page: Page) {
  const build = crypto.randomUUID();
  await post(page, "/api/items", { id: build, title: "Tugboat hull", stage: "building" });
  await post(page, `/api/items/${build}/attempts`, {
    id: crypto.randomUUID(),
    outcome: "failed",
    failureTags: ["warping"],
    note: "Corners lifted",
    settings: petg(70),
    // Minutes ago, not hours: "today" is the workspace's (Stockholm) day, and a few hours back is yesterday after midnight.
    printedAt: Date.now() - 2 * MINUTE,
  });
  const worked = crypto.randomUUID();
  await post(page, `/api/items/${build}/attempts`, {
    id: worked,
    outcome: "success",
    note: "Clean and flat",
    settings: petg(80),
    printedAt: Date.now() - MINUTE,
  });
  return { build, worked };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("a settings question leads with what worked, shows the matching setting and starts again in one tap", async ({
  page,
}) => {
  const { build, worked } = await seed(page);
  await page.goto("/search");
  const box = page.getByRole("searchbox", { name: "Search" });
  await box.pressSequentially("PETG bed temp");

  const answer = page.getByRole("region", { name: "What worked" });
  await expect(answer.getByRole("link")).toHaveCount(1);
  const result = answer.getByRole("link", { name: /Tugboat hull · attempt 2/ });
  await expect(result).toContainText("Clean and flat");
  // The setting the words matched is on the card.
  await expect(result.locator("mark", { hasText: "bed" })).toBeVisible();
  await expect(result).toContainText("80 °C");
  // What went wrong comes after, under its own heading.
  await expect(page.getByRole("region", { name: "Attempts" }).getByRole("link")).toHaveCount(1);

  await answer.getByRole("button", { name: /Start again/ }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${build}\\?attempt=`));
  await expect(page.getByText("Started again")).toBeVisible();
  // The new attempt is printing, on the settings that worked.
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${build}`)).json();
      const latest = item.attempts.at(-1);
      return item.attempts.length === 3 && latest.id !== worked && latest.outcome === null
        ? latest.settings.bedTemperature
        : null;
    })
    .toBe(80);
});

test("a question in words, a typo and a time are understood", async ({ page }) => {
  await seed(page);
  await page.goto("/search?q=what%20worked%20for%20the%20tugboat");
  await expect(page.getByRole("region", { name: "What worked" }).getByRole("link")).toHaveCount(1);

  await page.goto("/search?q=wraping");
  await expect(page.getByText("Showing results for")).toBeVisible();
  await expect(page.getByText("warping", { exact: true }).first()).toBeVisible();

  await page.goto("/search?q=warping%20today");
  await expect(page.getByText("today", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Attempts" }).getByRole("link")).toHaveCount(1);
});

test("a spool is found by its colour", async ({ page }) => {
  const id = crypto.randomUUID();
  await post(page, "/api/spools", { id, material: "PLA", brand: "Polymaker", colorName: "Terracotta", finish: "silk" });
  try {
    await page.goto("/search?q=silk%20terracotta");
    const spools = page.getByRole("region", { name: "Spools" });
    await expect(spools.getByRole("link", { name: /Terracotta/ })).toBeVisible();
    await spools.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/pantry/${id}`));
  } finally {
    await page.request.delete(`/api/spools/${id}`, { headers: { Origin: origin(page) } });
  }
});

test.describe("on a laptop", () => {
  test.skip(({ isMobile }) => isMobile, "phones have no palette");

  test("the palette puts what worked first and shows the setting that matched", async ({ page }) => {
    await seed(page);
    await page.goto("/ideas");
    await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
    await page.getByRole("button", { name: /Jump to/ }).click();
    const dialog = page.getByRole("dialog", { name: "Command palette" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("petg bed temp");
    const worked = dialog.getByRole("group", { name: "What worked" });
    await expect(worked.getByRole("option", { name: /Tugboat hull.*Attempt 2/ })).toContainText("bed 80 °C");
  });
});
