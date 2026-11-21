import { expect, type Page, test } from "@playwright/test";
import { slicerFile } from "./fixtures/slicer-file.ts";
import { clearIdeas, signIn } from "./helpers.ts";

/**
 * Which build a print belongs to (decision 0076): the printer bridge files a print in a build of its own, the app asks
 * "Which build is this?" (or puts it straight in the build it fits), a tap moves it with its photos, and Undo puts it
 * back as it was. On phones and desktops alike: it is answered standing at the printer as often as at the desk.
 */

const origin = (page: Page) => new URL(page.url()).origin;
const tokens: string[] = [];

test.beforeEach(async ({ page }) => {
  await signIn(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  // Leave no working token behind.
  const { agents } = await (await page.request.get("/api/agents")).json();
  for (const agent of agents)
    for (const token of agent.tokens)
      await page.request.delete(`/api/agents/${agent.id}/tokens/${token.id}`, { headers: { Origin: origin(page) } });
  tokens.splice(0);
});

async function bridgeToken(page: Page) {
  if (tokens[0]) return tokens[0];
  const made = await page.request.post("/api/agents", {
    headers: { Origin: origin(page) },
    data: { name: "Printer bridge", scopes: ["read", "attempts", "printer"] },
  });
  expect(made.ok()).toBe(true);
  const { token } = await made.json();
  tokens.push(token);
  return token as string;
}

/** A build started half an hour ago keeping a slicer file named `fileName`, as Spaghetti or Bambu Studio left it. */
async function buildKeeping(page: Page, title: string, fileName: string) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  const made = await page.request.post("/api/items", {
    headers,
    data: { id, title, stage: "building", createdAt: Date.now() - 30 * 60_000 },
  });
  expect(made.ok()).toBe(true);
  const bytes = slicerFile();
  const kept = await page.request.put(`/api/items/${id}/files/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      name: fileName,
      size: String(bytes.length),
      plate: "1",
      plateCount: "1",
      prefill: "{}",
      file: { name: fileName, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) },
    },
  });
  expect(kept.ok()).toBe(true);
  return id;
}

/** What the bridge does when a print starts: a build of its own, then the attempt with what the printer said. */
async function bridgeFiles(page: Page, name: string) {
  const headers = { Origin: origin(page), Authorization: `Bearer ${await bridgeToken(page)}` };
  const ownId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  expect(
    (await page.request.post("/api/items", { headers, data: { id: ownId, title: name, stage: "building" } })).ok(),
  ).toBe(true);
  const filed = await page.request.post(`/api/items/${ownId}/attempts`, {
    headers,
    data: {
      id: attemptId,
      printedAt: Date.now() - 5 * 60_000,
      print: { name, gcodeFile: "Metadata/plate_1.gcode", plate: 1, estimateMinutes: 40 },
    },
  });
  expect(filed.ok()).toBe(true);
  const { attempt } = await filed.json();
  return { ownId, attemptId, itemId: attempt.itemId as string };
}

/** The build an attempt is in now, by the server. */
async function homeOf(page: Page, attemptId: string, ids: string[]) {
  for (const id of ids) {
    const response = await page.request.get(`/api/items/${id}`, { maxRedirects: 0 });
    if (!response.ok()) continue;
    const { item } = await response.json();
    const attempt = item.attempts.find((one: { id: string }) => one.id === attemptId);
    if (attempt) return { itemId: item.id as string, asking: !!attempt.print?.asking };
  }
  return null;
}

test("the printer asks which build a print is, a tap puts it there, and Undo asks again", { tag: "@phone" }, async ({
  page,
}) => {
  // Two builds keep the same file: the print could be either, so the app asks.
  const planter = await buildKeeping(page, "Herb planter", "planter-v2.gcode.3mf");
  const balcony = await buildKeeping(page, "Balcony planters", "planter-v2.gcode.3mf");
  const { ownId, attemptId, itemId } = await bridgeFiles(page, "planter-v2(2)");
  expect(itemId).toBe(ownId);

  await page.goto(`/builds/${ownId}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  const question = entry.getByRole("region", { name: "Which build is this?" });
  await expect(question).toBeVisible();
  await expect(question.getByText("The printer calls it planter-v2(2).")).toBeVisible();
  await expect(question.getByRole("button", { name: /^Balcony planters/ })).toBeVisible();
  await question.getByRole("button", { name: /^Herb planter Same file as planter-v2\.gcode\.3mf/ }).click();

  // The printer's build went with it, and the page follows the print into the herb planter.
  await expect(page.getByText("Moved to Herb planter")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/builds/${planter}`));
  await expect(page.getByRole("heading", { level: 1, name: "Herb planter" })).toBeVisible();
  await expect
    .poll(() => homeOf(page, attemptId, [planter, ownId, balcony]))
    .toEqual({
      itemId: planter,
      asking: false,
    });
  // The printer's own build is gone with it: its address leads to the herb planter.
  const merged = await page.request.get(`/api/items/${ownId}`, { maxRedirects: 0 });
  expect(merged.status()).toBe(308);
  expect(merged.headers().location).toBe(`/api/items/${planter}`);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => homeOf(page, attemptId, [planter, ownId, balcony])).toEqual({ itemId: ownId, asking: true });
  await page.goto(`/builds/${ownId}`);
  await expect(page.getByRole("region", { name: "Which build is this?" })).toBeVisible();
});

test("a print the app placed says why, and “Not this build?” moves it with one tap", { tag: "@phone" }, async ({
  page,
}) => {
  // Only one build keeps the ring's file, and it was started just before: the print goes straight in.
  const glass = await buildKeeping(page, "UÖBF glass markers", "UOBF-fit-test-ring.3mf");
  const coasters = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id: coasters, title: "Cork coasters", stage: "building" },
  });
  const { ownId, attemptId, itemId } = await bridgeFiles(page, "UOBF-fit-test-ring(2)");
  expect(itemId).toBe(glass);

  await page.goto(`/builds/${glass}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  await expect(entry.getByText("From the printer: same file as UOBF-fit-test-ring.3mf.")).toBeVisible();
  await entry.getByRole("button", { name: "Not this build?" }).click();

  const sheet = page.getByRole("dialog", { name: "Move attempt 1" });
  await expect(sheet.getByText("The printer calls it UOBF-fit-test-ring(2).", { exact: false })).toBeVisible();
  await sheet.getByRole("button", { name: /^Cork coasters/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("Moved to Cork coasters")).toBeVisible();
  await expect
    .poll(() => homeOf(page, attemptId, [coasters, glass, ownId]))
    .toEqual({
      itemId: coasters,
      asking: false,
    });
  // The glass markers' page no longer shows it.
  await expect(entry).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => homeOf(page, attemptId, [coasters, glass, ownId]))
    .toEqual({
      itemId: glass,
      asking: false,
    });
  await expect(entry.getByText("From the printer: same file as UOBF-fit-test-ring.3mf.")).toBeVisible();
});
