import { expect, type Page, test } from "@playwright/test";
import { SEED_PASSWORD, SEED_USERS } from "../scripts/lib/local-app.ts";

const [alex, sam] = SEED_USERS;
const portrait = "e2e/fixtures/portrait.jpg";

async function signInAs(page: Page, user: { username: string }) {
  await page.goto("/sign-in");
  await page.getByLabel("Name").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
}

/** The app's origin (a page may not have loaded anything yet). */
const origin = (_page?: Page) => new URL(test.info().project.use.baseURL ?? "").origin;

async function openAccount(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: "Account" }).click();
    return page.getByRole("dialog", { name: "The kitchen" });
  }
  await page.getByRole("button", { name: "Account menu" }).click();
  return page.getByRole("dialog", { name: "Account" });
}

test.afterEach(async ({ browser }) => {
  // Leave nothing behind: the other specs expect an empty workshop and initials.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.request.post("/api/session", {
    headers: { Origin: origin(page) },
    data: { username: alex.username, password: SEED_PASSWORD },
  });
  await page.request.delete("/api/people/me/photo", { headers: { Origin: origin(page) } });
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
  await context.close();
});

test("sets a picture from the account menu, the other person sees it, and it can be removed with Undo", async ({
  page,
  browser,
  isMobile,
}) => {
  test.setTimeout(90_000);
  const samContext = await browser.newContext({ viewport: page.viewportSize(), baseURL: origin() });
  const samPage = await samContext.newPage();
  await signInAs(page, alex);
  await signInAs(samPage, sam);

  // Alex has an idea, shown with their initials on Sam's screen.
  const created = await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id: crypto.randomUUID(), title: "Spool holder", note: "" },
  });
  expect(created.ok()).toBe(true);
  await samPage.goto("/ideas");
  const alexFace = samPage.getByRole("link", { name: /Spool holder/ }).getByRole("img", { name: /^Alex/ });
  await expect(alexFace).toBeVisible();
  await expect(alexFace.locator("img")).toHaveCount(0);

  // Alex adds a photo: choose, place, save.
  const menu = await openAccount(page, isMobile);
  await expect(menu.getByRole("button", { name: "Add a photo" })).toBeVisible();
  await menu.getByTestId("profile-photo-input").setInputFiles(portrait);
  const crop = page.getByRole("dialog", { name: "Your picture" });
  await expect(crop).toBeVisible();
  await expect(crop.getByTestId("crop-frame").locator("img")).toBeVisible();
  // Zooming and keyboard placing work, and don't throw the picture out of the circle.
  await crop.getByRole("slider", { name: "Zoom" }).fill("2");
  await crop.getByTestId("crop-frame").press("ArrowLeft");
  await crop.getByRole("button", { name: "Save" }).click();
  await expect(crop).toBeHidden();
  await expect(page.getByText("Picture added")).toBeVisible();

  // At once on Alex's own screen, then at the server's own address.
  await expect
    .poll(async () => (await (await page.request.get("/api/session")).json()).user.photoUrl, { timeout: 15_000 })
    .toMatch(/^\/api\/people\/.+\/photo\?v=/);
  const stored = await page.request.get((await (await page.request.get("/api/session")).json()).user.photoUrl);
  expect(stored.headers()["content-type"]).toMatch(/image\/(webp|jpeg)/);
  expect((await stored.body()).length).toBeLessThan(60_000);

  // Sam's screen follows through the feed, without reloading.
  await samPage.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(alexFace.locator("img")).toHaveAttribute("src", /\/api\/people\/.+\/photo\?v=/, { timeout: 25_000 });
  await expect(alexFace.locator("img")).toHaveCSS("opacity", "1");

  // Removing goes back to initials, and Undo brings the picture back.
  const again = await openAccount(page, isMobile);
  await expect(again.getByRole("button", { name: "Change photo" })).toBeVisible();
  await again.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Picture removed")).toBeVisible();
  await expect
    .poll(async () => (await (await page.request.get("/api/session")).json()).user.photoUrl, { timeout: 15_000 })
    .toBeNull();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await (await page.request.get("/api/session")).json()).user.photoUrl, { timeout: 15_000 })
    .not.toBeNull();
  await samContext.close();
});
