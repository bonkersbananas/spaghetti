/**
 * pnpm landing:shots — the pictures on the landing page (landing.html, src/landing), made from the app itself and
 * from the photos in scripts/landing. Run it when the app's screens change, or after changing what the demo shows
 * (scripts/landing/demo.ts: the photos in place of the seed's drawings, what is added, the screens). It rewrites
 * src/landing/images, which is committed. docs/landing.md has the details.
 *
 *   pnpm landing:shots            # screenshots of the app, then every picture
 *   pnpm landing:shots --pictures # only the pictures, from the screenshots already in screenshots/landing
 *
 * 1. Screenshots: the app on the screenshot seed (the same fake data as pnpm screenshots, on a throwaway database),
 *    dressed up by scripts/landing/demo.ts, light theme, into screenshots/landing (gitignored).
 * 2. Pictures (scripts/landing/pictures.ts): photos cropped and warmed to the page, app screens set into photos of a
 *    laptop, the share image; AVIF at a few widths plus one WebP each, into src/landing/images.
 *
 * Needs the Playwright browser (pnpm exec playwright install chromium-headless-shell); sharp (a dev dependency) does
 * the cropping and encoding.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, type BrowserContext, chromium, request } from "@playwright/test";
import sharp from "sharp";
import {
  ADDITIONS,
  type Addition,
  ATTEMPT_PHOTOS,
  type DemoPerson,
  LANDING_DIR,
  type LandingShot,
  PEOPLE,
  RENAMES,
  type SeedPerson,
  SHOTS,
  SIGNED_IN,
  STAND_INS,
} from "./landing/demo.ts";
import { makePictures } from "./landing/pictures.ts";
import { launchOptions } from "./lib/browser.ts";
import { simulateIphone } from "./lib/iphone.ts";
import { SEED_PASSWORD, SEED_USERS } from "./lib/local-app.ts";
import { startSeededApp } from "./lib/seeded-app.ts";
import { executeSql, root } from "./lib/wrangler.ts";
import { SEED_LOCALE, SEED_NOW } from "./seed/index.ts";
import { replaceSeedPhotos } from "./seed/stand-ins.ts";

export const SHOTS_DIR = join(root, "screenshots/landing");

const DEVICES = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  laptop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
} as const;

/** The stand-in photos, cut to their drawings' frames, handed to the seed before it runs. */
async function standIns(dir: string) {
  mkdirSync(dir, { recursive: true });
  const replacements: Record<string, string> = {};
  for (const [drawing, { photo, crop, extendTop = 0 }] of Object.entries(STAND_INS)) {
    const source = join(LANDING_DIR, "photos", photo);
    const file = join(dir, drawing.replace(/\.svg$/, ".jpg"));
    const cut = await sharp(source).extract(crop).toBuffer();
    if (extendTop) {
      const wall = await sharp(source)
        .extract({ ...crop, height: 24 })
        .resize(crop.width, extendTop, { fit: "fill" })
        .toBuffer();
      await sharp({ create: { width: crop.width, height: crop.height + extendTop, channels: 3, background: "#fff" } })
        .composite([
          { input: wall, top: 0, left: 0 },
          { input: cut, top: extendTop, left: 0 },
        ])
        .jpeg({ quality: 92 })
        .toFile(file);
    } else {
      await sharp(cut).jpeg({ quality: 92 }).toFile(file);
    }
    replacements[drawing] = file;
  }
  replaceSeedPhotos(replacements);
}

async function signedIn(origin: string, username: string): Promise<APIRequestContext> {
  const context = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: origin } });
  const response = await context.post("/api/session", { data: { username, password: SEED_PASSWORD } });
  if (!response.ok()) throw new Error(`Signing in ${username} failed: ${response.status()}`);
  return context;
}

/** A photo of an idea or build (or of one of its attempts), cut and resized as the browser would. */
async function uploadPhoto(as: APIRequestContext, itemId: string, photo: Addition["photo"], attemptId?: string) {
  const image = sharp(join(LANDING_DIR, "photos", photo.file)).extract(photo.crop);
  const large = await image.clone().resize(1600).jpeg({ quality: 86 }).toBuffer();
  const thumb = await image.clone().resize(600).jpeg({ quality: 82 }).toBuffer();
  const { width = 1600, height = 1200 } = await sharp(large).metadata();
  const uploaded = await as.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    multipart: {
      width: String(width),
      height: String(height),
      color: photo.color,
      position: "0",
      ...(attemptId ? { attemptId } : {}),
      large: { name: "large.jpg", mimeType: "image/jpeg", buffer: large },
      thumb: { name: "thumb.jpg", mimeType: "image/jpeg", buffer: thumb },
    },
  });
  if (!uploaded.ok()) throw new Error(`Adding ${photo.file} failed: ${uploaded.status()}`);
}

/** The demo's people, additions and renames, on top of the seed (scripts/landing/demo.ts). */
async function dressUp(origin: string, stateDir: string) {
  const people = Object.fromEntries(
    await Promise.all(SEED_USERS.map(async ({ username }) => [username, await signedIn(origin, username)] as const)),
  ) as Record<SeedPerson, APIRequestContext>;
  try {
    // The seed's Alex and Sam become the two people: their names and colours (there is no route to rename someone),
    // and their pictures, uploaded as the app's own Account sheet does.
    for (const [username, person] of Object.entries(PEOPLE) as [SeedPerson, DemoPerson][]) {
      const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
      executeSql(
        `UPDATE users SET name = ${quoted(person.name)}, color = ${quoted(person.color)} WHERE username = ${quoted(username)};`,
        { persistTo: stateDir },
      );
      const picture = await sharp(join(LANDING_DIR, "people", person.picture))
        .resize(512, 512, { fit: "cover" })
        .jpeg({ quality: 88 })
        .toBuffer();
      const uploaded = await people[username].put("/api/people/me/photo", {
        multipart: { photo: { name: "picture.jpg", mimeType: "image/jpeg", buffer: picture } },
      });
      if (!uploaded.ok()) throw new Error(`The picture of ${person.name} failed: ${uploaded.status()}`);
    }
    for (const addition of ADDITIONS) {
      const as = people[addition.by];
      const id = crypto.randomUUID();
      const created = await as.post("/api/items", {
        data: {
          id,
          title: addition.title ?? null,
          note: addition.note ?? "",
          createdAt: SEED_NOW - addition.minutesAgo * 60_000,
        },
      });
      if (!created.ok()) throw new Error(`Adding ${addition.title ?? addition.note} failed: ${created.status()}`);
      await uploadPhoto(as, id, addition.photo);
    }
    for (const added of ATTEMPT_PHOTOS) {
      const as = people[added.by];
      await uploadPhoto(as, added.itemId, added.photo, added.attemptId);
      if (added.settings) {
        const changed = await as.patch(`/api/attempts/${added.attemptId}`, {
          data: { settingsMerge: { set: added.settings } },
        });
        if (!changed.ok()) throw new Error(`Changing attempt ${added.attemptId} failed: ${changed.status()}`);
      }
    }
    for (const [id, data] of Object.entries(RENAMES)) {
      const renamed = await people[SIGNED_IN].patch(`/api/items/${id}`, { data });
      if (!renamed.ok()) throw new Error(`Renaming ${id} failed: ${renamed.status()}`);
    }
  } finally {
    await Promise.all(Object.values(people).map((context) => context.dispose()));
  }
}

async function takeShots() {
  mkdirSync(SHOTS_DIR, { recursive: true });
  await standIns(join(SHOTS_DIR, "stand-ins"));
  const port = 5280 + Math.floor(Math.random() * 100);
  const app = await startSeededApp({ port, now: SEED_NOW, log: (message) => console.log(`  ${message}`) });
  const browser = await chromium.launch(launchOptions());
  const failures: string[] = [];
  try {
    console.log("  dressing up the seed (scripts/landing/demo.ts)…");
    await dressUp(app.url, app.stateDir);
    for (const device of ["phone", "laptop"] as const) {
      const context = await browser.newContext({
        ...DEVICES[device],
        ...SEED_LOCALE,
        baseURL: app.url,
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      context.setDefaultTimeout(20_000);
      if (device === "phone") await simulateIphone(context);
      await context.clock.setFixedTime(SEED_NOW);
      const response = await context.request.post("/api/session", {
        data: { username: SIGNED_IN, password: SEED_PASSWORD },
        headers: { Origin: app.url },
      });
      if (!response.ok()) throw new Error(`Signing in failed: ${response.status()}`);
      for (const shot of SHOTS.filter((s) => s.device === device)) {
        try {
          await shoot(context, shot);
          console.log(`  ${shot.name}.png`);
        } catch (error) {
          const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
          failures.push(`${shot.name}: ${message}`);
          console.error(`  ✗ ${shot.name}: ${message}`);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    app.stop();
  }
  if (failures.length) throw new Error(`${failures.length} shots failed:\n${failures.join("\n")}`);
}

async function shoot(context: BrowserContext, shot: LandingShot) {
  const page = await context.newPage();
  try {
    await page.goto(shot.path, { waitUntil: "networkidle" });
    await page.locator("h1").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot.prepare?.(page);
    await page.evaluate(async () => {
      const images = Array.from(document.images);
      for (const image of images) image.loading = "eager";
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
    });
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish();
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(SHOTS_DIR, `${shot.name}.png`) });
  } finally {
    await page.close();
  }
}

if (!process.argv.includes("--pictures")) await takeShots();
await makePictures(SHOTS_DIR);
