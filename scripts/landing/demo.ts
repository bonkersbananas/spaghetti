/**
 * What the landing page's app screenshots show, in one place (docs/landing.md says how to change it). pnpm
 * landing:shots seeds the app with the screenshot seed (scripts/seed: ideas, the pantry, builds with histories), then
 * makes it look like the real thing with what is listed here:
 *
 *   - PEOPLE: the two people, M and CO, with their pictures, in place of the seed's Alex and Sam.
 *   - STAND_INS: real photos of prints in place of some of the seed's drawings, cut to each drawing's frame.
 *   - ADDITIONS, ATTEMPT_PHOTOS and RENAMES: ideas and photos added and things renamed, so the photos and the words
 *     agree.
 *   - SHOTS: which screens are taken, on a phone and on a laptop.
 *
 * Only the app's screenshots show the people; the page's own words say what happened, not who. Photos live in
 * scripts/landing/photos, the people's pictures in scripts/landing/people. Nothing else here is real data: the app
 * runs on a throwaway database (the general screenshot seed, pnpm screenshots, keeps its Alex and Sam), and the
 * photos are the mock-ups made for the landing page.
 */
import type { Page } from "@playwright/test";
import type { PersonColor } from "../../src/shared/people.ts";
import type { SEED_USERS } from "../lib/local-app.ts";
import { root } from "../lib/wrangler.ts";
import { shots as appShots } from "../screenshot-routes.ts";
import { SEED_BUILD_IDS } from "../seed/builds.ts";
import { SEED_IDS } from "../seed/ideas.ts";

export const LANDING_DIR = `${root}/scripts/landing`;

/** One of the seed's two people (SEED_USERS: alex, sam). */
export type SeedPerson = (typeof SEED_USERS)[number]["username"];

/** Who the shots are taken as. */
export const SIGNED_IN: SeedPerson = "alex";

export interface DemoPerson {
  /** The name the app shows: on avatars, "Say something to …", "…'s wishlist". */
  name: string;
  color: PersonColor;
  /** A picture in scripts/landing/people (any size; it is cut square and made 512 px, as the app does). */
  picture: string;
}

/** The two people, as the app's screenshots show them, by the seed person each one stands in for. */
export const PEOPLE: Record<SeedPerson, DemoPerson> = {
  alex: { name: "CO", color: "plum", picture: "co.png" },
  sam: { name: "M", color: "tomato", picture: "m.png" },
};

export interface StandIn {
  /** A photo in scripts/landing/photos. */
  photo: string;
  /** The part of it to use, in its pixels; it should have the drawing's shape (4:3, or 3:4 for portrait drawings). */
  crop: { left: number; top: number; width: number; height: number };
  /** Grow the photo upward by stretching its top rows this many pixels (a plain wall), when it is too wide for 3:4. */
  extendTop?: number;
}

/** Real photos in place of the seed's drawings (scripts/seed/photos), by drawing. Every place the seed uses the drawing gets the photo, with the seed's own crops on top. */
export const STAND_INS: Record<string, StandIn> = {
  "tugboat.svg": { photo: "tugboat.jpg", crop: { left: 150, top: 0, width: 745, height: 559 } },
  "spaghetti-fail.svg": { photo: "spaghetti.jpg", crop: { left: 512, top: 150, width: 512, height: 384 } },
  "drawer-organizer.svg": { photo: "organizer.jpg", crop: { left: 0, top: 0, width: 1024, height: 768 } },
  "headphone-stand.svg": {
    photo: "laptop-stand.jpg",
    crop: { left: 250, top: 0, width: 560, height: 559 },
    extendTop: 188,
  },
};

export interface Addition {
  /** Who captured it. */
  by: SeedPerson;
  title?: string;
  note?: string;
  /** How long before the seed's "now" it was captured, in minutes. */
  minutesAgo: number;
  photo: { file: string; crop: { left: number; top: number; width: number; height: number }; color: string };
}

/** Ideas added to the seed. */
export const ADDITIONS: Addition[] = [
  {
    by: "sam",
    title: "Octopus for the desk",
    note: "Pink silk PLA. The curls on the legs need a slower outer wall.",
    minutesAgo: 40,
    photo: { file: "octopus.jpg", crop: { left: 230, top: 0, width: 960, height: 720 }, color: "#c98a86" },
  },
];

export interface AttemptPhoto {
  /** The build and its attempt, by id (SEED_BUILD_IDS in scripts/seed/builds.ts). */
  itemId: string;
  attemptId: string;
  /** Who took it. */
  by: SeedPerson;
  photo: Addition["photo"];
  /** Settings changed on the attempt so its words agree with the photo (the filament, say). */
  settings?: Record<string, unknown>;
}

/** Photos added to the seed's attempts. */
export const ATTEMPT_PHOTOS: AttemptPhoto[] = [
  // The print on the bed (Today, the journal, the sidebar), which the seed shows with its slicer preview.
  {
    itemId: SEED_BUILD_IDS.towelHook,
    attemptId: SEED_BUILD_IDS.towelHookAttempt,
    by: "sam",
    photo: { file: "organizer-printing.jpg", crop: { left: 0, top: 0, width: 1024, height: 768 }, color: "#4f4a45" },
    settings: { filaments: [{ type: "PLA", brand: "Bambu", colorHex: "#ee7b2c", colorName: "Orange" }] },
  },
];

/** Seed items renamed to match their stand-in or added photo, by id. */
export const RENAMES: Record<string, { title: string; note?: string }> = {
  [SEED_IDS.headphoneStand]: {
    title: "Laptop stand",
    note: "Charcoal matte PLA, with holes so it stays light. Rubber feet underneath.",
  },
  [SEED_BUILD_IDS.towelHook]: { title: "Drawer front", note: "The orange fronts for the drawer box." },
};

export type Device = "phone" | "laptop";

export interface LandingShot {
  /** The file: screenshots/landing/<name>.png, and the pictures made from it (scripts/landing/pictures.ts). */
  name: string;
  device: Device;
  path: string;
  /** Reach the state to show (a sheet open, a search typed). */
  prepare?: (page: Page) => Promise<void>;
}

/** A shot of `pnpm screenshots` (scripts/screenshot-routes.ts), reused as it is. */
function reuse(name: string, device: Device, as = `${device}-${name}`): LandingShot {
  const shot = appShots.find((s) => s.name === name);
  if (!shot) throw new Error(`No screen called ${name} in scripts/screenshot-routes.ts`);
  return { name: as, device, path: shot.path, prepare: shot.prepare };
}

/** The capture sheet with a photo picked and a note typed, the moment before Save. */
const capturing = async (page: Page) => {
  await page.getByRole("button", { name: "New idea" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await page.getByTestId("photo-input").setInputFiles(`${LANDING_DIR}/photos/organizer.jpg`);
  await sheet.getByRole("textbox", { name: "Note" }).fill("Drawer box with bins for the M3 screws. Orange fronts?");
  await sheet.getByRole("button", { name: "Remove Photo 1" }).waitFor();
  await page.waitForTimeout(400);
  await sheet.getByRole("textbox", { name: "Note" }).blur();
};

/** The screens to take: phones at 390 × 844 (3x, as the Home Screen app on an iPhone), laptops at 1440 × 900 (2x). */
export const SHOTS: LandingShot[] = [
  { name: "phone-today", device: "phone", path: "/today" },
  { name: "phone-ideas", device: "phone", path: "/ideas" },
  { name: "phone-capture", device: "phone", path: "/ideas", prepare: capturing },
  reuse("attempt", "phone"),
  { name: "phone-build", device: "phone", path: `/builds/${SEED_IDS.tugboat}` },
  { name: "phone-journal", device: "phone", path: "/journal" },
  reuse("search-results", "phone", "phone-search"),
  { name: "phone-pantry", device: "phone", path: "/pantry" },
  { name: "laptop-build", device: "laptop", path: `/builds/${SEED_IDS.tugboat}` },
  { name: "laptop-ideas", device: "laptop", path: "/ideas" },
  { name: "laptop-today", device: "laptop", path: "/today" },
  { name: "laptop-journal", device: "laptop", path: "/journal" },
  reuse("search-results", "laptop", "laptop-search"),
  { name: "laptop-pantry", device: "laptop", path: "/pantry" },
  reuse("what-worked", "laptop"),
];
