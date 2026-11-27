import { describe, expect, it } from "vitest";
import { ftsQuery, highlight } from "../../src/shared/search.ts";
import {
  correctWord,
  distance,
  markTerms,
  parseQuery,
  splitNames,
  splitWord,
  whenRange,
} from "../../src/shared/search-intent.ts";

// Wednesday 11 November 2026, noon UTC.
const NOW = Date.UTC(2026, 10, 11, 12);

describe("parseQuery", () => {
  it("drops filler and turns 'worked' into a preference", () => {
    const read = parseQuery("what worked for the tugboat last time", NOW);
    expect(read.terms.map((term) => term.text)).toEqual(["tugboat"]);
    expect(read.intent).toBe("worked");
  });

  it("drops 'settings' and its kin, so 'PETG settings' finds the PETG attempts", () => {
    for (const query of ["PETG settings", "PETG setting", "PETG profile", "PETG parameters", "settings for PETG"]) {
      expect(parseQuery(query, NOW).terms.map((term) => term.text)).toEqual(["petg"]);
    }
    expect(parseQuery("PETG inställningar", NOW).terms.map((term) => term.text)).toEqual(["petg"]);
    expect(parseQuery("settings", NOW).terms.map((term) => term.text)).toEqual(["settings"]);
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

  it("reads a plural as its singular too, and two words as one compound too", () => {
    const lids = parseQuery("lids", NOW);
    // The singular is a whole word: "pets" is not every PETG, "PLAs" is not "plate".
    expect(lids.terms[0]?.whole).toEqual(["lid"]);
    expect(lids.terms[0]?.also).toBeUndefined();
    expect(parseQuery("boxes", NOW).terms[0]?.whole).toContain("box");
    expect(parseQuery("batteries", NOW).terms[0]?.whole).toContain("battery");
    expect(parseQuery("class", NOW).terms[0]?.whole).toBeUndefined();
    expect(ftsQuery(parseQuery("pets", NOW).terms)).toBe('("pets"* OR "pet")');
    expect(ftsQuery(parseQuery("PLAs", NOW).terms)).toBe('("plas"* OR "pla")');
    expect(ftsQuery(parseQuery("hot dog", NOW).terms)).toBe('("hot"* AND "dog"*) OR ("hotdog"*)');
    // Numbers and short words are never glued.
    expect(ftsQuery(parseQuery("v3 ring", NOW).terms)).toBe('"v3"* AND "ring"*');
  });

  it("keeps nouns and names that look like filler", () => {
    expect(parseQuery("can holder", NOW).terms.map((term) => term.text)).toEqual(["can", "holder"]);
    expect(parseQuery("trash can", NOW).terms.map((term) => term.text)).toEqual(["trash", "can"]);
    expect(parseQuery("Will's idea", NOW, ["will"]).terms.map((term) => term.text)).toEqual(["will"]);
    // A name is never filler or intent, whatever the word is otherwise.
    expect(parseQuery("the best idea", NOW, ["best"]).terms.map((term) => term.text)).toEqual(["best"]);
  });

  it("keeps a decimal with its unit as the number", () => {
    const read = parseQuery("0.4mm nozzle 1.75mm", NOW);
    expect(read.terms.map((term) => term.text)).toEqual(["0.4", "nozzle", "1.75"]);
    expect(read.terms[0]?.prefix).toBe(true); // a file name holds "0.4mm" as 0 and 4mm
    expect(parseQuery("0.4 nozzle", NOW).terms[0]?.prefix).toBe(false);
  });

  it("matches short synonyms as whole words only", () => {
    expect(parseQuery("christmas", NOW).terms[0]?.whole).toContain("jul");
    expect(ftsQuery(parseQuery("christmas", NOW).terms)).toContain('"jul")');
    expect(ftsQuery(parseQuery("christmas", NOW).terms)).not.toContain('"jul"*');
  });

  it("keeps a number with its unit whole", () => {
    expect(parseQuery("40mm lid", NOW).terms.map((term) => term.text)).toEqual(["40mm", "lid"]);
    expect(parseQuery("3color 210c", NOW).terms.map((term) => term.text)).toEqual(["3color", "210c"]);
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

  it("changes day at midnight in Stockholm, not in UTC", () => {
    // 21:30 UTC on 11 November is 22:30 there: still the 11th, which began at 23:00 UTC on the 10th.
    const before = Date.parse("2026-11-11T21:30:00Z");
    expect(new Date(whenRange("today", before).from).toISOString()).toBe("2026-11-10T23:00:00.000Z");
    // 23:30 UTC is 00:30 on the 12th there: a new day that began half an hour ago.
    const after = Date.parse("2026-11-11T23:30:00Z");
    expect(new Date(whenRange("today", after).from).toISOString()).toBe("2026-11-11T23:00:00.000Z");
    expect(new Date(whenRange("yesterday", after).from).toISOString()).toBe("2026-11-10T23:00:00.000Z");
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

describe("splitWord", () => {
  it("splits a word typed as one when both halves start known words", () => {
    const vocabulary = ["keychain", "ring", "tugboat"];
    expect(splitWord("keyring", vocabulary)).toEqual(["key", "ring"]);
    // A 3-letter half is a whole known word (the list keeps those apart).
    expect(splitWord("hotdog", ["hotel", "stand"], ["hot", "dog"])).toEqual(["hot", "dog"]);
    expect(splitWord("plantpot", ["plant", "planter"], ["pot"])).toEqual(["plant", "pot"]);
    expect(splitWord("tugboat", vocabulary)).toBeNull(); // known already
    expect(splitWord("qzxvbnm", vocabulary)).toBeNull();
  });
});
