import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./helpers";

const origin = (page: Page) => new URL(page.url()).origin;

/** A silk PLA spool, and a build with an attempt that worked on it. */
async function seed(page: Page) {
  const headers = { Origin: origin(page) };
  const spoolId = crypto.randomUUID();
  const buildId = crypto.randomUUID();
  await page.request.post("/api/spools", {
    headers,
    data: {
      id: spoolId,
      material: "PLA",
      brand: "Eryone",
      colorName: "Silk gold",
      colorHex: "#c9a46b",
      finish: "silk",
    },
  });
  await page.request.post("/api/items", { headers, data: { id: buildId, title: "Recipe tugboat", stage: "building" } });
  await page.request.post(`/api/items/${buildId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: "success",
      note: "Slow outer wall did it",
      settings: {
        filaments: [{ type: "PLA", brand: "Eryone", colorName: "Silk gold", colorHex: "#c9a46b", spoolId }],
        layerHeight: 0.16,
        nozzleTemperature: 225,
        brim: true,
      },
    },
  });
  return { spoolId, buildId };
}

test.afterEach(async ({ page }) => {
  const headers = { Origin: origin(page) };
  const { recipes } = await (await page.request.get("/api/recipes")).json();
  for (const recipe of recipes) await page.request.delete(`/api/recipes/${recipe.id}`, { headers });
  const { spools } = await (await page.request.get("/api/spools")).json();
  for (const spool of spools) await page.request.delete(`/api/spools/${spool.id}`, { headers });
  const { items } = await (await page.request.get("/api/items?stage=idea,building,done,shelved")).json();
  for (const item of items) await page.request.delete(`/api/items/${item.id}`, { headers });
});

test("saves an attempt as a recipe, finds it on the spool page and in search, starts from it, and deletes it with undo", async ({
  page,
  isMobile,
}) => {
  await signIn(page);
  const { spoolId, buildId } = await seed(page);

  // Save it from the What worked card.
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Recipe tugboat");
  const card = page.getByRole("region", { name: "What worked" });
  await card.getByRole("button", { name: "Save as recipe" }).click();
  const save = page.getByRole("dialog", { name: "Save as a recipe" });
  // The name is offered from the spool's finish and the material.
  await expect(save.getByRole("textbox", { name: "Name it" })).toHaveValue("Silk PLA");
  await save.getByRole("textbox", { name: "Name it" }).fill("Silk PLA, slow outer wall");
  await save.getByRole("textbox", { name: "A note (optional)" }).fill("Dry it first");
  await save.getByRole("button", { name: "Save recipe" }).click();
  await expect(save).toBeHidden();
  await expect(card.getByText("Saved as a recipe")).toBeVisible();

  // The spool page: "Recipes for silk PLA".
  await page.goto(`/pantry/${spoolId}`);
  const shelf = page.getByRole("region", { name: /Recipes for silk PLA/ });
  await expect(shelf.getByRole("button", { name: /Silk PLA, slow outer wall/ })).toBeVisible();

  // The Pantry's material group.
  await page.goto("/pantry");
  await expect(page.getByRole("region", { name: /Recipes for PLA/ })).toBeVisible();

  // Search finds it as its own kind.
  await page.goto("/search?q=silk");
  const found = page.getByRole("region", { name: "Recipes" });
  await expect(found.getByRole("button", { name: /Silk PLA, slow outer wall/ })).toBeVisible();

  // Start an attempt from it; changing a setting only changes the line, it asks nothing.
  await page.goto(`/builds/${buildId}`);
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue("Recipe tugboat");
  if (isMobile) await page.getByRole("button", { name: "Log attempt" }).click();
  else await page.keyboard.press("a");
  const sheet = page.getByRole("dialog", { name: "Attempt 2" });
  await sheet.getByRole("button", { name: "Start from a recipe" }).click();
  await sheet.getByRole("button", { name: /Silk PLA, slow outer wall/ }).click();
  await expect(sheet.getByText("Starting from “Silk PLA, slow outer wall”")).toBeVisible();
  await expect(sheet.getByText(/Same as recipe “Silk PLA, slow outer wall”/)).toBeVisible();
  await sheet.getByRole("button", { name: /^Settings/ }).click();
  await sheet.getByLabel("Bed", { exact: true }).fill("70");
  await sheet.getByRole("button", { name: /^Settings/ }).click();
  await expect(sheet.getByText(/Changed from recipe “Silk PLA, slow outer wall”: bed 70 °C/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Delete it from the spool page: an undo toast, no dialog; Undo brings it back.
  await page.goto(`/pantry/${spoolId}`);
  await page
    .getByRole("region", { name: /Recipes for silk PLA/ })
    .getByRole("button", { name: /Silk PLA, slow outer wall/ })
    .click();
  const recipe = page.getByRole("dialog", { name: "Silk PLA, slow outer wall" });
  await expect(recipe.getByRole("textbox", { name: "Note" })).toHaveValue("Dry it first");
  await recipe.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("region", { name: /Recipes for silk PLA/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("region", { name: /Recipes for silk PLA/ })).toBeVisible();
});
