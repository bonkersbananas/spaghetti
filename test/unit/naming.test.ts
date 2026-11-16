import { describe, expect, it } from "vitest";
import { NAMING_TIMEOUT_MS, namingUntil } from "../../src/shared/title.ts";

const now = 1_800_000_000_000;
const idea = { stage: "idea", title: null, note: "", photos: 1, createdAt: now, createdVia: null, titleJob: null };

describe("namingUntil", () => {
  it("follows the server's job once there is one, for as long as the timeout", () => {
    expect(namingUntil({ ...idea, titleJob: { status: "naming", since: now - 1000 } }, false)).toBe(
      now - 1000 + NAMING_TIMEOUT_MS,
    );
    expect(namingUntil({ ...idea, titleJob: { status: "done", since: now } }, true)).toBeNull();
  });

  it("shows a fresh capture Claude will name before the server has the job, only with the key", () => {
    expect(namingUntil(idea, true)).toBe(now + NAMING_TIMEOUT_MS);
    expect(namingUntil({ ...idea, photos: 0, note: "a clip for the cable" }, true)).toBe(now + NAMING_TIMEOUT_MS);
    expect(namingUntil(idea, false)).toBeNull();
  });

  it("never shows for a title, a link idea, a build, an agent's capture or nothing to read", () => {
    expect(namingUntil({ ...idea, title: "Cable clip" }, true)).toBeNull();
    expect(namingUntil({ ...idea, note: "https://makerworld.com/en/models/123456" }, true)).toBeNull();
    expect(namingUntil({ ...idea, stage: "building" }, true)).toBeNull();
    expect(namingUntil({ ...idea, createdVia: "agent-1" }, true)).toBeNull();
    expect(namingUntil({ ...idea, photos: 0 }, true)).toBeNull();
    // A title typed while the server still says "naming" ends it too.
    expect(namingUntil({ ...idea, title: "Mine", titleJob: { status: "naming", since: now } }, true)).toBeNull();
  });
});
