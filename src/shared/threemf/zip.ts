import { Unzip, UnzipInflate } from "fflate";

/** Largest archive we try to open. A .gcode.3mf with a long print is tens of MB. */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/**
 * What one reading may unpack in all: a file made to blow up (hundreds of pictures each under its own limit) is refused
 * with `tooMuch` instead of held in memory. A Worker has 128 MB; real files unpack to a few MB here (the plates'
 * pictures, the configs, the head of the model), and the biggest project settings are 8 MB.
 */
export const MAX_UNPACKED_BYTES = 48 * 1024 * 1024;
export const MAX_UNPACKED_ENTRIES = 400;
/** Entries listed at all, wanted or not (a zip of a million empty files is as unwelcome). */
export const MAX_LISTED_ENTRIES = 20_000;

export interface EntryRule {
  /** Most bytes to keep from this entry. */
  limit: number;
  /** When the entry is longer than `limit`: keep the first `limit` bytes quietly instead of dropping it. */
  truncate?: boolean;
}

export interface ReadEntries {
  files: Map<string, Uint8Array>;
  /** Names of every entry in the archive, wanted or not. */
  names: string[];
  warnings: string[];
  /** The file asked for more than MAX_UNPACKED_BYTES / MAX_UNPACKED_ENTRIES / MAX_LISTED_ENTRIES: what was read is partial. */
  tooMuch?: true;
}

/**
 * Streams through a zip and inflates only the entries `rule` asks for, stopping each one as soon as
 * it passes its byte limit, so a G-code or a zip bomb is never inflated in full. Never throws.
 */
export function readEntries(data: Uint8Array, rule: (name: string) => EntryRule | undefined): ReadEntries {
  const files = new Map<string, Uint8Array>();
  const names: string[] = [];
  const warnings: string[] = [];
  let unpacked = 0;
  let unpackedEntries = 0;
  let tooMuch = false;
  const refuse = () => {
    if (!tooMuch) warnings.push("This file unpacks to more than Spaghetti reads: it was left unread");
    tooMuch = true;
  };

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (file) => {
    if (tooMuch) return;
    if (names.length >= MAX_LISTED_ENTRIES) return refuse();
    const name = file.name.replace(/\\/g, "/").replace(/^\/+/, "");
    names.push(name);
    const r = rule(name);
    if (!r) return;
    if (++unpackedEntries > MAX_UNPACKED_ENTRIES) return refuse();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let done = false;
    file.ondata = (err, chunk, final) => {
      if (done) return;
      if (err) {
        done = true;
        warnings.push(`Could not unpack ${name}: ${err.message}`);
        return;
      }
      let part = chunk;
      const room = r.limit - total;
      if (part.length > room) {
        part = part.subarray(0, Math.max(room, 0));
        done = true;
        file.terminate();
        if (!r.truncate) {
          warnings.push(`Skipped ${name}: it unpacks to more than ${r.limit} bytes`);
          return;
        }
      }
      unpacked += part.length;
      if (unpacked > MAX_UNPACKED_BYTES) {
        done = true;
        file.terminate();
        refuse();
        return;
      }
      chunks.push(part);
      total += part.length;
      if (final || done) {
        done = true;
        files.set(name, concat(chunks, total));
      }
    };
    try {
      file.start();
    } catch (e) {
      warnings.push(`Could not unpack ${name}: ${(e as Error).message}`);
    }
  };

  try {
    if (data.length > MAX_ARCHIVE_BYTES) throw new Error("the file is too large");
    unzip.push(data, true);
  } catch (e) {
    warnings.push(`Could not read the archive: ${(e as Error).message}`);
  }
  if (tooMuch) files.clear();
  return { files, names, warnings, ...(tooMuch ? { tooMuch: true as const } : {}) };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  if (chunks.length === 1 && chunks[0]) return chunks[0];
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
