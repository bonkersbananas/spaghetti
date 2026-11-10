import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other specs expect an empty workshop.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("links in a note become cards under it: distinct, in order, three at most, opening in a new tab", async ({
  page,
}) => {
  const id = crypto.randomUUID();
  const note = [
    "Drawer bins: https://www.printables.com/model/42-drawer-bins",
    "and the same again https://www.printables.com/model/42-drawer-bins,",
    "plus https://makerworld.com/en/models/hook, https://example.org/a/b and https://example.net/fourth.",
  ].join("\n");
  await page.request.post("/api/items", { headers: { Origin: origin(page) }, data: { id, title: "Bins", note } });
  await page.goto(`/ideas/${id}`);
  const cards = page.getByRole("list", { name: "Links in the note" }).getByRole("link");
  // Three of the four distinct addresses, in the order they appear. Without a connection to the page (the
  // test's app can't fetch one) the card keeps showing the address.
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toHaveAttribute("href", "https://www.printables.com/model/42-drawer-bins");
  await expect(cards.nth(1)).toHaveAttribute("href", "https://makerworld.com/en/models/hook");
  await expect(cards.nth(2)).toHaveAttribute("href", "https://example.org/a/b");
  await expect(cards.nth(0)).toHaveAttribute("target", "_blank");
  await expect(cards.nth(0)).toHaveAttribute("rel", "noreferrer noopener");
  await expect(cards.nth(0)).toContainText("printables.com/model/42-drawer-bins");
  await expect(cards.nth(0)).toContainText("printables.com");
  // The links inside the note are still links (it has the first address twice).
  await expect(page.getByRole("link", { name: /^printables\.com\/model\/42-drawer-bins$/ })).toHaveCount(2);
});

test("a note without a link has no cards, and the build page shows them too", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const plain = crypto.randomUUID();
  const build = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: plain, title: "Plain", note: "No links here" } });
  await page.request.post("/api/items", {
    headers,
    data: {
      id: build,
      title: "Linked build",
      note: "Model: https://www.printables.com/model/7-tray",
      stage: "building",
    },
  });
  await page.goto(`/ideas/${plain}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Plain");
  await expect(page.getByRole("list", { name: "Links in the note" })).toHaveCount(0);
  await page.goto(`/builds/${build}`);
  await expect(
    page.getByRole("list", { name: "Links in the note" }).getByRole("link", { name: /printables\.com/ }),
  ).toBeVisible();
});

test("the idea page gives the photo two parts and the text three, as the build page does", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop layout");
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Tugboat", note: "A boat" } });
  const buffer = readFileSync("e2e/fixtures/tugboat.jpg");
  const uploaded = await page.request.put(`/api/items/${id}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      width: "1600",
      height: "1200",
      color: "#6b5a4a",
      position: "0",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer },
    },
  });
  expect(uploaded.ok()).toBe(true);
  const widthOf = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())?.width ?? 0;

  await page.goto(`/ideas/${id}`);
  const photo = page.getByRole("region", { name: "Photos" });
  await expect(photo).toBeVisible();
  const ideaPhoto = await widthOf(photo);
  const text = await widthOf(page.getByRole("textbox", { name: "Title" }));
  // Photo : text is about 2 : 3 (the text keeps a readable measure, so it can be narrower than its column).
  expect(ideaPhoto).toBeGreaterThan(300);
  expect(text).toBeGreaterThan(0);
  expect(ideaPhoto / (ideaPhoto + text)).toBeLessThan(0.5);

  // Growing into a build keeps the photo where it was, at the size it was.
  await page.getByRole("button", { name: "Start building" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}$`));
  const buildPhoto = page.getByRole("region", { name: "Photos" });
  await expect(buildPhoto).toBeVisible();
  await page.waitForTimeout(400);
  expect(Math.abs((await widthOf(buildPhoto)) - ideaPhoto)).toBeLessThan(2);
});

test("typing an address asks for one preview, once the note has settled, not one per keystroke", async ({ page }) => {
  const headers = { Origin: origin(page) };
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Typing", note: "" } });
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/links/preview")) asked.push(request.url());
  });
  await page.goto(`/ideas/${id}`);
  const note = page.getByRole("textbox", { name: "Note" });
  await note.click();
  await note.pressSequentially("Model: https://www.printables.com/model/42-drawer-bins", { delay: 40 });
  // Still typing (a moment ago): no card yet, nothing asked.
  expect(asked).toEqual([]);
  const cards = page.getByRole("list", { name: "Links in the note" }).getByRole("link");
  await expect(cards).toHaveCount(1, { timeout: 5000 });
  await expect(cards).toHaveAttribute("href", "https://www.printables.com/model/42-drawer-bins");
  await expect.poll(() => asked.length).toBe(1);
  expect(decodeURIComponent(asked[0] ?? "")).toContain("https://www.printables.com/model/42-drawer-bins");
});
