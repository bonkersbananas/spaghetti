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

/** A drying rack: a base, a post, and an arm that starts in the air beside the post (it needs supports). */
const RACK = () =>
  boxesStl([
    { at: [0, 0, 0], size: [36, 36, 4] },
    { at: [12, 12, 4], size: [12, 12, 46] },
    { at: [30, 15, 34], size: [26, 6, 4] },
  ]);

test("ours slices tree and snug supports; what it can't slice yet, OrcaSlicer's engine slices, and the card says why", async ({
  page,
}) => {
  test.setTimeout(4 * SLICED);
  await signIn(page);
  try {
    // The workspace slices with ours, with slim tree supports where needed, which ours can't build yet.
    await setDefaults(page, { slicer: "spaghetti", supports: "where-needed", supportStyle: "tree-slim" });
    const { id, files } = await ideaWithModel(page, "Drying rack", "rack.stl", RACK());
    await expect(files.getByText("Sliced by OrcaSlicer: our own slicer can't do slim tree supports yet")).toBeVisible({
      timeout: SLICED,
    });
    await expect.poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED }).toBe("orca");
    const slice = (await fileOf(page, id)).slice;
    expect(slice.fallback).toEqual({ why: "unsupported", what: "slim tree supports" });
    // What was asked for stays: the next slice asks ours again.
    expect(slice.settings.slicing.slicer).toBe("spaghetti");

    // Tree supports, the usual kind, ours builds: under the arm, which would fall.
    await files.getByRole("button", { name: "Slice with…" }).click();
    const settings = page.getByRole("dialog", { name: "How to slice it" });
    await settings.getByRole("button", { name: /^More/ }).click();
    await settings
      .getByRole("group", { name: "How supports are built" })
      .getByRole("button", { name: "Tree", exact: true })
      .click();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
      .toBe("spaghetti");
    const trees = (await fileOf(page, id)).slice;
    expect(trees.settings.slicing.supportStyle).toBe("tree");
    expect(trees.settings.slicing.supports).toBe("where-needed");
    expect(trees.fallback).toBeUndefined();

    // Snug normal supports, which hug the model, ours builds too (since release 7).
    await settings
      .getByRole("group", { name: "How supports are built" })
      .getByRole("button", { name: "Snug", exact: true })
      .click();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicing.supportStyle, { timeout: SLICED })
      .toBe("snug");
    const snug = (await fileOf(page, id)).slice;
    expect(snug.settings.slicer).toBe("spaghetti");
    expect(snug.fallback).toBeUndefined();
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
    // The prime tower's walls are arcs where they curve, as Orca writes them (since release 8).
    const gcode = strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array());
    const tower = gcode
      .split("; FEATURE: Prime tower")
      .slice(1)
      .map((part) => part.split("; FEATURE:")[0])
      .join("\n");
    expect(tower).toMatch(/^G[23] +X[\d.]+ +Y[\d.]+ +I-?[\d.]+ +J-?[\d.]+ +E/m);
  } finally {
    await setDefaults(page, null);
  }
});

/** A beam on two pillars: its middle spans the air between them, a bridge. */
const BEAM = () =>
  boxesStl([
    { at: [0, 0, 0], size: [6, 6, 8] },
    { at: [20, 0, 0], size: [6, 6, 8] },
    { at: [0, 0, 8], size: [26, 6, 2] },
  ]);

test("with a 0.2 mm as the main nozzle, ours slices with its presets, bridges with the plastic they ask for", async ({
  page,
}) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const fitMain = async (main: number) => {
    const response = await page.request.put("/api/printer", {
      headers: { Origin: new URL(page.url()).origin },
      data: { nozzles: { main: { diameter: main, hardened: true }, auxiliary: { diameter: 0.4, hardened: true } } },
    });
    expect(response.ok()).toBe(true);
  };
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    await fitMain(0.2);
    const { id, files } = await ideaWithModel(page, "Beam", "beam.stl", BEAM());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const file = await fileOf(page, id);
    expect(file.slice.settings.slicer).toBe("spaghetti");
    expect(file.slice.fallback).toBeUndefined();
    const sliced = await page.request.get(`/api/files/${file.id}/sliced`);
    expect(sliced.ok()).toBe(true);
    const zip = unzipSync(new Uint8Array(await sliced.body()));
    const gcode = strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array());
    // Bambu's 0.2 mm Standard: 0.10 mm layers of 0.22 mm lines.
    expect(gcode).toMatch(/^; nozzle_diameter = 0\.2$/m);
    expect(gcode).toMatch(/^; layer_height = 0\.1$/m);
    expect(gcode).toContain("\n; LINE_WIDTH: 0.22\n");
    // Its presets lay a bridge with half as much plastic again (bridge_flow 1.5), as Orca does: a flat line at the
    // same spacing, 0.15 mm high.
    expect(gcode).toContain("\n; FEATURE: Bridge\n; LINE_WIDTH: 0.21073\n; LAYER_HEIGHT: 0.15\n");
  } finally {
    await fitMain(0.4);
    await setDefaults(page, null);
  }
});

test("a part that floats is sliced by ours, which warns of it as OrcaSlicer's engine does", async ({ page }) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // Without supports, its arm would print in the air (as slicing-settings.spec.ts's drying rack): ours slices it
    // and warns of it (release 6), as Orca's engine did when it stepped in for that.
    const { id, files } = await ideaWithModel(page, "Drying rack", "rack.stl", RACK());
    await expect(files.getByText("Parts of it float in the air.")).toBeVisible({ timeout: SLICED });
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
      .toBe("spaghetti");
    const floating = (await fileOf(page, id)).slice;
    expect(floating.fallback).toBeUndefined();
    expect(floating.cautions).toEqual(["floating"]);

    // Its one suggestion: supports where needed, which ours builds (trees), and the caution goes.
    await files.getByRole("button", { name: "Supports where needed" }).click();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicing?.supports, { timeout: SLICED })
      .toBe("where-needed");
    const held = (await fileOf(page, id)).slice;
    expect(held.settings.slicer).toBe("spaghetti");
    expect(held.fallback).toBeUndefined();
    expect(held.cautions).toBeUndefined();
    await expect(files.getByText("Parts of it float in the air.")).toBeHidden();
  } finally {
    await setDefaults(page, null);
  }
});

test("a generic filament slices with ours, which lifts the nozzle as Orca's Auto Lift does", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const headers = { Origin: new URL(page.url()).origin };
  const spool = crypto.randomUUID();
  try {
    // The Pantry's one spool is PETG, which slices with Orca's Generic PETG: it lifts the nozzle with Auto Lift.
    await page.request.post("/api/spools", {
      headers,
      data: { id: spool, material: "PETG", colorName: "Teal", colorHex: "#2a8a85" },
    });
    await setDefaults(page, { slicer: "spaghetti" });
    const { id } = await ideaWithModel(page, "Cube", "cube.stl", boxStl(20));
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
      .toBe("spaghetti");
    const slice = (await fileOf(page, id)).slice;
    expect(slice.settings.filaments).toEqual([expect.stringMatching(/^Generic PETG @/)]);
    expect(slice.fallback).toBeUndefined();
    // Until release 6 ours lifted in spirals instead, and said so: "Auto Lift printed as spiral lifts".
    expect(slice.notes ?? []).toEqual([]);
  } finally {
    await page.request.delete(`/api/spools/${spool}`, { headers });
    await setDefaults(page, null);
  }
});
