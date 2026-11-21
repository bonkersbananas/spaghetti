/**
 * Picking model files (.stl, .3mf, .gcode.3mf) from a file input. iOS turns `accept` into Uniform Type Identifiers and
 * greys out any file whose type it can't map to one: 3MF has no system type at all and STL's is unreliable, so on iOS
 * the inputs take everything and the file is checked after the pick instead (by name and first bytes).
 */
const MODEL_ACCEPT = ".3mf,.stl,model/3mf,model/stl,application/vnd.ms-package.3dmanufacturing-3dmodel+xml";

type Navigatorish = { userAgent: string; platform?: string; maxTouchPoints?: number };

/** iPhone, iPod and iPad, including iPads that say they are a Mac (Safari's desktop-class mode). */
export function isIos(nav: Navigatorish): boolean {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

/** The `accept` for a model input: none on iOS (everything stays pickable), the filter elsewhere. */
export function modelAccept(
  only?: "stl",
  nav: Navigatorish | undefined = typeof navigator === "undefined" ? undefined : navigator,
) {
  if (nav && isIos(nav)) return undefined;
  return only ? ".stl,model/stl" : MODEL_ACCEPT;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];

/** Whether the file is what its name says: a binary or ASCII STL, or a zip for a .3mf (also .gcode.3mf). */
export async function looksLikeModel(file: File, only?: "stl"): Promise<boolean> {
  if (file.size === 0) return false;
  if (/\.stl$/i.test(file.name)) {
    const head = new Uint8Array(await file.slice(0, 84).arrayBuffer());
    if (head.length === 84) {
      const triangles = new DataView(head.buffer).getUint32(80, true);
      if (84 + triangles * 50 <= file.size) return true;
    }
    const text = new TextDecoder().decode(head.subarray(0, 16)).replace(/^﻿/, "");
    return /^\s*solid/i.test(text);
  }
  if (only === "stl" || !/\.3mf$/i.test(file.name)) return false;
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return ZIP.every((byte, i) => head[i] === byte);
}
