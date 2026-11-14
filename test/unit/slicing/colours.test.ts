import { describe, expect, it } from "vitest";
import { HOTDOG_COLOURS } from "../../../e2e/fixtures/model-3mf.ts";
import { colourDistance, matchColour, planColours, simplifyColours } from "../../../src/shared/slicing/colours.ts";

const uses = HOTDOG_COLOURS.map((c, index) => ({ hex: c.hex.toLowerCase(), name: c.name, area: 100 - index }));
const spool = (id: string, colorHex: string, extra = {}) => ({
  id,
  material: "PLA",
  colorHex,
  colorName: id,
  ...extra,
});

describe("simplifyColours", () => {
  it("merges colours that look the same, keeping the heavier one's", () => {
    const groups = simplifyColours(uses);
    // Ketchup and Tomato Red, Cream and Ivory merge: nine colours, two merges, six to print: the limit.
    expect(groups).toHaveLength(6);
    const red = groups.find((g) => g.name === "Ketchup Red");
    expect(red?.members.map((m) => m.name)).toEqual(["Ketchup Red", "Tomato Red"]);
    expect(red?.area).toBe(100 + 99);
  });

  it("merges the nearest pair again until the colours fit", () => {
    const groups = simplifyColours(uses, 3);
    expect(groups).toHaveLength(3);
    expect(groups.flatMap((g) => g.members)).toHaveLength(HOTDOG_COLOURS.length);
  });

  it("joins one colour used in several places, whatever its case", () => {
    const groups = simplifyColours([
      { hex: "#d2281e", area: 1 },
      { hex: "#d2281e", name: "Red", area: 2 },
    ]);
    expect(groups).toEqual([{ hex: "#d2281e", name: "Red", members: [{ hex: "#d2281e", name: "Red" }], area: 3 }]);
  });
});

describe("matchColour", () => {
  it("takes the nearest spool, PLA and loaded ones winning ties", () => {
    const match = matchColour({ hex: "#d2281e" }, [
      spool("far", "#2255cc"),
      spool("near", "#c8301f", { slot: "A1" }),
      spool("petg", "#d2281e", { material: "PETG" }),
    ]);
    // The PETG is exact, but the PLA is as good to the eye.
    expect(match).toMatchObject({ inPantry: true, filament: { spoolId: "near" } });
    const closeTie = matchColour({ hex: "#d2281e" }, [
      spool("shelf", "#d2281f"),
      spool("loaded", "#d2281e", { slot: "A2" }),
    ]);
    expect(closeTie.filament.spoolId).toBe("loaded");
  });

  it("makes a stand-in in the colour when no spool is near, or the Pantry is empty", () => {
    const far = matchColour({ hex: "#6e32a0", name: "purple" }, [spool("red", "#c0261c")]);
    expect(far).toEqual({ inPantry: false, filament: { material: "PLA", colorHex: "#6e32a0", colorName: "purple" } });
    expect(matchColour({ hex: "#6e32a0" }, []).inPantry).toBe(false);
  });

  it("leaves out empty spools and spools without a colour", () => {
    const match = matchColour({ hex: "#d2281e" }, [
      spool("gone", "#d2281e", { remaining: "empty" }),
      { id: "plain", material: "PLA" },
    ]);
    expect(match.inPantry).toBe(false);
  });
});

describe("planColours", () => {
  it("lists each filament once, heaviest colour first, and says which each model colour prints in", () => {
    const plan = planColours(uses, [spool("red", "#d0301f"), spool("cream", "#f2e9d4")]);
    expect(plan.groups[0]?.name).toBe("Ketchup Red");
    expect(plan.filaments[0]?.spoolId).toBe("red");
    // Both reds print in the one red spool.
    expect(plan.filamentOf.get("#cc3a2b")).toBe(plan.filamentOf.get("#d2281e"));
    const filamentIds = plan.filaments.map((f) => f.spoolId ?? f.colorHex);
    expect(new Set(filamentIds).size).toBe(filamentIds.length);
  });

  it("lets a choice win, and two colours on one spool print as one filament", () => {
    const spools = [spool("red", "#d0301f"), spool("blue", "#2255cc")];
    const two = [
      { hex: "#d2281e", area: 5 },
      { hex: "#2255cc", area: 4 },
    ];
    const chosen = planColours(two, spools, [{ from: "#2255cc", filament: { material: "PLA", spoolId: "red" } }]);
    expect(chosen.groups.map((g) => g.chosen)).toEqual([false, true]);
    // Blue is printed in the red spool: one filament for both.
    expect(chosen.filaments).toHaveLength(1);
    const apart = planColours(two, spools, [{ from: "#2255cc", filament: { material: "PETG", spoolId: "other" } }]);
    expect(apart.filaments).toHaveLength(2);
    const same = planColours(two, spools, [
      { from: "#2255cc", filament: { material: "PLA", colorHex: "#d0301f", spoolId: "red" } },
    ]);
    expect(same.filaments).toHaveLength(1);
  });
});

describe("colourDistance", () => {
  it("is 0 for one colour and large for black against white", () => {
    expect(colourDistance("#336699", "#336699")).toBe(0);
    expect(colourDistance("#000000", "#ffffff")).toBeGreaterThan(0.9);
  });
});
