import { expect, test } from "@playwright/test";
import { TUGBOAT_FILE_NAME, tugboatFile } from "./fixtures/gcode-tugboat";
import { clearIdeas, signIn } from "./helpers";

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const origin = (page: { url(): string }) => new URL(page.url()).origin;

test("a slicer file kept with an idea shows, counts as a model, can go and come back, and follows it into a build", async ({
  page,
}) => {
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: origin(page) },
    data: { id, title: "Tugboat", note: "for the bath" },
  });
  await page.goto(`/ideas/${id}`);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: TUGBOAT_FILE_NAME,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(tugboatFile()),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await expect(files.getByText(TUGBOAT_FILE_NAME)).toBeVisible();
  // The new card is brought into view, not left below the fold behind the tab bar.
  await expect(files.getByText(TUGBOAT_FILE_NAME)).toBeInViewport();
  await expect(files.getByText(/est\./)).toBeVisible();
  await expect(files.getByRole("link", { name: `Download ${TUGBOAT_FILE_NAME}` })).toHaveAttribute(
    "href",
    /\/api\/files\//,
  );
  await expect(files.getByRole("button", { name: `See ${TUGBOAT_FILE_NAME} in 3D` })).toBeVisible();

  // It survives a reload (it is on the server), and the idea now has a model.
  await page.reload();
  await expect(page.getByRole("region", { name: /^Files/ }).getByText(TUGBOAT_FILE_NAME)).toBeVisible();
  await page.goto("/ideas");
  await expect(page.getByText("Ready to print, model on 3MF file")).toHaveCount(1);
  await page.getByRole("button", { name: /^Has a model/ }).click();
  await expect(page.getByRole("heading", { name: "Tugboat" })).toBeVisible();

  // Remove it, then change your mind.
  await page.goto(`/ideas/${id}`);
  // Two steps: its "…", then Remove (decision 0054).
  await page.getByRole("button", { name: `More for ${TUGBOAT_FILE_NAME}` }).click();
  await page.getByRole("button", { name: "Remove file" }).click();
  await expect(page.getByRole("region", { name: /^Files/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: /^Files/ }).getByText(TUGBOAT_FILE_NAME)).toBeVisible();

  // Starting the build keeps it, and the first attempt can be printed from it.
  await page
    .getByRole("button", { name: /Start building/ })
    .last()
    .click();
  await expect(page).toHaveURL(new RegExp(`/builds/${id}`));
  await expect(page.getByRole("region", { name: /^Files/ }).getByText(TUGBOAT_FILE_NAME)).toBeVisible();
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  // The idea's one slice is attached as the sheet opens: a row named for it, its estimate, and a way to change it.
  await expect(sheet.getByText(TUGBOAT_FILE_NAME)).toBeVisible();
  await expect(sheet.getByText(/est\./)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Change", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Add the slicer file" })).toHaveCount(0);

  // Attempt 1 starts with what the file said: settings, estimate and filament, with no chip tapped.
  await sheet.getByRole("button", { name: "Start print" }).click();
  await expect(sheet).toBeHidden();
  await expect
    .poll(async () => {
      const { item } = await (await page.request.get(`/api/items/${id}`)).json();
      const settings = item.attempts[0]?.settings ?? {};
      return [
        settings.estimatedMinutes !== undefined,
        settings.layerHeight !== undefined,
        (settings.filaments?.length ?? 0) > 0,
        item.attempts[0]?.file?.name === TUGBOAT_FILE_NAME,
      ];
    })
    .toEqual([true, true, true, true]);
});
