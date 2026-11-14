import { describe, expect, it } from "vitest";
import { gridOpacity, MAX_POLAR, plateSolidity } from "../../src/client/components/viewer/plate-view.ts";

describe("the 3D view's orbit and plate", () => {
  it("lets the camera go under the plate, but not to the pole", () => {
    expect(MAX_POLAR).toBeGreaterThan(Math.PI / 2 + 1);
    expect(MAX_POLAR).toBeLessThan(Math.PI);
  });

  it("is solid from above and see-through from below, with no jump between", () => {
    expect(plateSolidity(300, 400)).toBe(1);
    expect(plateSolidity(-300, 400)).toBe(0);
    let last = 1;
    for (let h = 100; h >= -100; h -= 1) {
      const s = plateSolidity(h, 400);
      expect(s).toBeLessThanOrEqual(last);
      expect(last - s).toBeLessThan(0.1);
      last = s;
    }
  });

  it("shows the grid only as the slab fades", () => {
    expect(gridOpacity(1)).toBe(0);
    expect(gridOpacity(0)).toBeGreaterThan(0.3);
    expect(gridOpacity(0)).toBeLessThan(0.7);
  });
});
