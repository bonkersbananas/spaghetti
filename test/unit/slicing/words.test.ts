import { describe, expect, it } from "vitest";
import { defaultSettings } from "../../../src/shared/slicing/defaults.ts";
import type { FileSlice } from "../../../src/shared/slicing/types.ts";
import {
  finishesOnComputer,
  materialsText,
  printerName,
  problemSentence,
  sliceSummary,
  worthRetrying,
} from "../../../src/shared/slicing/words.ts";

const settings = { ...defaultSettings(), scale: 100, engine: "1", orca: "2.5.0-dev" };
const failed = (extra: Partial<FileSlice>): FileSlice => ({ status: "failed", settings, at: 0, ...extra });

describe("what a model's card says", () => {
  it("says how it was sliced in a few words", () => {
    expect(sliceSummary(settings)).toEqual(["0.20 mm", "PLA"]);
    expect(sliceSummary({ ...settings, supports: true, scale: 80, layerHeight: 0.16 })).toEqual([
      "0.16 mm",
      "PLA",
      "supports",
      "80%",
    ]);
    expect(materialsText(["PLA", "PLA", "PLA"])).toBe("PLA ×3");
    expect(materialsText(["PLA", "PETG", "PLA"])).toBe("PLA + PETG");
    expect(printerName("Bambu Lab X2D 0.4 nozzle")).toBe("X2D");
  });

  it("says why it couldn't be sliced, in one short sentence", () => {
    expect(problemSentence(failed({ problem: "too-big", dimensions: [312, 80, 40], volume: [256, 256, 261] }))).toBe(
      "Too big for the plate: 312 mm wide, the X2D takes 256.",
    );
    expect(problemSentence(failed({ problem: "too-big", dimensions: [80, 300, 40], volume: [256, 256, 261] }))).toBe(
      "Too big for the plate: 300 mm deep, the X2D takes 256.",
    );
    expect(problemSentence(failed({ problem: "too-tall", dimensions: [20, 20, 380], volume: [256, 256, 261] }))).toBe(
      "Too tall for the X2D: 380 mm high, it prints 261.",
    );
    expect(problemSentence(failed({ problem: "no-model" }))).toBe("This file has no model in it.");
    expect(problemSentence(failed({ problem: "memory", device: "phone" }), { phone: true })).toBe(
      "Slicing ran out of memory on this phone. It will finish on a laptop or desktop.",
    );
    expect(
      problemSentence(failed({ problem: "orca", message: "Nothing to be sliced, either the print is empty." })),
    ).toBe("OrcaSlicer couldn't slice it: Nothing to be sliced, either the print is empty.");
    expect(problemSentence(failed({ problem: "orca" }))).toBe("OrcaSlicer couldn't slice it.");
  });

  it("knows when trying again could help, and when a computer should finish what a phone couldn't", () => {
    expect(worthRetrying(failed({ problem: "engine" }))).toBe(true);
    expect(worthRetrying(failed({ problem: "too-big" }))).toBe(false);
    expect(finishesOnComputer(failed({ problem: "memory", device: "phone" }))).toBe(true);
    expect(finishesOnComputer(failed({ problem: "memory", device: "computer" }))).toBe(false);
    expect(finishesOnComputer(null)).toBe(false);
  });
});
