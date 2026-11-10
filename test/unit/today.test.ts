import { describe, expect, it } from "vitest";
import { ageWords } from "../../src/shared/time.ts";
import { backBurnerIdea, localDay } from "../../src/shared/today.ts";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date(2026, 9, 21, 12, 0).getTime();

const idea = (id: string, daysOld: number, extra: object = {}) => ({
  id,
  stage: "idea",
  createdAt: now - daysOld * DAY,
  ...extra,
});

describe("the back burner", () => {
  it("only picks ideas older than two weeks, and not builds or ideas still on this device", () => {
    expect(backBurnerIdea([idea("a", 3), idea("b", 14), idea("c", 20, { stage: "building" })], now)).toBeUndefined();
    expect(backBurnerIdea([idea("a", 30, { pending: true })], now)).toBeUndefined();
    expect(backBurnerIdea([idea("a", 15)], now)?.id).toBe("a");
  });

  it("is the same idea all day for both people, whatever order their lists are in", () => {
    const ideas = ["a", "b", "c", "d", "e"].map((id, index) => idea(id, 20 + index));
    const morning = backBurnerIdea(ideas, new Date(2026, 9, 21, 7, 0).getTime());
    const night = backBurnerIdea([...ideas].reverse(), new Date(2026, 9, 21, 23, 30).getTime());
    expect(morning?.id).toBeDefined();
    expect(night?.id).toBe(morning?.id);
  });

  it("moves on from day to day, through all of them", () => {
    const ideas = ["a", "b", "c"].map((id, index) => idea(id, 40 + index));
    const picks = new Set(Array.from({ length: 30 }, (_, day) => backBurnerIdea(ideas, now + day * DAY)?.id));
    expect(picks).toEqual(new Set(["a", "b", "c"]));
  });

  it("names the day in local time", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });
});

describe("how long ago, for old things", () => {
  it("says days, then weeks, then months", () => {
    expect(ageWords(now - 3 * DAY, now)).toBe("3 days ago");
    expect(ageWords(now - 7 * DAY, now)).toBe("1 week ago");
    expect(ageWords(now - 35 * DAY, now)).toBe("5 weeks ago");
    expect(ageWords(now - 75 * DAY, now)).toBe("2 months ago");
    expect(ageWords(now - 400 * DAY, now)).toBe("1 year ago");
  });
});
