import { describe, expect, it } from "vitest";
import { keepUnits } from "../../src/shared/typography.ts";

describe("keepUnits", () => {
  it("keeps a number on the line of its unit", () => {
    expect(keepUnits("Drawer bins, 42 mm grid")).toBe("Drawer bins, 42 mm grid");
    expect(keepUnits("0.2 mm layers at 215 °C, 15 % infill, 2 h")).toBe("0.2 mm layers at 215 °C, 15 % infill, 2 h");
  });

  it("leaves words that only start like a unit alone", () => {
    expect(keepUnits("3 mice and 2 hooks")).toBe("3 mice and 2 hooks");
  });
});
