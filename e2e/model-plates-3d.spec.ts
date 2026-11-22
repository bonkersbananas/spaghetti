import { expect, type Page, test } from "@playwright/test";
import { platesProject } from "./fixtures/model-3mf";
import { clearIdeas, signIn } from "./helpers";

// A project's later plate sliced here opens in 3D: Spaghetti's slice of plate 2 of a project is a file of one plate
// (Metadata/plate_1.gcode), which the view once asked for plate 2's G-code and said was "saved before slicing".
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const SLICED = 60_000;
const NAME = "bin-pair.3mf";

const fileOf = async (page: Page, id: string) =>
  (await (await page.request.get(`/api/items/${id}`)).json()).item.files?.[0];

/** An idea with a two-plate project on it, its first plate sliced and kept. */
async function slicedProject(page: Page) {
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Bin pair", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: NAME,
    mimeType: "model/3mf",
    // Two low bins, a plate each: quick to slice.
    buffer: Buffer.from(platesProject(2, [6, 10])),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect.poll(async () => (await fileOf(page, id))?.slice?.status, { timeout: SLICED }).toBe("sliced");
  return { id, files };
}

test("plate 2 of a project, sliced here, shows its toolpaths in 3D, also when the view was opened mid-slice", {
  tag: "@phone",
}, async ({ page }) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  const { id, files } = await slicedProject(page);
  expect((await fileOf(page, id)).plate).toBe(1);

  // The engine is held, so the view is opened while plate 2 is being sliced.
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/slicer/*/engine-st.wasm", async (route) => {
    await held;
    await route.fallback();
  });

  await files.getByRole("button", { name: /^Slice with…/ }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  await settings.getByRole("radio", { name: /^Plate 2/ }).click({ force: true });
  await expect(settings.getByRole("progressbar", { name: "Slicing" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // Mid-slice: the last slice's toolpaths, and the view says a new one is coming.
  await files.getByRole("button", { name: `See ${NAME} in 3D` }).click();
  const viewer = page.getByRole("dialog", { name: "3D view" });
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByRole("status")).toHaveText(/^Slicing it again/);

  // Done: the view reads the new slice by itself, plate 2's, and draws it.
  release();
  await expect(viewer.getByRole("status")).toBeHidden({ timeout: SLICED });
  await expect.poll(async () => (await fileOf(page, id))?.plate, { timeout: SLICED }).toBe(2);
  await expect(viewer.getByText(`${NAME}, plate 2`)).toBeVisible();
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText(/no toolpaths|before slicing|Couldn't read/)).toHaveCount(0);

  // Opened again after the slice (what a person did): still plate 2's toolpaths.
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await page.reload();
  await files.getByRole("button", { name: `See ${NAME} in 3D` }).click();
  await expect(viewer.getByText(`${NAME}, plate 2`)).toBeVisible();
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.locator("[data-viewer=error]")).toHaveCount(0);
});
