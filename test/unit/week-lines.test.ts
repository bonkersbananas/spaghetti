import { describe, expect, it } from "vitest";
import { commentsLine, ideasLine } from "../../src/shared/week-lines.ts";

const marie = { id: "m", name: "Marie Lindqvist" };
const carl = { id: "c", name: "Carl Oscar Aaro" };

describe("the week page's lines about people", () => {
  it("says you to the person who captured the ideas, and their name to the other", () => {
    expect(ideasLine([{ who: marie, count: 3 }], "m")).toBe("You captured 3 ideas");
    expect(ideasLine([{ who: marie, count: 3 }], "c")).toBe("Marie captured 3 ideas");
    expect(ideasLine([{ who: marie, count: 1 }], "m")).toBe("You captured 1 idea");
  });

  it("puts both in one line, whoever captured most first and you in the second person wherever you stand", () => {
    const both = [
      { who: marie, count: 3 },
      { who: carl, count: 4 },
    ];
    expect(ideasLine(both, "c")).toBe("You captured 4 ideas and Marie 3");
    expect(ideasLine(both, "m")).toBe("Carl captured 4 ideas and you 3");
  });

  it("puts the other person first on a tie, and spells the second noun out when the first count is 1", () => {
    const tie = [
      { who: marie, count: 2 },
      { who: carl, count: 2 },
    ];
    expect(ideasLine(tie, "m")).toBe("Carl captured 2 ideas and you 2");
    expect(ideasLine(tie, "c")).toBe("Marie captured 2 ideas and you 2");
    const one = [
      { who: marie, count: 1 },
      { who: carl, count: 1 },
    ];
    expect(ideasLine(one, "m")).toBe("Carl captured 1 idea and you 1 idea");
    expect(
      ideasLine(
        [
          { who: marie, count: 4 },
          { who: carl, count: 1 },
        ],
        "c",
      ),
    ).toBe("Marie captured 4 ideas and you 1");
  });

  it("says You left, or the other's name left, for comments from one person", () => {
    expect(commentsLine(2, [marie], "m")).toBe("You left 2 comments");
    expect(commentsLine(2, [marie], "c")).toBe("Marie left 2 comments");
    expect(commentsLine(1, [carl], "c")).toBe("You left 1 comment");
  });

  it("keeps You two for an exchange, and a name stays a name until we know who is reading", () => {
    expect(commentsLine(4, [marie, carl], "m")).toBe("You two exchanged 4 comments");
    expect(ideasLine([{ who: marie, count: 3 }], undefined)).toBe("Marie captured 3 ideas");
    expect(commentsLine(1, [{ id: "x" }], undefined)).toBe("Someone left 1 comment");
  });
});
