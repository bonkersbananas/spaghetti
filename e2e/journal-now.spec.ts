import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;
const MINUTE = 60_000;

/** A build with one attempt on the bed, started `ago` ms ago, through the API. */
async function printing(page: Page, title: string, ago: number, estimatedMinutes: number, attemptId?: string) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
  const response = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: {
      id: attemptId ?? crypto.randomUUID(),
      outcome: null,
      printedAt: Date.now() - ago,
      settings: { filaments: [{ type: "PLA", brand: "Bambu", colorName: "Green" }], estimatedMinutes },
    },
  });
  expect(response.ok()).toBe(true);
  return id;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other specs count on empty sections.
test.afterEach(async ({ page }) => {
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers: { Origin: origin(page) } });
});

test("phones: the journal opens on what is on the bed, and Finish leads to that attempt", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The Now block is the phone's; desktop has Today.");
  const id = await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  await page.goto("/journal");

  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(page.getByRole("heading", { name: "Now" })).toBeVisible();
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  await expect(bed.getByRole("button", { name: "Snap this print" })).toBeVisible();
  // The notebook itself is still on the same screen, under it.
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();

  await bed.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
});

test("phones: a print on the bed shows once, in Now, and joins the notebook once it is logged", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  const attemptId = crypto.randomUUID();
  await printing(page, "Bath tugboat", 2 * MINUTE, 120, attemptId);
  await page.goto("/journal");

  const bed = page.getByRole("region", { name: "On the bed" });
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  // The notebook starts under Now (with the build started), and doesn't show the print a second time.
  const firstEntry = page.locator("ol > li").first();
  await expect(firstEntry).toContainText("Bath tugboat");
  const bedBox = await bed.boundingBox();
  const entryBox = await firstEntry.boundingBox();
  expect(bedBox && entryBox && bedBox.y + bedBox.height <= entryBox.y).toBe(true);
  const attemptInNotebook = page.locator(`ol a[href*="attempt=${attemptId}"]`);
  await expect(attemptInNotebook).toHaveCount(0);

  // Logged from right here: it leaves Now and its entry takes its place in the notebook, with how it went.
  await page.getByRole("button", { name: "New idea" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "This print" }).click();
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Finish print" }).click();
  await expect(sheet).toBeHidden();
  await expect(bed).toHaveCount(0);
  await expect(attemptInNotebook).toHaveCount(1);
  await expect(attemptInNotebook).toContainText("Worked");
});

test("phones: with nothing printing the journal has no Now block", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On the bed" })).toHaveCount(0);
  // And it leaves nothing behind: no "Now" label, no gap.
  await expect(page.getByRole("heading", { name: "Now" })).toHaveCount(0);
});

test("desktop: the journal has no Now block (Today is in the sidebar)", async ({ page, isMobile }) => {
  test.skip(!!isMobile, "Desktop only.");
  await printing(page, "Bath tugboat", 20 * MINUTE, 120);
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On the bed" })).toHaveCount(0);
});

test("phones: Snap this print on the Journal's card opens the sheet aimed at that print", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The camera is the phone's.");
  await printing(page, "Towel hook", 30 * MINUTE, 90);
  await page.goto("/journal");
  const card = page.locator("article").filter({ hasText: "Towel hook" });
  await expect(card).toBeVisible();
  await card.getByTestId("snap-camera-input").setInputFiles("e2e/fixtures/tugboat.jpg");
  const sheet = page.getByRole("dialog", { name: "Add to the print" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Towel hook, attempt 1, is printing.")).toBeVisible();
});
