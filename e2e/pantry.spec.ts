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

test("adds a spool to the pantry and loads it into the AMS", { tag: "@phone" }, async ({ page, isMobile }) => {
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
  await sheet.getByRole("button", { name: "Matte", exact: true }).click();
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
    // Phones pick it from the attempt (its question is in the action bar there).
    await page.getByRole("button", { name: "How did it go?" }).click();
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

  // A file only fills the settings in: the row stays folded on its summary until it is opened.
  await expect(sheet.getByLabel("Process profile")).toHaveCount(0);
  await sheet.getByRole("button", { name: /^Settings(?! worth)/ }).click();
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
  await again.getByRole("button", { name: "More for desk-clips-v2.gcode.3mf" }).click();
  await page.getByRole("button", { name: "Remove file" }).click();
  await expect(again.getByRole("button", { name: "Add the slicer file" })).toBeVisible();
  await page.unroute(`**/api/attempts/${attemptId}/file`);
  await expect.poll(async () => (await getItem(page, id)).attempts[0]?.file).toBeNull();
});

test("picks a spool from the pantry for an attempt's filament", { tag: "@phone" }, async ({ page, isMobile }) => {
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
  // One ✕ per filament row: with a single filament there is none, and "type it in" waits in Change.
  await expect(sheet.getByRole("button", { name: /Type filament 1 in instead/ })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Pick another spool for filament 1" }).click();
  await expect(sheet.getByRole("button", { name: "Type it in instead" })).toBeVisible();
  await sheet.getByRole("button", { name: /^Keep / }).click();
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

test("AMS bays say what is left, and the desktop list view is remembered", async ({ page, isMobile }) => {
  const headers = { Origin: origin(page) };
  const empty = await addSpoolByApi(page, {
    material: "PLA",
    colorName: "Gray",
    colorHex: "#8e9089",
    remaining: "empty",
  });
  const dried = await addSpoolByApi(page, {
    material: "PETG",
    colorName: "Blue",
    colorHex: "#0a2989",
    remaining: "half",
    driedAt: Date.now() - 5 * 24 * 3_600_000,
  });
  await addSpoolByApi(page, { material: "PLA", colorName: "Sunflower yellow", colorHex: "#f0b323", remaining: "low" });
  await page.request.put("/api/printer/slots/A1", { headers, data: { spoolId: empty } });
  await page.request.put("/api/printer/slots/A2", { headers, data: { spoolId: dried } });

  await page.goto("/pantry");
  // An empty spool that is still loaded says so in words, at every width.
  const bayA1 = page.getByRole("button", { name: /^A1 Gray/ });
  await expect(bayA1.getByText("Empty", { exact: true })).toBeVisible();
  // From lg the bay is a row with its level in words and when the spool was dried; below, a column with the bars.
  const bayA2 = page.getByRole("button", { name: /^A2 Blue/ });
  if (isMobile) {
    // Screen-reader-only below lg: one pixel wide on screen, and the dried line isn't drawn at all.
    const half = await bayA2.getByText("Half", { exact: true }).boundingBox();
    expect(half?.width ?? 0).toBeLessThanOrEqual(1);
    await expect(bayA2.getByText("5 d ago")).toBeHidden();
  } else {
    await expect(bayA2.getByText("Half", { exact: true })).toBeVisible();
    await expect(bayA2.getByText("5 d ago")).toBeVisible();
  }

  if (isMobile) {
    // Phones always show cards: no switch.
    await expect(page.getByRole("radio", { name: "List" })).toHaveCount(0);
    return;
  }
  // Cards first; the list is one choice away and survives a reload.
  await expect(page.getByRole("radio", { name: "Cards" })).toBeChecked();
  await page.getByRole("radio", { name: "List" }).click();
  const pla = page.getByRole("list", { name: "PLA spools" });
  await expect(pla.getByRole("link")).toHaveCount(2);
  // Low first, and the empty ones last.
  await expect(pla.getByRole("link").first()).toContainText("Sunflower yellow");
  await expect(pla.getByRole("link").last()).toContainText("Gray");
  await page.reload();
  await expect(page.getByRole("radio", { name: "List" })).toBeChecked();
  await expect(page.getByRole("list", { name: "PLA spools" }).getByRole("link")).toHaveCount(2);
  expect(await page.evaluate(() => localStorage.getItem("sg-pantry-view"))).toBe("list");
  await page.getByRole("radio", { name: "Cards" }).click();
  expect(await page.evaluate(() => localStorage.getItem("sg-pantry-view"))).toBe("cards");
});

test("running-low spools go on the shopping list in one tap, and only once", { tag: "@phone" }, async ({ page }) => {
  const headers = { Origin: origin(page) };
  await addSpoolByApi(page, { material: "PLA", colorName: "Sunflower yellow", colorHex: "#f0b323", remaining: "low" });
  await addSpoolByApi(page, { material: "PETG", colorName: "Teal", colorHex: "#1a8a8a", remaining: "empty" });

  await page.goto("/pantry");
  const low = page.getByRole("region", { name: "Running low" });
  await low.getByRole("button", { name: "Add to shopping list" }).click();
  await expect(low.getByRole("button", { name: "On the shopping list" })).toBeVisible();

  // The button rests as soon as every spool shows on the list; the second one may still be on its way to the server.
  const mine = ["Sunflower yellow, PLA", "Teal, PETG"];
  const onServer = async () => {
    const { shoppingItems } = await (await page.request.get("/api/shopping-items")).json();
    return shoppingItems
      .map((item: { name: string }) => item.name)
      .filter((name: string) => mine.includes(name))
      .sort();
  };
  await expect.poll(onServer).toEqual(mine);

  // Everything is on the list now: the button says so and stays quiet, so a second tap can't double it.
  await expect(low.getByRole("button", { name: "On the shopping list" })).toBeDisabled();
  const after = await (await page.request.get("/api/shopping-items")).json();
  const added = after.shoppingItems.filter((item: { name: string }) => mine.includes(item.name));
  expect(added).toHaveLength(2);
  for (const item of added) await page.request.delete(`/api/shopping-items/${item.id}`, { headers });
});

test("a phone with many spools starts compact, and Cards brings the big ones back", { tag: "@phone" }, async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "The compact view is the phone's.");
  for (let index = 0; index < 13; index++) {
    await addSpoolByApi(page, { material: "PLA", colorName: `Shade ${index}`, colorHex: "#c0392b" });
  }
  await page.goto("/pantry");
  const spools = page.getByRole("list", { name: "PLA spools" });
  await expect(spools).toBeVisible();
  // Compact: the spool's page holds the product line, so the tile has no second line, and the toggle shows.
  await expect(page.getByRole("radio", { name: "List" })).toBeChecked();
  await page.getByRole("radio", { name: "Cards" }).click({ force: true });
  await expect(page.getByRole("radio", { name: "Cards" })).toBeChecked();
  await page.evaluate(() => localStorage.removeItem("sg-pantry-density"));
});

test("a filament bought on the shopping list goes to the pantry in one tap, with its colour", {
  tag: "@phone",
}, async ({ page }) => {
  const headers = { Origin: origin(page) };
  await page.goto("/shopping");
  const field = page.getByRole("textbox", { name: "Add something to buy" });
  for (const text of ["PLA Basic, Jade White", "0.2 mm hardened nozzle"]) {
    await field.fill(text);
    await field.press("Enter");
    await expect(field).toHaveValue("");
  }
  for (const name of ["PLA Basic, Jade White", "0.2 mm hardened nozzle"]) {
    await page.getByRole("checkbox", { name: `Bought: ${name}` }).click();
  }
  const bought = page.getByRole("list", { name: "Bought" });
  const nozzle = bought.getByRole("listitem").filter({ hasText: "hardened nozzle" });
  const filament = bought.getByRole("listitem").filter({ hasText: "Jade White" });
  await expect(nozzle).toContainText("got it");
  // Only filament offers the pantry.
  await expect(nozzle.getByRole("button", { name: "Add to pantry" })).toHaveCount(0);
  await filament.getByRole("button", { name: "Add to pantry" }).click();

  const sheet = page.getByRole("dialog", { name: "New spool" });
  await expect(sheet.getByRole("textbox", { name: "Color name" })).toHaveValue("Jade white");
  await sheet.getByRole("button", { name: "Add to pantry" }).click();
  await expect(sheet).toBeHidden();

  // Once added, the row says so and doesn't offer it again.
  await expect(filament.getByRole("button", { name: "Add to pantry" })).toHaveCount(0);
  await expect(filament.getByRole("link", { name: "In the pantry" })).toBeVisible();
  // The mark is the list's own (the other person sees it too): it survives a reload and a cleared device.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(
    page
      .getByRole("list", { name: "Bought" })
      .getByRole("listitem")
      .filter({ hasText: "Jade White" })
      .getByRole("link", { name: "In the pantry" }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      (await (await page.request.get("/api/spools")).json()).spools.map(
        (s: { material: string; finish: string | null; colorName: string }) => [s.material, s.finish, s.colorName],
      ),
    )
    .toEqual([["PLA", "basic", "Jade white"]]);

  const { shoppingItems } = await (await page.request.get("/api/shopping-items")).json();
  for (const item of shoppingItems) await page.request.delete(`/api/shopping-items/${item.id}`, { headers });
});

test("filling the AMS: the colour picked is the colour saved, and the next slot is one tap", { tag: "@phone" }, async ({
  page,
}) => {
  await page.goto("/pantry");
  await page.getByRole("button", { name: "Add a spool" }).click();
  let sheet = page.getByRole("dialog", { name: "New spool" });
  await sheet.getByRole("radio", { name: "Jade white" }).click();
  await expect(sheet.getByRole("textbox", { name: "Color name" })).toHaveValue("Jade white");
  // A product sold in a colour brings it.
  await sheet.getByRole("button", { name: "Bambu Lab PLA Basic · Black" }).click();
  await expect(sheet.getByRole("textbox", { name: "Color name" })).toHaveValue("Black");
  await sheet.getByRole("button", { name: "Add to pantry" }).click();
  await expect(sheet).toBeHidden();

  // From an empty slot: the button names the slot.
  await page.getByRole("button", { name: /^A1 Empty/ }).click();
  await page.getByRole("dialog", { name: "Slot A1" }).getByRole("button", { name: "New spool" }).click();
  sheet = page.getByRole("dialog", { name: "New spool" });
  await sheet.getByRole("button", { name: "Bambu Lab PLA Basic · Jade white" }).click();
  await sheet.getByRole("button", { name: "Add to A1" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /^A1 Jade white/ })).toBeVisible();

  // One tap on to the next slot.
  await page.getByRole("button", { name: "Next slot, A2" }).click();
  await expect(
    page.getByRole("dialog", { name: "New spool" }).getByRole("button", { name: "Add to A2" }),
  ).toBeVisible();
});

test("a bought PETG item offers no PLA products and shows its colour on a phone", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  await page.goto("/shopping");
  const field = page.getByRole("textbox", { name: "Add something to buy" });
  await field.fill("Spool of white PETG");
  await field.press("Enter");
  await page.getByRole("checkbox", { name: "Bought: Spool of white PETG" }).click();
  await page
    .getByRole("list", { name: "Bought" })
    .getByRole("listitem")
    .filter({ hasText: "white PETG" })
    .getByRole("button", { name: "Add to pantry" })
    .click();

  const sheet = page.getByRole("dialog", { name: "New spool" });
  await expect(sheet.getByRole("button", { name: "PETG", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("textbox", { name: "Color name" })).toHaveValue("White");
  // "white" is the Jade white swatch: it is the one lit, and the custom swatch stays a palette.
  await expect(sheet.getByRole("radio", { name: "Jade white" })).toBeChecked();
  // None of the products is PETG: no row of PLA ones, and the colour is in view without scrolling.
  await expect(sheet.getByText("Start from a product")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: /Bambu Lab PLA/ })).toHaveCount(0);
  const colour = sheet.getByRole("textbox", { name: "Color name" });
  await expect(colour).toBeInViewport();
  if (isMobile) expect((await colour.boundingBox())?.y ?? 9999).toBeLessThan(844);
});
