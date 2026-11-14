import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { hotdogModel } from "./fixtures/model-3mf";
import { clearIdeas, signIn } from "./helpers";

// Colour matching (issue #313): a model that brings colours of its own is sliced with each colour in the filament
// matched to it, shown in the Filament section of "Slice with…" with each colour's filament, changeable there.
test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

const SLICED = 60_000;

test("a model with colours of its own prints each in a filament matched to it, and a choice is kept", async ({
  page,
}) => {
  test.setTimeout(3 * SLICED);
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "Hotdog", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await page
    .getByTestId("idea-file-input")
    .setInputFiles({ name: "hotdog.3mf", mimeType: "model/3mf", buffer: Buffer.from(hotdogModel()) });
  const files = page.getByRole("region", { name: /^Files/ });
  const fileOf = async () => (await (await page.request.get(`/api/items/${id}`)).json()).item.files?.[0];
  await expect.poll(async () => (await fileOf())?.slice?.status, { timeout: SLICED }).toBe("sliced");

  // Nine colours in the file, two pairs near each other: six to print (the printer's limit), each with its own filament here (no spools).
  const slice = (await fileOf()).slice;
  expect(slice.colours).toHaveLength(6);
  expect(slice.colours.every((colour: { inPantry: boolean }) => !colour.inPantry)).toBe(true);
  expect(slice.settings.filaments).toHaveLength(6);

  // Every filament prints something: each object went to the slicer in the filament its colour was matched to.
  const file = await fileOf();
  const zip = unzipSync(new Uint8Array(await (await page.request.get(`/api/files/${file.id}/sliced`)).body()));
  const info = strFromU8(zip["Metadata/slice_info.config"] ?? new Uint8Array());
  const used = [...info.matchAll(/<filament id="(\d+)"[^>]*\bused_g="([\d.]+)"/g)].map((match) => Number(match[2]));
  expect(used).toHaveLength(6);
  for (const grams of used) expect(grams).toBeGreaterThan(0);

  // The plate's picture in the model's own colours is kept, and the idea's cover switches to it.
  expect(slice.originalPicture).toBe(true);
  expect((await page.request.get(`/api/files/${file.id}/original-thumb`)).status()).toBe(200);
  await page.reload();
  const cover = page.getByRole("img", { name: /Slicer preview/ });
  const matchedSrc = await cover.getAttribute("src");
  await page.getByRole("radio", { name: "Model's colours" }).click();
  await expect(cover).toHaveAttribute("src", /original-thumb/);
  await page.getByRole("radio", { name: "In our filaments" }).click();
  await expect(cover).toHaveAttribute("src", matchedSrc ?? "");

  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  await expect(settings.getByText("Colours", { exact: true })).toBeVisible();
  const first = settings.getByRole("button", { name: /Ketchup Red/ });
  await expect(first).toContainText("Not in the Pantry yet");
  await first.click();
  await expect(settings.getByRole("radio", { name: /Ketchup Red/ })).toBeChecked();
});
