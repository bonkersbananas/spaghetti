import { describe, expect, it } from "vitest";
import { cleanFileName, slicedName } from "../../src/shared/slicing/files.ts";

describe("cleanFileName", () => {
  it.each([
    ["marshmellow (1).3mf", "marshmellow.3mf"],
    ["marshmellow(2).3mf", "marshmellow.3mf"],
    ["hotdog_hero_4color_multicolor.gcode (3) copy.3mf", "hotdog_hero_4color_multicolor.gcode.3mf"],
    ["hotdog_hero_4color_multicolor.gcode(9).3mf", "hotdog_hero_4color_multicolor.gcode.3mf"],
    ["3DBenchy-x2d.gcode(2).3mf", "3DBenchy-x2d.gcode.3mf"],
    ["hotdog_hero_4color_multicolor.gcode-2.3mf", "hotdog_hero_4color_multicolor.gcode.3mf"],
    ["hawg-dawg-man.3mf", "hawg-dawg-man.3mf"],
    ["hotdog_hero_4color_30mm_multicolor.3mf", "hotdog_hero_4color_30mm_multicolor.3mf"],
    ["bracket copy.stl", "bracket.stl"],
    ["bracket copy 2.stl", "bracket.stl"],
    ["bracket-v2.stl", "bracket-v2.stl"],
    ["m3-8.stl", "m3-8.stl"],
    ["(1).3mf", "(1).3mf"],
    ["no extension (1)", "no extension (1)"],
  ])("%s → %s", (name, clean) => {
    expect(cleanFileName(name)).toBe(clean);
  });

  it("names a sliced file from the clean name", () => {
    expect(slicedName("marshmellow (1).3mf")).toBe("marshmellow.gcode.3mf");
  });
});
