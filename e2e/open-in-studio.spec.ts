import { expect, test } from "@playwright/test";
import { TUGBOAT_FILE_NAME, tugboatFile } from "./fixtures/gcode-tugboat";
import { clearIdeas, signIn } from "./helpers";

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const origin = (page: { url(): string }) => new URL(page.url()).origin;

test("Open in Bambu Studio builds the bambustudio:// address of a signed link that downloads with no cookie, then expires", async ({
  page,
  browser,
}) => {
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Tugboat", note: "x" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: TUGBOAT_FILE_NAME,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(tugboatFile()),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText(TUGBOAT_FILE_NAME)).toBeVisible();
  await expect(files.getByRole("link", { name: `Download ${TUGBOAT_FILE_NAME}` })).toBeVisible();

  // The browser would hand the address to the app: catch the click on it instead.
  await page.evaluate(() => {
    document.addEventListener(
      "click",
      (event) => {
        const link = (event.target as Element).closest?.("a[href^='bambustudio']");
        if (!link) return;
        event.preventDefault();
        (window as unknown as { opened: string[] }).opened.push(link.getAttribute("href") ?? "");
      },
      true,
    );
    (window as unknown as { opened: string[] }).opened = [];
  });
  // On the card, and (one file) as the page's own action.
  await expect(page.getByTestId("open-in-studio")).toHaveCount(2);
  await page.getByTestId("open-in-studio").first().click();
  await expect(page.getByText("Nothing opened?").first()).toBeVisible();
  const [href] = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(href).toMatch(/^bambustudio:\/\/open\?file=https?%3A%2F%2F/);
  const signed = decodeURIComponent((href as string).split("file=")[1] as string);
  expect(new URL(signed).pathname).toMatch(
    new RegExp(`^/open/[^/]+/${TUGBOAT_FILE_NAME.replace(/[^A-Za-z0-9._-]+/g, "-")}$`),
  );

  // Bambu Studio has no cookies: a fresh context fetches the file's bytes.
  const stranger = await browser.newContext();
  const download = await stranger.request.get(signed);
  expect(download.status()).toBe(200);
  expect(Buffer.from(await download.body()).equals(Buffer.from(tugboatFile()))).toBe(true);
  // A link with the signature changed, or the same path under another file's name, still only gives the one file.
  const bad = signed.replace(/\.[A-Za-z0-9_-]{43}\//, ".AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/");
  expect((await stranger.request.get(bad)).status()).toBe(404);

  // A link whose expiry was moved is refused (that the real clock ends links is in test/worker/model-files.test.ts).
  const token = new URL(signed).pathname.split("/")[2] as string;
  const [fileId, part, , signature] = token.split(".") as [string, string, string, string];
  const expired = `${fileId}.${part}.${Date.now() - 1000}.${signature}`;
  expect((await stranger.request.get(`${new URL(signed).origin}/open/${expired}/x.3mf`)).status()).toBe(404);
  await stranger.close();
});
