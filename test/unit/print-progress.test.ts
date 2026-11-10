import { describe, expect, it } from "vitest";
import { doneBy, printProgress } from "../../src/shared/print-progress.ts";

const MINUTE = 60_000;
const start = Date.UTC(2026, 10, 10, 9, 0);

describe("printProgress", () => {
  it("says how long is left, with the fraction elapsed, under 90 minutes", () => {
    const result = printProgress(start, 75, start + 30 * MINUTE);
    expect(result.state).toBe("running");
    expect(result.fraction).toBeCloseTo(0.4);
    expect(result.label).toBe("About 45 min left");
  });

  it("counts hours and minutes down while it is under 90 minutes", () => {
    expect(printProgress(start, 120, start + 40 * MINUTE).label).toBe("About 1 h 20 min left");
  });

  it("names the time it will be done once more than 90 minutes are left", () => {
    const result = printProgress(start, 240, start + 10 * MINUTE);
    expect(result.state).toBe("running");
    expect(result.label).toMatch(/^Done around \d{1,2}[:.]\d{2}/);
    expect(result.fraction).toBeCloseTo(10 / 240);
  });

  it("writes the time like the rest of the app: a single-digit hour has no leading zero", () => {
    // Local 6:00 plus 3 h 5 min is 9:05, whatever the time zone.
    const early = new Date(2026, 10, 10, 6, 0).getTime();
    const label = printProgress(early, 185, early).label;
    expect(label).toMatch(/^Done around 9[:.]05/);
    expect(label).not.toMatch(/around 0/);
  });

  it("switches to the countdown just under 90 minutes left", () => {
    expect(printProgress(start, 190, start + 101 * MINUTE).label).toBe("About 1 h 29 min left");
    expect(printProgress(start, 190, start + 100 * MINUTE).label).toMatch(/^Done around/);
  });

  it("is due when the estimate has passed or is just reached", () => {
    for (const elapsed of [60, 61, 600]) {
      expect(printProgress(start, 60, start + elapsed * MINUTE)).toEqual({
        fraction: 1,
        state: "due",
        label: "Should be done by now",
      });
    }
  });

  it("has no fraction without an estimate", () => {
    for (const estimate of [undefined, 0, -5]) {
      expect(printProgress(start, estimate, start + 30 * MINUTE)).toEqual({
        fraction: null,
        state: "unknown",
        label: "On the bed now",
      });
    }
  });

  it("starts at zero, and never goes below it if the clocks disagree", () => {
    expect(printProgress(start, 60, start).fraction).toBe(0);
    expect(printProgress(start, 60, start - 5 * MINUTE).fraction).toBe(0);
  });

  it("never reports less than a minute left", () => {
    expect(printProgress(start, 60, start + 60 * MINUTE - 5_000).label).toBe("About 1 min left");
  });
});

describe("doneBy", () => {
  it("has nothing to say once the print is due", () => {
    expect(doneBy(start, 60, start + 60 * MINUTE)).toBeUndefined();
  });
});
