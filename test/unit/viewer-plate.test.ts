import { describe, expect, it } from "vitest";
import { plateSegments } from "../../src/client/components/viewer/plate-grid.ts";
import {
  gridOpacity,
  MAX_POLAR,
  plateLook,
  plateSolidity,
  SOLID_AT,
} from "../../src/client/components/viewer/plate-view.ts";

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

  it("is see-through as soon as the camera is level with the plate or under it", () => {
    // A 40 mm print is framed from about 160 mm away: just under the plate, and a grazing look along its top.
    for (const h of [-0.5, -5, -20, 0, 0.5, 1.5]) {
      expect(plateSolidity(h, 160)).toBe(0);
      expect(plateLook(plateSolidity(h, 160))).toBe("see-through");
    }
    // Just under the plate from far away too, and from close up.
    expect(plateSolidity(-1, 1200)).toBe(0);
    expect(plateSolidity(-0.2, 20)).toBe(0);
  });

  it("fades over the last few degrees above the plate, and is solid above them", () => {
    expect(plateLook(plateSolidity(160 * SOLID_AT, 160))).toBe("solid");
    expect(plateLook(plateSolidity(160 * Math.sin((5 * Math.PI) / 180), 160))).toBe("solid");
    expect(plateLook(plateSolidity(6, 160))).toBe("fading");
    // Tilting back up restores it.
    expect(plateSolidity(80, 160)).toBe(1);
  });

  it("switches a hair above the plate, without easing, under reduced motion", () => {
    expect(plateSolidity(20, 400, true)).toBe(1);
    expect(plateSolidity(1, 400, true)).toBe(0);
    expect(plateSolidity(-1, 400, true)).toBe(0);
    expect(plateSolidity(20, 400, false)).toBeLessThan(1);
  });

  it("draws the plate's outline heavier than the lines across it", () => {
    const segments = plateSegments(256, 14, 32, 2.2, 1.1);
    const heaviest = Math.max(...segments.map((s) => s.width));
    expect(heaviest).toBe(2.2);
    expect(segments.filter((s) => s.width === 1.1)).toHaveLength(14); // 7 lines each way
    expect(segments.filter((s) => s.width === 2.2).length).toBeGreaterThan(8);
  });
});
