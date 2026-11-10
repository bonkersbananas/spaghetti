import { describe, expect, it } from "vitest";
import { beganAsIdea, daysLeft, PURGE_AFTER_MS } from "../../src/shared/deleted.ts";

describe("beganAsIdea", () => {
  it("is true for a build started after it was captured", () => {
    expect(beganAsIdea({ stage: "building", createdAt: 1000, startedAt: 5000 })).toBe(true);
    expect(beganAsIdea({ stage: "done", createdAt: 1000, startedAt: 5000 })).toBe(true);
  });
  it("is false for a build that started when it was made, and for ideas", () => {
    expect(beganAsIdea({ stage: "building", createdAt: 1000, startedAt: 1000 })).toBe(false);
    expect(beganAsIdea({ stage: "idea", createdAt: 1000, startedAt: null })).toBe(false);
    expect(beganAsIdea({ stage: "building", createdAt: 1000, startedAt: null })).toBe(false);
  });
});

describe("daysLeft", () => {
  const day = 24 * 60 * 60 * 1000;
  it("counts whole days until the purge, never below one", () => {
    expect(daysLeft(0, 0)).toBe(30);
    expect(daysLeft(0, 10 * day)).toBe(20);
    expect(daysLeft(0, PURGE_AFTER_MS - 1000)).toBe(1);
    expect(daysLeft(0, PURGE_AFTER_MS + day)).toBe(1);
  });
});
