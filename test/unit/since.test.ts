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
    expect(result?.sentence).toBe("Sam had 1 spaghetti and added 2 ideas.");
    expect(result?.total).toBe(3);
    // A build finished is credited to its creator by the journal, so it is not counted for anyone.
    expect(result?.lines).toHaveLength(3);
  });

  it("credits an attempt to whoever gave it its outcome, not whoever logged it", () => {
    const attempt = (id: string, createdBy: string, finishedBy: string | null) =>
      ({ id, outcome: "success", createdBy, finishedBy }) as never;
    const prints = new Map([
      ["p", { ...item("p", "Hook", "building"), attempts: [attempt("a-p", "sam", "me")] }],
      ["q", { ...item("q", "Clip", "building"), attempts: [attempt("a-q", "me", "sam")] }],
    ] as [string, Item][]);
    const logged = [entry("attempt", "p", at(14), "sam", "a-p"), entry("attempt", "q", at(14), "me", "a-q")];
    const result = catchUp(logged, prints, { me: "me", from: at(10), name: "Sam" });
    // Sam logged the hook but you finished it: yours. You logged the clip and Sam finished it: his.
    expect(result?.lines.map((line) => line.itemId)).toEqual(["q"]);
  });

  it("is nothing when they did nothing", () => {
    expect(catchUp(entries, items, { me: "me", from: at(15), name: "Sam" })).toBeNull();
  });
});
