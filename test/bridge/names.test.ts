import { describe, expect, it } from "vitest";
import { fileKey, jpegSize, stableId, titleFromJob } from "../../bridge/names.ts";

describe("names", () => {
  it("cleans a file name into a title", () => {
    expect(titleFromJob("bracket_v2.gcode.3mf")).toBe("bracket v2");
    expect(titleFromJob("/cache/Desk  hook.3mf")).toBe("Desk hook");
    expect(titleFromJob("  ")).toBeNull();
    expect(titleFromJob(".gcode.3mf")).toBeNull();
  });

  it("compares file names the way people would", () => {
    expect(fileKey("Bracket_v2.gcode.3mf")).toBe(fileKey("bracket v2"));
    expect(fileKey("/sdcard/bracket v2.3mf")).toBe("bracket v2");
  });

  it("makes the same id from the same parts and a different one otherwise", () => {
    expect(stableId("a", "b")).toBe(stableId("a", "b"));
    expect(stableId("a", "b")).not.toBe(stableId("a", "c"));
    expect(stableId("a", "b")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("reads a JPEG's size", () => {
    const header = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x03, 0x84, 0x05, 0x00, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    ]);
    expect(jpegSize(header)).toEqual({ width: 1280, height: 900 });
    expect(jpegSize(Uint8Array.from([1, 2, 3]))).toBeNull();
  });
});
