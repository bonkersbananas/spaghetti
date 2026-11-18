import { describe, expect, it } from "vitest";
import { materialMismatch, materialMismatchSentence, pageMaterials } from "../../src/shared/slicing/material.ts";

const filament = (material: string) => ({ material });

describe("material mismatch between a model's page and its slice", () => {
  it("reads the families a page names, and nothing from a sentence", () => {
    expect(pageMaterials("PETG")).toEqual(["PETG"]);
    expect(pageMaterials("PLA Basic")).toEqual(["PLA"]);
    expect(pageMaterials("PETG HF")).toEqual(["PETG"]);
    expect(pageMaterials("PLA or PETG")).toEqual(["PLA", "PETG"]);
    expect(pageMaterials("Any filament you like, really")).toEqual([]);
    expect(pageMaterials(null)).toEqual([]);
  });

  it("is no mismatch inside a family: PLA Basic, PLA Matte, PLA+", () => {
    expect(materialMismatch("PLA Matte", [filament("PLA")])).toBeNull();
    expect(materialMismatch("PLA Basic", [filament("PLA+")])).toBeNull();
    expect(materialMismatch("PLA or PETG", [filament("PETG")])).toBeNull();
    expect(materialMismatch("PETG", [filament("PLA"), filament("PETG")])).toBeNull();
  });

  it("is one when the materials differ, and names the site and the slice", () => {
    const mismatch = materialMismatch("PETG", [filament("PLA")]);
    expect(mismatch).toMatchObject({ page: "PETG", material: "PLA" });
    expect(materialMismatchSentence(mismatch!, "MakerWorld")).toBe("MakerWorld says PETG; this is sliced with PLA.");
    expect(materialMismatchSentence(mismatch!, "Printables")).toBe("Printables says PETG; this is sliced with PLA.");
    expect(materialMismatch("PETG-CF", [filament("PETG")])).not.toBeNull();
  });

  it("says nothing when the page doesn't say a material", () => {
    expect(materialMismatch(null, [filament("PLA")])).toBeNull();
    expect(materialMismatch("PETG", [])).toBeNull();
  });
});
