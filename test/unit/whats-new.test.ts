import { describe, expect, it } from "vitest";
import { addNote, entryOfHtml, KEEP_NOTES, parseNotes, sentenceFor } from "../../src/shared/whats-new.ts";

const e = (n: number, note = `Note ${n}.`) => ({ entry: `/assets/index-${n}.js`, date: "2026-11-12", note });

describe("sentenceFor", () => {
  const notes = [e(1), e(2), e(3), e(4)];
  it("shows the notes newer than the page's own version", () => {
    expect(sentenceFor(notes, "/assets/index-3.js")).toBe("Note 4.");
  });
  it("joins the newest two when several are newer", () => {
    expect(sentenceFor(notes, "/assets/index-1.js")).toBe("Note 3. Note 4.");
  });
  it("takes only the newest entry when the page's version isn't listed", () => {
    expect(sentenceFor(notes, "/assets/index-9.js")).toBe("Note 4.");
    expect(sentenceFor(notes, null)).toBe("Note 4.");
  });
  it("ignores versions shipped without a note, and an unlisted page gets only a newest entry that has one", () => {
    expect(sentenceFor([e(1), e(2, ""), e(3, "")], "/assets/index-2.js")).toBeUndefined();
    expect(sentenceFor([e(1), e(2, ""), e(3, "")], "/assets/index-1.js")).toBeUndefined();
    expect(sentenceFor([e(1), e(2, ""), e(3)], "/assets/index-1.js")).toBe("Note 3.");
  });
  it("says nothing when the page is on the newest entry or there are no notes", () => {
    expect(sentenceFor(notes, "/assets/index-4.js")).toBeUndefined();
    expect(sentenceFor([], "/assets/index-1.js")).toBeUndefined();
  });
});

describe("parseNotes", () => {
  it("survives anything", () => {
    for (const bad of [null, undefined, 3, "x", {}, { notes: "x" }, { notes: [null, 1, {}] }]) {
      expect(parseNotes(bad)).toEqual([]);
    }
  });
  it("drops malformed entries and keeps note-less markers", () => {
    expect(parseNotes({ notes: [e(1), { entry: "a" }, e(2, "")] })).toEqual([e(1), e(2, "")]);
  });
});

describe("addNote", () => {
  it("starts a new file when the old one is missing or broken", () => {
    expect(addNote(undefined, e(1))).toEqual({ notes: [e(1)] });
    expect(addNote("<html>", e(1))).toEqual({ notes: [e(1)] });
  });
  it("appends, keeps the last KEEP_NOTES and replaces the same version", () => {
    const many = { notes: Array.from({ length: KEEP_NOTES }, (_, i) => e(i)) };
    const next = addNote(many, e(100));
    expect(next.notes).toHaveLength(KEEP_NOTES);
    expect(next.notes.at(-1)).toEqual(e(100));
    expect(next.notes[0]).toEqual(e(1));
    expect(addNote(next, e(100, "Again.")).notes.filter((n) => n.entry === e(100).entry)).toHaveLength(1);
  });
});

describe("entryOfHtml", () => {
  it("finds the module script whatever the attribute order", () => {
    expect(entryOfHtml('<script type="module" crossorigin src="/assets/index-a.js"></script>')).toBe(
      "/assets/index-a.js",
    );
    expect(
      entryOfHtml('<script src="/x.js"></script><script crossorigin src="/assets/i.js" type="module"></script>'),
    ).toBe("/assets/i.js");
    expect(entryOfHtml("<p>none</p>")).toBeUndefined();
  });
});
