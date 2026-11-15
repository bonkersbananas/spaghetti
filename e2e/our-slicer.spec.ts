import { expect, type Page, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { bambuStudioProblems } from "../test/unit/slicing/bambu-rules";
import {
  brimProject,
  paintedProject,
  paintedSupportsProject,
  partsProject,
  patternProject,
  raftProject,
  seamProject,
  tPartsProject,
  twoColourProject,
  vaseProject,
} from "./fixtures/model-3mf";
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

/**
 * The file once the server holds its slice: the card shows a slice as soon as the browser made it, and sends it a
 * moment later, so a read straight after the card says so may still find none.
 */
async function sliceOf(page: Page, id: string) {
  let file: Awaited<ReturnType<typeof fileOf>>;
  await expect
    .poll(
      async () => {
        file = await fileOf(page, id);
        return !!file?.slice;
      },
      { timeout: SLICED },
    )
    .toBe(true);
  return file;
}

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
  const orca = (await sliceOf(page, id)).slice;
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
  const ours = (await sliceOf(page, id)).slice;
  expect(ours.settings.rust).toMatch(/^\d+$/);
  expect(ours.fallback).toBeUndefined();
  expect(ours.ms).toBeGreaterThan(0);
  await expect(settings.getByText(/^Sliced in this browser in [\d.]+ s by Spaghetti's own slicer/)).toBeVisible();
  await expect(settings.getByRole("link", { name: "Its source" })).toHaveAttribute(
    "href",
    /releases\/tag\/slicer-rs-v/,
  );
  // The same print: a 20 mm cube is 100 layers by both, and about the same time and weight.
  const after = await sliceOf(page, id);
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

test("ours slices every style of supports; what it can't slice yet, OrcaSlicer's engine slices, and the card says why", async ({
  page,
}) => {
  test.setTimeout(7 * SLICED);
  await signIn(page);
  try {
    // The workspace slices with ours, with slim tree supports where needed: Orca's classic trees, which ours builds
    // since release 9, under the arm, which would fall.
    await setDefaults(page, { slicer: "spaghetti", supports: "where-needed", supportStyle: "tree-slim" });
    const { id, files } = await ideaWithModel(page, "Drying rack", "rack.stl", RACK());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const slim = (await sliceOf(page, id)).slice;
    expect(slim.settings.slicer).toBe("spaghetti");
    expect(slim.settings.slicing.supportStyle).toBe("tree-slim");
    expect(slim.fallback).toBeUndefined();

    // Strong and hybrid trees, the organic trees that are the usual kind, and snug normal supports, which hug the
    // model (since release 7): each sliced by ours.
    await files.getByRole("button", { name: "Slice with…" }).click();
    const settings = page.getByRole("dialog", { name: "How to slice it" });
    await settings.getByRole("button", { name: /^More/ }).click();
    for (const [label, style] of [
      ["Strong tree", "tree-strong"],
      ["Hybrid", "tree-hybrid"],
      ["Tree", "tree"],
      ["Snug", "snug"],
    ] as const) {
      await settings
        .getByRole("group", { name: "How supports are built" })
        .getByRole("button", { name: label, exact: true })
        .click();
      await expect
        .poll(async () => (await fileOf(page, id))?.slice?.settings.slicing.supportStyle, { timeout: SLICED })
        .toBe(style);
      const slice = (await sliceOf(page, id)).slice;
      expect(slice.settings.slicer, style).toBe("spaghetti");
      expect(slice.settings.slicing.supports).toBe("where-needed");
      expect(slice.fallback, style).toBeUndefined();
    }
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible();

    // A project made for the X2D that asks for a raft under hybrid trees, Orca's classic ones, whose rafts ours
    // can't build yet (it builds them under organic trees since release 20): OrcaSlicer's engine slices it.
    const raft = await ideaWithModel(
      page,
      "Block on a raft",
      "raft.3mf",
      raftProject({ enable_support: "1", support_style: "tree_hybrid" }),
    );
    await expect(
      raft.files.getByText("Sliced by OrcaSlicer: our own slicer can't do a raft in this style of tree support yet"),
    ).toBeVisible({ timeout: SLICED });
    const fallback = (await sliceOf(page, raft.id)).slice;
    expect(fallback.settings.slicer).toBe("orca");
    expect(fallback.fallback).toEqual({ why: "unsupported", what: "a raft in this style of tree support" });
    // What was asked for stays: the next slice asks ours again.
    expect(fallback.settings.slicing.slicer).toBe("spaghetti");
  } finally {
    // The worker's database is shared with the specs after this one.
    await setDefaults(page, null);
  }
});

test("an object made of parts in two filaments is sliced by ours, each part in its own", async ({ page }) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // A Bambu Studio project: one coaster, its left half in filament 1 and its right half in filament 2.
    const { id, files } = await ideaWithModel(page, "Two-tone coaster", "two-tone.3mf", partsProject());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const ours = await sliceOf(page, id);
    expect(ours.slice.settings.slicer).toBe("spaghetti");
    expect(ours.slice.fallback).toBeUndefined();
    expect(ours.slice.settings.filaments).toHaveLength(2);
    const slicedFile = async (fileId: string) => {
      const sliced = await page.request.get(`/api/files/${fileId}/sliced`);
      expect(sliced.ok()).toBe(true);
      const zip = unzipSync(new Uint8Array(await sliced.body()));
      return {
        info: strFromU8(zip["Metadata/slice_info.config"] ?? new Uint8Array()),
        gcode: strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array()),
      };
    };
    // Both filaments print, over a prime tower, and the coaster stays one object, with one label to skip it by.
    const ourFile = await slicedFile(ours.id);
    expect(ourFile.info.match(/<filament id="/g)).toHaveLength(2);
    expect(ourFile.info.match(/<object identify_id="/g)).toHaveLength(1);
    expect(ourFile.gcode).toMatch(/^; model label id: 1$/m);
    expect(ourFile.gcode).toContain("; FEATURE: Prime tower");

    // OrcaSlicer's engine, picked under More, prints each half in its own too: the coaster whole, its red half painted.
    await files.getByRole("button", { name: "Slice with…" }).click();
    const settings = page.getByRole("dialog", { name: "How to slice it" });
    await settings.getByRole("button", { name: /^More/ }).click();
    await settings.getByRole("group", { name: "Slicer" }).getByRole("radio", { name: "OrcaSlicer" }).click();
    await expect.poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED }).toBe("orca");
    await page.keyboard.press("Escape");
    const engine = await sliceOf(page, id);
    expect(engine.slice.status).toBe("sliced");
    expect(engine.slice.settings.filaments).toHaveLength(2);
    const engineFile = await slicedFile(engine.id);
    expect(engineFile.info.match(/<filament id="/g)).toHaveLength(2);
    expect(engineFile.info.match(/<object identify_id="/g)).toHaveLength(1);
    expect(engineFile.gcode).toContain("; FEATURE: Prime tower");
    expect([...(toolsByFeature(engineFile.gcode).get("Outer wall") ?? [])].sort()).toEqual(["T0", "T1"]);
  } finally {
    await setDefaults(page, null);
  }
});

test("a 3MF that names its parts' filaments but lists none prints each part in its own", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  // Such a file as other programs write: Bambu's model_settings.config gives the coaster's halves filaments 1 and 2,
  // and no project settings list them. OrcaSlicer's engine (the default) prints the red half in filament 2.
  const { id } = await ideaWithModel(page, "Two-tone coaster", "two-tone.3mf", partsProject({ settings: false }));
  await expect.poll(async () => (await fileOf(page, id))?.slice?.status, { timeout: SLICED }).toBe("sliced");
  const file = await sliceOf(page, id);
  expect(file.slice.settings.slicer).toBe("orca");
  // Filament 2 is a stand-in of filament 1's material, in a colour of its own, until someone picks a spool for it.
  expect(file.slice.settings.filaments).toHaveLength(2);
  const [first, second] = file.slice.settings.slicing.filaments;
  expect(second).toEqual({ material: first.material });
  const sliced = await page.request.get(`/api/files/${file.id}/sliced`);
  const zip = unzipSync(new Uint8Array(await sliced.body()));
  const info = strFromU8(zip["Metadata/slice_info.config"] ?? new Uint8Array());
  const colours = [...info.matchAll(/<filament id="\d+"[^>]*\bcolor="(#[0-9A-Fa-f]{6})/g)].map((match) => match[1]);
  expect(colours).toHaveLength(2);
  expect(new Set(colours).size).toBe(2);
  const gcode = strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array());
  expect(gcode).toContain("; FEATURE: Prime tower");
  expect([...(toolsByFeature(gcode).get("Outer wall") ?? [])].sort()).toEqual(["T0", "T1"]);
});

test("an object made of parts in two filaments gets its supports from ours, each layer's in the filament it starts with", async ({
  page,
}) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  try {
    // A T whose column is half white, half red, its bar white: the arms need supports, which ours left to
    // OrcaSlicer's engine until release 18.
    await setDefaults(page, { slicer: "spaghetti", supports: "where-needed" });
    const { id, files } = await ideaWithModel(page, "Two-tone T", "two-tone-t.3mf", tPartsProject());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const ours = await sliceOf(page, id);
    expect(ours.slice.settings.slicer).toBe("spaghetti");
    expect(ours.slice.fallback).toBeUndefined();
    expect(ours.slice.settings.filaments).toHaveLength(2);
    const sliced = await page.request.get(`/api/files/${ours.id}/sliced`);
    expect(sliced.ok()).toBe(true);
    const gcode = strFromU8(
      unzipSync(new Uint8Array(await sliced.body()))["Metadata/plate_1.gcode"] ?? new Uint8Array(),
    );
    // Supports print under the arms, in no filament of their own: on each layer in the one it starts with, which
    // alternates, so both filaments print some.
    expect([...(toolsByFeature(gcode).get("Support") ?? [])].sort()).toEqual(["T0", "T1"]);
  } finally {
    await setDefaults(page, null);
  }
});

test("a painted project is sliced by ours in its colours, and by OrcaSlicer's engine when it is picked", async ({
  page,
}) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // A Bambu Studio project: a white coaster with a red bow tie painted on its top.
    const { id, files } = await ideaWithModel(page, "Farfalle coaster", "farfalle.3mf", paintedProject());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const ours = await sliceOf(page, id);
    expect(ours.slice.settings.slicer).toBe("spaghetti");
    expect(ours.slice.fallback).toBeUndefined();
    expect(ours.slice.settings.filaments).toHaveLength(2);
    const slicedFile = async (fileId: string) => {
      const sliced = await page.request.get(`/api/files/${fileId}/sliced`);
      expect(sliced.ok()).toBe(true);
      const zip = unzipSync(new Uint8Array(await sliced.body()));
      const info = strFromU8(zip["Metadata/slice_info.config"] ?? new Uint8Array());
      return {
        grams: [...info.matchAll(/<filament id="(\d+)"[^>]*\bused_g="([\d.]+)"/g)].map((match) => Number(match[2])),
        gcode: strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array()),
      };
    };
    // The paint prints: both filaments used, over a prime tower; the bow tie in red on the coaster's top, as Orca's
    // segmentation colours the top shells under paint, its bottom all white.
    const ourFile = await slicedFile(ours.id);
    expect(ourFile.grams).toHaveLength(2);
    for (const grams of ourFile.grams) expect(grams).toBeGreaterThan(0);
    expect(ourFile.gcode).toContain("; FEATURE: Prime tower");
    const tools = toolsByFeature(ourFile.gcode);
    expect([...(tools.get("Top surface") ?? [])].sort()).toEqual(["T0", "T1"]);
    expect([...(tools.get("Bottom surface") ?? [])]).toEqual(["T0"]);

    // OrcaSlicer's engine, picked under More, prints the paint with Orca's own segmentation.
    await files.getByRole("button", { name: "Slice with…" }).click();
    const settings = page.getByRole("dialog", { name: "How to slice it" });
    await settings.getByRole("button", { name: /^More/ }).click();
    await settings.getByRole("group", { name: "Slicer" }).getByRole("radio", { name: "OrcaSlicer" }).click();
    await expect.poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED }).toBe("orca");
    await page.keyboard.press("Escape");
    const engine = await sliceOf(page, id);
    expect(engine.slice.status).toBe("sliced");
    expect(engine.slice.settings.filaments).toHaveLength(2);
    const engineFile = await slicedFile(engine.id);
    expect(engineFile.grams).toHaveLength(2);
    for (const grams of engineFile.grams) expect(grams).toBeGreaterThan(0);
    expect(engineFile.gcode).toContain("; FEATURE: Prime tower");
  } finally {
    await setDefaults(page, null);
  }
});

test("a project's supports painted on are printed by ours, and by OrcaSlicer's engine when it is picked", async ({
  page,
}) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // A T whose slab's underside enforces support, in a project that asks for supports only where painted: ours
    // supports the slab where it is painted, under its two arms (since release 26).
    const { id, files } = await ideaWithModel(page, "Painted T", "painted-t.3mf", paintedSupportsProject());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const ours = await sliceOf(page, id);
    expect(ours.slice.settings.slicer).toBe("spaghetti");
    expect(ours.slice.fallback).toBeUndefined();
    const gcodeOf = async (fileId: string) => {
      const sliced = await page.request.get(`/api/files/${fileId}/sliced`);
      expect(sliced.ok()).toBe(true);
      const zip = unzipSync(new Uint8Array(await sliced.body()));
      return strFromU8(zip["Metadata/plate_1.gcode"] ?? new Uint8Array());
    };
    expect(await gcodeOf(ours.id)).toContain("; FEATURE: Support");

    // OrcaSlicer's engine, picked under More, gets the paint too.
    await files.getByRole("button", { name: "Slice with…" }).click();
    const settings = page.getByRole("dialog", { name: "How to slice it" });
    await settings.getByRole("button", { name: /^More/ }).click();
    await settings.getByRole("group", { name: "Slicer" }).getByRole("radio", { name: "OrcaSlicer" }).click();
    await expect.poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED }).toBe("orca");
    await page.keyboard.press("Escape");
    const engine = await sliceOf(page, id);
    expect(engine.slice.status).toBe("sliced");
    expect(await gcodeOf(engine.id)).toContain("; FEATURE: Support");
  } finally {
    await setDefaults(page, null);
  }
});

/** The tools (T0, T1…) each feature of a G-code extrudes with. */
function toolsByFeature(gcode: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  let tool = "T0";
  let feature = "";
  for (const line of gcode.split("\n")) {
    const change = /^T\d\b/.exec(line);
    if (change) tool = change[0];
    if (line.startsWith("; FEATURE: ")) feature = line.slice("; FEATURE: ".length);
    if (feature && /^G[123] .* E\.?\d/.test(line)) {
      const tools = out.get(feature) ?? new Set<string>();
      tools.add(tool);
      out.set(feature, tools);
    }
  }
  return out;
}

test("a plate in two colours is sliced by ours, each object in its own filament", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    // A Bambu Studio project: a white coaster in filament 1, a red one in filament 2.
    const { id, files } = await ideaWithModel(page, "Coasters", "coasters.3mf", twoColourProject());
    await expect(files.getByText("Sliced by Spaghetti's own slicer")).toBeVisible({ timeout: SLICED });
    const file = await sliceOf(page, id);
    expect(file.slice.settings.slicer).toBe("spaghetti");
    expect(file.slice.fallback).toBeUndefined();
    expect(file.slice.settings.filaments).toHaveLength(2);
    // The file says which nozzle each of its two filaments prints with, as Orca's does for the printer.
    const sliced = await page.request.get(`/api/files/${file.id}/sliced`);
    expect(sliced.ok()).toBe(true);
    // What Bambu Studio's own reader needs of a sliced file, from its source (test/unit/slicing/bambu-rules.ts).
    expect(bambuStudioProblems(new Uint8Array(await sliced.body()))).toEqual([]);
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
    const file = await sliceOf(page, id);
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
    const floating = (await sliceOf(page, id)).slice;
    expect(floating.fallback).toBeUndefined();
    expect(floating.cautions).toEqual(["floating"]);

    // Its one suggestion: supports where needed, which ours builds (trees), and the caution goes.
    await files.getByRole("button", { name: "Supports where needed" }).click();
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicing?.supports, { timeout: SLICED })
      .toBe("where-needed");
    const held = (await sliceOf(page, id)).slice;
    expect(held.settings.slicer).toBe("spaghetti");
    expect(held.fallback).toBeUndefined();
    expect(held.cautions).toBeUndefined();
    await expect(files.getByText("Parts of it float in the air.")).toBeHidden();
  } finally {
    await setDefaults(page, null);
  }
});

test("a project's triangles, tri-hexagon or quarter cubic infill is sliced by ours as Orca draws it", async ({
  page,
}) => {
  test.setTimeout(4 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    for (const pattern of ["triangles", "tri-hexagon", "quartercubic"]) {
      const { id } = await ideaWithModel(page, `Block in ${pattern}`, `${pattern}.3mf`, patternProject(pattern));
      await expect
        .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
        .toBe("spaghetti");
      const slice = (await sliceOf(page, id)).slice;
      expect(slice.settings.slicing.pattern, pattern).toBe(pattern);
      expect(slice.fallback, pattern).toBeUndefined();
      // Until release 11 ours printed these as straight lines, and said so: "triangles sparse infill printed as
      // straight lines".
      expect(slice.notes ?? [], pattern).toEqual([]);
    }
  } finally {
    await setDefaults(page, null);
  }
});

test("a project in spiral vase mode is sliced by ours", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    const { id } = await ideaWithModel(page, "Block vase", "vase.3mf", vaseProject());
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
      .toBe("spaghetti");
    const slice = (await sliceOf(page, id)).slice;
    // Until release 12 ours refused it, and Orca's engine sliced it: { why: "unsupported", what: "spiral vase mode" }.
    expect(slice.fallback).toBeUndefined();
    expect(slice.notes ?? []).toEqual([]);
  } finally {
    await setDefaults(page, null);
  }
});

test("a project on a raft is sliced by ours, with supports off, normal ones or organic trees", async ({ page }) => {
  test.setTimeout(4 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    for (const [label, settings] of [
      ["supports off", {}],
      ["normal supports", { enable_support: "1", support_type: "normal(auto)" }],
      // The X2D's own supports: organic trees, which stand on the plate through the raft (since release 20).
      ["organic trees", { enable_support: "1" }],
    ] as const) {
      const { id } = await ideaWithModel(page, `Block on a raft, ${label}`, "raft.3mf", raftProject(settings));
      await expect
        .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
        .toBe("spaghetti");
      const slice = (await sliceOf(page, id)).slice;
      // Until release 17 ours refused it, and Orca's engine sliced it: { why: "unsupported", what: "a raft" }.
      expect(slice.fallback, label).toBeUndefined();
      expect(slice.notes ?? [], label).toEqual([]);
    }
  } finally {
    await setDefaults(page, null);
  }
});

test("a project's brim ears or brim inside holes is sliced by ours", async ({ page }) => {
  test.setTimeout(4 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    for (const brim of ["brim_ears", "outer_and_inner", "inner_only"]) {
      const { id } = await ideaWithModel(page, `Block with ${brim}`, `${brim}.3mf`, brimProject(brim));
      await expect
        .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
        .toBe("spaghetti");
      const slice = (await sliceOf(page, id)).slice;
      // Until release 14 ours refused them, and Orca's engine sliced them: { why: "unsupported", what: "brim ears" }.
      expect(slice.fallback, brim).toBeUndefined();
      expect(slice.notes ?? [], brim).toEqual([]);
    }
  } finally {
    await setDefaults(page, null);
  }
});

test("a project's nearest seams are sliced by ours as aligned ones, which it notes", async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  try {
    await setDefaults(page, { slicer: "spaghetti" });
    const { id } = await ideaWithModel(page, "Block, nearest seams", "nearest.3mf", seamProject("nearest"));
    await expect
      .poll(async () => (await fileOf(page, id))?.slice?.settings.slicer, { timeout: SLICED })
      .toBe("spaghetti");
    const slice = (await sliceOf(page, id)).slice;
    expect(slice.fallback).toBeUndefined();
    // Until release 13 ours started every wall at the back, whatever the project asked for, and said nothing; now it
    // places Orca's aligned seams.
    expect(slice.notes ?? []).toEqual(["nearest seams placed as aligned ones"]);
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
    const slice = (await sliceOf(page, id)).slice;
    // The Pantry's likeliest spool is the filament: a PLA another spec left behind would come before this PETG.
    expect(slice.settings.filaments, "the Pantry holds only this test's PETG spool").toEqual([
      expect.stringMatching(/^Generic PETG @/),
    ]);
    expect(slice.fallback).toBeUndefined();
    // Until release 6 ours lifted in spirals instead, and said so: "Auto Lift printed as spiral lifts".
    expect(slice.notes ?? []).toEqual([]);
  } finally {
    await page.request.delete(`/api/spools/${spool}`, { headers });
    await setDefaults(page, null);
  }
});
