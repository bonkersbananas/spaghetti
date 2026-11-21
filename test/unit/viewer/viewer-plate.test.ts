import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readToolpaths } from "../../../src/shared/gcode/read-file.ts";
import { SLICED_PLATE, viewerPlate } from "../../../src/shared/slicing/files.ts";
import { packGcode3mf } from "../../../src/shared/slicing/gcode3mf.ts";

/** A few layers of real-looking moves: enough for the reader to find toolpaths. */
function gcode(layers: number): Uint8Array {
  const lines = ["; HEADER_BLOCK_START", `; total layer number: ${layers}`, "; HEADER_BLOCK_END", "G28", "M83"];
  for (let i = 0; i < layers; i++) {
    const z = (0.2 * (i + 1)).toFixed(2);
    lines.push("; CHANGE_LAYER", `; Z_HEIGHT: ${z}`, "; FEATURE: Outer wall", `G1 Z${z}`);
    lines.push("G1 X10 Y10", "G1 X30 Y10 E1", "G1 X30 Y30 E1", "G1 X10 Y30 E1", "G1 X10 Y10 E1");
  }
  return strToU8(lines.join("\n"));
}

/** What Spaghetti's slicer makes of plate 2 of a six-plate project: a file of one plate. */
function slicedPlate(): Uint8Array {
  return packGcode3mf({
    gcode: gcode(5),
    seconds: 600,
    grams: 4,
    layers: 5,
    objects: [{ name: "stand.stl", box: { min: [10, 10, 0], max: [30, 30, 1] } }],
    settings: { printer_model: "Bambu Lab X2D", layer_height: "0.2", filament_type: ["PLA"] },
    filaments: [{ type: "PLA", colour: "#0A2989" }],
    slicer: { name: "OrcaSlicer", version: "2.5.0-dev" },
    title: "pick+your+size",
  });
}

describe("the plate the 3D view reads", () => {
  it("is the sliced file's one plate for a model sliced from a project's later plate", async () => {
    // The row says which plate of the project it was (2 of 6); its slice has its G-code on plate 1.
    const plate = viewerPlate({ kind: "model", plate: 2 });
    expect(plate).toBe(SLICED_PLATE);
    const paths = await readToolpaths(new Blob([slicedPlate() as BlobPart]), { plate });
    expect(paths.stats.layers).toBe(5);
  });

  it("is the file's own plate for a slicer file someone added", () => {
    expect(viewerPlate({ kind: "slicer", plate: 3 })).toBe(3);
  });

  it("names the plates a file has when the one asked for isn't there", async () => {
    await expect(readToolpaths(new Blob([slicedPlate() as BlobPart]), { plate: 2 })).rejects.toThrow(
      "This file has toolpaths for plate 1, not plate 2.",
    );
    const two = zipSync({ "Metadata/plate_1.gcode": gcode(2), "Metadata/plate_3.gcode": gcode(2) });
    await expect(readToolpaths(new Blob([two as BlobPart]), { plate: 2 })).rejects.toThrow(/plates 1, 3, not plate 2/);
  });

  it("never says a file Spaghetti sliced was saved before slicing", async () => {
    const error = await readToolpaths(new Blob([slicedPlate() as BlobPart]), { plate: 2 }).catch((e: Error) => e);
    expect((error as Error).message).not.toMatch(/before slicing/);
  });
});
