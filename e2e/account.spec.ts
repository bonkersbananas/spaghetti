import { expect, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { signIn } from "./helpers";

const NEW_PASSWORD = "a-fresh-pot-of-pasta";

test("changes your own password, keeps this device and signs out the other", async ({ page, browser, isMobile }) => {
  await signIn(page);
  const origin = new URL(page.url()).origin;

  // Another device of the same person.
  const other = await browser.newContext({ baseURL: origin });
  const login = await other.request.post("/api/session", {
    data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
    headers: { Origin: origin },
  });
  expect(login.ok()).toBe(true);
  expect((await other.request.get("/api/session")).status()).toBe(200);

  try {
    if (isMobile) {
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Change password" }).click();
    } else {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Change password" }).click();
    }
    const sheet = page.getByRole("dialog", { name: "Change password" });
    await expect(sheet).toBeVisible();
    // Names, autocomplete hints and the username a password manager needs.
    await expect(sheet.locator("input[name=username]")).toHaveValue(SEED_USERS[0].username);
    const current = sheet.getByLabel("Current password");
    const next = sheet.getByLabel("New password");
    await expect(current).toHaveAttribute("autocomplete", "current-password");
    await expect(next).toHaveAttribute("autocomplete", "new-password");
    await expect(current).toHaveAttribute("type", "password");

    // Too short: the button waits.
    const submit = sheet.getByRole("button", { name: "Save new password" });
    await current.fill(SEED_PASSWORD);
    await next.fill("short");
    await expect(submit).toBeDisabled();

    // A wrong current password is said under its field, and nothing typed is cleared.
    await current.fill("not the password");
    await next.fill(NEW_PASSWORD);
    await submit.click();
    await expect(sheet.getByText("That isn't your current password.")).toBeVisible();
    await expect(current).toHaveValue("not the password");
    await expect(next).toHaveValue(NEW_PASSWORD);

    // The show toggle reveals both.
    await sheet.getByRole("button", { name: "Show" }).click();
    await expect(next).toHaveAttribute("type", "text");

    await current.fill(SEED_PASSWORD);
    await submit.click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Password changed")).toBeVisible();
    await expect(page.getByText("Signed out on your other devices")).toBeVisible();

    expect((await page.request.get("/api/session")).status()).toBe(200);
    expect((await other.request.get("/api/session")).status()).toBe(401);
  } finally {
    // Leave the seeded password as it was for the other tests.
    const response = await page.request.put("/api/account/password", {
      data: { currentPassword: NEW_PASSWORD, newPassword: SEED_PASSWORD },
      headers: { Origin: origin },
    });
    expect([200, 403]).toContain(response.status());
    await other.close();
  }
});
