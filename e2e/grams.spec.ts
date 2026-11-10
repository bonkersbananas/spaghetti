import { expect, type Page, test } from "@playwright/test";
import { SLICER_FILE_NAME, slicerFile } from "./fixtures/slicer-file.ts";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;
const spoolOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/spools/${id}`)).json()).spool as { gramsLeft: number | null; remaining: string };

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

// Leave nothing behind: other tests expect empty sections and an empty pantry.
test.afterEach(async ({ page }) => {
  const headers = { Origin: origin(page) };
  const { items } = await (await page.request.get("/api/items")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers });
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers });
});

test("counts a spool down from a slicer file, weighs it, warns when it is short and lists it as running low", async ({
  page,
  isMobile,
}) => {
  const headers = { Origin: origin(page) };
  const spoolId = crypto.randomUUID();
  await page.request.post("/api/spools", {
    headers,
    data: { id: spoolId, material: "PLA", brand: "Bambu", colorName: "Bambu green", colorHex: "#00ae42" },
  });
  const buildId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Desk clips", stage: "building" } });
  await page.request.post(`/api/items/${buildId}/attempts`, { headers, data: { id: attemptId, outcome: null } });

  // No weight yet: the level is hand-set, with an offer to count in grams.
  await page.goto(`/pantry/${spoolId}`);
  await expect(page.getByRole("radio", { name: "Full" })).toBeVisible();
  await page.getByRole("button", { name: "Count in grams" }).click();
  const setSheet = page.getByRole("dialog", { name: "Set the weight" });
  await setSheet.getByRole("button", { name: "1 kg" }).click();
  await expect.poll(async () => (await spoolOf(page, spoolId)).gramsLeft).toBe(1000);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Left on the spool")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Full" })).toHaveCount(0);

  // Finish an attempt with a slicer file: plate 1 uses 18.4 g of the green PLA.
  await page.goto(`/builds/${buildId}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  await expect(entry).toBeVisible();
  const file = { name: SLICER_FILE_NAME, bytes: Array.from(slicerFile()) };
  if (isMobile) {
    await entry.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add the slicer file" }).waitFor();
    await page.getByTestId("slicer-file-input").setInputFiles({
      name: file.name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(file.bytes),
    });
  } else {
    const dataTransfer = await page.evaluateHandle(({ name, bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name));
      return transfer;
    }, file);
    await entry.dispatchEvent("dragenter", { dataTransfer });
    await entry.dispatchEvent("drop", { dataTransfer });
  }
  const sheet = page.getByRole("dialog", { name: "Finish attempt 1" });
  await sheet
    .getByRole("region", { name: "Which plate?" })
    .getByRole("button", { name: /Cable clips/ })
    .click();
  await expect(sheet.getByText("plate 1 of 2")).toBeVisible();
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();

  // 1000 − 18.4 → about 982 g.
  await expect.poll(async () => (await spoolOf(page, spoolId)).gramsLeft, { timeout: 15_000 }).toBe(982);
  await page.goto(`/pantry/${spoolId}`);
  await expect(page.getByText("982 g").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What used it" })).toBeVisible();
  await expect(page.getByText(/Desk clips, attempt 1/)).toBeVisible();

  // Weigh it: 812 g on the scale, the empty spool 250 g → 562 g, with an undo toast.
  await page.getByRole("button", { name: "Weigh it" }).click();
  const weigh = page.getByRole("dialog", { name: "Weigh it" });
  await weigh.getByLabel("On the scale").fill("812");
  await weigh.getByLabel("The empty spool weighs").fill("250");
  await expect(weigh.getByText("About 562 g of filament left.")).toBeVisible();
  await weigh.getByRole("button", { name: "Save weighing" }).click();
  await expect(weigh).toBeHidden();
  await expect(page.getByText("Weighed: about 562 g")).toBeVisible();
  await expect.poll(async () => (await spoolOf(page, spoolId)).gramsLeft).toBe(562);

  // Not enough for the next print: 30 g left, and a plate that needs 66 g (never blocked).
  await page.request.post(`/api/spools/${spoolId}/weighings`, {
    headers,
    data: { id: crypto.randomUUID(), gramsLeft: 30 },
  });
  const nextId = crypto.randomUUID();
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: nextId,
      outcome: null,
      settings: { filaments: [{ type: "PLA", colorName: "Bambu green", spoolId, grams: 66 }] },
    },
  });
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByTestId("not-enough")).toContainText("Bambu green has about 30 g left; this print needs 66 g.");
  await expect(page.locator(`[data-attempt-id="${nextId}"]`).getByRole("button", { name: "Finish" })).toBeEnabled();

  // Running low on the pantry, with the copy action.
  await page.goto("/pantry");
  const low = page.getByRole("region", { name: "Running low" });
  await expect(low).toBeVisible();
  await expect(low.getByText("about 30 g")).toBeVisible();
  await expect(low.getByText("Print needs 66 g")).toBeVisible();
  await expect(low.getByRole("button", { name: isMobile ? "Share list" : "Copy list" })).toBeVisible();
});
