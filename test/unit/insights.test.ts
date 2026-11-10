import { describe, expect, it } from "vitest";
import type { AttemptSettings, Outcome } from "../../src/shared/attempts.ts";
import {
  changePhrases,
  computeInsights,
  fixSentence,
  type InsightAttempt,
  localParts,
  successRates,
} from "../../src/shared/insights.ts";

let n = 0;
const at = (
  itemId: string,
  day: number,
  outcome: Outcome | null,
  settings: AttemptSettings = {},
  failureTags: string[] = [],
  month = 2,
): InsightAttempt => ({
  id: `a${++n}`,
  itemId,
  outcome,
  printedAt: Date.UTC(2026, month, day, 12),
  createdAt: Date.UTC(2026, month, day, 12),
  failureTags,
  settings,
});

describe("localParts", () => {
  it("puts New Year's Eve late evening in the viewer's year", () => {
    const t = Date.UTC(2027, 0, 1, 1, 30);
    expect(localParts(t, 0).year).toBe(2027);
    expect(localParts(t, 120).year).toBe(2026); // two hours behind UTC
  });
});

describe("changePhrases", () => {
  it("names changes so they add up across prints", () => {
    expect(changePhrases({ bedTemperature: 55 }, { bedTemperature: 65, brim: true }).sort()).toEqual([
      "a brim",
      "a warmer bed",
    ]);
    expect(changePhrases({ bedTemperature: 65 }, { bedTemperature: 55 })).toEqual(["a cooler bed"]);
    expect(changePhrases({ brim: true }, { brim: true })).toEqual([]);
  });
});

describe("successRates", () => {
  it("counts attempts with an outcome per group, biggest group first", () => {
    const rows = successRates(
      [
        { outcome: "success", settings: { filaments: [{ type: "PLA" }] } },
        { outcome: "failed", settings: { filaments: [{ type: "pla" }] } },
        { outcome: "success", settings: { filaments: [{ type: "PLA" }] } },
        { outcome: "success", settings: { filaments: [{ type: "PETG" }] } },
        { outcome: null, settings: { filaments: [{ type: "PETG" }] } },
        { outcome: "failed", settings: {} },
      ],
      (s) => s.filaments?.[0]?.type?.toUpperCase() ?? null,
    );
    expect(rows).toEqual([
      { label: "PLA", total: 3, worked: 2, percent: 67 },
      { label: "PETG", total: 1, worked: 1, percent: 100 },
    ]);
  });
});

describe("computeInsights", () => {
  const all = [
    at("b1", 1, "failed", { bedTemperature: 55 }, ["warping"]),
    at("b1", 2, "success", { bedTemperature: 65, brim: true, filaments: [{ type: "PLA" }] }),
    at("b2", 3, "failed", { brim: false }, ["warping", "stringing"]),
    at("b2", 4, "success", { brim: true }),
    at("b3", 5, "partial", { bedTemperature: 55 }, ["warping"]),
    at("b3", 6, "success", { bedTemperature: 65 }),
    at("b3", 7, "failed", {}, ["clog"], 3),
    at("b3", 8, null, {}, [], 3),
  ];
  const old = { ...at("old", 1, "failed", {}, ["warping"]), printedAt: Date.UTC(2025, 11, 1) };
  const result = computeInsights([...all, old], new Map([["b3", "Tugboat"]]), 2026);

  it("counts a year's outcomes and months, leaving out prints still printing", () => {
    expect(result.prints).toBe(7);
    expect(result.outcomes).toEqual({ success: 3, partial: 1, failed: 3 });
    expect(result.months[2]).toMatchObject({ month: 2, success: 3, partial: 1, failed: 2 });
    expect(result.months[3]).toMatchObject({ failed: 1 });
  });

  it("says what came right before a print that worked, for each failure tag", () => {
    const warping = result.failures.find((f) => f.slug === "warping");
    expect(warping?.count).toBe(3);
    expect(warping?.fixes).toContainEqual({ phrase: "a warmer bed", count: 2 });
    expect(warping?.fixes).toContainEqual({ phrase: "a brim", count: 2 });
    expect(result.failures.find((f) => f.slug === "clog")?.fixes).toEqual([]);
  });

  it("lists builds that took three or more attempts", () => {
    expect(result.longestBuilds).toEqual([{ itemId: "b3", title: "Tugboat", attempts: 4 }]);
  });

  it("builds the sentence", () => {
    expect(fixSentence([{ phrase: "a brim", count: 3 }, { phrase: "a warmer bed", count: 2 }])).toBe(
      "fixed 3 times by a brim and twice by a warmer bed",
    );
    expect(fixSentence([])).toBeNull();
  });
});
