import { describe, expect, it } from "vitest";
import {
  attemptMinutes,
  dueLine,
  type HoursAttempt,
  printHours,
  sinceDone,
  sinceWords,
  upkeepStatus,
} from "../../src/shared/upkeep.ts";
import { DEFAULT_UPKEEP } from "../../src/shared/upkeep-defaults.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 10, 10, 12);

const attempt = (over: Partial<HoursAttempt> & { settings?: HoursAttempt["settings"] } = {}): HoursAttempt => ({
  printedAt: now - 10 * DAY,
  endedAt: null,
  outcome: "success",
  settings: {},
  ...over,
});

describe("print hours", () => {
  it("takes the actual minutes first, then the bridge's, then the estimate", () => {
    expect(attemptMinutes(attempt({ settings: { actualMinutes: 90, estimatedMinutes: 120 } }), now)).toBe(90);
    const started = now - 3 * HOUR;
    expect(
      attemptMinutes(
        attempt({ printedAt: started, endedAt: started + 2.5 * HOUR, settings: { estimatedMinutes: 120 } }),
        now,
      ),
    ).toBe(150);
    expect(attemptMinutes(attempt({ settings: { estimatedMinutes: 120 } }), now)).toBe(120);
  });

  it("counts a failed print only as far as it got", () => {
    expect(
      attemptMinutes(attempt({ outcome: "failed", settings: { estimatedMinutes: 200, failedAtPercent: 25 } }), now),
    ).toBe(50);
  });

  it("counts a print still going by how long it has run, never past its estimate", () => {
    const running = attempt({ outcome: null, printedAt: now - 30 * 60_000, settings: { estimatedMinutes: 120 } });
    expect(attemptMinutes(running, now)).toBe(30);
    expect(attemptMinutes({ ...running, printedAt: now - 5 * HOUR }, now)).toBe(120);
    expect(attemptMinutes({ ...running, settings: {} }, now)).toBe(0);
  });

  it("counts nothing for an attempt that says nothing", () => {
    expect(attemptMinutes(attempt(), now)).toBe(0);
  });

  it("adds them up in hours, optionally only what started before a moment", () => {
    const list = [
      attempt({ printedAt: now - 5 * DAY, settings: { actualMinutes: 120 } }),
      attempt({ printedAt: now - 2 * DAY, settings: { estimatedMinutes: 60 } }),
    ];
    expect(printHours(list, now)).toBe(3);
    expect(printHours(list, now, now - 3 * DAY)).toBe(2);
    expect(printHours([], now)).toBe(0);
  });
});

describe("what is due", () => {
  const both = { intervalHours: 20, intervalDays: 14 };
  it("goes by whichever limit comes first", () => {
    expect(upkeepStatus(both, 10, 3)).toMatchObject({ due: false, by: "hours", fraction: 0.5 });
    expect(upkeepStatus(both, 5, 21)).toMatchObject({ due: true, by: "days", fraction: 1.5 });
    expect(upkeepStatus(both, 20, 0)).toMatchObject({ due: true, by: "hours" });
  });

  it("works with only hours or only days, and with neither", () => {
    expect(upkeepStatus({ intervalHours: 10, intervalDays: null }, 5, 400).fraction).toBe(0.5);
    expect(upkeepStatus({ intervalHours: null, intervalDays: 10 }, 400, 5).fraction).toBe(0.5);
    expect(upkeepStatus({ intervalHours: null, intervalDays: null }, 400, 400)).toEqual({
      fraction: 0,
      due: false,
      by: null,
    });
  });

  it("counts from the last Done, or from when the task was added when it never was", () => {
    const list = [
      attempt({ printedAt: now - 20 * DAY, settings: { actualMinutes: 600 } }),
      attempt({ printedAt: now - DAY, settings: { actualMinutes: 300 } }),
    ];
    const added = now - 5 * DAY;
    const never = sinceDone({ ...both, lastHours: null, lastAt: null, createdAt: added }, list, now);
    expect(never.sinceHours).toBe(5);
    expect(never.sinceDays).toBe(5);
    const done = sinceDone({ ...both, lastHours: 12, lastAt: now - 2 * DAY, createdAt: added }, list, now);
    expect(done.sinceHours).toBe(3);
    expect(done.sinceDays).toBe(2);
  });

  it("says it in words, and as one quiet line for Today", () => {
    const status = upkeepStatus({ intervalHours: 20, intervalDays: null }, 42.6, 3);
    expect(sinceWords(status, 42.6, 3)).toBe("42 print hours since");
    expect(sinceWords(upkeepStatus({ intervalHours: null, intervalDays: 14 }, 1, 63), 1, 63)).toBe("63 days since");
    const plate = { name: "Clean the build plate", status, sinceHours: 42.6, sinceDays: 3 };
    expect(dueLine([plate])).toBe("Time to clean the build plate, 42 print hours since.");
    expect(dueLine([plate, { ...plate, name: "Check the belts", status: { ...status, fraction: 1.1 } }])).toBe(
      "Time to clean the build plate, 42 print hours since, and 1 more.",
    );
    expect(dueLine([])).toBeNull();
  });
});

describe("the starting list", () => {
  it("has the seven X2D tasks, each with an interval", () => {
    expect(DEFAULT_UPKEEP.map((task) => task.name)).toEqual([
      "Clean the build plate",
      "Clean the nozzle and wiper",
      "Empty the purge chute",
      "Replace the AMS desiccant",
      "Lubricate the rods",
      "Check the belts",
      "Replace the air filter",
    ]);
    for (const task of DEFAULT_UPKEEP) expect(task.intervalHours || task.intervalDays).toBeTruthy();
    expect(new Set(DEFAULT_UPKEEP.map((task) => task.id)).size).toBe(DEFAULT_UPKEEP.length);
  });
});
