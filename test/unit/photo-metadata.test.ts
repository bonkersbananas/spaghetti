import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hasPhotoMetadata, stripPhotoMetadata } from "../../src/shared/photo-metadata.ts";
import {
  cameraJpeg,
  ICC,
  SAFARI_EXIF,
  SAFARI_PHOTOSHOP,
  safariJpeg,
  scanStart,
  webpChunks,
  webpWithMetadata,
} from "../support/photo-fixtures.ts";

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

  it("refuses what it can't read as a JPEG, a WebP or a PNG", () => {
    expect(hasPhotoMetadata(new Uint8Array([1, 2, 3, 4]))).toBe(true);
    expect(hasPhotoMetadata(fixture("plate-hook.png").subarray(0, 200))).toBe(true);
    expect(hasPhotoMetadata(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(true);
    expect(hasPhotoMetadata(new Uint8Array(0))).toBe(true);
  });

  it("reads a plate picture's PNG chunks (decision 0077): only those that draw it pass", () => {
    expect(hasPhotoMetadata(fixture("plate-hook.png"))).toBe(false);
    expect(hasPhotoMetadata(withPngChunk(fixture("plate-hook.png"), "tEXt", "Comment\0Sliced on Alex's laptop"))).toBe(
      true,
    );
    expect(hasPhotoMetadata(withPngChunk(fixture("plate-hook.png"), "eXIf", "MM\0*"))).toBe(true);
    // Bytes after the end are refused too, as after a JPEG's.
    expect(hasPhotoMetadata(new Uint8Array([...fixture("plate-hook.png"), 1, 2, 3]))).toBe(true);
  });
});

/** A PNG with one more chunk after its header (its CRC left zero: the reader doesn't check it). */
function withPngChunk(png: Uint8Array, type: string, text: string) {
  const body = ascii(text);
  const chunk = [...be16(0), ...be16(body.length), ...ascii(type), ...body, 0, 0, 0, 0];
  const header = 8 + 12 + 13;
  return new Uint8Array([...png.subarray(0, header), ...chunk, ...png.subarray(header)]);
}

describe("a plate picture's PNG", () => {
  it("loses its text, EXIF and time, and keeps the chunks that draw it byte for byte", () => {
    const clean = fixture("plate-tugboat.png");
    const tagged = withPngChunk(withPngChunk(clean, "tEXt", "Software\0BambuStudio on alex-mbp"), "tIME", "\u0007");
    const stripped = stripPhotoMetadata(tagged) as Uint8Array;
    expect(stripped).toEqual(clean);
    expect(hasPhotoMetadata(stripped)).toBe(false);
    expect(new TextDecoder().decode(stripped)).not.toContain("alex");
  });

  it("has nothing for a PNG cut short", () => {
    expect(stripPhotoMetadata(fixture("plate-tugboat.png").subarray(0, 100))).toBeNull();
  });
});

/** JPEG marker segments before the first scan, as [marker, body]. */
function segmentsOf(bytes: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [];
  for (let at = 2; bytes[at + 1] !== 0xda; ) {
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    out.push([bytes[at + 1] as number, bytes.slice(at + 4, at + 2 + length)]);
    at += 2 + length;
  }
  return out;
}

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** The image data: the first scan to EOI (entropy-coded data never holds FF D9). */
function imageData(bytes: Uint8Array) {
  const start = scanStart(bytes);
  for (let at = start; at < bytes.length - 1; at++)
    if (bytes[at] === 0xff && bytes[at + 1] === 0xd9) return bytes.slice(start, at + 2);
  throw new Error("no EOI");
}

function expectClean(bytes: Uint8Array) {
  const all = text(bytes);
  expect(all).not.toContain("Exif\0\0");
  expect(all).not.toContain("<x:xmpmeta");
  expect(all).not.toContain("http://ns.adobe.com/xap/1.0/");
  expect(all).not.toContain("GPS");
  expect(hasPhotoMetadata(bytes)).toBe(false);
}

describe("stripPhotoMetadata", () => {
  const base = fixture("model-1.jpg"); // JFIF, a colour profile, a real 1200 x 900 picture

  it("strips Safari's canvas JPEG to JFIF, its colour profile and the same image data", async () => {
    const safari = safariJpeg(base);
    expect(hasPhotoMetadata(safari)).toBe(true);
    const stripped = stripPhotoMetadata(safari);
    if (!stripped) throw new Error("not stripped");
    expectClean(stripped);
    const markers = segmentsOf(stripped).map(([marker]) => marker);
    expect(markers).not.toContain(0xe1);
    expect(markers).not.toContain(0xed);
    expect(markers).not.toContain(0xfe);
    expect(markers[0]).toBe(0xe0);
    // Both colour profiles (the picture's own and the added one) are kept, byte for byte.
    const profiles = segmentsOf(stripped).filter(([marker]) => marker === 0xe2);
    expect(profiles.map(([, body]) => text(body.subarray(0, 12)))).toEqual(["ICC_PROFILE\0", "ICC_PROFILE\0"]);
    expect(profiles[0]?.[1]).toEqual(new Uint8Array(ICC.slice(4)));
    expect(profiles[1]?.[1]).toEqual(segmentsOf(base)[1]?.[1]);
    // The image data, from the first scan to EOI, is untouched: the result is the picture as it was before the blocks.
    expect(imageData(stripped)).toEqual(imageData(safari));
    expect(stripped).toEqual(withProfile(base));
    expect(stripped.byteLength).toBe(safari.byteLength - SAFARI_EXIF.length - SAFARI_PHOTOSHOP.length);
    const decoded = await sharp(stripped).raw().toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([1200, 900]);
    expect(decoded.data).toEqual((await sharp(base).raw().toBuffer({ resolveWithObject: true })).data);
  });

  it("strips a camera's GPS EXIF, XMP, IPTC, comment and what comes after the image", async () => {
    const camera = cameraJpeg(base);
    const stripped = stripPhotoMetadata(camera);
    if (!stripped) throw new Error("not stripped");
    expectClean(stripped);
    expect(text(stripped)).not.toContain("Storgatan");
    expect(text(stripped)).not.toContain("Sergels");
    const markers = segmentsOf(stripped).map(([marker]) => marker);
    for (const dropped of [0xe1, 0xed, 0xfe]) expect(markers).not.toContain(dropped);
    expect(markers.filter((marker) => marker === 0xe2)).toHaveLength(2);
    expect(imageData(stripped)).toEqual(imageData(camera));
    // It ends at EOI: nothing after the picture.
    expect(Array.from(stripped.subarray(-2))).toEqual([0xff, 0xd9]);
    expect(stripped.byteLength).toBe(scanStart(stripped) + imageData(camera).byteLength);
    const decoded = await sharp(stripped).raw().toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([1200, 900]);
  });

  it("keeps a clean JPEG as it is, and keeps markers between progressive scans' data", async () => {
    for (const name of ["model-2.jpg", "portrait.jpg", "label-jade.jpg"]) {
      const bytes = fixture(name);
      expect(stripPhotoMetadata(bytes), name).toEqual(bytes);
    }
    const progressive = new Uint8Array(await sharp(base).jpeg({ progressive: true }).toBuffer());
    expect(stripPhotoMetadata(progressive)).toEqual(progressive);
    // A comment and an Exif block between two scans go too.
    let second = scanStart(progressive) + 2;
    while (!(progressive[second] === 0xff && progressive[second + 1] === 0xda)) second++;
    const between = new Uint8Array([
      ...progressive.subarray(0, second),
      ...segment(0xfe, ascii("GPS!")),
      ...SAFARI_EXIF,
      ...progressive.subarray(second),
    ]);
    expect(stripPhotoMetadata(between)).toEqual(progressive);
  });

  it("strips a WebP's EXIF and XMP chunks, clears their flags and fixes the RIFF size", async () => {
    const lossy = new Uint8Array(await sharp(base).resize(300, 225).webp().toBuffer());
    const webp = webpWithMetadata(lossy, 300, 225);
    expect(hasPhotoMetadata(webp)).toBe(true);
    const stripped = stripPhotoMetadata(webp);
    if (!stripped) throw new Error("not stripped");
    expectClean(stripped);
    const chunks = webpChunks(stripped);
    expect(chunks.map(([name]) => name)).toEqual(["VP8X", "ICCP", ...webpChunks(lossy).map(([name]) => name)]);
    // ICC (bit 5) stays; EXIF (bit 3) and XMP (bit 2) are cleared; the canvas size is untouched.
    expect(chunks[0]?.[1][0]).toBe(0b0010_0000);
    expect(Array.from(chunks[0]?.[1].subarray(4) ?? [])).toEqual(
      Array.from(webpChunks(webp)[0]?.[1].subarray(4) ?? []),
    );
    expect(new DataView(stripped.buffer).getUint32(4, true)).toBe(stripped.byteLength - 8);
    expect(chunks.at(-1)?.[1]).toEqual(webpChunks(lossy).at(-1)?.[1]);
    const decoded = await sharp(stripped).raw().toBuffer({ resolveWithObject: true });
    expect([decoded.info.width, decoded.info.height]).toEqual([300, 225]);
    // A WebP from a browser (no VP8X) comes back as it was.
    expect(stripPhotoMetadata(lossy)).toEqual(lossy);
  });

  it("gives nothing for what it can't read whole", () => {
    const whole = safariJpeg(base);
    for (const bytes of [
      new Uint8Array(0),
      new Uint8Array([1, 2, 3, 4]),
      fixture("plate-hook.png").subarray(0, 200), // a PNG cut short
      new Uint8Array([0xff, 0xd8, 0xff]),
      whole.subarray(0, whole.length - 2), // no EOI
      whole.subarray(0, 40), // cut inside a segment
      new Uint8Array([...whole.subarray(0, 2), 0x12, ...whole.subarray(2)]), // not a marker where one must be
      new Uint8Array([...ascii("RIFF"), 0xff, 0, 0, 0, ...ascii("WEBP")]), // a RIFF size past the end
    ])
      expect(stripPhotoMetadata(bytes)).toBeNull();
  });
});

/** The picture with the added colour profile and nothing else added: what stripping Safari's JPEG should give. */
function withProfile(bytes: Uint8Array) {
  const at = 4 + (((bytes[4] as number) << 8) | (bytes[5] as number));
  return new Uint8Array([...bytes.subarray(0, at), ...ICC, ...bytes.subarray(at)]);
}
