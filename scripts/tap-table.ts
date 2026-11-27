/**
 * pnpm tap-table: the tap-to-response table. Builds nothing: run `pnpm build` first.
 *
 * Seeds a throwaway app, serves the production build on workerd and times every interaction people make, with
 * Chromium: at 390 px with touch and the CPU throttled 4× (CDP), and at 1440 px unthrottled. For each: the time from
 * the click or key press to the next paint ("paint"), from the finger going down to the result on screen ("result"),
 * and the main thread's long tasks (over 50 ms) while it happened; p50 and p95 over --runs (default 6).
 *
 *   pnpm tap-table [--runs 6] [--only "capture,open an idea"] [--profile phone|desktop] [--json] [--md]
 */

import { readFileSync } from "node:fs";
import { chromium, type Locator, type Page } from "@playwright/test";
import { hotdogModel } from "../e2e/fixtures/model-3mf.ts";
import { fusilliStl } from "../e2e/fixtures/model-stl.ts";
import { slicerFile } from "../e2e/fixtures/slicer-file.ts";
import { launchOptions } from "./lib/browser.ts";
import { SEED_PASSWORD, SEED_USERS } from "./lib/local-app.ts";
import { installProbe, onScreen, PHONE, type TapResult, tapLatency } from "./lib/perf.ts";
import { startSeededApp } from "./lib/seeded-app.ts";
import { SEED_BUILD_IDS, SEED_PRINTER_AGENT } from "./seed/builds.ts";
import { SEED_NOW } from "./seed/index.ts";

const argv = process.argv.slice(2);
const arg = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const runs = Number(arg("--runs")) || 6;
const only = arg("--only")?.split(",");
const onlyProfile = arg("--profile");
const asJson = argv.includes("--json");
const asMd = argv.includes("--md");

type Profile = "phone" | "desktop";
interface Env {
  page: Page;
  profile: Profile;
  /** A tap on a phone, a click on a laptop. */
  press: (target: Locator) => Promise<void>;
  settle: () => Promise<void>;
  origin: string;
}
interface Scenario {
  name: string;
  /** Where it applies (default both). */
  profiles?: Profile[];
  /** One-time preparation for the profile; may return what `run` needs. */
  prepare?: (env: Env) => Promise<unknown>;
  /** One measured run; may do its own setup before measuring. */
  run: (env: Env, shared: unknown, run: number) => Promise<TapResult | TapResult[] | Record<string, TapResult>>;
}

const PARTS_BUILD = "5eed0000-0000-4000-8000-000000000109";
const dialog = (page: Page) => page.getByRole("dialog");
const heading = (title: string) =>
  `document.querySelector('h1')?.textContent === ${JSON.stringify(title)} && !document.querySelector('.sg-skeleton')`;
const ideaOpen = `location.pathname.startsWith('/ideas/') && !document.querySelector('.sg-skeleton') && !!document.querySelector('textarea, input[type=text]')`;
const buildOpen = `location.pathname.startsWith('/builds/') && !document.querySelector('.sg-skeleton') && !!document.querySelector('textarea, input[type=text]')`;
// A sheet counts as answered when it starts closing (its slide-out takes about 240 ms more).
const closed = `!document.querySelector('[role=dialog][data-state=open]')`;

async function goto(env: Env, path: string, wait: string | Locator) {
  await env.page.goto(path);
  if (typeof wait === "string") await env.page.locator(wait).first().waitFor();
  else await wait.waitFor();
  await env.page.waitForTimeout(800);
}
async function closeDialog(page: Page) {
  await page.keyboard.press("Escape");
  await page.locator("[role=dialog]").waitFor({ state: "detached" });
}
// A section with news for you is "Something new Journal" in the phone's tab bar.
const navLink = (env: Env, name: string) =>
  env.page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: new RegExp(`^(Something new )?${name}$`) });

/** An idea made through the API, so a delete never touches the seed. */
async function makeIdea(env: Env, title: string) {
  const id = crypto.randomUUID();
  const response = await env.page.request.post("/api/items", {
    headers: { Origin: env.origin },
    data: { id, title, note: "A quick sketch for the tap table" },
  });
  if (!response.ok()) throw new Error(`Could not make an idea: ${response.status()}`);
  return id;
}

/** Drops a model on a new idea and waits for its slice; returns the idea's id. */
async function ideaWithModel(env: Env, title: string, file: { name: string; mimeType: string; bytes: Uint8Array }) {
  const id = await makeIdea(env, title);
  await goto(env, `/ideas/${id}`, "textarea");
  await env.page.getByTestId("idea-file-input").setInputFiles({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.from(file.bytes),
  });
  const files = env.page.getByRole("region", { name: /^Files/ });
  await files
    .getByText(/Sliced by Spaghetti/)
    .first()
    .waitFor({ timeout: 180_000 });
  await files.locator("img").first().waitFor();
  // The slice reaches the server a moment later; the card must be settled before taps count.
  await env.page.waitForTimeout(3000);
  return id;
}

// ---- the print on the bed (made through the API for each run, deleted after it) ----

const MINUTE = 60_000;
/** Phones have no Today: the Journal's Now holds the prints on the bed. */
const bedScreen = (env: Env) => (env.profile === "phone" ? "/journal" : "/today");
const bedCard = (env: Env, title: string) => env.page.locator("article").filter({ hasText: title });

async function api(env: Env, method: "post" | "patch" | "put" | "delete", path: string, data?: object) {
  const response = await env.page.request[method](path, { headers: { Origin: env.origin }, data });
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: ${response.status()}`);
  return response;
}

/** A build with one print on the bed, started half an hour ago; `ended` takes it off the bed, still unanswered. */
async function printOnTheBed(env: Env, title: string, { ended = false } = {}) {
  const id = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await api(env, "post", "/api/items", { id, title, stage: "building" });
  await api(env, "post", `/api/items/${id}/attempts`, {
    id: attemptId,
    outcome: null,
    printedAt: Date.now() - 30 * MINUTE,
    settings: { filaments: [{ type: "PLA", brand: "Bambu", colorName: "Green" }], estimatedMinutes: 90 },
  });
  if (ended) await api(env, "patch", `/api/attempts/${attemptId}`, { endedAt: Date.now() - MINUTE });
  return id;
}

/** Opens the screen with the bed and waits for the card of `title`, in view. */
async function openBedCard(env: Env, title: string) {
  const card = bedCard(env, title);
  await goto(env, bedScreen(env), card);
  await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await env.settle();
  return card;
}

const deleteItems = async (env: Env, ids: string[]) => {
  for (const id of ids) await api(env, "delete", `/api/items/${id}`).catch(() => undefined);
};

/**
 * A token of the seed's printer agent, which then says the bridge is there (what the seed's bridge said: the towel hook
 * 34 % through), so the prints it files are matched to builds (decision 0076).
 */
async function printerToken(env: Env) {
  const response = await api(env, "post", `/api/agents/${SEED_PRINTER_AGENT}/tokens`, {
    scopes: ["read", "attempts", "printer"],
  });
  const token = (await response.json()).token as string;
  const told = await env.page.request.put("/api/printer/bridge", {
    headers: { Origin: env.origin, Authorization: `Bearer ${token}` },
    data: {
      printerState: "printing",
      progress: {
        attemptId: SEED_BUILD_IDS.towelHookAttempt,
        percent: 34,
        remainingMinutes: 30,
        layer: 70,
        totalLayers: 205,
      },
      unknownTrays: [],
    },
  });
  if (!told.ok()) throw new Error(`The bridge could not say it is there: ${told.status()}`);
  return token;
}

/** A build keeping a slicer file, started half an hour ago (or `startedAgo` ms): the likely home of a print of that file. */
async function buildKeeping(env: Env, title: string, fileName: string, startedAgo = 30 * MINUTE) {
  const id = crypto.randomUUID();
  await api(env, "post", "/api/items", { id, title, stage: "building", createdAt: Date.now() - startedAgo });
  const bytes = slicerFile();
  const kept = await env.page.request.put(`/api/items/${id}/files/${crypto.randomUUID()}`, {
    headers: { Origin: env.origin },
    multipart: {
      name: fileName,
      size: String(bytes.length),
      plate: "1",
      plateCount: "1",
      prefill: "{}",
      file: { name: fileName, mimeType: "application/octet-stream", buffer: Buffer.from(bytes) },
    },
  });
  if (!kept.ok()) throw new Error(`Could not keep a slicer file: ${kept.status()}`);
  return id;
}

/** What the bridge does when a print starts: a build of its own, then the attempt with what the printer said. */
async function bridgePrint(env: Env, token: string, name: string) {
  const headers = { Origin: env.origin, Authorization: `Bearer ${token}` };
  const ownId = crypto.randomUUID();
  const made = await env.page.request.post("/api/items", {
    headers,
    data: { id: ownId, title: name, stage: "building" },
  });
  if (!made.ok()) throw new Error(`The bridge could not make a build: ${made.status()}`);
  const filed = await env.page.request.post(`/api/items/${ownId}/attempts`, {
    headers,
    data: {
      id: crypto.randomUUID(),
      printedAt: Date.now() - 5 * MINUTE,
      print: { name, gcodeFile: "Metadata/plate_1.gcode", plate: 1, estimateMinutes: 40 },
    },
  });
  if (!filed.ok()) throw new Error(`The bridge could not file a print: ${filed.status()}`);
  return ownId;
}

const jade = () => ({
  name: "label-jade.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(new URL("../e2e/fixtures/label-jade.jpg", import.meta.url)),
});
const tugboat = () => ({
  name: "tugboat.jpg",
  mimeType: "image/jpeg",
  buffer: readFileSync(new URL("../e2e/fixtures/tugboat.jpg", import.meta.url)),
});

/**
 * Picking a photo has no tap the page sees (the camera or the picker is the system's): the time runs from the input's
 * change event, set as the probe's start before `tapLatency` gives the files.
 */
async function fromChange(env: Env, input: Locator, files: ReturnType<typeof tugboat>, done: string) {
  return tapLatency(
    env.page,
    async () => {
      await env.page.evaluate(() =>
        document.addEventListener("change", (event) => (window.__perf.t0 = event.timeStamp), {
          capture: true,
          once: true,
        }),
      );
      await input.setInputFiles(files);
    },
    done,
  );
}

const dialogNamed = (name: string) =>
  `[...document.querySelectorAll('[role=dialog][data-state=open], [role=dialog]:not([data-state])')].some((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (d.getAttribute('aria-label') ?? document.getElementById(d.getAttribute('aria-labelledby') ?? '')?.textContent ?? '').startsWith(${JSON.stringify(name)}); })`;
const pickedInSheet = (name: string) =>
  `[...document.querySelectorAll('[role=dialog] [role=radio][aria-checked=true]')].some((r) => r.textContent?.includes(${JSON.stringify(name)}) && r.getBoundingClientRect().height > 0)`;

const scenarios: Scenario[] = [
  {
    name: "capture button → sheet",
    run: async (env) => {
      await goto(env, "/ideas", 'main a[href^="/ideas/"]');
      const button = env.page.getByRole("button", { name: "New idea" }).first();
      const tap = await tapLatency(env.page, () => env.press(button), onScreen("[role=dialog]"));
      await closeDialog(env.page);
      return tap;
    },
  },
  {
    name: "C → capture sheet",
    run: async (env) => {
      await goto(env, "/ideas", 'main a[href^="/ideas/"]');
      const tap = await tapLatency(env.page, () => env.page.keyboard.press("c"), onScreen("[role=dialog]"));
      await closeDialog(env.page);
      return tap;
    },
  },
  {
    name: "capture: type a letter, then save a note",
    run: async (env, _s, run) => {
      await goto(env, "/ideas", 'main a[href^="/ideas/"]');
      await env.press(env.page.getByRole("button", { name: "New idea" }).first());
      const note = dialog(env.page).getByRole("textbox", { name: "Note" });
      await note.waitFor();
      await env.settle();
      await note.click();
      await env.settle();
      const typed = await tapLatency(
        env.page,
        () => env.page.keyboard.press("t"),
        `document.querySelector('[role=dialog] textarea')?.value === 't'`,
      );
      await env.page.keyboard.type(`ap ${run}`);
      await env.settle();
      const save = await tapLatency(
        env.page,
        () => env.press(dialog(env.page).getByRole("button", { name: "Save idea" })),
        closed,
      );
      await env.page.locator("[role=dialog]").waitFor({ state: "detached" });
      return { "capture: type a letter": typed, "capture: Save idea": save };
    },
  },
  {
    name: "open an idea",
    run: async (env) => {
      await goto(env, "/ideas", 'main a[href^="/ideas/"]');
      return tapLatency(env.page, () => env.press(env.page.locator('main a[href^="/ideas/"]').nth(2)), ideaOpen);
    },
  },
  {
    name: "open a build",
    run: async (env) => {
      await goto(env, "/builds", 'main a[href^="/builds/"]');
      return tapLatency(env.page, () => env.press(env.page.locator('main a[href^="/builds/"]').first()), buildOpen);
    },
  },
  {
    name: "start an attempt, log it",
    run: async (env) => {
      await goto(
        env,
        `/builds/${PARTS_BUILD}`,
        env.page.getByRole("button", { name: /^Log (attempt|another try)$/ }).first(),
      );
      const sheet = dialog(env.page);
      const start = await tapLatency(
        env.page,
        () => env.press(env.page.getByRole("button", { name: /^Log (attempt|another try)$/ }).first()),
        onScreen("[role=dialog] [role=radio]"),
      );
      await env.settle();
      const pick = await tapLatency(
        env.page,
        () => env.press(sheet.getByRole("radio", { name: "Worked" })),
        `document.querySelector('[role=dialog] [role=radio][aria-checked=true]')?.textContent?.includes('Worked')`,
      );
      await env.settle();
      const log = await tapLatency(
        env.page,
        () => env.press(sheet.getByRole("button", { name: /^(Log|Finish) attempt$/ }).first()),
        closed,
      );
      await env.page.locator("[role=dialog]").waitFor({ state: "detached" });
      return { "attempt: open the sheet": start, "attempt: pick an outcome": pick, "attempt: log it": log };
    },
  },
  {
    name: "nav: tab bar / sidebar",
    run: async (env) => {
      await goto(env, "/journal", "h1");
      const out: Record<string, TapResult> = {};
      for (const [from, to] of [
        ["Journal", "Ideas"],
        ["Ideas", "Builds"],
        ["Builds", "Journal"],
      ] as const) {
        await env.settle();
        out[`nav tap: ${from} → ${to}`] = await tapLatency(env.page, () => env.press(navLink(env, to)), heading(to));
      }
      return out;
    },
  },
  {
    name: "nav: G then a letter",
    run: async (env) => {
      await goto(env, "/journal", "h1");
      const out: Record<string, TapResult> = {};
      for (const [key, to] of [
        ["i", "Ideas"],
        ["b", "Builds"],
        ["j", "Journal"],
      ] as const) {
        await env.settle();
        await env.page.keyboard.press("g");
        out[`nav key: G ${key.toUpperCase()} → ${to}`] = await tapLatency(
          env.page,
          () => env.page.keyboard.press(key),
          heading(to),
        );
      }
      return out;
    },
  },
  {
    name: "command palette",
    profiles: ["desktop"],
    run: async (env) => {
      await goto(env, "/today", "h1");
      // The palette's code arrives once the app is idle.
      await env.page.waitForTimeout(1500);
      const open = await tapLatency(
        env.page,
        () => env.page.keyboard.press("Control+k"),
        onScreen("[role=dialog] [role=combobox]"),
      );
      await env.settle();
      const type = await tapLatency(
        env.page,
        () => env.page.keyboard.press("t"),
        `document.querySelector('[role=dialog] [role=combobox]')?.value === 't'`,
      );
      await env.page.keyboard.type("ug");
      await env.settle();
      const more = await tapLatency(
        env.page,
        () => env.page.keyboard.press("b"),
        `document.querySelector('[role=dialog] [role=combobox]')?.value === 'tugb'`,
      );
      await closeDialog(env.page);
      return { "palette: Ctrl+K": open, "palette: type a letter": type, "palette: fourth letter": more };
    },
  },
  {
    name: "search: type",
    run: async (env) => {
      await goto(env, "/search", "#search-box");
      const box = env.page.locator("#search-box");
      await box.click();
      await box.fill("");
      await env.settle();
      const out: Record<string, TapResult> = {};
      let typed = "";
      for (const key of "tugb") {
        typed += key;
        out[`search: letter ${typed.length}`] = await tapLatency(
          env.page,
          () => env.page.keyboard.press(key),
          `document.getElementById('search-box')?.value.length === ${typed.length}`,
        );
      }
      out["search: results marked"] = await tapLatency(
        env.page,
        () => env.page.keyboard.press("o"),
        `!!document.querySelector('main mark')`,
      );
      return out;
    },
  },
  {
    name: "open a photo",
    run: async (env) => {
      await goto(env, "/ideas", 'main a[href^="/ideas/"] img');
      const out: Record<string, TapResult> = {};
      out["photo: open an idea by its picture"] = await tapLatency(
        env.page,
        () => env.press(env.page.locator('main a[href^="/ideas/"] img').first()),
        ideaOpen,
      );
      const next = env.page.getByRole("button", { name: /^Next photo/ });
      if (await next.count()) {
        await env.settle();
        out["photo: next"] = await tapLatency(env.page, () => env.press(next), `true`);
      }
      const second = env.page.getByRole("button", { name: /^Photo 2/ });
      if (await second.count()) {
        await env.settle();
        out["photo: thumbnail"] = await tapLatency(
          env.page,
          () => env.press(second),
          `document.querySelector('[aria-label^="Photo 2"]')?.getAttribute('aria-current') === 'true'`,
        );
      }
      return out;
    },
  },
  {
    name: "tick a checklist item",
    run: async (env) => {
      await goto(env, "/shopping", env.page.getByRole("checkbox").first());
      const box = env.page.getByRole("checkbox").first();
      const state = (await box.getAttribute("aria-checked")) === "true";
      const tick = await tapLatency(
        env.page,
        () => env.press(box),
        `document.querySelector('[role=checkbox]')?.getAttribute('aria-checked') === '${!state}'`,
      );
      // Put it back, so the next run starts the same.
      await env.settle();
      await box.click();
      return tick;
    },
  },
  {
    name: "open a spool",
    run: async (env) => {
      await goto(env, "/pantry", 'main a[href^="/pantry/"]');
      return tapLatency(
        env.page,
        () => env.press(env.page.locator('main a[href^="/pantry/"]').first()),
        `location.pathname.startsWith('/pantry/') && !document.querySelector('.sg-skeleton') && document.querySelectorAll('main h1').length > 0`,
      );
    },
  },
  {
    name: "delete an idea, undo",
    run: async (env, _s, run) => {
      const id = await makeIdea(env, `Tap table ${run}`);
      await goto(env, `/ideas/${id}`, "textarea");
      await env.press(env.page.getByRole("button", { name: /^Delete idea/ }));
      const confirm = env.page.getByRole("button", { name: "Delete", exact: true });
      await confirm.waitFor();
      await env.settle();
      const del = await tapLatency(
        env.page,
        () => env.press(confirm),
        `!!document.querySelector('[data-sonner-toast]') && location.pathname === '/ideas'`,
      );
      const undo = env.page.getByRole("button", { name: "Undo" });
      await undo.waitFor();
      await env.settle();
      const back = await tapLatency(
        env.page,
        () => env.press(undo),
        `!!document.querySelector('main a[href="/ideas/${id}"]')`,
      );
      return { "delete: confirm → toast": del, "delete: Undo": back };
    },
  },
  {
    name: "Slice with…",
    prepare: async (env) => {
      const id = await ideaWithModel(env, "Tap table knob", {
        name: "fusilli-knob.stl",
        mimeType: "model/stl",
        bytes: fusilliStl(),
      });
      return id;
    },
    run: async (env, id) => {
      await goto(env, `/ideas/${id}`, env.page.getByRole("region", { name: /^Files/ }));
      const files = env.page.getByRole("region", { name: /^Files/ });
      await files.evaluate((region) => region.scrollIntoView({ block: "center" }));
      await env.settle();
      const tap = await tapLatency(
        env.page,
        () => env.press(files.getByRole("button", { name: "Slice with…" })),
        onScreen("[role=dialog] [role=group]"),
      );
      await env.settle();
      await closeDialog(env.page);
      return tap;
    },
  },
  {
    name: "J / K on a list",
    profiles: ["desktop"],
    run: async (env) => {
      const out: Record<string, TapResult> = {};
      for (const [path, label] of [["/builds", "builds"]] as const) {
        await goto(env, path, "main [data-picks] a[href]");
        await env.page.locator("body").click({ position: { x: 5, y: 5 } });
        // Done when focus sits on a list link other than the one it was on before the key.
        const moved = async () => {
          const before = await env.page.evaluate(() => document.activeElement?.getAttribute("href") ?? "");
          return `(() => { const el = document.activeElement; return !!el?.closest('main [data-picks]') && (el.getAttribute('href') ?? '') !== ${JSON.stringify(before)}; })()`;
        };
        out[`${label}: J (first)`] = await tapLatency(env.page, () => env.page.keyboard.press("j"), await moved());
        await env.settle();
        out[`${label}: J (next)`] = await tapLatency(env.page, () => env.page.keyboard.press("j"), await moved());
        await env.settle();
        out[`${label}: K`] = await tapLatency(env.page, () => env.page.keyboard.press("k"), await moved());
      }
      return out;
    },
  },
  {
    name: "3D view sheet",
    prepare: async (env) =>
      ideaWithModel(env, "Tap table 3D", { name: "fusilli-knob.stl", mimeType: "model/stl", bytes: fusilliStl() }),
    run: async (env, id) => {
      await goto(env, `/ideas/${id}`, env.page.getByRole("region", { name: /^Files/ }));
      const button = env.page.getByRole("button", { name: /in 3D$/ }).first();
      await button.evaluate((b) => b.scrollIntoView({ block: "center" }));
      await env.settle();
      const tap = await tapLatency(env.page, () => env.press(button), onScreen("[role=dialog]"));
      await env.page.waitForTimeout(1500);
      await closeDialog(env.page);
      return tap;
    },
  },
  {
    name: "open a colour row",
    prepare: async (env) =>
      ideaWithModel(env, "Tap table hotdog", { name: "hotdog-hero.3mf", mimeType: "model/3mf", bytes: hotdogModel() }),
    run: async (env, id) => {
      await goto(env, `/ideas/${id}`, env.page.getByRole("region", { name: /^Files/ }));
      const files = env.page.getByRole("region", { name: /^Files/ });
      await files.evaluate((region) => region.scrollIntoView({ block: "center" }));
      await env.settle();
      await env.press(files.getByRole("button", { name: "Slice with…" }));
      const settings = env.page.getByRole("dialog", { name: "How to slice it" });
      await settings.getByRole("group", { name: "Quality" }).waitFor();
      await env.page.waitForTimeout(800);
      const summary = settings.getByRole("button", { name: /^Colours/ });
      await summary.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
      await env.settle();
      const colours = await tapLatency(
        env.page,
        () => env.press(summary),
        `!!document.querySelector('[role=dialog] li button[aria-expanded]')`,
      );
      await env.settle();
      const row = settings.locator("li button[aria-expanded]").first();
      await row.evaluate((button) => button.scrollIntoView({ block: "center", behavior: "instant" }));
      await env.settle();
      const open = await tapLatency(
        env.page,
        () => env.press(row),
        `document.querySelector('[role=dialog] li button[aria-expanded=true]') !== null`,
      );
      await closeDialog(env.page);
      return { "colours: open the block": colours, "colours: open a row": open };
    },
  },
  // ---- added Nov 27: the taps of every day that came after the table (answering prints, Which build?, …) ----
  {
    name: "answer a print off the bed",
    run: async (env, _s, run) => {
      const title = `Tap answer ${env.profile} ${run}`;
      const id = await printOnTheBed(env, title, { ended: true });
      try {
        const card = await openBedCard(env, title);
        const sheet = dialog(env.page);
        const open = await tapLatency(
          env.page,
          () => env.press(card.getByRole("radio", { name: "Partly" })),
          pickedInSheet("Partly"),
        );
        await env.page.waitForTimeout(800);
        const pick = await tapLatency(
          env.page,
          () => env.press(sheet.getByRole("radio", { name: "Spaghetti" })),
          pickedInSheet("Spaghetti"),
        );
        await env.settle();
        const finish = await tapLatency(
          env.page,
          () => env.press(sheet.getByRole("button", { name: /^(Finish attempt|Done)$/ })),
          closed,
        );
        await env.page.locator("[role=dialog]").waitFor({ state: "detached" });
        return {
          "answer: Partly on the card → sheet": open,
          "answer: pick Spaghetti in the sheet": pick,
          "answer: Finish attempt": finish,
        };
      } finally {
        await deleteItems(env, [id]);
      }
    },
  },
  {
    name: "printing card: How did it go?",
    run: async (env, _s, run) => {
      const title = `Tap printing ${env.profile} ${run}`;
      const id = await printOnTheBed(env, title);
      try {
        const card = await openBedCard(env, title);
        const tap = await tapLatency(
          env.page,
          () => env.press(card.getByRole("button", { name: "How did it go?" })),
          onScreen("[role=dialog] [role=radio]"),
        );
        await env.page.waitForTimeout(800);
        await closeDialog(env.page);
        return tap;
      } finally {
        await deleteItems(env, [id]);
      }
    },
  },
  {
    name: "Snap this print",
    run: async (env, _s, run) => {
      const out: Record<string, TapResult> = {};
      const printing = `Tap snap ${env.profile} ${run}`;
      const waiting = `Tap snap off ${env.profile} ${run}`;
      const ids = [await printOnTheBed(env, printing), await printOnTheBed(env, waiting, { ended: true })];
      try {
        const card = await openBedCard(env, printing);
        if (env.profile === "desktop") {
          // No camera at the desk: the button opens the capture sheet aimed at the print.
          out["snap: camera button → sheet (desktop)"] = await tapLatency(
            env.page,
            () => env.press(card.getByRole("button", { name: "Snap this print" })),
            dialogNamed("Add to the print"),
          );
        } else {
          // The phone's camera opens at once; the photo it takes lands in the sheet aimed at the print.
          out["snap: photo taken → sheet with it"] = await fromChange(
            env,
            card.getByTestId("snap-camera-input"),
            tugboat(),
            `${dialogNamed("Add to the print")} && !!document.querySelector('[role=dialog] img')`,
          );
          await env.page.waitForTimeout(800);
          await closeDialog(env.page);
          // A print waiting for its answer takes the photo straight onto its card.
          const off = await openBedCard(env, waiting);
          const before = await off.locator("img").count();
          out["snap: photo taken → on the waiting print's card"] = await fromChange(
            env,
            off.getByTestId("snap-camera-input"),
            tugboat(),
            `[...document.querySelectorAll('article')].some((a) => a.textContent?.includes(${JSON.stringify(waiting)}) && a.querySelectorAll('img').length > ${before})`,
          );
        }
        await env.page.waitForTimeout(800);
        if (await env.page.locator("[role=dialog]").count()) await closeDialog(env.page);
        return out;
      } finally {
        await deleteItems(env, ids);
      }
    },
  },
  {
    name: "Which build?",
    prepare: printerToken,
    run: async (env, token, run) => {
      const ids: string[] = [];
      try {
        // Two prints the printer filed, each likely in a build that keeps its file but also like another build by its
        // name, so the app asks (as in e2e/print-place.spec.ts): one for Yes, one for Another build. Letters, not
        // numbers, tell the runs apart: the matcher drops numbers from names.
        const tag = `${env.profile === "phone" ? "p" : "d"}${"abcdefghijklmnopqrstuvwxyz"[run % 26]}`;
        for (const which of ["yes", "other"]) {
          ids.push(
            await buildKeeping(env, `Tap ${which} ${env.profile} ${run}`, `planter-${which}${tag}-v2.gcode.3mf`),
          );
          ids.push(
            await buildKeeping(
              env,
              `Planter ${which}${tag} v2`,
              `balcony-${which}${tag}.gcode.3mf`,
              3 * 24 * 60 * MINUTE,
            ),
          );
          ids.push(await bridgePrint(env, token as string, `planter-${which}${tag}-v2(2)`));
        }
        const yesRegion = `Is this Tap yes ${env.profile} ${run}?`;
        const otherRegion = `Is this Tap other ${env.profile} ${run}?`;
        const question = env.page.getByRole("region", { name: yesRegion });
        await goto(env, bedScreen(env), question);
        await question.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await env.settle();
        const yes = await tapLatency(
          env.page,
          () => env.press(question.getByRole("button", { name: "Yes" })),
          `!document.querySelector(${JSON.stringify(`[aria-label="${yesRegion}"]`)}) && ![...document.querySelectorAll('section, [role=region]')].some((r) => r.getAttribute('aria-label') === ${JSON.stringify(yesRegion)})`,
        );
        await env.page.waitForTimeout(800);
        const other = env.page.getByRole("region", { name: otherRegion });
        await other.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await env.settle();
        const another = await tapLatency(
          env.page,
          () => env.press(other.getByRole("button", { name: "Another build" })),
          `${dialogNamed("Which build is this?")} && !!document.querySelector('[role=dialog] input[type=search]')`,
        );
        await env.page.waitForTimeout(800);
        const sheet = env.page.getByRole("dialog", { name: "Which build is this?" });
        const target = sheet.getByRole("button", { name: /^Drawer divider/ }).first();
        await target.scrollIntoViewIfNeeded();
        await env.settle();
        const pick = await tapLatency(env.page, () => env.press(target), closed);
        await env.page.locator("[role=dialog]").waitFor({ state: "detached" });
        return {
          "which build: Yes": yes,
          "which build: Another build → sheet": another,
          "which build: pick a build in the sheet": pick,
        };
      } finally {
        await deleteItems(env, ids);
      }
    },
  },
  {
    name: "label read",
    run: async (env) => {
      const before = new Set(
        ((await (await env.page.request.get("/api/spools")).json()).spools as { id: string }[]).map((s) => s.id),
      );
      try {
        await goto(env, "/pantry", env.page.getByRole("button", { name: /^Add (a )?spool$/ }).first());
        const add = await tapLatency(
          env.page,
          () => env.press(env.page.getByRole("button", { name: /^Add (a )?spool$/ }).first()),
          dialogNamed("New spool"),
        );
        await env.page.waitForTimeout(800);
        const sheet = env.page.getByRole("dialog", { name: "New spool" });
        await sheet.getByTestId("spool-photo-input").setInputFiles(jade());
        const card = env.page.getByRole("region", { name: "What Claude read" });
        await card.getByText(/Nozzle 190/).waitFor({ timeout: 30_000 });
        await card.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await env.settle();
        const right = await tapLatency(
          env.page,
          () => env.press(card.getByRole("button", { name: "Looks right" })),
          `![...document.querySelectorAll('[role=region]')].some((r) => r.getAttribute('aria-label') === 'What Claude read')`,
        );
        await env.settle();
        if (await env.page.locator("[role=dialog]").count()) await closeDialog(env.page);
        return { "label: Add a spool → sheet": add, "label: Looks right": right };
      } finally {
        const { spools } = await (await env.page.request.get("/api/spools")).json();
        for (const spool of spools as { id: string }[])
          if (!before.has(spool.id)) await api(env, "delete", `/api/spools/${spool.id}`).catch(() => undefined);
      }
    },
  },
  {
    name: "Journal filters",
    run: async (env) => {
      await goto(env, "/journal", env.page.getByRole("button", { name: "Only failures" }).first());
      const chip = env.page.getByRole("button", { name: "Only failures" }).first();
      await chip.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await env.settle();
      // Answered once the list is the filter's: no skeleton, and no longer the list before it, dimmed while it waits
      // (what the entries say depends on the scenarios run before, so the count tells the lists apart).
      const settled = `!document.querySelector('main .sg-skeleton') && !document.querySelector('main .transition-opacity.opacity-60')`;
      const count = `document.querySelectorAll('main li a').length`;
      const all = await env.page.evaluate(count);
      const on = await tapLatency(
        env.page,
        () => env.press(chip),
        `location.search.includes('outcome=failures') && ${settled} && ${count} > 0 && ${count} !== ${all}`,
      );
      await env.page.waitForTimeout(800);
      await chip.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await env.settle();
      const off = await tapLatency(
        env.page,
        () => env.press(chip),
        `!location.search.includes('outcome') && ${settled} && ${count} === ${all}`,
      );
      return { "journal: Only failures": on, "journal: filter off": off };
    },
  },
  {
    name: "palette: search results",
    profiles: ["desktop"],
    run: async (env) => {
      await goto(env, "/today", "h1");
      await env.page.waitForTimeout(1500);
      await env.page.keyboard.press("Control+k");
      await env.page.locator("[role=dialog] [role=combobox]").waitFor();
      await env.settle();
      await env.page.keyboard.type("tugb");
      await env.page.locator("[role=dialog] [role=option]", { hasText: "tugboat" }).first().waitFor();
      await env.settle();
      // Results for the word as typed: none still pending, the tugboat among them.
      const results = await tapLatency(
        env.page,
        () => env.page.keyboard.press("o"),
        `document.querySelector('[role=dialog] [role=combobox]')?.value === 'tugbo' && !document.querySelector('[role=dialog] [aria-busy]') && [...document.querySelectorAll('[role=dialog] [role=option]')].some((o) => /tugboat/i.test(o.textContent ?? ''))`,
      );
      await env.settle();
      const enter = await tapLatency(env.page, () => env.page.keyboard.press("Enter"), buildOpen);
      return { "palette: results for a word": results, "palette: Enter opens the first": enter };
    },
  },
  {
    name: "open an AMS slot",
    run: async (env) => {
      const slot = env.page.getByRole("button", { name: /^A1 / }).first();
      await goto(env, "/pantry", slot);
      await env.settle();
      const tap = await tapLatency(
        env.page,
        () => env.press(slot),
        `!!document.querySelector('[role=dialog][data-state=open]') && document.querySelector('[role=dialog]').getBoundingClientRect().height > 0`,
      );
      await env.page.waitForTimeout(800);
      await closeDialog(env.page);
      return { "pantry: open an AMS slot": tap };
    },
  },
];

// ---- run ----
const port = 5600 + Math.floor(Math.random() * 100);
const app = await startSeededApp({ port, built: true, now: SEED_NOW, log: (m) => console.error(`  ${m}`) });
const browser = await chromium.launch(launchOptions());

const percentile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
};

interface Row {
  profile: Profile;
  name: string;
  paint: number[];
  shown: number[];
  longTasks: number[];
  longMs: number[];
}
const rows = new Map<string, Row>();

try {
  for (const profile of ["phone", "desktop"] as const) {
    if (onlyProfile && onlyProfile !== profile) continue;
    const context = await browser.newContext({
      ...(profile === "phone" ? PHONE : { viewport: { width: 1440, height: 900 } }),
      baseURL: app.url,
      serviceWorkers: "allow",
    });
    const response = await context.request.post("/api/session", {
      data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
      headers: { Origin: app.url },
    });
    if (!response.ok()) throw new Error(`Signing in failed: ${response.status()}`);
    await installProbe(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`  page error: ${error.message}`));
    await page.goto(profile === "phone" ? "/journal" : "/today");
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    const env: Env = {
      page,
      profile,
      origin: app.url,
      press: (target) => (profile === "phone" ? target.tap() : target.click()),
      settle: () => page.waitForTimeout(400),
    };
    const todo = scenarios.filter(
      (s) => (!s.profiles || s.profiles.includes(profile)) && (!only || only.some((o) => s.name.includes(o))),
    );
    // Preparation (a model dropped and sliced) runs before the throttle, then every scenario runs throttled.
    const shared = new Map<Scenario, unknown>();
    for (const scenario of todo) {
      if (!scenario.prepare) continue;
      try {
        console.error(`  [${profile}] preparing ${scenario.name}…`);
        shared.set(scenario, await scenario.prepare(env));
      } catch (error) {
        console.error(`  [${profile}] could not prepare ${scenario.name}: ${(error as Error).message.split("\n")[0]}`);
      }
    }
    if (profile === "phone") {
      const client = await context.newCDPSession(page);
      await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    }
    for (const scenario of todo) {
      if (scenario.prepare && !shared.has(scenario)) continue;
      console.error(`  [${profile}] ${scenario.name}`);
      for (let run = 0; run < runs; run++) {
        try {
          const result = await scenario.run(env, shared.get(scenario), run);
          const named: Record<string, TapResult> =
            "inp" in result && "shown" in result
              ? { [scenario.name]: result as TapResult }
              : (result as Record<string, TapResult>);
          // A result that never showed (tapLatency says -1) is a failed run, not a fast one.
          const missing = Object.entries(named).find(([, tap]) => tap.shown < 0);
          if (missing) throw new Error(`"${missing[0]}": the result never showed`);
          for (const [name, tap] of Object.entries(named)) {
            const key = `${profile}|${name}`;
            const row = rows.get(key) ?? { profile, name, paint: [], shown: [], longTasks: [], longMs: [] };
            rows.set(key, row);
            row.paint.push(tap.paint);
            row.shown.push(tap.shown);
            row.longTasks.push(tap.longTasks);
            row.longMs.push(tap.longMs);
          }
        } catch (error) {
          console.error(`    run ${run} failed: ${(error as Error).message.split("\n")[0]}`);
          await page.keyboard.press("Escape").catch(() => undefined);
        }
      }
    }
    await context.close();
  }

  const names = [...new Set([...rows.values()].map((r) => r.name))];
  const cell = (row: Row | undefined) =>
    row
      ? {
          paint50: Math.round(percentile(row.paint, 0.5)),
          paint95: Math.round(percentile(row.paint, 0.95)),
          shown50: Math.round(percentile(row.shown, 0.5)),
          shown95: Math.round(percentile(row.shown, 0.95)),
          long: `${Math.round(percentile(row.longTasks, 0.5))}/${Math.round(percentile(row.longMs, 0.5))}ms`,
          n: row.paint.length,
        }
      : undefined;
  const table = names.map((name) => ({
    name,
    phone: cell(rows.get(`phone|${name}`)),
    desktop: cell(rows.get(`desktop|${name}`)),
  }));
  if (asJson) console.log(JSON.stringify(table, null, 2));
  else if (asMd) {
    const f = (c: ReturnType<typeof cell>) =>
      c ? `${c.paint50} / ${c.paint95} | ${c.shown50} / ${c.shown95} | ${c.long}` : "– | – | –";
    console.log(
      "| interaction | 390 px 4× CPU: paint p50 / p95 | result p50 / p95 | long tasks (n/ms) | 1440 px: paint p50 / p95 | result p50 / p95 | long tasks |",
    );
    console.log("|---|---|---|---|---|---|---|");
    for (const row of table) console.log(`| ${row.name} | ${f(row.phone)} | ${f(row.desktop)} |`);
  } else {
    for (const row of table) {
      const f = (c: ReturnType<typeof cell>) =>
        c ? `paint ${c.paint50}/${c.paint95}  result ${c.shown50}/${c.shown95}  long ${c.long}` : "-";
      console.log(`${row.name}\n   phone   ${f(row.phone)}\n   desktop ${f(row.desktop)}`);
    }
  }
} finally {
  await browser.close();
  app.stop();
}
