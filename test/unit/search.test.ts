import { describe, expect, it } from "vitest";
import {
  ftsQuery,
  highlight,
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
