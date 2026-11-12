import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;
const MINUTE = 60_000;

/** A build with one attempt on the bed, started `ago` ms ago, through the API. */
async function printing(page: Page, title: string, ago: number, estimatedMinutes: number) {
  const id = crypto.randomUUID();
  const headers = { Origin: origin(page) };
  await page.request.post("/api/items", { headers, data: { id, title, stage: "building" } });
  const response = await page.request.post(`/api/items/${id}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
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
  await expect(bed.getByRole("heading", { name: "Bath tugboat" })).toBeVisible();
  await expect(bed.getByRole("button", { name: "Snap this print" })).toBeVisible();
  // The notebook itself is still on the same screen, under it.
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();

  await bed.getByRole("button", { name: "Finish" }).click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
});

test("phones: with nothing printing the journal has no Now block", { tag: "@phone" }, async ({ page, isMobile }) => {
  test.skip(!isMobile, "The Now block is the phone's.");
  await page.goto("/journal");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await expect(page.getByRole("region", { name: "On the bed" })).toHaveCount(0);
  // And it leaves no gap behind: the journal starts where the header ends.
  const now = page.locator("main header + div");
  await expect(now).toHaveCount(1);
  await expect(now).toHaveCSS("margin-bottom", "0px");
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
