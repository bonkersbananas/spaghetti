import { expect, type Page } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Signing in lands on Today; these tests start from the inbox.
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

/** Removes every idea and build through the API, so the next test starts with an empty inbox. */
export async function clearIdeas(page: Page) {
  const origin = new URL(page.url()).origin;
  const response = await page.request.get("/api/items?stage=idea,building,done,shelved");
  if (!response.ok()) return;
  const { items } = await response.json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
}
