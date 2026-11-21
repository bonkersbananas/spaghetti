/**
 * Photo containers with metadata in them, for the stripping tests (decision 0075). Pure bytes, no file system, so
 * both the unit tests and the Worker tests (workerd) can build them around any JPEG or WebP.
 */

export const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
export const be16 = (value: number) => [(value >> 8) & 0xff, value & 0xff];
export const le32 = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff];
const hex = (text: string) => Array.from(text.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

/** A JPEG marker segment: FF, the marker, its length, its body. */
export const segment = (marker: number, body: number[]) => [0xff, marker, ...be16(body.length + 2), ...body];

/**
 * What Safari's canvas encoder wrote into a real thumbnail on spaghetti.day: an Exif block whose Exif IFD holds
 * ColorSpace (sRGB), PixelXDimension (600) and PixelYDimension (450), and a Photoshop block with an empty IPTC record
 * and its MD5 digest.
 */
export const SAFARI_EXIF = segment(
  0xe1,
  hex(
    "4578696600004d4d002a00000008000187690004000000010000001a000000000003a00100030000000100010000a00200040000000100000258a003000400000001000001c200000000",
  ),
);
export const SAFARI_PHOTOSHOP = segment(
  0xed,
  hex("50686f746f73686f7020332e30003842494d04040000000000003842494d0425000000000010d41d8cd98f00b204e9800998ecf8427e"),
);
/** A (made-up) colour profile in APP2: kept. */
export const ICC = segment(0xe2, [...ascii("ICC_PROFILE\0"), 1, 1, ...ascii("....mntrRGB XYZ ")]);
/** A camera's EXIF with a GPS position, its XMP, IPTC, and a comment. */
export const CAMERA_EXIF = segment(0xe1, [
  ...ascii("Exif\0\0MM\0*"),
  ...ascii("Make Pastacam GPSLatitude 59.3293 N GPSLongitude 18.0686 E DateTimeOriginal 2026:11:21 18:24:00"),
]);
export const CAMERA_XMP = segment(0xe1, [
  ...ascii("http://ns.adobe.com/xap/1.0/\0"),
  ...ascii('<x:xmpmeta xmlns:x="adobe:ns:meta/"><exif:GPSLatitude>59,19.76N</exif:GPSLatitude></x:xmpmeta>'),
]);
export const CAMERA_IPTC = segment(0xed, [...ascii("Photoshop 3.0\x008BIM"), 0x04, 0x04, ...ascii("Sergels torg")]);
export const COMMENT = segment(0xfe, ascii("Shot at home, Storgatan 1"));
/** Bytes after EOI: a second JPEG with its own EXIF, as phones append gain maps. */
export const AFTER_EOI = [0xff, 0xd8, ...CAMERA_EXIF, 0xff, 0xd9];

/** Where a JPEG's header segments end and its first scan (SOS) starts. */
export function scanStart(bytes: Uint8Array): number {
  let at = 2;
  while (bytes[at + 1] !== 0xda) at += 2 + (((bytes[at + 2] as number) << 8) | (bytes[at + 3] as number));
  return at;
}

/** The JPEG with segments put in right after its APP0 (or SOI), and bytes added after its end. */
export function withSegments(base: Uint8Array, segments: number[][], after: number[] = []): Uint8Array {
  const at = base[3] === 0xe0 ? 4 + (((base[4] as number) << 8) | (base[5] as number)) : 2;
  return new Uint8Array([...base.subarray(0, at), ...segments.flat(), ...base.subarray(at), ...after]);
}

/** Safari's canvas JPEG: JFIF, its Exif block, a colour profile, its Photoshop block. */
export const safariJpeg = (base: Uint8Array) => withSegments(base, [SAFARI_EXIF, ICC, SAFARI_PHOTOSHOP]);

/** A camera's JPEG: GPS EXIF, XMP, a colour profile, IPTC, a comment, and data after EOI. */
export const cameraJpeg = (base: Uint8Array) =>
  withSegments(base, [CAMERA_EXIF, CAMERA_XMP, ICC, CAMERA_IPTC, COMMENT], AFTER_EOI);

/** A WebP's chunks, by name. */
export function webpChunks(bytes: Uint8Array): [string, Uint8Array][] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: [string, Uint8Array][] = [];
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    chunks.push([String.fromCharCode(...bytes.subarray(at, at + 4)), bytes.slice(at + 8, at + 8 + size)]);
    at += 8 + size + (size % 2);
  }
  return chunks;
}

const chunk = (name: string, body: ArrayLike<number>) => [
  ...ascii(name),
  ...le32(body.length),
  ...Array.from(body),
  ...(body.length % 2 ? [0] : []),
];

/**
 * A WebP (its image chunks taken from `base`) with VP8X saying EXIF and XMP, an ICC profile, and EXIF and XMP chunks.
 * `width` and `height` go into VP8X.
 */
export function webpWithMetadata(base: Uint8Array, width: number, height: number): Uint8Array {
  const image = webpChunks(base).filter(([name]) => name !== "VP8X" && name !== "EXIF" && name !== "XMP ");
  const size = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
  // Flags: ICC (bit 5), EXIF (bit 3), XMP (bit 2).
  const vp8x = [0b0010_1100, 0, 0, 0, ...size(width - 1), ...size(height - 1)];
  const body = [
    ...ascii("WEBP"),
    ...chunk("VP8X", vp8x),
    ...chunk("ICCP", ascii("....mntrRGB XYZ ")),
    ...image.flatMap(([name, data]) => chunk(name, data)),
    ...chunk("EXIF", ascii("MM\0*Make Pastacam GPSLatitude 59.3293 N")),
    ...chunk("XMP ", ascii('<x:xmpmeta xmlns:x="adobe:ns:meta/"><exif:GPSLatitude/></x:xmpmeta>')),
  ];
  return new Uint8Array([...ascii("RIFF"), ...le32(body.length), ...body]);
}
