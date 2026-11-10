import { expect, type Page, test } from "@playwright/test";
import { SLICER_FILE_NAME, slicerFile } from "./fixtures/slicer-file.ts";
import { signIn } from "./helpers.ts";

const origin = (page: Page) => new URL(page.url()).origin;

async function getItem(page: Page, id: string) {
  return (await (await page.request.get(`/api/items/${id}`)).json()).item;
}

async function addSpoolByApi(page: Page, data: Record<string, unknown>) {
  const id = crypto.randomUUID();
  await page.request.post("/api/spools", { headers: { Origin: origin(page) }, data: { id, ...data } });
  return id;
}

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

test("adds a spool to the pantry and loads it into the AMS", async ({ page, isMobile }) => {
  await page.goto("/pantry");
  await expect(page.getByRole("heading", { name: "The pantry's bare" })).toBeVisible();
  await page.getByRole("button", { name: "Add a spool" }).click();

  // Seconds: a material, a color, done.
  const sheet = page.getByRole("dialog", { name: "New spool" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "PETG", exact: true }).click();
  await sheet.getByRole("radio", { name: "Blue" }).click();
  await expect(sheet.getByRole("textbox", { name: "Color name" })).toHaveValue("Blue");
  await sheet.getByLabel("Brand").fill("Polymaker");
  await sheet.getByRole("button", { name: "Matte" }).click();
  await sheet.getByRole("button", { name: "Add to pantry" }).click();
  await expect(sheet).toBeHidden();

  await expect(page.getByRole("link", { name: /Blue Polymaker PETG Matte/ })).toBeVisible();
  await expect
    .poll(async () =>
      (await (await page.request.get("/api/spools")).json()).spools.map((s: { colorName: string }) => s.colorName),
    )
    .toEqual(["Blue"]);

  // An empty slot: tap it and pick the spool.
  await page.getByRole("button", { name: /^A3 Empty/ }).click();
  const slot = page.getByRole("dialog", { name: "Slot A3" });
  await slot.getByRole("button", { name: /Blue/ }).click();
  await expect(slot).toBeHidden();
  await expect(page.getByRole("button", { name: /^A3 Blue/ })).toBeVisible();
  await expect
    .poll(async () => Object.keys((await (await page.request.get("/api/printer")).json()).slots))
    .toEqual(["A3"]);

  // On desktop, drag it from the pantry to another slot.
  if (!isMobile) {
    await page
      .getByRole("link", { name: /Blue Polymaker PETG Matte/ })
      .dragTo(page.getByRole("button", { name: /^A1 Empty/ }));
    await expect(page.getByRole("button", { name: /^A1 Blue/ })).toBeVisible();
    await expect
      .poll(async () => Object.keys((await (await page.request.get("/api/printer")).json()).slots))
      .toEqual(["A1"]);
  }

  // The spool's page says where it is.
  await page.getByRole("link", { name: /Blue Polymaker PETG Matte/ }).click();
  await expect(page.getByText(isMobile ? "Loaded in A3" : "Loaded in A1")).toBeVisible();
});

test("reads a dropped slicer file onto an attempt and keeps it", async ({ page, isMobile }) => {
  const headers = { Origin: origin(page) };
  const green = await addSpoolByApi(page, {
    material: "PLA",
    brand: "Bambu",
    colorName: "Bambu green",
    colorHex: "#00ae42",
  });
  const id = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Desk clips", stage: "building" } });
  await page.request.post(`/api/items/${id}/attempts`, { headers, data: { id: attemptId, outcome: null } });
  await page.goto(`/builds/${id}`);
  const entry = page.locator(`[data-attempt-id="${attemptId}"]`);
  await expect(entry).toBeVisible();

  const file = { name: SLICER_FILE_NAME, bytes: Array.from(slicerFile()) };
  if (isMobile) {
    // Phones pick it from the attempt.
    await entry.getByRole("button", { name: "Finish" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Add the slicer file" }).waitFor();
    await page.getByTestId("slicer-file-input").setInputFiles({
      name: file.name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(file.bytes),
    });
  } else {
    // Desktop drops it on the attempt.
    const dataTransfer = await page.evaluateHandle(({ name, bytes }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], name));
      return transfer;
    }, file);
    await entry.dispatchEvent("dragenter", { dataTransfer });
    await entry.dispatchEvent("drop", { dataTransfer });
  }

  const sheet = page.getByRole("dialog", { name: "Finish attempt 1" });
  await expect(sheet).toBeVisible();
  // Two plates: one tap says which.
  await sheet
    .getByRole("region", { name: "Which plate?" })
    .getByRole("button", { name: /Cable clips/ })
    .click();
  await expect(sheet.getByText(SLICER_FILE_NAME)).toBeVisible();
  await expect(sheet.getByText("plate 1 of 2")).toBeVisible();

  // Prefilled and marked as from the file, with the green PLA matched to the pantry's spool.
  await expect(sheet.getByLabel("Process profile")).toHaveValue("0.20mm Standard @BBL X2D");
  await expect(sheet.getByLabel("Nozzle", { exact: true })).toHaveValue("220");
  await expect(sheet.getByLabel("Walls")).toHaveValue("3");
  await expect(sheet.getByLabel("Estimated")).toHaveValue("1 h 12 min");
  await expect(sheet.getByText("Bambu green").first()).toBeVisible();
  await expect(sheet.getByTitle("From the slicer file").first()).toBeVisible();

  await expect
    .poll(async () => {
      const attempt = (await getItem(page, id)).attempts[0];
      return [
        attempt.file?.name,
        attempt.file?.plate,
        attempt.file?.stored,
        attempt.settings.estimatedMinutes,
        attempt.settings.filaments?.[0]?.spoolId,
      ];
    })
    .toEqual([SLICER_FILE_NAME, 1, true, 72, green]);

  // The file stays with the attempt, one tap to download.
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: "Done" }).click();
  await expect(sheet).toBeHidden();
  const download = entry.getByRole("link", { name: `Download ${SLICER_FILE_NAME}` });
  await expect(download).toBeVisible();
  const response = await page.request.get((await download.getAttribute("href")) ?? "");
  expect(response.ok()).toBe(true);
  expect((await response.body()).length).toBe(file.bytes.length);

  // A second file that hasn't reached the server yet, removed again: the saved one goes too, not just the waiting one.
  await page.route(`**/api/attempts/${attemptId}/file`, (route) =>
    route.request().method() === "PUT" ? route.fulfill({ status: 503, body: "{}" }) : route.fallback(),
  );
  await expect(entry.getByRole("button", { name: "Attempt 1: success. Open" })).toBeVisible();
  // Its top corner: the middle of the card is the file, with its own download link.
  await entry.getByRole("button", { name: "Attempt 1: success. Open" }).click({ position: { x: 24, y: 24 } });
  const again = page.getByRole("dialog", { name: "Attempt 1" });
  await expect(again).toBeVisible();
  await page.getByTestId("slicer-file-input").setInputFiles({
    name: "desk-clips-v2.gcode.3mf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(file.bytes),
  });
  await again.getByRole("region", { name: "Which plate?" }).getByRole("button", { name: /Hook/ }).click();
  await expect(again.getByText("desk-clips-v2.gcode.3mf")).toBeVisible();
  await again.getByRole("button", { name: "Remove the slicer file" }).click();
  await expect(again.getByRole("button", { name: "Add the slicer file" })).toBeVisible();
  await page.unroute(`**/api/attempts/${attemptId}/file`);
  await expect.poll(async () => (await getItem(page, id)).attempts[0]?.file).toBeNull();
});

test("picks a spool from the pantry for an attempt's filament", async ({ page, isMobile }) => {
  const headers = { Origin: origin(page) };
  const silk = await addSpoolByApi(page, {
    material: "PLA",
    brand: "Eryone",
    colorName: "Silk gold",
    colorHex: "#c9a46b",
    finish: "silk",
  });
  await page.request.put("/api/printer/slots/Ext", { headers, data: { spoolId: silk } });
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers, data: { id, title: "Lampshade", stage: "building" } });
  await page.goto(`/builds/${id}`);
  // Wait for the build before pressing its hotkey.
  await expect(page.getByRole("heading", { name: "The water's still heating" })).toBeVisible();

  if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
  else await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await sheet.getByRole("radio", { name: "Worked" }).click();
  await sheet.getByRole("button", { name: /^Settings(?! worth)/ }).click();
  await sheet
    .getByRole("group", { name: "Spools for filament 1" })
    .getByRole("button", { name: /Silk gold/ })
    .click();
  await expect(sheet.getByText("Eryone PLA Silk · external spool")).toBeVisible();
  await sheet.getByRole("button", { name: "Log attempt" }).click();
  await expect(sheet).toBeHidden();

  await expect
    .poll(async () => (await getItem(page, id)).attempts[0]?.settings.filaments?.[0])
    .toMatchObject({ spoolId: silk, type: "PLA", brand: "Eryone", colorName: "Silk gold", amsSlot: "Ext" });

  // The spool's page lists the print.
  await page.goto(`/pantry/${silk}`);
  const printed = page.getByRole("region", { name: /Printed with it/ });
  await expect(printed.getByRole("link", { name: /Lampshade · attempt 1/ })).toBeVisible();
  await expect(printed).toContainText("1 worked");
});
