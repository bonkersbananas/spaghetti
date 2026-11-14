import { describe, expect, it } from "vitest";
import { plateSegments } from "../../src/client/components/viewer/plate-grid.ts";
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
    expect(gridOpacity(0)).toBeLessThan(0.9);
  });

  it("switches at the horizon, without easing, under reduced motion", () => {
    expect(plateSolidity(1, 400, true)).toBe(1);
    expect(plateSolidity(-1, 400, true)).toBe(0);
    expect(plateSolidity(0.5, 400, false)).toBeLessThan(1);
  });

  it("draws the plate's outline heavier than the lines across it", () => {
    const segments = plateSegments(256, 14, 32, 2.2, 1.1);
    const heaviest = Math.max(...segments.map((s) => s.width));
    expect(heaviest).toBe(2.2);
    expect(segments.filter((s) => s.width === 1.1)).toHaveLength(14); // 7 lines each way
    expect(segments.filter((s) => s.width === 2.2).length).toBeGreaterThan(8);
  });
});
