import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;

let hadBridge = false;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  hadBridge = !!(await (await page.request.get("/api/printer")).json()).bridge;
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
  // The test's bridge goes again where there was none, and no working token stays behind.
  if (!hadBridge) await page.request.delete("/api/printer/bridge", { headers: { Origin: origin(page) } });
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
});

/** A build the way the printer bridge's weekend left them: a person's partial, the printer's filing, one off the bed. */
async function mixedBuild(page: Page) {
  const headers = { Origin: origin(page) };
  const made = await page.request.post("/api/agents", {
    headers,
    data: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
  });
  const { token } = (await made.json()) as { token: string };
  const bridge = { ...headers, Authorization: `Bearer ${token}` };
  // A bridge that says it is there is the printer's agent: what it files is the printer's.
  await page.request.put("/api/printer/bridge", { headers: bridge, data: {} });
  const itemId = crypto.randomUUID();
  const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await page.request.post("/api/items", { headers, data: { id: itemId, title: "Ornament", stage: "building" } });
  const day = 86_400_000;
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: ids[0], printedAt: Date.now() - 3 * day, outcome: "failed" },
  });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers: bridge,
    data: { id: ids[1], printedAt: Date.now() - 2 * day, outcome: "partial" },
  });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers: bridge,
    data: { id: ids[2], printedAt: Date.now() - 3 * 3_600_000 },
  });
  await page.request.patch(`/api/attempts/${ids[2]}`, { headers: bridge, data: { endedAt: Date.now() - 60 * 60_000 } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers: bridge,
    data: { id: ids[3], printedAt: Date.now() - 20 * 60_000 },
  });
  return { itemId, ids, token };
}

test("@phone a build of person-made and printer-made attempts, one off the bed and one printing, says each right", async ({
  page,
}) => {
  const { itemId, ids } = await mixedBuild(page);
  for (const search of ["", `?attempt=${ids[2]}`, `?attempt=${ids[3]}`]) {
    await page.goto(`/builds/${itemId}${search}`);
    await expect(page.getByRole("heading", { name: "Attempts" })).toBeVisible();
    await expect(page.getByText("got tangled")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attempt 3: off the bed" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Attempt 4: printing" }).first()).toBeVisible();
    // The summary says it in words, with no attempt counted as both.
    await expect(page.getByText("1 spaghetti, 1 partly, printing now, off the bed")).toBeVisible();
  }
});

test("an attempt off the bed is never called printing in Deleted", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: itemId, title: "Lid clip", stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, printedAt: Date.now() - 3 * 3_600_000 },
  });
  await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: { endedAt: Date.now() - 60 * 60_000 } });
  await page.request.delete(`/api/attempts/${attemptId}`, { headers });
  await page.goto("/deleted");
  await expect(page.getByText("Attempt of Lid clip")).toBeVisible();
  await expect(page.getByText("Was off the bed")).toBeVisible();
  await expect(page.getByText("Was printing")).toHaveCount(0);
});
