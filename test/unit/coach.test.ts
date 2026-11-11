import { describe, expect, it } from "vitest";
import { coachApplies, coachChangeWords, sanitizeCoachSettings } from "../../src/shared/coach.ts";

const none = { brim: null, bedTemperature: null };

describe("the failure coach's rules", () => {
  it("keeps only what the printer has and what is a change", () => {
    const current = { bedTemperature: 60, brim: false };
    expect(sanitizeCoachSettings({ ...none, brim: true, bedTemperature: 65 }, current)).toEqual({
      brim: true,
      bedTemperature: 65,
    });
    // Beyond the X2D, unknown keys, odd plates and layer heights are dropped; so is what is already so.
    expect(
      sanitizeCoachSettings(
        { bedTemperature: 150, nozzleTemperature: 400, layerHeight: 0.5, bedType: "Glass", speed: 60, brim: false },
        current,
      ),
    ).toBeNull();
    expect(sanitizeCoachSettings({ nozzleTemperature: 300, layerHeight: 0.16, nozzleDiameter: 0.6 }, {})).toEqual({
      nozzleTemperature: 300,
      layerHeight: 0.16,
      nozzleDiameter: 0.6,
    });
    // A layer height the picker has no option for is dropped, not rounded.
    expect(sanitizeCoachSettings({ layerHeight: 0.15 }, {})).toBeNull();
    expect(sanitizeCoachSettings({ layerHeight: 0.22 }, {})).toBeNull();
    expect(sanitizeCoachSettings(null, {})).toBeNull();
  });

  it("tells what Use this fills in, in the words of the attempt's changes", () => {
    expect(coachChangeWords({ settings: { brim: true }, note: null }, {})).toEqual(["added a brim"]);
    expect(coachChangeWords({ settings: { bedTemperature: 65 }, note: null }, { bedTemperature: 60 })).toEqual([
      "bed 60 → 65 °C",
    ]);
    expect(coachChangeWords({ settings: null, note: "Outer wall 60 mm/s" }, {})).toEqual(["Outer wall 60 mm/s"]);
  });

  it("knows when tapping would change nothing", () => {
    const brim = { settings: { brim: true }, note: null };
    expect(coachApplies(brim, {}, "")).toBe(true);
    expect(coachApplies(brim, { brim: true }, "")).toBe(false);
    const wall = { settings: null, note: "Outer wall 60 mm/s" };
    expect(coachApplies(wall, {}, "")).toBe(true);
    expect(coachApplies(wall, {}, "Try it · Outer wall 60 mm/s")).toBe(false);
  });
});
