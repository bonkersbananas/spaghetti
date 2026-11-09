import { describe, expect, it } from "vitest";
import { validateUser } from "../../scripts/lib/users.ts";
import { initials } from "../../src/client/lib/initials.ts";

describe("validateUser", () => {
  const ok = { username: "sam", name: "Sam", color: "sea", password: "long enough" } as const;

  it("accepts a valid person", () => {
    expect(validateUser({ ...ok })).toBeNull();
  });

  it.each([
    [{ username: "Sam" }, /Username/],
    [{ username: "s" }, /Username/],
    [{ username: "sam smith" }, /Username/],
    [{ name: "  " }, /Name/],
    [{ color: "blue" }, /Color/],
    [{ password: "short" }, /Password/],
  ])("rejects %o", (change, message) => {
    expect(validateUser({ ...ok, ...change } as typeof ok)).toMatch(message);
  });
});

describe("initials", () => {
  it.each([
    ["Sam", "S"],
    ["Alex Rivera", "AR"],
    ["  ada   lovelace byron ", "AB"],
    ["", "?"],
  ])("%s → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});
