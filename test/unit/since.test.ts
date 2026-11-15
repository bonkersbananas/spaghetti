import { describe, expect, it } from "vitest";
import type { Item, JournalEntry } from "../../src/shared/api.ts";
import { catchUp, sinceLabel } from "../../src/shared/since.ts";

const at = (day: number, hour = 12) => new Date(2026, 10, day, hour).getTime();
const item = (id: string, title: string, stage: string, outcome?: string): Item =>
  ({ id, title, note: "", stage, attempts: outcome ? [{ id: `a-${id}`, outcome }] : [] }) as unknown as Item;
const entry = (kind: string, itemId: string, when: number, by: string, attemptId: string | null = null): JournalEntry =>
  ({ key: `${kind}:${itemId}`, kind, itemId, attemptId, at: when, by, via: null }) as JournalEntry;

describe("sinceLabel", () => {
  const now = at(15, 9);
  it("names the day", () => {
    expect(sinceLabel(at(15, 1), now)).toBe("Since earlier today");
    expect(sinceLabel(at(14, 20), now)).toBe("Since yesterday");
    expect(sinceLabel(at(12, 20), now)).toMatch(/^Since \w+$/);
    expect(sinceLabel(at(3, 20), now)).toMatch(/^Since .*3/);
  });
});

describe("catchUp", () => {
  const items = new Map(
    [
      item("a", "Tugboat", "building", "failed"),
      item("b", "Towel hook", "done", "success"),
      item("c", "Cable comb", "idea"),
      item("d", "Soap dish", "idea"),
    ].map((i) => [i.id, i]),
  );
  const entries = [
    entry("idea", "d", at(14), "sam"),
    entry("idea", "c", at(13), "sam"),
    entry("attempt", "a", at(13, 8), "sam", "a-a"),
    entry("finished", "b", at(12), "sam"),
    entry("idea", "c", at(14, 8), "me"),
    entry("idea", "c", at(5), "sam"),
  ];

  it("counts only the other person's entries since then, in a sentence", () => {
    const result = catchUp(entries, items, { me: "me", from: at(10), name: "Sam" });
    expect(result?.sentence).toBe("Sam finished 1 build, had 1 spaghetti and added 2 ideas.");
    expect(result?.total).toBe(4);
    expect(result?.lines).toHaveLength(3);
  });

  it("is nothing when they did nothing", () => {
    expect(catchUp(entries, items, { me: "me", from: at(15), name: "Sam" })).toBeNull();
  });
});
