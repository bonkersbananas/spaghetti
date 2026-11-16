import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Locator, Page, Route } from "@playwright/test";
import {
  hotdogModel,
  makerworldProject,
  paintedProject,
  partsProject,
  platesProject,
  raftProject,
} from "../e2e/fixtures/model-3mf.ts";
import { boxesStl, boxStl, fusilliStl, glassesStl } from "../e2e/fixtures/model-stl.ts";
import { SLICER_FILE_NAME, slicerFile } from "../e2e/fixtures/slicer-file.ts";
import { SEED_AGENTS } from "./seed/agents.ts";
import { SEED_BUILD_IDS } from "./seed/builds.ts";
import { commentId } from "./seed/comments.ts";
import { SEED_IDS } from "./seed/ideas.ts";
import { SEED_NOW } from "./seed/index.ts";
import { SEED_SPOOL_IDS } from "./seed/pantry.ts";
import { gridfinityBin } from "./seed/stl-bin.ts";
import { SEED_TWIST_IDS } from "./seed/twists.ts";

/** The spool that sat in A4 before the unknown-tray shot emptied it. */
let unknownTraySlot: string | null = null;

/** Opens the Notifications sheet from the account menu (phone: account sheet; desktop: the sidebar's popover). */
async function openNotifications(page: Page, width: 390 | 1440) {
  if (width === 390) {
    await page.getByRole("button", { name: "Account" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Notifications/ })
      .click();
  } else {
    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Notifications" }).click();
  }
  await page.getByRole("dialog", { name: "Notifications" }).waitFor();
}

/** Opens the account sheet (phone) or the sidebar's account menu (desktop). */
async function openAccount(page: Page, width: 390 | 1440) {
  if (width === 390) await page.getByRole("button", { name: "Account" }).click();
  else await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("dialog").waitFor();
}

/** What the browser says about notifications, set before the sheet reads it (a screenshot browser always says "denied"). */
const withPermission = (page: Page, permission: NotificationPermission) =>
  page.evaluate(
    (value) => Object.defineProperty(Notification, "permission", { get: () => value, configurable: true }),
    permission,
  );

/** A device that already has notifications on: the server knows it, and the browser has a subscription (there is no service worker in a shot). */
async function subscribedDevice(page: Page) {
  const endpoint = "https://push.example/screenshot-device";
  const origin = new URL(page.url()).origin;
  await page.request.put("/api/push/subscription", {
    data: {
      endpoint,
      keys: {
        p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
        auth: "tBHItJI5svbpez7KI4CCXg",
      },
      timeZone: "UTC",
    },
    headers: { Origin: origin },
  });
  await page.evaluate((url) => {
    const subscription = { endpoint: url, unsubscribe: async () => true };
    Object.defineProperty(navigator.serviceWorker, "getRegistration", { value: async () => ({}), configurable: true });
    Object.defineProperty(navigator.serviceWorker, "ready", {
      get: () => Promise.resolve({ pushManager: { getSubscription: async () => subscription } }),
      configurable: true,
    });
  }, endpoint);
}

/** One row of the account menu (phone: account sheet; desktop: the sidebar's popover), by its text. */
async function openAccountRow(page: Page, width: 390 | 1440, row: string | RegExp) {
  await openAccount(page, width);
  await page.getByRole("dialog").getByRole("button", { name: row }).click();
}

/**
 * Answers the week page with what only the Worker's own clock can give: the shots' browser is set to the seed's
 * date, the Worker is not. Reloads so the page asks again with the route in place.
 */
const weekApi = /\/api\/weeks\/\d{4}-\d{2}-\d{2}$/;
async function withWeekMock(page: Page, mock: { waiting?: boolean; note?: boolean }) {
  await page.route(weekApi, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.week.current = true;
    if (mock.waiting) {
      body.week.waiting = {
        upNext: [
          { id: SEED_IDS.desiccantHook, title: "Desiccant hook" },
          { id: SEED_IDS.lithophane, title: "Lithophane" },
        ],
        failedLast: [{ id: SEED_BUILD_IDS.cableChain, title: "Cable chain" }],
        low: [{ id: SEED_SPOOL_IDS.sunflower, name: "Sunflower yellow", gramsLeft: 40 }],
        upkeep: [],
      };
    }
    if (mock.note) {
      body.week.note = {
        status: "done",
        text: "PETG warped twice this week, and both times the bed was 70 °C. The print that worked had a brim: worth keeping for the next one.",
      };
    }
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await page.getByRole("heading", { level: 1 }).waitFor();
}

/** 390 for any phone-sized window (390, 402, 375…), else 1440. */
const wide = (page: Page): 390 | 1440 => ((page.viewportSize()?.width ?? 1440) < 768 ? 390 : 1440);

/** What the passkeys and devices lists say, in a shot: a real passkey needs a real site (localhost), a shot opens 127.0.0.1. */
async function mockSigningIn(page: Page) {
  const ago = (ms: number) => SEED_NOW - ms;
  await page.route(/\/api\/account\/passkeys$/, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: {
            passkeys: [
              {
                id: "pk1",
                name: "iPhone",
                createdAt: ago(40 * 86_400_000),
                lastUsedAt: ago(3_600_000),
                backedUp: true,
              },
              { id: "pk2", name: "Mac", createdAt: ago(9 * 86_400_000), lastUsedAt: null, backedUp: true },
            ],
          },
        })
      : route.fallback(),
  );
  await page.route(/\/api\/account\/devices$/, (route) =>
    route.fulfill({
      json: {
        devices: [
          {
            id: "d1",
            device: "Mac · Chrome",
            createdAt: ago(5 * 86_400_000),
            lastSeenAt: SEED_NOW,
            current: true,
          },
          {
            id: "d2",
            device: "iPhone",
            createdAt: ago(30 * 86_400_000),
            lastSeenAt: ago(2 * 3_600_000),
            current: false,
          },
          {
            id: "d3",
            device: "iPad",
            createdAt: ago(80 * 86_400_000),
            lastSeenAt: ago(12 * 86_400_000),
            current: false,
          },
        ],
      },
    }),
  );
}

/** A phone's share sheet exists: the sheets offer it first (a headless browser has none). */
const withShare = (page: Page) =>
  page.evaluate(() => Object.defineProperty(navigator, "share", { value: async () => undefined, configurable: true }));

/** Makes an invite as Alex, then leaves the page signed out: what a guest opening the link sees. */
async function guestInvite(page: Page) {
  const origin = new URL(page.url() || "http://127.0.0.1").origin;
  await page.request.post("/api/session", {
    data: { username: "alex", password: "spaghetti-al-dente" },
    headers: { Origin: origin },
  });
  const made = await (await page.request.post("/api/account/invites", { headers: { Origin: origin } })).json();
  await page.context().clearCookies();
  return String(made.url).split("#")[1] ?? "";
}

/** Lets the entrance animation of a signed-out page finish: a shot taken mid-fade is blank. */
const settle = async (page: Page) => {
  await page.locator("h1").first().waitFor();
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await page.waitForTimeout(500);
};

/** Webhooks as the Agents page sees them, with times counted back from the shots' clock (SEED_NOW); the page is reloaded to show them. */
const minutesAgo = (n: number) => SEED_NOW - n * 60_000;
const webhookBase = {
  id: "11111111-1111-4111-8111-111111111111",
  url: "https://hooks.example.org/spaghetti",
  kinds: ["item", "attempt", "comment"],
  agentId: null as string | null,
  secretPrefix: "whsec_Ab3x9",
  state: "active",
  lastError: null as string | null,
  lastErrorAt: null as number | null,
  lastDeliveredAt: minutesAgo(12) as number | null,
  createdAt: minutesAgo(60 * 24 * 3),
};
const deliveryBase = {
  webhookId: webhookBase.id,
  seq: 41,
  test: false,
  entity: "attempt",
  action: "updated",
  status: "delivered",
  attempts: 1,
  httpStatus: 200,
  error: null as string | null,
  nextAt: null as number | null,
  createdAt: minutesAgo(12),
  lastAttemptAt: minutesAgo(12),
};
const workingDeliveries = [
  { ...deliveryBase, id: "d1", seq: 42, entity: "comment", action: "created" },
  { ...deliveryBase, id: "d2", seq: 41, createdAt: minutesAgo(47), lastAttemptAt: minutesAgo(47) },
  {
    ...deliveryBase,
    id: "d3",
    seq: null,
    test: true,
    entity: "item",
    createdAt: minutesAgo(60 * 22),
    lastAttemptAt: minutesAgo(60 * 22),
  },
];
const failingDeliveries = [
  {
    ...deliveryBase,
    id: "d4",
    seq: 44,
    status: "pending",
    attempts: 3,
    httpStatus: 502,
    error: "It answered 502.",
    nextAt: SEED_NOW + 90 * 60_000,
    lastAttemptAt: minutesAgo(20),
    createdAt: minutesAgo(60),
  },
  {
    ...deliveryBase,
    id: "d5",
    seq: 40,
    status: "failed",
    attempts: 7,
    httpStatus: 502,
    error: "It answered 502.",
    createdAt: minutesAgo(60 * 25),
    lastAttemptAt: minutesAgo(95),
  },
];

async function mockWebhooks(
  page: Page,
  webhooks: object[],
  deliveries: object[] = [],
  // The page shows an agent (the seed has none), so a shot isn't of the empty state's entrance animation.
  agent: { id: string; name: string } = { id: "claude-for-alex", name: "Claude for Alex" },
) {
  await page.route(/\/api\/webhooks(\/[^/]+\/deliveries)?$/, (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      return route.fulfill({
        status: 201,
        json: { webhook: webhookBase, secret: "whsec_k3P9mQ2xT7vLw0aBn5RyUe8CdHs4JzFgI1oXtVq6MA" },
      });
    }
    return route.fulfill({ json: request.url().endsWith("/deliveries") ? { deliveries } : { webhooks } });
  });
  await page.route(/\/api\/agents$/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { agents: object[] };
    const me = (await (await page.request.get("/api/session")).json()) as { user: { id: string } };
    await route.fulfill({
      response,
      json: {
        agents: [
          ...json.agents,
          { ...agent, ownerId: me.user.id, createdAt: minutesAgo(60 * 24 * 9), tokens: [], connection: null },
        ],
      },
    });
  });
  await page.reload({ waitUntil: "networkidle" });
  // The empty state's entrance would still be at opacity 0 in a full-page shot.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

/** The wishlists page with both lists in. */
async function waitForWishlist(page: Page) {
  await page.getByRole("heading", { level: 1, name: "Wishlists" }).waitFor();
  await page.getByRole("list", { name: "Your wishlist" }).waitFor();
}

const openDeliveries = async (page: Page) => {
  await page.getByRole("button", { name: "Recent deliveries" }).click();
  await page.getByRole("list", { name: "Recent deliveries" }).waitFor();
};

/** Opens the 3D view from the tugboat's second attempt and waits for the whole print to be drawn (the build-up has run). */
async function openViewer(page: Page) {
  await page.getByRole("button", { name: "See tugboat.gcode.3mf in 3D" }).first().click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await dialog.waitFor();
  await dialog.locator("[data-viewer=ready]").waitFor({ timeout: 30_000 });
}

/** Closes the live view and clears the bridge's report, so the shots after it see a print that isn't live. */
async function closeLiveViewer(page: Page) {
  await closeDialog(page);
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: new URL(page.url()).origin },
    data: { progress: null },
  });
}

/** The bridge says the tugboat's printing attempt is at layer 140 of 317; its 3D view opens there. */
async function openLiveViewer(page: Page) {
  await page.request.put("/api/printer/bridge", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      printerState: "printing",
      progress: {
        attemptId: "5eed0000-0000-4000-8000-0000000a0003",
        percent: 44,
        remainingMinutes: 105,
        layer: 140,
        totalLayers: 317,
      },
    },
  });
  await page.reload();
  await page
    .locator(`[data-attempt-id="5eed0000-0000-4000-8000-0000000a0003"]`)
    .getByRole("button", { name: "See tugboat.gcode.3mf in 3D" })
    .click();
  const dialog = page.getByRole("dialog", { name: "3D view" });
  await dialog.getByText("Layer 140 of 317").waitFor({ timeout: 30_000 });
  await dialog.locator("[data-viewer=ready]").waitFor({ timeout: 30_000 });
}

/** Orbits the 3D view to about 30 degrees under the plate's horizon and backs off until the plate's edge is in view. */
async function orbitBelow(page: Page) {
  const box = await page.getByRole("dialog", { name: "3D view" }).locator("canvas").boundingBox();
  if (!box) return;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * (0.6 - 0.16), { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(x, box.y + box.height / 2);
  await page
    .getByRole("dialog", { name: "3D view" })
    .locator("canvas")
    .evaluate((canvas) => {
      for (let i = 0; i < 14; i++)
        canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true }));
    });
  await page.waitForTimeout(1200);
}

/**
 * Tilts the 3D view a few degrees under the plate (the camera 5-10 mm under its top), where the plate used to show
 * its solid underside in front of the print: a fixed share of the canvas's height for each width, as the base of a
 * comparison has no camera readout to aim with. Logs where it ended where the view says so.
 */
async function tiltJustUnder(page: Page) {
  const canvas = page.getByRole("dialog", { name: "3D view" }).locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) return;
  const phone = (page.viewportSize()?.width ?? 1440) < 800;
  const share = phone ? PHONE_GRAZE : DESKTOP_GRAZE;
  // On a desktop, closer in, as on the phone: the camera over the plate rather than out beyond its front edge.
  if (!phone)
    await canvas.evaluate((c) => {
      for (let i = 0; i < 4; i++)
        c.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true }));
    });
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y + box.height * 0.7);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * (0.7 - share), { steps: 16 });
  await page.mouse.up();
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.waitForTimeout(1500);
  const height = await canvas.getAttribute("data-camera-height");
  if (height !== null)
    console.log(`  camera ${height} mm above the plate, plate ${await canvas.getAttribute("data-plate")}`);
}
const PHONE_GRAZE = 0.09;
const DESKTOP_GRAZE = 0.11;

async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

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
  /** Why it only exists at that width, printed when the other width is skipped. */
  why?: string;
  /** Runs after the page loads, to open a sheet or reach a state. */
  prepare?: (page: Page) => Promise<void>;
  /** Runs after every image has loaded, right before the screenshot. */
  beforeShot?: (page: Page) => Promise<void>;
  /** Runs after the screenshot, to undo what prepare changed for the next width. */
  cleanup?: (page: Page) => Promise<void>;
  /** Shows a picture still on its way, or one that failed, on purpose: skip the check that every image has loaded. */
  brokenImages?: boolean;
}

/** An idea made through the API with this note (no draft is started: only a capture starts one by itself). */
async function newModelIdea(page: Page, note: string) {
  return page.evaluate(async (text) => {
    const id = crypto.randomUUID();
    await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, note: text }),
    });
    return id;
  }, note);
}

const FLEXI_LINK = "https://makerworld.com/en/models/3531476-flexi-mini-hummingbird?from=search#profileId-4037895";

/**
 * A new idea whose note has a MakerWorld link, saved as a person types it (with its tracking bits), and its page open;
 * the page's title comes from a stand-in for the link preview (the shots have no internet).
 */
async function ideaWithLink(page: Page, title: string, note: string) {
  await page.route(/\/api\/links\/preview\?url=.*3531476/, (route) =>
    route.fulfill({ json: { url: FLEXI_LINK, title: "Flexi Mini Hummingbird", site: "MakerWorld" } }),
  );
  const id = crypto.randomUUID();
  modelItems.push(id);
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.post("/api/items", { headers, data: { id, title, note: "" } });
  await page.request.patch(`/api/items/${id}`, { headers, data: { note } });
  await openIdea(page, id);
  await page
    .getByRole("link", { name: /Flexi Mini Hummingbird/ })
    .first()
    .waitFor();
  await page.waitForTimeout(600);
}

async function removeLinkIdeas(page: Page) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await removeModelItems(page);
}

/** Opens that idea's page and waits for it. */
async function openIdea(page: Page, id: string) {
  await page.goto(`/ideas/${id}`);
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Start building" }).first().waitFor();
}

/**
 * A new idea with a model kept on it, as it would be dropped there: an .stl that slices in the browser (decision 0046).
 * `until` is the card's line to wait for: "Slicing", "Sliced by Spaghetti" or a sentence of why it couldn't be.
 */
async function ideaWithModel(
  page: Page,
  idea: { title: string; note: string },
  file: { name: string; bytes: Uint8Array },
  until: RegExp,
) {
  const id = crypto.randomUUID();
  modelItems.push(id);
  await page.request.post("/api/items", { headers: { Origin: new URL(page.url()).origin }, data: { id, ...idea } });
  await openIdea(page, id);
  await page.getByTestId("idea-file-input").setInputFiles({
    name: file.name,
    mimeType: file.name.endsWith(".3mf") ? "model/3mf" : "model/stl",
    buffer: Buffer.from(file.bytes),
  });
  const files = page.getByRole("region", { name: /^Files/ });
  await files.getByText(until).first().waitFor({ timeout: 90_000 });
  // The plate picture is drawn before slicing starts: wait for it to be on screen.
  await files.locator("img").first().waitFor();
  return files;
}

/** A new idea with a 48 MB model dropped on it (a file on disk: a buffer that big is more than Playwright takes). */
async function ideaWithBigModel(page: Page, until: RegExp) {
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-shot-"));
  try {
    const file = join(dir, "dragon-scale-armour.stl");
    writeFileSync(file, Buffer.alloc(48 * 1024 * 1024, 7));
    const id = crypto.randomUUID();
    modelItems.push(id);
    await page.request.post("/api/items", {
      headers: { Origin: new URL(page.url()).origin },
      data: { id, title: "Dragon scale armour", note: "Printed in pieces, joined with pins." },
    });
    await openIdea(page, id);
    await page.getByTestId("idea-file-input").setInputFiles(file);
    const files = page.getByRole("region", { name: /^Files/ });
    await files.getByText(until).first().waitFor({ timeout: 60_000 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Compare lives in an attempt's options menu (the newest attempt's, here): open that, then its Compare row. */
async function openCompare(page: Page) {
  await page
    .getByRole("button", { name: /^Options for attempt/ })
    .first()
    .click();
  await page
    .getByText(/^Compare/)
    .first()
    .click();
}

const FUSILLI = { name: "fusilli-knob.stl", bytes: fusilliStl() };
const FUSILLI_IDEA = { title: "Fusilli jar knob", note: "A fusilli knob for the pasta jar lid: twist to open." };
/**
 * A drying rack whose arm starts in the air beside its post (one mesh, so the arm isn't dropped to the bed): its
 * first layers have nothing under them, and Orca asks for supports. (A part above an empty gap fails instead: Orca
 * won't print empty layers.)
 */
const RACK = {
  name: "pasta-drying-rack.stl",
  bytes: boxesStl([
    { at: [0, 0, 0], size: [36, 36, 4] },
    { at: [12, 12, 4], size: [12, 12, 46] },
    { at: [30, 15, 34], size: [26, 6, 4] },
  ]),
};
const RACK_IDEA = { title: "Pasta drying rack", note: "A little rack to dry fresh tagliatelle on, one arm out." };
/** A project for the X2D that asks for a raft under hybrid trees, Orca's classic ones, which our own slicer can't
 * build yet. */
const RAFT = { name: "ravioli-stamp.3mf", bytes: raftProject({ enable_support: "1", support_style: "tree_hybrid" }) };
const TWO_TONE = { name: "two-tone-coaster.3mf", bytes: partsProject() };
const TWO_TONE_IDEA = {
  title: "Two-tone coaster",
  note: "One coaster, half white and half tomato red: the project's two parts, each in its own filament.",
};
/** A plain 3MF of thirteen parts in eight named colours (issue #313): matched to the Pantry's spools in the settings. */
// SPAGHETTI_HOTDOG: the path of a real coloured 3MF to show instead (never committed).
const HOTDOG = process.env.SPAGHETTI_HOTDOG
  ? { name: basename(process.env.SPAGHETTI_HOTDOG), bytes: new Uint8Array(readFileSync(process.env.SPAGHETTI_HOTDOG)) }
  : { name: "hotdog-hero.3mf", bytes: hotdogModel() };
const HOTDOG_IDEA = {
  title: "Hotdog hero",
  note: "A model that brings its own colours: each is matched to a spool from the Pantry.",
};
/** A MakerWorld-style project in four filaments, with per-object extruders and a painted top: matched to the spools. */
const PLAQUE = { name: "name-plaque.3mf", bytes: makerworldProject() };
const PLAQUE_IDEA = {
  title: "Name plaque",
  note: "A project in four filaments from MakerWorld: each is matched to a spool from the Pantry.",
};
/** A project with painted colours, which our own slicer prints since release 23 (OrcaSlicer's engine before). */
const FARFALLE = { name: "farfalle-coaster.3mf", bytes: paintedProject() };
const FARFALLE_IDEA = {
  title: "Farfalle coaster",
  note: "A white coaster with a tomato-red bow tie painted on its top in Bambu Studio.",
};
/** A project of three plates, a bin of another height on each (the MakerWorld storage-bin set). */
const BINS = { name: "stackable-bins.3mf", bytes: platesProject() };
const MANY_BINS = { name: "bin-set.3mf", bytes: platesProject(7) };
const BINS_IDEA = {
  title: "Stackable bins",
  note: "Storage bins in three heights, a plate each.",
};
const RAFT_IDEA = {
  title: "Ravioli stamp",
  note: "Square, on a raft as the project says, to see if it lifts cleaner.",
};

/** A shelf bracket, an L: it can lie on its base or on its side, which the "Lay it down" tiles show. */
const BRACKET = {
  name: "shelf-bracket.stl",
  bytes: boxesStl([
    { at: [0, 0, 0], size: [60, 30, 6] },
    { at: [0, 0, 6], size: [6, 30, 40] },
  ]),
};
const BRACKET_IDEA = {
  title: "Shelf bracket",
  note: "Holds the pasta shelf up. Takes a load, so it matters which way it prints.",
};

/** Glasses on rims with no flat side: as designed they can't be sliced; the side they can lie on is a few spots. */
const GLASSES = { name: "steampunk-glasses.stl", bytes: glassesStl() };
const GLASSES_IDEA = { title: "Steampunk glasses", note: "Brass rims and diamond lenses. Prints neater on its side?" };

/** An idea with a model the server keeps but nobody sliced (its tab closed while it waited). */
async function ideaWithUnslicedModel(page: Page) {
  const id = crypto.randomUUID();
  modelItems.push(id);
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.post("/api/items", { headers, data: { id, ...FUSILLI_IDEA } });
  await page.request.put(`/api/items/${id}/files/${crypto.randomUUID()}`, {
    headers,
    multipart: {
      name: FUSILLI.name,
      size: String(FUSILLI.bytes.length),
      plate: "1",
      plateCount: "1",
      prefill: "{}",
      kind: "model",
      file: { name: FUSILLI.name, mimeType: "model/stl", buffer: Buffer.from(FUSILLI.bytes) },
    },
  });
  await openIdea(page, id);
  await page
    .getByRole("region", { name: /^Files/ })
    .getByText("Not sliced yet")
    .waitFor();
}

/** Until the server has the newest model idea's slice, with its picture (what the Ideas list reads). */
async function sliceSaved(page: Page) {
  const id = modelItems.at(-1);
  for (let tries = 0; tries < 120; tries++) {
    const { item } = await (await page.request.get(`/api/items/${id}`)).json();
    if (item?.files?.some((file: { hasThumb?: boolean }) => file.hasThumb)) return;
    await page.waitForTimeout(500);
  }
  throw new Error("The model's slice never reached the server");
}

/** Twists (and the builds they printed) that a shot made, for its cleanup. */
const modelTwists: string[] = [];

/**
 * A new twist with the fusilli knob adapted to 110 % and kept as its model, through the sheet; waits until it is
 * sliced and its picture is saved. Leaves the browser on the twist's page.
 */
async function twistWithModel(page: Page) {
  const id = crypto.randomUUID();
  modelTwists.push(id);
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.post("/api/twists", { headers, data: { id, name: "Fusilli jar knob" } });
  await page.goto(`/twists/${id}`);
  await page.getByRole("button", { name: "Adapt an STL" }).click();
  const sheet = page.getByRole("dialog", { name: "Adapt an STL" });
  await sheet.getByTestId("adapt-file-input").setInputFiles({
    name: FUSILLI.name,
    mimeType: "model/stl",
    buffer: Buffer.from(FUSILLI.bytes),
  });
  await sheet.getByRole("textbox", { name: "Scale" }).fill("110");
  await sheet.getByRole("button", { name: "Keep with the twist" }).click();
  await sheet.waitFor({ state: "hidden" });
  await page
    .getByRole("region", { name: "Model" })
    .getByText(/Sliced by Spaghetti/)
    .first()
    .waitFor({ timeout: 90_000 });
  for (let tries = 0; tries < 120; tries++) {
    const { twist } = await (await page.request.get(`/api/twists/${id}`)).json();
    if (twist?.model?.hasThumb && twist.model.slice?.status === "sliced") break;
    await page.waitForTimeout(500);
  }
  await page.getByRole("img", { name: "Slicer preview: Fusilli jar knob" }).waitFor();
  await page.waitForTimeout(400);
}

async function removeTwistModels(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  const { items = [] } = await (await page.request.get("/api/items")).json().catch(() => ({ items: [] }));
  for (const id of modelTwists) {
    for (const item of items.filter((i: { twistId?: string }) => i.twistId === id)) {
      await page.request.delete(`/api/items/${item.id}`, { headers });
    }
    await page.request.delete(`/api/twists/${id}`, { headers });
  }
  modelTwists.splice(0);
}

/** Waits for a sliced model's card and brings it into view. */
async function modelInView(page: Page) {
  await page.getByRole("region", { name: /^Files/ }).evaluate((region) => region.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
}

/**
 * An idea with the fusilli knob sliced, its settings open ("Slice with…"): the popover on desktop, the sheet on a
 * phone. Returns them.
 */
async function openSliceSettings(page: Page, model = { idea: FUSILLI_IDEA, file: FUSILLI }) {
  const files = await ideaWithModel(page, model.idea, model.file, /Sliced by Spaghetti/);
  await sliceSaved(page);
  await modelInView(page);
  await files.getByRole("button", { name: "Slice with…" }).click();
  const settings = page.getByRole("dialog", { name: "How to slice it" });
  await settings.getByRole("group", { name: "Quality" }).waitFor();
  return settings;
}

/** The Colours block opened (it starts folded to one line), and which of its rows: the first, or one with a stand-in. */
async function openColour(page: Page, settings: Locator, which: "first" | "second" | "stand-in" | "none" = "first") {
  const summary = settings.getByRole("button", { name: /^Colours/ });
  await summary.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
  await summary.click({ force: true });
  await page.waitForTimeout(400);
  if (which === "none") return;
  const rows = settings.locator("li button[aria-expanded]");
  const row =
    which === "stand-in" && (await rows.filter({ hasText: "Not in the Pantry yet" }).count())
      ? rows.filter({ hasText: "Not in the Pantry yet" }).first()
      : which === "stand-in"
        ? rows.last()
        : which === "second"
          ? rows.nth(1)
          : rows.first();
  await row.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
  await row.click({ force: true });
  // Its spools are below it: the row up to the top of the view, so they show.
  await page.waitForTimeout(400);
  await row.evaluate((button) => button.scrollIntoView({ block: "start", behavior: "instant" }));
}

/** The settings' sheet or popover has finished opening (the shots' fixed clock starts its fade late: finish it). */
async function settleSliceSettings(page: Page) {
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return false;
    for (const animation of dialog.getAnimations({ subtree: true })) animation.finish();
    return getComputedStyle(dialog).opacity === "1";
  });
  await page.waitForTimeout(400);
}

/**
 * A model with parts in several filaments (SPAGHETTI_HOTDOG=the zipper pull's 3MF, whose filaments 1 and 2 are the
 * body and the logo) with filament 1 tried in neon yellow and filament 2 in black from "Any colour…", sliced again.
 * Leaves the settings sheet open at the Colours rows, every row folded.
 */
async function tryNeonAndBlack(page: Page) {
  const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
  await settings.getByText("Colours", { exact: true }).waitFor();
  const tryColour = async (which: "first" | "second", colour: string) => {
    if (which === "first") await openColour(page, settings, "first");
    else {
      // The Colours block is open: just the second row.
      const row = settings.locator("li button[aria-expanded]").nth(1);
      await row.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
      await row.click({ force: true });
      await page.waitForTimeout(400);
    }
    await settings.getByText("Any colour…").first().click({ force: true });
    await settings.locator(`button[role="radio"][aria-label="${colour}"]`).last().click({ force: true });
    await settings.getByText("a stand-in to try").first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(300);
  };
  await tryColour("first", "Neon yellow");
  // The first row folds again as the second opens.
  await tryColour("second", "Black");
  // The pick slices again by itself after a moment; a tap on "Slice it" does not wait for that.
  await settings
    .getByRole("button", { name: "Slice it" })
    .click({ timeout: 3000 })
    .catch(() => undefined);
  // Sliced again: the line says "Sliced with these settings", or what the change did, with its undo.
  await settings
    .getByText("Sliced with these settings")
    .or(settings.getByRole("button", { name: "Undo" }))
    .first()
    .waitFor({ timeout: 120_000 });
  const rows = settings.locator("li button[aria-expanded=true]");
  for (let open = await rows.count(); open > 0; open--) await rows.first().click({ force: true });
  await page.waitForTimeout(400);
  return settings;
}

/** The settings scrolled back to their top (picking a tile lower down scrolls it into view). */
async function scrollSheetToTop(settings: Locator) {
  await settings.evaluate((dialog) => {
    for (const element of Array.from(dialog.querySelectorAll<HTMLElement>("*"))) {
      if (element.scrollHeight > element.clientHeight + 4 && getComputedStyle(element).overflowY !== "visible") {
        element.scrollTop = 0;
      }
    }
  });
}

/**
 * The fusilli knob's settings open, More open and Spaghetti's own slicer picked there (decision 0055), once ours has
 * sliced it again. Returns the Slicer group.
 */
async function pickOurSlicer(page: Page) {
  const settings = await openSliceSettings(page);
  await settings.getByRole("button", { name: /^More/ }).click();
  const slicer = settings.getByRole("group", { name: "Slicer" });
  await slicer.getByRole("radio", { name: "Spaghetti's own" }).click();
  await settings
    .getByText(/^Sliced in this browser in [\d.]+ s by Spaghetti's own slicer/)
    .waitFor({ timeout: 90_000 });
  await page.waitForTimeout(400);
  return { slicer };
}

async function closeSliceSettings(page: Page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await removeModelItems(page);
}

/**
 * The workspace's slicing defaults set by the API (the Printer page's, decision 0051): Spaghetti's own with `change`
 * over them, or Spaghetti's again with null. Spaghetti's own slicer (decision 0055) is picked there for the shots of
 * models it slices.
 */
async function setSlicingDefaults(page: Page, change: Record<string, unknown> | null) {
  await page.request.put("/api/printer", {
    headers: { Origin: new URL(page.url()).origin },
    data: {
      slicing: change && {
        layerHeight: 0.2,
        walls: 2,
        infill: 15,
        pattern: "crosshatch",
        supports: "off",
        supportStyle: "tree",
        brim: "auto",
        ...change,
      },
    },
  });
}

/**
 * Loads the dual-colour (A3) and tri-colour (A4) silks into the AMS by the API, the way the Printer page does, so
 * the shots of the AMS and of "Slice with…" show a multi-colour spool in a slot. The next shot's app is fresh.
 */
async function loadMultiColourSpools(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  const slots: Array<[string, string]> = [
    ["A3", SEED_SPOOL_IDS.blackPurple],
    ["A4", SEED_SPOOL_IDS.blackGoldPurple],
  ];
  for (const [slot, spoolId] of slots) {
    await page.request.put(`/api/printer/slots/${slot}`, { headers, data: { spoolId } });
  }
}

/** The Printer page's slicing defaults (decision 0051). */
const slicingDefaults = (page: Page) => page.locator("section[aria-labelledby=printer-slicing]");

/** The X2D's nozzles as the seed has them: two 0.4 mm. */
const STOCK_NOZZLES = { main: { diameter: 0.4, hardened: true }, auxiliary: { diameter: 0.4, hardened: true } };

/**
 * Fits a nozzle of another size (decision 0056): the 0.2 mm on the right (auxiliary) by default, or in the main one.
 * `fitStockNozzles` puts the seed's back, with Spaghetti's own slicing defaults.
 */
async function fitSmallNozzle(page: Page, where: "main" | "auxiliary" = "auxiliary") {
  const headers = { Origin: new URL(page.url()).origin };
  const nozzles = { ...STOCK_NOZZLES, [where]: { diameter: 0.2, hardened: false } };
  await page.request.put("/api/printer", { headers, data: { nozzles } });
}

async function fitStockNozzles(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  await page.request.put("/api/printer", { headers, data: { nozzles: STOCK_NOZZLES, slicing: null } });
}

/** The slicing defaults, unfolded, their tiles in place. Returns the section. */
async function openSlicingDefaults(page: Page) {
  const section = slicingDefaults(page);
  await section.getByRole("button", { name: /^How new models are sliced/ }).click();
  await section.getByRole("group", { name: "Quality" }).waitFor();
  await settleSection(page, section);
  return section;
}

/**
 * A section's opening and fades finished (the shots' fixed clock starts Motion's late, which would shoot them
 * half-open or see-through), and no focus ring where a click left one: a tap leaves none.
 */
async function settleSection(page: Page, section: Locator) {
  await page.waitForTimeout(100);
  await section.evaluate((element) => {
    for (const animation of element.getAnimations({ subtree: true })) animation.finish();
  });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(400);
}

/** The seed's Up next queue, in order: the desk tidy-up, then the oven knob. */
const SEED_QUEUE = [SEED_IDS.deskTidy, "5eed0000-0000-4000-8000-000000000003"];

/** Puts the inbox's first idea in Up next as a person would: U on desktop (where J and K walk the cards), the card's menu on a phone. */
async function queueFirstInbox(page: Page) {
  const inbox = page.getByRole("list", { name: "Ideas" });
  if (wide(page) === 1440) {
    await inbox.getByRole("link").first().focus();
    await page.keyboard.press("u");
  } else {
    await inbox
      .getByRole("button", { name: /^Options for / })
      .first()
      .click();
    await page.getByRole("button", { name: "Up next", exact: true }).click();
  }
  await page.waitForTimeout(400);
}

/** Lets a toast and the cards it talks about settle for the shot (the shots' clock is fixed, so fades are finished by hand). */
async function settleToast(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Show Up next with the ideas that just joined it (picking them scrolled the page).
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

/** Answers the wishlists with yours empty ("none") or the other person's private ("private"). */
async function mockWishlists(page: Page, mode: "none" | "private") {
  const { user } = (await (await page.request.get("/api/session")).json()) as { user: { id: string } };
  await page.route(/\/api\/wishlists$/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as {
      wishlists: Array<{ personId: string; private?: boolean; entries: unknown[] }>;
    };
    const wishlists = json.wishlists.map((list) =>
      mode === "none" && list.personId === user.id
        ? { ...list, entries: [] }
        : mode === "private" && list.personId !== user.id
          ? { ...list, private: true, entries: [] }
          : list,
    );
    await route.fulfill({ response, json: { ...json, wishlists } });
  });
  await page.reload();
  await page.getByRole("link", { name: /^Wishlists/ }).waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(600);
  // Cards that arrived after the first draw fade in on the shots' fixed clock: finish them.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
}

/** The seed's note-only "Bag clips for the coffee": a bare link for a moment in the shot of every kind of idea in Up next. */
const COFFEE_CLIPS = "5eed0000-0000-4000-8000-000000000013";

/** Up next holds exactly these ideas, in this order (the first two are the seed's own). */
async function setQueue(page: Page, count: number) {
  const headers = { Origin: new URL(page.url()).origin };
  const { items } = await (await page.request.get("/api/items?stage=idea")).json();
  for (const item of items) {
    if (item.upNext !== null) await page.request.patch(`/api/items/${item.id}`, { headers, data: { upNext: false } });
  }
  // The seed's own two first, then the ideas that are still ideas (some seed ideas are builds), photos before notes.
  const more = items
    .filter((item: { id: string }) => !SEED_QUEUE.includes(item.id))
    .sort((x: { photos: unknown[] }, y: { photos: unknown[] }) => Number(!x.photos.length) - Number(!y.photos.length))
    .map((item: { id: string }) => item.id);
  for (const id of [...SEED_QUEUE, ...more].slice(0, count)) {
    await page.request.patch(`/api/items/${id}`, { headers, data: { upNext: true } });
  }
}

/** The ideas and builds the model shots make (removed again by their cleanup, so later shots' lists don't show them). */
const modelItems: string[] = [];

async function removeModelItems(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of modelItems.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
}

/**
 * Once a model in the attempt sheet is sliced, the sheet reads the sliced file and the settings open with what it
 * says, with an animation that changes the sheet's height. The shots' fixed clock starts the settings' fade late, more
 * so as a run goes on: finish it rather than wait for it.
 */
async function sheetSettled(page: Page, sheet: Locator) {
  await sheet.getByLabel("Layer height").waitFor();
  const panel = await sheet.getByRole("button", { name: /^Settings/ }).getAttribute("aria-controls");
  await page.waitForFunction((id) => {
    const element = id ? document.getElementById(id) : null;
    if (!element) return false;
    for (const animation of element.getAnimations()) animation.finish();
    return getComputedStyle(element).opacity === "1";
  }, panel);
  await page.waitForTimeout(900);
}

/**
 * A new build with its first attempt's sheet open and the fusilli knob's .stl dropped in it, sliced there: what the
 * slice says fills in the attempt, which isn't logged yet. Returns the sheet.
 */
async function buildWithModel(page: Page) {
  const id = crypto.randomUUID();
  modelItems.push(id);
  await page.request.post("/api/items", {
    headers: { Origin: new URL(page.url()).origin },
    data: { id, ...FUSILLI_IDEA, stage: "building" },
  });
  await page.goto(`/builds/${id}`);
  await page.getByRole("button", { name: "Log attempt" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Attempt 1" });
  await sheet.waitFor();
  await page.getByTestId("slicer-file-input").setInputFiles({
    name: FUSILLI.name,
    mimeType: "model/stl",
    buffer: Buffer.from(FUSILLI.bytes),
  });
  await sheet.getByText("Sliced by Spaghetti").waitFor({ timeout: 90_000 });
  return sheet;
}

/** The spools the label shots make (removed again by their cleanup). */
const labelSpoolIds: string[] = [];

/**
 * A spool made through the API with this note (the stand-in Claude picks its answer by a word in it, see
 * scripts/lib/fake-claude.ts), opened on its page and given a label photo to read, the way "Read the label" does.
 */
async function labelSpool(page: Page, note: string, photo: "jade" | "two") {
  const id = await page.evaluate(async (text) => {
    const spoolId = crypto.randomUUID();
    await fetch("/api/spools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: spoolId, material: "PLA", note: text }),
    });
    return spoolId;
  }, note);
  labelSpoolIds.push(id);
  await page.goto(`/pantry/${id}`);
  await page.getByRole("button", { name: "Read the label" }).waitFor();
  await page.getByTestId("photo-input").setInputFiles({
    name: `label-${photo}.jpg`,
    mimeType: "image/jpeg",
    buffer: readFileSync(`e2e/fixtures/label-${photo}.jpg`),
  });
}

/** Takes the spools the label shots made off the shelf again. */
async function removeLabelSpools(page: Page) {
  await page.evaluate(async (ids) => {
    for (const id of ids) await fetch(`/api/spools/${id}`, { method: "DELETE" });
  }, labelSpoolIds.splice(0));
}

/** The builds the photo-read shots make (removed again by their cleanup). */
const photoReadBuilds: string[] = [];

/**
 * A build whose print is off the bed, with a camera photo on it, so Claude reads it (the stand-in answers from a word in
 * the title, scripts/lib/fake-claude.ts); opens the build's page. The photo goes in the bridge's way.
 */
async function printWithPhoto(page: Page, title: string) {
  const origin = new URL(page.url()).origin;
  const headers = { Origin: origin };
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  photoReadBuilds.push(itemId);
  await page.request.post("/api/items", { headers, data: { id: itemId, title, stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, printedAt: Date.now() - 95 * 60_000, settings: { estimatedMinutes: 90 } },
  });
  await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: { endedAt: Date.now() - 12 * 60_000 } });
  const file = { name: "frame.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/tugboat.jpg") };
  await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: { width: "1280", height: "960", color: "#8d7a66", attemptId, large: file, thumb: file },
  });
  await page.goto(`/builds/${itemId}`);
  await page.getByRole("button", { name: "Attempt 1: off the bed. Open" }).waitFor();
  return { itemId, attemptId };
}

/**
 * A build with everything at once, for looking at the page as a whole: three parts, eight attempts (seven
 * finished, the newest off the bed with a camera photo that Claude reads as spaghetti), a thread of three comments.
 */
async function everythingBuild(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  const itemId = crypto.randomUUID();
  photoReadBuilds.push(itemId);
  const DAY = 24 * 60 * 60_000;
  await page.request.post("/api/items", {
    headers,
    data: {
      id: itemId,
      title: "Paddle wheel spaghetti test",
      note: "Hull in two halves, a deck and the wheel. Model: https://makerworld.com/en/models/1-cable-comb",
      createdAt: Date.now() - 12 * DAY,
    },
  });
  const parts = ["Hull, left", "Hull, right", "Deck"].map((name, position) => ({
    id: crypto.randomUUID(),
    name,
    quantity: 1,
    position,
  }));
  await page.request.put(`/api/items/${itemId}/parts`, { headers, data: { parts } });
  const outcomes = ["failed", "failed", "partial", "failed", "success", "partial", "success"] as const;
  for (const [index, outcome] of outcomes.entries()) {
    await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        outcome,
        printedAt: Date.now() - (10 - index) * DAY,
        note: outcome === "failed" ? "Let go of the plate at the stern." : undefined,
        failureTags: outcome === "failed" ? ["warping"] : undefined,
        parts: [{ partId: parts[index % 3]?.id, count: outcome === "success" ? 1 : 0 }],
        settings: { estimatedMinutes: 140, layerHeight: 0.2, bedTemperature: 60 + index },
      },
    });
  }
  const attemptId = crypto.randomUUID();
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: { id: attemptId, printedAt: Date.now() - 150 * 60_000, settings: { estimatedMinutes: 140 } },
  });
  await page.request.patch(`/api/attempts/${attemptId}`, { headers, data: { endedAt: Date.now() - 8 * 60_000 } });
  const file = { name: "frame.jpg", mimeType: "image/jpeg", buffer: readFileSync("e2e/fixtures/tugboat.jpg") };
  await page.request.put(`/api/items/${itemId}/photos/${crypto.randomUUID()}`, {
    headers,
    multipart: { width: "1280", height: "960", color: "#8d7a66", attemptId, large: file, thumb: file },
  });
  for (const body of [
    "The stern keeps lifting. Brim next time?",
    "Tried a brim on 6, it held. The wheel is the slow part now.",
    "Looks like it let go again on 8, sorry.",
  ])
    await page.request.post(`/api/items/${itemId}/comments`, { headers, data: { id: crypto.randomUUID(), body } });
  return itemId;
}

/**
 * A build whose only attempt was answered Spaghetti (a stern that lifted, no brim, bed at 60 °C), so the failure coach
 * thinks about the next try: the stand-in answers from the title (a word "coach" gets suggestions, "slow" holds them
 * back ten seconds, scripts/lib/fake-claude.ts). Opens the build's page.
 */
async function failedBuild(page: Page, title: string) {
  const headers = { Origin: new URL(page.url()).origin };
  const itemId = crypto.randomUUID();
  photoReadBuilds.push(itemId);
  await page.request.post("/api/items", { headers, data: { id: itemId, title, stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      outcome: "failed",
      printedAt: Date.now() - 5 * 60 * 60_000,
      note: "The stern lifted off the plate halfway up.",
      failureTags: ["bed-adhesion"],
      settings: {
        filaments: [{ type: "PETG", brand: "Bambu", colorName: "Teal" }],
        bedType: "Textured PEI Plate",
        bedTemperature: 60,
        nozzleTemperature: 250,
        estimatedMinutes: 150,
        failedAtPercent: 52,
      },
    },
  });
  await page.goto(`/builds/${itemId}`);
  await page.locator("h1").first().waitFor({ state: "attached" });
  return itemId;
}

/** Builds a cover shot made, for its cleanup. */
const coverBuilds: string[] = [];

/** A plate render as a slicer draws it (a clear PNG) from one of the styleguide's sample SVGs, drawn in the page. */
async function samplePng(page: Page, file: string): Promise<Buffer> {
  const svg = readFileSync(file, "utf8");
  const base64 = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/svg+xml;base64,${btoa(source)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    canvas.getContext("2d")?.drawImage(image, 0, 0, 512, 512);
    return canvas.toDataURL("image/png").split(",")[1] ?? "";
  }, svg);
  return Buffer.from(base64, "base64");
}

/**
 * A build with no photo whose only attempt carries a slicer file with this plate picture: its cover is the render. A
 * white hook (the fixture's plate) or a black one (black PLA), in the stage and with the outcome asked for.
 */
async function renderBuild(
  page: Page,
  options: { title: string; black?: boolean; stage?: "building" | "done" | "shelved"; outcome?: "success" | "failed" },
) {
  const headers = { Origin: new URL(page.url()).origin };
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  coverBuilds.push(itemId);
  await page.request.post("/api/items", { headers, data: { id: itemId, title: options.title, stage: "building" } });
  await page.request.post(`/api/items/${itemId}/attempts`, {
    headers,
    data: {
      id: attemptId,
      outcome: options.outcome ?? "failed",
      printedAt: Date.now() - 50 * 60_000,
      settings: { filaments: [{ type: "PLA", brand: "Bambu", colorName: options.black ? "Black" : "Jade white" }] },
    },
  });
  const thumb = options.black
    ? await samplePng(page, "src/client/assets/samples/render-hook-black.svg")
    : readFileSync("e2e/fixtures/plate-hook.png");
  const bytes = slicerFile();
  await page.request.put(`/api/attempts/${attemptId}/file`, {
    headers,
    multipart: {
      id: crypto.randomUUID(),
      name: SLICER_FILE_NAME,
      size: String(bytes.length),
      plate: "2",
      plateCount: "2",
      slicer: "BambuStudio 02.01.00.00",
      prefill: "{}",
      objects: "[]",
      file: { name: SLICER_FILE_NAME, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) },
      thumb: { name: "plate_2.png", mimeType: "image/png", buffer: thumb },
    },
  });
  if (options.stage && options.stage !== "building")
    await page.request.patch(`/api/items/${itemId}`, { headers, data: { stage: options.stage } });
  return itemId;
}

/** Two prints on the bed with no photo and no file: one with a note (the one due), one with only a name. */
async function printsWithoutPictures(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  for (const [title, note, startedAgo, minutes] of [
    ["Shelf peg", "For the hallway shelf, under the coats.", 130, 90],
    ["Wall hook", "", 20, 75],
  ] as const) {
    const itemId = crypto.randomUUID();
    coverBuilds.push(itemId);
    await page.request.post("/api/items", { headers, data: { id: itemId, title, note, stage: "building" } });
    await page.request.post(`/api/items/${itemId}/attempts`, {
      headers,
      data: {
        id: crypto.randomUUID(),
        printedAt: Date.now() - startedAgo * 60_000,
        settings: { estimatedMinutes: minutes, filaments: [{ type: "PLA", brand: "Bambu", colorName: "Jade white" }] },
      },
    });
  }
}

async function removeCoverBuilds(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of coverBuilds.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
}

/** Requests a shot holds back (a picture still on its way), let go in its cleanup. */
const heldRoutes: Route[] = [];

/** Towel hook's card on Builds: it is printing, so a print card under On the bed, not one of the grid's. */
const TOWEL_CARD = "main article:has(a:has-text('Towel hook'))";

/** Opens the attempt's sheet from its card (the card's open button is under its content: click its corner). */
async function openOffBedSheet(page: Page) {
  await page.getByRole("button", { name: /off the bed\. Open/ }).click({ position: { x: 24, y: 24 } });
  await page.getByRole("dialog").waitFor();
}

async function removePhotoReadBuilds(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  for (const id of photoReadBuilds.splice(0)) await page.request.delete(`/api/items/${id}`, { headers });
}

/** Scrolls an idea's or build's thread to the foot of the screen, once its comments (or the empty line) are there. */
async function showThread(page: Page, withComments = true) {
  await page.locator("h1").first().waitFor({ state: "attached" });
  const thread = page.locator("section[aria-labelledby^='thread-']");
  await thread.waitFor();
  if (withComments) await thread.getByRole("list", { name: "Comments" }).waitFor();
  else
    await page
      .getByRole("textbox", { name: /Say something to/ })
      .or(page.getByRole("button", { name: /Say something to/ }))
      .first()
      .waitFor();
  await page.waitForTimeout(300);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
}

/** Opens a comment's menu: a tap on its bubble on a phone, its button beside the bubble on desktop. */
async function openCommentMenu(page: Page, id: string, button: string | RegExp) {
  await showThread(page);
  const comment = page.locator(`#comment-${id}`);
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  // Playwright's own scrolling lands a low message under the phone's action bar: centre it and tap it in the page.
  await comment.evaluate((el) => el.scrollIntoView({ block: "center" }));
  if (phone)
    await comment
      .locator("> div")
      .first()
      .evaluate((el) => (el as HTMLElement).click());
  else {
    await comment.hover();
    await comment.getByRole("button", { name: button }).click();
  }
  await page.getByRole("group", { name: "Reactions" }).last().waitFor();
  await page.waitForTimeout(500);
}

/** The idea page with its reaction picker open on the full emoji grid. */
async function openFullPicker(page: Page) {
  const button = page.getByRole("button", { name: "React to this idea" });
  await button.evaluate((el) => {
    el.scrollIntoView({ block: "center" });
    (el as HTMLElement).click();
  });
  await page.getByRole("button", { name: "More emoji" }).click();
  await page.getByRole("gridcell").first().waitFor();
}

/**
 * A phone's picker with the on-screen keyboard up: browsers here have none, so the visual viewport is cut to
 * 470 px, like iOS Safari does, and a grey block stands where the keys would be.
 */
async function openPickerWithKeyboard(page: Page, search?: string) {
  await openFullPicker(page);
  const field = page.getByRole("searchbox", { name: "Search emoji" });
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    if (!viewport) throw new Error("No visualViewport");
    const visible = 470;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => visible });
    viewport.dispatchEvent(new Event("resize"));
    const keys = document.createElement("div");
    keys.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${window.innerHeight - visible}px;background:#3a3a3c;z-index:60`;
    document.body.append(keys);
  });
  await page.waitForTimeout(300);
  if (search) {
    await field.pressSequentially(search, { delay: 20 });
    await page.waitForTimeout(400);
  }
}

const GOOD_LINK = "https://makerworld.com/en/models/1-cable-comb";

type Slice = "all" | "none" | "young";

/**
 * Shows Today with parts of the workspace missing, by answering the app's own requests with less: the ideas,
 * the builds, the journal and the spools it fetches. The real data stays in the database; unmockToday puts it back.
 */
/** Came back after `days` away (the shots' clock is the seed's date): the catch-up the app keeps on this device. */
async function catchUpFrom(page: Page, days: number) {
  await page.evaluate(
    ([from, until]) => localStorage.setItem("sg-since", JSON.stringify({ from, until })),
    [SEED_NOW - days * 86_400_000, SEED_NOW + 3_600_000],
  );
  await page.reload();
}

async function forgetCatchUp(page: Page) {
  await page.evaluate(() => localStorage.removeItem("sg-since"));
}

async function mockToday(
  page: Page,
  show: {
    builds: Slice;
    journal: Slice;
    spools: Slice;
    ideas: Slice;
    late?: boolean;
    offBed?: boolean;
    onePrint?: boolean;
  },
) {
  const DAY = 24 * 60 * 60 * 1000;
  // A notebook with nothing in it has nothing for the idea scout to go on either.
  if (show.builds === "none") await mockScout(page, "none");
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
    // Only the first print stays on the bed: the others are taken off the list.
    if (show.onePrint) {
      let seen = false;
      json.items = json.items.filter((item) => {
        if (!item.attempts?.some((attempt) => attempt.outcome === null)) return true;
        if (seen) return false;
        seen = true;
        return true;
      });
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

/**
 * The idea scout's week, answered from here: the Worker's clock is the real one, so what it keeps for "this week"
 * is a different Monday from the shots'. "none": the scout hasn't been out yet; "answered": one kept, one put away.
 */
async function mockScout(page: Page, mode: "none" | "answered" | "one") {
  await page.route(/\/api\/scout$/, async (route) => {
    if (mode === "none") {
      await route.fulfill({ json: { scout: { monday: "2026-10-19", state: "none", picks: [] } } });
      return;
    }
    const response = await route.fetch();
    const body = (await response.json()) as { scout: { picks: Array<{ status: string; itemId: string | null }> } };
    const [first, second] = body.scout.picks;
    if (first) Object.assign(first, { status: "kept", itemId: SEED_IDS.desiccantHook });
    if (second && mode === "answered") second.status = "dismissed";
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await page.getByRole("heading", { level: 1 }).waitFor();
}

/** The builds list with only the builds `keep` takes (for the Builds list's empty sections). */
async function keepBuilds(
  page: Page,
  keep: (item: { id: string; stage: string; attempts?: Array<{ outcome: string | null }> }) => boolean,
) {
  await page.route(/\/api\/items\?stage=/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as {
      items: Array<{ id: string; stage: string; attempts?: Array<{ outcome: string | null }> }>;
    };
    json.items = json.items.filter((item) => item.stage === "idea" || keep(item));
    await route.fulfill({ response, json });
  });
  await page.reload({ waitUntil: "networkidle" });
}

/**
 * The seed's agents (scripts/seed/agents.ts) by name, so the work done through them shows the agent's mark: the seed
 * keeps them out of the database to leave the Agents page's shots alone. The page is reloaded to show them.
 */
async function withSeedAgents(page: Page) {
  const { people } = (await (await page.request.get("/api/people")).json()) as {
    people: Array<{ id: string; username: string }>;
  };
  await page.route(/\/api\/agents$/, async (route) => {
    const response = await route.fetch();
    const json = (await response.json()) as { agents: object[] };
    const seeded = Object.values(SEED_AGENTS).map(({ id, name, owner }) => ({
      id,
      name,
      ownerId: people.find((person) => person.username === owner)?.id ?? owner,
      createdAt: SEED_NOW - 30 * 24 * 3_600_000,
      tokens: [],
      connection: null,
    }));
    await route.fulfill({ response, json: { agents: [...json.agents, ...seeded] } });
  });
  await page.reload({ waitUntil: "networkidle" });
}

/** Back to the real agents list, also in the persisted cache, for the next shot. */
async function withoutSeedAgents(page: Page) {
  await page.unroute(/\/api\/agents$/);
  await page.reload({ waitUntil: "networkidle" });
}

/** The row of a Journal event (or a card) whose title is this, scrolled to the middle of the screen. */
async function scrollToRow(page: Page, title: string) {
  await page.getByText(title, { exact: true }).first().scrollIntoViewIfNeeded();
  await page
    .getByText(title, { exact: true })
    .first()
    .evaluate((node) => node.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(400);
}

async function unmockToday(page: Page) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

/**
 * The screens `pnpm screenshots` captures, at 390×844 and 1440×900.
 * Add your feature's screens here.
 */
/** The seed's Desk tidy-up as it was before a shot gave it long text, for the shot's cleanup. */
let deskTidyBefore: { title: string; note: string } | undefined;
async function giveDeskTidyLongText(page: Page) {
  const headers = { Origin: new URL(page.url()).origin };
  const item = (await (await page.request.get(`/api/items/${SEED_IDS.deskTidy}`)).json()) as {
    item?: { title: string; note: string };
    title?: string;
    note?: string;
  };
  const current = item.item ?? item;
  deskTidyBefore = { title: current.title ?? "Desk tidy-up", note: current.note ?? "" };
  await page.request.patch(`/api/items/${SEED_IDS.deskTidy}`, {
    headers,
    data: {
      title: "Supercalifragilisticexpialidocious desk tidy-up with clips, a drawer bin and a phone stand in blue PETG",
      note: "See https://www.example.org/models/a-very-long-address-that-has-no-spaces-in-it-at-all/and-keeps-going/and-going/model-487213-drawer-bins-final-v7 for the grid.",
    },
  });
}
async function restoreDeskTidy(page: Page) {
  if (!deskTidyBefore) return;
  await page.request.patch(`/api/items/${SEED_IDS.deskTidy}`, {
    headers: { Origin: new URL(page.url()).origin },
    data: deskTidyBefore,
  });
}

export const shots: Shot[] = [
  { name: "sign-in", path: "/sign-in", signedOut: true },
  { name: "link-code", path: "/link", signedOut: true, beforeShot: settle },
  {
    // An invite link opened by someone who isn't signed in: the form, filled in a little.
    name: "join",
    path: "/sign-in",
    signedOut: true,
    fullPage: true,
    beforeShot: settle,
    prepare: async (page) => {
      const token = await guestInvite(page);
      await page.goto(`/join#${token}`);
      await page.getByLabel("Your name").fill("Mina Park");
      await page.getByRole("radio", { name: "plum" }).click();
    },
  },
  {
    // A link that has done its job: one calm sentence.
    name: "link-used",
    path: "/link#spl_used",
    signedOut: true,
    beforeShot: settle,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByText("That link has done its job.").waitFor();
    },
  },
  {
    // After a password sign-in on a device with no passkey: one quiet offer.
    name: "passkey-offer",
    path: "/ideas",
    prepare: async (page) => {
      await page.evaluate(() => {
        sessionStorage.setItem("sg-passkey-ask", "1");
        sessionStorage.setItem("sg-force-offer", "1");
        localStorage.removeItem("sg-passkey-offer");
        localStorage.removeItem("sg-passkey-here");
      });
      await page.reload();
      await page.getByText(/^Next time, just /).waitFor({ timeout: 10_000 });
      await page.waitForTimeout(400);
    },
  },
  {
    // The account menu's "Signing in" rows.
    name: "account-signing-in",
    path: "/ideas",
    prepare: async (page) => {
      await openAccount(page, wide(page));
      await page.getByRole("dialog").getByRole("button", { name: "Passkeys and password" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "passkeys",
    path: "/ideas",
    prepare: async (page) => {
      await mockSigningIn(page);
      await openAccountRow(page, wide(page), "Passkeys and password");
      await page.getByRole("dialog", { name: "Passkeys and password" }).getByText("iPhone").first().waitFor();
    },
  },
  {
    name: "sign-in-on-another-device",
    path: "/ideas",
    prepare: async (page) => {
      await withShare(page);
      await openAccountRow(page, wide(page), "Sign in on another device");
      await page.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).waitFor();
      if (wide(page) === 1440) await page.getByRole("img", { name: /QR code/ }).waitFor();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "invite",
    path: "/ideas",
    prepare: async (page) => {
      await withShare(page);
      // The server counts a week from its own clock; the shot's browser clock is fixed to the seed date.
      const alex = (await (await page.request.get("/api/people")).json()).people[0].id;
      await page.route(/\/api\/account\/invites$/, (route) =>
        route.request().method() === "GET"
          ? route.fulfill({
              json: {
                invites: [
                  { id: "i1", createdBy: alex, createdAt: SEED_NOW - 86_400_000, expiresAt: SEED_NOW + 6 * 86_400_000 },
                ],
              },
            })
          : route.fallback(),
      );
      await openAccountRow(page, wide(page), "Invite someone");
      const sheet = page.getByRole("dialog", { name: "Invite someone" });
      await sheet.getByRole("button", { name: /^Make (an invite link|another invite)$/ }).click();
      await sheet.getByText(/\/join#spi_/).waitFor();
      await sheet.getByText("Waiting").waitFor();
    },
  },
  {
    // The same sheet, scrolled to the devices at its bottom.
    name: "passkeys-devices",
    path: "/ideas",
    prepare: async (page) => {
      await mockSigningIn(page);
      await openAccountRow(page, wide(page), "Passkeys and password");
      const sheet = page.getByRole("dialog", { name: "Passkeys and password" });
      await sheet.getByText("iPad").scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    },
  },
  {
    name: "styleguide-signing-in",
    path: "/styleguide",
    selector: "#signing-in",
    // The styleguide's avatar specimen has a deliberately missing picture: let it fall back before the images are checked.
    prepare: async (page) => {
      await page.waitForTimeout(1200);
    },
  },
  // The phone's Journal opens on what is happening now: every part, and the least (one print, nothing else).
  {
    name: "journal-now",
    path: "/journal",
    width: 390,
    prepare: async (page) => {
      await page.locator("section[aria-label='On the bed']").or(page.locator("#now-bed")).first().waitFor();
      await page.waitForTimeout(1500);
    },
  },
  {
    name: "journal-now-one",
    path: "/journal",
    width: 390,
    prepare: async (page) => {
      await mockToday(page, { builds: "all", journal: "all", spools: "all", ideas: "all", onePrint: true });
      await page.locator("section[aria-label='On the bed']").waitFor();
      await page.waitForTimeout(1500);
    },
    cleanup: unmockToday,
  },
  // Today: full (two prints, one that should be done by now), partly empty, quiet and brand new.
  {
    name: "today",
    path: "/today",
    fullPage: true,
    // The scout's pictures come from the Worker: let them land before the shot.
    prepare: async (page) => {
      await page.locator("section[aria-labelledby=today-scout] img").first().waitFor();
      await page
        .waitForFunction(() =>
          Array.from(document.querySelectorAll("section[aria-labelledby=today-scout] img")).every(
            (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
          ),
        )
        .catch(() => undefined);
      // The pictures fade in once decoded.
      await page.waitForTimeout(700);
    },
  },
  {
    // One of the three answered: the block counts what is left.
    name: "today-scout-answered",
    path: "/today",
    fullPage: true,
    prepare: async (page) => {
      await mockScout(page, "one");
      await page.getByRole("heading", { name: "Two for you this week" }).waitFor();
      await page.waitForTimeout(900);
    },
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
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
    // Today with the drawer divider off the bed: Claude's guess hinted on its button, with why. Before the comment
    // shots: opening a thread marks it read.
    name: "today-guess",
    path: "/today",
    width: 1440,
    why: "Today is desktop-only",
    // The drawer divider shows twice on Today (its bed card and a pick-up card): the one with the hinted button.
    selector: "article:has-text('Drawer divider'):has-text('suggested')",
    prepare: async (page) => {
      await page
        .getByRole("radio", { name: /suggested/ })
        .first()
        .waitFor({ timeout: 20_000 });
    },
  },
  {
    // Back after a few days: "Since Thursday", what Sam did meanwhile, at the top of Today (desktop).
    name: "today-since",
    path: "/today",
    prepare: async (page) => {
      await catchUpFrom(page, 4);
      await page
        .getByText(/^Since /)
        .first()
        .waitFor();
    },
    cleanup: forgetCatchUp,
  },
  {
    // The one quiet line for what Sam wrote and Alex hasn't read, under what is on the bed.
    name: "today-comments",
    path: "/today",
    fullPage: true,
    prepare: async (page) => {
      await page.getByRole("link", { name: /Sam Okafor on .*: / }).waitFor();
    },
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
    width: 1440,
    why: "Today is desktop-only",
    prepare: async (page) => {
      // Up next ideas (Desk tidy-up, the knob) are queued, which isn't quiet: take the queue off first.
      await setQueue(page, 0);
      await mockToday(page, { builds: "none", journal: "none", spools: "none", ideas: "young" });
      await waitUntilEased(page, "All quiet in the kitchen");
    },
    cleanup: async (page) => {
      await unmockToday(page);
      await setQueue(page, 2);
    },
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
  {
    // Long words and long lines everywhere an idea shows: in the grid and on its own page.
    name: "ideas-long-text",
    path: "/ideas",
    prepare: async (page) => {
      await giveDeskTidyLongText(page);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: /^Up next/ }).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: restoreDeskTidy,
  },
  {
    name: "idea-long-text",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await giveDeskTidyLongText(page);
      await page.reload();
      await page.getByRole("textbox", { name: "Title" }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: restoreDeskTidy,
  },
  { name: "ideas", path: "/ideas" },
  {
    // A photo tile with a long title: two lines, then cut.
    name: "ideas-up-next-long",
    path: "/ideas",
    prepare: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      await setQueue(page, 4);
      await page.request.patch(`/api/items/${SEED_IDS.deskTidy}`, {
        headers,
        data: { title: "Desk tidy-up with clips, a drawer bin and a phone stand in blue PETG" },
      });
      await page.reload();
      await page.getByRole("heading", { level: 2, name: /^Up next\s*4$/ }).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: async (page) => {
      await page.request.patch(`/api/items/${SEED_IDS.deskTidy}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { title: "Desk tidy-up" },
      });
      await setQueue(page, 2);
    },
  },
  {
    // The menu opened from a tile in the strip (a sheet on phones; the popover on desktop's full cards).
    name: "ideas-up-next-menu-tile",
    path: "/ideas",
    prepare: async (page) => {
      await setQueue(page, 4);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: /^Up next\s*4$/ }).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      await page.getByRole("button", { name: "Options for Desk tidy-up" }).click();
      await page.getByRole("button", { name: "Take off Up next" }).waitFor();
      await page.waitForTimeout(900);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await setQueue(page, 2);
    },
  },
  {
    // Up next with 1 queued idea: a strip of small cards.
    name: "ideas-up-next-1",
    path: "/ideas",
    prepare: async (page) => {
      const count = 1;
      await setQueue(page, count);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: new RegExp(`^Up next\\s*${count}$`) }).waitFor();
      await page.waitForTimeout(500);
      // Cards that arrived after the first draw fade in on the shots' fixed clock: finish them.
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: (page) => setQueue(page, 2),
  },
  {
    // Up next with 3 queued ideas: a strip of small cards.
    name: "ideas-up-next-3",
    path: "/ideas",
    prepare: async (page) => {
      const count = 3;
      await setQueue(page, count);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: new RegExp(`^Up next\\s*${count}$`) }).waitFor();
      await page.waitForTimeout(500);
      // Cards that arrived after the first draw fade in on the shots' fixed clock: finish them.
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: (page) => setQueue(page, 2),
  },
  {
    // Up next with 6 queued ideas: a strip of small cards.
    name: "ideas-up-next-6",
    path: "/ideas",
    prepare: async (page) => {
      const count = 6;
      await setQueue(page, count);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: new RegExp(`^Up next\\s*${count}$`) }).waitFor();
      await page.waitForTimeout(500);
      // Cards that arrived after the first draw fade in on the shots' fixed clock: finish them.
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: (page) => setQueue(page, 2),
  },
  {
    // Up next with 8 queued ideas: a strip of small cards on both.
    name: "ideas-up-next-8",
    path: "/ideas",
    prepare: async (page) => {
      const count = 8;
      await setQueue(page, count);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: new RegExp(`^Up next\\s*${count}$`) }).waitFor();
      await page.waitForTimeout(500);
      // Cards that arrived after the first draw fade in on the shots' fixed clock: finish them.
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: (page) => setQueue(page, 2),
  },
  {
    // Every kind of idea in Up next: a photo, a note with no title and a bare link.
    name: "ideas-up-next-kinds",
    path: "/ideas",
    prepare: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      await setQueue(page, 0);
      await page.request.patch(`/api/items/${COFFEE_CLIPS}`, {
        headers,
        data: { note: "https://www.ikea.com/se/en/p/skadis-pegboard-white-20320802/" },
      });
      for (const id of [COFFEE_CLIPS, SEED_QUEUE[1], SEED_IDS.deskTidy]) {
        await page.request.patch(`/api/items/${id}`, { headers, data: { upNext: true } });
      }
      await page.reload();
      await page.getByRole("heading", { level: 2, name: /^Up next\s*3$/ }).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: async (page) => {
      await page.request.patch(`/api/items/${COFFEE_CLIPS}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { note: "Bag clips for the coffee, with a little spoon holder on the side." },
      });
      await setQueue(page, 2);
    },
  },
  {
    // One idea put in Up next: a one-line toast with its place ("In Up next · 3rd"); U on desktop, the menu on phones.
    name: "ideas-up-next-toast-one",
    path: "/ideas",
    prepare: async (page) => {
      await queueFirstInbox(page);
      await page.getByText("In Up next · 3rd").waitFor();
      await settleToast(page);
    },
    cleanup: (page) => setQueue(page, 2),
  },
  {
    // Two in a row (keyboard triage): one toast that counts them, not two.
    name: "ideas-up-next-toast",
    path: "/ideas",
    prepare: async (page) => {
      await queueFirstInbox(page);
      await queueFirstInbox(page);
      await page.getByText("2 added to Up next").waitFor();
      await settleToast(page);
    },
    cleanup: (page) => setQueue(page, 2),
  },
  {
    // "Needs designing" picked beside The rest: the ink pill around the label and its count.
    name: "ideas-needs-designing",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Needs designing/ }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    // A filter that empties the inbox keeps its own way back, and says which it is. Only ideas with a model are left
    // beside Up next, so "Needs designing 0" finds nothing.
    name: "ideas-filter-empty",
    path: "/ideas",
    prepare: async (page) => {
      const keep = new Set([...SEED_QUEUE, SEED_IDS.bigTugboat, "5eed0000-0000-4000-8000-000000000011"]);
      await page.route(/\/api\/items\?stage=idea/, async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as { items: Array<{ id: string }> };
        await route.fulfill({ response, json: { ...json, items: json.items.filter((item) => keep.has(item.id)) } });
      });
      await page.reload();
      await page.getByRole("button", { name: /^Needs designing/ }).click();
      await page.getByText(/Tap “Needs designing” again/).waitFor();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(400);
    },
    cleanup: unmockToday,
  },
  {
    // The phone's Wishlists line when you haven't picked any yet.
    name: "ideas-wishlists-none",
    path: "/ideas",
    width: 390,
    prepare: (page) => mockWishlists(page, "none"),
    cleanup: unmockToday,
  },
  {
    // The phone's Wishlists line when Sam keeps theirs private: only yours is counted.
    name: "ideas-wishlists-private",
    path: "/ideas",
    width: 390,
    prepare: (page) => mockWishlists(page, "private"),
    cleanup: unmockToday,
  },
  {
    // A long inbox (two-digit counts beside The rest), at the narrowest phones too (--width 375).
    name: "ideas-many",
    path: "/ideas",
    prepare: async (page) => {
      await page.route(/\/api\/items\?stage=idea/, async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as { items: Array<{ id: string; upNext: number | null }> };
        const copies = [1, 2].flatMap((round) =>
          json.items
            .filter((item) => item.upNext === null)
            .map((item) => ({ ...item, id: `${item.id.slice(0, -2)}${round}${round}` })),
        );
        await route.fulfill({ response, json: { ...json, items: [...json.items, ...copies] } });
      });
      await page.reload();
      await page.getByRole("button", { name: /^Needs designing \d\d/ }).waitFor();
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: unmockToday,
  },
  {
    // A notebook with no ideas and nothing started: the empty pot.
    name: "ideas-empty",
    path: "/ideas",
    prepare: async (page) => {
      await mockToday(page, { builds: "none", journal: "none", spools: "none", ideas: "none" });
      await page.reload();
      await waitUntilEased(page, "Nothing simmering yet");
    },
    cleanup: unmockToday,
  },
  {
    // A card with several photos swiped to its second (and hovered, where a mouse shows the arrows).
    name: "ideas-swiped",
    path: "/ideas",
    // Desk tidy-up is the one idea with several photos, and it sits in Up next (small cards, one photo): take the queue off first.
    prepare: async (page) => {
      await setQueue(page, 0);
      await page.reload();
      await page.getByRole("heading", { level: 2, name: "The rest" }).waitFor();
    },
    cleanup: (page) => setQueue(page, 2),
    beforeShot: async (page) => {
      // The list re-renders as the queue empties (cards leave Up next and rejoin The rest): let it settle, or the card
      // found now is gone by the time it is scrolled to.
      await page.waitForTimeout(800);
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      const card = page.getByRole("listitem").filter({ hasText: "Desk tidy-up" });
      await card.waitFor();
      await card.scrollIntoViewIfNeeded();
      await card.locator(".snap-x").evaluate((el) => el.scrollTo({ left: el.clientWidth, behavior: "instant" }));
      if (wide(page) === 1440) await card.hover();
      await page.waitForTimeout(500);
    },
  },
  { name: "ideas-started", path: "/ideas", fullPage: true },
  { name: "wishlist", path: "/wishlist", prepare: waitForWishlist },
  {
    // The other person's list, on the phone's switch.
    name: "wishlist-theirs",
    path: "/wishlist",
    width: 390,
    prepare: async (page) => {
      await waitForWishlist(page);
      await page.getByRole("radio", { name: "Sam's" }).check({ force: true });
      await page.getByRole("list", { name: "Sam's wishlist" }).waitFor();
    },
  },
  {
    // A row picked up by its handle, halfway to its new place.
    name: "wishlist-dragging",
    path: "/wishlist",
    prepare: async (page) => {
      await waitForWishlist(page);
      const handle = page.getByRole("button", { name: /^Move Wall mount for the router/ });
      const box = await handle.boundingBox();
      if (!box) throw new Error("No handle to drag");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      for (let step = 1; step <= 8; step++) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - step * 8);
        await page.waitForTimeout(30);
      }
      await page.waitForTimeout(300);
    },
    cleanup: async (page) => {
      await page.mouse.up();
    },
  },
  {
    name: "wishlist-picker",
    path: "/wishlist",
    prepare: async (page) => {
      await waitForWishlist(page);
      await page.getByRole("button", { name: "Pick ideas" }).click();
      await page.getByRole("dialog", { name: "Pick your top ideas" }).waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    // Nothing picked yet, and the other list kept private (the answer is shaped by hand).
    name: "wishlist-empty",
    path: "/wishlist",
    prepare: async (page) => {
      await page.route("**/api/wishlists", async (route) => {
        const response = await route.fetch();
        const { wishlists } = (await response.json()) as { wishlists: Array<Record<string, unknown>> };
        const [mine, ...others] = wishlists;
        await route.fulfill({
          response,
          json: {
            wishlists: [{ ...mine, entries: [] }, ...others.map((list) => ({ ...list, private: true, entries: [] }))],
          },
        });
      });
      await page.reload();
      await page.getByRole("heading", { name: "Nothing on your plate yet" }).waitFor();
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: async (page) => {
      await page.unroute("**/api/wishlists");
    },
  },
  {
    // Scrapping a build that began as an idea: it is back in Ideas, with an Undo.
    name: "build-scrapped",
    path: `/builds/${SEED_BUILD_IDS.headphoneStand}`,
    prepare: async (page) => {
      // Two steps (decision 0062): the trash can asks "Scrap this build?" in place, then "Scrap" does it.
      await page.getByRole("button", { name: "Scrap build" }).click();
      await page.getByRole("button", { name: "Scrap", exact: true }).click();
      await page.getByText("Build scrapped").waitFor();
      await page.getByRole("heading", { level: 1, name: "Ideas" }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForTimeout(800);
    },
  },
  {
    // Recently deleted: an idea, an idea with a photo, and a build, deleted a moment ago (restored after the shot).
    name: "deleted",
    path: "/deleted",
    prepare: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      for (const id of [SEED_IDS.deskTidy, SEED_BUILD_IDS.headphoneStand]) {
        await page.request.delete(`/api/items/${id}`, { headers });
      }
      await page.reload();
      await page.getByRole("heading", { level: 1, name: "Deleted" }).waitFor();
      await page
        .getByRole("button", { name: /^Restore/ })
        .first()
        .waitFor();
    },
    cleanup: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      for (const id of [SEED_IDS.deskTidy, SEED_BUILD_IDS.headphoneStand]) {
        await page.request.post(`/api/items/${id}/restore`, { headers });
      }
    },
  },
  {
    // The card's menu in the Up next queue: a place up or down, or off the queue.
    name: "ideas-up-next-menu",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Options for Replacement knob/ }).click();
      await page.getByRole("button", { name: "Move up" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // A card in the middle of the queue: its menu has Move up and Move down. A third idea joins the queue for the shot.
    name: "ideas-up-next-menu-middle",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Options for Hook for the bike helmet/ }).click();
      await page.getByRole("button", { name: "Up next", exact: true }).click();
      // Let the "Up next" toast go, so it doesn't cover the menu's rows.
      await page.locator("[data-sonner-toast]").first().waitFor({ state: "detached", timeout: 10_000 });
      await page.getByRole("button", { name: /^Options for Replacement knob/ }).click();
      await page.getByRole("button", { name: "Move down" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /^Options for Hook for the bike helmet/ }).click();
      await page.getByRole("button", { name: "Take off Up next" }).click();
    },
  },
  { name: "builds", path: "/builds", fullPage: true },
  {
    // Nothing on the plate: no On the bed section, In progress leads.
    name: "builds-nothing-printing",
    path: "/builds",
    prepare: async (page) => {
      await keepBuilds(page, (item) => !item.attempts?.some((attempt) => attempt.outcome === null));
      // Main's list has these under On the bed: wait for a heading both draw.
      await page
        .getByRole("heading", { name: /^(In progress|On the bed)/ })
        .first()
        .waitFor();
    },
    cleanup: unmockToday,
  },
  {
    // Every build in progress is printing: In progress says so in a line.
    name: "builds-all-on-the-bed",
    path: "/builds",
    fullPage: true,
    prepare: async (page) => {
      await keepBuilds(
        page,
        (item) => item.stage !== "building" || !!item.attempts?.some((attempt) => attempt.outcome === null),
      );
      await page
        .getByRole("heading", { name: /^On the bed/ })
        .first()
        .waitFor();
    },
    cleanup: unmockToday,
  },
  {
    // The common case on a phone: one print on the bed, the big card.
    name: "builds-one-print",
    path: "/builds",
    width: 390,
    prepare: async (page) => {
      await keepBuilds(
        page,
        (item) => !item.attempts?.some((attempt) => attempt.outcome === null) || item.id === SEED_BUILD_IDS.towelHook,
      );
      await page
        .getByRole("heading", { name: /^On the bed/ })
        .first()
        .waitFor();
    },
    cleanup: unmockToday,
  },
  {
    // The print that waits for "how did it go?", where a phone shows it on the first screen (a full-page shot draws
    // the tab bar over it).
    name: "builds-off-bed",
    path: "/builds",
    width: 390,
    prepare: async (page) => {
      const card = page.getByRole("heading", { name: "Drawer divider", level: 3 }).first();
      await card.waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // No builds at all: the empty state, and no floating New build beside its button.
    name: "builds-empty",
    path: "/builds",
    prepare: async (page) => {
      await keepBuilds(page, () => false);
      await page.getByRole("heading", { name: /^Nothing (cooking yet|on the bed)$/ }).waitFor();
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      await page.waitForTimeout(600);
    },
    cleanup: unmockToday,
  },
  {
    // "Pick up again" on a shelved build, and its toast.
    name: "build-picked-up-again",
    path: `/builds/${SEED_IDS.planter}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^(Pick up again|Back on the bed)$/ })
        .filter({ visible: true })
        .first()
        .click();
      await page
        .getByText(/^(Back in progress|Back on the bed)$/)
        .first()
        .waitFor();
    },
    cleanup: async (page) => {
      await page.request.patch(`/api/items/${SEED_IDS.planter}`, {
        data: { stage: "shelved" },
        headers: { Origin: new URL(page.url()).origin },
      });
    },
  },
  {
    // The stage's word in search: a build between prints.
    name: "search-in-progress",
    path: "/search?q=chain",
    prepare: async (page) => {
      await page.getByRole("region", { name: "Builds" }).waitFor();
      await page.getByRole("searchbox", { name: "Search" }).blur();
    },
  },
  {
    // The stage's word in the palette.
    name: "palette-in-progress",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("chain");
      await page
        .getByRole("option", { name: /^Cable chain\b/ })
        .first()
        .waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // The end of a build page on a phone: "Finish attempt" must sit above the tab bar (try it with --iphone).
    name: "build-bottom",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    width: 390,
    beforeShot: async (page) => {
      // The thread loads after the page: wait for it, then go to the very end (the closing actions above the bar).
      await showThread(page);
    },
  },
  {
    // The end of the Pantry on a phone: "Add spool" above the tab bar.
    name: "pantry-bottom",
    path: "/pantry",
    width: 390,
    beforeShot: async (page) => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    },
  },
  { name: "build", path: `/builds/${SEED_BUILD_IDS.tugboat}`, fullPage: true },
  // A build between prints: its stage chip says In progress (it isn't on the bed).
  { name: "build-between-prints", path: `/builds/${SEED_BUILD_IDS.cableChain}` },
  {
    // The build's own photo showing, tapped again: its menu, as on an idea (an attempt's photos come off in its sheet).
    name: "build-photo-menu",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Photo 1/ }).click();
      await page.getByRole("button", { name: "Remove photo" }).waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // The first press of Delete on a build: the trash can has turned into the question, in the bar.
    name: "build-delete-confirm",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^(Delete|Scrap) build$/ }).click();
      await page.getByRole("button", { name: /^(Delete|Scrap)$/ }).waitFor();
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
  },
  // An idea with a sliced file kept with it: the file's card under the chips, and the sticker on its card.
  { name: "idea-file", path: `/ideas/${SEED_IDS.bigTugboat}`, fullPage: true },
  {
    // A kept file's "…" beside its Download: Remove is in there, not an X on the card.
    name: "idea-file-menu",
    path: `/ideas/${SEED_IDS.bigTugboat}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^More for / })
        .first()
        .click();
      await page.getByRole("button", { name: "Remove file" }).waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // A second file added to the idea: it shows at once, with the plate's picture.
    name: "idea-file-added",
    path: `/ideas/${SEED_IDS.bigTugboat}`,
    prepare: async (page) => {
      await page.getByTestId("idea-file-input").setInputFiles({
        name: SLICER_FILE_NAME,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(slicerFile()),
      });
      await page.getByText(SLICER_FILE_NAME).waitFor();
    },
    // Both cards in view, clear of the action bar and the tab bar on a phone.
    beforeShot: async (page) => {
      await page.getByRole("button", { name: "Add a file" }).evaluate((button) => {
        button.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(300);
    },
  },
  {
    // A model (.stl) dropped on an idea, slicing in the browser: its picture is drawn, the engine is on its way (held
    // here, so the shot always finds it slicing).
    name: "idea-model-slicing",
    path: "/ideas",
    prepare: async (page) => {
      await page.route("**/slicer/*/engine-st.wasm", () => undefined);
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Slicing \d+%/);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await removeModelItems(page);
    },
  },
  {
    // A big model (48 MB, over what one request carries) on its way in parts, held after the first (decision 0048).
    name: "idea-big-model-saving",
    path: "/ideas",
    prepare: async (page) => {
      await page.route("**/slicer/*/engine-st.wasm", (route) => route.abort());
      await page.route(/\/api\/uploads\/[^/]+\/file\/[^/]+\/2$/, () => undefined);
      await ideaWithBigModel(page, /Saving \d+%/);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await removeModelItems(page);
    },
  },
  {
    // The same file when the network let go: it says so, keeps the file, and offers another go.
    name: "idea-big-model-stuck",
    path: "/ideas",
    prepare: async (page) => {
      await page.route("**/slicer/*/engine-st.wasm", (route) => route.abort());
      await page.route(/\/api\/uploads\/[^/]+\/file\/[^/]+\/2$/, (route) => route.abort("connectionfailed"));
      await ideaWithBigModel(page, /Didn't finish saving/);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await removeModelItems(page);
    },
  },
  {
    // The model sliced, on an idea with no photo: its plate picture is the cover, the add-photo wells smaller under
    // it; on desktop the card beside it leads with the print (about how long, how many grams), then the file and how
    // Spaghetti sliced it.
    name: "idea-model",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await page.getByRole("img", { name: `Slicer preview: ${FUSILLI_IDEA.title}` }).waitFor();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(300);
    },
    cleanup: removeModelItems,
  },
  {
    // The same idea's model card on a phone, further down the page.
    name: "idea-model-card",
    path: "/ideas",
    width: 390,
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // A MakerWorld link pasted as the whole note (the Flexi Mini Hummingbird, with its ?from=search#profileId-…): the
    // model's card says it, once; the note reads as empty.
    name: "idea-makerworld-link",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithLink(page, "Flexi Mini Hummingbird", FLEXI_LINK);
    },
    cleanup: removeLinkIdeas,
  },
  {
    // The same link inside a sentence: it reads as the model's title there, and the card is still the only one.
    name: "idea-makerworld-words",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithLink(page, "Hummingbirds for the window", `Green and gold, for the kitchen window: ${FLEXI_LINK}`);
    },
    cleanup: removeLinkIdeas,
  },
  {
    // On a computer, "Open in Bambu Studio" on the model's card and beside the idea's other quiet actions (the one
    // model's page-level way in); a phone has neither (idea-model-card).
    name: "idea-model-open",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      await page.getByTestId("open-in-studio").first().waitFor();
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // A tap on it, then the sliced file: the browser can't tell whether Bambu Studio opened, so the card says where the
    // download is.
    name: "idea-model-open-tried",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      await page.getByTestId("open-in-studio").first().click();
      await page.getByTestId("open-in-studio-sliced").click();
      await page.getByText("Nothing opened?").first().waitFor();
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // A sliced model has two things to open: its sliced file, ready to print, and the original model, to slice or tweak.
    name: "idea-model-open-menu",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      await modelInView(page);
      await page.getByTestId("open-in-studio").first().click();
      await page.getByTestId("open-in-studio-sliced").waitFor();
    },
    cleanup: removeModelItems,
  },
  {
    // An idea with a model and no photo, in the Ideas list: the model's plate picture is its card's picture.
    name: "ideas-model-cover",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      // The list shows its saved copy first (the shots before this one left their ideas in it): wait for the fresh one.
      await page.goto("/ideas", { waitUntil: "networkidle" });
      const alt = `Slicer preview: ${FUSILLI_IDEA.title}`;
      await page.waitForFunction((name) => document.querySelectorAll(`img[alt="${name}"]`).length === 1, alt);
      const cover = page.getByRole("img", { name: alt });
      await cover.evaluate((img) => img.closest("li")?.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(400);
    },
    cleanup: removeModelItems,
  },
  {
    // How to slice it (decision 0047): a popover hanging below the card on desktop, a tall sheet on phones, with the four big
    // choices, More, and the engine's source and the files; on a phone the result sits at the thumb.
    name: "slice-settings",
    path: "/ideas",
    prepare: async (page) => {
      await openSliceSettings(page);
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A model with colours of its own: the Filament section lists each colour and the spool that prints it, every row
    // closed. A phone's sheet at its top (Colours under Quality, Strength and Supports); the desktop panel must fit.
    name: "slice-settings-colours",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      // On a phone the sheet scrolls to Supports, so Colours is seen where it sits, under the other choices.
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await settings
          .getByRole("group", { name: "Supports" })
          .evaluate((group) => group.scrollIntoView({ block: "start", behavior: "instant" }));
      }
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The same with the first colour opened: the Pantry's spools in place, the picked one in view.
    name: "slice-settings-colours-open",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "first");
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The second colour opened: its header stays in the right half, the picker spans under the pair.
    name: "slice-settings-colours-open-second",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "second");
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A colour no spool is near (the grape): a dashed ring and "Not in the Pantry yet", opened to its stand-in.
    name: "slice-settings-colours-stand-in",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "stand-in");
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A pick shows at once: the row, the tile and the status line take the colour while the slice is still running.
    name: "colour-pick-midslice",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "first");
      await settings.getByText("Any colour…").first().click({ force: true });
      await settings.locator('button[role="radio"][aria-label="Neon yellow"]').last().click({ force: true });
      await settings.getByText(/^Slicing with/).waitFor({ timeout: 30_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The zipper pull in neon yellow and black: the Colours rows, each a stand-in in its colour.
    name: "zipper-colours",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await tryNeonAndBlack(page);
      await settings
        .getByRole("button", { name: /^Colours/ })
        .evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The same, the cover: the picture as it prints, with the switch to the model's own colours.
    name: "zipper-cover",
    path: "/ideas",
    prepare: async (page) => {
      await tryNeonAndBlack(page);
      await page.keyboard.press("Escape");
      await page.getByRole("radio", { name: "In our filaments" }).waitFor();
      await page.waitForTimeout(800);
    },
    cleanup: removeModelItems,
  },
  {
    // The same in 3D after slicing: the legend names the colours.
    name: "zipper-3d",
    path: "/ideas",
    prepare: async (page) => {
      await tryNeonAndBlack(page);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: `See ${HOTDOG.name} in 3D` }).click();
      await page.getByRole("dialog", { name: "3D view" }).locator("[data-viewer=ready]").waitFor({ timeout: 60_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(600);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await removeModelItems(page);
    },
  },
  {
    // A one-filament model's Filament choice with a colour from the palette picked.
    name: "slice-settings-filament-any",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      const group = settings.getByText("Any colour…");
      await group.click({ force: true });
      await settings.locator('button[role="radio"][aria-label="Neon yellow"]').click({ force: true });
      await settings.getByText("a stand-in to try").first().waitFor({ timeout: 30_000 });
      await settings
        .getByRole("radiogroup", { name: "Any colour" })
        .evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // Any colour…: the palette under a row's spools, a neon yellow picked as the stand-in to try.
    name: "slice-settings-colours-any",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "first");
      await settings.getByText("Any colour…").first().click({ force: true });
      await settings.getByRole("radio", { name: "Neon yellow" }).click({ force: true });
      // The pick is kept: the row says so once the settings have it.
      await settings.getByText("a stand-in to try").first().waitFor({ timeout: 30_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A model with colours of its own, on an idea with no photo: its picture as it prints in our filaments (the
    // Pantry's spools matched to each colour), with the switch to the model's own colours under it.
    name: "idea-model-colours",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(page, HOTDOG_IDEA, HOTDOG, /Sliced by/);
      await sliceSaved(page);
      await page.getByRole("radio", { name: "In our filaments" }).waitFor();
    },
    cleanup: removeModelItems,
  },
  {
    // The same, on "Model's colours": the picture as the file has them.
    name: "idea-model-colours-original",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(page, HOTDOG_IDEA, HOTDOG, /Sliced by/);
      await sliceSaved(page);
      await page.getByRole("radio", { name: "Model's colours" }).click();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("figure img")).every((img) => (img as HTMLImageElement).complete),
      );
    },
    cleanup: removeModelItems,
  },
  {
    // The Colours block opened: every colour and its spool.
    name: "slice-settings-colours-rows",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "none");
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A Bambu project's filaments (a MakerWorld file): each matched to a spool, listed as a model's colours are.
    name: "slice-settings-colours-project",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: PLAQUE_IDEA, file: PLAQUE });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "none");
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The same project's cover: as it prints in our filaments, with the switch to the project's own colours.
    name: "idea-model-colours-project",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(page, PLAQUE_IDEA, PLAQUE, /Sliced by/);
      await sliceSaved(page);
      await page.getByRole("radio", { name: "In our filaments" }).waitFor();
    },
    cleanup: removeModelItems,
  },
  {
    // Keyboard focus on a colour's row.
    name: "slice-settings-colours-focus",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await settings.getByText("Colours", { exact: true }).waitFor();
      await openColour(page, settings, "none");
      const row = settings.locator("li button[aria-expanded]").nth(1);
      await row.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
      // A key first, so the focus ring shows as it does for the keyboard.
      await page.keyboard.press("Shift");
      await row.focus();
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The panel opened by the key: focus starts on the picked tile of the first group, with its ring.
    name: "slice-settings-focus",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: HOTDOG_IDEA, file: HOTDOG });
      await page.keyboard.press("Shift");
      await settings.getByRole("group", { name: "Strength" }).getByRole("radio").nth(1).focus();
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // Lay it down (decision 0050): the faces a bracket can rest on, each a plate picture of it lying so, "As designed"
    // first and picked. A phone's sheet is scrolled to them.
    name: "slice-settings-lay",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: BRACKET_IDEA, file: BRACKET });
      const lay = settings.getByRole("group", { name: "Lay it down" });
      await lay.getByRole("radio").nth(1).waitFor();
      // The pictures are drawn in a worker: wait until they have loaded.
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('[role="dialog"] fieldset img')).every(
          (img) => (img as HTMLImageElement).complete,
        ),
      );
      await lay.evaluate((group) => group.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A project with three plates, its settings open: the plates' pictures in the header, beside the title.
    name: "slice-settings-plates",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: BINS_IDEA, file: BINS });
      await settings
        .getByRole("radiogroup")
        .or(settings.getByRole("group", { name: "Plates" }))
        .first()
        .waitFor();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('[role="dialog"] fieldset img')).every(
          (img) => (img as HTMLImageElement).complete,
        ),
      );
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // "Slice every plate": each plate sliced with these settings only to compare, its time under its picture.
    name: "slice-settings-plates-compared",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: BINS_IDEA, file: BINS });
      await settings.getByRole("button", { name: /^Slice all 3/ }).click();
      await settings.getByText(/^Slicing \d of 3/).waitFor();
      await settings.getByRole("button", { name: /^Slice all 3/ }).waitFor({ state: "detached", timeout: 120_000 });
      await settings.getByText(/^Slicing \d of 3/).waitFor({ state: "detached", timeout: 120_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A set of seven plates: more than fit beside the title, so the row scrolls sideways.
    name: "slice-settings-plates-many",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: { ...BINS_IDEA, title: "Bin set" }, file: MANY_BINS });
      await settings.getByRole("group", { name: "Plates" }).waitFor();
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The third plate chosen: sliced again, the card's summary saying "Plate 3".
    name: "idea-model-plate-chosen",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: BINS_IDEA, file: BINS });
      await settings.getByRole("radio", { name: /^Plate 3/ }).click({ force: true });
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // Lay it down on a model with no flat side (glasses on narrow rims): the side it stands on at a few spots, picked,
    // with the tile's line saying so.
    name: "slice-settings-lay-spots",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, GLASSES_IDEA, GLASSES, /can't be printed/);
      await modelInView(page);
      await files.getByRole("button", { name: /^Slice with…/ }).click();
      const settings = page.getByRole("dialog", { name: "How to slice it" });
      const lay = settings.getByRole("group", { name: "Lay it down" });
      await lay.getByRole("radio").nth(1).waitFor();
      await lay.getByRole("radio").nth(1).click();
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('[role="dialog"] fieldset img')).every(
          (img) => (img as HTMLImageElement).complete,
        ),
      );
      await lay.evaluate((group) => group.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The bracket laid on its side: sliced again in the background, then what the change did and its undo, the
    // card's line saying "on its side".
    name: "slice-settings-laid",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page, { idea: BRACKET_IDEA, file: BRACKET });
      const lay = settings.getByRole("group", { name: "Lay it down" });
      await lay
        .getByRole("radio", { name: /^On side/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      await page.waitForTimeout(200);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // Quality changed to Fine: the model slices again in the background, the slice there (its plate, its figures)
    // kept in view until the new one is ready, with Stop.
    name: "slice-settings-reslicing",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      await settings.getByRole("radio", { name: /^Fine/ }).click();
      // On desktop the card above the popover says it, on a phone the sheet's foot.
      await page
        .getByText(/Slicing with Fine · [1-9]\d?%/)
        .first()
        .waitFor({ timeout: 90_000 });
    },
    cleanup: closeSliceSettings,
  },
  {
    // The card while it slices again, its settings closed: the progress in place of its line, which keeps its room,
    // and the figures there quieter, as they are the slice being replaced.
    name: "idea-model-reslicing",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      await settings.getByRole("radio", { name: /^Fine/ }).click();
      await page
        .getByText(/Slicing with Fine · [1-9]\d?%/)
        .first()
        .waitFor({ timeout: 90_000 });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      // Closed with a key, focus is back on "Slice with…" with its ring (a sheet hands it back 60 ms after it
      // closes): a tap leaves none.
      await page.waitForTimeout(200);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await modelInView(page);
    },
    cleanup: removeModelItems,
  },
  {
    // Sliced Fine: what the change did, before → after, and its undo.
    name: "slice-settings-changed",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      await settings.getByRole("radio", { name: /^Fine/ }).click();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // Copies (#366): ×4 asked for at the foot of the settings; the plate shows four, and the result says each one's time.
    name: "slice-settings-copies",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      const copies = settings.getByRole("group", { name: "Copies" });
      for (let i = 0; i < 3; i++) await copies.getByRole("button", { name: "Copies: one more" }).click();
      await settings.getByText("× 4", { exact: false }).first().waitFor();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 120_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // Four copies sliced: the 3D view says what one copy measures (width, depth, height), and the card too.
    name: "idea-model-size-3d",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      const copies = settings.getByRole("group", { name: "Copies" });
      for (let i = 0; i < 3; i++) await copies.getByRole("button", { name: "Copies: one more" }).click();
      await settings.getByText("× 4", { exact: false }).first().waitFor();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 120_000 });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      await page.waitForTimeout(300);
      await page
        .getByRole("button", { name: /^See .* in 3D$/ })
        .first()
        .click();
      await page.getByRole("dialog", { name: "3D view" }).locator("[data-viewer=ready]").waitFor({ timeout: 60_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await closeSliceSettings(page);
    },
  },
  {
    // The card after the change, its settings closed: it leads with what the change did, and offers the undo.
    name: "idea-model-changed",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      await settings.getByRole("radio", { name: /^Fine/ }).click();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      // Closed with a key, focus is back on "Slice with…" with its ring (a sheet hands it back 60 ms after it
      // closes): a tap leaves none.
      await page.waitForTimeout(200);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // Slicing with a recipe (decision 0051): what worked before, in one tap, and the model sliced again with it.
    name: "slice-settings-recipe",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      await settings.getByRole("button", { name: /^From a recipe/ }).click();
      await settings.getByRole("button", { name: "PLA bins, fast and square" }).click();
      // In the sheet's result on a phone, on the card below the popover on desktop.
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A recipe for another filament (PETG for a PLA model): set apart from those for its own on a phone, and the
    // line under them says the filament it brought.
    name: "slice-settings-recipe-other",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      await settings.getByRole("button", { name: /^From a recipe/ }).click();
      await settings.getByRole("button", { name: "PETG, dried and 245 °C" }).click();
      // In the sheet's result on a phone, on the card below the popover on desktop.
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // More, open: how supports are built, the brim, walls and infill by number, the pattern, plate, nozzle and size.
    name: "slice-settings-more",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      // The kind of supports shows once supports are on.
      await settings
        .getByRole("group", { name: "Supports" })
        .getByRole("radio", { name: /^Where needed/ })
        .click();
      const more = settings.getByRole("button", { name: /^More/ });
      await more.click();
      await settings.getByRole("group", { name: "How supports are built" }).waitFor();
      await page.waitForTimeout(400);
      await more.evaluate((button) => button.scrollIntoView({ block: "start", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // Filament: the Pantry's spools as tiles, loaded ones first (a row that scrolls sideways on a phone), and the
    // settings' foot: the engine and its licence, and the files to download.
    name: "slice-settings-filament",
    path: "/ideas",
    prepare: async (page) => {
      const settings = await openSliceSettings(page);
      const filament = settings.getByRole("group", { name: "Filament" });
      await filament.waitFor();
      await filament.evaluate((group) => group.scrollIntoView({ block: "start", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // Filament with the multi-colour silks loaded first: each tile draws its spool in its colours.
    name: "slice-settings-filament-multicolour",
    path: "/ideas",
    prepare: async (page) => {
      await loadMultiColourSpools(page);
      const settings = await openSliceSettings(page);
      const filament = settings.getByRole("group", { name: "Filament" });
      await filament.waitFor();
      await filament.evaluate((group) => group.scrollIntoView({ block: "start", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A model's nozzle size (decision 0057): first under More, the sizes fitted marked (a solid dot for the main 0.4 mm,
    // a ring for the 0.2 mm fitted on the right), the legend under it.
    name: "slice-settings-nozzle",
    path: "/ideas",
    prepare: async (page) => {
      await fitSmallNozzle(page);
      const settings = await openSliceSettings(page);
      await settings.getByRole("button", { name: /^More/ }).click();
      await settings.getByRole("group", { name: "Nozzle" }).waitFor();
      await page.waitForTimeout(400);
    },
    // Scrolled once the sheet has settled (its pictures still grow it while it opens).
    beforeShot: async (page) => {
      await settleSliceSettings(page);
      const more = page.getByRole("dialog", { name: "How to slice it" }).getByRole("button", { name: /^More/ });
      await more.evaluate((button) => button.scrollIntoView({ block: "start", behavior: "instant" }));
      await page.waitForTimeout(300);
    },
    cleanup: async (page) => {
      await closeSliceSettings(page);
      await fitStockNozzles(page);
    },
  },
  {
    // 0.2 mm picked for the model (decision 0057), More folded again: the sheet's first screens with the Nozzle line after
    // the filament, in the same words as the card and Print it.
    name: "slice-settings-nozzle-picked",
    path: "/ideas",
    prepare: async (page) => {
      await fitSmallNozzle(page);
      const settings = await openSliceSettings(page);
      const more = settings.getByRole("button", { name: /^More/ });
      await more.click();
      await settings.getByRole("radio", { name: /^0\.2 mm/ }).click();
      await more.click();
      await settings.getByText("Fit the 0.2 mm first.").waitFor();
      await page
        .getByText(/^Slicing with/)
        .first()
        .waitFor({ state: "hidden", timeout: 90_000 })
        .catch(() => undefined);
      await page.waitForTimeout(400);
    },
    beforeShot: async (page) => {
      await settleSliceSettings(page);
      const note = page.getByRole("dialog", { name: "How to slice it" }).getByText("Fit the 0.2 mm first.");
      await note.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(300);
    },
    cleanup: async (page) => {
      await closeSliceSettings(page);
      await fitStockNozzles(page);
    },
  },
  {
    // The 0.2 mm fitted as the main nozzle: the quality tiles are its own (Standard 0.10 mm), the same four names.
    name: "slice-settings-nozzle-qualities",
    path: "/ideas",
    prepare: async (page) => {
      await fitSmallNozzle(page, "main");
      const settings = await openSliceSettings(page);
      await settings
        .getByRole("group", { name: "Quality" })
        .getByRole("radio", { name: /^Standard 0\.10 mm/ })
        .waitFor();
    },
    beforeShot: settleSliceSettings,
    cleanup: async (page) => {
      await closeSliceSettings(page);
      await fitStockNozzles(page);
    },
  },
  {
    // A model sliced ahead of a swap for a size the main nozzle doesn't have (More's nozzle): the card says the file
    // needs it as the main nozzle, with one tap back to the main nozzle's size.
    name: "idea-model-other-nozzle",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      await modelInView(page);
      await files.getByRole("button", { name: "Slice with…" }).click();
      const settings = page.getByRole("dialog", { name: "How to slice it" });
      await settings.getByRole("button", { name: /^More/ }).click();
      await settings.getByRole("radio", { name: "0.6 mm" }).click();
      await page.keyboard.press("Escape");
      await files
        .getByText("Sliced for a 0.6 mm nozzle; the main nozzle has the 0.4 mm. Fit the 0.6 mm first.")
        .waitFor({ timeout: 90_000 });
      // Closing the sheet hands focus back to the row: a tap leaves no ring.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.waitForTimeout(400);
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // A model sliced for the 0.2 mm nozzle (fitted as the main one): the card's row names the nozzle, and leads with
    // the print's time and weight at 0.10 mm layers.
    name: "idea-model-small-nozzle",
    path: "/ideas",
    prepare: async (page) => {
      await fitSmallNozzle(page, "main");
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      await page
        .getByRole("button", { name: /^Slice with… Standard, Everyday strength, No supports, 0\.2 mm nozzle/ })
        .waitFor();
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await removeModelItems(page);
      await fitStockNozzles(page);
    },
  },
  {
    // The rest of More for a model too long for the plate: the plates, the nozzle, and its size with "Fit the plate".
    name: "slice-settings-fit",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(
        page,
        { title: "Lasagne wall art", note: "A whole lasagne sheet, life size, for the kitchen wall." },
        { name: "lasagne-sheet.stl", bytes: boxStl(320, 100, 4) },
        /Too big for the plate/,
      );
      await modelInView(page);
      await files.getByRole("button", { name: "Slice with…" }).click();
      const settings = page.getByRole("dialog", { name: "How to slice it" });
      await settings.getByRole("button", { name: /^More/ }).click();
      const size = settings.getByRole("group", { name: "Size" });
      await size.waitFor();
      await page.waitForTimeout(400);
      await size.evaluate((group) => group.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The sliced model in the 3D view: the G-code Spaghetti made, layer by layer.
    name: "idea-model-viewer",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await files.getByRole("button", { name: `See ${FUSILLI.name} in 3D` }).click();
      await page.getByRole("dialog", { name: "3D view" }).locator("[data-viewer=ready]").waitFor({ timeout: 30_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await removeModelItems(page);
    },
  },
  {
    // A model with colours of its own in 3D: the toolpaths in the spools it prints with, the switch to its own colours.
    name: "idea-model-colours-3d",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, HOTDOG_IDEA, HOTDOG, /Sliced by/);
      await sliceSaved(page);
      await files.getByRole("button", { name: `See ${HOTDOG.name} in 3D` }).click();
      await page.getByRole("dialog", { name: "3D view" }).locator("[data-viewer=ready]").waitFor({ timeout: 60_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(600);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await removeModelItems(page);
    },
  },
  {
    // The same, on "Model's colours": the toolpaths and the legend in the colours the file has.
    name: "idea-model-colours-3d-original",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, HOTDOG_IDEA, HOTDOG, /Sliced by/);
      await sliceSaved(page);
      await files.getByRole("button", { name: `See ${HOTDOG.name} in 3D` }).click();
      const viewer = page.getByRole("dialog", { name: "3D view" });
      await viewer.locator("[data-viewer=ready]").waitFor({ timeout: 60_000 });
      await viewer.getByRole("radio", { name: "Model's colours" }).click();
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(600);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await removeModelItems(page);
    },
  },
  {
    // The same sliced model seen from below the plate: the plate fades to a grid and the first layer shows.
    name: "idea-model-viewer-below",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await files.getByRole("button", { name: `See ${FUSILLI.name} in 3D` }).click();
      await page.getByRole("dialog", { name: "3D view" }).locator("[data-viewer=ready]").waitFor({ timeout: 30_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
      await orbitBelow(page);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await removeModelItems(page);
    },
  },
  {
    // A model too long for the plate: one sentence, and the one thing that helps.
    name: "idea-model-too-big",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(
        page,
        { title: "Lasagne wall art", note: "A whole lasagne sheet, life size, for the kitchen wall." },
        { name: "lasagne-sheet.stl", bytes: boxStl(320, 100, 4) },
        /Too big for the plate/,
      );
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // Fins (decision 0052): the fourth Supports tile, picked for the drying rack, whose arm starts in the air. It
    // slices again in the background, with the fins built into the model.
    name: "slice-settings-fins",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, RACK_IDEA, RACK, /Parts of it float/);
      await sliceSaved(page);
      await modelInView(page);
      await files.getByRole("button", { name: "Slice with…" }).click();
      const settings = page.getByRole("dialog", { name: "How to slice it" });
      const supports = settings.getByRole("group", { name: "Supports" });
      await supports.getByRole("radio", { name: /^Fins/ }).click();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
      await supports.evaluate((group) => group.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The rack sliced with fins, in the 3D view: the fins are in the G-code like any wall, under the arm.
    name: "idea-model-fins-3d",
    path: "/ideas",
    prepare: async (page) => {
      const files = await ideaWithModel(page, RACK_IDEA, RACK, /Parts of it float/);
      await sliceSaved(page);
      await modelInView(page);
      await files.getByRole("button", { name: "Slice with…" }).click();
      const settings = page.getByRole("dialog", { name: "How to slice it" });
      await settings.getByRole("group", { name: "Supports" }).getByRole("radio", { name: /^Fins/ }).click();
      await page.getByRole("button", { name: "Undo" }).first().waitFor({ timeout: 90_000 });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: `See ${RACK.name} in 3D` })
        .first()
        .click();
      await page.getByRole("dialog", { name: "3D view" }).locator("[data-viewer=ready]").waitFor({ timeout: 30_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(600);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await removeModelItems(page);
    },
  },
  {
    // A model with a part that starts in the air: sliced as it is, with one caution and the one thing that helps.
    name: "idea-model-floating",
    path: "/ideas",
    prepare: async (page) => {
      await ideaWithModel(page, RACK_IDEA, RACK, /Parts of it float/);
    },
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // Sliced by Spaghetti's own slicer (decision 0055), picked as the workspace's: the card names it.
    name: "idea-model-ours",
    path: "/ideas",
    prepare: async (page) => {
      await setSlicingDefaults(page, { slicer: "spaghetti" });
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti's own slicer/);
      await sliceSaved(page);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await setSlicingDefaults(page, null);
      await removeModelItems(page);
    },
  },
  {
    // Ours picked, for a project whose one object is made of two parts in different filaments: it prints each half
    // in its own, and the plate picture shows them so.
    name: "idea-model-ours-parts",
    path: "/ideas",
    prepare: async (page) => {
      await setSlicingDefaults(page, { slicer: "spaghetti" });
      await ideaWithModel(page, TWO_TONE_IDEA, TWO_TONE, /Sliced by Spaghetti's own slicer/);
      await sliceSaved(page);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await setSlicingDefaults(page, null);
      await removeModelItems(page);
    },
  },
  {
    // Ours picked for a project with painted colours, which it prints (before release 23, OrcaSlicer's engine did,
    // and the card said why).
    name: "idea-model-painted",
    path: "/ideas",
    prepare: async (page) => {
      await setSlicingDefaults(page, { slicer: "spaghetti" });
      // "Sliced by": whichever slicer made it, so the route runs before paint was read too (a before/after).
      await ideaWithModel(page, FARFALLE_IDEA, FARFALLE, /Sliced by/);
      await sliceSaved(page);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await setSlicingDefaults(page, null);
      await removeModelItems(page);
    },
  },
  {
    // Ours picked for the drying rack, whose arm starts in the air: the card has the usual caution and the one thing
    // that helps, under who sliced it.
    name: "idea-model-ours-floating",
    path: "/ideas",
    prepare: async (page) => {
      await setSlicingDefaults(page, { slicer: "spaghetti" });
      await ideaWithModel(page, RACK_IDEA, RACK, /Parts of it float/);
      await sliceSaved(page);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await setSlicingDefaults(page, null);
      await removeModelItems(page);
    },
  },
  {
    // Ours picked, for a project that asks for a raft under hybrid trees, which it can't build yet: OrcaSlicer's
    // engine sliced it, and the card says why in one line.
    name: "idea-model-stepped-in",
    path: "/ideas",
    prepare: async (page) => {
      await setSlicingDefaults(page, { slicer: "spaghetti" });
      await ideaWithModel(page, RAFT_IDEA, RAFT, /Sliced by OrcaSlicer: our own slicer/);
      await sliceSaved(page);
    },
    beforeShot: modelInView,
    cleanup: async (page) => {
      await setSlicingDefaults(page, null);
      await removeModelItems(page);
    },
  },
  {
    // More, at its end: which slicer slices it, Spaghetti's own picked and sliced by it, and under it who sliced it
    // and in how long.
    name: "slice-settings-slicer",
    path: "/ideas",
    prepare: async (page) => {
      const { slicer } = await pickOurSlicer(page);
      await slicer.evaluate((group) => group.scrollIntoView({ block: "center", behavior: "instant" }));
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // A model kept but never sliced (its slicing stopped with its tab): "Not sliced yet", and "Slice it".
    name: "idea-model-unsliced",
    path: "/ideas",
    prepare: ideaWithUnslicedModel,
    beforeShot: modelInView,
    cleanup: removeModelItems,
  },
  {
    // The top of the attempt sheet on a phone right after a model is dropped in it: the outcome to pick, then the
    // model, sliced there.
    name: "build-model-drop",
    path: "/builds",
    width: 390,
    prepare: async (page) => {
      const sheet = await buildWithModel(page);
      await sheetSettled(page, sheet);
      await sheet.evaluate((dialog) => {
        for (const element of Array.from(dialog.querySelectorAll<HTMLElement>("*"))) {
          if (element.scrollHeight > element.clientHeight + 1) element.scrollTop = 0;
        }
      });
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removeModelItems(page);
      await page.reload();
    },
  },
  {
    // A model dropped in the attempt sheet: sliced there, and what its slice says (estimate, filament) fills in the
    // attempt, as a slicer's own file would.
    name: "build-model-sheet",
    path: "/builds",
    prepare: async (page) => {
      const sheet = await buildWithModel(page);
      // Scrolled once the settings have opened, the whole card at the top.
      await sheetSettled(page, sheet);
      await sheet.getByText(FUSILLI.name).evaluate((element) => {
        const card = element.closest(".grid") ?? element;
        card.scrollIntoView({ block: "start", behavior: "instant" });
        let scroller = card.parentElement;
        while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
        scroller?.scrollBy({ top: -12, behavior: "instant" });
      });
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removeModelItems(page);
      await page.reload();
    },
  },
  {
    // The model on its attempt, on the build's page: logged as it worked, with the plate Spaghetti drew, the estimate
    // and the 3D view, like any slicer file.
    name: "build-model",
    path: "/builds",
    prepare: async (page) => {
      const sheet = await buildWithModel(page);
      await sheet.getByRole("radio", { name: "Worked" }).click();
      await sheet.getByRole("button", { name: "Log attempt" }).click();
      await sheet.waitFor({ state: "hidden" });
      // The model goes with the attempt through the outbox, and its slice follows: the 3D control shows once the
      // server has both.
      await page.getByRole("button", { name: `See ${FUSILLI.name} in 3D` }).waitFor({ timeout: 90_000 });
      await page
        .getByRole("button", { name: /Sliced by Spaghetti/ })
        .first()
        .evaluate((element) => element.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(400);
    },
    cleanup: removeModelItems,
  },
  {
    // An idea led by its model's render, started: the build keeps the render where the idea had it, at its size, with
    // the add-photo wells row-sized under it (one cover rule, lib/previews.ts coverOf).
    name: "build-model-cover",
    path: "/builds",
    fullPage: true,
    prepare: async (page) => {
      await ideaWithModel(page, FUSILLI_IDEA, FUSILLI, /Sliced by Spaghetti/);
      await sliceSaved(page);
      const id = modelItems.at(-1) as string;
      const headers = { Origin: new URL(page.url()).origin };
      await page.request.patch(`/api/items/${id}`, { headers, data: { stage: "building" } });
      await page.goto(`/builds/${id}`, { waitUntil: "networkidle" });
      await page.getByRole("textbox", { name: "Title" }).waitFor();
      await page.waitForTimeout(1200);
    },
    cleanup: removeModelItems,
  },
  {
    // Prints on the bed with neither a photo nor a file: the one with a note shows it (set a size down in the wide
    // frame), the one with only a name shows the build glyph, since its name is right beside it in Fraunces.
    name: "today-no-picture",
    path: "/today",
    width: 1440,
    prepare: async (page) => {
      await printsWithoutPictures(page);
      await page.goto("/today", { waitUntil: "networkidle" });
      await page.getByText("Wall hook").first().waitFor();
      await page.getByText("Shelf peg").first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
    },
    cleanup: removeCoverBuilds,
  },
  {
    name: "journal-now-no-picture",
    path: "/journal",
    width: 390,
    prepare: async (page) => {
      await printsWithoutPictures(page);
      await page.goto("/journal", { waitUntil: "networkidle" });
      await page.getByText("Wall hook").first().waitFor();
      await page.waitForTimeout(1500);
    },
    cleanup: removeCoverBuilds,
  },
  {
    // A render's card with a new comment: the unread badge takes the corner, "From the model" gives way.
    name: "builds-render-unread",
    path: "/builds",
    selector: TOWEL_CARD,
    prepare: async (page) => {
      await page.route("**/api/comments/unread", async (route) => {
        const answer = await route.fetch();
        const body = (await answer.json()) as { threads: Array<Record<string, unknown>> };
        const thread = {
          ...body.threads[0],
          itemId: SEED_BUILD_IDS.towelHook,
          count: 1,
          title: "Towel hook",
          stage: "building",
        };
        await route.fulfill({ response: answer, json: { threads: [thread, ...body.threads] } });
      });
      await page.goto("/builds", { waitUntil: "networkidle" });
      await page.locator(TOWEL_CARD).waitFor();
      await page.waitForTimeout(1500);
    },
    cleanup: (page) => page.unroute("**/api/comments/unread"),
  },
  {
    // A render on its way (held), and one that never comes (the file's picture is gone): the ground alone, calm.
    name: "builds-render-loading",
    path: "/builds",
    selector: TOWEL_CARD,
    brokenImages: true,
    prepare: async (page) => {
      await page.route("**/api/files/*/thumb*", (route) => void heldRoutes.push(route));
      // The held picture would hold the page's load event too.
      await page.goto("/builds", { waitUntil: "domcontentloaded" });
      await page.locator(TOWEL_CARD).waitFor();
      await page.waitForTimeout(800);
    },
    cleanup: async (page) => {
      for (const route of heldRoutes.splice(0)) await route.abort().catch(() => {});
      await page.unroute("**/api/files/*/thumb*");
    },
  },
  {
    name: "builds-render-failed",
    path: "/builds",
    selector: TOWEL_CARD,
    brokenImages: true,
    prepare: async (page) => {
      await page.route("**/api/files/*/thumb*", (route) => route.fulfill({ status: 404, body: "" }));
      await page.goto("/builds");
      await page.locator(TOWEL_CARD).waitFor();
      await page.waitForTimeout(800);
    },
    cleanup: (page) => page.unroute("**/api/files/*/thumb*"),
  },
  {
    // Renders in 48 px rows: a black-filament build and a white one in Pick up again, on Today's desktop.
    name: "today-pick-up",
    path: "/today",
    width: 1440,
    selector: "section[aria-labelledby=today-pickup]",
    prepare: async (page) => {
      await renderBuild(page, { title: "Coat hook", black: true });
      await renderBuild(page, { title: "Door hook" });
      await page.goto("/today", { waitUntil: "networkidle" });
      await page.locator("section[aria-labelledby=today-pickup]").getByText("Coat hook").waitFor();
      await page.waitForTimeout(800);
    },
    cleanup: removeCoverBuilds,
  },
  {
    // The same renders in the Builds grid (black PLA on the render ground), in Done and on the shelf (48 px tiles).
    name: "builds-renders",
    path: "/builds",
    fullPage: true,
    prepare: async (page) => {
      await renderBuild(page, { title: "Coat hook", black: true });
      await renderBuild(page, { title: "Door hook", stage: "done", outcome: "success" });
      await renderBuild(page, { title: "Shelf hook", black: true, stage: "shelved" });
      await page.goto("/builds", { waitUntil: "networkidle" });
      await page.getByText("Shelf hook").waitFor();
      // Again from the saved list: cards that arrive by a live update fade in, which the shots' fixed clock never ends.
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Coat hook").first().waitFor();
      await page.waitForTimeout(1000);
    },
    cleanup: removeCoverBuilds,
  },
  {
    // Search finds builds by the same cover: the best photo from the Worker, else the render this device has.
    name: "search-covers",
    path: "/builds",
    prepare: async (page) => {
      await page.locator(TOWEL_CARD).waitFor();
      await page.goto("/search?q=hook");
      await page.getByRole("region", { name: "Builds" }).getByText("Towel hook").first().waitFor();
      await page.getByRole("searchbox", { name: "Search" }).blur();
      await page.waitForTimeout(800);
    },
  },
  {
    name: "palette-covers",
    path: "/builds",
    width: 1440,
    prepare: async (page) => {
      await page.locator(TOWEL_CARD).waitFor();
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("hook");
      await page
        .getByRole("group", { name: "Builds" })
        .getByRole("option", { name: /^Towel hook\b/ })
        .waitFor();
      await page.waitForTimeout(600);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // On desktop, a story card's "Sliced by Spaghetti" opens the settings below the model's card in the attempt.
    name: "build-model-settings",
    path: "/builds",
    width: 1440,
    prepare: async (page) => {
      const sheet = await buildWithModel(page);
      await sheet.getByRole("radio", { name: "Worked" }).click();
      await sheet.getByRole("button", { name: "Log attempt" }).click();
      await sheet.waitFor({ state: "hidden" });
      await page.getByRole("button", { name: `See ${FUSILLI.name} in 3D` }).waitFor({ timeout: 90_000 });
      const opener = page.getByRole("button", { name: /Sliced by Spaghetti/ }).first();
      await opener.evaluate((element) => element.scrollIntoView({ block: "start" }));
      await page.mouse.wheel(0, -160);
      await opener.click();
      await page.getByRole("dialog", { name: "How to slice it" }).getByRole("group", { name: "Quality" }).waitFor();
    },
    beforeShot: settleSliceSettings,
    cleanup: closeSliceSettings,
  },
  {
    // The 3D view opened from the idea's own file.
    name: "idea-file-viewer",
    path: `/ideas/${SEED_IDS.bigTugboat}`,
    prepare: openViewer,
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: closeDialog,
  },
  {
    // The 3D view of the tugboat's sliced file, built up and showing every layer, coloured by filament.
    name: "viewer",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: openViewer,
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: closeDialog,
  },
  {
    // The tugboat's 3D view from below the plate: the see-through grid, and the hull's first layer through it.
    name: "viewer-below",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: openViewer,
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
      await orbitBelow(page);
    },
    cleanup: closeDialog,
  },
  {
    // The tugboat's 3D view tilted just under the plate's top: already the see-through grid, not the plate's solid
    // underside in front of the hull.
    name: "viewer-grazing",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      // Without reduced motion, as on most phones: the plate eases between solid and see-through as the view tilts.
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await openViewer(page);
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
      await tiltJustUnder(page);
    },
    cleanup: async (page) => {
      await closeDialog(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
    },
  },
  {
    // The tugboat's attempt that is printing: the view opens at layer 140, where the printer is, the rest a faint ghost.
    name: "viewer-live",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: openLiveViewer,
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: closeLiveViewer,
  },
  {
    // The same print scrubbed back to layer 60: "Back to now" offers the way to the layer being printed.
    name: "viewer-live-away",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await openLiveViewer(page);
      await page.getByRole("slider", { name: "Layer" }).fill("59");
      await page.getByRole("button", { name: "Back to now" }).waitFor();
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: closeLiveViewer,
  },
  {
    // The same print coloured by feature, scrubbed back to half its height.
    name: "viewer-feature",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await openViewer(page);
      await page.getByRole("radio", { name: "Feature" }).check({ force: true });
      await page.getByRole("slider", { name: "Layer" }).fill("150");
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: closeDialog,
  },
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
      await openCompare(page);
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
      await openCompare(page);
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
      await openCompare(page);
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
      await openCompare(page);
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
      await openCompare(page);
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
  // A shelved build: its chip, then when and after how many attempts; no For offer.
  { name: "build-shelved", path: `/builds/${SEED_IDS.planter}` },
  { name: "journal", path: "/journal" },
  // Work done through an agent among the rest (scripts/seed/agents.ts): the person's own avatar, with the agent's mark.
  {
    name: "journal-via",
    path: "/journal",
    prepare: async (page) => {
      await withSeedAgents(page);
      await scrollToRow(page, "Hook for the bike helmet");
    },
    cleanup: withoutSeedAgents,
  },
  {
    name: "ideas-via",
    path: "/ideas",
    prepare: async (page) => {
      await withSeedAgents(page);
      await scrollToRow(page, "Desk tidy-up");
    },
    cleanup: withoutSeedAgents,
  },
  { name: "idea-via", path: `/ideas/${SEED_IDS.deskTidy}`, prepare: withSeedAgents, cleanup: withoutSeedAgents },
  {
    name: "build-via",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    fullPage: true,
    prepare: withSeedAgents,
    cleanup: withoutSeedAgents,
  },
  {
    name: "today-via",
    path: "/today",
    width: 1440,
    fullPage: true,
    prepare: withSeedAgents,
    cleanup: withoutSeedAgents,
  },
  // The same catch-up at the top of the phone's Journal (above Now).
  {
    name: "journal-since",
    path: "/journal",
    width: 390,
    why: "the catch-up sits on the phone's Journal; on desktop it is at the top of Today (today-since)",
    prepare: async (page) => {
      await catchUpFrom(page, 4);
      await page
        .getByText(/^Since /)
        .first()
        .waitFor();
    },
    cleanup: forgetCatchUp,
  },
  // The year so far: figures, months, success by material and plate, what fixed each failure.
  { name: "year", path: "/year?year=2026", fullPage: true },
  // The week in Spaghetti. The shots' browser clock is the seed's date but the Worker's is the real one, so the
  // current week (Mon 19 Oct) is "past" to the Worker: its answer is given what only the live week has (what is
  // waiting) and, as the Sunday evening look back would, Claude's paragraph.
  {
    name: "week",
    path: "/week/2026-10-19",
    fullPage: true,
    prepare: async (page) => {
      await withWeekMock(page, { waiting: true, note: true });
    },
    cleanup: async (page) => {
      await page.unroute(weekApi);
    },
  },
  {
    // The scout's three, two answered: one kept as an idea, one put away, each with a way back.
    name: "week-scout-answered",
    path: "/week/2026-10-19",
    fullPage: true,
    prepare: async (page) => {
      await withWeekMock(page, { waiting: true, note: true });
      await mockScout(page, "answered");
      await page.getByText("Not for us", { exact: true }).first().waitFor();
      // The waiting card slides to the front once the page's own answer is in.
      await page.waitForTimeout(1200);
    },
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
  {
    // This week, before the scout has been out: a quiet line, not a gap.
    name: "week-scout-empty",
    path: "/week/2026-10-19",
    fullPage: true,
    prepare: async (page) => {
      await withWeekMock(page, { waiting: false, note: false });
      await mockScout(page, "none");
      await page.getByText(/The scout is out shopping/).waitFor();
    },
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
  { name: "week-last", path: "/week/2026-10-12", fullPage: true },
  {
    name: "week-empty",
    path: "/week/2026-01-05",
    fullPage: true,
    // The empty state fades in: finish it by hand.
    beforeShot: async (page) => {
      await page.getByRole("heading", { level: 2, name: "Not a strand this week" }).waitFor();
      await page.evaluate(() => {
        for (const a of document.getAnimations()) a.finish();
      });
    },
  },
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
    // The search field's × with its target outlined: the field's full height to its right edge (before, the browser's
    // own 16 px button). The outline is the shot's, not the app's.
    name: "search-clear-target",
    path: "/search",
    width: 390,
    prepare: async (page) => {
      await page.getByRole("searchbox", { name: "Search" }).fill("PETG warping");
      await page.addStyleTag({
        content: `[data-clear], input[type="search"]::-webkit-search-cancel-button {
          outline: 2px dashed var(--sg-tomato); outline-offset: -2px; }`,
      });
      await page.getByText("Filament swatch box").first().waitFor();
    },
  },
  {
    name: "search-results",
    path: "/search?q=PETG%20warping",
    prepare: async (page) => {
      // What fixed it leads (the swatch box's dried filament), then the times it happened.
      await page
        .getByRole("region", { name: /^(Times it happened|Attempts)$/ })
        .first()
        .waitFor();
      // What fixed it draws from a chunk loaded when one appears.
      await page.waitForLoadState("networkidle");
      await page.getByRole("searchbox", { name: "Search" }).blur();
    },
  },
  {
    // A problem's word: what fixed it leads, picked with the keyboard (its Start again inside the card), and the six
    // times it happened fold to three with "Show all 6".
    name: "search-fixed",
    path: "/search?q=warping",
    fullPage: true,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Start again with these/ })
        .first()
        .waitFor();
      const box = page.getByRole("searchbox", { name: "Search" });
      await box.press("ArrowDown");
      await box.blur();
    },
  },
  {
    // Two words and nothing has both: the closest results at once, each word on its own a tap away.
    name: "search-nothing",
    path: "/search?q=PETG%20supports",
    prepare: async (page) => {
      await page.getByText("Closest first:").waitFor();
      await page.getByRole("searchbox", { name: "Search" }).blur();
    },
  },
  {
    // A build found by what Sam said in its thread: the comment is the snippet, with who and when.
    name: "search-comment",
    path: "/search?q=chunkier",
    prepare: async (page) => {
      await page
        .getByRole("link", { name: /tugboat/i })
        .first()
        .waitFor();
      await page.getByRole("searchbox", { name: "Search" }).blur();
    },
  },
  {
    // Opened from that result: the thread in view with the comment lit for a moment.
    name: "comments-found",
    path: `/builds/${SEED_BUILD_IDS.tugboat}?thread=1&comment=${commentId(5)}`,
    prepare: async (page) => {
      await page
        .locator(`#comment-${commentId(5)} > div`)
        .first()
        .waitFor();
    },
  },
  {
    // A recipe among the results, with the print it came from.
    name: "search-recipe",
    path: "/search?q=silk",
    prepare: async (page) => {
      await page.getByRole("region", { name: "Recipes" }).waitFor();
      await page.getByRole("searchbox", { name: "Search" }).blur();
    },
  },
  {
    // Saving an attempt that worked as a recipe: the name is offered, one tap saves.
    name: "recipe-save",
    path: "/builds/5eed0000-0000-4000-8000-000000000101",
    prepare: async (page) => {
      await page.getByRole("region", { name: "What worked" }).getByRole("button", { name: "Save as recipe" }).click();
      await page.getByRole("dialog", { name: "Save as a recipe" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // A recipe, open: its name and note are editable, its settings are the print's.
    name: "recipe-open",
    path: `/pantry/${SEED_SPOOL_IDS.silkGold}`,
    prepare: async (page) => {
      await page
        .getByRole("region", { name: /Recipes for silk PLA/ })
        .getByRole("button")
        .first()
        .click();
      await page.getByRole("dialog", { name: "Silk PLA, slow outer wall" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // "Start from a recipe" in a new attempt's sheet, opened.
    name: "recipe-picker",
    path: `/builds/${SEED_BUILD_IDS.cableChain}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Start from a recipe" }).click();
      const first = sheet.getByRole("button", { name: /PETG, dried and 245/ });
      await first.waitFor();
      await page.waitForTimeout(400);
      await first.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
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
  {
    // The capture sheet on an idea's page: it opens on New idea, with This idea one tap away.
    name: "capture-on-idea",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // The capture sheet on a build that is printing: New idea first, This print second.
    name: "capture-on-printing-build",
    path: `/builds/${SEED_BUILD_IDS.towelHook}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // The same sheet with This idea picked: the title names the idea.
    name: "capture-on-idea-here",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByRole("radio", { name: "This idea" }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    // The same sheet with This print picked: the title and line name the print, and the outcome row shows.
    name: "capture-on-printing-build-here",
    path: `/builds/${SEED_BUILD_IDS.towelHook}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByRole("radio", { name: "This print" }).click();
      await page.waitForTimeout(400);
    },
  },
  {
    // Spaghetti picked in the same sheet: "What went wrong?" opens under the outcome, one tag tapped.
    name: "capture-print-went-wrong",
    path: `/builds/${SEED_BUILD_IDS.towelHook}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByRole("radio", { name: "This print" }).click();
      await sheet.getByRole("radio", { name: "Spaghetti" }).click();
      await sheet.getByRole("button", { name: "Bed adhesion" }).click();
      await page.waitForTimeout(500);
    },
  },
  {
    // A model link typed into the capture sheet: saving is the same one tap, Claude drafts after.
    name: "draft-capture",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New idea" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByRole("textbox", { name: "Note" }).fill("https://makerworld.com/en/models/1-cable-comb");
      await page.waitForTimeout(400);
      await sheet.getByRole("textbox", { name: "Note" }).blur();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  {
    // The idea while Claude reads the page: the answer is held back (route) so the state stays still.
    name: "draft-reading",
    path: "/ideas",
    prepare: async (page) => {
      const id = await newModelIdea(page, GOOD_LINK);
      await page.route(`**/api/items/${id}`, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.item.draft = {
          status: "reading",
          site: "makerworld",
          url: GOOD_LINK,
          failure: null,
          applied: [],
          title: null,
          note: null,
          findings: null,
          draftedAt: null,
        };
        await route.fulfill({ response, json });
      });
      await openIdea(page, id);
      await page.getByText("Reading the MakerWorld page…").waitFor();
      await page.waitForTimeout(300);
    },
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
  // Each page as a whole, with everything on it at once (the coherence pass): a build with parts, eight attempts,
  // Claude's guess on the newest and a thread ...
  {
    name: "build-everything",
    path: "/builds",
    fullPage: true,
    prepare: async (page) => {
      const id = await everythingBuild(page);
      await page.goto(`/builds/${id}`);
      await page.locator("h1").first().waitFor({ state: "attached" });
      await page
        .getByRole("radio", { name: /suggested/ })
        .first()
        .waitFor({ timeout: 30_000 });
      await page.locator("section[aria-labelledby^='thread-']").getByRole("list", { name: "Comments" }).waitFor();
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await removePhotoReadBuilds(page);
    },
  },
  // ... and an idea Claude drafted from its model page, with a thread under it.
  {
    name: "idea-everything",
    path: "/ideas",
    fullPage: true,
    prepare: async (page) => {
      const id = await newModelIdea(page, GOOD_LINK);
      const headers = { Origin: new URL(page.url()).origin };
      for (const body of ["This would tidy the cable mess under the desk.", "Print it in the jade white?"])
        await page.request.post(`/api/items/${id}/comments`, { headers, data: { id: crypto.randomUUID(), body } });
      await openIdea(page, id);
      await page.getByRole("button", { name: "Draft from this page" }).click();
      await page.getByText("Drafted by Claude from MakerWorld").waitFor();
      await page.locator("section[aria-labelledby^='thread-']").getByRole("list", { name: "Comments" }).waitFor();
      // The undo toast would cover the thread: wait it out.
      await page.getByText("Drafted from MakerWorld", { exact: true }).waitFor({ state: "hidden", timeout: 20_000 });
      await page.waitForTimeout(500);
    },
  },
  {
    // The drafted idea with its undo toast, from the real flow (the Worker asks the stand-in for Anthropic).
    name: "draft-drafted",
    path: "/ideas",
    prepare: async (page) => {
      const id = await newModelIdea(page, GOOD_LINK);
      await openIdea(page, id);
      await page.getByRole("button", { name: "Draft from this page" }).click();
      await page.getByText("Drafted by Claude from MakerWorld").waitFor();
      await page.getByText("Drafted from MakerWorld").waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    // A drafted idea whose pictures didn't come: the one action to try again (the answer is held back with a route).
    name: "draft-no-pictures",
    path: "/ideas",
    prepare: async (page) => {
      const id = await newModelIdea(page, GOOD_LINK);
      await openIdea(page, id);
      await page.getByRole("button", { name: "Draft from this page" }).click();
      await page.getByText("Drafted by Claude from MakerWorld").waitFor();
      await page.route(`**/api/items/${id}`, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        json.item.photos = [];
        await route.fulfill({ response, json });
      });
      await page.reload();
      await page.getByRole("button", { name: "Get the pictures" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
  {
    // A page that couldn't be read: the idea is as captured, with one line and a retry.
    name: "draft-failed",
    path: "/ideas",
    prepare: async (page) => {
      const id = await newModelIdea(page, "https://www.printables.com/model/3-broken-hook");
      await openIdea(page, id);
      await page.getByRole("button", { name: "Draft from this page" }).click();
      await page.getByText("Claude couldn't read that page.").waitFor();
      await page.waitForTimeout(300);
    },
  },
  {
    // Shared into Spaghetti (the share target and the bookmarklet end here): saved already, with a word to add.
    name: "share-captured",
    path: `/share?title=${encodeURIComponent("Drawer bins, 42 mm grid")}&text=${encodeURIComponent("Saw this on the bus")}&url=${encodeURIComponent("https://makerworld.com/en/models/drawer-bins")}`,
    prepare: async (page) => {
      const sheet = page.getByRole("dialog", { name: "Into the pot" });
      await sheet.waitFor();
      // The words sit in the note's field (text inside a field isn't found by getByText).
      await sheet.getByRole("textbox", { name: "Add a word" }).waitFor();
      await page.waitForTimeout(600);
    },
  },
  { name: "agents", path: "/agents" },
  // An app connected by OAuth (Claude's connector), beside a token agent: one connection, its scopes, Disconnect.
  {
    name: "agents-connected",
    path: "/agents",
    prepare: async (page) => {
      await page.route(/\/api\/agents$/, async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as { agents: object[] };
        const me = (await (await page.request.get("/api/session")).json()) as { user: { id: string; name: string } };
        await route.fulfill({
          response,
          json: {
            agents: [
              ...json.agents,
              {
                id: "claude-connector",
                name: `Claude for ${me.user.name}`,
                ownerId: me.user.id,
                createdAt: minutesAgo(60 * 24 * 3),
                tokens: [],
                connection: {
                  app: "Claude",
                  scopes: ["read", "capture", "attempts", "printer"],
                  connected: true,
                  connectedAt: minutesAgo(60 * 24 * 3),
                  lastUsedAt: minutesAgo(25),
                },
              },
            ],
          },
        });
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: (page) => page.unrouteAll({ behavior: "ignoreErrors" }),
  },
  // The consent screen Claude's apps send people to: who asks, what it will be able to do, Allow or Not now.
  {
    name: "authorize",
    path: "/agents",
    fullPage: true,
    prepare: async (page) => {
      const registered = await page.request.post("/oauth/register", {
        data: { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
      });
      const { client_id: clientId } = (await registered.json()) as { client_id: string };
      const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://claude.ai/api/mcp/auth_callback",
        code_challenge: "E9Melhoa2OwvFIEQJdbPIbRIMPpVC7xyrXTVyQd1pZA",
        code_challenge_method: "S256",
        scope: "read capture attempts printer",
        state: "shot",
      });
      await page.goto(`/authorize?${query}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Allow" }).waitFor();
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
  },
  // Webhooks, a small section under the agents: nothing yet, one that works (with its deliveries), one that is failing,
  // and the sheet that adds one, then its secret (shown once).
  {
    name: "agents-webhooks-empty",
    path: "/agents",
    fullPage: true,
    prepare: (page) => mockWebhooks(page, []),
    cleanup: (page) => page.unrouteAll({ behavior: "ignoreErrors" }),
  },
  {
    name: "agents-webhooks",
    path: "/agents",
    fullPage: true,
    prepare: async (page) => {
      await mockWebhooks(page, [{ ...webhookBase, agentId: "claude-for-alex" }], workingDeliveries);
      await openDeliveries(page);
    },
    cleanup: (page) => page.unrouteAll({ behavior: "ignoreErrors" }),
  },
  {
    name: "agents-webhooks-failing",
    path: "/agents",
    fullPage: true,
    prepare: async (page) => {
      await mockWebhooks(
        page,
        [
          {
            ...webhookBase,
            url: "https://printer-notes.example.net/api/spaghetti/events",
            kinds: ["all"],
            state: "failing",
            lastError: "It answered 502.",
            lastErrorAt: minutesAgo(95),
            lastDeliveredAt: minutesAgo(60 * 30),
          },
        ],
        failingDeliveries,
      );
      await openDeliveries(page);
    },
    cleanup: (page) => page.unrouteAll({ behavior: "ignoreErrors" }),
  },
  {
    name: "agents-webhook-new",
    path: "/agents",
    prepare: async (page) => {
      await mockWebhooks(page, [], []);
      await page.getByRole("button", { name: "New webhook" }).click();
      const sheet = page.getByRole("dialog", { name: "New webhook" });
      await sheet.getByLabel("Address").fill("https://hooks.example.org/spaghetti");
      await sheet.getByRole("button", { name: "Attempts" }).click();
      await sheet.getByRole("button", { name: "Comments" }).click();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
  {
    name: "agents-webhook-secret",
    path: "/agents",
    prepare: async (page) => {
      await mockWebhooks(page, []);
      await page.getByRole("button", { name: "New webhook" }).click();
      const sheet = page.getByRole("dialog", { name: "New webhook" });
      await sheet.getByLabel("Address").fill("https://hooks.example.org/spaghetti");
      await sheet.getByRole("button", { name: "Add webhook" }).click();
      await page.getByRole("dialog", { name: "Copy the secret" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.unrouteAll({ behavior: "ignoreErrors" });
    },
  },
  {
    // The iPhone Shortcut's steps, with the key already in them (a stand-in here: the real one is random).
    name: "agents-share-setup",
    path: "/agents",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Set up sharing from iPhone" }).click();
      const steps = page.getByTestId("share-setup");
      await steps.waitFor();
      await steps.evaluate((element) => {
        for (const node of Array.from(element.querySelectorAll("p"))) {
          if (node.textContent?.startsWith("Bearer spg_")) node.textContent = "Bearer spg_Xk3vRq9TmWz2…";
        }
      });
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  { name: "idea", path: `/ideas/${SEED_IDS.deskTidy}` },
  {
    // Another photo picked in the strip and tapped again: its menu (Make cover, Remove photo), a sheet on phones and a
    // popover from the thumbnail on desktop. Nothing on the big photo removes (decision 0054).
    name: "idea-photo-menu",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      const second = page.getByRole("button", { name: "Photo 2" });
      await second.click();
      await page.waitForTimeout(400);
      await second.click();
      await page.getByRole("button", { name: "Remove photo" }).waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // The first press of Delete on an idea: the trash can has turned into the question, in the bar.
    name: "idea-delete-confirm",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("list", { name: "Ideas" }).getByRole("link").first().click();
      await page.getByRole("textbox", { name: "Title" }).waitFor();
      await page.getByRole("button", { name: "Delete idea" }).click();
      await page.getByRole("button", { name: "Delete", exact: true }).waitFor();
    },
  },
  // Ideas with a model show it on the card; one tap on "Has a model" keeps only those.
  {
    name: "ideas-has-a-model",
    path: "/ideas",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Has a model/ }).click();
      await page.waitForTimeout(500);
    },
  },
  // An idea with someone named: the quiet "for the kitchen" line, no chip.
  { name: "idea-for", path: "/ideas/5eed0000-0000-4000-8000-000000000003" },
  // An idea for the person looking at it: the line reads "for you".
  { name: "idea-for-you", path: "/ideas/5eed0000-0000-4000-8000-000000000013" },
  // Nobody named yet, the offer's pencil just tapped: the line opens under the title with the caret in it, no box.
  {
    name: "idea-for-asking",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^For someone( else)?$/ }).click();
      await page.getByRole("textbox", { name: "For", exact: true }).waitFor();
      await page.waitForTimeout(300);
    },
  },
  // The same idea in full: its note's link as a card under it.
  {
    name: "idea-links",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      const card = page.getByRole("link", { name: /Model on MakerWorld/ });
      await card.getByText("Drawer bins, 42 mm grid").waitFor();
      await card.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
  },
  // The thread under an idea and a build (one comment unread on the idea), the empty one, the composer in use, and the card's unread mark.
  // First: opening a thread marks it read.
  {
    name: "comments-unread-card",
    path: "/ideas",
    selector: "li:has(a:has-text('Desk tidy-up'))",
  },
  { name: "comments-idea", path: `/ideas/${SEED_IDS.deskTidy}`, prepare: (page) => showThread(page) },
  { name: "comments-build", path: `/builds/${SEED_BUILD_IDS.tugboat}`, prepare: (page) => showThread(page) },
  { name: "comments-empty", path: `/ideas/${SEED_IDS.desiccantHook}`, prepare: (page) => showThread(page, false) },
  // Reactions: the picker under an idea (a menu on desktop, a sheet on phones), and a comment's menu: the other
  // person's message (reactions only) and your own (reactions over Edit and Delete).
  {
    name: "reactions-idea-picker",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      const button = page.getByRole("button", { name: "React to this idea" });
      // Playwright's own scrolling lands this under the phone's tab bar: centre it and press it in the page.
      await button.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        (el as HTMLElement).click();
      });
      await page.getByRole("group", { name: "Reactions" }).waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "reactions-idea-picker-more",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      const button = page.getByRole("button", { name: "React to this idea" });
      await button.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        (el as HTMLElement).click();
      });
      await page.getByRole("button", { name: "More emoji" }).click();
      await page.getByRole("gridcell").first().waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "reactions-idea-picker-full",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      const button = page.getByRole("button", { name: "React to this idea" });
      await button.evaluate((el) => {
        el.scrollIntoView({ block: "center" });
        (el as HTMLElement).click();
      });
      await page.getByRole("button", { name: "More emoji" }).click();
      const search = page.getByRole("searchbox", { name: "Search emoji" });
      await search.waitFor();
      await page.getByRole("gridcell").first().waitFor();
      await search.fill("party");
      await page.getByRole("gridcell", { name: "party popper" }).waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    name: "reactions-picker-keyboard",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: (page) => openPickerWithKeyboard(page),
  },
  {
    name: "reactions-picker-keyboard-rocket",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: (page) => openPickerWithKeyboard(page, "rocket"),
  },
  {
    name: "reactions-picker-keyboard-empty",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: (page) => openPickerWithKeyboard(page, "zzzzq"),
  },
  {
    name: "reactions-picker-empty",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await openFullPicker(page);
      await page.getByRole("searchbox", { name: "Search emoji" }).fill("zzzzq");
      await page.getByText("Nothing like that in the pantry").waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "reactions-picker-scrolled",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await openFullPicker(page);
      await page.locator("[frimousse-viewport]").evaluate((el) => {
        el.scrollTop = 1500;
      });
      await page.waitForTimeout(600);
    },
  },
  {
    name: "reactions-picker-skin-tone",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await openFullPicker(page);
      await page.getByRole("searchbox", { name: "Search emoji" }).fill("thumbs");
      const tone = page.getByRole("button", { name: /Skin tone/ });
      await tone.click();
      await tone.click();
      await tone.click();
      await page
        .getByRole("gridcell", { name: /thumbs up/i })
        .first()
        .waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    // Five or more different reactions on one idea: the card shows four and "+n".
    name: "reactions-card-many",
    path: "/ideas",
    selector: "li:has(a:has-text('Desk tidy-up'))",
    prepare: async (page) => {
      const origin = new URL(page.url()).origin;
      for (const emoji of ["🔥", "🎉", "🍝", "👏"]) {
        await page.request.put(`/api/items/${SEED_IDS.deskTidy}/reactions/${encodeURIComponent(emoji)}`, {
          headers: { Origin: origin },
        });
      }
      await page.reload();
      await page
        .getByRole("img", { name: /^Reactions:/ })
        .first()
        .waitFor();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "reactions-comment",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: (page) => openCommentMenu(page, commentId(8), /^React to /),
  },
  {
    name: "reactions-own-comment",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: (page) => openCommentMenu(page, commentId(7), "Options for your comment"),
  },
  {
    name: "comments-composing",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    prepare: async (page) => {
      await showThread(page);
      const phone = (page.viewportSize()?.width ?? 1440) < 768;
      if (phone) await page.getByRole("button", { name: /Say something to/ }).click();
      const field = page.getByRole("textbox", { name: /Say something to/ });
      await field.click();
      await field.fill("Perfect, I'll print the bins tonight. Is the blue PETG in slot B2 or still on the shelf?");
      await page.waitForTimeout(400);
    },
  },
  {
    name: "undo",
    path: "/ideas",
    prepare: async (page) => {
      await page.goto(`/ideas/${SEED_IDS.deskTidy}`);
      await page.getByRole("button", { name: "Delete idea" }).first().click();
      // Deleting an idea asks in place first (decision 0062): confirm.
      await page.getByRole("button", { name: "Delete", exact: true }).click();
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
    // The phone account sheet scrolled to its end: the signing-in rows, the theme and Sign out.
    name: "account-end",
    path: "/ideas",
    width: 390,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Account" }).click();
      const sheet = page.getByRole("dialog");
      await sheet.getByRole("button", { name: "Sign out", exact: true }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
  },
  {
    // Change password, with a wrong current password said under its field and what was typed kept.
    name: "change-password",
    path: "/ideas",
    width: 390,
    prepare: async (page) => {
      await openAccountRow(page, 390, "Passkeys and password");
      await page
        .getByRole("dialog", { name: "Passkeys and password" })
        .getByRole("button", { name: "Change password" })
        .click();
      const sheet = page.getByRole("dialog", { name: "Change password" });
      await sheet.waitFor();
      await sheet.getByLabel("Current password").fill("pasta-al-dente");
      await sheet.getByLabel("New password").fill("a-fresh-pot-of-pasta");
      await sheet.getByRole("button", { name: "Save new password" }).click();
      await sheet.getByText("That isn't your current password.").waitFor();
    },
  },
  {
    // Change password, with a wrong current password said under its field and what was typed kept.
    name: "change-password-desktop",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await openAccountRow(page, 1440, "Passkeys and password");
      await page
        .getByRole("dialog", { name: "Passkeys and password" })
        .getByRole("button", { name: "Change password" })
        .click();
      const sheet = page.getByRole("dialog", { name: "Change password" });
      await sheet.waitFor();
      await sheet.getByLabel("Current password").fill("pasta-al-dente");
      await sheet.getByLabel("New password").fill("a-fresh-pot-of-pasta");
      await sheet.getByRole("button", { name: "Save new password" }).click();
      await sheet.getByText("That isn't your current password.").waitFor();
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
    // A problem's word: what fixed it leads, with the failure it came after and what changed since.
    name: "palette-fixed",
    path: "/ideas",
    width: 1440,
    prepare: async (page) => {
      await page.keyboard.press("ControlOrMeta+k");
      await page.getByRole("combobox", { name: "Jump to or run" }).pressSequentially("warping");
      await page
        .getByRole("group", { name: /^(What fixed it|Attempts)$/ })
        .first()
        .waitFor();
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
  { name: "twists", path: "/twists", fullPage: true },
  {
    name: "twist",
    path: `/twists/${SEED_TWIST_IDS.bins}`,
    fullPage: true,
  },
  {
    // The way in: an idea with a model has "Make a twist" in the quiet row under the model, beside "Add a file".
    name: "twist-from-idea",
    path: "/ideas/5eed0000-0000-4000-8000-000000000001",
    fullPage: true,
    prepare: async (page) => {
      const patched = await page.request.patch("/api/items/5eed0000-0000-4000-8000-000000000001", {
        headers: { Origin: new URL(page.url()).origin },
        data: {
          note: "Found this on the bed this morning. Retry the cable chain with a brim and a slower first layer.\n\nhttps://makerworld.com/en/models/301122-cable-chain",
        },
      });
      if (!patched.ok()) throw new Error(`Planter note: ${patched.status()} ${await patched.text()}`);
      await page.reload();
      await page.getByRole("button", { name: "Make a twist" }).waitFor();
    },
  },
  {
    // A build from a model page: "Save as twist" is a quiet action under its model link.
    name: "build-save-as-twist",
    fullPage: true,
    path: `/builds/${SEED_BUILD_IDS.headphoneStand}`,
    prepare: async (page) => {
      await page.request.patch(`/api/items/${SEED_BUILD_IDS.headphoneStand}`, {
        headers: { Origin: new URL(page.url()).origin },
        data: { note: "Charcoal matte PLA.\n\nhttps://makerworld.com/en/models/301122-headphone-stand" },
      });
      await page.reload();
      await page.getByRole("button", { name: "Save as twist" }).waitFor();
    },
  },
  {
    name: "search-twists",
    path: "/search?q=drawer",
    prepare: async (page) => {
      await page.getByRole("region", { name: "Twists" }).waitFor();
    },
  },
  {
    // The idea the bins twist came from: the same action now reads "Twist" and opens it.
    name: "twist-from-idea-made",
    path: `/ideas/${SEED_IDS.deskTidy}`,
    fullPage: true,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Twist", exact: true }).waitFor();
    },
  },
  {
    // Adapting an STL: a file chosen, fitted to a length and mirrored, before the new file is made.
    name: "twist-adapt",
    path: `/twists/${SEED_TWIST_IDS.bins}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: "Adapt an STL" }).click();
      const sheet = page.getByRole("dialog", { name: "Adapt an STL" });
      await sheet
        .getByTestId("adapt-file-input")
        .setInputFiles({ name: "gridfinity-bin.stl", mimeType: "model/stl", buffer: gridfinityBin() });
      await sheet.getByRole("textbox", { name: "Fit to length" }).fill("63");
      await sheet.getByRole("button", { name: "Fit", exact: true }).click();
      await sheet.getByRole("button", { name: "X", exact: true }).first().click();
      await page.waitForTimeout(500);
    },
  },
  {
    // Adapted and kept (decision 0053): the twist page leads with the model's plate picture and shows its card.
    name: "twist-model",
    path: "/twists",
    prepare: async (page) => {
      await twistWithModel(page);
      // A viewport shot (a full page draws the phone's tab bar mid-page): the phone is scrolled to the card.
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await page
          .getByRole("region", { name: "Model" })
          .evaluate((region) => region.scrollIntoView({ block: "center", behavior: "instant" }));
        await page.waitForTimeout(400);
      }
    },
    cleanup: removeTwistModels,
  },
  {
    // The twist's model's "…": Remove is in there, as on an idea's files.
    name: "twist-model-menu",
    path: "/twists",
    prepare: async (page) => {
      await twistWithModel(page);
      await page
        .getByRole("region", { name: "Model" })
        .getByRole("button", { name: /^More for / })
        .click();
      await page.getByRole("button", { name: "Remove file" }).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: removeTwistModels,
  },
  {
    // A twist's model sliced for a 0.2 mm nozzle that isn't fitted as the main one (decision 0057): its card says so, and
    // "Print it" carries one calm line (above the button on a phone, beside it on desktop). Printing isn't blocked.
    name: "twist-model-other-nozzle",
    path: "/twists",
    prepare: async (page) => {
      await twistWithModel(page);
      const model = page.getByRole("region", { name: "Model" });
      await model.getByRole("button", { name: /^Slice with…/ }).click();
      const settings = page.getByRole("dialog", { name: "How to slice it" });
      await settings.getByRole("button", { name: /^More/ }).click();
      await settings.getByRole("radio", { name: /^0\.2 mm/ }).click();
      await page.keyboard.press("Escape");
      await model
        .getByText("Sliced for a 0.2 mm nozzle; the main nozzle has the 0.4 mm. Fit the 0.2 mm first.")
        .first()
        .waitFor({ timeout: 90_000 });
      await page
        .getByText("Sliced for a 0.2 mm nozzle; the main nozzle has the 0.4 mm. Fit the 0.2 mm first.")
        .last()
        .waitFor();
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      if ((page.viewportSize()?.width ?? 1440) < 768) {
        await model.evaluate((region) => region.scrollIntoView({ block: "center", behavior: "instant" }));
      }
      await page.waitForTimeout(500);
    },
    cleanup: removeTwistModels,
  },
  {
    // The Twists screen: a twist with no photo takes its model's plate picture as its cover.
    name: "twists-model-cover",
    path: "/twists",
    prepare: async (page) => {
      await twistWithModel(page);
      await page.goto("/twists", { waitUntil: "networkidle" });
      const alt = "Slicer preview: Fusilli jar knob";
      await page.waitForFunction((name) => document.querySelectorAll(`img[alt="${name}"]`).length === 1, alt);
      await page
        .getByRole("img", { name: alt })
        .evaluate((img) => img.closest("li")?.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(400);
    },
    cleanup: removeTwistModels,
  },
  {
    // "Print it": the build the twist printed, its first attempt carrying the sliced file (plate picture and 3D view).
    name: "twist-printed-build",
    path: "/twists",
    fullPage: true,
    prepare: async (page) => {
      await twistWithModel(page);
      await page.getByRole("button", { name: "Print it" }).first().click();
      await page.waitForURL(/\/builds\/[\w-]+$/);
      await page
        .getByRole("button", { name: /in 3D$/ })
        .first()
        .waitFor({ timeout: 60_000 });
      await page.waitForTimeout(600);
    },
    cleanup: removeTwistModels,
  },
  {
    name: "twist-new",
    path: "/twists",
    prepare: async (page) => {
      await page.getByRole("button", { name: "New twist" }).first().click();
      const sheet = page.getByRole("dialog");
      await sheet.waitFor();
      await sheet.getByRole("textbox", { name: "Name it" }).fill("Planter, 0.2 looser");
      await page.waitForTimeout(400);
    },
  },
  {
    // A twist with no picture: its card on the list is an index card, and its page has no photo column.
    name: "twist-no-photo",
    path: `/twists/${SEED_TWIST_IDS.lid}`,
    fullPage: true,
  },
  {
    name: "twists-no-photo",
    path: "/twists",
    fullPage: true,
    prepare: async (page) => {
      await page.getByRole("link", { name: /Pen cup/ }).waitFor();
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
  {
    name: "styleguide-pressed",
    path: "/styleguide",
    beforeShot: async (page) => {
      await page.locator("#pressed").evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(300);
    },
  },
  { name: "styleguide-plate-picker", path: "/styleguide", selector: "#plate-picker" },
  { name: "styleguide-plate-picker-header", path: "/styleguide", selector: "#plate-picker-header" },
  { name: "styleguide-plate-picker-loading", path: "/styleguide", selector: "#plate-picker-loading" },
  {
    name: "styleguide-plate-picker-sheet",
    path: "/styleguide",
    // The phone's sheet of large tiles (desktop has the row, so there is nothing to open there).
    beforeShot: async (page) => {
      await page.locator("#plate-picker").evaluate((el) => el.scrollIntoView({ block: "center" }));
      const button = page.locator("#plate-picker button");
      if (await button.count()) await button.click();
      await page.waitForTimeout(700);
    },
  },
  { name: "styleguide-controls", path: "/styleguide", selector: "#controls" },
  { name: "styleguide-layer-slider", path: "/styleguide", selector: "#layer-slider" },
  { name: "styleguide-buttons", path: "/styleguide", selector: "#buttons" },
  { name: "styleguide-builds", path: "/styleguide", selector: "#builds" },
  {
    name: "styleguide-covers",
    path: "/styleguide",
    selector: "#covers",
    prepare: async (page) => {
      await page.locator("#covers img").first().waitFor();
      await page.waitForTimeout(600);
    },
  },
  { name: "styleguide-search", path: "/styleguide", selector: "#search" },
  { name: "styleguide-spools", path: "/styleguide", selector: "#pantry" },
  { name: "styleguide-recipes", path: "/styleguide", selector: "#recipes" },
  {
    name: "styleguide-twists",
    path: "/styleguide",
    selector: "#twists",
    // The empty state fades in: shoot it once it has.
    beforeShot: async (page) => {
      await page.locator("#twists").evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(800);
    },
  },
  { name: "styleguide-year", path: "/styleguide", selector: "#year" },
  { name: "styleguide-error", path: "/styleguide", selector: "#error" },
  {
    // The error screen as people meet it: a screen's code throws as the app opens it (the styleguide's module is
    // made to fail), so the router shows its default error component inside the app.
    name: "error-screen",
    path: "/today",
    prepare: async (page) => {
      await page.route("**/routes/_app/styleguide.tsx*", (route) =>
        route.fulfill({
          contentType: "text/javascript",
          body: "throw new Error(\"Cannot read properties of undefined (reading 'title')\");",
        }),
      );
      await page.evaluate(() => {
        history.pushState({}, "", "/styleguide");
        dispatchEvent(new PopStateEvent("popstate"));
      });
      await page.getByText("That got tangled").waitFor();
      await page.waitForTimeout(500);
    },
  },
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
  // The first twelve spools: a dual-colour and a tri-colour silk, each as its page shows it (no label photo: the
  // spool itself, drawn in its colours, is the hero).
  { name: "spool-dual-colour", path: `/pantry/${SEED_SPOOL_IDS.blackPurple}`, fullPage: true },
  { name: "spool-tri-colour", path: `/pantry/${SEED_SPOOL_IDS.blackGoldPurple}`, fullPage: true },
  {
    // The new-spool sheet: a known product chosen (a tri-colour silk), its colours picked in order.
    name: "spool-add-multicolour",
    path: "/pantry",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Add (a )?spool/ })
        .first()
        .click();
      const sheet = page.getByRole("dialog", { name: "New spool" });
      await sheet.waitFor();
      await sheet.getByRole("button", { name: /^SUNLU PLA\+ Silk tri-colour/ }).click();
      await sheet.getByRole("group", { name: "Material" }).scrollIntoViewIfNeeded();
      await sheet.getByRole("radiogroup", { name: "Colour to change" }).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  // Read the label (decision 0031): the way in, in Add a spool ...
  {
    name: "spool-add-label",
    path: "/pantry",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Add (a )?spool/ })
        .first()
        .click();
      const dialog = page.getByRole("dialog", { name: "New spool" });
      await dialog.getByText(/Claude fills in what the label says/).waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  // ... while Claude reads it (the stand-in takes ten seconds for a "slow" one) ...
  {
    name: "spool-label-reading",
    path: "/pantry",
    prepare: async (page) => {
      await labelSpool(page, "Slow shipping, arrived last week", "jade");
      await page.getByText("Reading the label…").first().waitFor({ timeout: 8_000 });
    },
    cleanup: removeLabelSpools,
  },
  // ... the spool it filled, with "from the label" on what it read ...
  {
    name: "spool-label-filled",
    path: "/pantry",
    fullPage: true,
    prepare: async (page) => {
      await labelSpool(page, "Arrived last week", "jade");
      await page
        .getByRole("textbox", { name: "Brand" })
        .and(page.locator("[value='Bambu Lab']"))
        .waitFor({ timeout: 30_000 });
    },
    cleanup: removeLabelSpools,
  },
  // ... and a photo with two labels: the list to confirm.
  {
    name: "spool-label-several",
    path: "/pantry",
    prepare: async (page) => {
      await labelSpool(page, "Two in one photo", "two");
      await page.getByRole("dialog", { name: "2 spools on this label" }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removeLabelSpools(page);
    },
  },
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
  {
    // The AMS with a dual-colour silk in A3 and a tri-colour in A4.
    name: "printer-multicolour",
    path: "/printer",
    prepare: async (page) => {
      await loadMultiColourSpools(page);
      await page.reload();
      await page.getByRole("list", { name: "Upkeep tasks" }).waitFor();
      await page.getByRole("button", { name: /^A3 Black\/Purple/ }).scrollIntoViewIfNeeded();
    },
  },
  {
    name: "printer",
    path: "/printer",
    fullPage: true,
    // Upkeep and the slicing defaults load once the page is idle: wait for them, or the shot shows their skeletons.
    prepare: async (page) => {
      await page.getByRole("list", { name: "Upkeep tasks" }).waitFor();
      await slicingDefaults(page)
        .getByRole("button", { name: /^How new models are sliced/ })
        .waitFor();
    },
  },
  {
    // The workspace's slicing defaults (decision 0051), folded as "Staying dry" is: what they are, in the model
    // card's words.
    name: "printer-slicing-folded",
    path: "/printer",
    selector: "section[aria-labelledby=printer-slicing]",
    prepare: async (page) => {
      await slicingDefaults(page)
        .getByRole("button", { name: /^How new models are sliced/ })
        .waitFor();
    },
  },
  {
    // Open: how a model nobody set up is sliced here, the same choices as a model's without what is each model's own.
    name: "printer-slicing",
    path: "/printer",
    selector: "section[aria-labelledby=printer-slicing]",
    prepare: async (page) => {
      await openSlicingDefaults(page);
    },
  },
  {
    // The defaults changed (Fine): saved, with the way back to the usual settings beside the caption.
    name: "printer-slicing-own",
    path: "/printer",
    selector: "section[aria-labelledby=printer-slicing]",
    prepare: async (page) => {
      const section = await openSlicingDefaults(page);
      await section.getByRole("group", { name: "Quality" }).getByRole("radio", { name: /^Fine/ }).click();
      await section.getByRole("button", { name: "Back to the usual settings" }).waitFor();
      // "Saving…" fades out before "Saved" comes in, late under the shots' fixed clock: finish its fades as they come.
      await section.evaluate(
        (element) =>
          new Promise<void>((resolve) => {
            const done = () => {
              for (const animation of element.getAnimations({ subtree: true })) animation.finish();
              if (element.textContent?.includes("Saved")) resolve();
              else setTimeout(done, 50);
            };
            done();
          }),
      );
      await settleSection(page, section);
    },
    // The shots after this one slice with Spaghetti's own again.
    cleanup: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      await page.request.put("/api/printer", { headers, data: { slicing: null } });
    },
  },
  {
    // A 0.2 mm nozzle fitted on the right (decision 0056): the Printer page's nozzles, and its slicing defaults say
    // what new models are sliced for.
    name: "printer-small-nozzle",
    path: "/printer",
    fullPage: true,
    prepare: async (page) => {
      await fitSmallNozzle(page);
      await page.reload();
      await page.getByRole("list", { name: "Upkeep tasks" }).waitFor();
      await slicingDefaults(page)
        .getByRole("button", { name: /^How new models are sliced/ })
        .waitFor();
    },
    cleanup: fitStockNozzles,
  },
  {
    // Open, with the two nozzles different: new models slice for the main nozzle, and one line where the filament's
    // rule is says how to slice for the other.
    name: "printer-slicing-nozzle",
    path: "/printer",
    selector: "section[aria-labelledby=printer-slicing]",
    prepare: async (page) => {
      await fitSmallNozzle(page);
      await page.reload();
      const section = await openSlicingDefaults(page);
      await section.getByText("New models slice for the main nozzle (0.4 mm)").waitFor();
      await settleSection(page, section);
    },
    cleanup: fitStockNozzles,
  },
  {
    // Which slicer slices new models (decision 0055), at the end of the defaults' More: Spaghetti's own picked, what
    // it does, and the way back to the usual settings.
    name: "printer-slicer",
    path: "/printer",
    selector: "section[aria-labelledby=printer-slicing]",
    prepare: async (page) => {
      const section = await openSlicingDefaults(page);
      await section.getByRole("button", { name: /^More/ }).click();
      const slicer = section.getByRole("group", { name: "Slicer" });
      await slicer.getByRole("radio", { name: "Spaghetti's own" }).click();
      await section.getByRole("button", { name: "Back to the usual settings" }).waitFor();
      // No hover left on the section's controls.
      await page.mouse.move(0, 0);
      await section.evaluate(
        (element) =>
          new Promise<void>((resolve) => {
            const done = () => {
              for (const animation of element.getAnimations({ subtree: true })) animation.finish();
              if (element.textContent?.includes("Saved")) resolve();
              else setTimeout(done, 50);
            };
            done();
          }),
      );
      await settleSection(page, section);
    },
    cleanup: async (page) => {
      await setSlicingDefaults(page, null);
    },
  },
  {
    // The connection gone while they are open: the setup is only for reading (lib/read-only.ts), their tiles,
    // More and the way back dimmed.
    name: "printer-slicing-offline",
    path: "/printer",
    selector: "section[aria-labelledby=printer-slicing]",
    prepare: async (page) => {
      const section = await openSlicingDefaults(page);
      await page.context().setOffline(true);
      await section.locator("input[type=radio]:disabled").first().waitFor({ state: "attached" });
      await settleSection(page, section);
    },
    cleanup: async (page) => {
      await page.context().setOffline(false);
    },
  },
  // Upkeep: the list with its meters, and the Done sheet of the most due task.
  { name: "printer-upkeep", path: "/printer", selector: "section[aria-labelledby=printer-upkeep]" },
  {
    name: "upkeep-done",
    path: "/printer",
    prepare: async (page) => {
      await page
        .getByRole("button", { name: /^Done: / })
        .first()
        .click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(400);
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  // A spool past its drying window (teal PETG, dried 24 days ago).
  { name: "spool-needs-drying", path: `/pantry/${SEED_SPOOL_IDS.tealPetg}`, fullPage: true },
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
  // Claude read the bridge's photo of the drawer divider: the sheet hints Spaghetti, not picked, with why ...
  {
    name: "attempt-photo-read-spaghetti",
    path: `/builds/${SEED_BUILD_IDS.drawerDivider}`,
    prepare: async (page) => {
      await openOffBedSheet(page);
      await page
        .getByRole("dialog")
        .getByRole("radio", { name: /suggested/ })
        .waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
    },
  },
  // ... one it reads as a good print ...
  {
    name: "attempt-photo-read-worked",
    path: "/builds",
    prepare: async (page) => {
      await printWithPhoto(page, "Spice jar lid");
      const dialog = page.getByRole("dialog");
      await openOffBedSheet(page);
      await dialog.getByRole("radio", { name: /Worked suggested/ }).waitFor({ timeout: 30_000 });
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removePhotoReadBuilds(page);
    },
  },
  // ... and while it is still looking (the stand-in takes ten seconds for a "slow" one).
  {
    name: "attempt-photo-read-looking",
    path: "/builds",
    prepare: async (page) => {
      await printWithPhoto(page, "Slow lid spaghetti");
      await openOffBedSheet(page);
      await page.getByRole("dialog").getByText("Looking at the photo…").waitFor({ timeout: 8_000 });
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removePhotoReadBuilds(page);
    },
  },
  // The failure coach (decision 0027): Claude thinks about the next try (the stand-in holds its answer back) ...
  {
    name: "build-coach-thinking",
    path: "/builds",
    prepare: async (page) => {
      await failedBuild(page, "Coach slow stern test");
      await page.getByText("Thinking about the next try…").waitFor({ timeout: 8_000 });
    },
    selector: "[data-attempt-id]",
    // The floating Log attempt button and tab bar would sit over the card's foot, where the line is.
    beforeShot: async (page) => {
      await page.evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *")))
          if (getComputedStyle(el).position === "fixed") el.style.visibility = "hidden";
      });
    },
    cleanup: removePhotoReadBuilds,
  },
  // ... its ideas under the seeded tugboat's partly attempt (the stern corners curled) ...
  {
    name: "build-coach",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
      await page.getByRole("region", { name: "Claude's ideas for the next try" }).waitFor({ timeout: 15_000 });
    },
    fullPage: true,
  },
  // ... and in the Log attempt sheet as "Use this" chips, before a tap ...
  {
    name: "attempt-coach-chips",
    path: "/builds",
    prepare: async (page) => {
      await failedBuild(page, "Coach stern test");
      await page.getByRole("region", { name: "Claude's ideas for the next try" }).waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      await page.getByRole("dialog").getByRole("region", { name: "Claude's ideas for the next try" }).waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removePhotoReadBuilds(page);
    },
  },
  // ... and after tapping two of them: the sheet's changes now say what was filled in.
  {
    name: "attempt-coach-used",
    path: "/builds",
    prepare: async (page) => {
      await failedBuild(page, "Coach stern test");
      await page.getByRole("region", { name: "Claude's ideas for the next try" }).waitFor({ timeout: 15_000 });
      await page.getByRole("button", { name: "Log attempt" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("button", { name: "Use this" }).first().click();
      await dialog.getByRole("button", { name: "Use this" }).first().click();
      await dialog.getByText("In this attempt").first().waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await removePhotoReadBuilds(page);
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
  {
    name: "shopping",
    path: "/shopping",
    fullPage: true,
    // The pictures come from the Worker's bucket: wait until they have all arrived.
    prepare: async (page) => {
      await page.waitForFunction(
        () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0),
        null,
        {
          timeout: 20_000,
        },
      );
    },
  },
  {
    // A thing on the list, open: its name, the shop and its Prisjakt page.
    name: "shopping-sheet",
    path: "/shopping",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Hardened steel nozzle, 0.4 mm", exact: true }).click();
      await page.getByRole("dialog").getByLabel("Prisjakt", { exact: true }).waitFor();
    },
  },
  {
    // A thing with a Prisjakt page, open: its picture, the cheapest price found and the offers, as tappable rows.
    name: "shopping-prices-sheet",
    path: "/shopping",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Liquid glue for the build plate", exact: true }).click();
      await page.getByRole("dialog").getByRole("list", { name: "Cheapest offers" }).waitFor({ timeout: 20_000 });
    },
  },
  {
    // A thing with no Prisjakt page yet: the page a search found, for a person to confirm.
    name: "shopping-suggestion-sheet",
    path: "/shopping",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Silica gel for the dry box", exact: true }).click();
      await page.getByRole("dialog").getByText("Is this it?").waitFor({ timeout: 20_000 });
    },
  },
  {
    // Nothing on the list yet.
    name: "shopping-empty",
    path: "/shopping",
    prepare: async (page) => {
      await page.route("**/api/shopping-items", (route) =>
        route.request().method() === "GET" ? route.fulfill({ json: { shoppingItems: [] } }) : route.continue(),
      );
      await page.reload();
      await page.getByRole("heading", { name: "The cupboard is full" }).waitFor();
    },
    // The empty state's entrance can sit at opacity 0 in a shot: finish it by hand.
    beforeShot: async (page) => {
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
    },
    cleanup: async (page) => {
      await page.unroute("**/api/shopping-items");
    },
  },
  { name: "workshop", path: "/workshop", fullPage: true },
  {
    // A new notebook: no spools, nothing loaded, nothing due, nothing to buy.
    name: "workshop-empty",
    path: "/workshop",
    fullPage: true,
    prepare: async (page) => {
      await page.route(/\/api\/spools$/, (route) => route.fulfill({ json: { spools: [] } }));
      await page.route(/\/api\/shopping-items$/, (route) => route.fulfill({ json: { shoppingItems: [] } }));
      await page.route(/\/api\/printer\/upkeep$/, (route) => route.fulfill({ json: { tasks: [], printHours: 0 } }));
      await page.route(/\/api\/printer$/, async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as object;
        await route.fulfill({ response, json: { ...json, slots: {} } });
      });
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("No spools yet").waitFor();
    },
    cleanup: unmockToday,
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
  // Parts and quantities: a build made of parts, with progress ...
  {
    name: "build-parts",
    path: `/builds/${SEED_BUILD_IDS.paddleSteamer}`,
    prepare: async (page) => {
      const parts = page.getByRole("region", { name: "Parts" });
      await parts.waitFor();
      await parts.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
  },
  {
    // ... the attempt sheet's "What's on the plate" row (a plate from the slicer file preselects its parts) ...
    name: "build-parts-sheet",
    path: `/builds/${SEED_BUILD_IDS.paddleSteamer}`,
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Attempt 2: partial\. Open$/ }).click();
      await page.getByRole("group", { name: "Hull half, pieces" }).waitFor();
    },
    cleanup: async (page) => {
      await page.keyboard.press("Escape");
      await page.reload();
    },
  },
  {
    // ... every part printed: the build offers to finish it (the seed's second attempt gets the rest of the counts) ...
    name: "build-parts-all-printed",
    path: `/builds/${SEED_BUILD_IDS.paddleSteamer}`,
    prepare: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      const { item } = await (await page.request.get(`/api/items/${SEED_BUILD_IDS.paddleSteamer}`)).json();
      const id = (name: string) => item.parts.find((part: { name: string }) => part.name === name).id;
      await page.request.patch(`/api/attempts/${item.attempts[1].id}`, {
        headers,
        data: {
          parts: [
            { partId: id("Hull half"), count: 2 },
            { partId: id("Deck"), count: 1 },
            { partId: id("Paddle wheel"), count: 1 },
          ],
        },
      });
      await page.reload();
      const done = page.getByTestId("all-printed");
      await done.waitFor();
      await page
        .getByRole("region", { name: "Parts" })
        .evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
    cleanup: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      const { item } = await (await page.request.get(`/api/items/${SEED_BUILD_IDS.paddleSteamer}`)).json();
      const id = (name: string) => item.parts.find((part: { name: string }) => part.name === name).id;
      await page.request.patch(`/api/attempts/${item.attempts[1].id}`, {
        headers,
        data: {
          parts: [
            { partId: id("Hull half"), count: 1 },
            { partId: id("Deck"), count: 1 },
          ],
        },
      });
    },
  },
  {
    // ... the same build before it has parts: its slicer file offers them in one tap ...
    name: "build-parts-from-file",
    path: `/builds/${SEED_BUILD_IDS.paddleSteamer}`,
    prepare: async (page) => {
      await page.route(new RegExp(`/api/items/${SEED_BUILD_IDS.paddleSteamer}$`), async (route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { item: { parts: unknown[] } };
        body.item.parts = [];
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      const offer = page.getByRole("button", { name: /^Parts from the file/ });
      await offer.waitFor();
      await offer.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
    cleanup: async (page) => {
      await page.unroute(new RegExp(`/api/items/${SEED_BUILD_IDS.paddleSteamer}$`));
    },
  },
  {
    // ... and the journal row says which part an attempt printed.
    name: "journal-parts",
    path: "/journal",
    prepare: async (page) => {
      const row = page.getByText(/^Hull half/).first();
      await row.waitFor();
      await row.evaluate((element) => element.scrollIntoView({ block: "center" }));
    },
  },
  { name: "styleguide", path: "/styleguide", fullPage: true },
  { name: "model-mark-options", path: "/styleguide", selector: "#model-mark" },
  {
    // The moment before permission is asked for: the browser says nothing until the switch is turned on.
    name: "notifications-off",
    path: "/ideas",
    prepare: async (page) => {
      await withPermission(page, "default");
      await openNotifications(page, wide(page));
    },
  },
  {
    name: "notifications-on",
    path: "/ideas",
    prepare: async (page) => {
      await withPermission(page, "granted");
      await subscribedDevice(page);
      await openNotifications(page, wide(page));
      await page
        .getByRole("switch", { name: /Notify this device/ })
        .and(page.locator("[aria-checked=true]"))
        .waitFor();
      await page.getByRole("switch", { name: /Also tell me/ }).click();
      await page.waitForTimeout(300);
    },
  },
  {
    // Blocked in the browser's settings: said plainly, the switch can't be turned on.
    name: "notifications-blocked",
    path: "/ideas",
    prepare: async (page) => {
      await withPermission(page, "denied");
      await openNotifications(page, wide(page));
    },
  },
  {
    // The account menu with Alex's picture: the row says "Change photo".
    name: "account-photo",
    path: "/ideas",
    prepare: async (page) => {
      await openAccount(page, wide(page));
      await page.locator("[role=dialog] img[src*='/api/people/']").first().waitFor();
      await page.waitForTimeout(500);
    },
  },
  {
    // Placing a photo in the circle.
    name: "profile-crop",
    path: "/ideas",
    prepare: async (page) => {
      await openAccount(page, wide(page));
      await page.getByTestId("profile-photo-input").setInputFiles("e2e/fixtures/portrait.jpg");
      await page.getByTestId("crop-frame").locator("img").waitFor();
      await page.getByRole("slider", { name: "Zoom" }).fill("1.6");
      await page.waitForTimeout(400);
    },
  },
  {
    // A toast (Undo) over an open sheet: it sits above it, at the top on phones, and the sheet stays usable.
    name: "toast-over-sheet",
    path: "/ideas",
    prepare: async (page) => {
      const width = wide(page);
      await openAccount(page, width);
      await page.getByTestId("profile-photo-input").setInputFiles("e2e/fixtures/portrait.jpg");
      await page.getByTestId("crop-frame").locator("img").waitFor();
      await page.getByRole("button", { name: "Save" }).click();
      await page.getByText("Picture changed").waitFor();
      await openAccount(page, width);
      await page.waitForTimeout(600);
    },
  },
  { name: "styleguide-avatars", path: "/styleguide", selector: "#avatars" },
  { name: "styleguide-notifications", path: "/styleguide", selector: "#notifications" },
  { name: "styleguide-color", path: "/styleguide", selector: "#color" },
  { name: "styleguide-palette", path: "/styleguide", selector: "#palette" },
  { name: "styleguide-cards", path: "/styleguide", selector: "#cards" },
  { name: "styleguide-chips", path: "/styleguide", selector: "#chips" },
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
  // Last: it deletes the seeded twists, which the shots after it (the Workshop hub) would show gone.
  {
    name: "twists-empty",
    path: "/twists",
    prepare: async (page) => {
      const headers = { Origin: new URL(page.url()).origin };
      const { twists } = await (await page.request.get("/api/twists")).json();
      for (const twist of twists) await page.request.delete(`/api/twists/${twist.id}`, { headers });
      await page.reload();
      await page.getByText("Nothing twisted yet").waitFor();
      // The clock is fixed, so the empty state's entrance would sit at opacity 0: finish it.
      await page.evaluate(() =>
        document.getAnimations().forEach((animation) => {
          animation.finish();
        }),
      );
      await page.waitForTimeout(600);
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

// The Connect-the-bridge guide on the Printer page. After the shots that read the seeded bridge's status: the last two
// pair a stand-in bridge, which replaces it.
async function openConnectSheet(page: Page) {
  await page.getByRole("button", { name: /Connect the bridge|Set it up again/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect the bridge" });
  await dialog.locator("code").waitFor();
  await page.waitForTimeout(500);
  return dialog;
}
/** What the installer and the bridge do, from the sheet's own code: pairs, then sends a heartbeat. */
async function bridgeChecksIn(page: Page, dialog: ReturnType<Page["getByRole"]>, body: object) {
  const origin = new URL(page.url()).origin;
  const command = await dialog.locator("code").innerText();
  const code = /-- ([A-Z2-9]{4}-[A-Z2-9]{4})/.exec(command)?.[1] ?? "";
  const paired = (await (
    await fetch(`${origin}/api/bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
  ).json()) as { token: string };
  await fetch(`${origin}/api/printer/bridge`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${paired.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
shots.push(
  ...([
    { name: "printer-bridge-none", path: "/printer", selector: "[data-bridge]" },
    {
      name: "bridge-connect-waiting",
      path: "/printer",
      prepare: async (page) => {
        await openConnectSheet(page);
      },
      cleanup: async (page) => {
        await page.keyboard.press("Escape");
      },
    },
    {
      name: "bridge-connect-connected",
      path: "/printer",
      prepare: async (page) => {
        const dialog = await openConnectSheet(page);
        await bridgeChecksIn(page, dialog, {
          printerState: "idle",
          version: "1.0.0",
          platform: "darwin-arm64",
          problems: [],
        });
        await dialog.getByText("Connected to the X2D").waitFor({ timeout: 15_000 });
        await dialog.getByText("Connected to the X2D").scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      },
      cleanup: async (page) => {
        await page.keyboard.press("Escape");
      },
    },
    { name: "printer-bridge-connected", path: "/printer", selector: "[data-bridge]" },
    {
      name: "bridge-connect-problem",
      path: "/printer",
      prepare: async (page) => {
        const dialog = await openConnectSheet(page);
        await bridgeChecksIn(page, dialog, {
          printerState: "offline",
          version: "1.0.0",
          platform: "darwin-arm64",
          problems: [
            {
              code: "local-network",
              message:
                "Can't reach the printer at 192.168.1.50. If it is on and on this network, macOS may be blocking Spaghetti Bridge from the local network: open System Settings → Privacy & Security → Local Network and turn on Spaghetti Bridge.",
            },
          ],
        });
        await dialog.getByText(/macOS may be blocking/).waitFor({ timeout: 15_000 });
        await dialog.getByText(/macOS may be blocking/).scrollIntoViewIfNeeded();
        await page.waitForTimeout(400);
      },
      cleanup: async (page) => {
        await page.keyboard.press("Escape");
      },
    },
  ] as Shot[]),
);

/** The untitled capture in the seed: a photo of a failed print and a note, still an idea. */
const looseCapture = "5eed0000-0000-4000-8000-000000000001";

/** Opens "Add to a build…" on the loose capture's page and waits for the picker. */
async function openMovePicker(page: Page) {
  await page.getByRole("button", { name: /^Add to a build/ }).click();
  const sheet = page.getByRole("dialog", { name: "Add to a build" });
  await sheet.getByRole("button", { name: /Towel hook/ }).waitFor();
  await page.waitForTimeout(400);
  return sheet;
}

shots.push(
  ...([
    {
      // The idea's menu on the list, with the new row.
      name: "move-menu",
      path: "/ideas",
      prepare: async (page) => {
        await page
          .getByRole("button", { name: /^Options for Found this on the bed/ })
          .first()
          .click();
        await page.getByRole("button", { name: "Add to a build…" }).waitFor();
        await page.waitForTimeout(300);
      },
      cleanup: closeDialog,
    },
    {
      // The action on the idea's page: beside Start building (desktop), in the action bar (phones).
      name: "move-action",
      path: `/ideas/${looseCapture}`,
      prepare: async (page) => {
        await page.getByRole("button", { name: /^Add to a build/ }).waitFor();
        await page.waitForTimeout(400);
      },
    },
    {
      // The action on the idea's page, then the picker: the print on the bed first.
      name: "move-picker",
      path: `/ideas/${looseCapture}`,
      prepare: async (page) => {
        await page.getByRole("button", { name: "Start building" }).first().waitFor();
        await openMovePicker(page);
      },
      cleanup: closeDialog,
    },
    {
      // A build with attempts asks which one; the newest is first.
      name: "move-attempt",
      path: `/ideas/${looseCapture}`,
      prepare: async (page) => {
        await page.getByRole("button", { name: "Start building" }).first().waitFor();
        const sheet = await openMovePicker(page);
        await sheet.getByRole("button", { name: /Towel hook/ }).click();
        await page.getByText("Which print is it about?").waitFor();
        await page.waitForTimeout(300);
      },
      cleanup: closeDialog,
    },
    {
      // Moved: back on Ideas, the capture gone, the toast with View and Undo.
      name: "move-done",
      path: `/ideas/${looseCapture}`,
      prepare: async (page) => {
        await page.getByRole("button", { name: "Start building" }).first().waitFor();
        const sheet = await openMovePicker(page);
        await sheet.getByRole("button", { name: /Towel hook/ }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: /Attempt 1/ })
          .click();
        await page.getByText(/^Moved to attempt/).waitFor();
        await page.waitForTimeout(500);
      },
      cleanup: async (page) => {
        await page.getByRole("button", { name: "Undo" }).click();
        await page.waitForTimeout(800);
      },
    },
  ] as Shot[]),
);

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
