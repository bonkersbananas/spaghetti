/**
 * Reads when a JPEG photo was taken (EXIF DateTimeOriginal), so a re-encoded
 * photo, which loses its EXIF data and with it any location, still knows its
 * capture time. Returns epoch ms, or null when there is none.
 *
 * EXIF times have no zone (OffsetTimeOriginal is rare), so they are read as
 * the browser's local time: the phone and the printer are in the same room.
 */
export function readTakenAt(buffer: ArrayBuffer): number | null {
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    // Start of scan: the image data begins, no metadata after this.
    if (marker === 0xffda || (marker & 0xff00) !== 0xff00) return null;
    const length = view.getUint16(offset + 2);
    if (marker === 0xffe1 && isExifHeader(view, offset + 4)) {
      return readTiff(view, offset + 10, offset + 2 + length);
    }
    offset += 2 + length;
  }
  return null;
}

function isExifHeader(view: DataView, at: number): boolean {
  // "Exif\0\0"
  return at + 6 <= view.byteLength && view.getUint32(at) === 0x45786966 && view.getUint16(at + 4) === 0;
}

const EXIF_IFD_POINTER = 0x8769;
const DATE_TIME_ORIGINAL = 0x9003;
const DATE_TIME = 0x0132;

function readTiff(view: DataView, start: number, end: number): number | null {
  if (start + 8 > end || end > view.byteLength) return null;
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) return null;
  const little = order === 0x4949;
  const u16 = (at: number) => view.getUint16(at, little);
  const u32 = (at: number) => view.getUint32(at, little);

  function entries(ifdOffset: number): Map<number, number> {
    const found = new Map<number, number>();
    const at = start + ifdOffset;
    if (at + 2 > end) return found;
    const count = u16(at);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > end) break;
      found.set(u16(entry), entry);
    }
    return found;
  }

  function ascii(entry: number): string | null {
    const count = u32(entry + 4);
    const at = count > 4 ? start + u32(entry + 8) : entry + 8;
    if (count < 19 || at + 19 > end) return null;
    let text = "";
    for (let i = 0; i < 19; i++) text += String.fromCharCode(view.getUint8(at + i));
    return text;
  }

  const ifd0 = entries(u32(start + 4));
  const exifPointer = ifd0.get(EXIF_IFD_POINTER);
  const exif = exifPointer !== undefined ? entries(u32(exifPointer + 8)) : new Map<number, number>();
  const entry = exif.get(DATE_TIME_ORIGINAL) ?? ifd0.get(DATE_TIME);
  return entry === undefined ? null : parseExifDate(ascii(entry));
}

/** "2026:10:31 18:04:59" (local time) → epoch ms. */
export function parseExifDate(text: string | null): number | null {
  const match = text?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (year < 1990 || month < 1 || month > 12 || day < 1) return null;
  const time = new Date(year, month - 1, day, hour, minute, second).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Builds a minimal EXIF segment holding DateTimeOriginal, for tests and
 * fixtures: insert it right after a JPEG's first two bytes.
 */
export function exifSegment(dateTime: string, littleEndian = false): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4 + 2 + 12 + 4 + 20);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, 8, littleEndian);
  // IFD0: one entry, the pointer to the EXIF IFD at 26.
  view.setUint16(8, 1, littleEndian);
  view.setUint16(10, EXIF_IFD_POINTER, littleEndian);
  view.setUint16(12, 4, littleEndian);
  view.setUint32(14, 1, littleEndian);
  view.setUint32(18, 26, littleEndian);
  view.setUint32(22, 0, littleEndian);
  // EXIF IFD: DateTimeOriginal, 20 ASCII bytes at 44.
  view.setUint16(26, 1, littleEndian);
  view.setUint16(28, DATE_TIME_ORIGINAL, littleEndian);
  view.setUint16(30, 2, littleEndian);
  view.setUint32(32, 20, littleEndian);
  view.setUint32(36, 44, littleEndian);
  view.setUint32(40, 0, littleEndian);
  for (let i = 0; i < 19; i++) tiff[44 + i] = dateTime.charCodeAt(i);

  const segment = new Uint8Array(4 + 6 + tiff.length);
  const header = new DataView(segment.buffer);
  header.setUint16(0, 0xffe1);
  header.setUint16(2, 2 + 6 + tiff.length);
  segment.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
  segment.set(tiff, 10);
  return segment;
}
