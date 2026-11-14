import { describe, expect, it } from "vitest";
import { boxesStl, fusilliStl } from "../../../e2e/fixtures/model-stl.ts";
import { parseStl } from "../../../src/shared/mesh.ts";
import { hasFloatingPart } from "../../../src/shared/slicing/floating.ts";

// Whether a model has a part that starts in the air, which OrcaSlicer's engine warns of and Spaghetti's own slicer
// can't yet (decision 0055): the slice worker lets the engine slice such a model when it has no supports.

type Vec = [number, number, number];
const box = (at: Vec, size: Vec) => ({ at, size });
const mesh = (stl: Uint8Array) => {
  const parsed = parseStl(stl);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.mesh.positions;
};
const floats = (...boxes: { at: Vec; size: Vec }[]) => hasFloatingPart([mesh(boxesStl(boxes))], CUT);
/** Where the X2D's first layer is cut (half its 0.2 mm), and a Standard layer. */
const CUT = { above: 0.1, layer: 0.2 };

/** A square pyramid pointing down, its tip at `tip`, closed by its square top. */
function pyramid([x, y, z]: Vec, half: number, height: number): Float32Array {
  const top = z + height;
  const a = [x - half, y - half, top];
  const b = [x + half, y - half, top];
  const c = [x + half, y + half, top];
  const d = [x - half, y + half, top];
  const tip = [x, y, z];
  return new Float32Array([tip, b, a, tip, c, b, tip, d, c, tip, a, d, a, b, c, a, c, d].flat());
}

describe("a part that starts in the air", () => {
  it("isn't in a block on the plate, nor in one a hair above it", () => {
    expect(floats(box([0, 0, 0], [20, 20, 20]))).toBe(false);
    expect(floats(box([0, 0, 0.05], [20, 20, 20]))).toBe(false);
  });

  it("is an arm beside its post, as OrcaSlicer's engine warns of the drying rack (slicing-settings.spec.ts)", () => {
    expect(floats(box([0, 0, 0], [36, 36, 4]), box([12, 12, 4], [12, 12, 46]), box([30, 15, 34], [26, 6, 4]))).toBe(
      true,
    );
  });

  it("is an arm above a base that it doesn't touch: what is under it is a layer far down", () => {
    expect(floats(box([0, 0, 0], [60, 36, 4]), box([0, 0, 4], [8, 8, 40]), box([20, 10, 30], [30, 6, 4]))).toBe(true);
  });

  it("isn't a part standing on another shell, sunk into it, or held in its middle by one", () => {
    expect(floats(box([0, 0, 0], [36, 36, 4]), box([12, 12, 4], [12, 12, 46]))).toBe(false);
    expect(floats(box([0, 0, 0], [36, 36, 4]), box([12, 12, 2], [12, 12, 46]))).toBe(false);
    expect(floats(box([0, 0, 0], [40, 40, 2]), box([15, 15, 2], [10, 10, 30]), box([10, 15, 20], [20, 10, 5]))).toBe(
      false,
    );
  });

  it("is a tip pointing down in the air, and not one resting in a block", () => {
    const base = mesh(boxesStl([box([0, 0, 0], [20, 20, 4])]));
    expect(hasFloatingPart([base, pyramid([40, 10, 10], 5, 10)], CUT)).toBe(true);
    const block = mesh(boxesStl([box([0, 0, 0], [20, 20, 10])]));
    expect(hasFloatingPart([block, pyramid([10, 10, 9.5], 5, 10)], CUT)).toBe(false);
  });

  it("isn't in a model with some shape to it that stands on the plate", () => {
    expect(hasFloatingPart([mesh(fusilliStl())], CUT)).toBe(false);
  });

  it("is in any of the plate's objects", () => {
    const standing = mesh(boxesStl([box([0, 0, 0], [20, 20, 20])]));
    const hanging = mesh(boxesStl([box([60, 0, 5], [10, 10, 10])]));
    expect(hasFloatingPart([standing], CUT)).toBe(false);
    expect(hasFloatingPart([standing, hanging], CUT)).toBe(true);
  });

  it("isn't looked for in nothing", () => {
    expect(hasFloatingPart([], CUT)).toBe(false);
    expect(hasFloatingPart([new Float32Array()], CUT)).toBe(false);
  });
});
