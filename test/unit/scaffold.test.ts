import { describe, expect, it } from "vitest";
import { insertBefore, singular, toCamel, toKebab, toLabel, toPascal, validName } from "../../scripts/lib/scaffold.ts";

describe("pnpm new names", () => {
  it("converts between cases", () => {
    expect(toKebab("Print queue")).toBe("print-queue");
    expect(toKebab("printQueue")).toBe("print-queue");
    expect(toPascal("print-queue")).toBe("PrintQueue");
    expect(toCamel("print-queue")).toBe("printQueue");
    expect(toLabel("print-queue")).toBe("Print queue");
  });

  it("singularizes resource names", () => {
    expect(singular("reminders")).toBe("reminder");
    expect(singular("batteries")).toBe("battery");
    expect(singular("status")).toBe("status");
  });

  it("only accepts names that make files", () => {
    expect(validName("maintenance")).toBe(true);
    expect(validName("../x")).toBe(false);
    expect(validName("1st")).toBe(false);
    expect(validName(undefined)).toBe(false);
  });

  it("inserts a line before a marker, or says it isn't there", () => {
    expect(insertBefore("a\nb\nc", "b", "x")).toBe("a\nx\nb\nc");
    expect(insertBefore("a\nb", /^c/, "x")).toBeNull();
  });
});
