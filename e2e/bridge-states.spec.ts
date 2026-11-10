import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];
const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
});

// Leave nothing behind: other specs expect empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools)
    await page.request.delete(`/api/spools/${spool.id}`, { headers: { Origin: origin(page) } });
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin(page) },
    data: { progress: null, unknownTrays: [] },
  });
});

/** A build with one attempt, the way the printer bridge leaves it. */
async function build(page: Page, attempt: Record<string, unknown>, patch?: Record<string, unknown>) {
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id: itemId, title: "Drawer divider", stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, printedAt: Date.now() - 90 * 60_000, settings: { estimatedMinutes: 90 }, ...attempt },
  });
  if (patch) await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: patch });
  return { itemId, attemptId };
}

const attemptOf = async (page: Page, itemId: string, attemptId: string) =>
  (await (await page.request.get(`/api/items/${itemId}`)).json()).item.attempts.find(
    (attempt: { id: string }) => attempt.id === attemptId,
  );

test("a print that is off the bed asks how it went, on the build, the builds list and the journal", async ({
  page,
}) => {
  const { itemId, attemptId } = await build(
    page,
    {},
    { endedAt: Date.now() - 10 * 60_000, suggestedFailureTag: "spaghetti" },
  );

  await page.goto("/builds");
  await expect(page.getByText(/off the bed at .* · how did it go\?/i)).toBeVisible();
  await expect(page.getByText("Should be done by now")).toHaveCount(0);

  await page.goto("/journal");
  await expect(page.getByText("Off the bed").first()).toBeVisible();

  await page.goto(`/builds/${itemId}`);
  const entry = page.getByRole("listitem").filter({ hasText: "Attempt 1" }).first();
  await expect(entry.getByText(/Off the bed at/)).toBeVisible();
  await expect(entry.getByText(/how did it go\?/)).toBeVisible();
  await expect(page.getByText("Should be done by now")).toHaveCount(0);

  // Not a verdict: nothing has been decided for us.
  expect(await attemptOf(page, itemId, attemptId)).toMatchObject({ outcome: null, failureTags: [] });

  // Spaghetti, right there: the printer's suggested tag comes pre-selected, marked as a suggestion.
  await entry.getByRole("radio", { name: "Spaghetti" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("radio", { name: "Spaghetti", checked: true })).toBeVisible();
  const tag = sheet.getByRole("button", { name: /Spaghetti.*suggested/ });
  await expect(tag).toBeVisible();
  await expect(sheet.getByText("The printer suggested the marked one.")).toBeVisible();
  await expect.poll(async () => (await attemptOf(page, itemId, attemptId)).outcome, { timeout: 10_000 }).toBe("failed");
  expect(await attemptOf(page, itemId, attemptId)).toMatchObject({
    failureTags: ["spaghetti"],
    suggestedFailureTag: "spaghetti",
  });

  // The tag is the person's to take off.
  await tag.click();
  await expect
    .poll(async () => (await attemptOf(page, itemId, attemptId)).failureTags, { timeout: 10_000 })
    .toEqual([]);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("Worked on a print off the bed takes no suggested tag along", async ({ page }) => {
  const { itemId, attemptId } = await build(
    page,
    {},
    { endedAt: Date.now() - 10 * 60_000, suggestedFailureTag: "spaghetti" },
  );
  await page.goto(`/builds/${itemId}`);
  await page
    .getByRole("listitem")
    .filter({ hasText: "Attempt 1" })
    .first()
    .getByRole("radio", { name: "Worked" })
    .click();
  await expect
    .poll(async () => (await attemptOf(page, itemId, attemptId)).outcome, { timeout: 10_000 })
    .toBe("success");
  expect((await attemptOf(page, itemId, attemptId)).failureTags).toEqual([]);
});

test("the printer's own progress replaces the estimate while it is fresh", async ({ page }) => {
  const { itemId, attemptId } = await build(page, { printedAt: Date.now() - 10 * 60_000 });
  await page.goto(`/builds/${itemId}`);
  await expect(page.getByText(/About 80 min left|Done around|min left/).first()).toBeVisible();
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin(page) },
    data: {
      printerState: "printing",
      progress: { attemptId, percent: 47, remainingMinutes: 38, layer: 112, totalLayers: 240 },
    },
  });
  // The change feed brings it to the open page.
  await expect(page.getByText("Layer 112 of 240 · about 38 min left")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("progressbar", { name: "Print progress" }).first()).toHaveAttribute(
    "aria-valuenow",
    "47",
  );

  await page.goto("/builds");
  await expect(page.getByText(/layer 112 of 240 · about 38 min left/i)).toBeVisible();
});

test("the Printer page says the bridge is connected, and asks about a spool it can't place", async ({ page }) => {
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin(page) },
    data: {
      printerState: "idle",
      unknownTrays: [{ slot: "A2", material: "PETG", colorHex: "#2c8a87", brand: null }],
    },
  });
  await page.goto("/printer");
  await expect(page.getByText("Printer bridge connected.")).toBeVisible();
  const slot = page.locator('[data-slot="A2"]');
  await expect(slot).toContainText("Which spool?");
  await expect(slot).toContainText("Printer sees PETG");
  // A gentle prompt: tapping it is the ordinary spool picker.
  await slot.click();
  await expect(page.getByRole("dialog", { name: "Slot A2" })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
