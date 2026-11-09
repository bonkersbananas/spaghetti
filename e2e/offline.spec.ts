import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

// These run against the production build (the dev server has no service worker).

async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const serverIdeas = async (page: Page) => (await (await page.request.get("/api/items")).json()).items;

test.afterEach(async ({ page, context }) => {
  await context.setOffline(false);
  await clearIdeas(page);
});

test("opens with no connection after a first visit, and a capture made offline lands when it's back", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);

  await context.setOffline(true);
  await page.reload();
  // The app opens, still signed in, and says once that it is offline.
  await expect(page.getByRole("heading", { level: 1, name: "Ideas" })).toBeVisible();
  const notice = page.getByRole("status").filter({ hasText: "Offline" });
  await expect(notice).toBeVisible();
  await expect(page.getByRole("heading", { name: "The pot is out of reach" })).toBeVisible();

  // Capture, in an app that was opened offline.
  await page.getByRole("button", { name: "New idea" }).click();
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await sheet.getByRole("textbox", { name: "Note" }).fill("Spool holder, drawn at the printer");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
  await expect(notice).toContainText("1 capture is waiting");
  expect(await serverIdeas(page)).toHaveLength(0);

  // Connection back: it goes up by itself.
  await context.setOffline(false);
  await expect.poll(async () => (await serverIdeas(page)).length).toBe(1);
  await expect(notice).toBeHidden();
  await page.reload();
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Spool holder");
});

test("never serves the API from a cache, but keeps photos already seen", async ({ page, context }) => {
  await signIn(page);
  await waitForServiceWorker(page);

  await page.getByRole("button", { name: "New idea" }).click();
  const sheet = page.getByRole("dialog", { name: "New idea" });
  await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  await sheet.getByRole("textbox", { name: "Note" }).fill("Bath tugboat");
  await sheet.getByRole("button", { name: "Save idea" }).click();
  await expect.poll(async () => (await serverIdeas(page))[0]?.photos.length ?? 0).toBe(1);
  const [{ id: photoId }] = (await serverIdeas(page))[0].photos;

  // Seen once, as a person looks at it.
  await page.reload();
  await expect(page.getByRole("img", { name: "Photo: Bath tugboat" })).toBeVisible();
  await page.evaluate((id) => fetch(`/api/photos/${id}/thumb`).then((r) => r.blob()), photoId);

  await context.setOffline(true);
  const [photo, items] = await page.evaluate(async (id) => {
    const status = async (url: string) => {
      try {
        return (await fetch(url)).ok;
      } catch {
        return "unreachable";
      }
    };
    return [await status(`/api/photos/${id}/thumb`), await status("/api/items")];
  }, photoId);
  expect(photo).toBe(true);
  expect(items).toBe("unreachable");
});

test("is installable: manifests for both themes, maskable icons, and a worker that precaches the shell", async ({
  page,
}) => {
  await page.goto("/sign-in");
  for (const [file, color] of [
    ["manifest.webmanifest", "#f6f1e8"],
    ["manifest-dark.webmanifest", "#1b1714"],
  ] as const) {
    const manifest = await (await page.request.get(`/${file}`)).json();
    expect(manifest).toMatchObject({ display: "standalone", start_url: "/ideas", theme_color: color });
    expect(manifest.background_color).toBe(color);
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain("maskable");
    for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status()).toBe(200);
  }
  const worker = await (await page.request.get("/sw.js")).text();
  expect(worker).toContain("__BUILD__");
  expect(worker).toContain("/manifest.webmanifest");
  expect(worker).toMatch(/\/assets\/index-[\w-]+\.js/);
  expect(worker).toMatch(/\.woff2/);
});
