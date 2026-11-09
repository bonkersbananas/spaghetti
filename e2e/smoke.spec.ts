import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];

async function signIn(page: Page, password = SEED_PASSWORD) {
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("signs in, browses the four sections, opens capture and signs out", async ({ page, isMobile }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Spaghetti" })).toBeVisible();

  await signIn(page, "not the password");
  await expect(page.getByRole("alert")).toHaveText("That name and password don't match.");

  await signIn(page);
  await expect(page).toHaveURL(/\/ideas$/);
  await expect(page.getByRole("heading", { name: "Nothing simmering yet" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Sections" }).filter({ visible: true });
  for (const [label, emptyTitle] of [
    ["Builds", "Nothing on the bed"],
    ["Journal", "A clean notebook"],
    ["Search", "Nothing to untangle yet"],
    ["Ideas", "Nothing simmering yet"],
  ]) {
    await nav.getByRole("link", { name: label }).click();
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    await expect(page.getByRole("heading", { name: emptyTitle })).toBeVisible();
  }

  // Capture: the tab bar button on phones, the C key on desktop.
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill("A hook for the AMS");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();

  // The draft survives closing the sheet.
  await page.getByRole("button", { name: "Capture an idea" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: "Note" })).toHaveValue("A hook for the AMS");
  await page.keyboard.press("Escape");

  // Stays signed in across a reload.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Nothing simmering yet" })).toBeVisible();

  await page.goto("/styleguide");
  await expect(page.getByRole("heading", { name: "Styleguide" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Buttons" })).toBeVisible();

  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/ideas");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
});

test("desktop keyboard: G then a letter switches sections", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones have no keyboard shortcuts");
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Nothing simmering yet" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/journal$/);
  await page.keyboard.press("/");
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole("searchbox", { name: "Search" })).toBeFocused();
});

test("serves the PWA manifest and icons", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ display: "standalone", short_name: "Spaghetti" });
  for (const icon of ["/apple-touch-icon.png", "/icon-512.png", "/icon-maskable-512.png"]) {
    expect((await request.get(icon)).status()).toBe(200);
  }
});
