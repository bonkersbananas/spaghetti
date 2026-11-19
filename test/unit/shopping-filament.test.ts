import { describe, expect, it } from "vitest";
import { filamentFromName } from "../../src/shared/shopping-filament.ts";

describe("filamentFromName", () => {
  it("reads material, finish and colour from a bought filament", () => {
    expect(filamentFromName("PLA Basic, Jade White")).toEqual({
      material: "PLA",
      brand: null,
      finish: "basic",
      colorName: "Jade white",
      colorHex: "#f4f1ea",
    });
  });

  it("reads a brand, and keeps a colour it doesn't know as its words", () => {
    expect(filamentFromName("Bambu Lab PETG HF Forest Green 1kg")).toMatchObject({
      material: "PETG",
      brand: "Bambu Lab",
      colorName: "Forest green",
    });
    expect(filamentFromName("Polymaker PLA matte black")).toMatchObject({
      brand: "Polymaker",
      finish: "matte",
      colorName: "Black",
      colorHex: "#1d1d1f",
    });
    expect(filamentFromName("PLA+ silk")).toMatchObject({ material: "PLA+", finish: "silk", colorName: null });
  });

  it("reads the colour from a sentence: filler words are not part of it", () => {
    expect(filamentFromName("Spool of white PETG")).toMatchObject({ material: "PETG", colorName: "White" });
    expect(filamentFromName("A new roll of PETG")).toMatchObject({ material: "PETG" });
  });

  it("says nothing for what is not filament", () => {
    for (const name of [
      "0.4 mm hardened nozzle",
      "Textured PEI plate",
      "PC fan",
      "Glue stick",
      "Replacement PTFE tube",
    ]) {
      expect(filamentFromName(name), name).toBeNull();
    }
  });
});
