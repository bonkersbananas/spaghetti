import { describe, expect, it } from "vitest";
import {
  isReactionKind,
  type Reaction,
  reactedBy,
  summarizeReactions,
  toggleReaction,
} from "../../src/shared/reactions.ts";

const names: Record<string, string> = { a: "Alex", s: "Sam" };
const nameOf = (id: string) => names[id] ?? "Someone";

describe("reactions", () => {
  it("knows its six kinds", () => {
    expect(isReactionKind("chef")).toBe(true);
    expect(isReactionKind("thumbsdown")).toBe(false);
  });

  it("summarizes by kind in the set's order, who gave each and whether you did", () => {
    const list: Reaction[] = [
      { kind: "melt", userId: "s", at: 1 },
      { kind: "love", userId: "s", at: 2 },
      { kind: "love", userId: "a", at: 3 },
    ];
    expect(summarizeReactions(list, "a")).toEqual([
      { kind: "love", label: "Love it", userIds: ["s", "a"], mine: true },
      { kind: "melt", label: "Melting", userIds: ["s"], mine: false },
    ]);
    expect(summarizeReactions(undefined, "a")).toEqual([]);
  });

  it("gives a reaction, and takes back only yours", () => {
    const given = toggleReaction([{ kind: "hot", userId: "s", at: 1 }], "hot", "a", 2);
    expect(given).toHaveLength(2);
    expect(toggleReaction(given, "hot", "a", 3)).toEqual([{ kind: "hot", userId: "s", at: 1 }]);
  });

  it("says who reacted, you last", () => {
    expect(reactedBy(["a"], "a", nameOf)).toBe("You");
    expect(reactedBy(["s"], "a", nameOf)).toBe("Sam");
    expect(reactedBy(["a", "s"], "a", nameOf)).toBe("Sam and you");
  });
});
