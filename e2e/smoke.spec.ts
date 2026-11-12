import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];

async function signIn(page: Page, password = SEED_PASSWORD) {
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("signs in, browses the four sections, opens capture and signs out", async ({ page, isMobile }) => {
  // Signed out, / is the landing page; its Sign in leads here (e2e/landing.spec.ts has the rest).
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Spaghetti" })).toBeVisible();

  await signIn(page, "not the password");
  await expect(page.getByRole("alert")).toHaveText("That name and password don't match.");

  await signIn(page);
  // Desktop opens on Today; phones have no Today and open on the Journal.
  await expect(page).toHaveURL(isMobile ? /\/journal$/ : /\/today$/);
  await expect(
    page.getByRole("heading", { name: isMobile ? "A clean notebook" : "Nothing on the stove yet" }),
  ).toBeVisible();

  // Phones have Ideas, Builds, Journal and Workshop as tabs; search is a button in every page header.
  const nav = page.getByRole("navigation", { name: "Sections" }).filter({ visible: true });
  for (const [label, emptyTitle] of [
    ["Ideas", "Nothing simmering yet"],
    ["Builds", "Nothing on the bed"],
    ["Journal", "A clean notebook"],
    ["Search", "Nothing to untangle yet"],
    isMobile ? ["Workshop", ""] : ["Today", "Nothing on the stove yet"],
  ]) {
    const link =
      label === "Search" && isMobile
        ? page.getByRole("link", { name: "Search" })
        : nav.getByRole("link", { name: label });
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
    if (emptyTitle) await expect(page.getByRole("heading", { name: emptyTitle })).toBeVisible();
  }
  await page.goto("/ideas");
  // Hotkeys wait for the page: let the inbox show before pressing C.
  await expect(page.getByRole("heading", { name: "Nothing simmering yet" })).toBeVisible();

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

  // Sign out from a screen of the app: some styleguide specimens are wider than a phone, which widens the page and
  // left the account sheet moving under the tap now and then (the flake this test was known for).
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { name: "Nothing simmering yet" })).toBeVisible();
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Sign out" }).click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Sign out" }).click();
  }
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/ideas");
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
});

test("desktop keyboard: G then a letter switches sections", async ({ page, isMobile }) => {
  test.skip(isMobile, "phones have no keyboard shortcuts");
  await page.goto("/sign-in");
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Nothing on the stove yet" })).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page).toHaveURL(/\/ideas$/);
  await page.keyboard.press("g");
  await page.keyboard.press("t");
  await expect(page).toHaveURL(/\/today$/);
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
