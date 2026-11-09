import { describe, expect, it } from "vitest";
import { exifSegment, parseExifDate, readTakenAt } from "../../src/shared/exif.ts";

function jpegWith(...segments: Uint8Array[]): ArrayBuffer {
  const parts = [new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xda, 0, 2, 0, 0])];
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes.buffer;
}

const app0 = new Uint8Array([0xff, 0xe0, 0, 6, 0x4a, 0x46, 0x49, 0x46]);

describe("readTakenAt", () => {
  it("reads DateTimeOriginal in either byte order, after other segments", () => {
    const expected = new Date(2026, 9, 31, 18, 4, 59).getTime();
    expect(readTakenAt(jpegWith(app0, exifSegment("2026:10:31 18:04:59")))).toBe(expected);
    expect(readTakenAt(jpegWith(exifSegment("2026:10:31 18:04:59", true)))).toBe(expected);
  });

  it("returns null without EXIF, for other formats and for junk", () => {
    expect(readTakenAt(jpegWith(app0))).toBeNull();
    expect(readTakenAt(new TextEncoder().encode("RIFF....WEBP").buffer)).toBeNull();
    expect(readTakenAt(new ArrayBuffer(0))).toBeNull();
    expect(readTakenAt(jpegWith(exifSegment("0000:00:00 00:00:00")))).toBeNull();
  });

  it("survives a truncated segment", () => {
    const whole = new Uint8Array(jpegWith(exifSegment("2026:10:31 18:04:59")));
    expect(readTakenAt(whole.slice(0, 30).buffer)).toBeNull();
  });
});

describe("parseExifDate", () => {
  it("rejects other shapes", () => {
    expect(parseExifDate("2026-10-31T18:04:59")).toBeNull();
    expect(parseExifDate(null)).toBeNull();
  });
});
