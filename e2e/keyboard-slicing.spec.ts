import { expect, test } from "@playwright/test";
import { boxStl } from "./fixtures/model-stl";
import { clearIdeas, signIn } from "./helpers";

test.afterEach(async ({ page }) => {
  await clearIdeas(page);
});

// The slicing panel by keyboard alone (desktop): S opens it with focus on the first choice (the picked tile of its
// group), Tab walks the groups, the arrows move within one as a radio group does, Esc closes it, and focus goes
// back to what opened it.
test("the slicing panel works from the keyboard", async ({ page, isMobile }) => {
  test.skip(isMobile, "a desktop keyboard");
  test.setTimeout(120_000);
  await signIn(page);
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
  await expect(files.getByText(/Sliced by Spaghetti$/)).toBeVisible({ timeout: 60_000 });

  await page.keyboard.press("s");
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  await expect(settings).toBeVisible();
  const quality = settings.getByRole("group", { name: "Quality" });
  const standard = quality.getByRole("radio", { name: /^Standard/ });
  // Focus starts on the picked quality, not the first one.
  await expect(standard).toBeFocused();
  // Every tile shows a focus ring (the label around the radio draws it).
  const ring = (radio: ReturnType<typeof quality.getByRole>) =>
    radio.evaluate((input) => getComputedStyle(input.closest("label") ?? input).boxShadow !== "none");
  expect(await ring(standard)).toBe(true);

  // Tab goes on to the next group, on the picked tile again.
  await page.keyboard.press("Tab");
  await expect(
    settings.getByRole("group", { name: "Strength" }).getByRole("radio", { name: /^Everyday/ }),
  ).toBeFocused();

  // The arrows move within a group and pick, as radios do; Space on a focused radio keeps it.
  await standard.focus();
  await page.keyboard.press("ArrowRight");
  await expect(quality.getByRole("radio", { name: /^Draft/ })).toBeChecked();
  await expect(quality.getByRole("radio", { name: /^Draft/ })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(standard).toBeChecked();

  // Esc closes it, and focus goes back to the card's button when that opened it.
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  const open = files.getByRole("button", { name: "Slice with…" });
  await open.focus();
  await page.keyboard.press("Enter");
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(open).toBeFocused();
});

test("S opens nothing on an idea with no model to slice, and the ? list says it needs one", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a desktop keyboard");
  await signIn(page);
  const id = crypto.randomUUID();
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, title: "No model yet", note: "" },
  });
  await page.goto(`/ideas/${id}`);
  await expect(page.locator("main")).toBeVisible();
  await page.locator("main").evaluate((main) => {
    main.tabIndex = -1;
    main.focus();
  });
  await page.keyboard.press("s");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText(
    "How to slice the model, if it has one",
  );
});
