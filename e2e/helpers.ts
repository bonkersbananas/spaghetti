import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

/**
 * Signs in as `user` and lands on the Ideas inbox (what most tests start from). The session is made through the
 * API: the browser context keeps its cookie, so the sign-in form's page loads (two of them, about three seconds on
 * CI, for hundreds of tests) are skipped. The form itself is tested in smoke.spec.ts and passkeys.spec.ts.
 */
export async function signIn(
  page: Page,
  user: { username: string } = SEED_USERS[0],
  origin = new URL(page.url() === "about:blank" ? (test.info().project.use.baseURL ?? "") : page.url()).origin,
) {
  const response = await page.request.post("/api/session", {
    headers: { Origin: origin },
    data: { username: user.username, password: SEED_PASSWORD },
  });
  expect(response.ok(), "signing in through the API").toBe(true);
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

/** The same through the sign-in form, for the tests that are about signing in (the quiet passkey offer follows a password sign-in). */
export async function signInWithForm(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // Signing in lands on Today (Journal on phones, which have no Today); these tests start from the inbox.
  await expect(page.getByRole("heading", { level: 1, name: /^(Today|Journal)$/ })).toBeVisible();
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
