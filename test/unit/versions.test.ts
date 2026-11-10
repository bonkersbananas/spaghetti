import { describe, expect, it } from "vitest";
import { parseVersion, satisfiesMinimum } from "../../scripts/lib/versions.ts";

describe("pnpm doctor versions", () => {
  it("parses versions with or without a leading v", () => {
    expect(parseVersion("v26.13.0")).toEqual([26, 13, 0]);
    expect(parseVersion("24")).toEqual([24, 0, 0]);
  });

  it("checks a minimum version", () => {
    expect(satisfiesMinimum("v22.14.0", ">=24")).toBe(false);
    expect(satisfiesMinimum("v24.0.0", ">=24")).toBe(true);
    expect(satisfiesMinimum("v26.13.0", ">=24")).toBe(true);
    expect(satisfiesMinimum("v24.1.0", ">=24.2")).toBe(false);
    expect(satisfiesMinimum("12.18.0", ">=12")).toBe(true);
  });
});
