import { expect, type Page, test } from "@playwright/test";
import { TUGBOAT_FILE_NAME, tugboatFile } from "./fixtures/gcode-tugboat";
import { clearIdeas, signIn } from "./helpers";

// Leave nothing behind: other specs (the week, the journal) count every build on this server.
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

/** A build whose one attempt carries the tugboat's sliced file (317 layers of real G-code). */
async function buildWithTugboat(page: Page, printing = false): Promise<string> {
  return page.evaluate(
    async ({ name, bytes, printing }) => {
      const json = { "Content-Type": "application/json" };
      const itemId = crypto.randomUUID();
      await fetch("/api/items", {
        method: "POST",
        headers: json,
        body: JSON.stringify({ id: itemId, note: "Tugboat" }),
      });
      const attemptId = crypto.randomUUID();
      await fetch(`/api/items/${itemId}/attempts`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({
          id: attemptId,
          ...(printing ? {} : { outcome: "success" }),
          printedAt: Date.now() - 3600_000,
          settings: {},
        }),
      });
      const form = new FormData();
      form.set("id", crypto.randomUUID());
      form.set("name", name);
      form.set("size", String(bytes.length));
      form.set("plate", "1");
      form.set("plateCount", "1");
      form.set("slicer", "BambuStudio 02.01.00.00");
      form.set("prefill", JSON.stringify({ estimatedMinutes: 200 }));
      form.set("objects", JSON.stringify(["Tugboat"]));
      form.set("file", new Blob([new Uint8Array(bytes)]), name);
      const response = await fetch(`/api/attempts/${attemptId}/file`, { method: "PUT", body: form });
      if (!response.ok) throw new Error(`file upload ${response.status}`);
      return itemId;
    },
    { name: TUGBOAT_FILE_NAME, bytes: Array.from(tugboatFile()), printing },
  );
}

test("opens the 3D view of a sliced file, scrubs its layers and closes with Escape", async ({ page }) => {
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  await page.goto(`/builds/${itemId}`);
  await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  // The file is read in a worker and the first open builds the print up: wait until it is whole.
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Layer 317 of 317")).toBeVisible();
  await expect(dialog.getByText(/^PLA \d$/)).toHaveCount(2);

  // The slider scrubs, and says how high that is.
  const slider = dialog.getByRole("slider", { name: "Layer" });
  await slider.fill("99");
  await expect(dialog.getByText(/^Layer 100 of 317 · 12 mm/)).toBeVisible();

  // The arrow keys step from anywhere in the viewer (here from the replay button).
  await dialog.getByRole("button", { name: "Build it up again" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(/^Layer 101 of 317/)).toBeVisible();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(dialog.getByText(/^Layer 91 of 317/)).toBeVisible();
  await page.keyboard.press("End");
  await expect(dialog.getByText("Layer 317 of 317")).toBeVisible();

  // Colouring by feature says what the colours are.
  await dialog.getByRole("radio", { name: "Feature" }).check({ force: true });
  await expect(dialog.getByText("Outer wall")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a file with no G-code says so instead of drawing nothing", async ({ page }) => {
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  await page.route(/\/api\/files\/[^/]+$/, async (route) => {
    // A sliced file's bytes that are really a project file: a zip with no plate G-code.
    await route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.concat([Buffer.from("PK\x05\x06"), Buffer.alloc(18)]),
    });
  });
  await page.goto(`/builds/${itemId}`);
  await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
  await expect(page.getByRole("dialog", { name: "3D view" }).getByText(/no G-code|Could not read/)).toBeVisible({
    timeout: 20_000,
  });
});

test("when the viewer's code can't be fetched, the sheet says so and the page stays", async ({ page }) => {
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  await page.goto(`/builds/${itemId}`);
  await page.route(/PrintViewer/, (route) => route.abort());
  await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await expect(dialog.getByText(/needs a connection/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("while the attempt prints, the viewer says where the printer is and shows the whole file", async ({ page }) => {
  await signIn(page);
  const itemId = await buildWithTugboat(page, true);
  const origin = new URL(page.url()).origin;
  const { item } = await (await page.request.get(`/api/items/${itemId}`)).json();
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin },
    data: {
      printerState: "printing",
      progress: { attemptId: item.attempts[0].id, percent: 38, remainingMinutes: 120, layer: 120, totalLayers: 317 },
    },
  });
  await page.goto(`/builds/${itemId}`);
  await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await expect(dialog.getByText("Printing now · layer 120 of 317")).toBeVisible({ timeout: 20_000 });
  // No build-up for a print in progress: the slider is at the end at once, and the layers past 120 are the ghost.
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText(/^Layer 317 of 317/)).toBeVisible();
  // The printer moves on: the sheet's words follow (the change feed brings it).
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: origin },
    data: {
      printerState: "printing",
      progress: { attemptId: item.attempts[0].id, percent: 40, remainingMinutes: 115, layer: 126, totalLayers: 317 },
    },
  });
  await expect(dialog.getByText("Printing now · layer 126 of 317")).toBeVisible({ timeout: 25_000 });
  await page.request.put("/api/printer/bridge", { headers: { Origin: origin }, data: { progress: null } });
});
