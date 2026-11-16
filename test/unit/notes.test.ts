import { describe, expect, it } from "vitest";
import { hyphenateLongWords, noteSize } from "../../src/shared/notes.ts";

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

describe("hyphenateLongWords", () => {
  it("leaves words that fit a line alone", () => {
    expect(hyphenateLongWords("Desk tidy-up with clips and a drawer bin")).toBe(
      "Desk tidy-up with clips and a drawer bin",
    );
  });

  it("lets a word too long for any line break between letters, never at its ends", () => {
    const out = hyphenateLongWords("Supercalifragilisticexpialidocious desk");
    expect(out.replaceAll("\u00ad", "")).toBe("Supercalifragilisticexpialidocious desk");
    expect(out.startsWith("Sup\u00ad")).toBe(true);
    expect(out.endsWith("c\u00adi\u00adous desk")).toBe(true);
    expect(out).not.toMatch(/\u00ad\S{0,2}\s/);
  });

  it("only breaks between letters", () => {
    expect(hyphenateLongWords("printables.com/model/123456", 10)).not.toMatch(/[^\p{L}]\u00ad|\u00ad[^\p{L}]/u);
  });
});
