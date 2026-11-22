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
  test.setTimeout(90_000); // the first open reads 317 layers in a worker, slow on a shared runner
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

  // Space plays and pauses the build-up from anywhere (not from a focused button); the readout moves only while it plays.
  const readout = dialog.locator("p.tabular").first();
  await slider.focus();
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-viewer=busy]")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible();
  const paused = await readout.textContent();
  await page.waitForTimeout(400);
  expect(await readout.textContent()).toBe(paused);
  // Space after a pause carries on from where the slider is, not from the first layer.
  await slider.fill("199");
  await page.keyboard.press("Space");
  await page.waitForTimeout(300); // long enough for a restart from the first layer to show
  expect(await readout.textContent()).toMatch(/^Layer (2\d\d|3\d\d) of 317/);
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible();
  // A step key while playing pauses.
  await page.keyboard.press("Space");
  await expect(dialog.locator("[data-viewer=busy]")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible();
  await page.keyboard.press("End");
  await expect(dialog.getByText("Layer 317 of 317")).toBeVisible();

  // Colouring by feature says what the colours are.
  await dialog.getByRole("radio", { name: "Feature" }).check({ force: true });
  await expect(dialog.getByText("Outer wall")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the arrow keys step layers as soon as the 3D view opens, and after a drag on the canvas", async ({ page }) => {
  test.setTimeout(90_000); // the first open reads 317 layers in a worker, slow on a shared runner
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  await page.goto(`/builds/${itemId}`);
  await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText("Layer 317 of 317")).toBeVisible();

  // Nothing clicked yet: focus is outside the viewer. Work from the first layer: the software GL of a runner draws
  // all 317 layers slowly (this test took 66 s on CI at the top, where each step is a full redraw).
  await page.keyboard.press("Home");
  await expect(dialog.getByText(/^Layer 1 of 317/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByText(/^Layer 2 of 317/)).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(dialog.getByText(/^Layer 12 of 317/)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByText(/^Layer 11 of 317/)).toBeVisible();
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(dialog.getByText(/^Layer 1 of 317/)).toBeVisible();

  // After a drag on the canvas, which doesn't move focus.
  const box = await dialog.locator("canvas").boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(dialog.getByText(/^Layer 11 of 317/)).toBeVisible();

  // On the slider, Shift steps ten and a plain arrow steps one (not twice).
  await dialog.getByRole("slider", { name: "Layer" }).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(dialog.getByText(/^Layer 21 of 317/)).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByText(/^Layer 20 of 317/)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Space plays the replay right after the 3D view opens, by mouse or by keyboard, and Escape still closes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  await page.goto(`/builds/${itemId}`);
  const chip = page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` });
  const dialog = page.getByRole("dialog", { name: "3D view" });

  for (const how of ["mouse", "keyboard"] as const) {
    if (how === "mouse") await chip.click();
    else {
      await chip.focus();
      await page.keyboard.press("Enter");
    }
    // Space at once, without waiting for the file: it must not press the close button.
    await page.keyboard.press("Space");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
    await expect(dialog.getByText("Layer 317 of 317")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).not.toBeFocused();
    await page.keyboard.press("Space");
    await expect(dialog.locator("[data-viewer=busy]")).toBeVisible();
    await page.keyboard.press("Space");
    await expect(dialog.locator("[data-viewer=ready]")).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
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
  await expect(page.getByRole("dialog", { name: "3D view" }).getByText(/no toolpaths|Could not read/)).toBeVisible({
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

test("a printing attempt's 3D view opens at the layer being printed and comes back to it @phone", async ({
  page,
  isMobile,
}) => {
  // The printer moves on twice, and each move reaches the view through the change feed.
  test.setTimeout(90_000);
  await signIn(page);
  const itemId = await buildWithTugboat(page, true);
  const origin = new URL(page.url()).origin;
  const { item } = await (await page.request.get(`/api/items/${itemId}`)).json();
  const report = (layer: number, remainingMinutes: number) =>
    page.request.put("/api/printer/bridge", {
      headers: { Origin: origin },
      data: {
        printerState: "printing",
        progress: { attemptId: item.attempts[0].id, percent: 40, remainingMinutes, layer, totalLayers: 317 },
      },
    });
  await report(120, 120);
  try {
    await page.goto(`/builds/${itemId}`);
    await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
    const dialog = page.getByRole("dialog", { name: "3D view" });
    const readout = dialog.locator("[data-readout]");
    const slider = dialog.getByRole("slider", { name: "Layer" });
    const backToNow = dialog.getByRole("button", { name: "Back to now" });
    // No build-up for a print in progress: it opens at the printer's layer, in one line, with "now" on the slider.
    await expect(readout).toHaveText(/^Printing now\. Layer 120 of 317 · 2 h left$/, { timeout: 20_000 });
    await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
    await expect(slider).toHaveValue("119");
    await expect(dialog.locator("[data-live-label]")).toHaveText("now");
    await expect(backToNow).toBeHidden();
    // The printer moves on: the view follows it (the change feed brings it).
    await report(126, 115);
    await expect(readout).toHaveText(/Layer 126 of 317 · 1 h 55 min left$/, { timeout: 25_000 });
    await expect(slider).toHaveValue("125");
    // Moved away, it says which layer it shows and offers the way back; the printer moving on doesn't pull it along.
    if (isMobile) await slider.fill("59");
    else {
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
    }
    const away = isMobile ? "60" : "115";
    await expect(readout).toHaveText(new RegExp(`^Layer ${away} of 317 · `));
    await expect(backToNow).toBeVisible();
    await report(130, 110);
    await expect(dialog.locator("[data-live-label]")).toBeVisible();
    await expect(slider).toHaveValue(String(Number(away) - 1));
    await expect(readout).toHaveText(new RegExp(`^Layer ${away} of 317 · `));
    // The chip (or N on a keyboard) goes back to the layer being printed, which is 130 by now.
    if (isMobile) await backToNow.click();
    else await page.keyboard.press("n");
    await expect(slider).toHaveValue("129", { timeout: 25_000 });
    await expect(readout).toHaveText(/Layer 130 of 317 · 1 h 50 min left$/);
    await expect(backToNow).toBeHidden();
    // The build-up is moving away too: Space plays it, and the chip takes it back.
    if (!isMobile) {
      await page.keyboard.press("Space");
      await expect(backToNow).toBeVisible();
      await backToNow.click();
      await expect(slider).toHaveValue("129");
    }
  } finally {
    await page.request.put("/api/printer/bridge", { headers: { Origin: origin }, data: { progress: null } });
  }
});

test("tilting just under the plate turns it see-through at once, by mouse or touch, and back solid above @phone", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000); // the first open reads 317 layers in a worker, and each tilt draws them, slow on a runner
  await signIn(page);
  const itemId = await buildWithTugboat(page);
  await page.goto(`/builds/${itemId}`);
  await page.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` }).click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  const canvas = dialog.locator("canvas");
  await expect(canvas).toHaveAttribute("data-plate", "solid");
  // Only the first layer: the plate doesn't depend on it, and each frame is far cheaper to draw in software GL.
  await page.keyboard.press("Home");
  await expect(dialog.getByText(/^Layer 1 of 317/)).toBeVisible();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const x = box.x + box.width / 2;
  let y = box.y + box.height * 0.7;
  const touch = testInfo.project.use.hasTouch ? await page.context().newCDPSession(page) : null;
  const point = () => [{ x, y }];
  if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point() });
  else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  /** The camera's height above the plate's top (mm) and how the plate looks, read from the same frame. */
  const look = () =>
    canvas.evaluate((c: HTMLCanvasElement) => ({ height: Number(c.dataset.cameraHeight), plate: c.dataset.plate }));
  const seen: { height: number; plate?: string }[] = [];
  /** Drags a pixel or two (up tilts the camera down, under the plate) and notes where the view is. */
  const tilt = async (dy: number) => {
    y += dy;
    if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point() });
    else await page.mouse.move(x, y);
    const now = await look();
    seen.push(now);
    return now.height;
  };

  // Tilt down in small steps until the camera is under the plate, and on, then back up: whenever the camera is level
  // with the plate's top or under it, the plate is see-through, never solid or half faded.
  let height = (await look()).height;
  expect(height).toBeGreaterThan(0);
  // (Every step draws the whole print in software GL, seconds on a runner: coarse steps away from the plate.)
  for (let i = 0; i < 40 && height > 12; i++) height = await tilt(-10);
  for (let i = 0; i < 40 && height > -6; i++) height = await tilt(-2);
  await expect.poll(async () => (await look()).plate).toBe("see-through");
  for (let i = 0; i < 40 && seen.at(-1)?.plate !== "solid"; i++) height = await tilt(16);
  const under = seen.filter((s) => s.height <= 0);
  // It passed just under the plate on the way (a grazing look, where the old view showed the solid underside).
  expect(under.some((s) => s.height > -10)).toBe(true);
  expect(under.filter((s) => s.plate !== "see-through")).toEqual([]);
  // Back above, well clear of the plate, it is solid again.
  await expect.poll(async () => (await look()).plate).toBe("solid");

  if (touch) await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  else await page.mouse.up();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});
