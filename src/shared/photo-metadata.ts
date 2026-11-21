/**
 * Metadata a stranger shouldn't get from a stored photo (decision 0075): EXIF (with GPS, the camera, the time), XMP
 * (which can repeat all of that) or IPTC. A browser's canvas re-encode isn't free of it: Safari (iPhone and Mac), which
 * can't encode WebP, writes JPEGs with an APP1 Exif block (colour space, pixel size) and an APP13 Photoshop block (an
 * empty IPTC record), and a photo stored as it came (an agent's or the printer bridge's, `needs_resize`), or one sent
 * by anything other than the app, may carry all of it. So a guest gets `stripPhotoMetadata`'s copy, and only once
 * `hasPhotoMetadata` finds nothing left in it.
 *
 * Both read the container, never the pixels: JPEG marker segments, WebP's RIFF chunks, PNG's chunks (a plate's
 * picture, decision 0077: a slicer may write its own text chunks). Anything they can't read as one of the three counts
 * as carrying metadata. `hasPhotoMetadata` also looks for an EXIF header or an XMP packet anywhere in
 * the file, so data tucked after the image (past JPEG's end marker) is found too.
 */

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_PACKET = Array.from("<x:xmpmeta", (char) => char.charCodeAt(0));
const XMP_NS = Array.from("http://ns.adobe.com/xap/1.0/", (char) => char.charCodeAt(0));

function contains(bytes: Uint8Array, needle: readonly number[]): boolean {
  const first = needle[0];
  outer: for (let i = bytes.indexOf(first as number); i !== -1 && i <= bytes.length - needle.length; ) {
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) {
        i = bytes.indexOf(first as number, i + 1);
        continue outer;
      }
    }
    return true;
  }
  return false;
}

/**
 * JPEG: every segment before the image data (SOS). APP1 holds EXIF and XMP, APP13 Photoshop's IPTC block; APP0 (JFIF),
 * APP2 (the colour profile) and APP14 (Adobe's colour transform) say nothing about a person or a place.
 */
function jpegMetadata(bytes: Uint8Array): boolean {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return true;
    const marker = bytes[at + 1] as number;
    // Fill bytes, and markers without a length.
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // The image data starts, or the file ends: nothing more in the header.
    if (marker === 0xda || marker === 0xd9) return false;
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    if (length < 2) return true;
    if (marker === 0xe1 || marker === 0xed) return true;
    // Any other APPn but 0, 2 and 14 is an application's own block: not served.
    if (marker >= 0xe0 && marker <= 0xef && marker !== 0xe0 && marker !== 0xe2 && marker !== 0xee) return true;
    at += 2 + length;
  }
  // Ran out before the image data: not a JPEG we can vouch for.
  return true;
}

/** WebP: a RIFF file of chunks; "EXIF" and "XMP " are the metadata ones (the VP8X header flags them too). */
function webpMetadata(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourCC = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 12 || fourCC(8) !== "WEBP") return true;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const name = fourCC(at);
    const size = view.getUint32(at + 4, true);
    if (name === "EXIF" || name === "XMP ") return true;
    // VP8X's flags: bit 3 EXIF, bit 2 XMP.
    if (name === "VP8X" && size >= 1 && ((bytes[at + 8] as number) & 0b1100) !== 0) return true;
    at += 8 + size + (size % 2);
  }
  return false;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/**
 * PNG: the chunks that draw the picture (header, palette, data, end, transparency) and those that say how its colours
 * are meant (gamma, chromaticities, sRGB, the colour profile, significant bits, pixel size). Anything else (text,
 * compressed or international text, EXIF, the time, a program's own) isn't served.
 */
const PNG_KEPT = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "pHYs"]);

const isPng = (bytes: Uint8Array) => startsWith(bytes, 0, PNG_SIGNATURE);

/** A PNG's chunks, in order, up to IEND; null when they don't add up. */
function pngChunks(bytes: Uint8Array): { name: string; start: number; end: number }[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: { name: string; start: number; end: number }[] = [];
  let at = PNG_SIGNATURE.length;
  while (at + 12 <= bytes.length) {
    const size = view.getUint32(at);
    const end = at + 12 + size;
    if (end > bytes.length) return null;
    const name = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    chunks.push({ name, start: at, end });
    if (name === "IEND") return chunks;
    at = end;
  }
  return null;
}

/**
 * PNG: any chunk but the kept ones; and, `strict`, chunks that don't add up to a whole PNG or anything after IEND.
 */
function pngMetadata(bytes: Uint8Array, strict: boolean): boolean {
  const chunks = pngChunks(bytes);
  if (!chunks || (chunks.at(-1)?.end ?? 0) !== bytes.length) return strict;
  return chunks.some((chunk) => !PNG_KEPT.has(chunk.name));
}

/** PNG: the signature and the kept chunks, byte for byte (their CRCs with them), up to IEND. Null when it isn't whole. */
function stripPng(bytes: Uint8Array): Uint8Array | null {
  const chunks = pngChunks(bytes);
  if (!chunks) return null;
  return join([
    bytes.subarray(0, PNG_SIGNATURE.length),
    ...chunks.filter((chunk) => PNG_KEPT.has(chunk.name)).map((chunk) => bytes.subarray(chunk.start, chunk.end)),
  ]);
}

/**
 * `strict` (the default, the shared page): anything that isn't a JPEG, WebP or PNG it can read counts as carrying
 * metadata. Without it (link previews, decision 0064, whose stored test pictures are a few bytes) only metadata it
 * finds counts.
 */
export function hasPhotoMetadata(bytes: Uint8Array, { strict = true }: { strict?: boolean } = {}): boolean {
  if (contains(bytes, EXIF_HEADER) || contains(bytes, XMP_PACKET) || contains(bytes, XMP_NS)) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegMetadata(bytes);
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  if (riff === "RIFF") return webpMetadata(bytes);
  if (isPng(bytes)) return pngMetadata(bytes, strict);
  // Not a JPEG, WebP or PNG: nothing the app stores as a picture, so nothing to serve.
  return strict;
}

const ICC_PROFILE = Array.from("ICC_PROFILE\0", (char) => char.charCodeAt(0));

function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  for (let i = 0; i < prefix.length; i++) if (bytes[at + i] !== prefix[i]) return false;
  return true;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/**
 * JPEG: SOI, APP0 (JFIF), APP2's colour profile, APP14 (Adobe's colour transform) and every segment that isn't an
 * application's or a comment (tables, frame, scans and their entropy-coded data) are copied byte for byte; APP1 (EXIF,
 * XMP), APP13 (IPTC), any other APPn, APP2 that isn't a colour profile (MPF, whose offsets would point past the end)
 * and COM are dropped, and nothing after EOI is kept. Null when it isn't a whole JPEG.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array | null {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 2 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0xd9) {
      parts.push(bytes.subarray(at, at + 2));
      return join(parts);
    }
    if (marker === 0xd8 || marker === 0x00) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(at, at + 2));
      at += 2;
      continue;
    }
    if (at + 4 > bytes.length) return null;
    const length = ((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number);
    const end = at + 2 + length;
    if (length < 2 || end > bytes.length) return null;
    const app = marker >= 0xe0 && marker <= 0xef;
    const kept =
      (!app && marker !== 0xfe) ||
      marker === 0xe0 ||
      marker === 0xee ||
      (marker === 0xe2 && startsWith(bytes, at + 4, ICC_PROFILE));
    if (kept) parts.push(bytes.subarray(at, end));
    at = end;
    if (marker !== 0xda) continue;
    // The scan's entropy-coded data runs to the next marker that isn't a stuffed byte (FF 00) or a restart (FF Dn).
    let next = at;
    for (;;) {
      next = bytes.indexOf(0xff, next);
      if (next === -1 || next + 1 >= bytes.length) return null;
      const after = bytes[next + 1] as number;
      if (after === 0x00 || (after >= 0xd0 && after <= 0xd7)) next += 2;
      else if (after === 0xff) next += 1;
      else break;
    }
    parts.push(bytes.subarray(at, next));
    at = next;
  }
  return null;
}

/** WebP: drops the "EXIF" and "XMP " chunks, clears VP8X's flags for them, and sets the RIFF size to what is left. */
function stripWebp(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fourCC = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (fourCC(8) !== "WEBP") return null;
  const end = 8 + view.getUint32(4, true);
  if (end > bytes.length || end < 12) return null;
  const parts: Uint8Array[] = [new Uint8Array(12)];
  let at = 12;
  while (at < end) {
    if (at + 8 > end) return null;
    const name = fourCC(at);
    const size = view.getUint32(at + 4, true);
    if (at + 8 + size > end) return null;
    if (name !== "EXIF" && name !== "XMP ") {
      // A copy, padded to an even length (an odd chunk at the very end may lack its pad byte).
      const chunk = new Uint8Array(8 + size + (size % 2));
      chunk.set(bytes.subarray(at, at + 8 + size));
      // VP8X's flags: bit 3 EXIF, bit 2 XMP.
      if (name === "VP8X" && size >= 1) chunk[8] = (chunk[8] as number) & ~0b1100;
      parts.push(chunk);
    }
    at += 8 + size + (size % 2);
  }
  const out = join(parts);
  out.set(bytes.subarray(0, 12));
  new DataView(out.buffer).setUint32(4, out.length - 8, true);
  return out;
}

/**
 * A copy of a JPEG, WebP or PNG without its EXIF, XMP, IPTC, text or comments; the image data is the same bytes. Null
 * when the bytes aren't a JPEG, WebP or PNG it can read whole. Run `hasPhotoMetadata` on what it returns before serving it.
 */
export function stripPhotoMetadata(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes);
  if (String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF") return stripWebp(bytes);
  if (isPng(bytes)) return stripPng(bytes);
  return null;
}
