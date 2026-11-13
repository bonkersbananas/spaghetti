import { describe, expect, it } from "vitest";
import { DEFAULT_SLICER, DEFAULT_SLICING } from "../../../src/shared/slicing/defaults.ts";
import { changeWords } from "../../../src/shared/slicing/model.ts";
import { recipeSlicing } from "../../../src/shared/slicing/recipe.ts";
import {
  normalizeSlicing,
  slicingDefaultsOf,
  slicingFor,
  slicingProblems,
  slicingSummary,
} from "../../../src/shared/slicing/settings.ts";
import {
  durationWords,
  fallbackOf,
  fallbackWords,
  notesOf,
  pacedFraction,
  RUST_UNSUPPORTED,
  rustEstimateMs,
  slicedBy,
  slicerOf,
} from "../../../src/shared/slicing/slicers.ts";
import type { FileSlice } from "../../../src/shared/slicing/types.ts";
import { slicingDetail } from "../../../src/shared/slicing/words.ts";

// Spaghetti's own slicer beside OrcaSlicer's engine (decision 0055).

const record = (more: Partial<FileSlice["settings"]> = {}, slice: Partial<FileSlice> = {}): FileSlice => ({
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
    ...more,
  },
  at: 1,
  ...slice,
});

describe("our slicer's answer", () => {
  it("is a slice when it answers 0", () => {
    expect(fallbackOf(0, "")).toBeNull();
  });

  it("names what it can't slice yet, in its own words, for OrcaSlicer's engine to slice", () => {
    expect(fallbackOf(RUST_UNSUPPORTED, '{"error":"can\'t slice with tree supports yet"}')).toEqual({
      why: "unsupported",
      what: "tree supports",
    });
    expect(fallbackOf(8, '{"error":"can\'t slice with more than one filament yet"}')).toEqual({
      why: "unsupported",
      what: "more than one filament",
    });
    expect(fallbackOf(8, '{"error":"can\'t slice with a raft yet"}')).toEqual({ why: "unsupported", what: "a raft" });
  });

  it("is a failure on this model for any other answer, or a refusal it can't read", () => {
    // 1 unreadable, 3 too big, 7 a setup that isn't one, 9 off the plate: OrcaSlicer's engine answers for them.
    for (const code of [1, 2, 3, 4, 5, 6, 7, 9]) {
      expect(fallbackOf(code, '{"error":"too big for the plate"}')).toEqual({ why: "failed" });
    }
    expect(fallbackOf(8, "not json")).toEqual({ why: "failed" });
    expect(fallbackOf(8, '{"error":"something else"}')).toEqual({ why: "failed" });
    expect(fallbackOf(8, `{"error":"can't slice with ${"x".repeat(90)} yet"}`)).toEqual({ why: "failed" });
  });

  it("keeps a few short notes of what it printed otherwise than asked", () => {
    expect(notesOf(["Auto Lift printed as spiral lifts"])).toEqual(["Auto Lift printed as spiral lifts"]);
    expect(notesOf(undefined)).toEqual([]);
    expect(notesOf([" ", 3, "no ironing"])).toEqual(["no ironing"]);
    expect(notesOf(Array.from({ length: 12 }, (_, i) => `note ${i}`))).toHaveLength(8);
    expect(notesOf(["x".repeat(200)])[0]).toHaveLength(120);
  });
});

describe("who sliced it", () => {
  it("is OrcaSlicer's engine for a slice from before there was a choice", () => {
    expect(slicerOf(record())).toBe("orca");
    expect(slicerOf(record({ slicer: "spaghetti" }))).toBe("spaghetti");
  });

  it("says Spaghetti for the usual slicer, and names the other", () => {
    expect(DEFAULT_SLICER).toBe("orca");
    expect(slicedBy(record())).toBe("Sliced by Spaghetti");
    expect(slicedBy(record({ slicer: "orca" }))).toBe("Sliced by Spaghetti");
    expect(slicedBy(record({ slicer: "spaghetti" }))).toBe("Sliced by Spaghetti's own slicer");
    // Once ours is the usual one, OrcaSlicer is named instead.
    expect(slicedBy(record({ slicer: "spaghetti" }), { usual: "spaghetti" })).toBe("Sliced by Spaghetti");
    expect(slicedBy(record({ slicer: "orca" }), { usual: "spaghetti" })).toBe("Sliced by OrcaSlicer");
  });

  it("says why OrcaSlicer's engine stepped in for ours, in one calm line", () => {
    const fallback = (why: "unsupported" | "floating" | "unloaded" | "failed", what?: string) =>
      slicedBy(record({ slicer: "orca" }, { fallback: { why, ...(what ? { what } : {}) } }));
    expect(fallback("unsupported", "tree supports")).toBe(
      "Sliced by OrcaSlicer: our own slicer can't do tree supports yet",
    );
    expect(fallback("floating")).toBe("Sliced by OrcaSlicer: our own slicer can't check for floating parts yet");
    expect(fallback("unloaded")).toBe("Sliced by OrcaSlicer: our own slicer couldn't start");
    expect(fallback("failed")).toBe("Sliced by OrcaSlicer: our own slicer couldn't slice this one");
    // A story card's button says only who.
    expect(slicedBy(record({ slicer: "orca" }, { fallback: { why: "floating" } }), { short: true })).toBe(
      "Sliced by OrcaSlicer",
    );
    expect(fallbackWords({ why: "unsupported" })).toBe("our own slicer can't do these settings yet");
  });

  it("says how long it took the way people say it", () => {
    expect(durationWords(119)).toBe("0.1 s");
    expect(durationWords(20)).toBe("0.1 s");
    expect(durationWords(2_531)).toBe("2.5 s");
    expect(durationWords(9_960)).toBe("10 s");
    expect(durationWords(27_400)).toBe("27 s");
    expect(durationWords(60_000)).toBe("1 min");
    expect(durationWords(72_400)).toBe("1 min 12 s");
  });
});

describe("our slicer's ring", () => {
  it("expects time by the layers it slices", () => {
    // A Benchy: 240 layers, 225,000 triangles, about 2.3 s in Chromium.
    expect(rustEstimateMs({ layers: 240, triangles: 225_000 })).toBeGreaterThan(2_000);
    expect(rustEstimateMs({ layers: 240, triangles: 225_000 })).toBeLessThan(3_500);
    expect(rustEstimateMs({ layers: 100, triangles: 12 })).toBeLessThan(rustEstimateMs({ layers: 240, triangles: 12 }));
  });

  it("moves quickly at first and never reaches the end by itself", () => {
    expect(pacedFraction(0, 2_000)).toBe(0);
    expect(pacedFraction(1_000, 2_000)).toBeGreaterThan(0.5);
    expect(pacedFraction(2_000, 2_000)).toBeGreaterThan(0.75);
    expect(pacedFraction(60_000, 2_000)).toBe(0.97);
    expect(pacedFraction(1_000, 0)).toBe(0.97);
  });
});

describe("the slicer as a setting", () => {
  it("is the default's until someone picks one, and a stored setting without it reads as the default", () => {
    expect(DEFAULT_SLICING.slicer).toBe(DEFAULT_SLICER);
    const { slicer: _, ...older } = DEFAULT_SLICING;
    expect(normalizeSlicing(older).slicer).toBe(DEFAULT_SLICER);
    expect(slicingProblems(older)).toEqual([]);
    expect(normalizeSlicing({ ...DEFAULT_SLICING, slicer: "spaghetti" }).slicer).toBe("spaghetti");
    expect(normalizeSlicing({ ...DEFAULT_SLICING, slicer: "cura" }).slicer).toBe(DEFAULT_SLICER);
    expect(slicingProblems({ ...DEFAULT_SLICING, slicer: "cura" })).toEqual(["slicer is spaghetti or orca."]);
  });

  it("is kept in a workspace's defaults only when it isn't the default, so changing the default reaches the rest", () => {
    expect(slicingDefaultsOf(DEFAULT_SLICING)).not.toHaveProperty("slicer");
    expect(slicingDefaultsOf({ ...DEFAULT_SLICING, slicer: "spaghetti" }).slicer).toBe("spaghetti");
    // A workspace's defaults from before there was a choice slice with the default.
    expect(slicingFor({}, normalizeSlicing({ layerHeight: 0.12 })).slicer).toBe(DEFAULT_SLICER);
  });

  it("is said where it isn't the usual one, and not in the card's settings row, whose line above says who sliced it", () => {
    expect(slicingSummary(DEFAULT_SLICING)).not.toContain("OrcaSlicer");
    expect(slicingSummary({ ...DEFAULT_SLICING, slicer: "spaghetti" })).toEqual(slicingSummary(DEFAULT_SLICING));
    expect(slicingDetail({ ...DEFAULT_SLICING, slicer: "spaghetti" })).toMatch(/, by Spaghetti's own slicer$/);
    expect(slicingDetail({ ...DEFAULT_SLICING, slicer: "spaghetti" }, { slicer: false })).not.toMatch(/slicer/);
    expect(changeWords(DEFAULT_SLICING, { ...DEFAULT_SLICING, slicer: "spaghetti" })).toBe("Spaghetti's own slicer");
    expect(changeWords({ ...DEFAULT_SLICING, slicer: "spaghetti" }, DEFAULT_SLICING)).toBe("OrcaSlicer");
  });

  it("stays the model's when it slices with a recipe", () => {
    const ours = { ...DEFAULT_SLICING, slicer: "spaghetti" as const };
    const recipe = { material: "PLA", finish: null, settings: {}, slicing: { ...DEFAULT_SLICING, layerHeight: 0.12 } };
    expect(recipeSlicing(recipe, ours)).toMatchObject({ layerHeight: 0.12, slicer: "spaghetti" });
    expect(recipeSlicing({ ...recipe, slicing: null }, ours).slicer).toBe("spaghetti");
  });
});
