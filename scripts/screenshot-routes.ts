import type { Page } from "@playwright/test";
import { SLICER_FILE_NAME, slicerFile } from "../e2e/fixtures/slicer-file.ts";
import { SEED_BUILD_IDS } from "./seed/builds.ts";
import { SEED_IDS } from "./seed/ideas.ts";
import { SEED_NOW } from "./seed/index.ts";
import { SEED_SPOOL_IDS } from "./seed/pantry.ts";

/** The spool that sat in A4 before the unknown-tray shot emptied it. */
let unknownTraySlot: string | null = null;

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

type Slice = "all" | "none" | "young";

/**
 * Shows Today with parts of the workspace missing, by answering the app's own requests with less: the ideas,
 * the builds, the journal and the spools it fetches. The real data stays in the database; unmockToday puts it back.
 */
async function mockToday(
  page: Page,
  show: { builds: Slice; journal: Slice; spools: Slice; ideas: Slice; late?: boolean; offBed?: boolean },
) {
  const DAY = 24 * 60 * 60 * 1000;
  await page.route(/\/api\/items\?stage=/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as {
      items: Array<{
        stage: string;
        createdAt: number;
        attempts?: Array<{ outcome: string | null; printedAt: number; endedAt?: number | null }>;
      }>;
    };
    // The printer says the towel hook's print stopped ten minutes ago: nobody has said how it went.
    if (show.offBed) {
      for (const item of json.items)
        for (const attempt of item.attempts ?? [])
          if (attempt.outcome === null && attempt.printedAt > SEED_NOW - 30 * 60 * 1000)
            attempt.endedAt = SEED_NOW - 10 * 60 * 1000;
    }
    // Prints on the bed started earlier, so they are due.
    if (show.late) {
      for (const item of json.items)
        for (const attempt of item.attempts ?? [])
          if (attempt.outcome === null) attempt.printedAt -= 4 * 60 * 60 * 1000;
    }
    const isIdeas = route.request().url().includes("stage=idea");
    const mode = isIdeas ? show.ideas : show.builds;
    const items =
      mode === "none"
        ? []
        : mode === "young"
          ? json.items.filter((item) => SEED_NOW - item.createdAt < 14 * DAY)
          : json.items;
    await route.fulfill({ response, json: { ...json, items } });
  });
  await page.route(/\/api\/journal\/summary/, (route) =>
    show.journal === "none"
      ? route.fulfill({ json: { summary: { prints: 0, worked: 0, partly: 0, spaghetti: 0, finished: [] } } })
      : route.continue(),
  );
  await page.route(/\/api\/journal\?/, (route) =>
    show.journal === "none" ? route.fulfill({ json: { entries: [], items: [], next: null } }) : route.continue(),
  );
  await page.route(/\/api\/spools$/, (route) =>
    show.spools === "none" ? route.fulfill({ json: { spools: [] } }) : route.continue(),
  );
  await page.route(/\/api\/printer$/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { slots: object };
    await route.fulfill({ response, json: show.spools === "none" ? { ...json, slots: {} } : json });
  });
  await page.reload({ waitUntil: "networkidle" });
}

/**
 * Waits for a heading, then lets the empty state around it finish easing in. Its entrance animation can stall at
 * "invisible" when it follows a full-page shot, so it is finished by hand rather than waited for.
 */
async function waitUntilEased(page: Page, title: string) {
  await page.getByRole("heading", { name: title }).waitFor();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await page.waitForTimeout(300);
}

async function unmockToday(page: Page) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

/**
 * The screens `pnpm screenshots` captures, at 390×844 and 1440×900.
 * Add your feature's screens here.
 */
export const shots: Shot[] = [
  { name: "sign-in", path: "/sign-in", signedOut: true },
  // Today: full (two prints, one that should be done by now), partly empty, quiet and brand new.
  { name: "today", path: "/today", fullPage: true },
  {
    // Both prints started four hours earlier than the seed says: past their estimates, so each asks how it went.
    // (The data is moved, not the browser's clock: jumping the clock back and forth stalls motion's animations.)
    name: "today-due",
    path: "/today",
    fullPage: true,
    prepare: async (page) => {
      await mockToday(page, { builds: "all", journal: "all", spools: "all", ideas: "all", late: true });
      await page.getByText("How did it go?").first().waitFor();
    },
    cleanup: unmockToday,
  },
  {
    // The bridge saw the towel hook's print stop: a calm question with three answers instead of a bar.
    name: "today-off-the-bed",
    path: "/today",
    fullPage: true,
    prepare: async (page) => {
      await mockToday(page, { builds: "all", journal: "all", spools: "all", ideas: "all", offBed: true });
      await page
        .getByText(/Off the bed at/)
        .first()
        .waitFor();
    },
    cleanup: unmockToday,
  },
  {
    // Nothing printing, no builds, nothing loaded: only the old idea left on the back burner.
    name: "today-partly-empty",
    path: "/today",
    fullPage: true,
    prepare: async (page) => {
      await mockToday(page, { builds: "none", journal: "none", spools: "none", ideas: "all" });
      await page.getByRole("heading", { name: "On the back burner" }).waitFor();
    },
    cleanup: unmockToday,
  },
  {
    // Only young ideas and nothing else: a quiet kitchen.
    name: "today-quiet",
    path: "/today",
    prepare: async (page) => {
      await mockToday(page, { builds: "none", journal: "none", spools: "none", ideas: "young" });
      await waitUntilEased(page, "All quiet in the kitchen");
    },
    cleanup: unmockToday,
  },
  {
    // A brand-new notebook.
    name: "today-empty",
    path: "/today",
    prepare: async (page) => {
      await mockToday(page, { builds: "none", journal: "none", spools: "none", ideas: "none" });
      await waitUntilEased(page, "Nothing on the stove yet");
    },
    cleanup: unmockToday,
  },
  // With a print running, the sidebar's card (hidden on Today) and the phone's four tabs around capture.
  {
    name: "sidebar-printing",
    path: "/ideas",
    width: 1440,
    selector: "aside",
    // The card arrives once the builds are fetched, and eases in.
    prepare: async (page) => {
      await page
        .getByRole("complementary")
        .getByRole("link", { name: /Towel hook/ })
        .waitFor();
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
  },
  { name: "tabbar", path: "/today", width: 390, selector: 'nav[aria-label="Sections"].fixed' },
  { name: "ideas", path: "/ideas" },
  { name: "builds", path: "/builds", fullPage: true },
  { name: "build", path: `/builds/${SEED_BUILD_IDS.tugboat}`, fullPage: true },
  {
    // A saved attempt open: the arrows in its header step to the attempt before and after.
    name: "attempt-step",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Attempt 2: .*Open$/ }).click({ position: { x: 6, y: 6 } });
      await page.getByRole("dialog", { name: "Attempt 2" }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
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
  // The print on the bed: its entry in the story, with the progress bar and how long is left.
  {
    name: "build-progress",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    selector: "li[data-attempt-id]:first-child",
    // High in the window, clear of the tab bar and the action bar.
    beforeShot: async (page) => {
      await page
        .locator("li[data-attempt-id]:first-child")
        .evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -90));
    },
  },
  {
    // Two attempts side by side: a column each on desktop, one photo under a switch on phones.
    name: "compare",
    path: `/builds/${SEED_BUILD_IDS.headphoneStand}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^(Changed since attempt \d+: .*)?Compare/ })
        .first()
        .click();
      await page.getByRole("dialog", { name: /^Attempt \d+ and attempt \d+$/ }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // A short 1280×720 laptop window: What changed may start just above the fold, never lower.
    name: "compare-laptop",
    path: `/builds/${SEED_BUILD_IDS.headphoneStand}`,
    width: 1440,
    prepare: async (page) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page
        .getByRole("button", { name: /^(Changed since attempt \d+: .*)?Compare/ })
        .first()
        .click();
      await page.getByRole("dialog", { name: /^Attempt \d+ and attempt \d+$/ }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 1440, height: 900 });
    },
  },
  {
    // The lower half of the comparison: what stayed the same (opened) and how each attempt went.
    name: "compare-details",
    path: `/builds/${SEED_BUILD_IDS.headphoneStand}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^(Changed since attempt \d+: .*)?Compare/ })
        .first()
        .click();
      const sheet = page.getByRole("dialog", { name: /^Attempt \d+ and attempt \d+$/ });
      await sheet.waitFor();
      await sheet.getByRole("button", { name: /^Same in both/ }).click();
      await sheet.getByText("Layers 0.20 mm").waitFor();
      await sheet.getByRole("region", { name: "How it went" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(4000);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // A print still on the bed can be compared: its Printing chip, and no results of its own yet.
    name: "compare-printing",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^(Changed since attempt \d+: .*)?Compare/ })
        .first()
        .click();
      await page.getByRole("dialog", { name: /^Attempt \d+ and attempt \d+$/ }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // Desktop: the attempt's name opens a list of every attempt; picking one swaps that column.
    name: "compare-pickers",
    path: `/builds/${SEED_BUILD_IDS.headphoneStand}`,
    width: 1440,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^(Changed since attempt \d+: .*)?Compare/ })
        .first()
        .click();
      const sheet = page.getByRole("dialog", { name: /^Attempt \d+ and attempt \d+$/ });
      await sheet.waitFor();
      await sheet
        .getByRole("button", { name: /^Attempt \d+$/ })
        .last()
        .click();
      await page.getByRole("dialog", { name: "Pick the attempt to compare" }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
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
  // The same idea in full: its note's link as a card under it.
  {
    name: "idea-links",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      const links = page.getByRole("list", { name: "Links in the note" });
      await links.getByText("Drawer bins, 42 mm grid").waitFor();
      await links.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
  },
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
      await page
        .getByRole("option", { name: /^Headphone stand\b/ })
        .first()
        .waitFor();
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
    // Desktop only: the pantry as a list (the choice is remembered per device, so cards come back after).
    name: "pantry-list",
    path: "/pantry",
    width: 1440,
    fullPage: true,
    prepare: async (page) => {
      await page.getByRole("radio", { name: "List" }).click();
      await page.getByRole("list", { name: "PLA spools" }).waitFor();
    },
    cleanup: async (page) => {
      await page.getByRole("radio", { name: "Cards" }).click();
    },
  },
  // The design system's own pages for the building blocks: print progress and the outcome strip, spool rims.
  { name: "styleguide-builds", path: "/styleguide", selector: "#builds" },
  { name: "styleguide-spools", path: "/styleguide", selector: "#pantry" },
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
  // A spool with no label photo: its hero is the disc itself (black, to check its rim in dark mode).
  { name: "spool-black", path: `/pantry/${SEED_SPOOL_IDS.black}` },
  // Counted in grams: the figure, "Weigh it", and what used it (the tugboat's attempts, a weighing).
  { name: "spool-grams", path: `/pantry/${SEED_SPOOL_IDS.sunflower}`, fullPage: true },
  {
    name: "spool-weigh",
    path: `/pantry/${SEED_SPOOL_IDS.sunflower}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Weigh it" }).click();
      const sheet = page.getByRole("dialog", { name: "Weigh it" });
      await sheet.getByLabel("On the scale").fill("812");
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  // The print on the bed needs more Sunflower yellow than the spool has left.
  {
    name: "not-enough",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    selector: "li[data-attempt-id]:first-child",
    beforeShot: async (page) => {
      await page.getByTestId("not-enough").waitFor();
      await page
        .locator("li[data-attempt-id]:first-child")
        .evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -90));
    },
  },
  { name: "spool-printed", path: `/pantry/${SEED_SPOOL_IDS.bambuGreen}`, fullPage: true },
  { name: "printer", path: "/printer", fullPage: true },
  // The printer bridge's states (docs/bridge.md): a print on the bed with the printer's own progress ...
  { name: "build-live-progress", path: `/builds/${SEED_BUILD_IDS.towelHook}`, fullPage: true },
  // ... a print that stopped and waits to hear how it went, on the build, in the builds list and the journal ...
  { name: "build-off-bed", path: `/builds/${SEED_BUILD_IDS.drawerDivider}`, fullPage: true },
  {
    name: "build-off-bed-sheet",
    path: `/builds/${SEED_BUILD_IDS.drawerDivider}`,
    prepare: async (page) => {
      await page.getByRole("radio", { name: "Spaghetti" }).first().click();
      await page.getByRole("dialog").getByText("suggested").first().waitFor();
    },
    // The sheet autosaves the outcome it opened with: put the attempt back off the bed for the shots after it.
    cleanup: async (page) => {
      await page.waitForTimeout(1500);
      await page.request.patch(`/api/attempts/${SEED_BUILD_IDS.drawerDividerAttempt}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { outcome: null, failureTags: [] },
      });
    },
  },
  {
    name: "journal-off-bed",
    path: "/journal",
    prepare: async (page) => {
      await page
        .getByText(/how did it go\?/)
        .first()
        .waitFor();
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("p"))
          .find((p) => /how did it go\?/.test(p.textContent ?? ""))
          ?.scrollIntoView({ block: "center" }),
      );
    },
  },
  // pnpm new route adds its screens above this line.
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
      // The settings open with an animation that changes the sheet's height: scroll once it has finished, or
      // where the sheet ends up depends on how far along it was (the shot came out differently from run to run).
      await page.waitForTimeout(900);
      await sheet
        .getByText(SLICER_FILE_NAME)
        .evaluate((element) => element.scrollIntoView({ block: "start", behavior: "instant" }));
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
  {
    name: "styleguide-today",
    path: "/styleguide",
    selector: "#today",
    prepare: async (page) => {
      await page.locator("#today img").first().waitFor({ state: "attached" });
    },
  },
  {
    name: "styleguide-journal",
    path: "/styleguide",
    selector: "#journal",
    // The samples' pictures are put in the preview cache once the section has fetched them.
    prepare: async (page) => {
      await page.locator("#journal img").first().waitFor({ state: "attached" });
    },
  },
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

// The bridge sees a spool in A4 that the pantry can't place. Late, because it empties the slot for the shot.
shots.push({
  name: "printer-unknown-tray",
  path: "/printer",
  fullPage: true,
  prepare: async (page) => {
    const origin = new URL(page.url()).origin;
    const before = await (await page.request.get("/api/printer")).json();
    unknownTraySlot = before.slots.A4;
    await page.request.put("/api/printer/slots/A4", { headers: { Origin: origin }, data: { spoolId: null } });
    await page.request.put("/api/printer/bridge", {
      headers: { Origin: origin },
      data: { unknownTrays: [{ slot: "A4", material: "PLA", colorHex: "#2c8a87", brand: null }] },
    });
    await page.reload();
    await page.locator('[data-slot="A4"][data-unknown]').waitFor();
  },
  cleanup: async (page) => {
    const origin = new URL(page.url()).origin;
    await page.request.put("/api/printer/slots/A4", {
      headers: { Origin: origin },
      data: { spoolId: unknownTraySlot },
    });
    await page.request.put("/api/printer/bridge", { headers: { Origin: origin }, data: { unknownTrays: [] } });
  },
});

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
