import { describe, expect, it } from "vitest";
import { daysAgo } from "../../src/shared/time.ts";

const DAY = 24 * 60 * 60_000;
const now = Date.UTC(2026, 10, 10, 12);

describe("daysAgo", () => {
  it("says today within a day, then counts whole days", () => {
    expect(daysAgo(now, now)).toBe("today");
    expect(daysAgo(now - 23 * 60 * 60_000, now)).toBe("today");
    expect(daysAgo(now - DAY, now)).toBe("1 d ago");
    expect(daysAgo(now - 12.9 * DAY, now)).toBe("12 d ago");
  });

  it("never reads negative if the clocks disagree", () => {
    expect(daysAgo(now + DAY, now)).toBe("today");
  });
});
