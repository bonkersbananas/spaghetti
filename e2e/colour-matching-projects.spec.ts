import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { makerworldProject } from "./fixtures/model-3mf";
import { clearIdeas, signIn } from "./helpers";

// A Bambu Studio or Orca project in several filaments (MakerWorld's files): each of its filaments is matched to a
// spool from the Pantry, listed in "Slice with…" beside the model's colours of any other file, and the choice is kept.
// The spools a test puts in the Pantry go again after it: other specs on the same worker expect a Pantry without them
// (with this red PLA left in, a model nobody set up slices with it, whatever spool a later test adds).
const spools: string[] = [];
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of spools.splice(0)) await page.request.delete(`/api/spools/${id}`, { headers });
});

const SLICED = 60_000;

test("a project's filaments are each matched to a spool, can be changed, and the slice follows", async ({ page }) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  const origin = new URL(page.url()).origin;
  // A pantry with a red PLA and a black PETG, and nothing near the white or the yellow.
  for (const spool of [
    { id: crypto.randomUUID(), material: "PLA", brand: "Bambu", colorName: "Red", colorHex: "#c0392b" },
    { id: crypto.randomUUID(), material: "PETG", brand: "Bambu", colorName: "Black", colorHex: "#111111" },
  ]) {
    const made = await page.request.post("/api/spools", { headers: { Origin: origin }, data: spool });
    expect(made.ok()).toBe(true);
    spools.push(spool.id);
  }
  const id = crypto.randomUUID();
  await page.request.post("/api/items", { headers: { Origin: origin }, data: { id, title: "Plaque", note: "" } });
  await page.goto(`/ideas/${id}`);
  await page
    .getByTestId("idea-file-input")
    .setInputFiles({ name: "plaque.3mf", mimeType: "model/3mf", buffer: Buffer.from(makerworldProject()) });
  const fileOf = async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.files?.[0];
  await expect.poll(async () => (await fileOf())?.slice?.status, { timeout: SLICED }).toBe("sliced");

  // Four filaments, in the project's order: the red and black match the Pantry's, the others are stand-ins.
  const slice = (await fileOf()).slice;
  expect(slice.colours.map((row: { slot: number }) => row.slot)).toEqual([1, 2, 3, 4]);
  expect(slice.colours.map((row: { inPantry: boolean }) => row.inPantry)).toEqual([false, true, true, false]);
  expect(slice.settings.filaments).toHaveLength(4);
  expect(slice.originalPicture).toBe(true);
  const zip = unzipSync(
    new Uint8Array(await (await page.request.get(`/api/files/${(await fileOf()).id}/sliced`)).body()),
  );
  const info = strFromU8(zip["Metadata/slice_info.config"] ?? new Uint8Array());
  expect(info).toContain('type="PETG"');

  const files = page.getByRole("region", { name: /^Files/ });
  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  const summary = settings.getByRole("button", { name: /^Colours/ });
  await expect(summary).toContainText("4 filaments on 4 spools");
  await summary.click();
  const first = settings.getByRole("button", { name: /Filament 1/ });
  await expect(first).toContainText("Not in the Pantry yet");
  await first.click();
  await expect(settings.getByRole("radio", { name: /Filament 1/ })).toBeChecked();
  // One tap on a spool of the Pantry: the slice is made again with it, and the choice is kept with the model.
  await settings.getByRole("radio", { name: /^Red/ }).click();
  await expect.poll(async () => (await fileOf())?.slicing?.colours?.[0]?.from, { timeout: SLICED }).toBe("f1");
  await expect.poll(async () => (await fileOf())?.slice?.colours?.[0]?.chosen, { timeout: SLICED }).toBe(true);
  expect((await fileOf()).slice.colours[0].filament.colorName).toBe("Red");
});
