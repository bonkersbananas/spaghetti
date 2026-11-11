import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// The Printer page's guide: a code is made, a (fake) bridge pairs with it and checks in, the sheet turns to
// "Connected", and Disconnect ends the token.
test("connect the bridge: a code, the command, waiting, connected, disconnect", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  await signIn(page);
  const origin = { Origin: baseURL as string };
  // Start from "no bridge" whatever an earlier test left.
  await page.request.delete("/api/printer/bridge", { headers: origin });
  await page.goto("/printer");
  await expect(page.getByText("No printer bridge yet.")).toBeVisible();
  await page.getByRole("button", { name: "Connect the bridge" }).click();

  const dialog = page.getByRole("dialog", { name: "Connect the bridge" });
  await expect(dialog.getByText("Waiting for the bridge…")).toBeVisible();
  await expect(dialog.getByText("LAN Only mode")).toBeVisible();
  const command = await dialog.locator("code").innerText();
  expect(command).toMatch(/curl -fsSL .*\/bridge\/install\.sh \| sh -s -- [A-Z2-9]{4}-[A-Z2-9]{4}/);
  expect(command).not.toContain("spg_");
  const code = /-- ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(command)?.[1] as string;

  // The fake bridge: what the installer and the program do, over the API, with no session.
  const paired = await (
    await page.request.post("/api/bridge/pair", { data: { code }, headers: { Cookie: "" } })
  ).json();
  expect(paired.scopes).toEqual(["read", "attempts", "printer"]);
  const beat = await fetch(`${baseURL}/api/printer/bridge`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${paired.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ printerState: "idle", version: "1.0.0", platform: "darwin-arm64", problems: [] }),
  });
  expect(beat.status).toBe(200);

  await expect(dialog.getByText("Connected to the X2D")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("The printer is idle.")).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Printer bridge connected.")).toBeVisible();
  await expect(page.getByText("Version 1.0.0 · darwin-arm64")).toBeVisible();

  // Setting it up again makes a new code, and the bridge that is already running doesn't count as the new one.
  await page.getByRole("button", { name: "Set it up again" }).click();
  const again = page.getByRole("dialog", { name: "Connect the bridge" });
  await expect(again.getByText("Waiting for the bridge…")).toBeVisible();
  expect(await again.locator("code").innerText()).not.toContain(code);
  await fetch(`${baseURL}/api/printer/bridge`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${paired.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ printerState: "idle", problems: [] }),
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(3500);
  await expect(again.getByText("Waiting for the bridge…")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(again).toBeHidden();

  // A problem is said in plain words.
  await fetch(`${baseURL}/api/printer/bridge`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${paired.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      printerState: "offline",
      problems: [{ code: "refused", message: "The printer refused the connection." }],
    }),
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("The printer refused the connection.")).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("No printer bridge yet.")).toBeVisible();
  const after = await fetch(`${baseURL}/api/printer`, { headers: { Authorization: `Bearer ${paired.token}` } });
  expect(after.status).toBe(401);
});
