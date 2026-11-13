import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

// Slicing for another nozzle (decision 0055): with a 0.2 mm nozzle fitted beside the 0.4 mm one, "Slice with…" offers
// the nozzle, the quality keeps its name at that nozzle's own height, and the engine slices with Bambu's 0.2 mm
// presets: 0.10 mm layers and 0.22 mm lines for Standard.
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

/** What the sliced file's G-code says it was sliced with: "; layer_height = 0.1" and the like, by key. */
async function slicedWith(page: Page, href: string, keys: string[]) {
  const file = await page.request.get(href);
  expect(file.ok()).toBe(true);
  const zip = unzipSync(new Uint8Array(await file.body()));
  const gcode = strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array());
  return Object.fromEntries(keys.map((key) => [key, new RegExp(`^; ${key} = (.*)$`, "m").exec(gcode)?.[1]]));
}

test("a model is sliced for the 0.2 mm nozzle when it is picked, at that nozzle's Standard", async ({ page }) => {
  await signIn(page);
  await fitNozzles(page, { ...STOCK, auxiliary: { diameter: 0.2, hardened: false } });
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
  // New models slice for the main nozzle, the 0.4 mm, which the row doesn't name.
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  await files.getByRole("button", { name: /^Slice with… Standard, Everyday strength/ }).click();

  const settings = page.getByRole("dialog", { name: "How to slice it" });
  const nozzle = settings.getByRole("group", { name: "Nozzle" });
  await expect(nozzle.getByRole("radio", { name: /^0\.4 mm Main · left/ })).toBeChecked();
  const quality = settings.getByRole("group", { name: "Quality" });
  await expect(quality.getByRole("radio", { name: /^Standard 0\.20 mm/ })).toBeChecked();

  // The 0.2 mm: Standard stays Standard, at 0.10 mm, and the tiles' heights are the 0.2 mm's.
  await nozzle.getByRole("radio", { name: /^0\.2 mm Auxiliary · right/ }).check();
  await expect(quality.getByRole("radio", { name: /^Standard 0\.10 mm/ })).toBeChecked();
  await expect(quality.getByRole("radio", { name: /^Fine 0\.08 mm/ })).toBeVisible();
  await expect(quality.getByRole("radio", { name: /^Extra draft 0\.14 mm/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Sliced again for it: the row names the nozzle, and the file is Bambu's 0.2 mm Standard.
  const row = files.getByRole("button", {
    name: /^Slice with… Standard, Everyday strength, No supports, 0\.2 mm nozzle/,
  });
  await expect(row).toBeVisible();
  const href = (await files.getByRole("link", { name: "Download tiny.gcode.3mf" }).getAttribute("href")) ?? "";
  const keys = ["layer_height", "line_width", "outer_wall_line_width", "nozzle_diameter"];
  await expect.poll(async () => (await slicedWith(page, href, keys)).layer_height, { timeout: SLICED }).toBe("0.1");
  expect(await slicedWith(page, href, keys)).toEqual({
    layer_height: "0.1",
    line_width: "0.22",
    outer_wall_line_width: "0.22",
    nozzle_diameter: "0.2,0.2",
  });
  // What the change did, in the card's words.
  await expect(files.getByText(/The 0\.2 mm nozzle: \d+ min longer/).first()).toBeVisible();

  // Its layers in the 3D view: a 10 mm cube in 0.10 mm layers.
  await files.getByRole("button", { name: "See tiny.stl in 3D" }).click();
  const viewer = page.getByRole("dialog", { name: "3D view" });
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText(/Layer \d+ of 100/)).toBeVisible();
});
