import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("workshop: four tiles lead to the pantry, the printer, the shopping list and the twists", async ({ page }) => {
  await signIn(page);
  await page.goto("/workshop");
  await expect(page.getByRole("heading", { level: 1, name: "Workshop" })).toBeVisible();
  for (const [name, path] of [
    ["Pantry", "/pantry"],
    ["Printer", "/printer"],
    ["Shopping list", "/shopping"],
    ["Twists", "/twists"],
  ] as const) {
    await expect(page.locator("main").getByRole("link", { name: new RegExp(`^${name}`) })).toHaveAttribute(
      "href",
      path,
    );
  }
  await page
    .locator("main")
    .getByRole("link", { name: /^Pantry/ })
    .click();
  await expect(page).toHaveURL(/\/pantry$/);
});

test("workshop: the Printer tile shows the spools loaded in the AMS, not rings for the empty bays", async ({
  page,
}) => {
  await signIn(page);
  const headers = { Origin: new URL(page.url()).origin };
  const ids: string[] = [];
  try {
    await page.goto("/workshop");
    const tile = page.locator("main").getByRole("link", { name: /^Printer/ });
    // Nothing loaded: the printer's glyph and the words, no dashed placeholders.
    await expect(tile).toContainText("AMS empty");
    await expect(tile.locator("[data-slot-disc]")).toHaveCount(0);

    for (const [slot, colorName, colorHex] of [
      ["A1", "Teal", "#2c8a87"],
      ["A3", "Sunflower yellow", "#f0b323"],
    ] as const) {
      const id = crypto.randomUUID();
      ids.push(id);
      await page.request.post("/api/spools", { headers, data: { id, material: "PLA", colorName, colorHex } });
      await page.request.put(`/api/printer/slots/${slot}`, { headers, data: { spoolId: id } });
    }
    await page.reload();
    await expect(tile).toContainText("2 of 4 loaded");
    await expect(tile.locator("[data-slot-disc]")).toHaveText(["A1", "A3"]);
  } finally {
    for (const id of ids) await page.request.delete(`/api/spools/${id}`, { headers });
  }
});
