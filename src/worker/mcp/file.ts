import type { AttemptSettings } from "../../shared/attempts.ts";
import { cleanFileName, isStlName } from "../../shared/slicing/files.ts";
import { printablePlates, settingsFromFile, slicerName } from "../../shared/threemf/prefill.ts";
import { readThreeMf } from "../../shared/threemf/read.ts";
import type { Transfer } from "./image.ts";

/** What an agent may send in one call: a model made in a conversation is small, and the Worker holds it a few times. */
export const MAX_AGENT_FILE_BYTES = 25 * 1024 * 1024;
/** The cap on file_base64: the text is a third bigger than the file, and travels in the tool call itself. */
export const MAX_AGENT_BASE64_BYTES = 10 * 1024 * 1024;

export const FILE_TRANSFER: Transfer = { what: "file", limit: MAX_AGENT_FILE_BYTES };

/** What the file routes need to know about a file that wasn't read in a browser. */
export interface FileInfo {
  name: string;
  bytes: Uint8Array;
  /** "model": an .stl or plain .3mf the app slices in a browser; "slicer": a sliced .gcode.3mf. */
  kind: "model" | "slicer";
  plate: number;
  plateCount: number;
  slicer?: string;
  prefill: AttemptSettings;
  objects: string[];
  /** A sliced file's plate picture. */
  thumb?: { bytes: Uint8Array; type: string };
  /** The size of an STL's bounding box in mm (X, Y, Z), when it was cheap to find. */
  size?: [number, number, number];
}

const WHAT =
  "Spaghetti keeps .stl and .3mf files (a plain model, or a project or sliced .gcode.3mf from Bambu Studio or OrcaSlicer).";

/** A file name from a URL's last path segment ("https://x/y/benchy.stl?dl=1" → "benchy.stl"). */
export function nameFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "");
    return /\.(stl|3mf)$/i.test(last) ? last : null;
  } catch {
    return null;
  }
}

const u32 = (view: DataView, offset: number) => view.getUint32(offset, true);

/** A binary STL says how many triangles it has; the file is exactly that long (some tools add a few bytes). */
function isBinaryStl(bytes: Uint8Array): boolean {
  if (bytes.length < 84) return false;
  const triangles = u32(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), 80);
  return triangles > 0 && bytes.length >= 84 + triangles * 50 && bytes.length <= 84 + triangles * 50 + 1024;
}

const ASCII_LOOK_MAX = 8 * 1024 * 1024;

/** The bounding box of an STL, binary or ASCII, or null when it holds no triangle. */
function stlBox(bytes: Uint8Array): [number, number, number] | null {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  const see = (axis: number, value: number) => {
    if (!Number.isFinite(value)) return;
    if (value < (low[axis] as number)) low[axis] = value;
    if (value > (high[axis] as number)) high[axis] = value;
  };
  if (isBinaryStl(bytes)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const triangles = u32(view, 80);
    for (let t = 0; t < triangles; t++) {
      for (let v = 0; v < 3; v++) {
        for (let axis = 0; axis < 3; axis++) see(axis, view.getFloat32(84 + t * 50 + 12 + v * 12 + axis * 4, true));
      }
    }
  } else {
    if (bytes.length > ASCII_LOOK_MAX) return null;
    const text = new TextDecoder().decode(bytes);
    for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) {
      for (let axis = 0; axis < 3; axis++) see(axis, Number(match[axis + 1]));
    }
  }
  if (!Number.isFinite(low[0])) return null;
  return [0, 1, 2].map((axis) => Math.round(((high[axis] as number) - (low[axis] as number)) * 10) / 10) as [
    number,
    number,
    number,
  ];
}

/** An STL: binary with its triangle count right, or ASCII with facets. */
function looksLikeStl(bytes: Uint8Array): boolean {
  if (isBinaryStl(bytes)) return true;
  const head = new TextDecoder().decode(bytes.subarray(0, 4096));
  return /^\s*solid/i.test(head) && /facet\s+normal|vertex/i.test(head);
}

/**
 * Reads what the Worker can cheaply and safely know about a model an agent sends, the way the app reads one in the
 * browser before it uploads it: a sliced .gcode.3mf's plate, settings, objects and picture (from its zip, no G-code
 * touched); for a model, only that it is a model, with an STL's size. The browser that opens the app next slices it
 * and draws its picture (decision 0078). Throws an Error whose message says what is wrong, for the agent.
 */
export function readModelFile(bytes: Uint8Array, rawName: string): FileInfo {
  if (!bytes.length) throw new Error("The file is empty.");
  if (bytes.length > MAX_AGENT_FILE_BYTES) throw new Error("That file is too large (over 25 MB).");
  const name = cleanFileName(rawName.trim());
  if (!/\.(stl|3mf)$/i.test(name)) throw new Error(`The name must end in .stl or .3mf. ${WHAT}`);
  if (isStlName(name)) {
    if (!looksLikeStl(bytes)) throw new Error(`That isn't an STL file (binary or ASCII). ${WHAT}`);
    const size = stlBox(bytes);
    return { name, bytes, kind: "model", plate: 1, plateCount: 1, prefill: {}, objects: [], ...(size ? { size } : {}) };
  }
  // A 3MF is a zip.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error(`That isn't a 3MF file (a zip). ${WHAT}`);
  }
  const result = readThreeMf(bytes);
  if (result.tooMuch) {
    throw new Error(
      "That 3MF holds more than Spaghetti can read here (too many or too large parts). Send a plainer file.",
    );
  }
  // No G-code in it: a model to slice (a project, or a plain 3MF from anywhere).
  if (result.kind !== "sliced") {
    return { name, bytes, kind: "model", plate: 1, plateCount: 1, prefill: {}, objects: [] };
  }
  const plates = printablePlates(result);
  if (!plates.length && !Object.keys(result.settings).length) {
    throw new Error(`Couldn't read that sliced file. ${WHAT}`);
  }
  const plate = plates[0];
  const thumbnail = plate?.thumbnail;
  const slicer = slicerName(result);
  return {
    name,
    bytes,
    kind: "slicer",
    plate: plate?.index ?? 1,
    plateCount: Math.max(result.plates.length, 1),
    ...(slicer ? { slicer } : {}),
    prefill: settingsFromFile(result, plate?.index),
    objects: (plate?.objects ?? []).map((object) => object.name),
    ...(thumbnail ? { thumb: { bytes: thumbnail.bytes, type: thumbnail.mediaType } } : {}),
  };
}
