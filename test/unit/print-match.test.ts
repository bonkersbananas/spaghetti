import { describe, expect, it } from "vitest";
import {
  coreKey,
  filedWords,
  looseKey,
  type MatchCandidate,
  type PrintFacts,
  placePrint,
  printKey,
  readableTitle,
  rowWords,
  scorePrint,
  sharedWords,
  shownName,
} from "../../src/shared/print-match.ts";

const MINUTE = 60_000;
/** Nov 21 2026, 19:29 in Stockholm: when Carl Oscar's fit-test ring began. */
const START = 1795285756492;

const build = (over: Partial<MatchCandidate> & Pick<MatchCandidate, "id">): MatchCandidate => ({
  title: null,
  stage: "building",
  startedAt: START - 3 * 24 * 60 * MINUTE,
  attempts: 2,
  files: [],
  sends: [],
  ...over,
});

/** The workshop as it was that evening: the glass markers just started, and a few other builds going. */
const glassMarkers = build({
  id: "glass",
  title: "UÖBF glass markers",
  startedAt: START - 26_000,
  attempts: 0,
  files: [
    { id: "marker-file", name: "UOBF-glass-marker.3mf", estimatedMinutes: 50 },
    { id: "ring-file", name: "UOBF-fit-test-ring.3mf", estimatedMinutes: 9 },
  ],
});
const tugboat = build({
  id: "tug",
  title: "Tugboat for Mila",
  files: [{ id: "tug-file", name: "tugboat_v3.gcode.3mf", estimatedMinutes: 182, attempt: 2 }],
});
const hooks = build({
  id: "hooks",
  title: "Skadis hooks",
  files: [{ id: "hook-file", name: "skadis-hook-25mm_plate_2.gcode.3mf", estimatedMinutes: 34, attempt: 1 }],
});
const workshop = [tugboat, glassMarkers, hooks];

const ring: PrintFacts = { name: "UOBF-fit-test-ring(2)", startedAt: START };

describe("printKey", () => {
  it.each([
    ["UOBF-fit-test-ring(2)", "uobf fit test ring"],
    ["UOBF-fit-test-ring.3mf", "uobf fit test ring"],
    ["UÖBF glass markers", "uobf glass markers"],
    ["UOBF-fit-test-ring.gcode (1).3mf", "uobf fit test ring"],
    ["UOBF-fit-test-ring(2).gcode.3mf", "uobf fit test ring"],
    ["/sdcard/cache/Skadis_hook_25mm_plate_2.gcode.3mf", "skadis hook 25mm"],
    ["bracket v2 copy.stl", "bracket v2"],
    ["Metadata/plate_1.gcode", ""],
    ["Smörgåsbräda – hållare", "smorgasbrada hallare"],
    ["", ""],
  ])("%s → %s", (name, key) => {
    expect(printKey(name)).toBe(key);
  });
});

describe("Carl Oscar's fit-test ring", () => {
  it("goes straight into the glass markers: same file as the one kept there, in a build started just before", () => {
    const scored = scorePrint(ring, workshop);
    expect(scored[0]).toMatchObject({ itemId: "glass", score: 70 });
    expect(scored[0]?.reasons.map((reason) => reason.kind)).toEqual(["file", "fresh"]);
    expect(placePrint(scored)).toMatchObject({ kind: "match", best: { itemId: "glass" } });
    expect(filedWords(scored[0]?.reasons ?? [])).toBe("Filed here: it printed UOBF-fit-test-ring, this build's file.");
  });

  it("says it was opened in Bambu Studio just before, when it was", () => {
    const sent = { ...glassMarkers, sends: [{ fileId: "ring-file", at: START - 20_000, how: "studio" as const }] };
    const scored = scorePrint(ring, [tugboat, sent, hooks]);
    expect(scored[0]).toMatchObject({ itemId: "glass", score: 115 });
    expect(filedWords(scored[0]?.reasons ?? [])).toBe(
      "Filed here: it printed UOBF-fit-test-ring, this build's file, opened in Bambu Studio just before it began.",
    );
    expect(rowWords(scored[0]?.reasons ?? [])).toBe("Same file: UOBF-fit-test-ring");
  });

  it("says the strongest reason, in a sentence for the print and a few words for a row", () => {
    const bracket = build({ id: "bracket", title: "bracket", files: [{ id: "b", name: "bracket.3mf" }] });
    const [best] = scorePrint({ name: "bracket", startedAt: START }, [bracket]);
    expect(best?.reasons.map((reason) => reason.kind)).toEqual(["file", "title"]);
    expect(filedWords(best?.reasons ?? [])).toBe("Filed here: it printed bracket, this build's file.");
    expect(rowWords(best?.reasons ?? [])).toBe("Same file: bracket");
  });

  it("says once what every offer has in common", () => {
    const file = { kind: "file" as const, file: "planter-v2.gcode.3mf" };
    expect(sharedWords([{ reasons: [file] }, { reasons: [file, { kind: "fresh" }] }])).toBe("Both print planter-v2.");
    expect(sharedWords([{ reasons: [file] }, { reasons: [file] }, { reasons: [file] }])).toBe(
      "All three print planter-v2.",
    );
    expect(sharedWords([{ reasons: [file] }, { reasons: [{ kind: "title" }] }])).toBeNull();
    expect(sharedWords([{ reasons: [file] }])).toBeNull();
  });

  it.each([
    ["UOBF-fit-test-ring.3mf", "UOBF-fit-test-ring"],
    ["/sdcard/cache/bath-boat.gcode.3mf", "bath-boat"],
    ["tugboat_v3.gcode", "tugboat_v3"],
    ["Benchy.STL", "Benchy"],
  ])("shows %s as %s", (name, shown) => {
    expect(shownName(name)).toBe(shown);
  });

  it.each([
    // Bambu's copy number goes, hyphens and underscores are spaces, the first letter is a capital.
    ["UOBF-fit-test-ring(2)", "UOBF fit test ring"],
    ["spaghetti-mascot-tomato-40mm-v2(2)", "Spaghetti mascot tomato 40mm v2"],
    ["/sdcard/cache/UOBF-fit-test-ring(2).gcode.3mf", "UOBF fit test ring"],
    ["bath-boat (1).3mf", "Bath boat"],
    ["planter-v2(2)(1)", "Planter v2"],
    ["bracket_v2.gcode.3mf", "Bracket v2"],
    ["Desk  hook__final", "Desk hook final"],
    ["öresund-bridge", "Öresund bridge"],
    // Only a trailing number in parentheses is a copy: words in parentheses stay, and so does the rest's case.
    ["Smiley Box (print in place)", "Smiley Box (print in place)"],
    ["3DBenchy", "3DBenchy"],
    ["Model (2) of the bridge", "Model (2) of the bridge"],
  ])("titles a build the printer makes for %s as %s", (name, title) => {
    expect(readableTitle(name)).toBe(title);
  });

  it.each(["", "  ", ".gcode.3mf", "(2)", "--__"])("titles nothing when %j says nothing", (name) => {
    expect(readableTitle(name)).toBeNull();
  });

  it("asks when the build was started yesterday: a name alone is a suggestion, not a match", () => {
    const older = { ...glassMarkers, startedAt: START - 26 * 60 * MINUTE };
    const scored = scorePrint(ring, [tugboat, older, hooks]);
    expect(scored[0]).toMatchObject({ itemId: "glass", score: 60 });
    expect(placePrint(scored)).toMatchObject({ kind: "ask", suggestions: [{ itemId: "glass" }] });
  });

  it("asks between two builds that both keep the ring", () => {
    const spare = build({
      id: "spare",
      title: "Spare markers",
      attempts: 1,
      files: [{ id: "spare-ring", name: "UOBF fit test ring.3mf" }],
    });
    const placement = placePrint(scorePrint(ring, [glassMarkers, spare]));
    expect(placement.kind).toBe("ask");
    if (placement.kind === "ask") expect(placement.suggestions.map((s) => s.itemId)).toEqual(["glass", "spare"]);
  });
});

describe("names", () => {
  it("knows an attempt's file and says which attempt printed it", () => {
    const scored = scorePrint({ name: "tugboat_v3", startedAt: START }, workshop);
    expect(scored[0]).toMatchObject({ itemId: "tug", reasons: [{ kind: "file", attempt: 2 }] });
    expect(filedWords(scored[0]?.reasons ?? [])).toBe("Filed here: it printed tugboat_v3, as attempt 2 did.");
    expect(rowWords(scored[0]?.reasons ?? [])).toBe("Attempt 2 printed tugboat_v3");
  });

  it("drops the plate from a job's name", () => {
    expect(scorePrint({ name: "skadis-hook-25mm_plate_2", startedAt: START }, workshop)[0]?.itemId).toBe("hooks");
  });

  it("takes a browser's numbered copy as very likely the same file", () => {
    const [best] = scorePrint({ name: "tugboat_v3-2", startedAt: START }, workshop);
    expect(best).toMatchObject({ itemId: "tug", score: 50 });
  });

  it("matches a build named like the print, without a file", () => {
    const benchy = build({ id: "benchy", title: "3DBenchy" });
    const [best] = scorePrint({ name: "3DBenchy", startedAt: START }, [benchy]);
    expect(best).toMatchObject({ itemId: "benchy", reasons: [{ kind: "title" }] });
    expect(filedWords(best?.reasons ?? [])).toBe("Filed here: it has this build's name.");
  });

  it("finds a file named much like it, but only suggests it", () => {
    const [best] = scorePrint({ name: "UOBF fit test ring v2", startedAt: START }, workshop);
    expect(best?.itemId).toBe("glass");
    expect(best?.reasons[0]).toMatchObject({ kind: "like-file", file: "UOBF-fit-test-ring.3mf" });
    expect(placePrint(scorePrint({ name: "UOBF fit test ring v2", startedAt: START }, workshop)).kind).toBe("ask");
  });

  it("makes nothing of a name that says nothing", () => {
    const untitled = build({ id: "u", title: "Untitled", files: [{ id: "f", name: "Untitled.3mf" }] });
    expect(scorePrint({ name: "Untitled", startedAt: START }, [untitled])).toEqual([]);
    expect(placePrint([])).toEqual({ kind: "none" });
  });

  it.each(["Untitled 2", "Model 3", "Part 2", "untitled"])(
    "makes nothing of %s, a copy of a name that says nothing",
    (name) => {
      const plain = build({ id: "plain", title: "Desk", files: [{ id: "u", name: "Untitled.3mf" }] });
      const numbered = build({ id: "numbered", title: "Shelf", files: [{ id: "u2", name: "Model 2.3mf" }] });
      expect(scorePrint({ name, startedAt: START }, [plain, numbered])).toEqual([]);
    },
  );

  it("starts a build of its own for a print nothing knows", () => {
    expect(placePrint(scorePrint({ name: "cable-clip", startedAt: START }, workshop))).toEqual({ kind: "none" });
  });
});

describe("other signals", () => {
  it("counts a download hours before for less than one minutes before", () => {
    const soon = { ...tugboat, sends: [{ fileId: "tug-file", at: START - 10 * MINUTE, how: "download" as const }] };
    const hours = {
      ...tugboat,
      sends: [{ fileId: "tug-file", at: START - 2 * 60 * MINUTE, how: "download" as const }],
    };
    const day = { ...tugboat, sends: [{ fileId: "tug-file", at: START - 20 * 60 * MINUTE, how: "download" as const }] };
    const later = { ...tugboat, sends: [{ fileId: "tug-file", at: START + 30 * MINUTE, how: "download" as const }] };
    // A print whose name says nothing: what was taken away just before is all there is to go on.
    const print = { name: "Untitled", startedAt: START };
    expect(scorePrint(print, [soon])[0]?.score).toBe(45);
    expect(scorePrint(print, [hours])[0]?.score).toBe(25);
    expect(scorePrint(print, [day])[0]?.score).toBe(10);
    expect(scorePrint(print, [later])).toEqual([]);
    expect(filedWords(scorePrint(print, [soon])[0]?.reasons ?? [])).toBe(
      "Filed here: tugboat_v3 was downloaded 10 min before it began.",
    );
  });

  it("matches a renamed job by its download and the printer's estimate", () => {
    const sent = { ...hooks, sends: [{ fileId: "hook-file", at: START - 4 * MINUTE, how: "download" as const }] };
    const scored = scorePrint({ name: "hook", startedAt: START, estimateMinutes: 36 }, [tugboat, sent]);
    expect(scored[0]).toMatchObject({ itemId: "hooks", score: 60 });
    expect(scored[0]?.reasons.map((reason) => reason.kind)).toEqual(["sent", "estimate"]);
  });

  it("is certain of a file that carries our mark, whatever it is called", () => {
    const scored = scorePrint({ name: "Plate 1", startedAt: START, fileId: "ring-file" }, workshop);
    expect(scored[0]?.itemId).toBe("glass");
    expect(scored[0]?.reasons[0]).toMatchObject({ kind: "marker" });
    expect(placePrint(scored).kind).toBe("match");
    expect(filedWords(scored[0]?.reasons ?? [])).toBe(
      "Filed here: it printed UOBF-fit-test-ring, sliced here for this build.",
    );
  });

  it("offers at most three suggestions", () => {
    const many = ["a", "b", "c", "d"].map((id) =>
      build({ id, title: `Ring ${id}`, files: [{ id, name: "ring.3mf" }] }),
    );
    const placement = placePrint(scorePrint({ name: "ring", startedAt: START }, many));
    expect(placement.kind === "ask" && placement.suggestions).toHaveLength(3);
  });

  it("puts builds in progress before ideas, then the one started last, when they are as likely", () => {
    const file = (id: string) => [{ id, name: "planter-v2.gcode.3mf" }];
    const older = build({ id: "a-older", startedAt: START - 5 * 24 * 60 * MINUTE, files: file("older") });
    const newer = build({ id: "b-newer", startedAt: START - 2 * 24 * 60 * MINUTE, files: file("newer") });
    const idea = build({ id: "0-idea", stage: "idea", startedAt: null, attempts: 0, files: file("idea") });
    const scored = scorePrint({ name: "planter-v2(2)", startedAt: START }, [idea, older, newer]);
    expect(scored.map((one) => one.itemId)).toEqual(["b-newer", "a-older", "0-idea"]);
  });
});

/**
 * A made-up print, "BRKT-shelf-peg-v5(2)-print": the shelf pegs build has printed it (and the plain "(2)") before and
 * keeps its file, while a file of an unrelated idea was opened in Bambu Studio 37 minutes earlier.
 */
describe("a strong name against a file opened shortly before", () => {
  const shelfPegs = build({
    id: "pegs",
    title: "BRKT shelf pegs",
    startedAt: START - 3 * 24 * 60 * MINUTE,
    attempts: 9,
    files: [
      { id: "peg", name: "BRKT-shelf-peg.3mf" },
      { id: "peg-v4", name: "BRKT-shelf-peg-v4.3mf" },
      { id: "peg-v5", name: "BRKT-shelf-peg-v5.3mf" },
      { id: "gauge", name: "BRKT-hole-gauge-v2.3mf" },
    ],
    prints: [
      { name: "BRKT-shelf-peg-v5(2)", attempt: 6 },
      { name: "BRKT-shelf-peg-v5", attempt: 4 },
      { name: "BRKT-hole-gauge-v2(3)", attempt: 2 },
    ],
  });
  const lanterns = build({
    id: "lanterns",
    title: "Paper lanterns, five shapes",
    stage: "idea",
    startedAt: null,
    attempts: 0,
    files: [{ id: "lantern-file", name: "paper_lanterns.3mf" }],
    sends: [{ fileId: "lantern-file", at: START - 37 * MINUTE, how: "studio" }],
  });
  const print: PrintFacts = { name: "BRKT-shelf-peg-v5(2)-print", startedAt: START };

  it("reads the name without its filler, copy number and version", () => {
    expect(printKey("BRKT-shelf-peg-v5(2)-print")).toBe("brkt shelf peg v5 print");
    expect(looseKey("brkt shelf peg v5 print")).toBe("brkt shelf peg v5");
    // Both sides are stemmed alike, so a plural never costs the match.
    expect(coreKey("brkt shelf peg v5 print")).toBe("brkt shelf peg");
    expect(coreKey(printKey("BRKT shelf pegs"))).toBe("brkt shelf peg");
    expect(coreKey("tool boxes")).toBe("tool box");
    expect(coreKey("tray assemblies")).toBe("tray assembly");
    // Numbers stay: they say which thing it is.
    expect(coreKey("gear 24 v2")).toBe("gear 24");
  });

  it("goes straight into the build whose earlier prints and file have its name", () => {
    const scored = scorePrint(print, [lanterns, shelfPegs]);
    expect(scored[0]).toMatchObject({ itemId: "pegs", score: 150 });
    expect(scored[0]?.reasons.map((reason) => reason.kind)).toEqual(["file", "printed", "title"]);
    expect(placePrint(scored)).toMatchObject({ kind: "match", best: { itemId: "pegs" } });
    expect(filedWords(scored[0]?.reasons ?? [])).toBe("Filed here: it printed BRKT-shelf-peg-v5, this build's file.");
    expect(filedWords(scored[0]?.reasons.slice(1) ?? [])).toBe(
      "Filed here: attempt 6 had the same name, BRKT-shelf-peg-v5(2).",
    );
  });

  it("makes little of an unrelated file opened in Bambu Studio before it", () => {
    // 37 minutes before it is nothing; within half an hour it is still a little something.
    expect(scorePrint(print, [lanterns])).toEqual([]);
    const soon = { ...lanterns, sends: [{ fileId: "lantern-file", at: START - 10 * MINUTE, how: "studio" as const }] };
    expect(scorePrint(print, [soon])[0]).toMatchObject({ score: 10, reasons: [{ kind: "sent", unrelated: true }] });
    expect(placePrint(scorePrint(print, [soon]))).toEqual({ kind: "none" });
  });

  it("still counts the file opened before it when its name agrees", () => {
    const opened = { ...shelfPegs, sends: [{ fileId: "peg-v5", at: START - 37 * MINUTE, how: "studio" as const }] };
    const sent = scorePrint(print, [opened])[0]?.reasons.find((reason) => reason.kind === "sent");
    expect(sent).toMatchObject({ kind: "sent", minutes: 37 });
    expect(sent).not.toHaveProperty("unrelated");
  });

  it("knows a build by its earlier prints alone", () => {
    const bare = { ...shelfPegs, title: "Closet", files: [] };
    const scored = scorePrint({ name: "BRKT-shelf-peg-v5(3)", startedAt: START }, [bare, lanterns]);
    expect(scored[0]).toMatchObject({ itemId: "pegs", score: 55 });
    expect(rowWords(scored[0]?.reasons ?? [])).toBe("Same name as attempt 6");
    // A newer version of what it printed is much like it, not the same.
    const newer = scorePrint({ name: "BRKT-shelf-pegs-v6", startedAt: START }, [bare]);
    expect(newer[0]?.reasons[0]).toMatchObject({ kind: "printed", like: true, attempt: 6 });
    expect(rowWords(newer[0]?.reasons ?? [])).toBe("Named like attempt 6");
  });

  it("takes plurals, versions and filler as the build's name", () => {
    const shades = build({ id: "shades", title: "Lamp shades" });
    const [best] = scorePrint({ name: "lamp-shade-v2-final", startedAt: START }, [shades]);
    expect(best).toMatchObject({ itemId: "shades", reasons: [{ kind: "title" }] });
  });
});

describe("a printer's build still asking", () => {
  it("is offered but never matched into", () => {
    const scored = [{ itemId: "own", score: 100, reasons: [] }];
    expect(placePrint(scored).kind).toBe("match");
    expect(placePrint(scored, new Set(["own"]))).toMatchObject({ kind: "ask", suggestions: [{ itemId: "own" }] });
  });
});

describe("numbers in names", () => {
  // A size, a count or a year says which thing it is: a different one is never a match, and never placed.
  it.each([
    ["gear-24", "Gear 12", "gear-12.3mf"],
    ["spacer_10", "Spacer 15", "spacer_15.3mf"],
    ["cube 20 mm", "Cube 10 mm", "cube_10mm.3mf"],
    ["calendar-2025", "Calendar 2024", "calendar-2024.3mf"],
    ["knob-20mm", "Knob 30mm", "knob-30mm.3mf"],
  ])("makes nothing of %s for the build %s keeping %s", (name, title, file) => {
    const other = build({
      id: "other",
      title,
      startedAt: START - 26_000,
      attempts: 0,
      files: [{ id: "f", name: file }],
    });
    expect(scorePrint({ name, startedAt: START }, [other])).toEqual([]);
  });

  it("makes nothing of an earlier print with a different number", () => {
    const bolts = build({ id: "bolts", title: "Bolts", prints: [{ name: "M3 bolt 30", attempt: 1 }] });
    const [best] = scorePrint({ name: "M3 bolt 20", startedAt: START }, [bolts]);
    expect(best?.reasons.find((reason) => reason.kind === "printed")).toBeUndefined();
  });

  it("still takes the same number, a version or a copy as the same thing", () => {
    const gear = build({ id: "gear", title: "Gear 24", files: [{ id: "g", name: "gear-24-v2.3mf" }] });
    const [best] = scorePrint({ name: "gear-24-v2(3)-print", startedAt: START }, [gear]);
    expect(best?.reasons.map((reason) => reason.kind)).toEqual(["file", "title"]);
  });
});

describe("a copy's number after a name that ends in a number", () => {
  // A browser's "-2" on "pot_4color_30mm(5)-12" gives "pot_4color_30mm(5)-12-2": a copy of the same print.
  const pot = build({
    id: "pot",
    title: "Flower pot",
    files: [{ id: "pot-file", name: "pot_4color_30mm.3mf" }],
    prints: [{ name: "pot_4color_30mm(5)-12", attempt: 1 }],
  });
  const other = build({ id: "other", title: "Gear 24", files: [{ id: "g", name: "gear-24.3mf" }] });

  it("files the print with the earlier one and the file it comes from, not asking", () => {
    const scored = scorePrint({ name: "pot_4color_30mm(5)-12-2", startedAt: START }, [pot, other]);
    expect(scored[0]?.reasons.map((reason) => reason.kind)).toEqual(expect.arrayContaining(["printed", "file"]));
    expect(placePrint(scored)).toMatchObject({ kind: "match", best: { itemId: "pot" } });
  });

  it("knows the earlier print by its own name, number and all", () => {
    const [best] = scorePrint({ name: "pot_4color_30mm(5)-12", startedAt: START }, [pot]);
    expect(best?.reasons.map((reason) => reason.kind)).toEqual(["printed"]);
  });

  it("still keeps different numbers apart, however they end", () => {
    const sizes = build({ id: "sizes", prints: [{ name: "pot_4color_30mm(5)-12", attempt: 1 }] });
    for (const name of ["pot_4color_30mm(5)-24", "pot_4color_40mm(5)-12-2", "pot_4color_40mm(5)-12"]) {
      expect(scorePrint({ name, startedAt: START }, [sizes])).toEqual([]);
    }
  });

  it("never reads a pair of sizes as a copy of the first", () => {
    const box = build({ id: "box", prints: [{ name: "box-20", attempt: 1 }], files: [{ id: "b", name: "box.3mf" }] });
    expect(scorePrint({ name: "box-20-10", startedAt: START }, [box])).toEqual([]);
  });

  it("never reads a number as a copy of a different one", () => {
    const gear = build({ id: "gear", prints: [{ name: "gear-24", attempt: 1 }] });
    expect(scorePrint({ name: "gear-12", startedAt: START }, [gear])).toEqual([]);
  });
});

describe("Claude's reason", () => {
  it("reads as a few words after the colon", () => {
    expect(rowWords([{ kind: "claude", why: "Earlier prints in it had this name." }])).toBe(
      "Claude thinks so: earlier prints in it had this name",
    );
    expect(rowWords([{ kind: "claude", why: "LMPS is in all its file names" }])).toBe(
      "Claude thinks so: LMPS is in all its file names",
    );
  });
});
