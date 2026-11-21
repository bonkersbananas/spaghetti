import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import sharp from "sharp";
import { SEED_USERS } from "../scripts/lib/local-app.ts";
import { clearIdeas, signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

/** A camera-sized photo (an iPhone's 48 MP is 8064 x 6048): flat colours, so it makes quickly and stays small. */
async function cameraPhoto(): Promise<string> {
  const path = join(mkdtempSync(join(tmpdir(), "camera-")), "IMG_0001.jpg");
  await sharp({ create: { width: 8064, height: 6048, channels: 3, background: "#c96f3b" } })
    .jpeg({ quality: 60 })
    .toFile(path);
  return path;
}

async function aBuild(page: Page): Promise<string> {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Cable chain", note: "For the back of the X2D" },
  });
  await page.request.patch(`/api/items/${id}`, { headers: { Origin: origin(page) }, data: { stage: "building" } });
  return id;
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, "The camera is for a touch phone");
  await signIn(page, SEED_USERS[0]);
  await clearIdeas(page);
});
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

test("a touch phone held sideways (wider than the desktop layout) still offers the camera @phone", async ({ page }) => {
  const id = await aBuild(page);
  await page.setViewportSize({ width: 932, height: 430 });
  await page.goto(`/builds/${id}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Take photo" })).toBeVisible();
});

test("a camera-sized photo reaches the attempt, and a page that loads again keeps the draft @phone", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const id = await aBuild(page);
  const photo = await cameraPhoto();
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();

  await sheet.getByRole("radio", { name: "Spaghetti" }).click();
  await sheet.getByRole("textbox", { name: "Note" }).fill("Let go at 40%");

  // The camera opens from the tap, and the 48 MP photo comes back as a thumbnail that finishes resizing.
  const chooser = page.waitForEvent("filechooser");
  await sheet.getByRole("button", { name: "Take photo" }).click();
  await (await chooser).setFiles(photo);
  await expect(sheet.getByRole("img", { name: "Attempt photo 1" })).toBeVisible();
  await expect(sheet.getByRole("progressbar")).toHaveCount(0, { timeout: 30_000 });

  // The camera opens once more and the page's process is ended while it is up (iOS does that to a Home Screen app).
  const second = page.waitForEvent("filechooser");
  await sheet.getByRole("button", { name: "Take photo" }).click();
  await second;
  // iOS ended the page's process while the camera was up: loaded again, the sheet is back with everything in it.
  await page.reload();
  const again = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(again).toBeVisible();
  await expect(again.getByRole("textbox", { name: "Note" })).toHaveValue("Let go at 40%");
  await expect(again.getByRole("radio", { name: "Spaghetti" })).toBeChecked();
  // Playwright's WebKit can't store a File in IndexedDB (the put fails, even for 1 kB): a real iPhone can.
  if (test.info().project.name !== "phone-webkit")
    await expect(again.getByRole("img", { name: "Attempt photo 1" })).toBeVisible();

  await again.getByRole("button", { name: "Log attempt" }).click();
  await expect(again).toBeHidden();
  if (test.info().project.name !== "phone-webkit")
    await expect
      .poll(async () => {
        const { item } = await (await page.request.get(`/api/items/${id}`)).json();
        return item.photos.length;
      })
      .toBe(1);
  // Logged: nothing is kept for the next attempt.
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a photo the browser can't open says so, and can be tried again @phone", async ({ page }) => {
  const id = await aBuild(page);
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();
  await sheet.getByTestId("camera-input").setInputFiles({
    name: "IMG_0002.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("not a picture"),
  });
  await expect(page.getByText("Couldn't open that photo")).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(sheet.getByRole("img", { name: "Attempt photo 1" })).toHaveCount(0);
});

const draftKey = (id: string) => `spaghetti:attempt-draft:${id}`;
const cameraKey = (id: string) => `spaghetti:attempt-camera:${id}`;

function keepDraft(page: Page, id: string, kept: { attempts: number; ageMs: number }) {
  return page.evaluate(
    ([id, kept, draftKey, cameraKey]) => {
      const draft = {
        outcome: "failed",
        printedAt: Date.now(),
        note: "From an old draft",
        failureTags: [],
        successNotes: [],
        settings: {},
        parts: [],
      };
      localStorage.setItem(
        draftKey,
        JSON.stringify({ draft, when: null, savedAt: Date.now() - kept.ageMs, attempts: kept.attempts }),
      );
      localStorage.setItem(cameraKey, String(Date.now()));
    },
    [id, kept, draftKey(id), cameraKey(id)] as const,
  );
}

test("opening and closing the sheet keeps no draft @phone", async ({ page }) => {
  const id = await aBuild(page);
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(sheet).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  expect(await page.evaluate((key) => localStorage.getItem(key), draftKey(id))).toBeNull();
});

test("a draft older than the attempts logged since, or than a few hours, is not brought back @phone", async ({
  page,
}) => {
  const id = await aBuild(page);
  await page.goto(`/builds/${id}`);
  // The build has one attempt now (logged from the other phone, say): a draft kept for attempt 1 is stale.
  await page.request.post(`/api/items/${id}/attempts`, {
    headers: { Origin: origin(page) },
    data: { id: crypto.randomUUID(), outcome: "success", printedAt: Date.now(), note: "", createdAt: Date.now() },
  });
  await keepDraft(page, id, { attempts: 0, ageMs: 1000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Log another try" }).click();
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await expect(sheet.getByRole("textbox", { name: "Note" })).toHaveValue("");

  // And one that is right in every way but old.
  await page.keyboard.press("Escape");
  await keepDraft(page, id, { attempts: 1, ageMs: 7 * 60 * 60 * 1000 });
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Cable chain");
  await page.getByRole("button", { name: "Log another try" }).click();
  await expect(page.getByRole("dialog", { name: "Attempt 2" }).getByRole("textbox", { name: "Note" })).toHaveValue("");
});

test("a photo that can't be opened and has no type can be tried again @phone", async ({ page }) => {
  const id = await aBuild(page);
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await sheet
    .getByTestId("camera-input")
    .setInputFiles({ name: "IMG_0003.HEIC", mimeType: "", buffer: Buffer.from("x") });
  await expect(page.getByText("Couldn't open that photo")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  // It was tried (and failed, again, in plain view), not silently ignored.
  await expect(page.getByText("Couldn't open that photo")).toHaveCount(2);
});
