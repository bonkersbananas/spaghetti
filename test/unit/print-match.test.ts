import { describe, expect, it } from "vitest";
import {
  type MatchCandidate,
  type PrintFacts,
  placePrint,
  printKey,
  scorePrint,
  whyLabel,
  whyWords,
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
    expect(whyWords(scored[0]?.reasons ?? [])).toBe("Same file as UOBF-fit-test-ring.3mf.");
  });

  it("says it was opened in Bambu Studio just before, when it was", () => {
    const sent = { ...glassMarkers, sends: [{ fileId: "ring-file", at: START - 20_000, how: "studio" as const }] };
    const scored = scorePrint(ring, [tugboat, sent, hooks]);
    expect(scored[0]).toMatchObject({ itemId: "glass", score: 115 });
    expect(whyWords(scored[0]?.reasons ?? [])).toBe(
      "Same file as UOBF-fit-test-ring.3mf, opened in Bambu Studio just before it began.",
    );
    expect(whyLabel(scored[0]?.reasons ?? [])).toBe("Same file");
  });

  it("says the strongest reason alone on a card, and two on the build's own page", () => {
    const bracket = build({ id: "bracket", title: "bracket", files: [{ id: "b", name: "bracket.3mf" }] });
    const [best] = scorePrint({ name: "bracket", startedAt: START }, [bracket]);
    expect(whyWords(best?.reasons ?? [])).toBe("Same file as bracket.3mf; the build has its name.");
    expect(whyWords(best?.reasons ?? [], { brief: true })).toBe("Same file as bracket.3mf.");
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
    expect(whyWords(scored[0]?.reasons ?? [])).toBe("Same file as attempt 2 (tugboat_v3.gcode.3mf).");
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
    expect(whyWords(best?.reasons ?? [])).toBe("The build has its name.");
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
    const print = { name: "something else", startedAt: START };
    expect(scorePrint(print, [soon])[0]?.score).toBe(45);
    expect(scorePrint(print, [hours])[0]?.score).toBe(25);
    expect(scorePrint(print, [day])[0]?.score).toBe(10);
    expect(scorePrint(print, [later])).toEqual([]);
    expect(whyWords(scorePrint(print, [soon])[0]?.reasons ?? [])).toBe(
      "Downloaded 10 min before it began: tugboat_v3.gcode.3mf.",
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
    expect(whyWords(scored[0]?.reasons ?? [])).toBe("The file is UOBF-fit-test-ring.3mf, sliced here.");
  });

  it("offers at most three suggestions", () => {
    const many = ["a", "b", "c", "d"].map((id) =>
      build({ id, title: `Ring ${id}`, files: [{ id, name: "ring.3mf" }] }),
    );
    const placement = placePrint(scorePrint({ name: "ring", startedAt: START }, many));
    expect(placement.kind === "ask" && placement.suggestions).toHaveLength(3);
  });
});
