import { expect, test } from "@playwright/test";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

// A sliced model says what it measures (width × depth × height, one copy): on its card and in its 3D view.
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const SLICED = 60_000;

test("a sliced model's size shows on its card and in its 3D view", { tag: "@phone" }, async ({ page }) => {
  test.setTimeout(2 * SLICED);
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Tag", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: "tag.stl",
    mimeType: "model/stl",
    buffer: Buffer.from(boxStl(29.96, 11.5, 11.35)),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: SLICED });
  await expect(files.getByText("29.96 × 11.5 × 11.35 mm")).toBeVisible();

  await files.getByRole("button", { name: "See tag.stl in 3D" }).click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await expect(dialog.locator("[data-viewer=ready]")).toBeVisible({ timeout: 30_000 });
  const size = dialog.locator("[data-size]");
  await expect(size).toContainText("Width 29.96 mm, depth 11.5 mm, height 11.35 mm");
  await expect(size.locator("[aria-hidden]")).toHaveText("W 29.96 · D 11.5 · H 11.35 mm");
  // It fits its line, beside nothing that crowds the layer slider.
  const box = await size.boundingBox();
  const view = page.viewportSize();
  expect(box && view && box.x + box.width <= view.width).toBe(true);
});
