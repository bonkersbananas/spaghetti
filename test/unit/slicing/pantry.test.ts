import { describe, expect, it } from "vitest";
import { DEFAULT_SLICING, STAND_IN_FILAMENT } from "../../../src/shared/slicing/defaults.ts";
import {
  defaultNozzle,
  engineSlices,
  filamentOfSpool,
  fittedNozzles,
  ownedPlate,
  pantryFilament,
  slicingSpools,
  workshopDefaults,
} from "../../../src/shared/slicing/pantry.ts";
import { type SlicingDefaults, slicingDefaultsOf } from "../../../src/shared/slicing/settings.ts";
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
    // Standard is the 0.6 mm nozzle's own: 0.30 mm.
    expect(workshopDefaults({ spools: [spool("pla", { slot: "A1" })], setup })).toEqual({
      ...DEFAULT_SLICING,
      filaments: [{ material: "PLA", spoolId: "pla" }],
      plate: "Smooth PEI Plate",
      nozzle: 0.6,
      layerHeight: 0.3,
    });
    for (const nozzle of [0.2, 0.4, 0.6, 0.8]) expect(engineSlices(nozzle)).toBe(true);
  });

  it("offer the nozzle sizes fitted, one when both nozzles are the same", () => {
    expect(fittedNozzles(DEFAULT_PRINTER)).toEqual([{ diameter: 0.4, nozzle: "main" }]);
    const mixed = {
      nozzles: { main: { diameter: 0.4, hardened: true }, auxiliary: { diameter: 0.2, hardened: false } },
    };
    expect(fittedNozzles(mixed)).toEqual([
      { diameter: 0.4, nozzle: "main" },
      { diameter: 0.2, nozzle: "auxiliary" },
    ]);
  });

  it("slice for the nozzle the Printer page's defaults name while it is fitted, else the main one", () => {
    const nozzles = { main: { diameter: 0.4, hardened: true }, auxiliary: { diameter: 0.2, hardened: false } };
    const fine = { ...DEFAULT_SLICING, layerHeight: 0.08, nozzle: 0.2 };
    const setup: PrinterSetup = { ...DEFAULT_PRINTER, nozzles, slicing: slicingDefaultsOf(fine) };
    expect(defaultNozzle(setup)).toBe(0.2);
    expect(workshopDefaults({ spools: [], setup })).toMatchObject({ nozzle: 0.2, layerHeight: 0.08 });
    // The 0.2 mm taken out: the main nozzle, at its own Fine.
    const swapped = { ...setup, nozzles: { ...nozzles, auxiliary: { diameter: 0.4, hardened: true } } };
    expect(defaultNozzle(swapped)).toBe(0.4);
    expect(workshopDefaults({ spools: [], setup: swapped })).toMatchObject({ nozzle: 0.4, layerHeight: 0.12 });
    // Defaults kept before they named a nozzle: the main one.
    const { nozzle: _, ...older } = slicingDefaultsOf({ ...DEFAULT_SLICING, layerHeight: 0.24 });
    const main02 = { ...DEFAULT_PRINTER, nozzles: { ...nozzles, main: { diameter: 0.2, hardened: true } } };
    expect(workshopDefaults({ spools: [], setup: { ...main02, slicing: older as SlicingDefaults } })).toMatchObject({
      nozzle: 0.2,
      layerHeight: 0.12,
    });
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
