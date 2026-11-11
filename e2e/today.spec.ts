import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];
const origin = (page: Page) => new URL(page.url()).origin;
const MINUTE = 60_000;

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
}

/** A build with one attempt on the bed, started `ago` ms ago, through the API. */
async function printing(page: Page, title: string, ago: number, estimatedMinutes: number) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
  const attempt = crypto.randomUUID();
  const response = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: {
      id: attempt,
      outcome: null,
      printedAt: Date.now() - ago,
      settings: { filaments: [{ type: "PLA", brand: "Bambu", colorName: "Green" }], estimatedMinutes },
    },
  });
  expect(response.ok()).toBe(true);
  return { id, attempt };
}

/** The outcome the server holds for an attempt: what the sheet's autosave has saved. */
const savedOutcome = async (page: Page, itemId: string, attemptId: string) =>
  (await (await page.request.get(`/api/items/${itemId}`)).json()).item.attempts.find(
    (attempt: { id: string }) => attempt.id === attemptId,
  ).outcome;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: the smoke test expects empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("a new notebook gets a welcome, not a blank page", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Nothing on the stove yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New idea" }).first()).toBeVisible();
});

test("shows the print on the bed with its progress, and Finish opens that attempt", async ({ page }) => {
  const { id } = await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  await page.goto("/today");

  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  await expect(bed.getByRole("progressbar", { name: "Print progress" })).toBeVisible();
  await expect(bed.getByText(/min left|Done around/)).toBeVisible();

  await bed.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
  await expect(page.getByRole("dialog", { name: "Finish attempt 1" })).toBeVisible();
  // The parameter is spent: closing the sheet doesn't leave a link that reopens it.
  await expect(page).not.toHaveURL(/finish=/);
});

test("asks how it went once the print should be done: the answer opens the sheet with it chosen and saved", async ({
  page,
}) => {
  const { id, attempt } = await printing(page, "Old print", 3 * 60 * MINUTE, 60);
  await page.goto("/today");

  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByText("Should be done by now")).toBeVisible();
  await expect(bed.getByRole("button", { name: "Finish" })).toHaveCount(0);
  // Nothing has been decided yet.
  expect(await savedOutcome(page, id, attempt)).toBeNull();
  await bed.getByRole("radio", { name: "Worked" }).click();
  // The sheet is where the photo, the tags and a word get added: it opens, with the outcome chosen.
  const sheet = page.getByRole("dialog", { name: "Finish attempt 1" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("radio", { name: "Worked" })).toBeChecked();
  // ...and its autosave keeps it.
  await expect.poll(() => savedOutcome(page, id, attempt)).toBe("success");
});

test("a print that is off the bed asks how it went, with the three answers, instead of a progress bar", async ({
  page,
  isMobile,
}) => {
  const { id, attempt } = await printing(page, "Drawer divider", 90 * MINUTE, 90);
  await printing(page, "Still going", 10 * MINUTE, 120);
  expect(await savedOutcome(page, id, attempt)).toBeNull();
  await page.request.patch(`/api/attempts/${attempt}`, {
    headers: { Origin: origin(page) },
    data: { endedAt: Date.now() - 10 * MINUTE },
  });
  await page.goto("/today");

  const bed = page.getByRole("region", { name: "On the bed" });
  const card = bed.getByRole("article").filter({ hasText: "Drawer divider" });
  await expect(card.getByText(/Off the bed at .* · how did it go\?/)).toBeVisible();
  await expect(card.getByRole("progressbar")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Finish" })).toHaveCount(0);
  // The one still printing keeps its bar.
  await expect(bed.getByRole("article").filter({ hasText: "Still going" }).getByRole("progressbar")).toBeVisible();

  await card.getByRole("radio", { name: "Spaghetti" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
  const sheet = page.getByRole("dialog", { name: "Finish attempt 1" });
  await expect(sheet.getByRole("radio", { name: "Spaghetti" })).toBeChecked();
  await expect.poll(() => savedOutcome(page, id, attempt)).toBe("failed");

  // The sidebar shows the print that is still printing before the one off the bed.
  if (!isMobile) {
    await page.keyboard.press("Escape");
    await page.goto("/ideas");
    await expect(page.getByRole("complementary").getByRole("link", { name: /Still going/ })).toBeVisible();
  }
});

test("hides sections with nothing in them, and the sidebar card on Today itself", async ({ page, isMobile }) => {
  await printing(page, "Tugboat", 10 * MINUTE, 90);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "On the bed" })).toBeVisible();
  // No spools loaded, no old ideas, no other builds: none of those sections is drawn.
  await expect(page.getByRole("region", { name: "In the printer" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Pick up again" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "On the back burner" })).toHaveCount(0);

  if (isMobile) return;
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByText("Tugboat")).toHaveCount(0);
  await page.goto("/ideas");
  const card = sidebar.getByRole("link", { name: /Tugboat/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText(/min left|Done around|On the bed/);
});

test("phones: search is a button in the page header, and the tab bar has Today", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the tab bar and the header button are for phones");
  const tabs = page.getByRole("navigation", { name: "Sections" });
  await expect(tabs.getByRole("link")).toHaveText(["Today", "Ideas", "Builds", "Journal"]);
  await page.getByRole("link", { name: "Search" }).click();
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeFocused();
  // Search itself has no search button.
  await expect(page.getByRole("link", { name: "Search" })).toHaveCount(0);
});

test("passes axe with a print on the bed", async ({ page }) => {
  await printing(page, "Tugboat", 10 * MINUTE, 90);
  await printing(page, "Late one", 5 * 60 * MINUTE, 60);
  await page.goto("/today");
  await expect(page.getByRole("region", { name: "On the bed" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  expect(violations.map((violation) => `${violation.id}: ${violation.nodes[0]?.html}`)).toEqual([]);
});
