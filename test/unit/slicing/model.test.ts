import { describe, expect, it } from "vitest";
import { DEFAULT_SLICING } from "../../../src/shared/slicing/defaults.ts";
import { changeWords, modelSlicing, slicingAhead, slicingOfSlice } from "../../../src/shared/slicing/model.ts";
import type { SlicingSettings } from "../../../src/shared/slicing/settings.ts";
import { withNozzle } from "../../../src/shared/slicing/settings.ts";
import type { FileSlice } from "../../../src/shared/slicing/types.ts";
import { slicingDetail } from "../../../src/shared/slicing/words.ts";

const fine: SlicingSettings = { ...DEFAULT_SLICING, layerHeight: 0.12 };

const slice = (slicing?: SlicingSettings, more: Partial<FileSlice["settings"]> = {}): FileSlice => ({
  status: "sliced",
  settings: {
    machine: "Bambu Lab X2D 0.4 nozzle",
    process: "0.20mm Standard @BBL X2D",
    filaments: ["Bambu PLA Basic @BBL X2D 0.4 nozzle"],
    layerHeight: 0.2,
    materials: ["PLA"],
    bedType: "Textured PEI Plate",
    supports: false,
    scale: 100,
    engine: "1",
    orca: "2.5.0-dev",
    ...(slicing ? { slicing } : {}),
    ...more,
  },
  at: 1,
});

describe("a model's settings", () => {
  it("are what its slice was made with, read from an older slice's record when it has none", () => {
    expect(slicingOfSlice(slice(fine))).toEqual(fine);
    // Decision 0046's supports were Orca's under every steep overhang.
    expect(slicingOfSlice(slice(undefined, { supports: true, layerHeight: 0.24, scale: 80 }))).toEqual({
      ...DEFAULT_SLICING,
      supports: "everywhere",
      layerHeight: 0.24,
      scale: 80,
    });
  });

  it("for the next slice: what was chosen, else what it was sliced with, else the defaults", () => {
    const draft = { ...DEFAULT_SLICING, layerHeight: 0.24 };
    expect(modelSlicing({ slicing: draft, slice: slice(fine) }, DEFAULT_SLICING)).toEqual(draft);
    expect(modelSlicing({ slicing: null, slice: slice(fine) }, DEFAULT_SLICING)).toEqual(fine);
    expect(modelSlicing({ slicing: null, slice: null }, fine)).toEqual(fine);
  });

  it("are ahead of its slice when they were changed since it was made", () => {
    expect(slicingAhead({ slicing: fine, slice: slice(fine) })).toBeNull();
    expect(slicingAhead({ slicing: null, slice: slice(fine) })).toBeNull();
    expect(slicingAhead({ slicing: fine, slice: null })).toBeNull();
    expect(slicingAhead({ slicing: { ...fine, supports: "where-needed" }, slice: slice(fine) })).toEqual({
      ...fine,
      supports: "where-needed",
    });
  });
});

describe('what a change is, after "Slicing with"', () => {
  it("names the one thing that changed", () => {
    expect(changeWords(DEFAULT_SLICING, fine)).toBe("Fine");
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, layerHeight: 0.16 })).toBe("0.16 mm layers");
    expect(changeWords(DEFAULT_SLICING, withNozzle(DEFAULT_SLICING, 0.2))).toBe("the 0.2 mm nozzle");
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, supports: "where-needed" })).toBe(
      "supports where needed",
    );
    expect(changeWords({ ...DEFAULT_SLICING, supports: "everywhere" }, DEFAULT_SLICING)).toBe("no supports");
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, walls: 4, infill: 25, pattern: "gyroid" })).toBe(
      "Strong",
    );
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, infill: 30 })).toBe("other walls and infill");
    // Which Standard: the quality's or the strength's.
    expect(changeWords(fine, DEFAULT_SLICING)).toBe("Standard quality");
    expect(changeWords({ ...DEFAULT_SLICING, walls: 4, infill: 25 }, DEFAULT_SLICING)).toBe("Everyday strength");
    expect(
      changeWords(DEFAULT_SLICING, {
        ...DEFAULT_SLICING,
        filaments: [{ material: "PETG", colorHex: "#1d1d1f", colorName: "Black" }],
      }),
    ).toBe("PETG black");
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, scale: 80 })).toBe("80%");
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, brim: "on" })).toBe("a brim");
  });

  it("says the new settings when several changed", () => {
    expect(changeWords(DEFAULT_SLICING, { ...fine, supports: "everywhere" })).toBe("the new settings");
  });
});

describe("a slice's settings in full, for the story", () => {
  it("say every setting in words", () => {
    expect(
      slicingDetail({
        ...fine,
        supports: "where-needed",
        filaments: [{ material: "PLA", colorHex: "#f2754e", colorName: "Orange", finish: "matte", brand: "Bambu Lab" }],
      }),
    ).toBe(
      "Fine (0.12 mm layers), 2 walls and 15% crosshatch infill, tree supports where needed, a brim where needed, PLA Matte orange (Bambu Lab), Textured PEI Plate, 0.4 mm nozzle",
    );
    expect(slicingDetail({ ...DEFAULT_SLICING, layerHeight: 0.16, brim: "off", scale: 80 })).toBe(
      "0.16 mm layers, 2 walls and 15% crosshatch infill, no supports, no brim, PLA, Textured PEI Plate, 0.4 mm nozzle, scaled to 80%",
    );
  });
});
