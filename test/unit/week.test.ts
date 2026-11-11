import { describe, expect, it } from "vitest";
import {
  addWeeks,
  attemptGrams,
  isMonday,
  isWeekPushTime,
  mondayOf,
  mondayOfDay,
  printsWords,
  sundayOf,
  type Week,
  weekBounds,
  weekIsReadyToWrite,
  weekMessage,
  weekName,
  weekRangeLabel,
} from "../../src/shared/week.ts";

const stockholm = (iso: string) => Date.parse(iso);

describe("which week a moment is in", () => {
  it("runs Monday to Sunday by the workspace clock, not UTC", () => {
    // Sunday 15 Nov 23:59:59 in Stockholm (UTC+1) is still that week; a second later is the next Monday.
    expect(mondayOf(stockholm("2026-11-15T23:59:59+01:00"))).toBe("2026-11-09");
    expect(mondayOf(stockholm("2026-11-16T00:00:00+01:00"))).toBe("2026-11-16");
    // 23:30 UTC on Sunday is already Monday in Stockholm.
    expect(mondayOf(stockholm("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
    expect(mondayOf(stockholm("2026-11-15T22:59:59Z"))).toBe("2026-11-09");
  });

  it("knows Mondays", () => {
    expect(isMonday("2026-11-09")).toBe(true);
    expect(isMonday("2026-11-10")).toBe(false);
    expect(isMonday("2026-02-30")).toBe(false);
    expect(isMonday("nonsense")).toBe(false);
    expect(mondayOfDay("2026-11-12")).toBe("2026-11-09");
    expect(mondayOfDay("2026-11-15")).toBe("2026-11-09");
    expect(mondayOfDay("2026-13-01")).toBeNull();
    expect(addWeeks("2026-11-09", -1)).toBe("2026-11-02");
    expect(addWeeks("2026-12-28", 1)).toBe("2027-01-04");
    expect(sundayOf("2026-11-09")).toBe("2026-11-15");
  });

  it("bounds a week from Monday midnight to the next, with daylight saving", () => {
    const normal = weekBounds("2026-11-09");
    expect(normal.start).toBe(stockholm("2026-11-09T00:00:00+01:00"));
    expect(normal.end).toBe(stockholm("2026-11-16T00:00:00+01:00"));
    // Clocks go back on Sunday 25 Oct 2026: that week is an hour longer; the one in March an hour shorter.
    const autumn = weekBounds("2026-10-19");
    expect((autumn.end - autumn.start) / 3_600_000).toBe(169);
    const spring = weekBounds("2026-03-23");
    expect((spring.end - spring.start) / 3_600_000).toBe(167);
    expect(spring.end).toBe(stockholm("2026-03-30T00:00:00+02:00"));
  });
});

describe("the Sunday evening moment", () => {
  it("is Sunday 19:00 to 22:00 in Stockholm, summer and winter", () => {
    expect(isWeekPushTime(stockholm("2026-11-15T18:59:00+01:00"))).toBe(false);
    expect(isWeekPushTime(stockholm("2026-11-15T19:00:00+01:00"))).toBe(true);
    expect(isWeekPushTime(stockholm("2026-11-15T21:59:00+01:00"))).toBe(true);
    expect(isWeekPushTime(stockholm("2026-11-15T22:00:00+01:00"))).toBe(false);
    expect(isWeekPushTime(stockholm("2026-11-14T19:30:00+01:00"))).toBe(false);
    expect(isWeekPushTime(stockholm("2026-07-12T19:00:00+02:00"))).toBe(true);
  });

  it("writes a week's look back once it is over, or on its Sunday evening", () => {
    expect(weekIsReadyToWrite("2026-11-09", stockholm("2026-11-12T10:00:00+01:00"))).toBe(false);
    expect(weekIsReadyToWrite("2026-11-09", stockholm("2026-11-15T19:00:00+01:00"))).toBe(true);
    expect(weekIsReadyToWrite("2026-11-09", stockholm("2026-11-16T08:00:00+01:00"))).toBe(true);
    expect(weekIsReadyToWrite("2026-11-16", stockholm("2026-11-16T08:00:00+01:00"))).toBe(false);
  });

  it("names weeks", () => {
    const now = stockholm("2026-11-12T10:00:00+01:00");
    expect(weekName("2026-11-09", now)).toBe("This week");
    expect(weekName("2026-11-02", now)).toBe("Last week");
    expect(weekName("2026-10-26", now)).toMatch(/26/);
  });
});

describe("the dates", () => {
  it("always say the year, and both across New Year", () => {
    expect(weekRangeLabel("2026-01-05")).toMatch(/January 5\D+11, 2026/);
    const across = weekRangeLabel("2025-12-29");
    expect(across).toContain("December 29, 2025");
    expect(across).toContain("January 4, 2026");
  });
});

describe("the words", () => {
  const counts = { total: 4, worked: 2, partly: 1, spaghetti: 1, printing: 0 };
  it("counts prints and spaghetti", () => {
    expect(printsWords(counts)).toBe("4 prints, 1 spaghetti");
    expect(printsWords({ ...counts, total: 1, spaghetti: 0 })).toBe("1 print");
    expect(printsWords({ ...counts, total: 0 })).toBeNull();
  });

  it("makes the push", () => {
    const week = {
      monday: "2026-11-09",
      prints: counts,
      ideas: [{}, {}],
      buildsFinished: [{}],
    } as unknown as Week;
    const message = weekMessage(week);
    expect(message.title).toBe("Your week: 4 prints, 1 spaghetti");
    expect(message.body).toBe("2 new ideas, 1 build finished, 2 worked. Have a look back.");
    expect(message.url).toBe("/week/2026-11-09");
    expect(message.tag).toBe("week-2026-11-09");
  });

  it("adds up filament", () => {
    expect(attemptGrams("success", { filaments: [{ grams: 10 }, { grams: 5.5 }] })).toEqual({
      grams: 15.5,
      approximate: false,
    });
    expect(attemptGrams("failed", { weightGrams: 40, failedAtPercent: 25 })).toEqual({ grams: 10, approximate: true });
    expect(attemptGrams(null, { weightGrams: 40 })).toBeNull();
    expect(attemptGrams("success", {})).toBeNull();
  });
});
