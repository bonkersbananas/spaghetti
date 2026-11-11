import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;
const jade = { name: "label-jade.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/label-jade.jpg") };
const two = { name: "label-two.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/label-two.jpg") };
const blank = { name: "label-blank.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/label-blank.jpg") };

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other tests expect an empty pantry.
test.afterEach(async ({ page }) => {
  const headers = { Origin: origin(page) };
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers });
});

const spoolsByApi = async (page: Page) => (await (await page.request.get("/api/spools")).json()).spools;

async function addSpool(page: Page, data: Record<string, unknown>) {
  const id = crypto.randomUUID();
  await page.request.post("/api/spools", { headers: { Origin: origin(page) }, data: { id, material: "PLA", ...data } });
  return id;
}

async function expectAccessible(page: Page, what: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations.map((v) => `${what}: ${v.id} ${v.nodes.map((n) => n.target).join(" ")}`)).toEqual([]);
}

/** Opens the spool's page and gives it a label photo to read, the way the button's picker does. */
async function readFrom(page: Page, id: string, file: typeof jade) {
  await page.goto(`/pantry/${id}`);
  await expect(page.getByRole("button", { name: "Read the label" })).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles(file);
}

test("adds a spool from a label photo, the fields fill in, and an edit is the person's own", async ({ page }) => {
  await page.goto("/pantry");
  await page.getByRole("button", { name: "Add a spool" }).click();
  const sheet = page.getByRole("dialog", { name: "New spool" });
  await expect(sheet.getByText(/Claude fills in what the label says/)).toBeVisible();
  // The photo is the label: the spool is saved with it at once and the sheet gets out of the way.
  await sheet.getByTestId("spool-photo-input").setInputFiles(jade);
  await expect(sheet).toBeHidden();

  await expect(page.getByRole("textbox", { name: "Brand" })).toHaveValue("Bambu Lab", { timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Color name" })).toHaveValue("Jade White");
  await expect(page.getByRole("textbox", { name: "Product code" })).toHaveValue("10100");
  await expect(page.getByRole("textbox", { name: "Nozzle, from" })).toHaveValue("190");
  await expect(page.getByRole("textbox", { name: "Nozzle, to" })).toHaveValue("230");
  await expect(page.getByRole("textbox", { name: "Drying hours" })).toHaveValue("8");
  const marks = page.getByText("from the label");
  await expect(marks.first()).toBeVisible();
  const before = await marks.count();

  // Touching a field makes it the person's own: its mark goes, the others stay.
  await page.getByRole("textbox", { name: "Product code" }).fill("10100-B");
  await expect(page.getByText("Saved").first()).toBeVisible();
  await expect.poll(async () => (await spoolsByApi(page))[0]?.productCode).toBe("10100-B");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Product code" })).toHaveValue("10100-B");
  const [spool] = await spoolsByApi(page);
  await expect(marks).toHaveCount(before - 1);
  expect(spool.fromLabel).not.toContain("productCode");
  expect(spool.fromLabel).toContain("colorName");
  expect(spool.photo).not.toBeNull();
});

test("keeps what was typed and fills the rest", async ({ page }) => {
  const id = await addSpool(page, { brand: "Sunlu" });
  await readFrom(page, id, jade);
  await expect(page.getByRole("textbox", { name: "Color name" })).toHaveValue("Jade White", { timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Brand" })).toHaveValue("Sunlu");
});

test("says so quietly when the label can't be read, and tries again", async ({ page }) => {
  const id = await addSpool(page, { note: "unreadable" });
  await readFrom(page, id, blank);
  await expect(page.getByText("The label wasn't readable in that photo")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("textbox", { name: "Brand" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("The label wasn't readable in that photo")).toBeHidden();
});

test("a photo of two labels makes two spools after one tap on a list", async ({ page, isMobile }) => {
  const id = await addSpool(page, { note: "two spools" });
  await readFrom(page, id, two);
  const dialog = page.getByRole("dialog", { name: "2 spools on this label" });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText("Jade White")).toBeVisible();
  await expect(dialog.getByText("Black")).toBeVisible();
  // Nothing is added before the tap.
  expect(await spoolsByApi(page)).toHaveLength(1);
  await dialog.getByRole("button", { name: "Add 2 spools" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await spoolsByApi(page)).length).toBe(2);
  const spools = await spoolsByApi(page);
  expect(spools.map((s: { colorName: string }) => s.colorName).sort()).toEqual(["Black", "Jade White"]);
  expect(spools.every((s: { photo: unknown }) => s.photo)).toBe(true);
  if (!isMobile) await expect(page.getByRole("textbox", { name: "Color name" })).toHaveValue(/Jade White|Black/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the reading state, a filled spool and the list of spools pass axe in ${scheme}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme });
    const slow = await addSpool(page, { note: "slow" });
    await readFrom(page, slow, jade);
    await expect(page.getByText("Reading the label…").first()).toBeVisible();
    await expectAccessible(page, "A spool while its label is read");
    await expect(page.getByRole("textbox", { name: "Brand" })).toHaveValue("Bambu Lab", { timeout: 30_000 });
    await expect(page.getByText("from the label").first()).toBeVisible();
    await expectAccessible(page, "A spool filled from its label");

    const many = await addSpool(page, { note: "two spools" });
    await readFrom(page, many, two);
    await expect(page.getByRole("dialog", { name: "2 spools on this label" })).toBeVisible({ timeout: 20_000 });
    await expectAccessible(page, "The several-spools list");
  });
}
