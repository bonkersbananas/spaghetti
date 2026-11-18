import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

/** Principle 7 and decision 0005: a field being edited when the connection drops stays editable and is saved when it returns. */
const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
});
test.afterEach(async ({ page, context }) => {
  await context.setOffline(false);
  await clearIdeas(page);
});

async function makeIdea(page: Page, note: string) {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Cable chain", note },
  });
  expect(response.ok()).toBe(true);
  return id;
}

const serverNote = async (page: Page, id: string) =>
  ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: { note: string } }).item.note;

test("words typed after the connection drops are kept, shown as waiting, and saved when it is back @phone", async ({
  page,
  context,
}) => {
  const id = await makeIdea(page, "First words.");
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "Edit note" }).click();
  const note = page.getByRole("textbox", { name: "Note" });
  await expect(note).toBeFocused();
  await note.pressSequentially(" Typed online.");
  await expect.poll(() => serverNote(page, id)).toBe("First words. Typed online.");

  await context.setOffline(true);
  // Still the same field, still focused, and still taking words.
  await note.pressSequentially(" Typed offline.");
  await expect(note).toBeFocused();
  await expect(note).toHaveValue("First words. Typed online. Typed offline.");
  await expect(page.getByText("Saves when online")).toBeVisible();
  // Kept on the device meanwhile, so a page that dies loses nothing.
  expect(await page.evaluate((key) => localStorage.getItem(key), `spaghetti:unsent:item:${id}`)).toContain(
    "Typed offline.",
  );
  // (page.request isn't offline, so this reads the server as it is.)
  expect(await serverNote(page, id)).toBe("First words. Typed online.");

  await context.setOffline(false);
  await expect.poll(() => serverNote(page, id)).toBe("First words. Typed online. Typed offline.");
  await expect(page.getByText("Saves when online")).toBeHidden();
});

test("the title is kept the same way, and a reload with the save blocked loses nothing @phone", async ({
  page,
  context,
}) => {
  const id = await makeIdea(page, "A note.");
  await page.goto(`/ideas/${id}`);
  const title = page.getByRole("textbox", { name: "Title" });
  await title.click();
  await page.keyboard.press("End");
  await context.setOffline(true);
  await title.pressSequentially(" for the desk");
  await expect(title).toBeFocused();
  await expect(title).toHaveValue("Cable chain for the desk");
  await context.setOffline(false);
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/items/${id}`)).json()) as { item: { title: string } }).item.title,
    )
    .toBe("Cable chain for the desk");

  // The connection is back but the save never lands: a reload brings the words back from the device.
  await page.route("**/api/items/*", (route) =>
    route.request().method() === "PATCH" ? route.abort() : route.fallback(),
  );
  await title.click();
  await page.keyboard.press("End");
  await title.pressSequentially("!");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain for the desk!");
});

test("letters typed in a field while offline never open a sheet or move the page", async ({ page, context }) => {
  const id = await makeIdea(page, "Plain.");
  await page.goto(`/ideas/${id}`);
  await page.getByRole("button", { name: "Edit note" }).click();
  const note = page.getByRole("textbox", { name: "Note" });
  await context.setOffline(true);
  // Every letter that is a shortcut somewhere, and the two-key openers.
  await page.keyboard.type(" c n f l s e r g i j k b a t / ? x");
  await expect(note).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/ideas/${id}$`));
  await expect(note).toHaveValue("Plain. c n f l s e r g i j k b a t / ? x");
});

test("a saved field that was not being edited stays read-only offline", async ({ page, context }) => {
  const id = await makeIdea(page, "Plain.");
  await page.goto(`/ideas/${id}`);
  await expect(page.getByRole("button", { name: "Edit note" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await context.setOffline(true);
  await expect(page.getByRole("button", { name: "Edit note" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveAttribute("readonly", "");
});
