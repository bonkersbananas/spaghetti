import { createHash } from "node:crypto";

/** The same name for a file as the printer and the app say it: no extension, case or spacing. */
export function fileKey(name: string): string {
  return name
    .replace(/^.*[\\/]/, "")
    .replace(/\.(gcode\.)?3mf$/i, "")
    .replace(/\.gcode$/i, "")
    .replace(/[\s_]+/g, " ")
    .trim()
    .toLowerCase();
}

/** A build's title from a print's name: "bracket_v2.gcode.3mf" → "bracket v2". Null when nothing is left (titles are optional). */
export function titleFromJob(name: string): string | null {
  const cleaned = name
    .replace(/^.*[\\/]/, "")
    .replace(/\.(gcode\.)?3mf$/i, "")
    .replace(/\.gcode$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 120) : null;
}

/**
 * A UUID made from the printer and a name, so the same print always gets the same ids: a retry after a crash (or a
 * lost state file) finds what it made before instead of making it twice.
 */
export function stableId(...parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\u0000")).digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const h = Buffer.from(bytes).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Width and height of a JPEG, read from its header. Null when it isn't one. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at++;
      continue;
    }
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xff) {
      at++;
      continue;
    }
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return {
        height: ((bytes[at + 5] ?? 0) << 8) | (bytes[at + 6] ?? 0),
        width: ((bytes[at + 7] ?? 0) << 8) | (bytes[at + 8] ?? 0),
      };
    }
    at += 2 + length;
  }
  return null;
}
