import { describe, expect, it } from "vitest";
import { boxesStl } from "../../e2e/fixtures/model-stl.ts";
import { withFins } from "../../src/client/lib/slicing/fins.ts";
import { boundsOf, parseStl } from "../../src/shared/mesh.ts";

/** The screenshot routes' drying rack: an arm that starts in the air beside its post (e2e/slicing-settings.spec.ts). */
const rack = () => {
  const parsed = parseStl(
    boxesStl([
      { at: [0, 0, 0], size: [36, 36, 4] },
      { at: [12, 12, 4], size: [12, 12, 46] },
      { at: [30, 15, 34], size: [26, 6, 4] },
    ]),
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.mesh.positions;
};

describe("fins", () => {
  it("add breakaway walls under the arm of a drying rack, standing on the plate where the part is", async () => {
    const part = rack();
    const { positions, added } = await withFins(part, { layerHeight: 0.2, nozzle: 0.4 });
    expect(added).toBeGreaterThan(50);
    expect(positions.length).toBe(part.length + added * 9);
    expect(Array.from(positions.subarray(0, part.length))).toEqual(Array.from(part));
    const before = boundsOf({ positions: part });
    const after = boundsOf({ positions });
    // The part's own box is the rack's; the fins stay inside its footprint (or the pad just past it), on the plate.
    expect(after.min[2]).toBeCloseTo(before.min[2], 3);
    expect(after.max[2]).toBeCloseTo(before.max[2], 3);
    expect(after.size[0]).toBeGreaterThanOrEqual(before.size[0] - 1e-3);
    expect(after.size[0]).toBeLessThan(before.size[0] + 12);
    // Some fin lies under the arm (x 30–56, y 15–21, which is above z 34).
    let under = 0;
    for (let i = part.length; i < positions.length; i += 9) {
      const x = positions[i] as number;
      const y = positions[i + 1] as number;
      const z = positions[i + 2] as number;
      if (x > 30 && x < 56 && y > 12 && y < 24 && z < 34) under++;
    }
    expect(under).toBeGreaterThan(0);
  });
});
