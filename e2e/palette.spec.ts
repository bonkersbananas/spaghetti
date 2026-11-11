import { expect, type Page, test } from "@playwright/test";
import { signIn as signInThroughApi } from "./helpers";

const open = "ControlOrMeta+k";

const signIn = (page: Page) => signInThroughApi(page);

const origin = (page: Page) => new URL(page.url()).origin;

async function create(page: Page, data: { title: string; stage?: string; note?: string }) {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", { headers: { Origin: origin(page) }, data: { id, ...data } });
  expect(response.ok()).toBe(true);
  return id;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: the smoke test expects empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test.describe("on a laptop", () => {
  test.skip(({ isMobile }) => isMobile, "phones have no palette");

  test("opens from anywhere, lists actions and recent items, and closes with Escape", async ({ page }) => {
    const id = await create(page, { title: "Tugboat deck", stage: "building" });
    await page.goto(`/builds/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tugboat deck");

    await page.keyboard.press(open);
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Jump to or run" })).toBeFocused();

    // What fits this build comes first; the rest follow.
    const options = palette.getByRole("option");
    await expect(options.first()).toHaveAccessibleName(/^Log attempt\b/);
    for (const name of ["Finish build", "Shelve build", "New idea", "Sign out"]) {
      await expect(palette.getByRole("option", { name })).toBeVisible();
    }
    await expect(palette.getByRole("group", { name: "This build" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
    // Open again with the sidebar's box.
    await page.getByRole("button", { name: /Jump to/ }).click();
    await expect(palette).toBeVisible();
    await page.keyboard.press(open);
    await expect(palette).toBeHidden();
  });

  test("jumps to a build by name", async ({ page }) => {
    const id = await create(page, { title: "Tugboat deck", stage: "building" });
    await create(page, { title: "Tugboat idea", note: "A smaller one" });
    await create(page, { title: "Cable chain", stage: "building" });

    await page.keyboard.press(open);
    await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("tugb");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette.getByRole("option", { name: "Tugboat deck" })).toBeVisible();
    await expect(palette.getByRole("option", { name: "Tugboat idea" })).toBeVisible();
    await expect(palette.getByRole("option", { name: "Cable chain" })).toHaveCount(0);

    // Builds come before ideas, and Enter opens the first.
    await expect(palette.getByRole("option").first()).toHaveAccessibleName(/^Tugboat deck\b/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Tugboat deck");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();

    // It is the most recent thing opened.
    await page.goto("/ideas");
    await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
    await page.keyboard.press(open);
    await expect(
      page.getByRole("group", { name: "Recent" }).getByRole("option", { name: "Tugboat deck" }),
    ).toBeVisible();
  });

  test("a deleted idea leaves Recent", async ({ page }) => {
    const id = await create(page, { title: "Doomed hook" });
    await page.goto(`/ideas/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Doomed hook");
    await page.getByRole("button", { name: "Delete idea" }).click();
    await expect(page).toHaveURL(/\/ideas$/);
    await expect(page.getByText("Idea deleted")).toBeVisible();
    await page.keyboard.press(open);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Doomed hook" })).toHaveCount(0);
  });

  test("runs 'log attempt' from a build, and goes to a section", async ({ page }) => {
    const id = await create(page, { title: "Cable chain", stage: "building" });
    await page.goto(`/builds/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");

    await page.keyboard.press(open);
    await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("log att");
    await expect(page.getByRole("option").first()).toHaveAccessibleName(/^Log attempt\b/);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Attempt 1" })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // A section, by its shortcut's long form.
    await page.keyboard.press(open);
    await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("journal");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/journal$/);
  });

  test("starts a build from the idea on screen, and switches the theme", async ({ page }) => {
    const id = await create(page, { title: "Desk hook" });
    await page.goto(`/ideas/${id}`);
    await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Desk hook");

    await page.keyboard.press(open);
    await expect(page.getByRole("option").first()).toHaveAccessibleName(/^Start building\b/);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));

    await page.keyboard.press(open);
    await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("theme");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).toHaveAttribute("data-theme", /^(dark|light)$/);
    const first = await page.locator("html").getAttribute("data-theme");
    await page.keyboard.press(open);
    await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("theme");
    await page.keyboard.press("Enter");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", first ?? "");
  });

  test("? lists every shortcut, grouped by screen", async ({ page }) => {
    await page.keyboard.press("?");
    const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(overlay).toBeVisible();
    for (const group of [
      "Anywhere",
      "On an idea",
      "On a build",
      "In the journal",
      "In search",
      "In the command palette",
    ]) {
      await expect(overlay.getByRole("heading", { name: group })).toBeVisible();
    }
    await expect(overlay.getByText("Log or finish an attempt")).toBeVisible();
    await expect(overlay.getByText("Open the command palette")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();
  });

  test("shortcuts don't fire while typing in a field", async ({ page }) => {
    const id = await create(page, { title: "", stage: "building", note: "" });
    await page.goto(`/builds/${id}`);
    const title = page.getByRole("textbox", { name: "Title" });
    await title.click();
    // Every letter the app listens for, and the slash and question mark.
    await page.keyboard.type("cabgij/? ajk");
    await expect(title).toHaveValue("cabgij/? ajk");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));

    // Escape and Backspace belong to the field too: the build stays.
    await page.keyboard.press("Backspace");
    await expect(title).toHaveValue("cabgij/? aj");
    await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));

    // The note field, and the search box.
    const note = page.getByRole("textbox", { name: "Notes" });
    if (await note.count()) {
      await note.first().click();
      await page.keyboard.type("c?");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await page.goto("/search");
    const box = page.getByRole("searchbox", { name: "Search" });
    await box.click();
    await page.keyboard.type("g i? c");
    await expect(box).toHaveValue("g i? c");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).toHaveURL(/\/search/);

    // ⌘K still works from inside a field.
    await page.keyboard.press(open);
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  });

  test("the keys outside fields still work", async ({ page }) => {
    await page.keyboard.press("g");
    await page.keyboard.press("b");
    await expect(page).toHaveURL(/\/builds$/);
    await page.keyboard.press("g");
    await page.keyboard.press("j");
    await expect(page).toHaveURL(/\/journal$/);
    await page.keyboard.press("c");
    await expect(page.getByRole("dialog", { name: "New idea" })).toBeVisible();
  });
});

test("phones have no palette", async ({ page, isMobile }) => {
  test.skip(!isMobile, "laptop only");
  await page.keyboard.press(open);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Jump to/ })).toBeHidden();
});
