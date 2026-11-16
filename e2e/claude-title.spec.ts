import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

/**
 * Claude names an idea saved without a title (decision 0070). The e2e server's stand-in for Claude, on the port 100
 * above the app, names nothing until a test turns naming on (scripts/lib/fake-claude.ts), and then calls it this.
 */
const NAMED_TITLE = "Planetary gear set";
const standIn = (page: Page) => `http://127.0.0.1:${Number(new URL(page.url()).port) + 100}/titles`;
const ideas = (page: Page) => page.getByRole("list", { name: "Ideas" });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.request.put(standIn(page));
});

test.afterEach(async ({ page }) => {
  await page.request.delete(standIn(page));
  const origin = new URL(page.url()).origin;
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
});

test("a photo saved without a title gets one from Claude, in place, marked as Claude's until it is edited", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Photo 1" })).toBeVisible();
  if (isMobile) await sheet.getByRole("button", { name: "Save idea" }).click();
  else await sheet.getByRole("textbox", { name: "Note" }).press("Enter");
  await expect(sheet).toBeHidden();

  // The idea is there at once, as it was saved: a photo, no title, and Claude's quiet "Naming…" where it will land.
  const card = ideas(page).getByRole("listitem").first();
  await expect(card.getByRole("link").first()).toBeVisible();
  await expect(card.getByRole("heading")).toHaveCount(0);
  await expect(card.getByText("Naming…")).toBeVisible();

  // A few seconds later Claude's title arrives in the same card, without a reload, and the sign is gone.
  await expect(card.getByRole("heading", { name: NAMED_TITLE })).toBeVisible({ timeout: 15_000 });
  await expect(card.getByText("Naming…")).toHaveCount(0);

  // The idea's page shows it as the title, marked as Claude's.
  await card.getByRole("link").first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue(NAMED_TITLE);
  await expect(page.getByText("Named by Claude")).toBeVisible();

  // Editing it makes it the person's: the mark goes, and stays gone after a reload.
  await title.fill("Tea tin lid, hinged");
  await title.press("Enter");
  await expect(page.getByText("Named by Claude")).toBeHidden();
  await expect
    .poll(async () => (await (await page.request.get("/api/items")).json()).items[0]?.title)
    .toBe("Tea tin lid, hinged");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tea tin lid, hinged");
  await expect(page.getByText("Named by Claude")).toBeHidden();
});

test("a title someone types while Claude works is kept, and shows no sign", async ({ page }) => {
  await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await expect(sheet.getByRole("img", { name: "Photo 1" })).toBeVisible();
  // "slow": the stand-in takes a few seconds, time enough to name it first.
  await sheet.getByRole("textbox", { name: "Note" }).fill("slow one for the bathroom");
  await sheet.getByRole("textbox", { name: "Note" }).press("Enter");
  await expect(sheet).toBeHidden();

  await ideas(page).getByRole("link").first().click();
  const title = page.getByRole("textbox", { name: "Title" });
  // Claude is still at it; the first letter typed ends the sign.
  await expect(page.getByText("Looking at the photo…")).toBeVisible();
  await expect(title).toHaveAttribute("placeholder", "Naming…");
  await title.fill("Tugboat for the bath");
  await expect(page.getByText("Looking at the photo…")).toBeHidden();
  await title.press("Enter");
  await expect
    .poll(async () => (await (await page.request.get("/api/items")).json()).items[0]?.title)
    .toBe("Tugboat for the bath");
  // Claude's answer comes and is dropped.
  await page.waitForTimeout(6000);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tugboat for the bath");
  await expect(page.getByText("Named by Claude")).toBeHidden();
});
