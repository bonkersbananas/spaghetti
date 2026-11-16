import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NAMING_TIMEOUT_MS, namingUntil } from "../../src/shared/naming.ts";

describe("namingUntil", () => {
  it("follows the server's naming job, for as long as the timeout", () => {
    expect(namingUntil({ title: null, titleJob: { status: "naming", since: 1000 } })).toBe(1000 + NAMING_TIMEOUT_MS);
  });

  it("shows nothing once the job is done, never asked, or the idea has a title", () => {
    expect(namingUntil({ title: null, titleJob: { status: "done", since: 1000 } })).toBeNull();
    expect(namingUntil({ title: null, titleJob: null })).toBeNull();
    expect(namingUntil({ title: null })).toBeNull();
    // A title typed while the server still says "naming" ends it too.
    expect(namingUntil({ title: "Mine", titleJob: { status: "naming", since: 1000 } })).toBeNull();
  });
});

describe("the Journal's copy of the timeout", () => {
  it("is NAMING_TIMEOUT_MS, written out in JournalEntry.tsx to keep the Journal's first load small", () => {
    const source = readFileSync(
      new URL("../../src/client/components/journal/JournalEntry.tsx", import.meta.url),
      "utf8",
    );
    const written = /now >= since \+ ([\d_]+)\)/.exec(source)?.[1];
    expect(Number(written?.replaceAll("_", ""))).toBe(NAMING_TIMEOUT_MS);
  });
});
