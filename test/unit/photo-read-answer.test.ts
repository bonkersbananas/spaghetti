import { describe, expect, it } from "vitest";
import type { Outcome } from "../../src/shared/attempts.ts";
import { takenWith } from "../../src/shared/photo-read.ts";

const reads = {
  success: { outcome: "success" as const, failureTags: [], successNotes: ["nice-surface"] },
  partial: { outcome: "partial" as const, failureTags: ["stringing"], successNotes: ["clean-overhangs"] },
  failed: { outcome: "failed" as const, failureTags: ["spaghetti", "bed-adhesion"], successNotes: [] },
};
const OUTCOMES: Outcome[] = ["success", "partial", "failed"];
const fresh = { outcome: null, failureTags: [], successNotes: [] };

describe("takenWith: what an answer takes from Claude's suggestion (decision 0023)", () => {
  it("picking the suggested outcome takes its tags and notes, as far as they fit the answer", () => {
    expect(takenWith("success", fresh, { read: reads.success, printerTag: null })).toEqual({
      successNotes: ["nice-surface"],
    });
    expect(takenWith("partial", fresh, { read: reads.partial, printerTag: null })).toEqual({
      failureTags: ["stringing"],
      successNotes: ["clean-overhangs"],
    });
    expect(takenWith("failed", fresh, { read: reads.failed, printerTag: null })).toEqual({
      failureTags: ["spaghetti", "bed-adhesion"],
    });
  });

  for (const suggested of OUTCOMES)
    for (const picked of OUTCOMES.filter((o) => o !== suggested))
      it(`picking ${picked} where Claude suggested ${suggested} takes nothing of Claude's`, () => {
        expect(takenWith(picked, fresh, { read: reads[suggested], printerTag: null })).toEqual({});
      });

  it("the printer's tag comes with any answer but Worked, Claude's taking its place when Claude's answer is picked", () => {
    const printerTag = "nozzle-clog";
    expect(takenWith("success", fresh, { read: null, printerTag })).toEqual({});
    expect(takenWith("partial", fresh, { read: null, printerTag })).toEqual({ failureTags: [printerTag] });
    expect(takenWith("failed", fresh, { read: null, printerTag })).toEqual({ failureTags: [printerTag] });
    // Claude said Spaghetti, the person says Partly: the printer's tag, not Claude's.
    expect(takenWith("partial", fresh, { read: reads.failed, printerTag })).toEqual({ failureTags: [printerTag] });
    expect(takenWith("failed", fresh, { read: reads.failed, printerTag })).toEqual({
      failureTags: ["spaghetti", "bed-adhesion"],
    });
    expect(takenWith("success", fresh, { read: reads.success, printerTag })).toEqual({
      successNotes: ["nice-surface"],
    });
  });

  it("never adds over what the person chose", () => {
    const mine = { outcome: null, failureTags: ["warping"], successNotes: ["strong"] };
    expect(takenWith("partial", mine, { read: reads.partial, printerTag: "spaghetti" })).toEqual({});
  });

  it("changing the answer takes off what came along untouched, and keeps what the person changed", () => {
    const tookSpaghetti = { outcome: "failed" as const, failureTags: ["spaghetti", "bed-adhesion"], successNotes: [] };
    expect(takenWith("partial", tookSpaghetti, { read: reads.failed, printerTag: null })).toEqual({ failureTags: [] });
    expect(takenWith("success", tookSpaghetti, { read: reads.failed, printerTag: null })).toEqual({ failureTags: [] });
    const edited = { ...tookSpaghetti, failureTags: ["spaghetti"] };
    expect(takenWith("partial", edited, { read: reads.failed, printerTag: null })).toEqual({});
    const tookWorked = { outcome: "success" as const, failureTags: [], successNotes: ["nice-surface"] };
    expect(takenWith("partial", tookWorked, { read: reads.success, printerTag: null })).toEqual({ successNotes: [] });
    // Back to Claude's answer: its suggestion comes again.
    expect(takenWith("failed", { ...fresh, outcome: "partial" }, { read: reads.failed, printerTag: null })).toEqual({
      failureTags: ["spaghetti", "bed-adhesion"],
    });
    // The printer's tag leaves for Worked, and swaps for Claude's tags... only when nothing else was chosen.
    const tookPrinter = { outcome: "partial" as const, failureTags: ["nozzle-clog"], successNotes: [] };
    expect(takenWith("success", tookPrinter, { read: null, printerTag: "nozzle-clog" })).toEqual({ failureTags: [] });
    expect(takenWith("failed", tookPrinter, { read: null, printerTag: "nozzle-clog" })).toEqual({});
  });
});
