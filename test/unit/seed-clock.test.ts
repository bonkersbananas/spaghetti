import { describe, expect, it } from "vitest";
import { recently } from "../../e2e/clock.ts";
import { mondayOf, zonedParts } from "../../src/shared/week.ts";

const MINUTE = 60_000;
const day = (time: number) => {
  const p = zonedParts(time);
  return `${p.year}-${p.month}-${p.day}`;
};

describe("seeding a print a few minutes ago in the workspace's day", () => {
  // Sunday 22 Nov 2026 23:00 UTC is Monday 00:00 in Stockholm: the hour CI failed in.
  const midnight = Date.parse("2026-11-22T23:00:00Z");
  for (const offset of [0, 500, 20_000, 30_000, 90_000, 4 * MINUTE, 10 * MINUTE, 3_600_000, 5 * 3_600_000]) {
    it(`stays in today and this week ${offset} ms after Stockholm midnight`, () => {
      const now = midnight + offset;
      const seeded = [2 * MINUTE, MINUTE].map((ago) => recently(ago, now));
      for (const time of seeded) {
        expect(time).toBeLessThanOrEqual(now);
        expect(day(time)).toBe(day(now));
        expect(mondayOf(time)).toBe(mondayOf(now));
      }
      // The older one stays the older one, once there is room for it.
      if (offset >= 2000) expect(seeded[0]).toBeLessThan(seeded[1] as number);
    });
  }

  it("is plainly a few minutes ago in the middle of the day", () => {
    const now = Date.parse("2026-11-22T11:00:00Z");
    expect(recently(2 * MINUTE, now)).toBe(now - 2 * MINUTE);
  });
});
