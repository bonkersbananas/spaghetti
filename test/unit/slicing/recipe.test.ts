import { describe, expect, it } from "vitest";
import { DEFAULT_SLICING } from "../../../src/shared/slicing/defaults.ts";
import { workshopDefaults } from "../../../src/shared/slicing/pantry.ts";
import { recipeSlicing, recipeSlicingOf, recipesFor } from "../../../src/shared/slicing/recipe.ts";
import { type SlicingSettings, slicingDefaultsOf } from "../../../src/shared/slicing/settings.ts";
import { DEFAULT_PRINTER, type SpoolLike } from "../../../src/shared/spools.ts";

const spool = (id: string, change: Partial<SpoolLike> = {}): SpoolLike => ({
  id,
  material: "PLA",
  remaining: "full",
  slot: null,
  ...change,
});

const orange = { material: "PLA", colorHex: "#f2754e", colorName: "Orange", finish: "basic", spoolId: "orange" };
const model: SlicingSettings = { ...DEFAULT_SLICING, filaments: [orange], scale: 80 };

describe("slicing with a recipe", () => {
  it("takes a recipe's slicing settings whole, but the model's size and, for the same filament, its spool", () => {
    const worked: SlicingSettings = {
      ...DEFAULT_SLICING,
      layerHeight: 0.12,
      walls: 4,
      supports: "where-needed",
      filaments: [{ material: "PLA", colorHex: "#1d1d1f", colorName: "Black", finish: "basic" }],
    };
    expect(recipeSlicing({ material: "PLA", finish: "basic", settings: {}, slicing: worked }, model)).toEqual({
      ...worked,
      filaments: [orange],
      scale: 80,
    });
  });

  it("reads an older recipe's attempt settings in the settings' words, over the model's for what it doesn't say", () => {
    const settings = {
      filaments: [{ type: "PETG", colorName: "Black", colorHex: "#1d1d1f" }],
      layerHeight: 0.16,
      wallLoops: 3,
      infillDensity: 25,
      supportEnabled: true,
      supportType: "normal" as const,
      brim: true,
      bedType: "Smooth PEI Plate",
      nozzleTemperature: 250,
    };
    expect(recipeSlicing({ material: "PETG", finish: null, settings }, model)).toEqual({
      ...model,
      layerHeight: 0.16,
      walls: 3,
      infill: 25,
      supports: "everywhere",
      supportStyle: "normal",
      brim: "on",
      plate: "Smooth PEI Plate",
      // Another kind of filament than the model's, and no spool of it: the recipe's own words.
      filaments: [{ material: "PETG", colorHex: "#1d1d1f", colorName: "Black" }],
    });
  });

  it("picks a spool of the recipe's filament from the Pantry, the same colour first, loaded before the shelf", () => {
    const recipe = {
      material: "PETG",
      finish: null,
      settings: { filaments: [{ type: "PETG", colorHex: "#1d1d1f" }] },
    };
    const spools = [
      spool("grey", { material: "PETG", colorHex: "#888888", slot: "A3" }),
      spool("black", { material: "PETG", colorHex: "#1d1d1f" }),
      spool("pla", { slot: "A1" }),
    ];
    expect(recipeSlicing(recipe, model, spools).filaments).toEqual([
      { material: "PETG", colorHex: "#1d1d1f", spoolId: "black" },
    ]);
    const noBlack = spools.filter((candidate) => candidate.id !== "black");
    expect(recipeSlicing(recipe, model, noBlack).filaments).toEqual([
      { material: "PETG", colorHex: "#888888", spoolId: "grey" },
    ]);
  });

  it("keeps what a recipe saves of a slice: the kind of filament, not the spool, nor the way that model lay", () => {
    const saved = recipeSlicingOf({ ...model, orientation: [1, 0, 0] });
    expect(saved.filaments).toEqual([{ material: "PLA", colorHex: "#f2754e", colorName: "Orange", finish: "basic" }]);
    expect(saved.orientation).toBeNull();
  });

  it("lays a model the way it lies, not the way the recipe's model did", () => {
    // A direction in the recipe's model's own coordinates means nothing for another model.
    const worked: SlicingSettings = { ...DEFAULT_SLICING, layerHeight: 0.12, orientation: [1, 0, 0] };
    const recipe = { material: "PLA", finish: "basic", settings: {}, slicing: worked };
    expect(recipeSlicing(recipe, model).orientation).toBeNull();
    expect(recipeSlicing(recipe, { ...model, orientation: [0, -1, 0] }).orientation).toEqual([0, -1, 0]);
    expect(recipeSlicing(recipe, { ...model, orientation: [0, -1, 0] }).layerHeight).toBe(0.12);
  });

  it("offers the recipes for the model's filament first, then its material's, then the rest, six at most", () => {
    const recipe = (id: string, material: string, createdAt: number, finish: string | null = null) => ({
      id,
      name: id,
      material,
      finish,
      settings: {},
      createdAt,
    });
    const recipes = [
      recipe("petg", "PETG", 5),
      recipe("pla-old", "PLA", 1),
      recipe("silk", "PLA", 4, "silk"),
      recipe("pla-new", "PLA", 3),
      ...[6, 7, 8, 9].map((at) => recipe(`asa-${at}`, "ASA", at)),
    ];
    const offered = recipesFor(recipes, orange);
    // Its filament's first, then the same material in another finish, then the rest; each newest first.
    expect(offered.map((r) => r.id)).toEqual(["pla-new", "pla-old", "silk", "asa-9", "asa-8", "asa-7"]);
    expect(offered.map((r) => r.fits)).toEqual([true, true, false, false, false, false]);
  });
});

describe("the workspace's defaults", () => {
  it("are how a model prints, and slice a model nobody set up", () => {
    const fine = { ...DEFAULT_SLICING, layerHeight: 0.12, supports: "where-needed" as const };
    const defaults = slicingDefaultsOf(fine);
    expect(defaults).toEqual({
      layerHeight: 0.12,
      walls: 2,
      infill: 15,
      pattern: "crosshatch",
      supports: "where-needed",
      supportStyle: "tree",
      brim: "auto",
    });
    const setup = { ...DEFAULT_PRINTER, slicing: defaults };
    expect(workshopDefaults({ spools: [spool("pla", { slot: "A1" })], setup })).toEqual({
      ...fine,
      filaments: [{ material: "PLA", spoolId: "pla" }],
    });
  });
});
