/**
 * Builds with real-feeling histories for screenshots: some seed ideas grow
 * into builds and get print attempts, including a proud spaghetti failure,
 * one printing right now, two finished and one on the shelf. Everything goes
 * through the real API; only the dates the API sets itself (when a build
 * started and finished, when an attempt got its outcome) are backdated in
 * D1 afterwards, so the timeline reads like days of work.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { APIRequestContext, Browser } from "@playwright/test";
import type { AttemptSettings, Outcome } from "../../src/shared/attempts.ts";
import { executeSql, root } from "../lib/wrangler.ts";
import { type PhotoVariant, render, SEED_IDS } from "./ideas.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type By = "alex" | "sam";

interface SeedPhoto extends PhotoVariant {
  file: string;
  color: string;
}

interface SeedAttempt {
  id: string;
  by: By;
  /** When it printed. */
  ago: number;
  /** null: printing now. */
  outcome: Outcome | null;
  /** How long after printing the outcome was given. */
  finishedAfter?: number;
  note?: string;
  failureTags?: string[];
  successNotes?: string[];
  settings: AttemptSettings;
  photos?: SeedPhoto[];
}

interface SeedBuild {
  id: string;
  by: By;
  stage: "building" | "done" | "shelved";
  startedAgo: number;
  finishedAgo?: number;
  attempts: SeedAttempt[];
}

/** Stable ids, so screenshots can open a build or an attempt. */
export const SEED_BUILD_IDS = {
  tugboat: SEED_IDS.tugboat,
  headphoneStand: SEED_IDS.headphoneStand,
  tugboatSpaghetti: "5eed0000-0000-4000-8000-0000000a0001",
};

const yellowPla = { type: "PLA", brand: "Bambu", colorHex: "#f2c230", colorName: "Sunflower yellow", amsSlot: "A2" };
const tugboatBase: AttemptSettings = {
  filaments: [yellowPla, { type: "PLA", brand: "Bambu", colorHex: "#f4f1ea", colorName: "Jade white", amsSlot: "A1" }],
  bedType: "Smooth PEI Plate",
  nozzle: "main",
  nozzleDiameter: 0.4,
  layerHeight: 0.2,
  infillDensity: 15,
  processPreset: "0.20mm Standard @BBL X2D",
  nozzleTemperature: 220,
  bedTemperature: 55,
};

const charcoal = { type: "PLA", brand: "Bambu", colorHex: "#3b3a38", colorName: "Charcoal matte", amsSlot: "B1" };
const standBase: AttemptSettings = {
  filaments: [charcoal],
  bedType: "Textured PEI Plate",
  nozzle: "main",
  nozzleDiameter: 0.4,
  layerHeight: 0.2,
  infillDensity: 15,
  supportEnabled: true,
  supportType: "tree",
  processPreset: "0.20mm Standard @BBL X2D",
  nozzleTemperature: 220,
  bedTemperature: 55,
};

export const SEED_BUILDS: SeedBuild[] = [
  {
    id: SEED_IDS.tugboat,
    by: "alex",
    stage: "building",
    startedAgo: 2 * DAY + 4 * HOUR,
    attempts: [
      {
        id: SEED_BUILD_IDS.tugboatSpaghetti,
        by: "alex",
        ago: 2 * DAY + 3 * HOUR,
        outcome: "failed",
        finishedAfter: 3 * HOUR,
        note: "The hull let go of the plate halfway and the AMS kept feeding. A proud nest.",
        failureTags: ["spaghetti", "bed-adhesion"],
        settings: { ...tugboatBase, failedAtPercent: 46, estimatedMinutes: 185, weightGrams: 64 },
        photos: [{ file: "spaghetti-fail.svg", color: "#777065" }],
      },
      {
        id: "5eed0000-0000-4000-8000-0000000a0002",
        by: "sam",
        ago: DAY + 2 * HOUR,
        outcome: "partial",
        finishedAfter: 3 * HOUR + 20 * MIN,
        note: "Stayed down this time, but the stern corners curled up a few millimetres.",
        failureTags: ["warping"],
        successNotes: ["great-first-layer"],
        settings: {
          ...tugboatBase,
          bedType: "Textured PEI Plate",
          bedTemperature: 60,
          brim: true,
          estimatedMinutes: 190,
          actualMinutes: 197,
          weightGrams: 66,
        },
        photos: [
          {
            file: "tugboat.svg",
            color: "#867362",
            crop: [300, 250, 640, 480],
            filter: "saturate(0.9) brightness(0.96)",
          },
          { file: "tugboat.svg", color: "#867362", crop: [520, 380, 480, 360], filter: "contrast(1.05)" },
        ],
      },
      {
        id: "5eed0000-0000-4000-8000-0000000a0003",
        by: "alex",
        ago: 52 * MIN,
        outcome: null,
        settings: {
          ...tugboatBase,
          bedType: "Textured PEI Plate",
          bedTemperature: 65,
          chamberTemperature: 35,
          brim: true,
          filamentDried: true,
          estimatedMinutes: 190,
        },
      },
    ],
  },
  {
    id: SEED_IDS.headphoneStand,
    by: "sam",
    stage: "done",
    startedAgo: 5 * DAY + 2 * HOUR,
    finishedAgo: 3 * HOUR,
    attempts: [
      {
        id: "5eed0000-0000-4000-8000-0000000b0001",
        by: "sam",
        ago: 5 * DAY,
        outcome: "failed",
        finishedAfter: 2 * HOUR,
        note: "Came loose at the base and turned into a bird's nest around the nozzle.",
        failureTags: ["spaghetti", "bed-adhesion"],
        settings: { ...standBase, failedAtLayer: 112, estimatedMinutes: 260 },
        photos: [
          {
            file: "spaghetti-fail.svg",
            color: "#6f6860",
            crop: [240, 320, 800, 600],
            filter: "hue-rotate(-8deg) brightness(0.92)",
          },
        ],
      },
      {
        id: "5eed0000-0000-4000-8000-0000000b0002",
        by: "alex",
        ago: 3 * DAY + 5 * HOUR,
        outcome: "partial",
        finishedAfter: 4 * HOUR,
        note: "Layer shift at the hook, about two thirds up. Base is perfect now.",
        failureTags: ["layer-shift"],
        successNotes: ["great-first-layer"],
        settings: {
          ...standBase,
          infillDensity: 20,
          bedTemperature: 60,
          brim: true,
          failedAtPercent: 68,
          estimatedMinutes: 265,
          weightGrams: 118,
        },
        photos: [
          { file: "headphone-stand.svg", color: "#98846c", crop: [120, 150, 600, 800], filter: "brightness(0.95)" },
        ],
      },
      {
        id: "5eed0000-0000-4000-8000-0000000b0003",
        by: "sam",
        ago: 8 * HOUR,
        outcome: "success",
        finishedAfter: 4 * HOUR + 30 * MIN,
        note: "Clean all the way up, and the brim peeled right off.",
        successNotes: ["great-first-layer", "clean-supports", "settings-worth-reusing"],
        settings: {
          ...standBase,
          infillDensity: 20,
          bedTemperature: 60,
          brim: true,
          processPreset: "0.20mm Silent @BBL X2D",
          filamentDried: true,
          estimatedMinutes: 290,
          actualMinutes: 284,
          weightGrams: 121,
        },
        photos: [
          { file: "headphone-stand.svg", color: "#98846c" },
          { file: "headphone-stand.svg", color: "#98846c", crop: [150, 380, 600, 480], filter: "brightness(1.04)" },
        ],
      },
    ],
  },
  {
    id: SEED_IDS.desiccantHook,
    by: "sam",
    stage: "building",
    startedAgo: 3 * DAY,
    attempts: [
      {
        id: "5eed0000-0000-4000-8000-0000000c0001",
        by: "sam",
        ago: 2 * DAY + 20 * HOUR,
        outcome: "partial",
        finishedAfter: 40 * MIN,
        note: "Too tight on the AMS lip. Scale the slot up by 0.3 mm.",
        failureTags: ["other"],
        settings: {
          filaments: [{ type: "PETG", brand: "Bambu", colorHex: "#2f6f9f", colorName: "Blue", amsSlot: "A4" }],
          bedType: "Textured PEI Plate",
          layerHeight: 0.2,
          infillDensity: 25,
          nozzleTemperature: 250,
          bedTemperature: 70,
          estimatedMinutes: 36,
        },
        photos: [{ file: "ams-hook.svg", color: "#c3ab8e", crop: [250, 150, 700, 525], filter: "saturate(0.85)" }],
      },
      {
        id: "5eed0000-0000-4000-8000-0000000c0002",
        by: "sam",
        ago: 2 * DAY + 2 * HOUR,
        outcome: "success",
        finishedAfter: 45 * MIN,
        note: "Clicks on and holds the bag. Print two more for the other side.",
        successNotes: ["strong-and-tight-fit", "would-print-again"],
        settings: {
          filaments: [{ type: "PETG", brand: "Bambu", colorHex: "#2f6f9f", colorName: "Blue", amsSlot: "A4" }],
          bedType: "Textured PEI Plate",
          layerHeight: 0.2,
          infillDensity: 25,
          nozzleTemperature: 250,
          bedTemperature: 70,
          estimatedMinutes: 37,
          actualMinutes: 38,
        },
        photos: [{ file: "ams-hook.svg", color: "#c3ab8e" }],
      },
    ],
  },
  {
    id: SEED_IDS.lithophane,
    by: "alex",
    stage: "done",
    startedAgo: 4 * DAY,
    finishedAgo: 3 * DAY + 12 * HOUR,
    attempts: [
      {
        id: "5eed0000-0000-4000-8000-0000000d0001",
        by: "alex",
        ago: 3 * DAY + 20 * HOUR,
        outcome: "success",
        finishedAfter: 7 * HOUR,
        note: "First try. 0.12 mm was worth the wait.",
        successNotes: ["nice-surface", "settings-worth-reusing"],
        settings: {
          filaments: [{ type: "PLA", brand: "Bambu", colorHex: "#f4f1ea", colorName: "Jade white", amsSlot: "A1" }],
          bedType: "Textured PEI Plate",
          layerHeight: 0.12,
          infillDensity: 100,
          processPreset: "0.12mm Fine @BBL X2D",
          nozzleTemperature: 215,
          bedTemperature: 55,
          estimatedMinutes: 410,
          actualMinutes: 418,
          weightGrams: 92,
        },
        photos: [{ file: "lithophane-lamp.svg", color: "#584230" }],
      },
    ],
  },
  {
    id: SEED_IDS.planter,
    by: "alex",
    stage: "shelved",
    startedAgo: 10 * DAY,
    finishedAgo: 8 * DAY,
    attempts: [
      {
        id: "5eed0000-0000-4000-8000-0000000e0001",
        by: "alex",
        ago: 9 * DAY,
        outcome: "partial",
        finishedAfter: 6 * HOUR,
        note: "Hairy all over and the reservoir weeps. Shelved until the new spool comes.",
        failureTags: ["stringing", "wet-filament"],
        settings: {
          filaments: [{ type: "PLA", brand: "Polymaker", colorHex: "#b5603c", colorName: "Terracotta" }],
          bedType: "Textured PEI Plate",
          layerHeight: 0.2,
          infillDensity: 15,
          nozzleTemperature: 225,
          bedTemperature: 55,
          estimatedMinutes: 340,
          weightGrams: 140,
        },
        photos: [{ file: "planter-self-watering.svg", color: "#c7c0af", crop: [100, 260, 700, 700] }],
      },
    ],
  },
];

/** Logs the attempts through the API, then backdates the dates the API sets to "now". */
export async function seedBuilds(
  browser: Browser,
  requests: Record<By, APIRequestContext>,
  origin: string,
  stateDir: string,
) {
  const now = Date.now();
  const headers = { Origin: origin };
  const sql: string[] = [];
  for (const build of SEED_BUILDS) {
    for (const attempt of build.attempts) {
      const request = requests[attempt.by];
      const created = await request.post(`/api/items/${build.id}/attempts`, {
        headers,
        data: {
          id: attempt.id,
          outcome: attempt.outcome,
          printedAt: now - attempt.ago,
          note: attempt.note ?? "",
          failureTags: attempt.failureTags ?? [],
          successNotes: attempt.successNotes ?? [],
          settings: attempt.settings,
        },
      });
      if (!created.ok()) throw new Error(`Seeding attempt ${attempt.id} failed: ${created.status()}`);
      for (const photo of attempt.photos ?? []) {
        const svg = readFileSync(join(root, "scripts/seed/photos", photo.file), "utf8");
        const large = await render(browser, svg, 1600, photo);
        const thumb = await render(browser, svg, 600, photo);
        const uploaded = await request.put(`/api/items/${build.id}/photos/${crypto.randomUUID()}`, {
          headers,
          multipart: {
            width: String(large.width),
            height: String(large.height),
            color: photo.color,
            attemptId: attempt.id,
            large: { name: "large.jpg", mimeType: "image/jpeg", buffer: large.jpeg },
            thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: thumb.jpeg },
          },
        });
        if (!uploaded.ok()) throw new Error(`Uploading ${photo.file} failed: ${uploaded.status()}`);
      }
      if (attempt.outcome) {
        const finished = now - attempt.ago + (attempt.finishedAfter ?? HOUR);
        sql.push(
          `UPDATE attempts SET finished_at = ${finished}, created_at = ${now - attempt.ago} WHERE id = '${attempt.id}';`,
        );
        sql.push(`UPDATE photos SET created_at = ${finished} WHERE attempt_id = '${attempt.id}';`);
      } else {
        sql.push(`UPDATE attempts SET created_at = ${now - attempt.ago} WHERE id = '${attempt.id}';`);
      }
    }
    if (build.stage !== "building") {
      // The final photo: the newest photo of the last attempt that worked, as finishing picks it.
      const response = await requests[build.by].get(`/api/items/${build.id}`);
      const { item } = (await response.json()) as {
        item: {
          photos: Array<{ id: string; attemptId: string | null }>;
          attempts: Array<{ id: string; outcome: string }>;
        };
      };
      const worked = [...item.attempts].reverse().find((attempt) => attempt.outcome === "success");
      const cover = worked ? item.photos.filter((photo) => photo.attemptId === worked.id)[0] : undefined;
      const patched = await requests[build.by].patch(`/api/items/${build.id}`, {
        headers,
        data: { stage: build.stage, ...(build.stage === "done" && cover ? { coverPhotoId: cover.id } : {}) },
      });
      if (!patched.ok()) throw new Error(`Finishing ${build.id} failed: ${patched.status()}`);
    }
    const finished = build.finishedAgo === undefined ? "NULL" : String(now - build.finishedAgo);
    sql.push(
      `UPDATE items SET started_at = ${now - build.startedAgo}, finished_at = ${finished} WHERE id = '${build.id}';`,
    );
  }
  // The ideas' own photos date from when the idea was captured.
  sql.push(
    "UPDATE photos SET created_at = (SELECT created_at FROM items WHERE items.id = photos.item_id) WHERE attempt_id IS NULL;",
  );
  executeSql(sql.join("\n"), { persistTo: stateDir });
}
