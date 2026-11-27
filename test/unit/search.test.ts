import { describe, expect, it } from "vitest";
import {
  excerpt,
  ftsQuery,
  highlight,
  printNameMatch,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  searchTerms,
  snippetSegments,
} from "../../src/shared/search.ts";

describe("searchTerms", () => {
  it("reads words, without accents or case, once each", () => {
    expect(searchTerms("PETG  Warp, petg crème")).toEqual([
      { text: "petg", prefix: true },
      { text: "warp", prefix: true },
      { text: "creme", prefix: true },
    ]);
  });

  it("treats short material names as whole words", () => {
    expect(searchTerms("pla PA abs")).toEqual([
      { text: "pla", prefix: false },
      { text: "pa", prefix: false },
      { text: "abs", prefix: false },
    ]);
  });

  it("drops FTS syntax and keeps at most eight words", () => {
    expect(searchTerms('"tug* OR (boat) NEAR -x:y ^z')).toEqual(
      ["tug", "or", "boat", "near", "x", "y", "z"].map((text) => ({ text, prefix: true })),
    );
    expect(searchTerms("a b c d e f g h i j")).toHaveLength(8);
    expect(searchTerms("  -- ")).toEqual([]);
  });
});

describe("ftsQuery", () => {
  it("quotes every term and requires them all", () => {
    expect(ftsQuery(searchTerms("PETG pla"))).toBe('"petg"* AND "pla"');
  });

  it("finds a tag by its label when the slug says it differently", () => {
    expect(ftsQuery(searchTerms("drying"))).toBe('("drying"* OR tags : "dried filament helped")');
    // The slug already says it: no extra clause.
    expect(ftsQuery(searchTerms("warp"))).toBe('"warp"*');
    expect(ftsQuery(searchTerms("nozzle"), [{ kind: "failure", slug: "hit-the-part", label: "Nozzle hit" }])).toBe(
      '("nozzle"* OR tags : "hit the part")',
    );
  });
});

describe("highlight", () => {
  it("marks the words that start with a term", () => {
    expect(highlight("Warped PETG, warping again", searchTerms("warp petg"))).toEqual([
      { text: "Warped", match: true },
      { text: " ", match: false },
      { text: "PETG", match: true },
      { text: ", ", match: false },
      { text: "warping", match: true },
      { text: " again", match: false },
    ]);
  });

  it("marks whole material names only", () => {
    expect(highlight("PLA on the plate", searchTerms("pla"))).toEqual([
      { text: "PLA", match: true },
      { text: " on the plate", match: false },
    ]);
  });

  it("leaves text alone without terms", () => {
    expect(highlight("Tugboat", [])).toEqual([{ text: "Tugboat", match: false }]);
    expect(highlight("", searchTerms("x"))).toEqual([]);
  });

  it("reads the server's snippet markers", () => {
    expect(
      snippetSegments(`…a ${SNIPPET_OPEN}spool${SNIPPET_CLOSE} holder for the ${SNIPPET_OPEN}shelf${SNIPPET_CLOSE}`),
    ).toEqual([
      { text: "…a ", match: false },
      { text: "spool", match: true },
      { text: " holder for the ", match: false },
      { text: "shelf", match: true },
    ]);
  });
});

describe("printNameMatch", () => {
  const terms = (query: string) => searchTerms(query);
  it("returns the file name only when a word matched nothing else on the row", () => {
    const name = "holder-40mm-v2(5)-12-2";
    expect(printNameMatch([name], ["Reindeer tealight holder"], terms("40mm"))).toBe(name);
    expect(printNameMatch([name], ["Reindeer tealight holder"], terms("holder 40mm"))).toBe(name);
    // The row's own words matched every word: nothing to explain.
    expect(printNameMatch([name], ["Hook v2"], terms("v2"))).toBeNull();
    expect(printNameMatch([name], ["Holder 40mm"], terms("holder 40mm"))).toBeNull();
    // The name doesn't match either.
    expect(printNameMatch([name], ["Reindeer"], terms("lid"))).toBeNull();
    expect(printNameMatch([], ["Reindeer"], terms("40mm"))).toBeNull();
  });

  it("takes the first of several names that has the word", () => {
    expect(printNameMatch(["gnome-a", "gnome-b-v2", "gnome-c-v2"], ["Gnome"], terms("v2"))).toBe("gnome-b-v2");
  });
});

describe("excerpt", () => {
  const terms = (query: string) => searchTerms(query);
  it("leaves a short name alone and cuts a long one around the match", () => {
    expect(excerpt("hook-v2", terms("v2"))).toBe("hook-v2");
    const long = "garden-gnome-hat-3color-40mm-multicolor(5)-12-2-final";
    const cut = excerpt(long, terms("12"), 24);
    expect(cut.length).toBeLessThanOrEqual(26);
    expect(cut).toContain("12");
    expect(cut.startsWith("…")).toBe(true);
    expect(excerpt(long, terms("garden"), 24).startsWith("garden")).toBe(true);
  });
});
