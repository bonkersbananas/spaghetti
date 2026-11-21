import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hasPhotoMetadata } from "../../src/shared/photo-metadata.ts";

/** What a shared link may serve (decision 0075): photos with no EXIF, XMP or IPTC in their bytes. */

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "../../e2e/fixtures", name)));
const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];

function jpeg(...segments: number[][]) {
  const sos = [0xff, 0xda, ...be16(8), 1, 1, 0, 0, 0x3f, 0];
  return new Uint8Array([0xff, 0xd8, ...segments.flat(), ...sos, 0x12, 0x34, 0xff, 0xd9]);
}
const segment = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];
const jfif = segment(0xe0, [...ascii("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0]);

function webp(...chunks: [string, number[]][]) {
  const body = [
    ...ascii("WEBP"),
    ...chunks.flatMap(([name, data]) => [
      ...ascii(name),
      ...le32(data.length),
      ...data,
      ...(data.length % 2 ? [0] : []),
    ]),
  ];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}
const vp8: [string, number[]] = ["VP8 ", [0x30, 0x01, 0x00, 0x9d, 0x01, 0x2a, 1, 0, 1, 0]];

describe("hasPhotoMetadata", () => {
  it("finds the EXIF of a camera's JPEG (the fixture has a capture time)", () => {
    expect(hasPhotoMetadata(fixture("tugboat.jpg"))).toBe(true);
  });

  it("passes JPEGs with no metadata, the kind a canvas writes", () => {
    for (const name of ["portrait.jpg", "model-1.jpg", "label-jade.jpg"])
      expect(hasPhotoMetadata(fixture(name)), name).toBe(false);
    expect(hasPhotoMetadata(jpeg(jfif))).toBe(false);
    // A colour profile (APP2) and Adobe's colour transform (APP14) say nothing about a place.
    expect(hasPhotoMetadata(jpeg(jfif, segment(0xe2, ascii("ICC_PROFILE\0...")), segment(0xee, ascii("Adobe"))))).toBe(
      false,
    );
  });

  it("refuses EXIF, XMP, IPTC and other applications' blocks in a JPEG", () => {
    expect(hasPhotoMetadata(jpeg(jfif, segment(0xe1, [...ascii("Exif\0\0"), ...ascii("MM\0*GPS")])))).toBe(true);
    expect(hasPhotoMetadata(jpeg(jfif, segment(0xe1, ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>"))))).toBe(true);
    expect(hasPhotoMetadata(jpeg(jfif, segment(0xed, ascii("Photoshop 3.0\0IPTC"))))).toBe(true);
    expect(hasPhotoMetadata(jpeg(jfif, segment(0xec, ascii("Ducky"))))).toBe(true);
    // Tucked after the end of the image.
    expect(hasPhotoMetadata(new Uint8Array([...jpeg(jfif), ...ascii("Exif\0\0MM\0*")]))).toBe(true);
  });

  it("reads a WebP's chunks", () => {
    expect(hasPhotoMetadata(webp(vp8))).toBe(false);
    expect(hasPhotoMetadata(webp(vp8, ["EXIF", ascii("MM\0*GPS")]))).toBe(true);
    expect(hasPhotoMetadata(webp(vp8, ["XMP ", ascii("<x:xmpmeta/>")]))).toBe(true);
    // An extended WebP that says it carries EXIF (VP8X flag 0x08), even without the chunk where it's expected.
    expect(hasPhotoMetadata(webp(["VP8X", [0x08, 0, 0, 0, 0, 0, 0, 0, 0, 0]], vp8))).toBe(true);
    expect(hasPhotoMetadata(webp(["VP8X", [0x10, 0, 0, 0, 0, 0, 0, 0, 0, 0]], vp8))).toBe(false);
  });

  it("refuses what it can't read as a JPEG or a WebP", () => {
    expect(hasPhotoMetadata(new Uint8Array([1, 2, 3, 4]))).toBe(true);
    expect(hasPhotoMetadata(fixture("plate-hook.png"))).toBe(true);
    expect(hasPhotoMetadata(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(hasPhotoMetadata(new Uint8Array(0))).toBe(true);
  });
});
