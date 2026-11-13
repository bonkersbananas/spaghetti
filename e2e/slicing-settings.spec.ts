import { expect, type Page, test } from "@playwright/test";
import { boxesStl, boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn, smallTargets } from "./helpers";

// A model's slicing settings (decision 0047): changed on its card ("Slice with…": a popover on desktop, a sheet on
// phones), kept on the model, sliced again in the background with the slice there kept until the new one is ready,
// and undone in one tap.
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const SLICED = 60_000;

/** An idea with a 20 mm cube sliced on it; returns its id and the files' region. */
async function slicedCube(page: Page) {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Cube", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "cube.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(20)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  // Sliced: the card says how ("Slice with…" is there while it slices too).
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  return { id, files };
}

const fileOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/items/${id}`)).json()).item.files?.[0];

test("changing a model's quality slices it again in the background, says what changed, undoes, and keeps it after a reload", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const { id, files } = await slicedCube(page);
  await expect.poll(async () => (await fileOf(page, id))?.slice?.status, { timeout: SLICED }).toBe("sliced");
  const before: number = (await fileOf(page, id)).prefill.estimatedMinutes;

  // The engine is held, so the slice there is seen to stay while the new one is made.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/slicer/*/engine-st.wasm", async (route) => {
    await held;
    await route.fallback();
  });

  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  const quality = settings.getByRole("group", { name: "Quality" });
  // Where the result shows: at the foot of a phone's sheet, which covers the card; on desktop the card itself, which
  // the popover hangs below.
  const result = isMobile ? settings : files;
  await expect(quality.getByRole("radio", { name: /^Standard/ })).toBeChecked();
  if (isMobile) {
    // Every control in the sheet, More's too, has a thumb's target.
    await settings.getByRole("button", { name: /^More/ }).click();
    await expect(settings.getByRole("group", { name: "How supports are built" })).toBeVisible();
    expect(await smallTargets(page, "[role=dialog]")).toEqual([]);
  }
  await quality.getByRole("radio", { name: /^Extra draft/ }).click();
  await expect(quality.getByRole("radio", { name: /^Extra draft/ })).toBeChecked();
  await expect(settings.getByText("Extra draft · quickest, roughest")).toBeVisible();
  // Slicing again, the slice there and what it said stay.
  await expect(result.getByRole("progressbar", { name: "Slicing" })).toHaveAttribute(
    "aria-valuetext",
    /^Slicing with Extra draft/,
  );
  await expect(result.getByText(`About ${before} min`)).toBeVisible();
  // The model keeps the settings at once, before its slice is made.
  await expect.poll(async () => (await fileOf(page, id))?.slicing?.layerHeight).toBe(0.28);

  release();
  // Sliced: what the change did, and its undo.
  const undo = result.getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible({ timeout: SLICED });
  const after = await fileOf(page, id);
  expect(after.slice.settings.slicing.layerHeight).toBe(0.28);
  expect(after.previous.prefill.estimatedMinutes).toBe(before);
  expect(after.prefill.estimatedMinutes).toBeLessThan(before);
  await expect(result.getByText(`${before} min`, { exact: true })).toBeVisible();
  await expect(result.getByText(`${after.prefill.estimatedMinutes} min`, { exact: true })).toBeVisible();

  // Undone: the slice before comes back, settings and all, and nothing more to undo. (On desktop the popover stays
  // open while its card is used.)
  await undo.click();
  await expect(quality.getByRole("radio", { name: /^Standard/ })).toBeChecked();
  await expect(result.getByText(`About ${before} min`)).toBeVisible();
  await expect
    .poll(async () => {
      const file = await fileOf(page, id);
      return [file?.slicing?.layerHeight, file?.slice?.settings.slicing.layerHeight, file?.previous];
    })
    .toEqual([0.2, 0.2, null]);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // After a reload it is as it was left.
  await page.reload();
  await expect(files.getByText(`About ${before} min`)).toBeVisible();
  // (Each piece of the card's line carries its dot: it is matched at its end.)
  await expect(files.getByText(/Standard quality$/)).toBeVisible();
  await files.getByRole("button", { name: "Slice with…" }).click();
  await expect(quality.getByRole("radio", { name: /^Standard/ })).toBeChecked();
});

test("a part that floats: its caution offers supports where needed in one tap, and it is sliced with them", async ({
  page,
}) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Drying rack", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  // An arm that starts in the air beside its post (scripts/screenshot-routes.ts RACK).
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "rack.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(
      boxesStl([
        { at: [0, 0, 0], size: [36, 36, 4] },
        { at: [12, 12, 4], size: [12, 12, 46] },
        { at: [30, 15, 34], size: [26, 6, 4] },
      ]),
    ),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("Parts of it float in the air.")).toBeVisible({ timeout: SLICED });

  // The settings say what helps, where supports are picked.
  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  await expect(settings.getByText(/^Parts of it float in the air: Where needed holds them up\.$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await files.getByRole("button", { name: "Supports where needed" }).click();
  await expect(files.getByText(/supports where needed$/)).toBeVisible({ timeout: SLICED });
  await expect(files.getByText("Parts of it float in the air.")).toBeHidden();
  await expect(files.getByRole("button", { name: "Undo" })).toBeVisible();
  expect((await fileOf(page, id)).slice.settings.slicing.supports).toBe("where-needed");
});

test("lay it down: a block can be sliced on another face, the card says so, and the original stays as it was", async ({
  page,
}) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Block", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "block.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(20, 30, 40)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  await expect.poll(async () => (await fileOf(page, id))?.slice?.status, { timeout: SLICED }).toBe("sliced");
  const original: number = (await fileOf(page, id)).size;

  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  // Found in the background: as designed first and picked, then the five other faces of a block.
  const lay = settings.getByRole("group", { name: "Lay it down" });
  await expect(lay.getByRole("radio")).toHaveCount(6);
  await expect(lay.getByRole("radio").first()).toBeChecked();
  await expect(lay.getByRole("radio", { name: /^As designed/ })).toBeChecked();
  await lay.getByRole("radio", { name: /^On side 1/ }).click();
  await expect(lay.getByRole("radio", { name: /^On side 1/ })).toBeChecked();
  await expect.poll(async () => (await fileOf(page, id))?.slicing?.orientation).not.toBeNull();
  await expect
    .poll(async () => (await fileOf(page, id))?.slice?.settings.slicing.orientation, { timeout: SLICED })
    .not.toBeNull();
  await expect(files.getByText(/on its side$/)).toBeVisible({ timeout: SLICED });
  expect((await fileOf(page, id)).size).toBe(original);

  // Back to as designed: one tap.
  await lay.getByRole("radio", { name: /^As designed/ }).click();
  await expect.poll(async () => (await fileOf(page, id))?.slicing?.orientation).toBeNull();
});

test("fins: the drying rack is sliced with breakaway fins built into it, and nothing floats any more", async ({
  page,
}) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Drying rack", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "rack.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(
      boxesStl([
        { at: [0, 0, 0], size: [36, 36, 4] },
        { at: [12, 12, 4], size: [12, 12, 46] },
        { at: [30, 15, 34], size: [26, 6, 4] },
      ]),
    ),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("Parts of it float in the air.")).toBeVisible({ timeout: SLICED });
  await expect.poll(async () => (await fileOf(page, id))?.slice?.status, { timeout: SLICED }).toBe("sliced");
  const plain = (await fileOf(page, id)).prefill.weightGrams as number;

  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  const supports = settings.getByRole("group", { name: "Supports" });
  await expect(supports.getByRole("radio", { name: /^Fins/ })).toBeVisible();
  await supports.getByRole("radio", { name: /^Fins/ }).click();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  await expect(files.getByText(/fins$/)).toBeVisible({ timeout: SLICED });
  await expect(files.getByText("Parts of it float in the air.")).toBeHidden();
  await expect
    .poll(async () => (await fileOf(page, id))?.slice?.settings.slicing.supports, { timeout: SLICED })
    .toBe("fins");
  const after = await fileOf(page, id);
  // The object grew: the fins are printed with it.
  expect(after.prefill.weightGrams).toBeGreaterThan(plain);
  expect(after.slice.cautions ?? []).toEqual([]);
});
