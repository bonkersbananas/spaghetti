import { describe, expect, it } from "vitest";
import { openChoices, openName, openTarget } from "../../src/shared/open-link.ts";

const model = { kind: "model", stored: true, slice: null };
const sliced = { status: "sliced" };

describe("what Open in Bambu Studio can open", () => {
  it("offers a sliced model's sliced file first, then its original", () => {
    const choices = openChoices({ ...model, name: "Mount.stl", size: 1000, slice: sliced });
    expect(choices.map((c) => [c.part, c.name, c.download])).toEqual([
      ["sliced", "Mount.gcode.3mf", "Mount.gcode.3mf"],
      ["file", "Mount.3mf", "Mount.stl"],
    ]);
    expect(openTarget({ ...model, name: "Mount.3mf", slice: sliced })?.part).toBe("sliced");
  });

  it("offers an unsliced .stl its wrapped original, unless it is too big to wrap", () => {
    expect(openChoices({ ...model, name: "a.STL", size: 5_000_000 }).map((c) => c.name)).toEqual(["a.3mf"]);
    expect(openChoices({ ...model, name: "a.stl", size: 40_000_000 })).toEqual([]);
    // A big original doesn't take the sliced file away.
    expect(openChoices({ ...model, name: "a.stl", size: 40_000_000, slice: sliced }).map((c) => c.part)).toEqual([
      "sliced",
    ]);
  });

  it("offers nothing while saving or for a file that wasn't kept, and a slicer file only its own bytes", () => {
    expect(openChoices({ ...model, name: "a.stl", pending: true })).toEqual([]);
    expect(openChoices({ ...model, name: "a.stl", stored: false })).toEqual([]);
    expect(openChoices({ kind: "slicer", name: "x.gcode.3mf", stored: true }).map((c) => c.part)).toEqual(["file"]);
    expect(openChoices({ kind: "slicer", name: "x.gcode", stored: true })).toEqual([]);
  });

  it("names the file for Bambu Studio in plain characters, an .stl as .3mf", () => {
    expect(openName("Mount v2.STL")).toBe("Mount-v2.3mf");
    expect(openName("Bracket.GCODE.3MF")).toBe("Bracket.gcode.3mf");
  });
});
