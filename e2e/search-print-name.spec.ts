import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/**
 * A build is found by the file name its print had ("holder-40mm-v2(5)-12-2"). When the words matched only that,
 * the row says so in one quiet line, with the match marked; when the row's own words matched, it adds nothing.
 */

const origin = (page: Page) => new URL(page.url()).origin;
let bridge: string | null = null;
let hadBridge = false;

/** The printer bridge's token: only its agent's prints get a print file name on their attempt. */
async function bridgeToken(page: Page) {
  if (bridge) return bridge;
  const made = await page.request.post("/api/agents", {
    headers: { Origin: origin(page) },
    data: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
  });
  expect(made.ok()).toBe(true);
  bridge = (await made.json()).token as string;
  const told = await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin(page), Authorization: `Bearer ${bridge}` },
    data: {},
  });
  expect(told.ok()).toBe(true);
  return bridge;
}

/** What the bridge files (a build named after the file), then a person gives the build a title of its own. */
async function buildPrintedAs(page: Page, title: string, file: string) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page), Authorization: `Bearer ${await bridgeToken(page)}` };
  expect((await page.request.post("/api/items", { headers, data: { id, title: file, stage: "building" } })).ok()).toBe(
    true,
  );
  const filed = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: { id: crypto.randomUUID(), printedAt: Date.now() - 5 * 60_000, print: { name: file } },
  });
  expect(filed.ok(), await filed.text()).toBe(true);
  const home = (await filed.json()).attempt.itemId as string;
  const retitled = await page.request.patch(`/api/items/${home}`, {
    headers: { Origin: origin(page) },
    data: { title },
  });
  expect(retitled.ok()).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  hadBridge = !!(await (await page.request.get("/api/printer")).json()).bridge;
  await clearIdeas(page);
  await buildPrintedAs(page, "Reindeer tealight holder", "holder-40mm-v2(5)-12-2");
  await buildPrintedAs(page, "Hook v2", "hook-v2");
  await page.reload();
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  if (bridge && !hadBridge) await page.request.delete("/api/printer/bridge", { headers: { Origin: origin(page) } });
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
  bridge = null;
});

test("a result found only by its print's file name shows the name, with the match marked", async ({ page }) => {
  await page.goto("/search?q=40mm");
  const row = page.getByRole("link", { name: /Reindeer tealight holder/ }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("holder-40mm-v2(5)-12-2");
  await expect(row.locator("mark", { hasText: "40mm" })).toBeVisible();
});

test("a result whose own words matched adds no file name line", async ({ page }) => {
  await page.goto("/search?q=v2");
  const hook = page.getByRole("link", { name: /Hook v2/ }).first();
  await expect(hook).toBeVisible();
  await expect(hook).not.toContainText("hook-v2");
  // The other build matched only through its file name.
  await expect(page.getByRole("link", { name: /Reindeer tealight holder/ }).first()).toContainText(
    "holder-40mm-v2(5)-12-2",
  );
});

test("a question that matches the title and the file name shows the name when only it had a word", async ({ page }) => {
  await page.goto("/search?q=holder%2040mm");
  const row = page.getByRole("link", { name: /Reindeer tealight holder/ }).first();
  await expect(row).toContainText("holder-40mm-v2(5)-12-2");
});
