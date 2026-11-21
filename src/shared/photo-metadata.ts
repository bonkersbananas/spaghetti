/**
 * Whether a stored photo's bytes carry metadata a stranger shouldn't get (decision 0075): EXIF (with GPS, the camera,
 * the time), XMP (which can repeat all of that) or IPTC. Photos a browser resized are re-encoded from a canvas, which
 * writes none of it; a photo stored as it came (an agent's or the printer bridge's, `needs_resize`), or one sent by
 * anything other than the app, may carry all of it. The guest page serves a photo only when this finds nothing.
 *
 * It reads the container, never the pixels: JPEG marker segments up to the image data, WebP's RIFF chunks. Anything
 * it can't read as one of the two counts as carrying metadata. A last pass looks for an EXIF header or an XMP packet
 * anywhere in the file, so data tucked after the image (past JPEG's end marker) is found too.
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

export function hasPhotoMetadata(bytes: Uint8Array): boolean {
  if (contains(bytes, EXIF_HEADER) || contains(bytes, XMP_PACKET) || contains(bytes, XMP_NS)) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegMetadata(bytes);
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  if (riff === "RIFF") return webpMetadata(bytes);
  // Not a JPEG or a WebP: nothing the app stores as a photo, so nothing to serve.
  return true;
}
