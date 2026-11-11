import { describe, expect, it } from "vitest";
import { ftsQuery, highlight } from "../../src/shared/search.ts";
import { correctWord, distance, markTerms, parseQuery, splitNames, whenRange } from "../../src/shared/search-intent.ts";

// Wednesday 11 November 2026, noon UTC.
const NOW = Date.UTC(2026, 10, 11, 12);

describe("parseQuery", () => {
  it("drops filler and turns 'worked' into a preference", () => {
    const read = parseQuery("what worked for the tugboat last time", NOW);
    expect(read.terms.map((term) => term.text)).toEqual(["tugboat"]);
    expect(read.intent).toBe("worked");
  });

  it("reads Swedish fillers, outcomes and time", () => {
    const read = parseQuery("vad fungerade för tugboat förra veckan", NOW);
    expect(read.terms.map((term) => term.text)).toEqual(["tugboat"]);
    expect(read.intent).toBe("worked");
    expect(read.when?.label).toBe("last week");
  });

  it("keeps what was typed when only filler is left", () => {
    expect(parseQuery("the", NOW).terms.map((term) => term.text)).toEqual(["the"]);
  });

  it("drops possessives and single letters", () => {
    expect(parseQuery("Marie's idea about the coffee clips", NOW).terms.map((term) => term.text)).toEqual([
      "marie",
      "coffee",
      "clips",
    ]);
  });

  it("keeps decimals whole and as phrases", () => {
    const read = parseQuery("0,4 nozzle", NOW);
    expect(read.terms[0]).toEqual({ text: "0.4", prefix: false });
    expect(ftsQuery(read.terms)).toBe('"0 4" AND ("nozzle"* OR "munstycke"*)');
  });

  it("expands synonyms, which are marked too", () => {
    const read = parseQuery("skevhet", NOW);
    expect(read.terms[0]?.also).toContain("warping");
    expect(ftsQuery(read.terms)).toContain('"warping"*');
    expect(highlight("Warping at the corners", markTerms(read.terms)).some((piece) => piece.match)).toBe(true);
    // Short words are whole words only: "gra" is grey, not "grattis".
    expect(parseQuery("grattis", NOW).terms[0]?.also).toBeUndefined();
  });
});

describe("whenRange", () => {
  it("counts weeks from Monday in the workspace's zone, as the week pages do", () => {
    // Wednesday 11 November 2026: Stockholm is UTC+1, so its Monday begins at 23:00 UTC on Sunday.
    const week = whenRange("lastweek", NOW);
    expect(new Date(week.from).toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(new Date(week.to).toISOString()).toBe("2026-11-08T23:00:00.000Z");
    expect(week.weekMonday).toBe("2026-11-02");
    expect(whenRange("week", NOW).weekMonday).toBe("2026-11-09");
    expect(new Date(whenRange("lastmonth", NOW).from).toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(new Date(whenRange("yesterday", NOW).from).toISOString()).toBe("2026-11-09T23:00:00.000Z");
    expect(whenRange("today", NOW).weekMonday).toBeNull();
  });
});

describe("splitNames", () => {
  it("takes first names out of the terms", () => {
    const { terms, names } = splitNames(parseQuery("marie coffee", NOW).terms, ["marie", "sam"]);
    expect(names).toEqual(["marie"]);
    expect(terms.map((term) => term.text)).toEqual(["coffee"]);
  });
});

describe("correctWord", () => {
  const vocabulary = ["warping", "petg", "stringing", "nozzle", "tugboat"];
  it("mends a slip and leaves the rest", () => {
    expect(distance("wraping", "warping")).toBe(1);
    expect(correctWord("wraping", vocabulary)).toBe("warping");
    expect(correctWord("petgg", vocabulary)).toBe("petg");
    expect(correctWord("stringin", vocabulary)).toBeNull(); // the start of a word
    expect(correctWord("pla", vocabulary)).toBeNull(); // too short
    expect(correctWord("0.4", vocabulary)).toBeNull();
    expect(correctWord("qzxvbn", vocabulary)).toBeNull();
  });
});
