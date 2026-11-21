/**
 * The plate's toolpaths out of a sliced `.gcode.3mf`, for the shared page's 3D view (decision 0077): a zip of its own
 * that holds only what the viewer reads (shared/gcode/read-file.ts) for one plate: that plate's G-code, the slice's
 * figures and filaments (`slice_info.config`) and the project's colours (`project_settings.config`). The model's mesh
 * (`3D/3dmodel.model`, often half the file), the other plates, their pictures and everything else stay behind, so a
 * guest's browser never receives the model itself, and a phone fetches about half as much.
 *
 * Nothing is inflated or deflated here: the entries are copied as they are compressed, read from R2 by range (the
 * central directory at the end of the file says where each one is), under fresh local headers and a central
 * directory of their own. The Worker spends almost no CPU on it, and a 100 MB file never sits in its memory.
 */

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;
/** A slicer's central directory is a few kilobytes; a bigger one isn't a file of ours. */
const MAX_DIRECTORY = 4 * 1024 * 1024;
const U32 = 0xffffffff;

/** What the viewer reads besides the plate's G-code: the slice's figures and filaments, and the project's colours. */
const KEPT = new Set(["Metadata/slice_info.config", "Metadata/project_settings.config"]);

/** A stored file read by range: R2 in the Worker (index.tsx `r2Source`), bytes in a test. */
export interface RangedSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  stream(offset: number, length: number): Promise<ReadableStream<Uint8Array>>;
}

interface Entry {
  name: Uint8Array;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressed: number;
  size: number;
  /** Where its local header is in the source. */
  offset: number;
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A big 64-bit field as a number, or NaN past what a file of ours could be. */
function u64(data: DataView, at: number): number {
  const high = data.getUint32(at + 4, true);
  return high > 0x1fffff ? Number.NaN : high * 2 ** 32 + data.getUint32(at, true);
}

/** Where the central directory is, and how big, from the end of the file (with zip64's records when it uses them). */
async function directoryOf(source: RangedSource): Promise<{ offset: number; size: number } | null> {
  // The end record, with zip64's locator before it: in the last few kilobytes, unless a long comment follows it.
  const find = async (length: number) => {
    const tail = await source.read(source.size - length, length);
    const data = view(tail);
    for (let at = tail.length - 22; at >= 0; at--) {
      if (data.getUint32(at, true) === EOCD && at + 22 + data.getUint16(at + 20, true) === tail.length) {
        return { data, end: at };
      }
    }
    return null;
  };
  const short = Math.min(source.size, 4096);
  const long = Math.min(source.size, 22 + MAX_COMMENT + 20);
  const found = (await find(short)) ?? (long > short ? await find(long) : null);
  if (!found) return null;
  const { data, end } = found;
  let offset = data.getUint32(end + 16, true);
  let size = data.getUint32(end + 12, true);
  if (offset === U32 || size === U32 || data.getUint16(end + 10, true) === 0xffff) {
    // Zip64: the locator just before the end record says where zip64's own end record is.
    if (end < 20 || data.getUint32(end - 20, true) !== LOCATOR64) return null;
    const recordAt = u64(data, end - 20 + 8);
    if (!Number.isFinite(recordAt) || recordAt + 56 > source.size) return null;
    const record = view(await source.read(recordAt, 56));
    if (record.getUint32(0, true) !== EOCD64) return null;
    size = u64(record, 40);
    offset = u64(record, 48);
  }
  if (!Number.isFinite(offset) || !Number.isFinite(size) || size > MAX_DIRECTORY || offset + size > source.size) {
    return null;
  }
  return { offset, size };
}

/** The central directory's entries; null when it doesn't add up. */
function entriesOf(directory: Uint8Array): Entry[] | null {
  const data = view(directory);
  const entries: Entry[] = [];
  let at = 0;
  while (at + 46 <= directory.length) {
    if (data.getUint32(at, true) !== CENTRAL) return null;
    const nameLength = data.getUint16(at + 28, true);
    const extraLength = data.getUint16(at + 30, true);
    const commentLength = data.getUint16(at + 32, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > directory.length) return null;
    let size = data.getUint32(at + 24, true);
    let compressed = data.getUint32(at + 20, true);
    let offset = data.getUint32(at + 42, true);
    // Zip64's extra field holds, in this order, each of the three that is 0xffffffff above.
    for (let extra = at + 46 + nameLength; extra + 4 <= at + 46 + nameLength + extraLength; ) {
      const id = data.getUint16(extra, true);
      const length = data.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === U32 && field + 8 <= extra + 4 + length) {
          size = u64(data, field);
          field += 8;
        }
        if (compressed === U32 && field + 8 <= extra + 4 + length) {
          compressed = u64(data, field);
          field += 8;
        }
        if (offset === U32 && field + 8 <= extra + 4 + length) offset = u64(data, field);
      }
      extra += 4 + length;
    }
    entries.push({
      name: directory.slice(at + 46, at + 46 + nameLength),
      flags: data.getUint16(at + 8, true),
      method: data.getUint16(at + 10, true),
      time: data.getUint16(at + 12, true),
      date: data.getUint16(at + 14, true),
      crc: data.getUint32(at + 16, true),
      compressed,
      size,
      offset,
    });
    at = next;
  }
  return at === directory.length ? entries : null;
}

const nameOf = (entry: Entry) => new TextDecoder().decode(entry.name).replace(/\\/g, "/").replace(/^\/+/, "");

/** One piece of what is sent: bytes made here, or a range of the source's. */
type Piece = Uint8Array | { offset: number; length: number };

export interface Toolpaths {
  /** The bytes sent, all told (the response's Content-Length). */
  size: number;
  pieces: Piece[];
}

/**
 * What a guest's 3D view gets of a sliced file's plate: the zip's layout (headers made here, compressed data by
 * range), or null when the file has no G-code for that plate, isn't a zip it can read, or keeps its entries in a
 * way the viewer couldn't read either (only stored and deflated entries are; nothing encrypted).
 */
export async function plateToolpaths(source: RangedSource, plate: number): Promise<Toolpaths | null> {
  if (source.size < 22) return null;
  const where = await directoryOf(source);
  if (!where) return null;
  const entries = entriesOf(await source.read(where.offset, where.size));
  if (!entries) return null;
  const gcode = `Metadata/plate_${plate}.gcode`;
  const kept = entries.filter((entry) => {
    const name = nameOf(entry);
    return name === gcode || KEPT.has(name);
  });
  // A slicer writes each of these once. A directory that lists one twice (or 5,000 times, each a range read and a
  // copy in the answer) isn't a slicer's file: nothing, rather than a guest's one request costing thousands of reads.
  const names = kept.map(nameOf);
  if (names.filter((name) => name === gcode).length !== 1 || new Set(names).size !== names.length) return null;
  // The viewer's unzip reads stored and deflated entries, unencrypted (bit 0), and nothing past 4 GB.
  if (
    kept.some(
      (entry) =>
        (entry.method !== 0 && entry.method !== 8) ||
        entry.flags & 1 ||
        !Number.isFinite(entry.compressed + entry.size + entry.offset) ||
        entry.compressed >= U32 ||
        entry.size >= U32,
    )
  ) {
    return null;
  }
  // Each entry's data starts after its own local header, whose name and extra field may differ from the directory's.
  const starts = await Promise.all(
    kept.map(async (entry) => {
      if (entry.offset + 30 > source.size) return null;
      const local = view(await source.read(entry.offset, 30));
      if (local.getUint32(0, true) !== LOCAL) return null;
      const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
      return start + entry.compressed <= source.size ? start : null;
    }),
  );
  if (starts.some((start) => start === null)) return null;

  const pieces: Piece[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  kept.forEach((entry, index) => {
    // The sizes are in the header, so no data descriptor follows (bit 3 off); UTF-8 names keep bit 11.
    const flags = entry.flags & 0x0800;
    const header = new Uint8Array(30 + entry.name.length);
    const local = view(header);
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, entry.method, true);
    local.setUint16(10, entry.time, true);
    local.setUint16(12, entry.date, true);
    local.setUint32(14, entry.crc, true);
    local.setUint32(18, entry.compressed, true);
    local.setUint32(22, entry.size, true);
    local.setUint16(26, entry.name.length, true);
    header.set(entry.name, 30);
    pieces.push(header, { offset: starts[index] as number, length: entry.compressed });

    const record = new Uint8Array(46 + entry.name.length);
    const row = view(record);
    row.setUint32(0, CENTRAL, true);
    row.setUint16(4, 20, true);
    row.setUint16(6, 20, true);
    row.setUint16(8, flags, true);
    row.setUint16(10, entry.method, true);
    row.setUint16(12, entry.time, true);
    row.setUint16(14, entry.date, true);
    row.setUint32(16, entry.crc, true);
    row.setUint32(20, entry.compressed, true);
    row.setUint32(24, entry.size, true);
    row.setUint16(28, entry.name.length, true);
    row.setUint32(42, at, true);
    record.set(entry.name, 46);
    central.push(record);
    at += header.length + entry.compressed;
  });
  const directorySize = central.reduce((total, record) => total + record.length, 0);
  const end = new Uint8Array(22);
  const tail = view(end);
  tail.setUint32(0, EOCD, true);
  tail.setUint16(8, kept.length, true);
  tail.setUint16(10, kept.length, true);
  tail.setUint32(12, directorySize, true);
  tail.setUint32(16, at, true);
  pieces.push(...central, end);
  return { size: at + directorySize + end.length, pieces };
}

/** The toolpaths' bytes as one stream, the source's ranges fetched one at a time as the guest reads. */
export function streamToolpaths(source: RangedSource, toolpaths: Toolpaths): ReadableStream<Uint8Array> {
  const pending = [...toolpaths.pieces];
  let current: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        if (current) {
          const { value, done } = await current.read();
          if (!done) {
            controller.enqueue(value);
            return;
          }
          current = null;
        }
        const piece = pending.shift();
        if (!piece) {
          controller.close();
          return;
        }
        if (piece instanceof Uint8Array) {
          controller.enqueue(piece);
          return;
        }
        if (piece.length) current = (await source.stream(piece.offset, piece.length)).getReader();
      }
    },
    async cancel(reason) {
      await current?.cancel(reason);
    },
  });
}
