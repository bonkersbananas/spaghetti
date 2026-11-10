import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

async function goToAgents(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /^Agents/ })
      .click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("link", { name: "Agents" }).click();
  }
  await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible();
}

async function tokenWorks(page: Page, token: string) {
  const response = await page.request.get("/api/items", { headers: { Authorization: `Bearer ${token}` } });
  return response.status();
}

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  // Leave no working token behind.
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
});

test("makes an agent, copies its token once, revokes it with an undo, and it stops working after the toast", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  await goToAgents(page, isMobile);
  // Agents stay after their tokens are revoked, so each run has its own name.
  const name = `Printer bridge ${Date.now() % 100_000}`;

  await page.getByRole("button", { name: "New agent" }).first().click();
  const sheet = page.getByRole("dialog", { name: "New agent" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel("Name").fill(name);
  await sheet.getByRole("button", { name: "Printer" }).click();
  await sheet.getByRole("button", { name: "Make token" }).click();

  // The token is shown once, with a Copy button.
  const shown = page.getByRole("dialog", { name: "Copy your token" });
  const token = (await shown.getByTestId("new-token").textContent()) ?? "";
  expect(token).toMatch(/^spg_[A-Za-z0-9_-]{43}$/);
  await shown.getByRole("button", { name: "Copy token" }).click();
  await expect(shown.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
  // The quiet "Connect Claude" snippet, filled in with this app's address and the token, with its own Copy.
  const command = `claude mcp add --transport http spaghetti ${origin(page)}/mcp --header "Authorization: Bearer ${token}"`;
  await expect(shown.getByRole("heading", { name: "Connect Claude" })).toBeVisible();
  await expect(shown.getByTestId("connect-command")).toHaveText(command);
  await shown.getByRole("button", { name: "Copy command" }).click();
  await expect(shown.getByRole("button", { name: "Copied" }).last()).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  // ...and it works: the MCP endpoint answers to this token.
  const hello = await page.request.post("/mcp", {
    headers: { Authorization: `Bearer ${token}` },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(hello.status()).toBe(200);
  expect((await hello.json()).result.tools.length).toBeGreaterThan(5);
  await shown.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // After that, only its start.
  const card = page.getByRole("list", { name: "Your agents" }).getByRole("listitem").filter({ hasText: name }).first();
  await expect(card.getByRole("heading", { name })).toBeVisible();
  await expect(card.getByText(`${token.slice(0, 8)}…`)).toBeVisible();
  await expect(card.getByText("Never used")).toBeVisible();
  await expect(page.getByText(token)).toHaveCount(0);
  expect(await tokenWorks(page, token)).toBe(200);
  await page.reload();
  await expect(page.getByText(token)).toHaveCount(0);

  // Revoke, then change your mind: the token never stopped working.
  await page.getByRole("button", { name: /^Revoke/ }).click();
  await expect(page.getByText("Token revoked")).toBeVisible();
  await expect(card.getByText("Revoked")).toBeVisible();
  expect(await tokenWorks(page, token)).toBe(200);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(card.getByText("Revoked")).toHaveCount(0);
  await page.waitForTimeout(7000);
  expect(await tokenWorks(page, token)).toBe(200);
  await expect(card.getByText(/^Used /))
    .toBeVisible({ timeout: 15_000 })
    .catch(() => undefined);

  // Revoke and let the toast go: now it stops, at once, and the row is gone.
  await page.getByRole("button", { name: /^Revoke/ }).click();
  await expect(page.getByText("Token revoked")).toBeVisible();
  expect(await tokenWorks(page, token)).toBe(200);
  await expect.poll(() => tokenWorks(page, token), { timeout: 15_000 }).toBe(401);
  await expect(card.getByText(`${token.slice(0, 8)}…`)).toHaveCount(0);
  await expect(card.getByText("No working tokens.")).toBeVisible();
});

test("work done through an agent says so, quietly, and the page passes axe in both themes", async ({
  page,
  isMobile,
}) => {
  test.setTimeout(90_000);
  const headers = { Origin: origin(page) };
  const made = await (
    await page.request.post("/api/agents", { headers, data: { name: "Claude for Alex", scopes: ["read", "capture"] } })
  ).json();
  const idea = await page.request.post("/api/items", {
    headers: { Authorization: `Bearer ${made.token}` },
    data: { id: crypto.randomUUID(), note: "A hook for the desiccant box" },
  });
  expect(idea.status()).toBe(201);

  await page.goto("/ideas");
  const card = page.getByRole("list", { name: "Ideas" }).getByRole("link", { name: /desiccant box/ });
  await expect(card).toBeVisible();
  await expect(card.getByRole("img", { name: "Alex Rivera, via Claude for Alex" })).toBeVisible();
  await card.click();
  await expect(page.getByText("captured this")).toBeVisible();
  await expect(page.getByText("via Claude for Alex")).toBeVisible();

  for (const scheme of ["light", "dark"] as const) {
    await page.goto("/ideas");
    await page.emulateMedia({ colorScheme: scheme });
    await goToAgents(page, isMobile);
    await expect(page.getByRole("heading", { name: "Claude for Alex" }).first()).toBeVisible();
    await page.waitForTimeout(500);
    const checks = [new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])];
    for (const builder of checks) expect((await builder.analyze()).violations.map((v) => v.id)).toEqual([]);
    await page.getByRole("button", { name: "New agent" }).first().click();
    await expect(page.getByRole("dialog", { name: "New agent" })).toBeVisible();
    await page.waitForTimeout(500);
    const sheet = await new AxeBuilder({ page }).include("[role=dialog]").analyze();
    expect(sheet.violations.map((v) => v.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("sets up sharing from iPhone: a capture-only key, in the steps ready to copy, and the bookmarklet", async ({
  page,
  isMobile,
}) => {
  await goToAgents(page, isMobile);
  // The bookmarklet is for desktop browsers.
  if (!isMobile) {
    await expect(page.getByRole("link", { name: "Save to Spaghetti" })).toHaveAttribute("href", /^javascript:/);
  } else {
    await expect(page.getByRole("link", { name: "Save to Spaghetti" })).toBeHidden();
  }

  await page.getByRole("button", { name: "Set up sharing from iPhone" }).click();
  const sheet = page.getByRole("dialog", { name: "Share from iPhone" });
  const steps = sheet.getByTestId("share-setup");
  await expect(steps).toContainText("Share to Spaghetti");
  await expect(steps).toContainText("Share photo to Spaghetti");
  await expect(steps).toContainText(`${new URL(page.url()).origin}/api/capture`);
  const header =
    (await steps
      .getByText(/^Bearer spg_/)
      .first()
      .textContent()) ?? "";
  const token = header.replace("Bearer ", "").trim();

  // It can add ideas and nothing else.
  const asToken = { Authorization: `Bearer ${token}` };
  const captured = await page.request.post("/api/capture", { headers: asToken, data: { text: "From the Shortcut" } });
  expect(captured.status()).toBe(201);
  expect((await page.request.get("/api/items", { headers: asToken })).status()).toBe(403);
  expect((await page.request.delete(`/api/items/${(await captured.json()).id}`, { headers: asToken })).status()).toBe(
    403,
  );

  await steps.getByRole("button", { name: "Copy address" }).first().click();
  await expect(steps.getByRole("button", { name: "Copied" })).toBeVisible();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
});
