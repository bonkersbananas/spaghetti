import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];
const origin = (page: Page) => new URL(page.url()).origin;

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

/** A build whose printing attempt is on the bed; the title picks what the stand-in Claude says (scripts/lib/fake-claude.ts). */
async function printing(page: Page, title: string) {
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id: itemId, title, stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, settings: { bedTemperature: 60, estimatedMinutes: 90 }, note: "The corner lifted." },
  });
  return { itemId, attemptId };
}

const ideas = (page: Page) => page.getByRole("region", { name: "Claude's ideas for the next try" });

test("a Spaghetti answer brings ideas, Use this fills the next attempt, dismissing stays dismissed", async ({
  page,
}) => {
  const { itemId, attemptId } = await printing(page, "Coach comb");
  await page.goto(`/builds/${itemId}`);
  // Answer it from the page (the same write the sheet makes): the ideas arrive without waiting.
  await page.request.patch(`/api/attempts/${attemptId}`, {
    headers: { Origin: origin(page) },
    data: { outcome: "failed" },
  });
  // The ideas are in the API first (the run happens after the answer); then the page shows them.
  await expect
    .poll(async () => (await (await page.request.get(`/api/items/${itemId}`)).json()).item.attempts[0].coach?.status, {
      timeout: 30_000,
    })
    .toBe("ready");
  await page.reload();
  await expect(ideas(page)).toBeVisible({ timeout: 30_000 });
  await expect(ideas(page).getByText("Add a brim")).toBeVisible();
  await expect(ideas(page).getByText("Warm the bed a little")).toBeVisible();
  // Nothing was set by it.
  const stored = (await (await page.request.get(`/api/items/${itemId}`)).json()).item.attempts[0];
  expect(stored.settings).toEqual({ bedTemperature: 60, estimatedMinutes: 90 });

  // The next attempt: the same ideas as chips; one tap fills in what changes, and says so.
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog");
  const chips = sheet.getByRole("region", { name: "Claude's ideas for the next try" });
  await expect(chips).toBeVisible();
  await expect(chips.getByText("added a brim")).toBeVisible();
  await expect(chips.getByText("bed 60 → 65 °C")).toBeVisible();
  await chips.getByRole("button", { name: "Use this" }).first().click();
  await expect(chips.getByText("In this attempt")).toBeVisible();
  await expect(sheet.getByText(/Changed from attempt 1: added a brim/)).toBeVisible();
  // Undo puts it back.
  await chips.getByRole("button", { name: "Undo" }).click();
  await expect(chips.getByText("In this attempt")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // Dismissing one is one tap, and it stays dismissed (also after a reload).
  await ideas(page).getByRole("button", { name: "Dismiss: Add a brim" }).click();
  await expect(ideas(page).getByText("Add a brim")).toHaveCount(0);
  await page.reload();
  await expect(ideas(page).getByText("Warm the bed a little")).toBeVisible();
  await expect(ideas(page).getByText("Add a brim")).toHaveCount(0);
});

test("it says it is thinking, and nothing shows when it has nothing useful to say or fails", async ({ page }) => {
  const slow = await printing(page, "Coach slow comb");
  await page.request.patch(`/api/attempts/${slow.attemptId}`, {
    headers: { Origin: origin(page) },
    data: { outcome: "partial" },
  });
  await page.goto(`/builds/${slow.itemId}`);
  await expect(page.getByText("Thinking about the next try…")).toBeVisible();
  await expect(ideas(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Thinking about the next try…")).toHaveCount(0);

  for (const title of ["Plain comb", "Broken coach comb", "Refused coach comb"]) {
    const made = await printing(page, title);
    await page.request.patch(`/api/attempts/${made.attemptId}`, {
      headers: { Origin: origin(page) },
      data: { outcome: "failed" },
    });
    await page.goto(`/builds/${made.itemId}`);
    await expect(page.getByText("Thinking about the next try…")).toHaveCount(0, { timeout: 20_000 });
    await expect(ideas(page)).toHaveCount(0);
  }
});
