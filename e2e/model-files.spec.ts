import { expect, type Page, test } from "@playwright/test";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

// Slicing an .stl in the browser with OrcaSlicer's engine (decision 0046): the engine (11 MB of WebAssembly) loads
// on first use, so the first slice of a run waits for it.
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const SLICED = 60_000;

async function ideaWith(page: Page, title: string) {
  const id = crypto.randomUUID();
  const response = await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title, note: "" },
  });
  expect(response.ok()).toBe(true);
  await page.goto(`/ideas/${id}`);
  return id;
}

test("an .stl kept with an idea is sliced in the browser, kept beside its original, and opens in 3D", {
  tag: "@phone",
}, async ({ page, isMobile }) => {
  await signIn(page);
  await ideaWith(page, "Cube");
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "cube.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(20)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("cube.stl")).toBeVisible();
  const line = files.getByRole("button", { name: /Sliced by Spaghetti, 0\.20 mm, PLA/ });
  await expect(line).toBeVisible({ timeout: SLICED });
  await expect(files.getByText(/est\. /)).toBeVisible();
  await expect(files.getByRole("link", { name: "Download cube.gcode.3mf" })).toHaveAttribute("href", /\/sliced$/);

  // It is on the server: after a reload it is still sliced, and the sliced file is a .gcode.3mf.
  await page.reload();
  await expect(line).toBeVisible();
  const href = await files.getByRole("link", { name: "Download cube.gcode.3mf" }).getAttribute("href");
  const sliced = await page.request.get(href ?? "");
  expect(sliced.headers()["content-disposition"]).toContain("cube.gcode.3mf");

  // How it was sliced, with the engine's source.
  await line.click();
  const details = isMobile ? page.getByRole("dialog", { name: "Sliced by Spaghetti" }) : page.getByRole("dialog");
  await expect(details.getByText("Bambu Lab X2D, 0.4 mm nozzle")).toBeVisible();
  await expect(details.getByText("Textured PEI")).toBeVisible();
  await expect(details.getByRole("link", { name: "Its source" })).toHaveAttribute("href", /releases\/tag\/slicer-v/);
  await expect(details.getByRole("link", { name: "Download the original" })).toHaveAttribute(
    "href",
    /\/api\/files\/[^/]+$/,
  );
  await page.keyboard.press("Escape");

  await files.getByRole("button", { name: "See cube.stl in 3D" }).click();
  const viewer = page.getByRole("dialog", { name: "3D view" });
  await expect(viewer.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText(/Layer \d+ of 100/)).toBeVisible();
});

test("a model too big for the plate says so, and is sliced scaled to fit", async ({ page }) => {
  await signIn(page);
  await ideaWith(page, "Big cube");
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "big.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(400, 40, 20)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText("Too big for the plate: 400 mm wide, the X2D takes 256.")).toBeVisible({
    timeout: SLICED,
  });
  await files.getByRole("button", { name: "Scale to 61% and slice" }).click();
  await expect(files.getByRole("button", { name: /Sliced by Spaghetti, 0\.20 mm, PLA, 61%/ })).toBeVisible({
    timeout: SLICED,
  });
  // The original stays as it was.
  await expect(files.getByText("big.stl")).toBeVisible();
});

test("an .stl dropped in the attempt sheet is sliced there, fills in the attempt, and its slice follows it", async ({
  page,
}) => {
  await signIn(page);
  const id = crypto.randomUUID();
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.post("/api/items", { headers, data: { id, title: "Cube", stage: "building" } });
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await page.getByTestId("slicer-file-input").setInputFiles({
    name: "cube.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(20)),
  });
  await expect(sheet.getByText("cube.stl")).toBeVisible();
  await expect(sheet.getByText("Sliced by Spaghetti")).toBeVisible({
    timeout: SLICED,
  });
  // What the slice says is now the attempt's, as a dropped .gcode.3mf would be.
  await expect(sheet.getByText(/est\. /)).toBeVisible();
  await sheet.getByRole("button", { name: "Still printing" }).click();
  await expect(sheet).toBeHidden();

  // The model goes with the attempt, and its sliced file follows once the attempt is on the server.
  await expect
    .poll(
      async () => {
        const item = await (await page.request.get(`/api/items/${id}`)).json();
        const file = item.item.attempts[0]?.file;
        return [file?.kind, file?.slice?.status, file?.prefill?.estimatedMinutes !== undefined];
      },
      { timeout: SLICED },
    )
    .toEqual(["model", "sliced", true]);
  await page.reload();
  await expect(page.getByRole("button", { name: "See cube.stl in 3D" })).toBeVisible();
});
