import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

// The back control of an idea or build goes to where the page was opened from (and says so), on a phone and on a
// desktop, by tap, Escape and the browser's own back; opened directly, it goes to the list as before.

const origin = (page: Page) => new URL(page.url()).origin;

async function addItem(page: Page, title: string, stage: "idea" | "building" = "idea") {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title, stage },
  });
  expect(response.ok()).toBe(true);
  return id;
}

/** The detail page's back control, by the name it shows. */
const backControl = (page: Page, name: string) =>
  page.getByRole("main").getByRole("link", { name, exact: true }).first();

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("from the Journal, back returns to the Journal where it was, by the control, Escape and the browser", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  // Enough ideas for the Journal to scroll; the one opened is far down it.
  const target = await addItem(page, "Oldest pasta rack");
  for (let n = 0; n < 24; n++) await addItem(page, `Filler idea ${n}`);
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  // Wait for the end of the notebook: until then the next page's skeleton sits at the bottom, and a scroll position
  // measured with it there is further down than the Journal can come back to once it is gone.
  await expect(page.getByText("The first page of the notebook")).toBeVisible();
  const entry = page.locator(`main a[href="/ideas/${target}"]`).first();
  await entry.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
  await page.waitForTimeout(300);
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(300);

  const open = async () => {
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/ideas/${target}$`));
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Oldest pasta rack");
    await expect(backControl(page, "Journal")).toBeVisible();
  };
  const backOnTheJournal = async () => {
    await expect(page).toHaveURL(/\/journal$/);
    await expect(entry).toBeInViewport();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 80);
  };

  // The control: a step back, so the Journal is as it was left.
  await open();
  await backControl(page, "Journal").click();
  await backOnTheJournal();

  // The browser's (or phone's) own back.
  await open();
  await page.goBack();
  await backOnTheJournal();

  // Escape on a desktop does what the control does.
  if (!isMobile) {
    await open();
    await page.keyboard.press("Escape");
    await backOnTheJournal();
  }
});

test("from Search, back keeps the query, and steps within the build don't change where back goes", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  const id = await addItem(page, "Tortellini tray", "building");
  const response = await page.request.post(`/api/items/${id}/attempts`, {
    headers: { Origin: origin(page) },
    data: { id: crypto.randomUUID(), outcome: "success", note: "Stacks neatly", printedAt: Date.now() - 3_600_000 },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/search?q=tortellini");
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("tortellini");
  await page.locator(`main a[href^="/builds/${id}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tortellini tray");
  await expect(backControl(page, "Search")).toBeVisible();

  // Picking an attempt (J, or a tap on its card) is a step within the page: back still leaves to Search.
  if (!isMobile) {
    await page.keyboard.press("j");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
    await page.keyboard.press("Escape");
  } else {
    await backControl(page, "Search").click();
  }
  await expect(page).toHaveURL(/\/search\?q=tortellini$/);
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("tortellini");
});

test("an idea that becomes a build keeps where it was opened from", { tag: "@phone" }, async ({ page }) => {
  const id = await addItem(page, "Ravioli stamp");
  await page.goto("/journal");
  await page.locator(`main a[href="/ideas/${id}"]`).first().click();
  await expect(backControl(page, "Journal")).toBeVisible();
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  await expect(backControl(page, "Journal")).toBeVisible();
  await backControl(page, "Journal").click();
  await expect(page).toHaveURL(/\/journal$/);
});

test("opened from another idea through the palette, back names that idea and returns to it", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The command palette is a desktop tool");
  const first = await addItem(page, "Fusilli drying rack");
  const second = await addItem(page, "Fusilli hook");
  await page.goto(`/ideas/${first}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Fusilli drying rack");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("fusilli hook");
  await page.getByRole("dialog", { name: "Command palette" }).getByRole("option", { name: "Fusilli hook" }).click();
  await expect(page).toHaveURL(new RegExp(`/ideas/${second}$`));
  await expect(backControl(page, "Fusilli drying rack")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(new RegExp(`/ideas/${first}$`));
  // The first idea was opened directly: its way back is still the list.
  await expect(backControl(page, "Ideas")).toBeVisible();
});

test("opened directly, back goes to the list, by the control and by Escape", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  const id = await addItem(page, "Lasagne sheet cutter", "building");
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Lasagne sheet cutter");
  await expect(backControl(page, "Builds")).toBeVisible();
  await backControl(page, "Builds").click();
  await expect(page).toHaveURL(/\/builds$/);

  // A reload forgets where the page was opened from.
  await page.goto("/journal");
  await page.locator(`main a[href^="/builds/${id}"]`).first().click();
  await expect(backControl(page, "Journal")).toBeVisible();
  await page.reload();
  await expect(backControl(page, "Builds")).toBeVisible();
  if (!isMobile) {
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/\/builds$/);
  }
});
