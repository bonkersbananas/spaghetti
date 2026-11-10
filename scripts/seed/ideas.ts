/**
 * A dozen convincing ideas for screenshots, most with photos. The photos
 * are hand-drawn SVG stand-ins (scripts/seed/photos, drawn for this repo),
 * rendered to JPEG in the browser and uploaded through the real API, so the
 * screenshots exercise the same path a phone does.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Browser } from "@playwright/test";
import { root } from "../lib/wrangler.ts";

interface SeedIdea {
  id: string;
  by: "alex" | "sam";
  /** How long ago it was captured. */
  ago: number;
  title?: string;
  note?: string;
  photos: Array<{ file: string; color: string }>;
  /** Its place in the Up next queue (1 is first). */
  upNext?: number;
  /** Who it is for. */
  forWhom?: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Stable ids, so screenshots can open a particular idea. */
export const SEED_IDS = {
  deskTidy: "5eed0000-0000-4000-8000-000000000006",
  tugboat: "5eed0000-0000-4000-8000-000000000002",
  headphoneStand: "5eed0000-0000-4000-8000-000000000004",
  planter: "5eed0000-0000-4000-8000-000000000005",
  desiccantHook: "5eed0000-0000-4000-8000-000000000008",
  lithophane: "5eed0000-0000-4000-8000-000000000009",
  spoolHolder: "5eed0000-0000-4000-8000-000000000010",
  cableChain: "5eed0000-0000-4000-8000-000000000012",
};

export const SEED_IDEAS: SeedIdea[] = [
  {
    id: "5eed0000-0000-4000-8000-000000000001",
    by: "sam",
    ago: 25 * MIN,
    note: "Found this on the bed this morning. Retry the cable chain with a brim and a slower first layer.",
    photos: [{ file: "spaghetti-fail.svg", color: "#777065" }],
  },
  {
    id: SEED_IDS.tugboat,
    by: "alex",
    ago: 3 * DAY + 2 * HOUR,
    title: "Bath tugboat for Mila",
    note: "Chunky enough for small hands. Print the hull in two halves so it floats upright?",
    photos: [{ file: "tugboat.svg", color: "#867362" }],
  },
  {
    id: "5eed0000-0000-4000-8000-000000000003",
    by: "alex",
    ago: 5 * HOUR,
    note: "Replacement knob for the oven, 6 mm D-shaft. Measure the old one before it breaks completely.",
    upNext: 2,
    forWhom: "the kitchen",
    photos: [],
  },
  {
    id: SEED_IDS.headphoneStand,
    by: "sam",
    ago: 6 * DAY + 3 * HOUR,
    title: "Headphone stand",
    note: "Charcoal matte PLA. Needs a heavier base, or rubber feet.",
    photos: [{ file: "headphone-stand.svg", color: "#98846c" }],
  },
  {
    id: SEED_IDS.planter,
    by: "alex",
    ago: 11 * DAY + 6 * HOUR,
    title: "Self-watering planter",
    note: "Terracotta PLA with a water window. Seal the reservoir with two extra walls.",
    photos: [{ file: "planter-self-watering.svg", color: "#c7c0af" }],
  },
  {
    id: SEED_IDS.deskTidy,
    by: "sam",
    ago: 2 * DAY + 2 * HOUR,
    title: "Desk tidy-up",
    upNext: 1,
    note: "Clips for the desk edge, a bin for the drawer of screws, and a phone stand in that blue PETG.\n\nThe bin's grid is from https://makerworld.com/en/models/drawer-bins, scaled to 42 mm.",
    photos: [
      { file: "cable-clips.svg", color: "#a5967e" },
      { file: "drawer-organizer.svg", color: "#c1b198" },
      { file: "phone-stand.svg", color: "#aca69f" },
    ],
  },
  {
    id: "5eed0000-0000-4000-8000-000000000007",
    by: "alex",
    ago: 3 * DAY,
    photos: [{ file: "gear-set.svg", color: "#5f7058" }],
  },
  {
    id: SEED_IDS.desiccantHook,
    by: "sam",
    ago: 4 * DAY,
    title: "Hook for the desiccant bag",
    note: "The bag keeps sliding off the stock hook beside the AMS.",
    photos: [{ file: "ams-hook.svg", color: "#c3ab8e" }],
  },
  {
    id: SEED_IDS.lithophane,
    by: "alex",
    ago: 5 * DAY,
    title: "Lithophane lamp",
    note: "Photo from the Dolomites trip. 0.12 mm layers in white PLA, warm LED strip inside.",
    photos: [{ file: "lithophane-lamp.svg", color: "#584230" }],
  },
  {
    id: SEED_IDS.spoolHolder,
    by: "sam",
    ago: 7 * DAY,
    note: "Roller spool holder for the shelf above the printer, so the AMS isn't the only home for spools.",
    photos: [{ file: "spool-holder.svg", color: "#a5a28f" }],
  },
  {
    id: "5eed0000-0000-4000-8000-000000000011",
    by: "alex",
    ago: 9 * DAY,
    title: "Calibration cube, but useful",
    note: "A small cube with a hole for a 608 bearing: checks tolerances and ends up a fidget toy.",
    photos: [],
  },
  {
    id: SEED_IDS.cableChain,
    by: "sam",
    ago: 12 * DAY,
    title: "Cable chain",
    note: "For the back of the X2D. Check the clearance to the wall first.",
    photos: [],
  },
  {
    // A short note, the way most get jotted next to the printer.
    id: "5eed0000-0000-4000-8000-000000000015",
    by: "alex",
    ago: 3 * HOUR,
    note: "Hook for the bike helmet",
    photos: [],
  },
  {
    id: "5eed0000-0000-4000-8000-000000000013",
    by: "sam",
    ago: 47 * DAY,
    note: "Bag clips for the coffee, with a little spoon holder on the side.",
    photos: [],
  },
  {
    id: "5eed0000-0000-4000-8000-000000000014",
    by: "alex",
    ago: 71 * DAY,
    title: "Wall mount for the router",
    note: "Keyhole slots, 160 mm apart. Leave room for the cables underneath.",
    photos: [],
  },
];

/** A different shot of the same drawing: a crop of its viewBox, and a CSS filter for light. */
export interface PhotoVariant {
  /** x, y, width, height in the drawing's viewBox units. */
  crop?: [number, number, number, number];
  filter?: string;
}

/** Renders an SVG stand-in at a given long edge as JPEG. */
export async function render(
  browser: Browser,
  source: string,
  longEdge: number,
  variant: PhotoVariant = {},
): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const svg = variant.crop ? source.replace(/viewBox="[^"]+"/, `viewBox="${variant.crop.join(" ")}"`) : source;
  const [, , vbWidth = 1200, vbHeight = 900] = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1200 900")
    .split(/\s+/)
    .map(Number);
  const scale = longEdge / Math.max(vbWidth, vbHeight);
  const width = Math.round(vbWidth * scale);
  const height = Math.round(vbHeight * scale);
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(
    `<style>html,body{margin:0;overflow:hidden}svg{display:block;width:${width}px;height:${height}px;filter:${variant.filter ?? "none"}}</style>${svg}`,
  );
  const jpeg = await page.screenshot({ type: "jpeg", quality: 82 });
  await page.close();
  return { jpeg, width, height };
}

/** Creates the seed ideas through the API, as whoever captured each one. */
export async function seedIdeas(
  browser: Browser,
  requests: Record<"alex" | "sam", APIRequestContext>,
  origin: string,
  now: number,
) {
  const rendered = new Map<string, { large: Buffer; thumb: Buffer; width: number; height: number }>();
  // Oldest first, as they would have been captured.
  for (const idea of [...SEED_IDEAS].reverse()) {
    const request = requests[idea.by];
    const created = await request.post("/api/items", {
      headers: { Origin: origin },
      data: { id: idea.id, title: idea.title ?? null, note: idea.note ?? "", createdAt: now - idea.ago },
    });
    if (!created.ok()) throw new Error(`Seeding ${idea.id} failed: ${created.status()}`);
    if (idea.forWhom) {
      await request.patch(`/api/items/${idea.id}`, { headers: { Origin: origin }, data: { forWhom: idea.forWhom } });
    }
    for (const [position, photo] of idea.photos.entries()) {
      let images = rendered.get(photo.file);
      if (!images) {
        const svg = readFileSync(join(root, "scripts/seed/photos", photo.file), "utf8");
        const large = await render(browser, svg, 1600);
        const thumb = await render(browser, svg, 600);
        images = { large: large.jpeg, thumb: thumb.jpeg, width: large.width, height: large.height };
        rendered.set(photo.file, images);
      }
      const photoId = crypto.randomUUID();
      const uploaded = await request.put(`/api/items/${idea.id}/photos/${photoId}`, {
        headers: { Origin: origin },
        multipart: {
          width: String(images.width),
          height: String(images.height),
          color: photo.color,
          position: String(position),
          large: { name: "large.jpg", mimeType: "image/jpeg", buffer: images.large },
          thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: images.thumb },
        },
      });
      if (!uploaded.ok())
        throw new Error(`Uploading ${photo.file} failed: ${uploaded.status()} ${await uploaded.text()}`);
    }
  }
  // The Up next queue, marked in its order.
  for (const idea of SEED_IDEAS.filter((i) => i.upNext).sort((a, b) => (a.upNext ?? 0) - (b.upNext ?? 0))) {
    await requests[idea.by].patch(`/api/items/${idea.id}`, { headers: { Origin: origin }, data: { upNext: true } });
  }
}
