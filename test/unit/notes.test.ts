import { describe, expect, it } from "vitest";
import { noteSize } from "../../src/shared/notes.ts";

describe("noteSize", () => {
  it("sets short notes large and steps down as they grow", () => {
    expect(noteSize("Hook for the bike helmet")).toBe("xl");
    expect(noteSize("Bag clips for the coffee, with a little spoon holder on the side.")).toBe("lg");
    expect(
      noteSize("Replacement knob for the oven, 6 mm D-shaft. Measure the old one before it breaks completely."),
    ).toBe("md");
    expect(noteSize("word ".repeat(40))).toBe("sm");
  });

  it("counts a new paragraph as a line's worth", () => {
    expect(noteSize("Hook for the bike\n\nhelmet")).toBe("lg");
  });

  it("steps down when a word wouldn't fit on one line", () => {
    expect(noteSize("Lithophanes")).toBe("lg");
    expect(noteSize("printables.com/model/123456-drawer-bins")).toBe("sm");
  });
});
