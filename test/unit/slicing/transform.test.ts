import { describe, expect, it } from "vitest";
import { boundsOf } from "../../../src/shared/slicing/arrange.ts";
import { fitPercent, fitToLength, scaleMesh, sizeOf } from "../../../src/shared/slicing/transform.ts";
import { box } from "./meshes.ts";

describe("scaleMesh", () => {
  it("is a new mesh, scaled about its centre on the plate: it stays where it stands", () => {
    const mesh = box([100, 40, 0], [140, 60, 30]);
    const before = mesh.slice();
    const half = scaleMesh(mesh, 0.5);
    expect([...mesh]).toEqual([...before]);
    const bounds = boundsOf(half);
    expect(sizeOf(bounds)).toEqual([20, 10, 15]);
    expect(bounds.min).toEqual([110, 45, 0]);
  });
});

describe("fitPercent", () => {
  const X2D: [number, number, number] = [256, 256, 261];

  it("is the largest whole percent at which it fits with room to spare, never above 100", () => {
    expect(fitPercent([400, 40, 20], X2D)).toBe(61);
    expect(fitPercent([320, 100, 4], X2D)).toBe(76);
    expect(fitPercent([20, 20, 400], X2D)).toBe(64);
    expect(fitPercent([100, 100, 100], X2D)).toBe(100);
    expect(fitPercent([256, 10, 10], X2D, 0)).toBe(100);
  });
});

describe("fitToLength", () => {
  it("scales the longest side to a length, larger or smaller (a twist's 'fit to 120 mm')", () => {
    const mesh = box([0, 0, 0], [60, 30, 15]);
    expect(sizeOf(boundsOf(fitToLength(mesh, 120)))).toEqual([120, 60, 30]);
    expect(sizeOf(boundsOf(fitToLength(mesh, 30)))).toEqual([30, 15, 7.5]);
    expect([...fitToLength(mesh, 0)]).toEqual([...mesh]);
  });
});
