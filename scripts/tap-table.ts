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
import { chromium, type Locator, type Page } from "@playwright/test";
import { boxStl, fusilliStl } from "../e2e/fixtures/model-stl.ts";
import { hotdogModel } from "../e2e/fixtures/model-3mf.ts";
import { launchOptions } from "./lib/browser.ts";
import { SEED_PASSWORD, SEED_USERS } from "./lib/local-app.ts";
import { installProbe, onScreen, PHONE, type TapResult, tapLatency } from "./lib/perf.ts";
import { startSeededApp } from "./lib/seeded-app.ts";
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
const closed = `!document.querySelector('[role=dialog]')`;

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
const navLink = (env: Env, name: string) =>
  env.page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name, exact: true });

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
  await files.getByText(/Sliced by Spaghetti/).first().waitFor({ timeout: 180_000 });
  await files.locator("img").first().waitFor();
  // The slice reaches the server a moment later; the card must be settled before taps count.
  await env.page.waitForTimeout(3000);
  return id;
}

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
      await goto(env, `/builds/${PARTS_BUILD}`, env.page.getByRole("button", { name: "Log attempt" }).first());
      const sheet = dialog(env.page);
      const start = await tapLatency(
        env.page,
        () => env.press(env.page.getByRole("button", { name: "Log attempt" }).first()),
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
        `!!document.querySelector('main a[href="/ideas/${id}"]') || location.pathname.startsWith('/ideas')`,
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
