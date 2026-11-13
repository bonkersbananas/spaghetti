import { describe, expect, it } from "vitest";
import { DEFAULT_SLICING, STAND_IN_FILAMENT } from "../../../src/shared/slicing/defaults.ts";
import {
  changedSlicing,
  chosenFromOptions,
  filamentWords,
  INFILL_PATTERNS,
  layerRange,
  normalizeSlicing,
  PATTERNS,
  QUALITIES,
  qualityOf,
  qualityWords,
  STRENGTHS,
  SUPPORT_STYLES,
  sameSlicing,
  slicingFor,
  slicingFromRecord,
  slicingLine,
  slicingProblems,
  strengthOf,
  supportWords,
} from "../../../src/shared/slicing/settings.ts";

const orange = {
  material: "PLA",
  brand: "Bambu",
  finish: "basic",
  colorHex: "#f2711c",
  colorName: "Orange",
  spoolId: "6b0c8a1e-2f8b-4f5e-9d5a-1c2b3d4e5f60",
};

describe("the slicing settings", () => {
  it("start as OrcaSlicer's 0.20 mm Standard for the X2D: two walls, 15 % crosshatch, no supports, PLA", () => {
    expect(DEFAULT_SLICING).toEqual({
      layerHeight: 0.2,
      walls: 2,
      infill: 15,
      pattern: "crosshatch",
      supports: "off",
      supportStyle: "tree",
      brim: "auto",
      filaments: [{ material: "PLA" }],
      plate: "Textured PEI Plate",
      nozzle: 0.4,
      scale: 100,
    });
    expect(slicingProblems(DEFAULT_SLICING)).toEqual([]);
    expect(qualityOf(DEFAULT_SLICING.layerHeight)?.id).toBe("standard");
    expect(strengthOf(DEFAULT_SLICING)?.id).toBe("standard");
  });

  it("name four layer heights, each with the mm and what it does", () => {
    expect(QUALITIES.map((quality) => [quality.label, quality.layerHeight])).toEqual([
      ["Fine", 0.12],
      ["Standard", 0.2],
      ["Draft", 0.24],
      ["Extra draft", 0.28],
    ]);
    for (const quality of QUALITIES) {
      expect(quality.effect).toMatch(/^[a-z]/);
      expect(slicingProblems({ ...DEFAULT_SLICING, layerHeight: quality.layerHeight })).toEqual([]);
    }
    expect(qualityWords(0.12)).toBe("Fine");
    expect(qualityWords(0.16)).toBe("0.16 mm layers");
    expect(qualityOf(0.16)).toBeNull();
  });

  it("offer strengths, supports, styles and patterns that are all valid settings", () => {
    for (const strength of STRENGTHS) {
      const settings = {
        ...DEFAULT_SLICING,
        walls: strength.walls,
        infill: strength.infill,
        pattern: strength.pattern,
      };
      expect(slicingProblems(settings)).toEqual([]);
      expect(strengthOf(settings)?.id).toBe(strength.id);
    }
    for (const style of SUPPORT_STYLES)
      expect(slicingProblems({ ...DEFAULT_SLICING, supportStyle: style.id })).toEqual([]);
    for (const pattern of PATTERNS) expect(INFILL_PATTERNS).toContain(pattern.id);
    expect(strengthOf({ walls: 3, infill: 20, pattern: "gyroid" })).toBeNull();
  });

  it("keep layer heights within what the nozzle prints", () => {
    expect(layerRange(0.4)).toEqual({ min: 0.08, max: 0.28 });
    expect(layerRange(0.2)).toEqual({ min: 0.04, max: 0.14 });
    expect(layerRange(0.6)).toEqual({ min: 0.12, max: 0.42 });
    expect(slicingProblems({ ...DEFAULT_SLICING, layerHeight: 0.32 })).toEqual([
      "layerHeight is from 0.08 to 0.28 mm for this nozzle.",
    ]);
    expect(slicingProblems({ ...DEFAULT_SLICING, nozzle: 0.6, layerHeight: 0.32 })).toEqual([]);
    expect(normalizeSlicing({ ...DEFAULT_SLICING, layerHeight: 0.5 }).layerHeight).toBe(0.28);
    expect(normalizeSlicing({ ...DEFAULT_SLICING, layerHeight: 0.123456 }).layerHeight).toBe(0.12);
  });

  it("say what is wrong with settings as given, one line each", () => {
    expect(slicingProblems(null)).toEqual(["Slicing settings are an object."]);
    expect(
      slicingProblems({
        ...DEFAULT_SLICING,
        walls: 0,
        infill: 15.5,
        pattern: "spaghetti",
        supports: "sometimes",
        supportStyle: "organic",
        brim: "yes",
        plate: "Glass",
        nozzle: 0.5,
        scale: 0,
        filaments: [],
        colour: "red",
      }),
    ).toEqual([
      "nozzle is one of 0.2, 0.4, 0.6, 0.8 (mm).",
      "walls is a whole number from 1 to 12.",
      "infill is a whole number from 0 to 100.",
      "scale is a whole number from 1 to 1000.",
      expect.stringMatching(/^pattern is one of crosshatch, gyroid/),
      "supports is off, where-needed or everywhere.",
      expect.stringMatching(/^supportStyle is one of tree, tree-slim/),
      "brim is auto, on or off.",
      expect.stringMatching(/^plate is one of Textured PEI Plate/),
      "filaments lists 1 to 16 filaments.",
      "colour isn't a slicing setting.",
    ]);
    expect(slicingProblems({ ...DEFAULT_SLICING, filaments: [{ material: "" }] })).toEqual([
      "Each filament has a material (and a colorHex like #f2754e, if any).",
    ]);
  });

  it("mend what they can't use from the base, so they are always whole", () => {
    expect(normalizeSlicing(undefined)).toEqual(DEFAULT_SLICING);
    expect(normalizeSlicing({ walls: 4.4, infill: 140, supports: "everywhere", junk: 1 })).toEqual({
      ...DEFAULT_SLICING,
      walls: 4,
      infill: 100,
      supports: "everywhere",
    });
    const base = { ...DEFAULT_SLICING, filaments: [orange] };
    expect(normalizeSlicing({ filaments: [{ material: " PETG ", colorHex: "#1D1D1F", junk: 1 }] }, base)).toEqual({
      ...base,
      filaments: [{ material: "PETG", colorHex: "#1d1d1f" }],
    });
    // A filament with no material is dropped; with none left, the base's stay.
    expect(normalizeSlicing({ filaments: [{ colorHex: "#ffffff" }] }, base).filaments).toEqual([orange]);
    expect(normalizeSlicing({ filaments: [{ material: "PLA", colorHex: "white" }] }).filaments).toEqual([
      { material: "PLA" },
    ]);
  });

  it("are the same when they slice the same, and say which settings changed", () => {
    const { spoolId, ...rest } = orange;
    const shuffled = { ...DEFAULT_SLICING, filaments: [{ spoolId, ...rest }] };
    const picked = { ...DEFAULT_SLICING, filaments: [orange] };
    expect(sameSlicing(shuffled, picked)).toBe(true);
    expect(sameSlicing(DEFAULT_SLICING, picked)).toBe(false);
    expect(changedSlicing(DEFAULT_SLICING, { ...picked, layerHeight: 0.12, supports: "where-needed" })).toEqual([
      "layerHeight",
      "supports",
      "filaments",
    ]);
  });
});

describe("saying the settings", () => {
  it("names a filament the way people do: material, finish, colour", () => {
    expect(filamentWords(orange)).toBe("PLA Basic orange");
    expect(filamentWords({ material: "PETG", colorHex: "#1d1d1f", colorName: "Black" })).toBe("PETG black");
    expect(filamentWords({ material: "PLA", finish: "silk" })).toBe("PLA Silk");
    // The stand-in has no colour anyone chose: it isn't named.
    expect(filamentWords(STAND_IN_FILAMENT)).toBe("PLA");
  });

  it("puts the card's line together: quality, filament, supports, then what isn't the usual", () => {
    expect(slicingLine(DEFAULT_SLICING)).toEqual(["Standard", "PLA"]);
    expect(
      slicingLine({ ...DEFAULT_SLICING, layerHeight: 0.12, filaments: [orange], supports: "where-needed" }),
    ).toEqual(["Fine", "PLA Basic orange", "supports where needed"]);
    expect(
      slicingLine({
        ...DEFAULT_SLICING,
        layerHeight: 0.16,
        walls: 4,
        infill: 25,
        pattern: "gyroid",
        supports: "everywhere",
        scale: 80,
        filaments: [orange, { material: "PETG" }],
      }),
    ).toEqual(["0.16 mm layers", "PLA Basic orange", "+1 more", "supports everywhere", "Strong", "80%"]);
    expect(slicingLine({ ...DEFAULT_SLICING, walls: 3, infill: 20, pattern: "gyroid" })).toEqual([
      "Standard",
      "PLA",
      "3 walls, 20% gyroid",
    ]);
    expect(supportWords({ supports: "everywhere", supportStyle: "tree-slim" }, true)).toBe(
      "slim tree supports everywhere",
    );
    expect(supportWords({ supports: "off", supportStyle: "tree" }, true)).toBe("");
  });
});

describe("older slices and one-tap asks", () => {
  it("read a slice made before the settings: its layer height, supports, materials, plate and size", () => {
    expect(slicingFromRecord({ layerHeight: 0.2, supports: false, materials: ["PLA"], scale: 100 })).toEqual(
      DEFAULT_SLICING,
    );
    // "Slice with supports" was Orca's tree supports under every steep overhang.
    expect(
      slicingFromRecord({
        layerHeight: 0.16,
        supports: true,
        materials: ["PLA", "PETG"],
        bedType: "Cool Plate",
        scale: 78,
      }),
    ).toEqual({
      ...DEFAULT_SLICING,
      layerHeight: 0.16,
      supports: "everywhere",
      filaments: [{ material: "PLA" }, { material: "PETG" }],
      plate: "Cool Plate",
      scale: 78,
    });
  });

  it("turn decision 0046's one-tap asks into chosen settings", () => {
    expect(chosenFromOptions({})).toEqual({});
    expect(chosenFromOptions({ supports: true, scale: 80 })).toEqual({
      supports: "everywhere",
      supportStyle: "tree",
      scale: 80,
    });
    expect(slicingFor({ scale: 80 })).toEqual({ ...DEFAULT_SLICING, scale: 80 });
  });
});
