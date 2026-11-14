/**
 * "Open in Bambu Studio" (decision 0058): which files Bambu Studio can open by address, what the address of a
 * signed link looks like, and the address that makes the app open. Pure, shared by the Worker and the app.
 */

import { slicedName } from "./slicing/files.ts";

/** Which file of a row is opened: its own bytes, or a model's sliced .gcode.3mf. */
export type OpenPart = "file" | "sliced";

/** How long a link made for Bambu Studio works. Long enough to read its "open it anyway?" question. */
export const OPEN_LINK_MINUTES = 10;

/** Bambu Studio imports only .3mf by address (Plater::import_model_id); an .stl is refused there. */
export const opensInBambuStudio = (name: string) => /\.3mf$/i.test(name);

/** What Bambu Studio saves the file as: a name it can use in a path, in plain characters, with its extension. */
export function openName(name: string): string {
  const match = /^(.*?)((?:\.gcode)?\.3mf)$/i.exec(name.trim());
  const stem = (match?.[1] ?? name)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return `${stem || "model"}${(match?.[2] ?? ".3mf").toLowerCase()}`;
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

/**
 * What "Open in Bambu Studio" opens for a kept file, or null when there is nothing Bambu Studio can open: a model
 * that is sliced opens its sliced .gcode.3mf (what you would print), a plain .3mf model or a slicer file its own
 * bytes, and an .stl that isn't sliced yet nothing (Bambu Studio takes no .stl by address).
 */
export function openTarget(file: {
  kind?: string;
  name: string;
  stored: boolean;
  pending?: boolean;
  slice?: { status: string } | null;
}): { part: OpenPart; name: string } | null {
  if (file.pending || !file.stored) return null;
  if (file.kind === "model" && file.slice?.status === "sliced") {
    return { part: "sliced", name: slicedName(file.name) };
  }
  return opensInBambuStudio(file.name) ? { part: "file", name: file.name } : null;
}
