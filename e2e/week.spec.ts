import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { addWeeks, mondayOf } from "../src/shared/week.ts";

const user = SEED_USERS[0];
const origin = (page: Page) => new URL(page.url()).origin;
const photo = readFileSync("e2e/fixtures/tugboat.jpg");

test.beforeEach(async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
});

// Leave nothing behind: other specs expect empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

/** A build with a print that worked (with its final photo) and one that turned to spaghetti, printed `printedAt`. */
async function aBuild(page: Page, title: string, printedAt: number) {
  const headers = { Origin: origin(page) };
  const itemId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: itemId, title, stage: "building" } });
  const worked = crypto.randomUUID();
  for (const [id, outcome] of [
    [worked, "success"],
    [crypto.randomUUID(), "failed"],
  ] as const) {
    const made = await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: { id, outcome, printedAt, settings: { filaments: [{ type: "PETG", grams: 12 }] } },
    });
    expect(made.ok()).toBe(true);
  }
  const file = { name: "print.jpg", mimeType: "image/jpeg", buffer: photo };
  const put = await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: { width: "1280", height: "960", color: "#808080", attemptId: worked, large: file, thumb: file },
  });
  expect(put.ok()).toBe(true);
  return itemId;
}

const thisWeek = () => mondayOf(Date.now());

test("shows the week's prints as photos, then a few lines, and turns to the weeks either side", async ({ page }) => {
  const itemId = await aBuild(page, "Week test boat", Date.now() - 60_000);
  await page.goto(`/week/${thisWeek()}`);
  await expect(page.getByRole("heading", { level: 1, name: "This week" })).toBeVisible();
  // Photos first: the print is a picture that opens its attempt.
  const card = page.getByRole("link", { name: /Week test boat/ }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("img", { name: "Week test boat" })).toBeVisible();
  // Then the lines, with the names as links.
  const lines = page.getByRole("region", { name: /The week in a few lines/ });
  await expect(lines).toContainText(/\d+ prints?:/);
  await expect(lines.getByRole("link", { name: "Week test boat" })).toHaveAttribute("href", `/builds/${itemId}`);
  await expect(lines).toContainText(/About \d+ g of filament/);
  // No paragraph by Claude: it isn't written until the week is over, and nothing about the page needs it.
  await expect(page.getByLabel("Claude on the week")).toHaveCount(0);

  // This week is the last one: nothing after it.
  await expect(page.getByRole("button", { name: /^Next/ })).toHaveCount(0);
  await page.getByRole("button", { name: /^Previous/ }).click();
  await expect(page).toHaveURL(`/week/${addWeeks(thisWeek(), -1)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Last week" })).toBeVisible();
  // The keys do the same: → goes forward again.
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(`/week/${thisWeek()}`);
  await expect(page.getByRole("heading", { level: 1, name: "This week" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page).toHaveURL(`/week/${addWeeks(thisWeek(), -1)}`);
});

test("a week with nothing in it is a short warm line, and a day opens its own week", async ({ page }) => {
  await page.goto("/week/2024-01-03");
  await expect(page).toHaveURL("/week/2024-01-01");
  await expect(page.getByRole("heading", { level: 2, name: "Not a strand this week" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to this week" })).toBeVisible();
  await page.getByRole("button", { name: "Back to this week" }).click();
  await expect(page).toHaveURL(`/week/${thisWeek()}`);
  await page.goto("/week/nonsense");
  await expect(page).toHaveURL(`/week/${thisWeek()}`);
});

test("the journal and the palette lead to the week", async ({ page, isMobile }) => {
  await aBuild(page, "Journal week boat", Date.now() - 60_000);
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await page
    .getByRole("link", { name: /^The week/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/week\/\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  if (isMobile) return; // Phones have no palette.
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("last week");
  await page
    .getByRole("dialog", { name: "Command palette" })
    .getByRole("option", { name: /Last week/ })
    .click();
  await expect(page).toHaveURL(`/week/${addWeeks(thisWeek(), -1)}`);
  await expect(page.getByRole("heading", { level: 1, name: "Last week" })).toBeVisible();
});

test("Claude's paragraph is written once for a week that is over, and says what is being written until it lands", async ({
  page,
}) => {
  // A print in last week by the Worker's clock; the stand-in Claude answers with a short paragraph.
  const lastWeek = addWeeks(thisWeek(), -1);
  await aBuild(page, "Paragraph boat", Date.parse(`${lastWeek}T12:00:00Z`));
  await page.goto(`/week/${lastWeek}`);
  await expect(page.getByRole("heading", { level: 1, name: "Last week" })).toBeVisible();
  const note = page.getByLabel("Claude on the week");
  await expect(note).toContainText("PETG warped twice this week", { timeout: 20_000 });
  await expect(note.getByText("Claude on the week", { exact: true })).toBeVisible();
  // Kept: a reload shows it at once, with no new call.
  await page.reload();
  await expect(page.getByLabel("Claude on the week")).toContainText("PETG warped twice this week");
});
