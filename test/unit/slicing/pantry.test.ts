import { describe, expect, it } from "vitest";
import { DEFAULT_SLICING, STAND_IN_FILAMENT } from "../../../src/shared/slicing/defaults.ts";
import {
  engineSlices,
  filamentOfSpool,
  ownedPlate,
  pantryFilament,
  slicingSpools,
  workshopDefaults,
} from "../../../src/shared/slicing/pantry.ts";
import { DEFAULT_PRINTER, type PrinterSetup, type SpoolLike } from "../../../src/shared/spools.ts";

const spool = (id: string, change: Partial<SpoolLike> = {}): SpoolLike => ({
  id,
  material: "PLA",
  remaining: "full",
  slot: null,
  ...change,
});

describe("a slice's defaults from the workshop", () => {
  it("say a spool in the settings' words, the colour lowercase, and keep its id", () => {
    expect(
      filamentOfSpool(
        spool("s1", { brand: "Bambu Lab", colorHex: "#F2754E", colorName: "Orange", finish: "basic", slot: "A1" }),
      ),
    ).toEqual({
      material: "PLA",
      colorHex: "#f2754e",
      colorName: "Orange",
      brand: "Bambu Lab",
      finish: "basic",
      spoolId: "s1",
    });
    expect(filamentOfSpool(spool("s2", { colorHex: null }))).toEqual({ material: "PLA", spoolId: "s2" });
  });

  it("offer loaded spools first in slot order, PLA before others, and leave empty ones out", () => {
    const spools = [
      spool("shelf-petg", { material: "PETG" }),
      spool("b2", { slot: "B2", material: "PETG" }),
      spool("a3", { slot: "A3" }),
      spool("shelf-pla"),
      spool("ext", { slot: "Ext" }),
      spool("a1-empty", { slot: "A1", remaining: "empty" }),
      spool("a2", { slot: "A2" }),
    ];
    expect(slicingSpools(spools).map((s) => s.id)).toEqual(["a2", "a3", "ext", "b2", "shelf-pla", "shelf-petg"]);
  });

  it("slice with the likeliest spool, or the stand-in when the Pantry has none", () => {
    expect(pantryFilament([])).toEqual(STAND_IN_FILAMENT);
    expect(pantryFilament([spool("empty", { remaining: "empty" })])).toEqual(STAND_IN_FILAMENT);
    expect(pantryFilament([spool("petg", { material: "PETG", slot: "A1" }), spool("pla", { slot: "A2" })])).toEqual({
      material: "PLA",
      spoolId: "pla",
    });
  });

  it("slice for a plate that is owned, the stock one first", () => {
    expect(ownedPlate({ plates: ["Smooth PEI Plate", "Textured PEI Plate"] })).toBe("Textured PEI Plate");
    expect(ownedPlate({ plates: ["Smooth PEI Plate"] })).toBe("Smooth PEI Plate");
    expect(ownedPlate({ plates: [] })).toBe("Textured PEI Plate");
  });

  it("take the main nozzle, the owned plate and a spool over Spaghetti's defaults", () => {
    const setup: PrinterSetup = {
      ...DEFAULT_PRINTER,
      plates: ["Smooth PEI Plate"],
      nozzles: { ...DEFAULT_PRINTER.nozzles, main: { diameter: 0.6, hardened: true } },
    };
    expect(workshopDefaults({ spools: [spool("pla", { slot: "A1" })], setup })).toEqual({
      ...DEFAULT_SLICING,
      filaments: [{ material: "PLA", spoolId: "pla" }],
      plate: "Smooth PEI Plate",
      nozzle: 0.6,
    });
    expect(engineSlices(0.4)).toBe(true);
    expect(engineSlices(0.6)).toBe(false);
  });

  it("keep a base's own spool while it is still in the Pantry with filament on it", () => {
    const base = { ...DEFAULT_SLICING, layerHeight: 0.12, filaments: [{ material: "PETG", spoolId: "petg" }] };
    const spools = [spool("pla", { slot: "A1" }), spool("petg", { material: "PETG" })];
    expect(workshopDefaults({ spools, setup: DEFAULT_PRINTER }, base)).toMatchObject({
      layerHeight: 0.12,
      filaments: [{ material: "PETG", spoolId: "petg" }],
    });
    const used = [spool("pla", { slot: "A1" }), spool("petg", { material: "PETG", remaining: "empty" })];
    expect(workshopDefaults({ spools: used, setup: DEFAULT_PRINTER }, base).filaments).toEqual([
      { material: "PLA", spoolId: "pla" },
    ]);
  });
});
