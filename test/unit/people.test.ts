import { describe, expect, it } from "vitest";
import { displayName } from "../../src/shared/people.ts";

describe("displayName", () => {
  it("keeps a two-word name whole", () => {
    expect(displayName({ name: "Carl Oscar" })).toBe("Carl Oscar");
  });
  it("trims stray spaces but not words", () => {
    expect(displayName({ name: "  Marie  " })).toBe("Marie");
  });
  it("falls back when there is no person or name", () => {
    expect(displayName(undefined, "Someone")).toBe("Someone");
    expect(displayName({ name: " " }, "you")).toBe("you");
    expect(displayName(null)).toBe("");
  });
});
