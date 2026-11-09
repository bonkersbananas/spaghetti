/**
 * pnpm icons — renders the PNG app icons in public/ from public/icon.svg.
 * Run it after changing the mark; the PNGs are checked in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { root } from "./lib/wrangler.ts";

const svg = readFileSync(join(root, "public/icon.svg"), "utf8");
// Full-bleed tile (no rounded corners): iOS and maskable icons apply their own mask.
const fullBleed = svg.replace(/rx="\d+"/, 'rx="0"');
// Maskable icons keep their content inside the central 80% safe zone.
const maskable = fullBleed.replace(/<path /, '<path transform="translate(6.4 6.4) scale(0.8)" ');

const icons = [
  { file: "favicon-32.png", size: 32, svg },
  { file: "icon-192.png", size: 192, svg },
  { file: "icon-512.png", size: 512, svg },
  { file: "apple-touch-icon.png", size: 180, svg: fullBleed },
  { file: "icon-maskable-512.png", size: 512, svg: maskable },
];

const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const html = `<body style="margin:0;background:transparent">${icon.svg.replace("<svg ", `<svg width="${icon.size}" height="${icon.size}" `)}</body>`;
    await page.setContent(html);
    await page.screenshot({ path: join(root, "public", icon.file), omitBackground: true });
    await page.close();
    console.log(`  public/${icon.file}`);
  }
} finally {
  await browser.close();
}
