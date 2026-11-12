import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const user = SEED_USERS[0];
const origin = (page: Page) => new URL(page.url()).origin;
const photo = readFileSync("e2e/fixtures/tugboat.jpg");

test.beforeEach(async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^(Today|Journal)$/ })).toBeVisible();
});

// Leave nothing behind: other specs expect empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

/** A build whose print is off the bed with no outcome; the title picks what the stand-in Claude says (scripts/lib/fake-claude.ts). */
async function offTheBed(page: Page, title: string) {
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id: itemId, title, stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, printedAt: Date.now() - 90 * 60_000, settings: { estimatedMinutes: 90 } },
  });
  await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: { endedAt: Date.now() - 10 * 60_000 } });
  return { itemId, attemptId };
}

/** The bridge's way: a frame sent for the attempt, the original in both variants. */
async function addPhoto(page: Page, itemId: string, attemptId: string) {
  const file = { name: "frame.jpg", mimeType: "image/jpeg", buffer: photo };
  const response = await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers: { Origin: origin(page) },
    multipart: { width: "1280", height: "960", color: "#808080", attemptId, large: file, thumb: file },
  });
  expect(response.ok()).toBe(true);
}

const attemptOf = async (page: Page, itemId: string, attemptId: string) =>
  (await (await page.request.get(`/api/items/${itemId}`)).json()).item.attempts.find(
    (attempt: { id: string }) => attempt.id === attemptId,
  );

test("a photo gets a suggestion: hinted on the build, one tap to take it, tags marked as suggested", async ({
  page,
}) => {
  const { itemId, attemptId } = await offTheBed(page, "Spaghetti comb");
  await page.goto(`/builds/${itemId}`);
  const entry = page.getByRole("listitem").filter({ hasText: "Attempt 1" }).first();
  await expect(entry.getByRole("radio", { name: "Spaghetti" })).toBeVisible();
  await addPhoto(page, itemId, attemptId);

  // The suggestion arrives through the feed, on the button, without picking anything.
  const hinted = entry.getByRole("radio", { name: /Spaghetti suggested/ });
  await expect(hinted).toBeVisible({ timeout: 20_000 });
  await expect(entry.getByText(/Loose strands across the top half/)).toBeVisible();
  expect(await attemptOf(page, itemId, attemptId)).toMatchObject({ outcome: null, failureTags: [] });

  await hinted.click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("radio", { name: "Spaghetti", checked: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /^Spaghetti.*suggested/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Bed adhesion.*suggested/ })).toBeVisible();
  await expect(sheet.getByText("Claude's guess from the photo.")).toBeVisible();
  await expect.poll(async () => (await attemptOf(page, itemId, attemptId)).outcome, { timeout: 10_000 }).toBe("failed");
  expect(await attemptOf(page, itemId, attemptId)).toMatchObject({ failureTags: ["spaghetti", "bed-adhesion"] });
});

test("choosing something else is just picking it: no suggested tags come along", async ({ page }) => {
  const { itemId, attemptId } = await offTheBed(page, "Spaghetti comb");
  await addPhoto(page, itemId, attemptId);
  await page.goto(`/builds/${itemId}`);
  const entry = page.getByRole("listitem").filter({ hasText: "Attempt 1" }).first();
  await expect(entry.getByRole("radio", { name: /Spaghetti suggested/ })).toBeVisible({ timeout: 20_000 });
  await entry.getByRole("radio", { name: "Worked" }).click();
  await expect
    .poll(async () => (await attemptOf(page, itemId, attemptId)).outcome, { timeout: 10_000 })
    .toBe("success");
  expect(await attemptOf(page, itemId, attemptId)).toMatchObject({ failureTags: [], successNotes: [] });
});

test("in the attempt sheet it says it is looking, then suggests", async ({ page }) => {
  test.setTimeout(60_000);
  const slow = await offTheBed(page, "Slow spaghetti comb");
  await page.goto(`/builds/${slow.itemId}`);
  await page.getByRole("button", { name: "Attempt 1: off the bed. Open" }).click({ position: { x: 24, y: 24 } });
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByText("Looking at the photo…")).toBeVisible();
  const hinted = sheet.getByRole("radio", { name: /Spaghetti suggested/ });
  await expect(hinted).toBeVisible({ timeout: 20_000 });
  await expect(sheet.getByText("Looking at the photo…")).toBeHidden();
  expect((await attemptOf(page, slow.itemId, slow.attemptId)).outcome).toBeNull();
  await hinted.click();
  await expect(sheet.getByRole("button", { name: /Spaghetti.*suggested/ })).toBeVisible();
});

test("a photo Claude can't tell from changes nothing", async ({ page }) => {
  const { itemId, attemptId } = await offTheBed(page, "Unsure comb");
  await addPhoto(page, itemId, attemptId);
  await page.goto(`/builds/${itemId}`);
  const entry = page.getByRole("listitem").filter({ hasText: "Attempt 1" }).first();
  await expect(entry.getByRole("radio", { name: "Spaghetti" })).toBeVisible();
  await expect.poll(async () => (await attemptOf(page, itemId, attemptId)).photoRead, { timeout: 20_000 }).toBeNull();
  await expect(entry.getByText(/suggested/)).toHaveCount(0);
});

test("Today's off-the-bed card shows Claude's guess on the matching button and its reason", async ({ page }) => {
  const { itemId, attemptId } = await offTheBed(page, "Spaghetti comb");
  await addPhoto(page, itemId, attemptId);
  await page.goto("/today");
  const card = page.getByRole("article").filter({ hasText: "Spaghetti comb" });
  await expect(card.getByRole("radio", { name: /Spaghetti suggested/ })).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(/Loose strands across the top half/)).toBeVisible();
  // Nothing is picked for anyone.
  expect(await attemptOf(page, itemId, attemptId)).toMatchObject({ outcome: null });
  await expect(card.getByRole("radio", { checked: true })).toHaveCount(0);
});

test("at the printer, a photo from Today's card brings the suggestion there, in one tap", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  await offTheBed(page, "Spaghetti clip");
  // The same card: on the Journal's Now block on phones, on Today on desktop.
  await page.goto(isMobile ? "/journal" : "/today");
  await expect(page.getByText(/Off the bed at/).first()).toBeVisible();
  // The card's Take photo opens the camera on a phone; here the file goes straight to its input.
  await page.getByRole("button", { name: "Take photo", exact: true }).first().waitFor();
  await page
    .getByTestId("camera-input")
    .first()
    .setInputFiles({ name: "print.jpg", mimeType: "image/jpeg", buffer: photo });
  // Claude's guess lands on Today's own buttons, without opening the build (the list asks again while it looks).
  await expect(page.getByRole("radio", { name: /Spaghetti suggested/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Take photo", exact: true })).toHaveCount(0);
});
