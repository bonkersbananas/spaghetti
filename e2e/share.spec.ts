import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers";

// These run against the production build: the share target's POST is answered by the service worker.

async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** What the OS does for a Web Share Target: a multipart POST navigation to the manifest's action. */
async function shareInto(
  page: Page,
  fields: { title?: string; text?: string; url?: string },
  photo?: { name: string; type: string; base64: string },
) {
  await page.evaluate(
    ({ fields, photo }) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.action = "/api/share";
      form.enctype = "multipart/form-data";
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.name = name;
        input.value = value;
        form.append(input);
      }
      if (photo) {
        const input = document.createElement("input");
        input.type = "file";
        input.name = "media";
        const bytes = Uint8Array.from(atob(photo.base64), (c) => c.charCodeAt(0));
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], photo.name, { type: photo.type }));
        input.files = transfer.files;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    },
    { fields, photo },
  );
}

const serverIdeas = async (page: Page) => (await (await page.request.get("/api/items")).json()).items;

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("the share target saves a shared link and photo as an idea, and the Captured sheet adds a word", async ({
  page,
}) => {
  await signIn(page);
  await waitForServiceWorker(page);
  await clearIdeas(page);

  await shareInto(
    page,
    { title: "Cable clip remix", text: "Check this out", url: "https://makerworld.com/en/models/1" },
    { name: "clip.jpg", type: "image/jpeg", base64: readFileSync("e2e/fixtures/tugboat.jpg").toString("base64") },
  );

  const sheet = page.getByRole("dialog", { name: "Captured" });
  await expect(sheet).toBeVisible();
  await expect(page).toHaveURL(/\/ideas$/);
  // Prefilled: the words and the link are in the note, the photo is shown.
  const note = sheet.getByRole("textbox", { name: "Add a word" });
  await expect(note).toHaveValue("Check this out\nhttps://makerworld.com/en/models/1");
  await expect(sheet.getByRole("img", { name: "Shared photo 1" })).toBeVisible();

  // Saved already, before anything is typed.
  await expect.poll(async () => (await serverIdeas(page)).length).toBe(1);
  const [idea] = await serverIdeas(page);
  expect(idea.title).toBe("Cable clip remix");
  await expect.poll(async () => (await serverIdeas(page))[0].photos.length).toBe(1);

  await page.waitForTimeout(500);
  expect((await new AxeBuilder({ page }).include("[role=dialog]").analyze()).violations.map((v) => v.id)).toEqual([]);
  await note.fill("Check this out\nhttps://makerworld.com/en/models/1\nfor Mila's desk");
  await expect.poll(async () => (await serverIdeas(page))[0].note).toContain("for Mila's desk");
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("list", { name: "Ideas" }).getByRole("link").first()).toContainText("Cable clip remix");
});

test("a share made with no connection waits in the outbox and lands when it's back", async ({ page, context }) => {
  await signIn(page);
  await waitForServiceWorker(page);
  await clearIdeas(page);

  await context.setOffline(true);
  await shareInto(page, { text: "Hook for the garage", url: "https://example.com/hook" });
  const sheet = page.getByRole("dialog", { name: "Captured" });
  await expect(sheet).toBeVisible();
  expect(await serverIdeas(page).catch(() => [])).toHaveLength(0);

  await context.setOffline(false);
  await expect.poll(async () => (await serverIdeas(page)).length).toBe(1);
});

test("a link to /share with the page's title and URL (the bookmarklet) captures it", async ({ page }) => {
  await signIn(page);
  await clearIdeas(page);
  const url = "https://example.com/model";
  await page.goto(`/share?title=${encodeURIComponent("A nice model")}&url=${encodeURIComponent(url)}`);
  const sheet = page.getByRole("dialog", { name: "Captured" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("textbox", { name: "Add a word" })).toHaveValue(url);
  await expect.poll(async () => (await serverIdeas(page))[0]?.title).toBe("A nice model");
});

test("without the service worker, a POST to the share route still brings the words", async ({ request, baseURL }) => {
  const response = await request.post("/api/share", {
    multipart: { title: "Hi", text: "words", url: "https://example.com/x" },
    maxRedirects: 0,
    headers: { Origin: "null" },
  });
  expect(response.status()).toBe(303);
  const location = new URL(response.headers().location ?? "", baseURL);
  expect(location.pathname).toBe("/share");
  expect(location.searchParams.get("url")).toBe("https://example.com/x");
});
