import { describe, expect, it } from "vitest";
import { scaleMesh } from "../../../src/shared/mesh.ts";
import { arrangeOnPlate, boundsOf, plateArea } from "../../../src/shared/slicing/arrange.ts";
import { finiteTriangles, fitPercent, sizeOf } from "../../../src/shared/slicing/fit.ts";
import { box } from "./meshes.ts";

const X2D: [number, number, number] = [256, 256, 261];

describe("fitPercent", () => {
  it("is the largest whole percent at which it fits with room to spare, never above 100", () => {
    expect(fitPercent([400, 40, 20], X2D)).toBe(61);
    expect(fitPercent([320, 100, 4], X2D)).toBe(76);
    expect(fitPercent([20, 20, 400], X2D)).toBe(64);
    expect(fitPercent([100, 100, 100], X2D)).toBe(100);
    expect(fitPercent([256, 10, 10], X2D, 0)).toBe(100);
  });

  it("is a scale at which a model too big for the plate goes on it (scaled with the shared mesh code)", () => {
    const sheet = box([0, 0, 0], [320, 100, 4]);
    const percent = fitPercent(sizeOf(boundsOf(sheet)), X2D);
    const plate = plateArea(["0x0", "256x0", "256x256", "0x256"], "261");
    expect(arrangeOnPlate([{ positions: sheet }], plate)).toBe("too-big");
    const scaled = { positions: scaleMesh({ positions: sheet }, percent / 100).positions };
    expect(arrangeOnPlate([scaled], plate)).toBeNull();
    expect(sizeOf(boundsOf(scaled.positions))[0]).toBeCloseTo(243.2, 1);
  });
});

describe("finiteTriangles", () => {
  it("leaves out triangles with a corner that isn't a number, and keeps a sound mesh as it is", () => {
    const sound = box([0, 0, 0], [10, 10, 10]);
    expect(finiteTriangles(sound)).toBe(sound);
    const broken = sound.slice();
    broken[13] = Number.POSITIVE_INFINITY;
    expect(finiteTriangles(broken).length).toBe(11 * 9);
  });
});
