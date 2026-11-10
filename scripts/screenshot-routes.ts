import type { Page } from "@playwright/test";
import { SLICER_FILE_NAME, slicerFile } from "../e2e/fixtures/slicer-file.ts";
import { SEED_BUILD_IDS } from "./seed/builds.ts";
import { SEED_IDS } from "./seed/ideas.ts";
import { SEED_SPOOL_IDS } from "./seed/pantry.ts";

export interface Shot {
  /** File name, without width or extension: "ideas" → ideas-390.png. */
  name: string;
  path: string;
  /** Take it signed out (sign-in screen). */
  signedOut?: boolean;
  /** Only this element (a CSS selector), scrolled into view. */
  selector?: string;
  /** The whole scrollable page, not just the viewport. */
  fullPage?: boolean;
  /** Only at this width, for screens that exist on one layout. */
  width?: 390 | 1440;
  /** Runs after the page loads, to open a sheet or reach a state. */
  prepare?: (page: Page) => Promise<void>;
  /** Runs after every image has loaded, right before the screenshot. */
  beforeShot?: (page: Page) => Promise<void>;
  /** Runs after the screenshot, to undo what prepare changed for the next width. */
  cleanup?: (page: Page) => Promise<void>;
}

/**
 * The screens `pnpm screenshots` captures, at 390×844 and 1440×900.
 * Add your feature's screens here.
 */
export const shots: Shot[] = [
  { name: "sign-in", path: "/sign-in", signedOut: true },
  { name: "ideas", path: "/ideas" },
  { name: "builds", path: "/builds", fullPage: true },
  { name: "build", path: `/builds/${SEED_BUILD_IDS.tugboat}`, fullPage: true },
  {
    name: "attempt",
    path: `/builds/${SEED_IDS.desiccantHook}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("radio", { name: "Spaghetti" }).click();
      await sheet.getByRole("button", { name: "Bed adhesion" }).click();
      await sheet.getByRole("button", { name: "Warping" }).click();
      await sheet.getByRole("textbox", { name: "Note" }).fill("Corner lifted at layer 30, then it was all noodles.");
      await sheet.getByRole("textbox", { name: "Note" }).blur();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  { name: "build-done", path: `/builds/${SEED_BUILD_IDS.headphoneStand}`, fullPage: true },
  { name: "journal", path: "/journal" },
  {
    // Further back: a month that sums itself up, grouped by week.
    name: "journal-months",
    path: "/journal",
    prepare: async (page) => {
      // September is two months before the seed's date (SEED_NOW) and several
      // pages down: the journal loads a page when its end scrolls into view,
      // so scroll until the month is there rather than count on how many
      // entries fit a page.
      const heading = page.getByRole("heading", { level: 2, name: /September/ });
      for (let step = 0; step < 12 && !(await heading.isVisible()); step++) {
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(400);
      }
      await heading.waitFor();
      await heading.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -24));
    },
  },
  { name: "journal-failures", path: "/journal?outcome=failures" },
  { name: "search", path: "/search" },
  {
    name: "search-results",
    path: "/search?q=PETG%20warping",
    prepare: async (page) => {
      await page.getByRole("region", { name: "Attempts" }).waitFor();
      await page.getByRole("searchbox", { name: "Search" }).blur();
    },
  },
  {
    // "What worked last time" in the attempt sheet: PETG that warped, offered the PETG that didn't.
    name: "what-worked",
    path: `/builds/${SEED_BUILD_IDS.cableChain}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      const suggestion = page.getByRole("dialog").getByRole("region", { name: "What worked last time" });
      await suggestion.waitFor();
      await page.waitForTimeout(400);
      await suggestion.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "capture",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await page.getByTestId("photo-input").setInputFiles("e2e/fixtures/tugboat.jpg");
      await sheet.getByRole("textbox", { name: "Note" }).fill("Tugboat, take two: a flatter hull and a bigger funnel");
      await sheet.getByRole("button", { name: "Remove Photo 1" }).waitFor();
      await page.waitForTimeout(400);
      await sheet.getByRole("textbox", { name: "Note" }).blur();
    },
  },
  { name: "idea", path: `/ideas/${SEED_IDS.deskTidy}` },
  {
    name: "undo",
    path: "/ideas",
    prepare: async (page) => {
      await page.goto(`/ideas/${SEED_IDS.deskTidy}`);
      await page.getByRole("button", { name: "Delete idea" }).first().click();
      await page.getByText("Idea deleted").waitFor();
      await page.locator("h1").first().waitFor();
    },
    cleanup: async (page) => {
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByRole("link", { name: /Desk tidy-up/ }).waitFor();
    },
  },
  {
    name: "account",
    path: "/ideas",
    width: 390,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByRole("dialog").waitFor();
    },
  },
  {
    // The one quiet place that says there is no connection (needs the signed-in app open).
    name: "offline",
    path: "/ideas",
    // After the photos have loaded, so they are in the page when the connection goes.
    beforeShot: goOffline,
    cleanup: async (page) => {
      await page.context().setOffline(false);
    },
  },
  {
    // A build opened online, then read with no connection: what was last seen, marked as such and read-only,
    // with the one thing that is still possible at the printer, finishing the print.
    name: "offline-build",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    fullPage: true,
    beforeShot: goOffline,
    cleanup: async (page) => {
      await page.context().setOffline(false);
    },
  },
  {
    // The account sheet / menu, where the theme is chosen.
    name: "appearance",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("radio", { name: "System" }).waitFor();
    },
  },
  {
    // The command palette (⌘K, desktop): empty, with results, and with actions for the build on screen.
    name: "palette-empty",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      // Two things opened first, so "Recent" has something to show.
      await page.goto(`/ideas/${SEED_IDS.deskTidy}`);
      await page.locator("h1").first().waitFor();
      await page.goto(`/builds/${SEED_BUILD_IDS.headphoneStand}`);
      await page.locator("h1").first().waitFor();
      await page.goto("/ideas");
      await page.locator("h1").first().waitFor();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("option", { name: /^Headphone stand\b/ }).waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "palette-results",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("stand");
      await page.getByRole("option", { name: /^Headphone stand\b/ }).waitFor();
      await page.getByRole("group", { name: "Builds" }).waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "palette-build",
    path: `/builds/${SEED_BUILD_IDS.cableChain}`,
    width: 1440,
    prepare: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("option", { name: "Log attempt" }).waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "shortcuts",
    path: "/builds",
    width: 1440,
    prepare: async (page) => {
      await page.keyboard.press("?");
      await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  { name: "pantry", path: "/pantry", fullPage: true },
  {
    // The AMS loadout on its own, with a slot's sheet open (phones) or a slot being picked.
    name: "ams",
    path: "/pantry",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^A4 Blue/ }).click();
      await page.getByRole("dialog", { name: "Slot A4" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  { name: "spool", path: `/pantry/${SEED_SPOOL_IDS.silkGold}`, fullPage: true },
  { name: "spool-printed", path: `/pantry/${SEED_SPOOL_IDS.bambuGreen}`, fullPage: true },
  { name: "printer", path: "/printer", fullPage: true },
  {
    // A sliced file dropped on a build: which plate, then the attempt filled in from it.
    name: "attempt-file-plates",
    path: `/builds/${SEED_IDS.desiccantHook}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await page.getByTestId("slicer-file-input").setInputFiles({
        name: SLICER_FILE_NAME,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(slicerFile()),
      });
      await sheet.getByRole("region", { name: "Which plate?" }).waitFor();
      await sheet
        .getByRole("region", { name: "Which plate?" })
        .evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.reload();
    },
  },
  {
    name: "attempt-file",
    path: `/builds/${SEED_IDS.desiccantHook}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await page.getByTestId("slicer-file-input").setInputFiles({
        name: SLICER_FILE_NAME,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(slicerFile()),
      });
      await sheet.getByRole("button", { name: /Cable clips/ }).click();
      await sheet.getByLabel("Layer height").waitFor();
      await sheet.getByText(SLICER_FILE_NAME).evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.reload();
    },
  },
  {
    // An attempt printed from a slicer file, in the build's story: the plate, the file, estimate vs actual.
    name: "build-file",
    path: "/builds/5eed0000-0000-4000-8000-000000000101",
    fullPage: true,
  },
  { name: "styleguide", path: "/styleguide", fullPage: true },
  { name: "styleguide-color", path: "/styleguide", selector: "#color" },
  { name: "styleguide-palette", path: "/styleguide", selector: "#palette" },
  { name: "styleguide-cards", path: "/styleguide", selector: "#cards" },
];

/**
 * Goes offline the way a phone loses signal. On the built app (which has the
 * service worker) the page is reloaded too, so photos come from the worker's
 * cache and the data from the saved copy, as they would next to the printer.
 */
async function goOffline(page: Page) {
  await page.context().setOffline(true);
  if (await page.evaluate(() => !!navigator.serviceWorker?.controller)) {
    await page.reload({ waitUntil: "load" });
    await page.locator("h1").first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const broken = await page.evaluate(async () => {
      const images = Array.from(document.images);
      for (const image of images) image.loading = "eager";
      await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
      return images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src);
    });
    if (broken.length) throw new Error(`Offline screen has pictures that didn't load:\n${broken.join("\n")}`);
  }
  await page.getByRole("status").filter({ hasText: "Showing what you saw" }).waitFor();
}

/** On the tugboat build (attempt 3 is printing): open the finish sheet offline and fill it in. */
async function fillFinish(page: Page) {
  await goOffline(page);
  await page.getByRole("button", { name: "Finish attempt 3" }).first().click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "Worked" }).click();
  const note = sheet.getByRole("textbox", { name: "Note" });
  await note.press("End");
  await note.pressSequentially(" Came off clean.");
  await note.blur();
  return sheet;
}

// Last: the queued finish stays offline and unsent, so nothing after it would work.
shots.push(
  ...([
    {
      // The finish sheet, filled in with no signal.
      name: "offline-finish",
      path: `/builds/${SEED_BUILD_IDS.tugboat}`,
      beforeShot: async (page) => {
        await fillFinish(page);
      },
      cleanup: async (page) => {
        // Leave the page before the connection returns: a half-filled sheet would autosave its draft then.
        await page.goto("about:blank");
        await page.context().setOffline(false);
      },
    },
    {
      // After "Finish attempt": finished on this device, waiting to be sent. Last, and it stays offline, so it never reaches the server.
      name: "offline-finish-queued",
      path: `/builds/${SEED_BUILD_IDS.tugboat}`,
      fullPage: true,
      beforeShot: async (page) => {
        const sheet = await fillFinish(page);
        await sheet.getByRole("button", { name: "Finish attempt" }).click();
        await sheet.waitFor({ state: "hidden" });
        await page.getByRole("status").filter({ hasText: "finished print is waiting" }).waitFor();
      },
    },
  ] as Shot[]),
);
