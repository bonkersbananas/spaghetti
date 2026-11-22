import { hex, parseProject, parseSliceInfo } from "../../shared/gcode/slice-config.ts";
import { crc32 } from "../../shared/threemf/stl-wrap.ts";

/**
 * The plate's toolpaths out of a sliced `.gcode.3mf`, for the shared page's 3D view (decision 0077): a zip of its own
 * that holds only what the viewer reads (shared/gcode/read-file.ts) for one plate: that plate's G-code, the slice's
 * figures and filaments (`slice_info.config`) and the project's colours (`project_settings.config`). The model's mesh
 * (`3D/3dmodel.model`, often half the file), the other plates, their pictures and everything else stay behind, so a
 * guest's browser never receives the model itself, and a phone fetches about half as much.
 *
 * The G-code is copied as it is compressed, read from R2 by range (the central directory at the end of the file says
 * where each entry is), under a fresh local header and a central directory of its own: the Worker spends almost no
 * CPU on it, and a 100 MB file never sits in its memory. The two configs are small, and a desktop slicer's carry far
 * more than colours (a print host's address and password, a post-processing script's path in someone's home folder,
 * preset names, every plate's objects), so they are inflated here and written anew, stored, with only what the
 * viewer reads (shared/gcode/slice-config.ts): the plate's time, its filaments' colours, types and nozzles.
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

const SLICE_INFO = "Metadata/slice_info.config";
const PROJECT = "Metadata/project_settings.config";
/** What the viewer reads besides the plate's G-code: the slice's figures and filaments, and the project's colours. */
const CONFIGS = new Set([SLICE_INFO, PROJECT]);
/**
 * A slice's configs are a few kilobytes, a project's settings a few hundred: one bigger than this, packed or not, is
 * left out unread, so a crafted file can't make the Worker inflate much.
 */
export const MAX_CONFIG = 1024 * 1024;
/** More filaments than any printer takes: a list past it is cut there. */
const MAX_FILAMENTS = 64;
/** A filament's type as the viewer shows it: a material's short name (PLA, PETG-CF, PLA Silk+), never a path. */
const TYPE = /^[A-Za-z0-9][\w .+-]{0,31}$/;

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

/** An entry's data, packed or stored: inflated with the platform's own stream, or null past `limit` or when broken. */
async function unpacked(bytes: Uint8Array, method: number, limit: number): Promise<Uint8Array | null> {
  if (method === 0) return bytes.length <= limit ? bytes : null;
  const reader = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      parts.push(value);
    }
  } catch {
    return null;
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The plate's block of slice_info.config, with only what the viewer reads: its time and its filaments. */
export function plainSliceInfo(xml: string, plate: number): string {
  const info = parseSliceInfo(xml, plate);
  const lines = [`<metadata key="index" value="${plate}"/>`];
  if (info.prediction) lines.push(`<metadata key="prediction" value="${info.prediction}"/>`);
  if (info.nozzles?.length) {
    lines.push(`<metadata key="filament_maps" value="${info.nozzles.slice(0, MAX_FILAMENTS).join(" ")}"/>`);
  }
  for (const [id, filament] of [...info.filaments].slice(0, MAX_FILAMENTS)) {
    const type = filament.type && TYPE.test(filament.type) ? ` type="${filament.type}"` : "";
    const color = filament.color ? ` color="${filament.color}"` : "";
    lines.push(`<filament id="${id}"${type}${color}/>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <plate>\n${lines.map((line) => `    ${line}\n`).join("")}  </plate>\n</config>\n`;
}

/** project_settings.config with only the filaments' colours, types and nozzles; null when it has none of them. */
export function plainProject(json: string): string | null {
  const project = parseProject(json);
  const out: Record<string, string[]> = {};
  const each = (values: string[], keep: (value: string) => string | undefined) =>
    values.slice(0, MAX_FILAMENTS).map((value) => keep(value) ?? "");
  if (project.colors.length) out.filament_colour = each(project.colors, hex);
  if (project.types.length) out.filament_type = each(project.types, (type) => (TYPE.test(type) ? type : undefined));
  if (project.nozzles.length) out.filament_map = each(project.nozzles, (n) => (/^\d{1,2}$/.test(n) ? n : undefined));
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

/** What goes into the guest's zip: an entry's header fields, and its data as bytes made here or a range of the file. */
interface Packed {
  name: Uint8Array;
  method: number;
  time: number;
  date: number;
  crc: number;
  compressed: number;
  size: number;
  data: Piece;
}

const encoder = new TextEncoder();

/** A config written anew from the file's own, stored; null when there is nothing the viewer would read in it. */
async function rewritten(source: RangedSource, entry: Entry, name: string, plate: number): Promise<Uint8Array | null> {
  if ((entry.method !== 0 && entry.method !== 8) || entry.flags & 1) return null;
  if (!(entry.compressed <= MAX_CONFIG && entry.size <= MAX_CONFIG)) return null;
  const start = await dataStart(source, entry);
  if (start === null) return null;
  const bytes = await unpacked(await source.read(start, entry.compressed), entry.method, MAX_CONFIG);
  if (!bytes) return null;
  const text = new TextDecoder().decode(bytes);
  const plain = name === SLICE_INFO ? plainSliceInfo(text, plate) : plainProject(text);
  return plain === null ? null : encoder.encode(plain);
}

/** Where an entry's data starts: after its own local header, whose name and extra field may differ from the directory's. */
async function dataStart(source: RangedSource, entry: Entry): Promise<number | null> {
  if (entry.offset + 30 > source.size) return null;
  const local = view(await source.read(entry.offset, 30));
  if (local.getUint32(0, true) !== LOCAL) return null;
  const start = entry.offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  return start + entry.compressed <= source.size ? start : null;
}

/**
 * What a guest's 3D view gets of a sliced file's plate: the zip's layout (headers and configs made here, the G-code by
 * range), or null when the file has no G-code for that plate, isn't a zip it can read, lists an entry twice, or keeps
 * its G-code in a way the viewer couldn't read either (only stored and deflated entries are; nothing encrypted). A
 * config it can't read, or one past MAX_CONFIG, is left out: the view then shows the slicer's own colours.
 */
export async function plateToolpaths(source: RangedSource, plate: number): Promise<Toolpaths | null> {
  if (source.size < 22) return null;
  const where = await directoryOf(source);
  if (!where) return null;
  const entries = entriesOf(await source.read(where.offset, where.size));
  if (!entries) return null;
  const gcodeName = `Metadata/plate_${plate}.gcode`;
  const kept = entries.filter((entry) => {
    const name = nameOf(entry);
    return name === gcodeName || CONFIGS.has(name);
  });
  // A slicer writes each of these once. A directory that lists one twice (or 5,000 times, each a range read and a
  // copy in the answer) isn't a slicer's file: nothing, rather than a guest's one request costing thousands of reads.
  const names = kept.map(nameOf);
  if (names.filter((name) => name === gcodeName).length !== 1 || new Set(names).size !== names.length) return null;
  const gcode = kept[names.indexOf(gcodeName)] as Entry;
  // The viewer's unzip reads stored and deflated entries, unencrypted (bit 0), and nothing past 4 GB.
  if (
    (gcode.method !== 0 && gcode.method !== 8) ||
    gcode.flags & 1 ||
    !Number.isFinite(gcode.compressed + gcode.size + gcode.offset) ||
    gcode.compressed >= U32 ||
    gcode.size >= U32
  ) {
    return null;
  }
  const [start, ...configs] = await Promise.all([
    dataStart(source, gcode),
    ...[SLICE_INFO, PROJECT].map(async (name) => {
      const entry = kept[names.indexOf(name)];
      const bytes = entry ? await rewritten(source, entry, name, plate).catch(() => null) : null;
      return bytes ? { name, bytes } : null;
    }),
  ]);
  if (start === null || start === undefined) return null;

  const packed: Packed[] = [
    {
      name: encoder.encode(gcodeName),
      method: gcode.method,
      time: gcode.time,
      date: gcode.date,
      crc: gcode.crc,
      compressed: gcode.compressed,
      size: gcode.size,
      data: { offset: start, length: gcode.compressed },
    },
  ];
  for (const config of configs) {
    if (!config) continue;
    packed.push({
      name: encoder.encode(config.name),
      method: 0,
      time: gcode.time,
      date: gcode.date,
      crc: crc32(config.bytes),
      compressed: config.bytes.length,
      size: config.bytes.length,
      data: config.bytes,
    });
  }

  const pieces: Piece[] = [];
  const central: Uint8Array[] = [];
  let at = 0;
  for (const entry of packed) {
    // The sizes are in the header, so no data descriptor follows (bit 3 off); the names are ASCII.
    const header = new Uint8Array(30 + entry.name.length);
    const local = view(header);
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, entry.method, true);
    local.setUint16(10, entry.time, true);
    local.setUint16(12, entry.date, true);
    local.setUint32(14, entry.crc, true);
    local.setUint32(18, entry.compressed, true);
    local.setUint32(22, entry.size, true);
    local.setUint16(26, entry.name.length, true);
    header.set(entry.name, 30);
    pieces.push(header, entry.data);

    const record = new Uint8Array(46 + entry.name.length);
    const row = view(record);
    row.setUint32(0, CENTRAL, true);
    row.setUint16(4, 20, true);
    row.setUint16(6, 20, true);
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
  }
  const directorySize = central.reduce((total, record) => total + record.length, 0);
  const end = new Uint8Array(22);
  const tail = view(end);
  tail.setUint32(0, EOCD, true);
  tail.setUint16(8, packed.length, true);
  tail.setUint16(10, packed.length, true);
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
