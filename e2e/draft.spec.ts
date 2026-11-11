import { expect, type Page, test } from "@playwright/test";
import { signIn as signInThroughApi } from "./helpers";

// The Worker asks a stand-in for Anthropic (scripts/lib/fake-claude.ts): a word in the address picks the answer.
const GOOD = "https://makerworld.com/en/models/1-cable-comb";
const SLOW = "https://makerworld.com/en/models/2-slow-comb";
const BROKEN = "https://www.printables.com/model/3-broken-hook";

const signIn = (page: Page) => signInThroughApi(page);

async function capture(page: Page, isMobile: boolean, note: string) {
  if (isMobile) await page.getByRole("button", { name: "New idea" }).click();
  else await page.keyboard.press("c");
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("textbox", { name: "Note" }).fill(note);
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await expect(sheet).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Every test leaves the inbox empty again, as the smoke test expects it.
test.afterEach(async ({ page }) => {
  const origin = new URL(page.url()).origin;
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin } });
});

test("a saved model link shows at once, reads the page and fills in the idea, with an undo", async ({
  page,
  isMobile,
}) => {
  await capture(page, isMobile, SLOW);
  // Saving never waits on Claude: the idea is there with its link while the page is read.
  const card = page.getByRole("list", { name: "Ideas" }).getByRole("link").first();
  await expect(card).toContainText("makerworld.com");
  await card.click();
  await expect(page.getByText("Reading the MakerWorld page…")).toBeVisible();

  const title = page.getByRole("textbox", { name: "Title" });
  await expect(title).toHaveValue("Cable comb for the desk", { timeout: 20_000 });
  await expect(page.getByText("Drafted by Claude from MakerWorld")).toBeVisible();
  await expect(page.getByText("Mila Okafor")).toBeVisible();
  await expect(page.getByText("CC BY 4.0")).toBeVisible();
  // The page's pictures came with it (the first is the cover), and its link card reads the page's title.
  await expect(page.getByRole("button", { name: /Photo 1 of 3|photo/i }).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Links in the note" })).toContainText("Cable comb for the desk");
  await expect(page.getByText("Drafted from MakerWorld")).toBeVisible(); // the toast

  await page.getByRole("button", { name: "Undo" }).first().click();
  await expect(title).toHaveValue("");
  await expect(page.getByText("Drafted by Claude from MakerWorld")).toBeHidden();
  // Taken back, it can be asked for again from the page's link.
  await expect(page.getByRole("button", { name: "Draft from this page" })).toBeVisible();
});

test("a page that can't be read leaves the idea as captured, with one line and a retry", async ({ page, isMobile }) => {
  await capture(page, isMobile, BROKEN);
  await page.getByRole("list", { name: "Ideas" }).getByRole("link").first().click();
  await expect(page.getByText("Claude couldn't read that page.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("words a person wrote are never replaced; the page's link can be drafted by hand", async ({ page, isMobile }) => {
  await capture(
    page,
    isMobile,
    `For Mila, the one with the little teeth. Print it in the green PETG if there is enough left, and check the size first. ${GOOD}`,
  );
  await page.getByRole("list", { name: "Ideas" }).getByRole("link").first().click();
  // Not a bare link, so nothing started by itself.
  await expect(page.getByRole("button", { name: "Draft from this page" })).toBeVisible();
  await page.getByRole("button", { name: "Draft from this page" }).click();
  await expect(page.getByText("Mila Okafor")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("For Mila, the one with the little teeth").first()).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable comb for the desk");
});

// The share target and the bookmarklet both end on /share?title=…&url=…: the page's own title comes along, and
// that doesn't count as the person's (the draft replaces it).
test("a shared model link with the page's title is drafted, and the draft's title replaces the shared one", async ({
  page,
}) => {
  // The draft's request stays open until Claude is done; leaving at once would drop it, and here no cron picks it up.
  const drafted = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/items\/[^/]+\/draft$/.test(r.url()),
  );
  await page.goto(
    `/share?title=${encodeURIComponent("Cable comb by Mila | MakerWorld")}&url=${encodeURIComponent(GOOD)}`,
  );
  await expect(page.getByRole("dialog", { name: "Into the pot" })).toBeVisible();
  await drafted;
  await page.goto("/ideas");
  await page.getByRole("list", { name: "Ideas" }).getByRole("link").first().click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable comb for the desk", {
    timeout: 20_000,
  });
  await expect(page.getByText("Drafted by Claude from MakerWorld")).toBeVisible();
});
