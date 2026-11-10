import { describe, expect, it } from "vitest";
import {
  recipeMatchesTerms,
  recipeSettings,
  recipesFor,
  settingsMaterial,
  startFromRecipe,
  suggestedRecipeName,
} from "../../src/shared/recipes.ts";
import { searchTerms } from "../../src/shared/search.ts";

const recipe = (name: string, material: string, finish: string | null, createdAt = 1, note = "") => ({
  name,
  note,
  material,
  finish,
  createdAt,
});

describe("settingsMaterial", () => {
  it("is the first filament that names a type, uppercase", () => {
    expect(settingsMaterial({ filaments: [{ brand: "Bambu" }, { type: " petg " }, { type: "PLA" }] })).toBe("PETG");
    expect(settingsMaterial({})).toBeNull();
    expect(settingsMaterial({ filaments: [{ type: "  " }] })).toBeNull();
  });
});

describe("recipeSettings", () => {
  it("keeps the choices and drops results, grams, slots and spools", () => {
    expect(
      recipeSettings({
        filaments: [{ type: "PLA", colorName: "Gold", spoolId: "s1", amsSlot: "A2", grams: 12 }],
        layerHeight: 0.16,
        brim: true,
        actualMinutes: 90,
        weightGrams: 12,
        failedAtPercent: 10,
      }),
    ).toEqual({ filaments: [{ type: "PLA", colorName: "Gold" }], layerHeight: 0.16, brim: true });
  });
});

describe("recipesFor", () => {
  const all = [
    recipe("Silk PLA", "PLA", "silk", 1),
    recipe("PLA at large", "PLA", null, 3),
    recipe("Matte PLA", "PLA", "Matte", 2),
    recipe("PETG", "PETG", null, 4),
  ];
  const names = (list: Array<{ name: string }>) => list.map((r) => r.name);

  it("matches the material in any case", () => {
    expect(names(recipesFor(all, { material: "petg" }))).toEqual(["PETG"]);
  });
  it("puts the same finish first, then the newest, and leaves other finishes out", () => {
    expect(names(recipesFor(all, { material: "PLA", finish: "SILK" }))).toEqual(["Silk PLA", "PLA at large"]);
    expect(names(recipesFor(all, { material: "PLA", finish: "matte" }))).toEqual(["Matte PLA", "PLA at large"]);
  });
  it("gives a spool with no finish every recipe of its material, newest first", () => {
    expect(names(recipesFor(all, { material: "PLA" }))).toEqual(["PLA at large", "Matte PLA", "Silk PLA"]);
  });
  it("gives nothing without a material", () => {
    expect(recipesFor(all, { material: null })).toEqual([]);
    expect(recipesFor(all, { material: "  " })).toEqual([]);
  });
});

describe("recipeMatchesTerms", () => {
  const r = recipe("Silk PLA, slow outer wall", "PLA", "silk", 1, "Dry it first");
  it("needs every term to start a word of the name, note, material or finish", () => {
    expect(recipeMatchesTerms(r, searchTerms("silk"))).toBe(true);
    expect(recipeMatchesTerms(r, searchTerms("slo wal"))).toBe(true);
    expect(recipeMatchesTerms(r, searchTerms("dry"))).toBe(true);
    expect(recipeMatchesTerms(r, searchTerms("silk petg"))).toBe(false);
  });
  it("reads PLA as a whole word, and matches nothing for no terms", () => {
    expect(recipeMatchesTerms(recipe("Plate fix", "PETG", null), searchTerms("pla"))).toBe(false);
    expect(recipeMatchesTerms(r, [])).toBe(false);
  });
});

describe("suggestedRecipeName", () => {
  it("names a recipe from its finish and material", () => {
    expect(suggestedRecipeName("PLA", "silk")).toBe("Silk PLA");
    expect(suggestedRecipeName("PETG", null)).toBe("PETG recipe");
    expect(suggestedRecipeName(null, null)).toBe("");
  });
});

describe("startFromRecipe", () => {
  const silk = {
    material: "PLA",
    settings: { filaments: [{ type: "PLA", colorName: "Gold" }], layerHeight: 0.16, brim: true },
  };
  it("takes the recipe's settings on the spool already chosen when the material matches", () => {
    const chosen = {
      filaments: [{ type: "pla", colorName: "Jade", spoolId: "s1" }],
      layerHeight: 0.2,
      bedTemperature: 60,
    };
    expect(startFromRecipe(silk, chosen)).toEqual({
      filaments: [{ type: "pla", colorName: "Jade", spoolId: "s1" }],
      layerHeight: 0.16,
      brim: true,
    });
  });
  it("brings the recipe's own filament when nothing of its material is chosen", () => {
    expect(startFromRecipe(silk, { filaments: [{ type: "PETG" }] }).filaments).toEqual([
      { type: "PLA", colorName: "Gold" },
    ]);
    expect(startFromRecipe(silk, {}).filaments).toEqual([{ type: "PLA", colorName: "Gold" }]);
  });
});
