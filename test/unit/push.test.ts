import { describe, expect, it } from "vitest";
import { attemptUrl, dueNudge, isQuietHour, isTimeZone, nudgeMessage } from "../../src/shared/push.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (h: number, m = 0) => Date.UTC(2026, 10, 10, h, m);

describe("quiet hours", () => {
  it("run from 22:00 to 07:00 in the device's zone", () => {
    expect(isQuietHour("UTC", at(21, 59))).toBe(false);
    expect(isQuietHour("UTC", at(22))).toBe(true);
    expect(isQuietHour("UTC", at(3))).toBe(true);
    expect(isQuietHour("UTC", at(6, 59))).toBe(true);
    expect(isQuietHour("UTC", at(7))).toBe(false);
    // Stockholm is UTC+1 in November.
    expect(isQuietHour("Europe/Stockholm", at(21, 30))).toBe(true);
    expect(isQuietHour("Europe/Stockholm", at(5, 59))).toBe(true);
    expect(isQuietHour("Europe/Stockholm", at(6))).toBe(false);
  });

  it("knows which time zone names are real", () => {
    expect(isTimeZone("Europe/Stockholm")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
  });
});

describe("dueNudge", () => {
  const printing = { outcome: null, printedAt: at(8), endedAt: null, estimatedMinutes: 60 } as const;

  it("is overdue ten minutes after the estimate, and not before", () => {
    expect(dueNudge(printing, at(9, 9))).toBeNull();
    expect(dueNudge(printing, at(9, 10))).toEqual({ kind: "overdue", since: at(9, 10) });
  });

  it("is off the bed as soon as the bridge says so, even before the estimate", () => {
    expect(dueNudge({ ...printing, endedAt: at(8, 30) }, at(8, 31))).toEqual({ kind: "off_the_bed", since: at(8, 30) });
  });

  it("is nothing with an outcome, without an estimate or after the window", () => {
    expect(dueNudge({ ...printing, outcome: "success" }, at(10))).toBeNull();
    expect(dueNudge({ ...printing, estimatedMinutes: undefined }, at(12))).toBeNull();
    expect(dueNudge({ ...printing, endedAt: at(8, 30) }, at(8, 30) + 12 * HOUR + MIN)).toBeNull();
    expect(dueNudge(printing, at(9, 10) + 12 * HOUR + MIN)).toBeNull();
  });
});

describe("nudgeMessage", () => {
  const attempt = { id: "a-1", itemId: "i-1" };

  it("says what the print is and asks how it went", () => {
    const off = nudgeMessage("off_the_bed", attempt, "Tugboat");
    expect(off.title).toBe("Tugboat is off the bed");
    expect(off.body).toBe("How did it go?");
    expect(off.actions.map((a) => a.title)).toEqual(["Worked", "Partly", "Spaghetti"]);
    expect(off.actions.map((a) => a.action)).toEqual(["success", "partial", "failed"]);
    expect(nudgeMessage("overdue", attempt, "Tugboat").title).toBe("Tugboat should be done by now");
  });

  it("opens the attempt sheet, names the other person's prints and copes with no title", () => {
    expect(nudgeMessage("overdue", attempt, "").url).toBe(attemptUrl("i-1", "a-1"));
    expect(attemptUrl("i-1", "a-1")).toBe("/builds/i-1?attempt=a-1&finish=1");
    expect(nudgeMessage("overdue", attempt, "", "Sam").title).toBe("A print should be done by now");
    expect(nudgeMessage("overdue", attempt, "Hook", "Sam").body).toBe("Sam's print. How did it go?");
  });
});
