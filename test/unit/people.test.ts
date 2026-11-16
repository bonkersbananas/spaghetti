import { describe, expect, it } from "vitest";
import { displayName, withoutOwner } from "../../src/shared/people.ts";

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

describe("withoutOwner", () => {
  it("says the owner once when they are named beside it", () => {
    expect(withoutOwner("Claude for Alex", "Alex Rivera")).toBe("Claude");
    expect(withoutOwner("Claude for Carl Oscar", "Carl Oscar")).toBe("Claude");
    expect(withoutOwner("claude FOR alex", "Alex")).toBe("claude");
  });

  it("keeps any other name as it is", () => {
    expect(withoutOwner("Share from iPhone", "Sam Okafor")).toBe("Share from iPhone");
    expect(withoutOwner("Claude for Alex", "Sam Okafor")).toBe("Claude for Alex");
    expect(withoutOwner("Claude for Alexandra", "Alex")).toBe("Claude for Alexandra");
    expect(withoutOwner(" for Alex", "Alex")).toBe(" for Alex");
    expect(withoutOwner("Claude for Alex")).toBe("Claude for Alex");
  });
});
