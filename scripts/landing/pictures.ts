/**
 * The landing page's pictures (see scripts/landing-shots.ts): each one is made from a photo in scripts/landing/photos
 * or a screenshot in screenshots/landing, then saved as AVIF at a few widths plus one WebP fallback, named
 * <name>-<width>.avif and <name>.webp, in src/landing/images. landing.html lists the same names and widths: a picture
 * added or resized here is added or resized there too.
 *
 * Photos are cropped and warmed a little toward the page's paper; the two photos of a laptop on its printed stand get
 * an app screen on the laptop, set in perspective by the browser (CSS matrix3d) so nothing but Chromium draws it.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import sharp, { type Sharp } from "sharp";
import { launchOptions } from "../lib/browser.ts";
import { root } from "../lib/wrangler.ts";
import { PEOPLE } from "./demo.ts";

const PHOTOS = join(root, "scripts/landing/photos");
export const IMAGES = join(root, "src/landing/images");

type Point = [number, number];

interface Picture {
  name: string;
  /** Widths to save as AVIF; the WebP fallback is the middle one. Never wider than the source. */
  widths: number[];
  /** A screenshot (sharp text and flat colour) keeps full colour resolution; photos don't need it. */
  kind: "screen" | "photo";
  make: (shots: string) => Promise<Sharp>;
}

const photo = (name: string) => sharp(join(PHOTOS, `${name}.jpg`));
const shot = (shots: string, name: string) => sharp(join(shots, `${name}.png`));

/**
 * A touch warmer and softer in the shadows, so a photo sits on the page's paper rather than on a screen: red up a
 * little, blue down, shadows lifted toward brown. `strength` 1 is for cool, grey photos; warm ones get less.
 */
function warm(image: Sharp, strength = 1): Sharp {
  return image.linear(
    [1 + 0.03 * strength, 1 + 0.005 * strength, 1 - 0.05 * strength],
    [6 * strength, 3 * strength, 0],
  );
}

/** The laptop screens in the two desk photos, as measured on the originals (1024 × 559): top left, top right, bottom right, bottom left. */
const SCREENS: Record<string, Point[]> = {
  "desk-laptop-right": [
    [367.6, 44.3],
    [606.3, 58.1],
    [624.3, 249.9],
    [387.3, 260.9],
  ],
  "desk-laptop-left": [
    [345.4, 34.7],
    [519.5, 62.5],
    [556.8, 249.2],
    [386.3, 259.4],
  ],
};

export const PICTURES: Picture[] = [
  // The app, on a phone (the Home Screen app on an iPhone, 390 × 844 at 3x) and a laptop (1440 × 900 at 2x).
  ...["phone-today", "phone-capture", "phone-attempt", "phone-journal"].map(
    (name): Picture => ({ name, widths: [480, 800, 1170], kind: "screen", make: async (shots) => shot(shots, name) }),
  ),
  ...["laptop-build", "laptop-today"].map(
    (name): Picture => ({ name, widths: [960, 1440, 2160], kind: "screen", make: async (shots) => shot(shots, name) }),
  ),
  // The two people's pictures, for the avatars the page draws itself (person-co, person-m).
  ...PEOPLE.map(
    (person): Picture => ({
      name: `person-${person.picture.replace(/\.\w+$/, "")}`,
      widths: [96, 192],
      kind: "photo",
      make: async () => sharp(join(root, "scripts/landing/people", person.picture)).resize(192, 192, { fit: "cover" }),
    }),
  ),
  // Photos of prints.
  { name: "octopus", widths: [640, 1024, 1420], kind: "photo", make: async () => warm(photo("octopus"), 0.3) },
  { name: "tugboat", widths: [512, 1024], kind: "photo", make: async () => warm(photo("tugboat"), 0.4) },
  {
    name: "tugboat-printing",
    widths: [512, 1024],
    kind: "photo",
    make: async () => warm(photo("tugboat-printing"), 1),
  },
  // Two angles on the same nest, and the nest alone.
  { name: "spaghetti", widths: [512, 1024], kind: "photo", make: async () => warm(photo("spaghetti"), 0.6) },
  {
    name: "spaghetti-nest",
    widths: [512],
    kind: "photo",
    make: async () => warm(photo("spaghetti").extract({ left: 512, top: 0, width: 512, height: 559 }), 0.6),
  },
  { name: "organizer", widths: [512, 1024], kind: "photo", make: async () => warm(photo("organizer"), 0.8) },
  {
    name: "organizer-parts",
    widths: [512, 1024],
    kind: "photo",
    // The original has a caption along the bottom.
    make: async () => warm(photo("organizer-parts").extract({ left: 0, top: 0, width: 1024, height: 700 }), 0.8),
  },
  {
    name: "organizer-printing",
    widths: [512, 1024],
    kind: "photo",
    make: async () => warm(photo("organizer-printing"), 0.8),
  },
  { name: "laptop-stand", widths: [512, 1024], kind: "photo", make: async () => warm(photo("laptop-stand"), 1) },
  // The app in use: a screen set into the laptop on the printed stand.
  {
    name: "desk-search",
    widths: [800, 1400, 2048],
    kind: "photo",
    make: async (shots) => warm(sharp(await onTheLaptop("desk-laptop-right", join(shots, "laptop-search.png"))), 1),
  },
  {
    name: "desk-build",
    widths: [800, 1400, 2048],
    kind: "photo",
    make: async (shots) => warm(sharp(await onTheLaptop("desk-laptop-left", join(shots, "laptop-build.png"))), 1),
  },
];

/**
 * The perspective transform that takes a w × h box to the quad (top left, top right, bottom right, bottom left), as a
 * CSS matrix3d with its origin at the box's top left (Heckbert's square-to-quad mapping, scaled to the box).
 */
export function quadTransform(w: number, h: number, [p0, p1, p2, p3]: Point[]): string {
  const [x0, y0] = p0 as Point;
  const [x1, y1] = p1 as Point;
  const [x2, y2] = p2 as Point;
  const [x3, y3] = p3 as Point;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const k = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + k * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + k * y3;
  const m = [a / w, d / w, 0, g / w, b / h, e / h, 0, k / h, 0, 0, 1, 0, x0, y0, 0, 1];
  return `matrix3d(${m.map((n) => +n.toFixed(8)).join(",")})`;
}

/** The desk photo at twice its size with the screenshot on the laptop's screen, drawn by the browser; a PNG. */
async function onTheLaptop(desk: string, screenshot: string): Promise<Buffer> {
  const quad = SCREENS[desk];
  if (!quad) throw new Error(`No screen measured in ${desk}`);
  const deskData = readFileSync(join(PHOTOS, `${desk}.jpg`)).toString("base64");
  const shotData = readFileSync(screenshot).toString("base64");
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 559 }, deviceScaleFactor: 2 });
    const clip = quad.map(([x, y]) => `${x}px ${y}px`).join(",");
    await page.setContent(`<!doctype html><style>
      html, body { margin: 0; width: 1024px; height: 559px; overflow: hidden; }
      img { position: absolute; left: 0; top: 0; }
      .desk { width: 1024px; height: 559px; }
      .screen { width: 1440px; height: 900px; transform-origin: 0 0; transform: ${quadTransform(1440, 900, quad)};
        /* A lit screen in a bright room: a little less contrast than the file, never brighter than the photo. */
        filter: contrast(0.94) brightness(0.98) saturate(1.04); }
      .glare { position: absolute; inset: 0; clip-path: polygon(${clip});
        background: linear-gradient(112deg, rgb(255 255 255 / 0.14), rgb(255 255 255 / 0.02) 38%, transparent 55%, rgb(0 0 0 / 0.05)); }
      </style>
      <img class="desk" src="data:image/jpeg;base64,${deskData}">
      <img class="screen" src="data:image/png;base64,${shotData}">
      <div class="glare"></div>`);
    await page.evaluate(() => Promise.all(Array.from(document.images, (image) => image.decode())));
    return await page.screenshot({ type: "png" });
  } finally {
    await browser.close();
  }
}

/** Saves a picture at its widths as AVIF, and its middle width as WebP; returns the files written. */
async function save(picture: Picture, image: Sharp): Promise<string[]> {
  const buffer = await image.png().toBuffer();
  const { width: sourceWidth = 0 } = await sharp(buffer).metadata();
  const widths = picture.widths.filter((w) => w <= sourceWidth);
  if (widths.length !== picture.widths.length) {
    throw new Error(`${picture.name} is ${sourceWidth} px wide, narrower than ${Math.max(...picture.widths)}`);
  }
  const files: string[] = [];
  const screen = picture.kind === "screen";
  for (const width of widths) {
    const file = `${picture.name}-${width}.avif`;
    await sharp(buffer)
      .resize({ width, kernel: "lanczos3" })
      .avif({ quality: screen ? 62 : 52, effort: 4, chromaSubsampling: screen ? "4:4:4" : "4:2:0" })
      .toFile(join(IMAGES, file));
    files.push(file);
  }
  const fallback = widths[Math.floor((widths.length - 1) / 2)] ?? sourceWidth;
  const webp = `${picture.name}.webp`;
  await sharp(buffer)
    .resize({ width: fallback })
    .webp({ quality: screen ? 82 : 76, effort: 6, smartSubsample: true })
    .toFile(join(IMAGES, webp));
  files.push(webp);
  return files;
}

export async function makePictures(shots: string) {
  rmSync(IMAGES, { recursive: true, force: true });
  mkdirSync(IMAGES, { recursive: true });
  let total = 0;
  for (const picture of PICTURES) {
    const files = await save(picture, await picture.make(shots));
    const sizes = files.map((file) => readFileSync(join(IMAGES, file)).length);
    total += sizes.reduce((sum, size) => sum + size, 0);
    console.log(
      `  ${picture.name}: ${files.map((file, i) => `${file} ${Math.round((sizes[i] ?? 0) / 1024)} kB`).join(", ")}`,
    );
  }
  console.log(`  ${Math.round(total / 1024)} kB in ${IMAGES}`);
  writeFileSync(join(IMAGES, "README.md"), README);
}

const README = `# Landing page pictures

Made by \`pnpm landing:shots\` (scripts/landing-shots.ts, scripts/landing/pictures.ts) from the photos in
scripts/landing/photos and screenshots of the app on the screenshot seed. Don't edit these by hand: change the script
and run it again.
`;
