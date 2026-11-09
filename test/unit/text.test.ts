import { describe, expect, it } from "vitest";
import { findLinks, isLink, shortUrl } from "../../src/shared/links.ts";
import { relativeTime } from "../../src/shared/time.ts";

describe("links", () => {
  it("finds links and leaves trailing punctuation out", () => {
    const text = "See https://printables.com/model/1-hook, and (http://example.com/a).";
    expect(findLinks(text).map((link) => link.url)).toEqual([
      "https://printables.com/model/1-hook",
      "http://example.com/a",
    ]);
  });

  it("knows a pasted link from a sentence with one", () => {
    expect(isLink("  https://makerworld.com/en/models/42 ")).toBe(true);
    expect(isLink("try https://makerworld.com/en/models/42")).toBe(false);
  });

  it("shortens for display", () => {
    expect(shortUrl("https://www.printables.com/model/1/")).toBe("printables.com/model/1");
  });
});

describe("relativeTime", () => {
  const now = new Date(2026, 10, 9, 15, 0).getTime();
  it("reads naturally", () => {
    expect(relativeTime(now - 20_000, now)).toBe("Just now");
    expect(relativeTime(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(relativeTime(new Date(2026, 10, 8, 23, 0).getTime(), now)).toBe("Yesterday");
    expect(relativeTime(new Date(2026, 10, 5, 9, 0).getTime(), now)).toBe("4 days ago");
  });
});
