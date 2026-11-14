import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { twoColourProject } from "./fixtures/model-3mf";
import { boxesStl, boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

// Spaghetti's own slicer (decision 0055): its WebAssembly module (slicer-rs, served at /slicer/rust-<version>/)
// slices a model in the browser once it is picked, and OrcaSlicer's engine steps in for what ours can't slice yet,
// the card saying why.
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const SLICED = 60_000;

/** An idea with a model (.stl or .3mf) kept on it; returns its id and the files' region once the model shows. */
async function ideaWithModel(page: Page, title: string, name: string, model: Uint8Array) {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title, note: "" },
  });
  await page.goto(`/ideas/${id}`);
  const mimeType = name.endsWith(".3mf") ? "model/3mf" : "model/stl";
  await page.getByTestId("idea-file-input").setInputFiles({ name, mimeType, buffer: Buffer.from(model) });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText(name)).toBeVisible();
  return { id, files };
}

const fileOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/items/${id}`)).json()).item.files?.[0];

/** The workspace's slicing defaults (the Printer page's), with these over Spaghetti's; `null` puts Spaghetti's back. */
async function setDefaults(page: Page, change: Record<string, unknown> | null) {
  const response = await page.request.put("/api/printer", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      slicing: change && {
        layerHeight: 0.2,
        walls: 2,
        infill: 15,
        pattern: "crosshatch",
        supports: "off",
        supportStyle: "tree",
        brim: "auto",
        ...change,
      },
    },
  });
  expect(response.ok()).toBe(true);
}

test("a model picked for Spaghetti's own slicer is sliced by it in the browser, says so, and opens in 3D", async ({
  page,
}) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  const { id, files } = await ideaWithModel(page, "Cube", "cube.stl", boxStl(20));
  // OrcaSlicer's engine is the default, for now.
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  await expect.poll(async () => (await fileOf(page, id))?.slice?.status, { timeout: SLICED }).toBe("sliced");
  const orca = (await fileOf(page, id)).slice;
  expect(orca.settings.slicer).toBe("orca");

  // Picked under More: the model keeps it and is sliced again, by ours.
  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  await settings.getByRole("button", { name: /^More/ }).click();
  const slicer = settings.getByRole("group", { name: "Slicer" });
  await expect(slicer.getByRole("radio", { name: "OrcaSlicer" })).toBeChecked();
  await slicer.getByRole("radio", { name: "Spaghetti's own" }).click();
  await expect(slicer.getByRole("radio", { name: "Spaghetti's own" })).toBeChecked();
  await expect(settings.getByText(/^Spaghetti's own · quicker/)).toBeVisible();
  await expect.poll(async () => (await fileOf(page, id))?.slicing?.slicer).toBe("spaghetti");

  // Sliced again: the card says what the change did (as after any change), the attribution by which slicer, and in
  // how long.
  await expect
    .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
    .toBe("spaghetti");
  await expect(files.getByText(/Spaghetti's own slicer: /)).toBeVisible();
  const ours = (await fileOf(page, id)).slice;
  expect(ours.settings.rust).toMatch(/^\d+$/);
  expect(ours.fallback).toBeUndefined();
  expect(ours.ms).toBeGreaterThan(0);
  await expect(settings.getByText(/^Sliced in this browser in [\d.]+ s by Spaghetti's own slicer/)).toBeVisible();
  await expect(settings.getByRole("link", { name: "Its source" })).toHaveAttribute(
    "href",
    /releases\/tag\/slicer-rs-v/,
  );
  // The same print: a 20 mm cube is 100 layers by both, and about the same time and weight.
  const after = await fileOf(page, id);
  expect(after.prefill.estimatedMinutes).toBeGreaterThan(0);
  expect(after.prefill.weightGrams).toBeGreaterThan(0);
  console.log(`a 20 mm cube: OrcaSlicer ${orca.ms} ms, Spaghetti's own ${ours.ms} ms`);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  // Once the change is no longer news, the card says who sliced it.
  await page.reload();
  await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible();

  // Its file opens in 3D, layer by layer.
  await files.getByRole("button", { name: "See cube.stl in 3D" }).click();
  const viewer = page.getByRole("dialog", { name: "3D view" });
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText(/Layer \d+ of 100/)).toBeVisible();
});

test("what ours can't slice yet, OrcaSlicer's engine slices, and the card says why", async ({ page }) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  try {
    // The workspace slices with ours, with tree supports where needed (the usual kind), which ours can't build yet.
    await setDefaults(page, { slicer: "spaghetti", supports: "where-needed" });
    const { id, files } = await ideaWithModel(page, "Cube", "cube.stl", boxStl(20));
    await expect(files.getByText("Sliced by OrcaSlicer: our own slicer can't do tree supports yet")).toBeVisible({
      timeout: SLICED,
    });
    await expect.poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED }).toBe("orca");
    const slice = (await fileOf(page, id)).slice;
    expect(slice.fallback).toEqual({ why: "unsupported", what: "tree supports" });
    // What was asked for stays: the next slice asks ours again.
    expect(slice.settings.slicing.slicer).toBe("spaghetti");

    // Normal supports, ours builds.
    await files.getByRole("button", { name: "Slice with…" }).click();
    const settings = page.getByRole("dialog", { name: "How to slice it" });
    await settings.getByRole("button", { name: /^More/ }).click();
    await settings
      .getByRole("group", { name: "How supports are built" })
      .getByRole("button", { name: "Normal" })
      .click();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
      .toBe("spaghetti");
    expect((await fileOf(page, id)).slice.settings.slicing.supportStyle).toBe("normal");
    expect((await fileOf(page, id)).slice.fallback).toBeUndefined();
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible();
  } finally {
    // The worker's database is shared with the specs after this one.
    await setDefaults(page, null);
  }
});

test("a plate in two colours is sliced by ours, each object in its own filament", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // A Bambu Studio project: a white coaster in filament 1, a red one in filament 2.
    const { id, files } = await ideaWithModel(page, "Coasters", "coasters.3mf", twoColourProject());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const file = await fileOf(page, id);
    expect(file.slice.settings.slicer).toBe("spaghetti");
    expect(file.slice.fallback).toBeUndefined();
    expect(file.slice.settings.filaments).toHaveLength(2);
    // The file says which nozzle each of its two filaments prints with, as Orca's does for the printer.
    const sliced = await page.request.get(`/api/files/${file.id}/sliced`);
    expect(sliced.ok()).toBe(true);
    const zip = unzipSync(new Uint8Array(await sliced.body()));
    const info = strFromU8(zip["Metadata/slice_info.config"] ?? new Uint8Array());
    expect(/key="filament_maps" value="([^"]*)"/.exec(info)?.[1]?.split(" ")).toHaveLength(2);
    // Both filaments print: two lines of filament in the plate's description, each with what it uses.
    expect(info.match(/<filament id="/g)).toHaveLength(2);
  } finally {
    await setDefaults(page, null);
  }
});

test("a part that floats is OrcaSlicer's to slice, which warns of it", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // An arm that starts in the air beside its post (as slicing-settings.spec.ts's drying rack).
    const { id, files } = await ideaWithModel(
      page,
      "Drying rack",
      "rack.stl",
      boxesStl([
        { at: [0, 0, 0], size: [36, 36, 4] },
        { at: [12, 12, 4], size: [12, 12, 46] },
        { at: [30, 15, 34], size: [26, 6, 4] },
      ]),
    );
    await expect(files.getByText("Parts of it float in the air.")).toBeVisible({ timeout: SLICED });
    await expect(
      files.getByText("Sliced by OrcaSlicer: our own slicer can't check for floating parts yet"),
    ).toBeVisible();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.fallback, { timeout: SLICED })
      .toEqual({ why: "floating" });
  } finally {
    await setDefaults(page, null);
  }
});
