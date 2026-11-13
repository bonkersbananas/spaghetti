import { describe, expect, it } from "vitest";
import { arrangeOnPlate, boundsOf, fitsAsPlaced, plateArea, unionOf } from "../../../src/shared/slicing/arrange.ts";
import { box } from "./meshes.ts";

const X2D = plateArea(["0x0", "256x0", "256x256", "0x256"], "261");

describe("plateArea", () => {
  it("reads the machine's printable area, as a list or one string", () => {
    expect(X2D).toEqual({ minX: 0, minY: 0, maxX: 256, maxY: 256, height: 261 });
    expect(plateArea("0x0,180x0,180x180,0x180", undefined)).toEqual({
      minX: 0,
      minY: 0,
      maxX: 180,
      maxY: 180,
      height: 250,
    });
  });
});

describe("arrangeOnPlate", () => {
  it("stands one object on the bed in the middle of the plate", () => {
    const object = { positions: box([-500, 30, -12], [-480, 50, 8]) };
    expect(arrangeOnPlate([object], X2D)).toBeNull();
    const placed = boundsOf(object.positions);
    expect(placed.min[2]).toBeCloseTo(0);
    expect((placed.min[0] + placed.max[0]) / 2).toBeCloseTo(128);
    expect((placed.min[1] + placed.max[1]) / 2).toBeCloseTo(128);
  });

  it("lays several out in rows, apart, all on the plate", () => {
    const objects = Array.from({ length: 7 }, (_, index) => ({
      positions: box([0, 0, 0], [60 + index, 40, 10 + index]),
    }));
    expect(arrangeOnPlate(objects, X2D)).toBeNull();
    const boxes = objects.map((object) => boundsOf(object.positions));
    expect(fitsAsPlaced(boxes, X2D)).toBe(true);
    for (const [i, a] of boxes.entries()) {
      expect(a.min[2]).toBeCloseTo(0);
      for (const b of boxes.slice(i + 1)) {
        const apart =
          a.max[0] + 5.9 <= b.min[0] ||
          b.max[0] + 5.9 <= a.min[0] ||
          a.max[1] + 5.9 <= b.min[1] ||
          b.max[1] + 5.9 <= a.min[1];
        expect(apart).toBe(true);
      }
    }
    const all = unionOf(boxes);
    expect(((all?.min[0] ?? 0) + (all?.max[0] ?? 0)) / 2).toBeCloseTo(128, 0);
  });

  it("says why it can't: too big, too tall, or too many for one plate, and moves nothing", () => {
    const long = { positions: box([0, 0, 0], [300, 20, 5]) };
    const before = long.positions.slice();
    expect(arrangeOnPlate([long], X2D)).toBe("too-big");
    expect([...long.positions]).toEqual([...before]);
    expect(arrangeOnPlate([{ positions: box([0, 0, 0], [20, 20, 300]) }], X2D)).toBe("too-tall");
    const many = Array.from({ length: 9 }, () => ({ positions: box([0, 0, 0], [120, 120, 5]) }));
    expect(arrangeOnPlate(many, X2D)).toBe("too-many");
  });
});

describe("fitsAsPlaced", () => {
  it("keeps a project's layout only when every object is on the plate and not too tall", () => {
    expect(fitsAsPlaced([boundsOf(box([10, 10, 0], [50, 50, 20]))], X2D)).toBe(true);
    expect(fitsAsPlaced([boundsOf(box([240, 10, 0], [270, 50, 20]))], X2D)).toBe(false);
    expect(fitsAsPlaced([boundsOf(box([10, 10, 0], [50, 50, 270]))], X2D)).toBe(false);
  });
});
