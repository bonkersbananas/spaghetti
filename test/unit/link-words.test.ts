import { describe, expect, it } from "vitest";
import { linkWords } from "../../src/shared/links.ts";

describe("linkWords", () => {
  it("reads the words of a link's slug, without ids, numbers or the extension, with its site", () => {
    expect(linkWords("https://www.ikea.com/se/en/p/skadis-pegboard-white-20320802/")).toEqual({
      words: "Skadis pegboard white",
      site: "ikea.com",
    });
    expect(linkWords("makerworld.com/en/models/487213-drawer-bins")).toEqual({
      words: "Drawer bins",
      site: "makerworld.com",
    });
    expect(linkWords("https://files.example.org/bearing-cube.stl")?.words).toBe("Bearing cube");
  });

  it("has nothing to say for a link without words", () => {
    expect(linkWords("https://example.com")).toBeUndefined();
    expect(linkWords("https://www.thingiverse.com/thing:12345")).toBeUndefined();
    expect(linkWords("https://www.amazon.se/dp/B0ABC12345")).toBeUndefined();
  });
});
