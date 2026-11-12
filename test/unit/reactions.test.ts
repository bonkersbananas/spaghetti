import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUICK_EMOJI,
  isEmoji,
  quickEmoji,
  type Reaction,
  reactedBy,
  summarizeReactions,
  toggleReaction,
} from "../../src/shared/reactions.ts";

const names: Record<string, string> = { a: "Alex", s: "Sam" };
const nameOf = (id: string) => names[id] ?? "Someone";

describe("reactions", () => {
  it("accepts exactly one RGI emoji", () => {
    for (const ok of ["🔥", "❤️", "👍🏽", "🇸🇪", "👩‍👩‍👧‍👦", "🫠", "1️⃣"]) expect(isEmoji(ok)).toBe(true);
    for (const bad of ["", "a", "love", "🔥🔥", "🔥 ", " 🔥", "🔥a", "❤", "1", "🔥".repeat(30)]) {
      expect(isEmoji(bad)).toBe(false);
    }
  });

  it("summarizes by emoji in the order each was first given, who gave each and whether you did", () => {
    const list: Reaction[] = [
      { kind: "🫠", userId: "s", at: 1 },
      { kind: "❤️", userId: "s", at: 2 },
      { kind: "❤️", userId: "a", at: 3 },
    ];
    expect(summarizeReactions(list, "a")).toEqual([
      { emoji: "🫠", userIds: ["s"], mine: false },
      { emoji: "❤️", userIds: ["s", "a"], mine: true },
    ]);
    expect(summarizeReactions(undefined, "a")).toEqual([]);
  });

  it("gives a reaction, and takes back only yours", () => {
    const given = toggleReaction([{ kind: "🔥", userId: "s", at: 1 }], "🔥", "a", 2);
    expect(given).toHaveLength(2);
    expect(toggleReaction(given, "🔥", "a", 3)).toEqual([{ kind: "🔥", userId: "s", at: 1 }]);
  });

  it("says who reacted, you last", () => {
    expect(reactedBy(["a"], "a", nameOf)).toBe("You");
    expect(reactedBy(["s"], "a", nameOf)).toBe("Sam");
    expect(reactedBy(["a", "s"], "a", nameOf)).toBe("Sam and you");
  });

  it("fills the quick row with what is used, then the defaults", () => {
    expect(quickEmoji(undefined)).toEqual([...DEFAULT_QUICK_EMOJI]);
    expect(quickEmoji(["🍝", "🔥"])).toEqual(["🍝", "🔥", "❤️", "🤌", "🤩", "👏"]);
    expect(quickEmoji(["1", "2", "3", "4", "5", "6", "7"])).toHaveLength(6);
  });
});
