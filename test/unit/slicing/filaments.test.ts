import { describe, expect, it } from "vitest";
import { keepOwnFilaments, withoutStandIns } from "../../../src/shared/slicing/filaments.ts";

const stand = { type: "PLA", colorHex: "#F2754E", profile: "Bambu PLA Basic", grams: 10.6 };

describe("a slice's filaments", () => {
  it("drops a stand-in's colour and preset, and keeps a project's own", () => {
    const prefill = { layerHeight: 0.2, filaments: [stand, { type: "PETG", colorHex: "#2C8A87", grams: 3 }] };
    expect(withoutStandIns(prefill, [false, true])).toEqual({
      layerHeight: 0.2,
      filaments: [
        { type: "PLA", grams: 10.6 },
        { type: "PETG", colorHex: "#2C8A87", grams: 3 },
      ],
    });
    expect(withoutStandIns({ layerHeight: 0.2 }, [])).toEqual({ layerHeight: 0.2 });
  });

  it("lets the attempt keep its own filament for a stand-in, with the slice's grams", () => {
    const own = { type: "PLA", colorHex: "#F4F1EA", colorName: "Jade white", spoolId: "s1" };
    const fromSlice = { estimatedMinutes: 36, filaments: [{ type: "PLA", grams: 10.6 }] };
    expect(keepOwnFilaments({ filaments: [own] }, fromSlice)).toEqual({
      estimatedMinutes: 36,
      filaments: [{ ...own, grams: 10.6 }],
    });
    // Nothing of its own: the stand-in's material and grams.
    expect(keepOwnFilaments({}, fromSlice)).toEqual(fromSlice);
    // A filament the project chose stays the project's.
    const chosen = { filaments: [{ type: "PETG", colorHex: "#2C8A87", grams: 3 }] };
    expect(keepOwnFilaments({ filaments: [own] }, chosen)).toEqual(chosen);
  });
});
