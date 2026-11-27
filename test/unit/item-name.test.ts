import { describe, expect, it } from "vitest";
import { clipName, itemName, leadingLink, nameOf, noteAfterName, UNTITLED } from "../../src/shared/item-name.ts";
import { linkName } from "../../src/shared/link-name.ts";

const GRIDFINITY = "https://makerworld.com/en/models/1234567-gridfinity-baseplate";

describe("itemName: one name for an idea, everywhere", () => {
  it("lets a title someone typed win over everything", () => {
    expect(itemName({ title: "  Desk tidy-up ", note: GRIDFINITY, linkTitle: "Gridfinity baseplate, 4x4" })).toEqual({
      text: "Desk tidy-up",
      titled: true,
      from: "title",
    });
  });

  it("names a link idea by what the Worker says its link is called", () => {
    expect(itemName({ title: null, note: GRIDFINITY, linkTitle: "Gridfinity baseplate, 4x4" })).toEqual({
      text: "Gridfinity baseplate, 4x4",
      titled: false,
      from: "link",
    });
    // A note that goes on under the link is still named by the link.
    expect(nameOf({ title: "", note: `${GRIDFINITY}\nIn the blue PETG`, linkTitle: "Gridfinity baseplate, 4x4" })).toBe(
      "Gridfinity baseplate, 4x4",
    );
  });

  it("falls back to the words in a link's address while its page is unread", () => {
    expect(itemName({ title: null, note: GRIDFINITY })).toMatchObject({ text: "Gridfinity baseplate", from: "link" });
    expect(nameOf({ title: null, note: "https://www.ikea.com/se/en/p/skadis-pegboard-white-20320802" })).toBe(
      "Skadis pegboard white",
    );
  });

  it("never names a thing by a raw address", () => {
    // No words in the link: the note's next line, else the quiet name.
    expect(nameOf({ title: null, note: "https://makerworld.com/en/models/1234567\nFor the drawer" })).toBe(
      "For the drawer",
    );
    expect(nameOf({ title: null, note: "https://makerworld.com/en/models/1234567" })).toBe(UNTITLED.idea);
  });

  it("names a note-only idea by its note's first line", () => {
    expect(itemName({ title: null, note: "\n  Hook for the bike helmet  \nsecond line" })).toEqual({
      text: "Hook for the bike helmet",
      titled: false,
      from: "note",
    });
    // A link inside the words is part of the words, not a link idea.
    expect(nameOf({ title: null, note: "Like this one https://example.com/a-b" })).toBe(
      "Like this one https://example.com/a-b",
    );
  });

  it("gives a photo-only idea, or a build, one quiet name", () => {
    expect(itemName({ title: null, note: "" })).toEqual({ text: "Untitled idea", titled: false, from: "none" });
    expect(nameOf({ title: "   ", note: "  ", stage: "idea" })).toBe("Untitled idea");
    expect(nameOf({ title: null, note: "", stage: "building" })).toBe("Untitled build");
  });

  it("cuts a long name on a whole word", () => {
    const long = `${"word ".repeat(40)}end`;
    const name = nameOf({ title: null, note: long });
    expect(name.length).toBeLessThanOrEqual(120);
    expect(name.endsWith("word…")).toBe(true);
    expect(clipName("short")).toBe("short");
  });
});

describe("leadingLink", () => {
  it("finds the link a note starts with, only when that line is the link alone", () => {
    expect(leadingLink(`\n${GRIDFINITY}\nmore`)).toBe(GRIDFINITY);
    expect(leadingLink(`See ${GRIDFINITY}`)).toBeNull();
    expect(leadingLink("")).toBeNull();
    expect(leadingLink(undefined)).toBeNull();
  });
});

describe("noteAfterName", () => {
  it("gives the note's words after the line the name came from, never the name again", () => {
    expect(noteAfterName({ title: "Bins", note: "For the drawer" })).toBe("For the drawer");
    expect(noteAfterName({ title: null, note: `${GRIDFINITY}\nIn blue` })).toBe("In blue");
    expect(
      noteAfterName({ title: null, note: "https://makerworld.com/en/models/1234567\nFor the drawer\nTwo of them" }),
    ).toBe("Two of them");
    expect(noteAfterName({ title: null, note: "Hook\nfor the helmet" })).toBe("for the helmet");
    expect(noteAfterName({ title: null, note: "" })).toBe("");
  });
});

describe("linkName (the Worker's reading of a link)", () => {
  it("tidies a page's title of its site's name, else reads the address", () => {
    expect(linkName(GRIDFINITY, "Gridfinity baseplate, 4x4 | MakerWorld")).toBe("Gridfinity baseplate, 4x4");
    expect(linkName("https://www.printables.com/model/1577248-carrying-handle-for-ikea-antilop")).toBe(
      "Carrying handle for IKEA Antilop",
    );
    expect(linkName(GRIDFINITY)).toBe("Gridfinity baseplate");
    expect(linkName("https://makerworld.com/en/models/1234567")).toBeNull();
  });
});
