import { expect, test } from "@playwright/test";
import { mondayOf } from "../src/shared/week.ts";
import { clearIdeas, signIn } from "./helpers";

// The stand-in Claude scouts only for a notebook that mentions "scout" (scripts/lib/fake-claude.ts), so other specs
// sharing this database find Today as they left it. Its answer: three models and a dead link, which is dropped.
const origin = (url: string) => new URL(url).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  const made = await page.request.post("/api/items", {
    headers: { Origin: origin(page.url()) },
    data: { id: crypto.randomUUID(), title: "Scout test: kitchen drawer organizer" },
  });
  expect(made.ok()).toBe(true);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  // The week's round stays (it is kept once a week): put every suggestion back, so each test starts with three.
  const { scout } = await (await page.request.get("/api/scout")).json();
  for (const pick of scout.picks) {
    const headers = { Origin: origin(page.url()) };
    if (pick.status === "kept") await page.request.delete(`/api/scout/${pick.id}/keep`, { headers });
    if (pick.status === "dismissed") await page.request.delete(`/api/scout/${pick.id}/dismiss`, { headers });
  }
  await clearIdeas(page);
});

test("Today offers three models, and Keep makes an idea with an Undo", { tag: "@phone" }, async ({ page }) => {
  await page.goto("/today");
  const block = page.getByRole("region", { name: "Three for you this week" });
  await expect(block).toBeVisible();
  await expect(block.getByRole("heading", { level: 3 })).toHaveCount(3);
  await expect(block.getByText("For the kitchen drawer you saved.")).toBeVisible();
  // The dead link was dropped before anyone saw it.
  await expect(page.getByText("Spiral vase")).toHaveCount(0);

  const card = block.getByRole("article").filter({ hasText: "Drawer divider set" });
  await card.getByRole("button", { name: "Keep" }).click();
  await expect(page.getByRole("region", { name: "Two for you this week" })).toBeVisible();
  const toast = page.getByText("Kept as an idea");
  await expect(toast).toBeVisible();

  // It is an idea now, with its link.
  await page.goto("/ideas");
  await expect(page.getByText("Drawer divider set").first()).toBeVisible();

  // Undo takes it back to the three.
  await page.goto("/today");
  await page
    .getByRole("region", { name: "Two for you this week" })
    .getByRole("button", { name: "Keep" })
    .first()
    .click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: "Two for you this week" })).toBeVisible();
});

test("Not for us puts it away with an Undo, and it stays away", { tag: "@phone" }, async ({ page }) => {
  await page.goto("/today");
  const block = page.getByRole("region", { name: "Three for you this week" });
  await expect(block).toBeVisible();
  await block
    .getByRole("article")
    .filter({ hasText: "Planter with a saucer" })
    .getByRole("button", { name: "Not for us" })
    .click();
  await expect(page.getByRole("region", { name: "Two for you this week" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Planter with a saucer")).toHaveCount(0);
  // The week page keeps it, dimmed, with a way back.
  await page.goto(`/week/${mondayOf(Date.now())}`);
  const dimmed = page.getByRole("article").filter({ hasText: "Planter with a saucer" });
  await expect(dimmed.getByText("Not for us")).toBeVisible();
  await dimmed.getByRole("button", { name: "Undo" }).click();
  await expect(dimmed.getByRole("button", { name: "Keep" })).toBeVisible();
});
