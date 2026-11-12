import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { SLICER_FILE_NAME, slicerFile } from "../e2e/fixtures/slicer-file.ts";
import { SEED_BUILD_IDS } from "./seed/builds.ts";
import { commentId } from "./seed/comments.ts";
import { SEED_IDS } from "./seed/ideas.ts";
import { SEED_NOW } from "./seed/index.ts";
import { SEED_SPOOL_IDS } from "./seed/pantry.ts";

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
  /** Runs after the page loads, to open a sheet or reach a state. */
  prepare?: (page: Page) => Promise<void>;
  /** Runs after every image has loaded, right before the screenshot. */
  beforeShot?: (page: Page) => Promise<void>;
  /** Runs after the screenshot, to undo what prepare changed for the next width. */
  cleanup?: (page: Page) => Promise<void>;
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

/** Opens that idea's page and waits for it. */
async function openIdea(page: Page, id: string) {
  await page.goto(`/ideas/${id}`);
  await page.locator("h1").first().waitFor({ state: "attached" });
  await page.getByRole("button", { name: "Start building" }).first().waitFor();
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
async function mockToday(
  page: Page,
  show: { builds: Slice; journal: Slice; spools: Slice; ideas: Slice; late?: boolean; offBed?: boolean },
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

async function unmockToday(page: Page) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
}

/**
 * The screens `pnpm screenshots` captures, at 390×844 and 1440×900.
 * Add your feature's screens here.
 */
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
    selector: "article:has-text('Drawer divider')",
    prepare: async (page) => {
      await page
        .getByRole("radio", { name: /suggested/ })
        .first()
        .waitFor({ timeout: 20_000 });
    },
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
      await page.getByRole("button", { name: "Scrap build" }).click();
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
    // The tugboat's attempt that is printing: the printer is at layer 140, so the rest of the file is a faint ghost.
    name: "viewer-live",
    path: `/builds/${SEED_BUILD_IDS.tugboat}`,
    prepare: async (page) => {
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
      await dialog.getByText("Printing now · layer 140 of 317").waitFor({ timeout: 30_000 });
      await dialog.locator("[data-viewer=ready]").waitFor({ timeout: 30_000 });
    },
    beforeShot: async (page) => {
      await page.waitForTimeout(400);
    },
    cleanup: closeDialog,
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
    name: "search-results",
    path: "/search?q=PETG%20warping",
    prepare: async (page) => {
      await page.getByRole("region", { name: "Attempts" }).waitFor();
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
      await sheet.getByText("Drawer bins, 42 mm grid").first().waitFor();
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
      await page.getByRole("button", { name: "Account" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Change password" }).click();
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
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("dialog", { name: "Account" }).getByRole("button", { name: "Change password" }).click();
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
  {
    name: "styleguide-pressed",
    path: "/styleguide",
    beforeShot: async (page) => {
      await page.locator("#pressed").evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(300);
    },
  },
  { name: "styleguide-builds", path: "/styleguide", selector: "#builds" },
  { name: "styleguide-spools", path: "/styleguide", selector: "#pantry" },
  { name: "styleguide-recipes", path: "/styleguide", selector: "#recipes" },
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
    name: "printer",
    path: "/printer",
    fullPage: true,
    // Upkeep loads once the page is idle: wait for its list, or the shot shows its skeleton.
    prepare: async (page) => {
      await page.getByRole("list", { name: "Upkeep tasks" }).waitFor();
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
