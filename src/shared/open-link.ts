/**
 * "Open in Bambu Studio" (decision 0058): which files Bambu Studio can open by address, what the address of a
 * signed link looks like, and the address that makes the app open. Pure, shared by the Worker and the app.
 */

import { isStlName, slicedName } from "./slicing/files.ts";
import { STL_WRAP_MAX_BYTES } from "./threemf/stl-wrap.ts";

/** Which file of a row is opened: its own bytes, or a model's sliced .gcode.3mf. */
export type OpenPart = "file" | "sliced";

/** How long a link made for Bambu Studio works. Long enough to read its "open it anyway?" question. */
export const OPEN_LINK_MINUTES = 10;

/** Bambu Studio imports only .3mf by address (Plater::import_model_id); an .stl is wrapped in one on the way (decision 0059). */
export const opensInBambuStudio = (name: string) => /\.3mf$/i.test(name);

/** Whether an original file can be opened: a .3mf as it is, an .stl small enough to wrap (its size, when known). */
export const opensOriginal = (name: string, size?: number) =>
  opensInBambuStudio(name) || (isStlName(name) && (size === undefined || size <= STL_WRAP_MAX_BYTES));

/** What Bambu Studio saves the file as: a name it can use in a path, in plain characters, with its extension. */
export function openName(name: string): string {
  const match = /^(.*?)((?:\.gcode)?\.3mf|\.stl)$/i.exec(name.trim());
  const stem = (match?.[1] ?? name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${stem || "model"}${/\.stl$/i.test(match?.[2] ?? "") ? ".3mf" : (match?.[2] ?? ".3mf").toLowerCase()}`;
}

/**
 * The address that opens Bambu Studio on a computer, with Bambu Studio fetching `link` itself. macOS registers
 * `bambustudioopen://<link>`, Windows and Linux `bambustudio://open?file=<link>`; both take the link URL-encoded.
 */
export function bambuStudioUrl(link: string, mac: boolean): string {
  return mac ? `bambustudioopen://${encodeURIComponent(link)}` : `bambustudio://open?file=${encodeURIComponent(link)}`;
}

/** POST /api/files/:id/open-link. */
export interface OpenLinkResponse {
  /** Signed, https, read-only, for one file; ends in the file's name. */
  url: string;
  name: string;
  /** When it stops working (ms). */
  expiresAt: number;
}

/** One thing "Open in Bambu Studio" can open for a kept file. */
export interface OpenChoice {
  part: OpenPart;
  /** The name Bambu Studio gets, always .3mf or .gcode.3mf. */
  name: string;
  /** What the plain download of this part is called (the .stl itself, not its wrapped .3mf). */
  download: string;
  /** What it is, in a word: the sliced file is ready to print, the original is to slice or tweak. */
  label: string;
  hint: string;
}

/**
 * What "Open in Bambu Studio" can open for a kept file, the one to open first leading (empty when there is nothing).
 * A sliced model offers its sliced .gcode.3mf, ready to print, and its original model (a .3mf as it is, an .stl
 * wrapped in a .3mf) to slice or tweak; an unsliced model only its original; a plain .3mf or slicer file its own bytes.
 */
export function openChoices(file: {
  kind?: string;
  name: string;
  size?: number;
  stored: boolean;
  pending?: boolean;
  slice?: { status: string } | null;
}): OpenChoice[] {
  if (file.pending || !file.stored) return [];
  const choices: OpenChoice[] = [];
  const model = file.kind === "model";
  if (model && file.slice?.status === "sliced") {
    choices.push({
      part: "sliced",
      name: slicedName(file.name),
      download: slicedName(file.name),
      label: "Sliced file",
      hint: "Ready to print",
    });
  }
  if (opensOriginal(file.name, file.size)) {
    choices.push({
      part: "file",
      name: openName(file.name),
      download: file.name,
      label: model ? "Original model" : "File",
      hint: model ? "To slice or tweak" : "As it is",
    });
  }
  return choices;
}

/** What opens first: the first of `openChoices`, or null. */
export const openTarget = (file: Parameters<typeof openChoices>[0]): OpenChoice | null => openChoices(file)[0] ?? null;
