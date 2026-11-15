import { describe, expect, it } from "vitest";
import { namesPerson } from "../../src/shared/people.ts";

describe("namesPerson", () => {
  const sam = { name: "Sam Okafor" };
  const carlOscar = { name: "Carl Oscar" };

  it("reads the full name or its first word, in any case", () => {
    expect(namesPerson("Sam", sam)).toBe(true);
    expect(namesPerson(" sam okafor ", sam)).toBe(true);
    expect(namesPerson("Carl Oscar", carlOscar)).toBe(true);
  });

  it("does not take a part of a name that is not its first word, nor someone else", () => {
    expect(namesPerson("Okafor", sam)).toBe(false);
    expect(namesPerson("Carl", carlOscar)).toBe(true);
    expect(namesPerson("Mila", sam)).toBe(false);
    expect(namesPerson("", sam)).toBe(false);
    expect(namesPerson(null, sam)).toBe(false);
    expect(namesPerson("Sam", undefined)).toBe(false);
  });
});
