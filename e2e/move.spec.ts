import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { clearIdeas, signIn } from "./helpers.ts";

const picture = readFileSync(new URL("./fixtures/tugboat.jpg", import.meta.url));
const origin = (page: Page) => new URL(page.url()).origin;
const headers = (page: Page) => ({ Origin: origin(page) });

test.beforeEach(async ({ page }) => {
  await signIn(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

async function seed(page: Page) {
  const buildId = crypto.randomUUID();
  const ideaId = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id: buildId, title: "Towel hook", note: "In PETG", stage: "building" },
  });
  const attemptIds: string[] = [];
  for (const outcome of ["failed", "partial"]) {
    const id = crypto.randomUUID();
    attemptIds.push(id);
    const response = await page.request.post(`/api/items/${buildId}/attempts`, {
      headers: headers(page),
      data: { id, outcome, note: `Try ${attemptIds.length}` },
    });
    expect(response.ok()).toBe(true);
  }
  await page.request.post("/api/items", {
    headers: headers(page),
    data: { id: ideaId, note: "Corner lifted off the bed", createdAt: Date.now() - 3_600_000 },
  });
  const photoId = crypto.randomUUID();
  const upload = await page.request.put(`/api/items/${ideaId}/photos/${photoId}`, {
    headers: headers(page),
    multipart: {
      width: "1200",
      height: "1600",
      color: "#6b5a4a",
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer: picture },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: picture },
    },
  });
  expect(upload.ok()).toBe(true);
  return { buildId, ideaId, photoId, attemptIds };
}

const getItem = async (page: Page, id: string) => (await (await page.request.get(`/api/items/${id}`)).json()).item;

test("a capture moves into the newest attempt of a build, and Undo puts it all back", { tag: "@phone" }, async ({
  page,
}) => {
  const { buildId, ideaId, photoId, attemptIds } = await seed(page);
  await page.goto(`/ideas/${ideaId}`);
  await page.getByRole("button", { name: /^Add to a build/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: /Towel hook/ }).click();
  await expect(sheet.getByText("Which print is it about?")).toBeVisible();
  await sheet.getByRole("button", { name: /Attempt 2/ }).click();

  await expect(page.getByText("Moved to attempt 2")).toBeVisible();
  await expect(page).toHaveURL(/\/ideas$/);
  await expect
    .poll(async () => {
      const build = await getItem(page, buildId);
      return build.photos.find((photo: { id: string }) => photo.id === photoId)?.attemptId;
    })
    .toBe(attemptIds[1]);
  const moved = await getItem(page, buildId);
  expect(moved.attempts[1].note).toBe("Try 2\n\nCorner lifted off the bed");
  expect((await page.request.get(`/api/items/${ideaId}`)).status()).toBe(404);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(async () => (await getItem(page, ideaId))?.photos.map((photo: { id: string }) => photo.id))
    .toEqual([photoId]);
  const back = await getItem(page, buildId);
  expect(back.photos).toEqual([]);
  expect(back.attempts[1].note).toBe("Try 2");
  expect((await getItem(page, ideaId)).note).toBe("Corner lifted off the bed");
});

test("from the idea's menu on the list, and View opens the build", { tag: "@phone" }, async ({ page, isMobile }) => {
  const { buildId, ideaId } = await seed(page);
  await page.goto("/ideas");
  await page
    .getByRole("button", { name: /^Options for/ })
    .first()
    .click();
  await page.getByRole("button", { name: "Add to a build…" }).click();
  const sheet = page.getByRole("dialog");
  if (!isMobile) {
    await sheet.getByRole("textbox", { name: "Search builds" }).fill("towel");
  }
  await sheet.getByRole("button", { name: /Towel hook/ }).click();
  await sheet.getByRole("button", { name: "The build itself" }).click();
  await expect(page.getByText("Moved to Towel hook")).toBeVisible();
  await page.getByRole("button", { name: "View" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${buildId}$`));
  expect((await getItem(page, buildId)).note).toBe("In PETG\n\nCorner lifted off the bed");
  expect((await page.request.get(`/api/items/${ideaId}`)).status()).toBe(404);
});

test("the A key opens the picker on desktop; an idea with a comment stays", async ({ page, isMobile }) => {
  test.skip(isMobile, "a keyboard shortcut");
  const { ideaId } = await seed(page);
  await page.request.post(`/api/items/${ideaId}/comments`, {
    headers: headers(page),
    data: { id: crypto.randomUUID(), body: "Looks warped" },
  });
  await page.goto(`/ideas/${ideaId}`);
  await expect(page.getByText("Looks warped")).toBeVisible();
  await page.keyboard.press("a");
  await expect(page.getByText("It stays where it is")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
