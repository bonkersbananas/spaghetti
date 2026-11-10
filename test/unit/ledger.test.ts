import { describe, expect, it } from "vitest";
import {
  attemptUsage,
  gramsFromScale,
  isRunningLow,
  levelFromGrams,
  levelOf,
  notEnough,
  notEnoughText,
  spoolGrams,
  type Usage,
} from "../../src/shared/ledger.ts";
import { settingsFromFile } from "../../src/shared/threemf/prefill.ts";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const attempt = (fields: Partial<Parameters<typeof attemptUsage>[0]> = {}) => ({
  id: "t1",
  outcome: "success" as const,
  at: 1000,
  settings: { filaments: [{ spoolId: A, grams: 66 }, { spoolId: B, grams: 12.5 }] },
  ...fields,
});

describe("usage of an attempt", () => {
  it("takes the full grams of a print that worked or partly worked", () => {
    for (const outcome of ["success", "partial"] as const) {
      const usage = attemptUsage(attempt({ outcome }));
      expect(usage.map((u) => [u.spoolId, u.grams, u.approximate])).toEqual([
        [A, 66, false],
        [B, 12.5, false],
      ]);
    }
  });

  it("counts a failed print in proportion to how far it got, as about", () => {
    const usage = attemptUsage(
      attempt({ outcome: "failed", settings: { filaments: [{ spoolId: A, grams: 80 }], failedAtPercent: 25 } }),
    );
    expect(usage).toMatchObject([{ spoolId: A, grams: 20, approximate: true }]);
  });

  it("counts a failed print with no failed-at in full, still as about", () => {
    expect(attemptUsage(attempt({ outcome: "failed" }))[0]).toMatchObject({ grams: 66, approximate: true });
  });

  it("uses nothing while printing or off the bed, and nothing for filaments with no spool or grams", () => {
    expect(attemptUsage(attempt({ outcome: null }))).toEqual([]);
    expect(attemptUsage(attempt({ settings: { filaments: [{ grams: 10 }, { spoolId: A }] } }))).toEqual([]);
  });

  it("falls back to the attempt's total for a lone filament, and adds a spool used twice", () => {
    expect(attemptUsage(attempt({ settings: { filaments: [{ spoolId: A }], weightGrams: 40 } }))[0]?.grams).toBe(40);
    expect(attemptUsage(attempt({ settings: { filaments: [{ spoolId: A }, { spoolId: B }], weightGrams: 40 } }))).toEqual(
      [],
    );
    expect(
      attemptUsage(attempt({ settings: { filaments: [{ spoolId: A, grams: 10 }, { spoolId: A, grams: 5 }] } })),
    ).toMatchObject([{ grams: 15 }]);
  });

  it("reads per-filament grams from a slicer file's settings", () => {
    const settings = settingsFromFile({
      kind: "gcode",
      settings: {},
      plates: [
        {
          index: 1,
          objects: [],
          predictedSeconds: 600,
          filaments: [{ slot: 1, type: "PLA", usedGrams: 66.04 }],
        },
      ],
    } as never);
    expect(settings.filaments?.[0]?.grams).toBe(66);
  });
});

describe("grams left", () => {
  const spool = { netGrams: 1000, tareGrams: 250 };
  const use = (grams: number, at: number, approximate = false): Usage => ({
    attemptId: `a${at}`,
    spoolId: A,
    grams,
    approximate,
    at,
  });

  it("starts from the net weight and counts usage down", () => {
    expect(spoolGrams(spool, [], [use(66, 1), use(34, 2)]).gramsLeft).toBe(900);
  });

  it("has no grams without a net weight or weighing: the hand-set level stays", () => {
    const none = spoolGrams({ netGrams: null, tareGrams: null }, [], [use(66, 1)]);
    expect(none.gramsLeft).toBeNull();
    expect(levelOf({ remaining: "low", gramsLeft: null, netGrams: null })).toBe("low");
  });

  it("starts again from a weighing, counting only what came after it", () => {
    const weighing = { id: "w", gramsLeft: 562, onScale: 812, at: 10 };
    const result = spoolGrams(spool, [weighing], [use(66, 5), use(30, 12)]);
    expect(result.gramsLeft).toBe(532);
    expect(result.used.map((u) => u.at)).toEqual([12]);
    expect(result.weighedAt).toBe(10);
  });

  it("uses the latest of several weighings, and a weighing alone gives grams for a spool with no net weight", () => {
    const weighings = [
      { id: "w1", gramsLeft: 700, onScale: null, at: 5 },
      { id: "w2", gramsLeft: 600, onScale: null, at: 8 },
    ];
    expect(spoolGrams({ netGrams: null, tareGrams: null }, weighings, []).gramsLeft).toBe(600);
  });

  it("recomputes when an attempt is edited, deleted or restored, and never goes below zero", () => {
    expect(spoolGrams(spool, [], [use(66, 1)]).gramsLeft).toBe(934);
    expect(spoolGrams(spool, [], []).gramsLeft).toBe(1000);
    expect(spoolGrams(spool, [], [use(66, 1)]).gramsLeft).toBe(934);
    expect(spoolGrams(spool, [], [use(1500, 1)]).gramsLeft).toBe(0);
  });

  it("marks the figure approximate when a failed print was counted", () => {
    expect(spoolGrams(spool, [], [use(20, 1, true)]).approximate).toBe(true);
    expect(spoolGrams(spool, [], [use(20, 1)]).approximate).toBe(false);
  });

  it("takes the empty spool off a scale weight", () => {
    expect(gramsFromScale(812, 250)).toBe(562);
    expect(gramsFromScale(100, 250)).toBe(0);
    expect(gramsFromScale(812, null)).toBe(812);
  });
});

describe("levels", () => {
  it("follow the thresholds: full from 70 %, half from 30 %, low from 8 %, empty below", () => {
    const at = (left: number) => levelFromGrams(left, 1000);
    expect([1000, 700, 699, 300, 299, 80, 79, 0].map(at)).toEqual([
      "full",
      "full",
      "half",
      "half",
      "low",
      "low",
      "empty",
      "empty",
    ]);
    expect(levelFromGrams(100, 250)).toBe("half");
  });

  it("the Running low list holds low and empty spools and anything at 100 g or less", () => {
    expect(isRunningLow({ remaining: "half", gramsLeft: 420 })).toBe(false);
    expect(isRunningLow({ remaining: "low", gramsLeft: null })).toBe(true);
    expect(isRunningLow({ remaining: "half", gramsLeft: 100 })).toBe(true);
    expect(isRunningLow({ remaining: "empty", gramsLeft: 0 })).toBe(true);
  });
});

describe("not enough for this print", () => {
  const spools = [
    { id: A, gramsLeft: 40, colorName: "Sunflower yellow", material: "PLA" },
    { id: B, gramsLeft: null, colorName: "Blue", material: "PLA" },
  ];

  it("says which filament is short, and ignores spools without grams", () => {
    const found = notEnough({ filaments: [{ spoolId: A, grams: 66 }, { spoolId: B, grams: 500 }] }, spools);
    expect(found).toHaveLength(1);
    expect(notEnoughText(found[0] as (typeof found)[number])).toBe(
      "Sunflower yellow has about 40 g left; this plate needs 66 g.",
    );
  });

  it("is quiet when there is enough, or the file said nothing", () => {
    expect(notEnough({ filaments: [{ spoolId: A, grams: 40 }] }, spools)).toEqual([]);
    expect(notEnough({ filaments: [{ spoolId: A }, { spoolId: B, grams: 10 }] }, spools)).toEqual([]);
  });
});
