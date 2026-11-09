import { describe, expect, it } from "vitest";
import {
  applyFileSettings,
  filamentFromFile,
  printablePlates,
  readThreeMf,
  sameAsFile,
  settingsFromFile,
  slicerName,
} from "../../../src/shared/threemf/index.ts";
import { modelHead, modelSettings, projectSettings, slicedFiles, zip } from "./fixtures.ts";

describe("settings from a slicer file", () => {
  const sliced = readThreeMf(zip(slicedFiles()));

  it("offers the sliced plates", () => {
    expect(printablePlates(sliced).map((plate) => plate.index)).toEqual([1, 2]);
    expect(slicerName(sliced)).toBe("BambuStudio 02.01.00.00");
  });

  it("reads plate 1 as attempt settings", () => {
    expect(settingsFromFile(sliced, 1)).toEqual({
      filaments: [
        { type: "PLA", colorHex: "#00ae42", profile: "Bambu PLA Basic" },
        { type: "PLA", colorHex: "#ffffff", profile: "Generic PLA" },
      ],
      bedType: "Textured PEI Plate",
      nozzleDiameter: 0.4,
      layerHeight: 0.2,
      infillDensity: 15,
      wallLoops: 3,
      supportEnabled: false,
      processPreset: "0.20mm Standard @BBL X2D",
      nozzleTemperature: 220,
      bedTemperature: 55,
      estimatedMinutes: 90,
      weightGrams: 23.5,
    });
  });

  it("takes the temperatures of the filament the plate uses", () => {
    const plate2 = settingsFromFile(sliced, 2);
    expect(plate2).toMatchObject({
      filaments: [{ type: "PETG", colorHex: "#c12e1f", profile: "Bambu PETG HF" }],
      supportEnabled: true,
      supportType: "normal",
      nozzleTemperature: 255,
      bedTemperature: 70,
      estimatedMinutes: 12,
      weightGrams: 3.1,
    });
  });

  it("falls back to the first plate, and reads a project file without estimates", () => {
    expect(settingsFromFile(sliced, 99).estimatedMinutes).toBe(90);
    const project = readThreeMf(
      zip({
        "3D/3dmodel.model": modelHead("OrcaSlicer-2.3.1"),
        "Metadata/model_settings.config": modelSettings,
        "Metadata/project_settings.config": projectSettings,
      }),
    );
    expect(printablePlates(project).map((plate) => plate.index)).toEqual([1, 2]);
    const settings = settingsFromFile(project, 1);
    expect(settings.estimatedMinutes).toBeUndefined();
    expect(settings.weightGrams).toBeUndefined();
    expect(settings.filaments?.map((f) => f.type)).toEqual(["PLA", "PLA"]);
    expect(settings.layerHeight).toBe(0.2);
  });

  it("gives nothing for a file it can't read", () => {
    expect(settingsFromFile(readThreeMf(new Uint8Array([1, 2, 3])))).toEqual({});
  });
});

describe("laying a file over an attempt", () => {
  it("replaces what the file knows and keeps the rest", () => {
    const current = {
      filaments: [{ type: "PLA", colorHex: "#00ae42", spoolId: "s1", brand: "Bambu", colorName: "Green" }],
      brim: true,
      chamberTemperature: 35,
      layerHeight: 0.16,
      supportEnabled: true,
      supportType: "tree" as const,
    };
    const fromFile = {
      filaments: [
        { type: "PLA", colorHex: "#00ae42", profile: "Bambu PLA Basic" },
        { type: "PETG", colorHex: "#ffffff" },
      ],
      layerHeight: 0.2,
      supportEnabled: false,
    };
    expect(applyFileSettings(current, fromFile)).toEqual({
      filaments: [
        {
          type: "PLA",
          colorHex: "#00ae42",
          spoolId: "s1",
          brand: "Bambu",
          colorName: "Green",
          profile: "Bambu PLA Basic",
        },
        { type: "PETG", colorHex: "#ffffff" },
      ],
      brim: true,
      chamberTemperature: 35,
      layerHeight: 0.2,
      supportEnabled: false,
    });
  });

  it("knows which values still come from the file", () => {
    const fromFile = { layerHeight: 0.2, filaments: [{ type: "PLA", colorHex: "#ffffff" }] };
    expect(sameAsFile("layerHeight", { layerHeight: 0.2 }, fromFile)).toBe(true);
    expect(sameAsFile("layerHeight", { layerHeight: 0.16 }, fromFile)).toBe(false);
    expect(sameAsFile("bedType", { bedType: "Cool Plate" }, fromFile)).toBe(false);
    expect(sameAsFile("layerHeight", { layerHeight: 0.2 }, undefined)).toBe(false);
    const linked = { filaments: [{ type: "pla", colorHex: "#ffffff", spoolId: "s1", brand: "Sunlu" }] };
    expect(filamentFromFile(0, linked, fromFile)).toBe(true);
    expect(filamentFromFile(0, { filaments: [{ type: "PETG", colorHex: "#ffffff" }] }, fromFile)).toBe(false);
    expect(filamentFromFile(1, linked, fromFile)).toBe(false);
  });
});
