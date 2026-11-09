import { describe, expect, it } from "vitest";
import { dayLabel, groupJournal, monthLabel, summaryLine, weekLabel } from "../../src/shared/journal.ts";

// Wednesday 11 November 2026, 15:00 local time.
const now = new Date(2026, 10, 11, 15, 0).getTime();
const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();

describe("groupJournal", () => {
  it("groups by day this week, by week before, inside months", () => {
    const entries = [
      at(10, 11, 9),
      at(10, 11, 8),
      at(10, 10),
      at(10, 5), // Thursday, the last day shown by day
      at(10, 4), // Wednesday the week before: by week
      at(10, 2), // Monday, same week
      at(10, 1), // Sunday: the week before that, but still November
      at(9, 30), // Friday in October: the same week, another month
      at(9, 26),
      at(8, 3),
    ].map((time) => ({ at: time }));
    const months = groupJournal(entries, now);
    expect(months.map((month) => month.key)).toEqual(["2026-11", "2026-10", "2026-09"]);
    const [november, october, september] = months;
    expect(november?.groups.map((group) => [group.kind, group.entries.length])).toEqual([
      ["day", 2],
      ["day", 1],
      ["day", 1],
      ["week", 2],
      ["week", 1],
    ]);
    // A week that started in October is clipped to November inside November.
    expect(november?.groups.at(-1)?.start).toBe(at(10, 1, 0));
    expect(october?.groups.map((group) => [group.kind, group.entries.length])).toEqual([["week", 2]]);
    expect(october?.groups[0]?.start).toBe(at(9, 26, 0));
    expect(october?.groups[0]?.end).toBe(at(10, 1, 0) - 1);
    expect(september?.start).toBe(at(8, 1, 0));
    expect(september?.end).toBe(at(9, 1, 0) - 1);
  });
});

describe("labels", () => {
  it("names days, weeks and months", () => {
    expect(dayLabel(at(10, 11, 0), now)).toBe("Today");
    expect(dayLabel(at(10, 10, 0), now)).toBe("Yesterday");
    expect(dayLabel(at(10, 9, 0), now)).toBe(new Date(at(10, 9)).toLocaleDateString(undefined, { weekday: "long" }));
    expect(weekLabel(at(9, 26, 0), at(10, 1, 0) - 1)).toMatch(/26.*31/);
    expect(weekLabel(at(9, 26, 0), at(9, 26, 23))).not.toContain("–");
    expect(monthLabel(at(9, 1, 0), now)).not.toMatch(/2026/);
    expect(monthLabel(new Date(2025, 9, 1).getTime(), now)).toMatch(/2025/);
  });
});

describe("summaryLine", () => {
  const base = { prints: 0, worked: 0, partly: 0, spaghetti: 0, finished: [] };

  it("sums up a month in one quiet line", () => {
    expect(summaryLine({ ...base, prints: 14, spaghetti: 3, finished: [{ id: "1", title: "Tugboat for Mila" }] })).toBe(
      "14 prints, 3 spaghetti, tugboat for Mila finished",
    );
    expect(summaryLine({ ...base, prints: 1, worked: 1 })).toBe("1 print");
    expect(
      summaryLine({
        ...base,
        prints: 4,
        finished: [
          { id: "1", title: "Hook" },
          { id: "2", title: "PETG box" },
        ],
      }),
    ).toBe("4 prints, hook and PETG box finished");
    expect(summaryLine({ ...base, prints: 9, finished: [1, 2, 3].map((n) => ({ id: `${n}`, title: null })) })).toBe(
      "9 prints, 3 builds finished",
    );
    expect(summaryLine({ ...base, finished: [{ id: "1", title: null }] })).toBe("1 build finished");
    expect(summaryLine(base)).toBe("");
  });
});
