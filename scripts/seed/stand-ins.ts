/**
 * The seed's photos are drawings (scripts/seed/photos). `pnpm landing:shots` puts real photos of prints in place of
 * some of them, so the landing page shows the app with real prints in it. A real photo keeps the drawing's frame (its
 * viewBox, filled edge to edge), so the seed's crops, filters and sizes apply to it unchanged.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "../lib/wrangler.ts";

const replaced = new Map<string, string>();

/** From now on, these drawings (by file name, "tugboat.svg") are drawn by these JPEGs (absolute paths). */
export function replaceSeedPhotos(photos: Record<string, string>) {
  for (const [drawing, jpeg] of Object.entries(photos)) replaced.set(drawing, jpeg);
}

/** The SVG for a seed photo: the drawing, or the real photo that replaces it, in the drawing's frame. */
export function seedPhotoSvg(file: string): string {
  const svg = readFileSync(join(root, "scripts/seed/photos", file), "utf8");
  const photo = replaced.get(file);
  if (!photo) return svg;
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1200 900";
  const [, , width = "1200", height = "900"] = viewBox.split(/\s+/);
  const data = readFileSync(photo).toString("base64");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"><image href="data:image/jpeg;base64,${data}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/></svg>`;
}
