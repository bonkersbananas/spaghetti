import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

// Slicing for another nozzle (decision 0056). The engine prints every slice with the main nozzle, so a slice is for
// the size fitted there: with a 0.2 mm as the main nozzle, models slice with Bambu's 0.2 mm presets (Standard is
// 0.10 mm layers and 0.22 mm lines); with a 0.2 mm only in the auxiliary, a line says how to slice for it.
const SLICED = 60_000;
const STOCK = { main: { diameter: 0.4, hardened: true }, auxiliary: { diameter: 0.4, hardened: true } };

const origin = (page: Page) => ({ Origin: new URL(page.url()).origin });

async function fitNozzles(page: Page, nozzles: typeof STOCK) {
  const response = await page.request.put("/api/printer", { headers: origin(page), data: { nozzles } });
  expect(response.ok()).toBe(true);
}

test.afterEach(async ({ page }) => {
  await fitNozzles(page, STOCK);
  await clearIdeas(page);
});

/** An idea with a 10 mm cube, sliced. Returns the files' region. */
async function slicedCube(page: Page) {
  const id = crypto.randomUUID();
  const created = await page.request.post("/api/items", { headers: origin(page), data: { id, title: "Tiny cube" } });
  expect(created.ok()).toBe(true);
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "tiny.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(10)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  return files;
}

/** What the sliced file's G-code says it was sliced with: "; layer_height = 0.1" and the like, by key. */
async function slicedWith(page: Page, href: string, keys: string[]) {
  const file = await page.request.get(href);
  expect(file.ok()).toBe(true);
  const zip = unzipSync(new Uint8Array(await file.body()));
  const gcode = strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array());
  return Object.fromEntries(keys.map((key) => [key, new RegExp(`^; ${key} = (.*)$`, "m").exec(gcode)?.[1]]));
}

test("with a 0.2 mm as the main nozzle, a model slices for it, at that nozzle's Standard", async ({ page }) => {
  await signIn(page);
  await fitNozzles(page, { ...STOCK, main: { diameter: 0.2, hardened: true } });
  const files = await slicedCube(page);

  // The row names the nozzle; the file is Bambu's 0.2 mm Standard.
  const row = files.getByRole("button", {
    name: /^Slice with… Standard, Everyday strength, No supports, 0\.2 mm nozzle/,
  });
  await expect(row).toBeVisible();
  const href = (await files.getByRole("link", { name: "Download tiny.gcode.3mf" }).getAttribute("href")) ?? "";
  expect(
    await slicedWith(page, href, ["layer_height", "line_width", "outer_wall_line_width", "nozzle_diameter"]),
  ).toEqual({
    layer_height: "0.1",
    line_width: "0.22",
    outer_wall_line_width: "0.22",
    nozzle_diameter: "0.2,0.2",
  });

  // Its settings: the quality tiles are the 0.2 mm's, Standard at 0.10 mm.
  await row.click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  const quality = settings.getByRole("group", { name: "Quality" });
  await expect(quality.getByRole("radio", { name: /^Standard 0\.10 mm/ })).toBeChecked();
  await expect(quality.getByRole("radio", { name: /^Fine 0\.08 mm/ })).toBeVisible();
  await expect(quality.getByRole("radio", { name: /^Extra draft 0\.14 mm/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Its layers in the 3D view: a 10 mm cube in 0.10 mm layers.
  await files.getByRole("button", { name: "See tiny.stl in 3D" }).click();
  const viewer = page.getByRole("dialog", { name: "3D view" });
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText(/Layer \d+ of 100/)).toBeVisible();
});

test("with a 0.2 mm only in the auxiliary, it slices for the main nozzle and says how to slice for the 0.2", async ({
  page,
}) => {
  await signIn(page);
  await fitNozzles(page, { ...STOCK, auxiliary: { diameter: 0.2, hardened: false } });
  const files = await slicedCube(page);
  // The main nozzle's 0.4 mm, which the row doesn't name.
  const row = files.getByRole("button", { name: /^Slice with… Standard, Everyday strength, No supports, PLA/ });
  await row.click();

  const settings = page.getByRole("dialog", { name: "How to slice it" });
  // The choice of nozzle is first under More, the sizes fitted marked (decision 0057); no line yet: it slices for the
  // main nozzle.
  await expect(settings.getByText("For a 0.4 mm nozzle", { exact: false })).toHaveCount(0);
  await settings.getByRole("button", { name: /^More/ }).click();
  const nozzle = settings.getByRole("group", { name: "Nozzle" });
  await expect(nozzle.getByRole("radio", { name: "0.4 mm (main nozzle)" })).toBeChecked();
  await expect(nozzle.getByRole("radio", { name: "0.2 mm (other nozzle)" })).toBeVisible();

  // Another size is a try-slice: the card says the file needs it as the main nozzle.
  await settings.getByRole("radio", { name: "0.6 mm" }).click();
  await expect(settings.getByText("For a 0.6 mm nozzle", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const warning = files.getByText("Sliced for a 0.6 mm nozzle; the main nozzle has the 0.4 mm. Fit the 0.6 mm first.");
  await expect(warning).toBeVisible({ timeout: SLICED });
  // A deliberate pick has no button of its own on the card: the way back is More's Nozzle (or Undo).
  await expect(files.getByRole("button", { name: "Slice for the 0.4 mm" })).toHaveCount(0);
  await files.getByRole("button", { name: /^Slice with…/ }).click();
  await page.getByRole("dialog", { name: "How to slice it" }).getByRole("button", { name: /^More/ }).click();
  await page
    .getByRole("dialog", { name: "How to slice it" })
    .getByRole("radio", { name: /^0\.4 mm/ })
    .click();
  await page.keyboard.press("Escape");
  await expect(warning).toBeHidden({ timeout: SLICED });
  await expect(row).toBeVisible();
});

/** The slicing a saved model's slice was made with, by file name, from the idea's files. */
async function sliceNozzleOf(page: Page, ideaId: string, name: string) {
  const { item } = await (await page.request.get(`/api/items/${ideaId}`)).json();
  const file = (item.files as { name: string; slice?: { settings: { slicing?: { nozzle: number } } } }[]).find(
    (candidate) => candidate.name === name,
  );
  return file?.slice?.settings.slicing?.nozzle;
}

// Decision 0057: a model tries another nozzle size from "Slice with…", without touching the Printer page.
test("a model tries a 0.2 mm nozzle on its own: kept across a reload, said on Print it, and cleared by the reset", async ({
  page,
}) => {
  test.setTimeout(4 * SLICED);
  await signIn(page);
  // One model sliced on the idea page, which must not follow.
  const ideaId = crypto.randomUUID();
  await page.request.post("/api/items", { headers: origin(page), data: { id: ideaId, title: "Other cube" } });
  await page.goto(`/ideas/${ideaId}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "other.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(10)),
  });
  await expect(page.getByRole("region", { name: /^Files/ }).getByText(/Sliced by Spaghetti$/)).toBeVisible({
    timeout: SLICED,
  });

  // The model on a twist.
  const twistId = crypto.randomUUID();
  await page.request.post("/api/twists", { headers: origin(page), data: { id: twistId, name: "Fusilli knob" } });
  await page.goto(`/twists/${twistId}`);
  await page.getByRole("button", { name: "Adapt an STL" }).click();
  const adapt = page.getByRole("dialog", { name: "Adapt an STL" });
  await adapt.getByTestId("adapt-file-input").setInputFiles({
    name: "knob.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(20)),
  });
  await adapt.getByRole("textbox", { name: "Scale" }).fill("110");
  await adapt.getByRole("button", { name: "Keep with the twist" }).click();
  await expect(adapt).toBeHidden();
  const model = page.getByRole("region", { name: "Model" });
  await expect(model.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  // Fitted as it is, Print it says nothing about a nozzle.
  await expect(page.getByText(/Fit the 0\.2 mm first/)).toHaveCount(0);

  // Pick 0.2 mm under More: this model slices again for it.
  await model.getByRole("button", { name: /^Slice with…/ }).click();
  let settings = page.getByRole("dialog", { name: "How to slice it" });
  await settings.getByRole("button", { name: /^More/ }).click();
  await settings.getByRole("radio", { name: /^0\.2 mm/ }).click();
  const warning = model.getByText("Sliced for a 0.2 mm nozzle; the main nozzle has the 0.4 mm. Fit the 0.2 mm first.");
  await page.keyboard.press("Escape");
  await expect(warning).toBeVisible({ timeout: SLICED });
  const printNote = "Sliced for a 0.2 mm nozzle; the main nozzle has the 0.4 mm. Fit the 0.2 mm first.";
  await expect(page.getByText(printNote).first()).toBeVisible();
  // Printing isn't blocked.
  await expect(page.getByRole("button", { name: /^Print it/ })).toBeEnabled();
  // Nothing else changed: the Printer page's nozzle, and the other model's slice.
  const printer = await (await page.request.get("/api/printer")).json();
  expect(printer.setup.nozzles.main.diameter).toBe(0.4);
  expect(await sliceNozzleOf(page, ideaId, "other.stl")).toBe(0.4);

  // Kept across a reload: the sheet shows the pick, and the note stays.
  await page.reload();
  await expect(page.getByText(printNote).first()).toBeVisible();
  await page
    .getByRole("region", { name: "Model" })
    .getByRole("button", { name: /^Slice with…/ })
    .click();
  settings = page.getByRole("dialog", { name: "How to slice it" });
  await settings.getByRole("button", { name: /^More/ }).click();
  await expect(settings.getByRole("radio", { name: /^0\.2 mm/ })).toBeChecked();

  // Back to the usual settings clears it: sliced for the main nozzle again, with an undo.
  await settings.getByRole("button", { name: "Back to the usual settings" }).click();
  await expect(settings.getByRole("radio", { name: /^0\.4 mm/ })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(warning).toBeHidden({ timeout: SLICED });
  await expect(page.getByText(printNote)).toHaveCount(0);
});
