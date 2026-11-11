import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;
const sam = SEED_USERS[1];

async function makeIdea(page: Page, title: string) {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title },
  });
  expect(response.ok()).toBe(true);
  return id;
}

const mine = (page: Page) => page.getByRole("list", { name: "Your wishlist" });
/** The titles on your list, top first, as the server has them. */
const serverList = async (page: Page) => {
  const { wishlists } = await (await page.request.get("/api/wishlists")).json();
  const { items } = await (await page.request.get("/api/items?stage=idea")).json();
  const title = new Map(items.map((item: { id: string; title: string }) => [item.id, item.title]));
  return wishlists[0].entries.map((entry: { itemId: string }) => title.get(entry.itemId));
};

/** Sam, signed in through the API in a context of their own. */
async function samSession(page: Page) {
  const context = await page
    .context()
    .browser()
    ?.newContext({ baseURL: origin(page) });
  if (!context) throw new Error("no browser");
  const samPage = await context.newPage();
  await samPage.goto("/sign-in");
  const response = await samPage.request.post("/api/session", {
    headers: { Origin: origin(page) },
    data: { username: sam.username, password: SEED_PASSWORD },
  });
  expect(response.ok()).toBe(true);
  return { context, page: samPage };
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  await page.request.patch("/api/wishlists/me", { headers: { Origin: origin(page) }, data: { private: false } });
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("picks ideas, reorders them with the keyboard and starts a build from a row", async ({ page, isMobile }) => {
  for (const title of ["Hose clip", "Lamp shade", "Seed tray"]) await makeIdea(page, title);
  await page.goto("/wishlist");
  await expect(page.getByRole("heading", { name: "Nothing on your plate yet" })).toBeVisible();
  await page.getByRole("button", { name: "Pick ideas" }).click();
  const picker = page.getByRole("dialog", { name: "Pick your top ideas" });
  for (const title of ["Seed tray", "Hose clip", "Lamp shade"]) {
    await picker.getByRole("button", { name: title }).click();
  }
  await expect(picker.getByRole("button", { name: "Hose clip", pressed: true })).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(picker).toBeHidden();
  await expect.poll(() => serverList(page)).toEqual(["Seed tray", "Hose clip", "Lamp shade"]);

  // The keyboard moves a row by its handle; focus stays on it.
  const handle = mine(page).getByRole("button", { name: /^Move Lamp shade/ });
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  await expect(mine(page).getByRole("button", { name: /^Move Lamp shade, at 2/ })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => serverList(page)).toEqual(["Lamp shade", "Seed tray", "Hose clip"]);

  // Dragging by the handle (mouse on desktop, a finger's pointer on phones) moves it too.
  if (!isMobile) {
    // Let the keyboard moves' layout animation settle: a drag that starts mid-animation measures the old places.
    await page.waitForTimeout(1500);
    const from = await mine(page)
      .getByRole("button", { name: /^Move Hose clip/ })
      .boundingBox();
    const to = await mine(page)
      .getByRole("button", { name: /^Move Lamp shade/ })
      .boundingBox();
    if (!from || !to) throw new Error("no handles");
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 12; step++) {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + ((to.y - from.y - 10) * step) / 12);
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(200);
    await page.mouse.up();
    await expect.poll(() => serverList(page)).toEqual(["Hose clip", "Lamp shade", "Seed tray"]);
  }

  // Start building from a row: it leaves the list and opens the build.
  await mine(page).getByRole("button", { name: "Start building Seed tray" }).click();
  await expect(page).toHaveURL(/\/builds\//);
  await expect.poll(() => serverList(page)).not.toContain("Seed tray");
});

test("adds from the idea's page with an undo, and shows the list to the other person unless private", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const id = await makeIdea(page, "Hose clip");
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Hose clip");
  await page.getByRole("button", { name: "My wishlist", pressed: false }).click();
  await expect(page.getByRole("button", { name: "My wishlist", pressed: true })).toBeVisible();
  await expect.poll(() => serverList(page)).toEqual(["Hose clip"]);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => serverList(page)).toEqual([]);
  await page.getByRole("button", { name: "My wishlist", pressed: false }).click();
  await expect.poll(() => serverList(page)).toEqual(["Hose clip"]);

  const other = await samSession(page);
  try {
    await other.page.goto("/wishlist");
    await expect(other.page.getByRole("heading", { level: 1, name: "Wishlists" })).toBeVisible();
    // Narrower than lg, one list shows at a time under the Yours / Alex's switch.
    if ((other.page.viewportSize()?.width ?? 0) < 1024) {
      await other.page.getByRole("radio", { name: /^Alex/ }).check({ force: true });
    }
    await expect(other.page.getByRole("list", { name: /^Alex.* wishlist$/ }).getByText("Hose clip")).toBeVisible();
    // Alex keeps it private: Sam's screen follows the change feed.
    await page.goto("/wishlist");
    await page.getByRole("switch", { name: /^Show it to/ }).click();
    await expect(page.getByRole("switch", { name: /^Show it to/ })).toHaveAttribute("aria-checked", "false");
    await other.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(other.page.getByText(/keeps this list private/)).toBeVisible({ timeout: 20_000 });
  } finally {
    await other.context.close();
    await page.request.patch("/api/wishlists/me", { headers: { Origin: origin(page) }, data: { private: false } });
  }
});
