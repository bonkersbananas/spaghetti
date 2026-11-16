import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

// A link to a page, opened signed out, goes through sign-in and on to that page, by every way of signing in; and the
// sign-in page's own address carries it, so a browser that is already signed in goes straight there. That is what
// "Open in Browser" from an app's own browser (Snapchat, Instagram) opens: the sign-in page's address.

const base = () => test.info().project.use.baseURL ?? "";
const origin = () => new URL(base()).origin;

/** Something to link to, made by the other cook through the API (the page under test stays signed out). */
async function addItem(request: APIRequestContext, title: string, stage: "idea" | "building" = "idea") {
  const signedIn = await request.post("/api/session", {
    headers: { Origin: origin() },
    data: { username: SEED_USERS[1].username, password: SEED_PASSWORD },
  });
  expect(signedIn.ok()).toBe(true);
  const id = crypto.randomUUID();
  const made = await request.post("/api/items", { headers: { Origin: origin() }, data: { id, title, stage } });
  expect(made.ok()).toBe(true);
  return id;
}

async function fillPassword(page: Page) {
  await page.getByLabel("Name").fill(SEED_USERS[0].username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

const title = (page: Page) => page.getByRole("textbox", { name: "Title" });

test.afterEach(async ({ request }) => {
  const response = await request.get("/api/items?stage=idea,building,done,shelved");
  if (!response.ok()) return;
  const { items } = await response.json();
  for (const item of items) await request.delete(`/api/items/${item.id}`, { headers: { Origin: origin() } });
});

test("a link to an idea opened signed out lands on the idea after signing in with a password", {
  tag: "@phone",
}, async ({ page, request }) => {
  const id = await addItem(request, "Spaghetti merch ideas");
  await page.goto("/journal");
  await page.goto(`/ideas/${id}`);
  // The sign-in page says where it goes on to, in its own address.
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirect=%2Fideas%2F${id}$`));
  await fillPassword(page);
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  await expect(title(page)).toHaveValue("Spaghetti merch ideas");
  // Sign-in took the link's place in history: back leaves for the page before it, not sign-in again.
  await page.goBack();
  await expect(page).toHaveURL(/\/(sign-in|journal)/);
  expect(new URL(page.url()).pathname).not.toBe(`/ideas/${id}`);
});

test("the sign-in page's address opened where someone is already signed in goes straight to the page", {
  tag: "@phone",
}, async ({ page, request }) => {
  const id = await addItem(request, "Benchy in silk PLA", "building");
  const session = await page.request.post("/api/session", {
    headers: { Origin: origin() },
    data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
  });
  expect(session.ok()).toBe(true);
  await page.goto(`/sign-in?redirect=${encodeURIComponent(`/builds/${id}`)}`);
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  await expect(title(page)).toHaveValue("Benchy in silk PLA");
});

test("signing in with a code from another device keeps the link too", async ({ page, request }) => {
  const id = await addItem(request, "Filament drybox lid", "building");
  await page.goto(`/builds/${id}`);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByRole("link", { name: /Use a code/ }).click();
  await expect(page).toHaveURL(new RegExp(`/link\\?redirect=%2Fbuilds%2F${id}$`));
  // Back to sign in and forth again keeps it as well.
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/sign-in\\?redirect=%2Fbuilds%2F${id}$`));
  await page.getByRole("link", { name: /Use a code/ }).click();

  // The other cook's signed-in device makes the code (as the account menu's "Sign in on another device" does).
  const made = await (await request.post("/api/account/sign-in-links", { headers: { Origin: origin() } })).json();
  await page.getByLabel("Code").fill(made.code);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // A browser with passkeys is offered one first; either way it then goes on to the build.
  const notNow = page.getByRole("button", { name: "Not now" });
  const titleField = title(page);
  await expect(notNow.or(titleField)).toBeVisible();
  if (await notNow.isVisible()) await notNow.click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  await expect(titleField).toHaveValue("Filament drybox lid");
});

test("a target that isn't one of the app's pages goes home instead", async ({ page }) => {
  const home = page.getByRole("heading", { level: 1, name: /^(Today|Journal)$/ });
  // Signing in.
  await page.goto(`/sign-in?redirect=${encodeURIComponent("//evil.example/ideas")}`);
  await fillPassword(page);
  await expect(home).toBeVisible();
  expect(new URL(page.url()).origin).toBe(origin());

  // Already signed in: every way out of the site, and an address the app doesn't have, lands home too.
  for (const evil of [
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/no/such/page",
    "/sign-in",
  ]) {
    await page.goto(`/sign-in?redirect=${encodeURIComponent(evil)}`);
    await expect(home).toBeVisible();
    expect(new URL(page.url()).origin, evil).toBe(origin());
    expect(new URL(page.url()).pathname, evil).toMatch(/^\/(today|journal)$/);
  }
});
