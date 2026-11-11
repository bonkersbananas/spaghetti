import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

/**
 * The landing page (landing.html) names its pictures by hand: a srcset of AVIF widths and a WebP fallback for each.
 * A name that doesn't exist builds without a word and shows a broken picture, so check them here.
 */

const root = join(import.meta.dirname, "../..");
const html = readFileSync(join(root, "landing.html"), "utf8");
const IMAGES = "/src/landing/images/";

const file = (url: string) => join(root, url.replace(/^\//, ""));

describe("the landing page's pictures", () => {
  it("names only pictures that exist, each AVIF with its own width", () => {
    const srcsets = [...html.matchAll(/srcset="([^"]+)"/g)].map((match) => match[1] ?? "");
    const candidates = srcsets.flatMap((srcset) => srcset.split(",").map((candidate) => candidate.trim().split(/\s+/)));
    expect(candidates.length).toBeGreaterThan(20);
    for (const [url = "", descriptor = ""] of candidates) {
      expect(url.startsWith(IMAGES), url).toBe(true);
      expect(existsSync(file(url)), `${url} doesn't exist`).toBe(true);
      // <name>-<width>.avif is <width> pixels wide, and a "w" descriptor says so.
      const width = url.match(/-(\d+)\.avif$/)?.[1];
      if (descriptor.endsWith("w")) expect(descriptor, url).toBe(`${width}w`);
    }
  });

  it("gives each picture the shape of its file", async () => {
    const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
    const pictures = images.filter((img) => img.includes(`src="${IMAGES}`));
    expect(pictures.length).toBeGreaterThan(15);
    for (const img of pictures) {
      const src = img.match(/src="([^"]+)"/)?.[1] ?? "";
      expect(existsSync(file(src)), `${src} doesn't exist`).toBe(true);
      const width = Number(img.match(/width="(\d+)"/)?.[1]);
      const height = Number(img.match(/height="(\d+)"/)?.[1]);
      const actual = await sharp(file(src)).metadata();
      expect(width / height, src).toBeCloseTo((actual.width ?? 0) / (actual.height ?? 1), 2);
    }
  });
});
