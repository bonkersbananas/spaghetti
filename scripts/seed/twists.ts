/**
 * Twists for screenshots: three other people's models changed our way, made through the API as the app does it (the
 * first two from an idea, so they take its model link and cover along).
 */
import type { APIRequestContext } from "@playwright/test";
import { SEED_IDS } from "./ideas.ts";

export const SEED_TWIST_IDS = {
  bins: "5eed0000-0000-4000-8000-0000000e0001",
  tugboat: "5eed0000-0000-4000-8000-0000000e0002",
  hook: "5eed0000-0000-4000-8000-0000000e0003",
  lid: "5eed0000-0000-4000-8000-0000000e0004",
};

const change = (n: number, kind: string, value: string, extra: { label?: string; note?: string } = {}) => ({
  id: `5eed0000-0000-4000-8000-0000000e1${String(n).padStart(3, "0")}`,
  kind,
  value,
  label: extra.label ?? "",
  note: extra.note ?? "",
});

const specs = [
  {
    id: SEED_TWIST_IDS.bins,
    name: "Drawer bins, 42 mm grid",
    note: "The original is 50 mm and our drawers are 42. The lid was tight at +0.1, so +0.2 is right. Don't scale the text on its own.",
    fromItemId: SEED_IDS.deskTidy,
    designer: "Brightside Studio",
    license: "CC BY-NC",
    changes: [
      change(1, "scale", "84 %", { note: "fits the 42 mm grid" }),
      change(2, "tolerance", "+0.2 mm", { note: "the lid snaps, not squeezes" }),
      change(3, "text", "“Screws”", { note: "debossed, 6 mm, on the front" }),
      change(4, "material", "PETG", { note: "was PLA" }),
    ],
  },
  {
    id: SEED_TWIST_IDS.tugboat,
    name: "Bath tugboat, no funnel",
    note: "",
    fromItemId: SEED_IDS.tugboat,
    changes: [
      change(5, "scale", "70 %"),
      change(6, "other", "left off", { label: "Funnel", note: "it tipped the hull" }),
    ],
  },
  {
    id: SEED_TWIST_IDS.hook,
    name: "Spool holder, a looser fit",
    note: "",
    fromItemId: SEED_IDS.spoolHolder,
    sourceUrl: "https://www.printables.com/model/611220-spool-holder",
    changes: [change(7, "tolerance", "+0.2 mm"), change(8, "param", "4", { label: "Wall count" })],
  },
  {
    id: SEED_TWIST_IDS.lid,
    name: "Pen cup, a name added",
    note: "Marie's name on the front in 8 mm letters, debossed.",
    sourceUrl: "https://makerworld.com/en/models/633117-pen-cup",
    changes: [change(9, "text", "“Marie”", { note: "8 mm, debossed" })],
  },
];

export async function seedTwists(alex: APIRequestContext, origin: string) {
  // The list shows the newest first: the specs are made in reverse, so the first leads the list and the last (no picture) ends it.
  for (const spec of [...specs].reverse()) {
    const saved = await alex.post("/api/twists", { headers: { Origin: origin }, data: spec });
    // screenshots:compare seeds the base with this seed: a base without twists has no such route.
    if (saved.status() === 404) return;
    if (!saved.ok()) throw new Error(`Seeding twist "${spec.name}" failed: ${saved.status()} ${await saved.text()}`);
  }
  // The bins were printed from their twist once, and it worked: the twist page lists that build.
  const bins = await alex.post("/api/items", {
    headers: { Origin: origin },
    data: {
      id: "5eed0000-0000-4000-8000-0000000e2001",
      title: "Drawer bins, 42 mm grid",
      stage: "building",
      twistId: SEED_TWIST_IDS.bins,
    },
  });
  if (bins.status() === 400 || bins.status() === 404) return;
  if (!bins.ok()) throw new Error(`Seeding the twist's build failed: ${bins.status()} ${await bins.text()}`);
  await alex.post("/api/items/5eed0000-0000-4000-8000-0000000e2001/attempts", {
    headers: { Origin: origin },
    data: {
      id: "5eed0000-0000-4000-8000-0000000e2002",
      outcome: "success",
      note: "Lid snaps shut at +0.2. Six in the drawer.",
    },
  });
}
