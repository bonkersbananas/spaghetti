/**
 * pnpm perf: how fast Spaghetti feels on a mid-range phone. Builds nothing: run `pnpm build` first.
 *
 * Seeds a throwaway app (the screenshot data), serves the production build on workerd and, at 390 px with touch,
 * 4× CPU throttling and slow 4G, measures
 *   - cold start of Today and Ideas (first screen = the heading, useful = heading with its content and no
 *     skeletons) on a first visit, with the service worker's cache but nothing saved, and as the installed app
 *     resumed (service worker and saved data);
 *   - the taps people make most: input to next paint (what INP measures) and tap to result on screen;
 *   - the desktop's command palette, J, `/`, delete and Undo, at 4× CPU, at 1440 px.
 *
 *   pnpm perf [--runs 5] [--json]
 */
import { chromium, type Page } from "@playwright/test";
import { launchOptions } from "./lib/browser.ts";
import { SEED_PASSWORD, SEED_USERS } from "./lib/local-app.ts";
import { installProbe, median, onScreen, PHONE, tapLatency, throttle } from "./lib/perf.ts";
import { startSeededApp } from "./lib/seeded-app.ts";
import { SEED_NOW } from "./seed/index.ts";

const argv = process.argv.slice(2);
const runs = Number(argv[argv.indexOf("--runs") + 1]) || 5;
const asJson = argv.includes("--json");

const PARTS_BUILD = "5eed0000-0000-4000-8000-000000000109";

const READY = {
  "/today": `document.querySelector('h1')?.textContent === 'Today' && !document.querySelector('.sg-skeleton') && document.querySelectorAll('main a').length > 2`,
  "/ideas": `document.querySelector('h1')?.textContent === 'Ideas' && !document.querySelector('.sg-skeleton') && !!document.querySelector('main a[href^="/ideas/"]')`,
} as const;

const results: Record<string, Record<string, number>> = {};
const record = (group: string, name: string, values: number[]) => {
  const group_ = results[group] ?? {};
  results[group] = group_;
  group_[name] = Math.round(median(values));
};

const port = 5400 + Math.floor(Math.random() * 100);
const app = await startSeededApp({ port, built: true, now: SEED_NOW, log: (m) => console.error(`  ${m}`) });
const browser = await chromium.launch(launchOptions());

async function signedIn(context: Awaited<ReturnType<typeof browser.newContext>>) {
  const response = await context.request.post("/api/session", {
    data: { username: SEED_USERS[0].username, password: SEED_PASSWORD },
    headers: { Origin: app.url },
  });
  if (!response.ok()) throw new Error(`Signing in failed: ${response.status()}`);
}

try {
  // ---- Cold start ----
  for (const path of ["/today", "/ideas"] as const) {
    const firstScreen: number[] = [];
    const useful: number[] = [];
    const fcp: number[] = [];
    const scenario = async (
      name: string,
      prepare: (page: Page) => Promise<void>,
      serviceWorkers: "allow" | "block",
    ) => {
      firstScreen.length = useful.length = fcp.length = 0;
      const context = await browser.newContext({ ...PHONE, baseURL: app.url, serviceWorkers });
      await signedIn(context);
      await installProbe(context, READY[path]);
      for (let run = 0; run < runs; run++) {
        const setup = await context.newPage();
        await prepare(setup);
        await setup.close();
        const page = await context.newPage();
        await throttle(page);
        await page.goto(path, { waitUntil: "commit" });
        await page.waitForFunction(() => window.__perf.ready >= 0, undefined, { timeout: 60_000 });
        await page.waitForFunction(() => performance.getEntriesByName("first-contentful-paint").length > 0, undefined, {
          timeout: 10_000,
        });
        const timing = await page.evaluate(() => ({
          ready: window.__perf.ready,
          firstScreen: window.__perf.firstScreen,
          fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1,
        }));
        firstScreen.push(timing.firstScreen);
        useful.push(timing.ready);
        fcp.push(timing.fcp);
        await page.close();
        if (serviceWorkers === "block") {
          // A first visit every time: nothing from the last one.
          await context.clearCookies();
          await signedIn(context);
        }
      }
      record(`cold start ${path}`, `${name}: first paint`, fcp);
      record(`cold start ${path}`, `${name}: heading`, firstScreen);
      record(`cold start ${path}`, `${name}: useful`, useful);
      await context.close();
    };
    // A first visit: no service worker, and (a new context each time would be slower to seed) no HTTP cache beyond the run.
    await scenario("first visit, no cache", async () => {}, "block");
    // The service worker has the app but nothing is saved: the first launch after installing.
    const installed = async (page: Page, keepData: boolean) => {
      await page.goto("/ideas");
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(1500);
      if (!keepData) {
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              const request = indexedDB.deleteDatabase("spaghetti-cache");
              request.onsuccess = request.onerror = request.onblocked = () => resolve();
            }),
        );
      }
    };
    await scenario("service worker, nothing saved", (page) => installed(page, false), "allow");
    await scenario("installed app resumed", (page) => installed(page, true), "allow");
  }

  // ---- Taps on the phone ----
  const context = await browser.newContext({ ...PHONE, baseURL: app.url, serviceWorkers: "allow" });
  await signedIn(context);
  await installProbe(context);
  const page = await context.newPage();
  await page.goto("/today");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await throttle(page);

  const taps: Record<string, { inp: number[]; shown: number[] }> = {};
  const add = (name: string, tap: { inp: number; shown: number }) => {
    const entry = taps[name] ?? { inp: [], shown: [] };
    taps[name] = entry;
    entry.inp.push(tap.inp);
    entry.shown.push(tap.shown);
  };
  const tabs = page.getByRole("navigation", { name: "Sections" });
  const heading = (title: string) =>
    `document.querySelector('h1')?.textContent === ${JSON.stringify(title)} && !document.querySelector('.sg-skeleton')`;
  const settle = () => page.waitForTimeout(400);

  for (let run = 0; run < runs; run++) {
    // Capture button and its sheet.
    await settle();
    add(
      "capture button → sheet",
      await tapLatency(page, () => tabs.getByRole("button", { name: "New idea" }).tap(), onScreen("[role=dialog]")),
    );
    await settle();
    await page.keyboard.press("Escape");
    await page.locator("[role=dialog]").waitFor({ state: "detached" });

    // Tabs.
    for (const [from, to] of [
      ["Today", "Ideas"],
      ["Ideas", "Builds"],
      ["Builds", "Today"],
    ]) {
      await settle();
      add(
        `tab ${from} → ${to}`,
        await tapLatency(page, () => tabs.getByRole("link", { name: to }).tap(), heading(to ?? "")),
      );
    }

    // Open an idea, then a build, from their lists.
    await tabs.getByRole("link", { name: "Ideas" }).tap();
    await page.locator('main a[href^="/ideas/"]').first().waitFor();
    await settle();
    add(
      "open an idea",
      await tapLatency(
        page,
        () => page.locator('main a[href^="/ideas/"]').first().tap(),
        `!!document.querySelector('textarea, input[type=text]') && !document.querySelector('.sg-skeleton') && location.pathname.startsWith('/ideas/')`,
      ),
    );
    await page.goBack();
    await tabs.getByRole("link", { name: "Builds" }).tap();
    await page.locator('main a[href^="/builds/"]').first().waitFor();
    await settle();
    add(
      "open a build",
      await tapLatency(
        page,
        () => page.locator('main a[href^="/builds/"]').first().tap(),
        `location.pathname.startsWith('/builds/') && !document.querySelector('.sg-skeleton') && !!document.querySelector('textarea, input[type=text]')`,
      ),
    );

    // On the build made of parts: the attempt sheet, an outcome, a part, a stepper.
    await page.goto(`/builds/${PARTS_BUILD}`);
    await page.getByRole("button", { name: "Log attempt" }).first().waitFor();
    await page.waitForTimeout(800);
    const sheet = page.getByRole("dialog");
    add(
      "log attempt → sheet",
      await tapLatency(
        page,
        () => page.getByRole("button", { name: "Log attempt" }).first().tap(),
        onScreen("[role=dialog] [role=radio]"),
      ),
    );
    await settle();
    add(
      "pick an outcome",
      await tapLatency(
        page,
        () => sheet.getByRole("radio", { name: "Worked" }).tap(),
        `document.querySelector('[role=dialog] [role=radio][aria-checked=true]')?.textContent?.includes('Worked')`,
      ),
    );
    const part = sheet.getByRole("button", { name: /Hull half/ }).first();
    if (await part.count()) {
      await settle();
      await part.tap();
      const plus = sheet.getByRole("button", { name: /: one more$/ }).first();
      await plus.waitFor();
      const count = () => sheet.getByRole("spinbutton").first().getAttribute("aria-valuenow");
      await settle();
      const before = await count();
      add(
        "stepper tap",
        await tapLatency(
          page,
          () => plus.tap(),
          `document.querySelector('[role=dialog] [role=spinbutton]')?.getAttribute('aria-valuenow') !== ${JSON.stringify(before)}`,
        ),
      );
    }
    await page.keyboard.press("Escape");
    await page.locator("[role=dialog]").waitFor({ state: "detached" });
    await page.goBack();
  }

  // Typing in search.
  await page.goto("/search");
  const box = page.locator("#search-box");
  await box.waitFor();
  await box.tap();
  for (let run = 0; run < runs; run++) {
    await box.fill("");
    await settle();
    let type = "";
    for (const key of "tugb") {
      type += key;
      add(
        "search: type a letter",
        await tapLatency(
          page,
          () => page.keyboard.press(key),
          `document.getElementById('search-box')?.value.length === ${type.length}`,
        ),
      );
    }
  }
  add(
    "search: results",
    await tapLatency(page, () => page.keyboard.press("b"), `!!document.querySelector('main mark')`),
  );
  for (const [name, { inp, shown }] of Object.entries(taps)) {
    record(`tap ${name}`, "input to next paint (ms)", inp);
    record(`tap ${name}`, "tap to result (ms)", shown);
  }
  await context.close();

  // ---- The rest of the core loop (a fresh page: the earlier one has run for a while) ----
  const loop = await browser.newContext({ ...PHONE, baseURL: app.url, serviceWorkers: "allow" });
  await signedIn(loop);
  await installProbe(loop);
  const lpage = await loop.newPage();
  await lpage.goto("/ideas");
  await lpage.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await lpage.waitForLoadState("networkidle");
  await lpage.locator('main a[href^="/ideas/"]').first().waitFor();
  await lpage.waitForTimeout(2500);
  await throttle(lpage);
  const ltaps: Record<string, { inp: number[]; shown: number[] }> = {};
  const ladd = (name: string, tap: { inp: number; shown: number }) => {
    const entry = ltaps[name] ?? { inp: [], shown: [] };
    ltaps[name] = entry;
    entry.inp.push(tap.inp);
    entry.shown.push(tap.shown);
  };
  const lsettle = () => lpage.waitForTimeout(400);
  const dialog = lpage.getByRole("dialog");
  for (let run = 0; run < runs; run++) {
    // Capture: open, type a note, save.
    await lsettle();
    await lpage.getByRole("navigation", { name: "Sections" }).getByRole("button", { name: "New idea" }).tap();
    const note = dialog.getByRole("textbox", { name: "Note" });
    await note.waitFor();
    await lsettle();
    await note.tap();
    await lsettle();
    let typed = "";
    for (const key of "tug") {
      typed += key;
      ladd(
        "capture: type a letter",
        await tapLatency(
          lpage,
          () => lpage.keyboard.press(key),
          `document.querySelector('[role=dialog] textarea')?.value.length === ${typed.length}`,
        ),
      );
    }
    await lpage.keyboard.type(`${run}`);
    await lsettle();
    ladd(
      "capture: Save idea",
      await tapLatency(
        lpage,
        () => dialog.getByRole("button", { name: "Save idea" }).tap(),
        `!document.querySelector('[role=dialog]')`,
      ),
    );
    await lsettle();

    // Open the new idea, mark it Up next, start building.
    await lpage
      .locator('main a[href^="/ideas/"]', { hasText: `tug${run}` })
      .first()
      .tap();
    const chip = lpage.getByRole("button", { name: "Up next", pressed: false });
    await chip.waitFor();
    await lsettle();
    ladd(
      "chip: Up next",
      await tapLatency(
        lpage,
        () => chip.tap(),
        `!!document.querySelector('button[aria-pressed=true]')?.textContent?.includes('Up next')`,
      ),
    );
    await lsettle();
    ladd(
      "Start building",
      await tapLatency(
        lpage,
        () => lpage.getByRole("button", { name: "Start building" }).tap(),
        `location.pathname.startsWith('/builds/') && !!document.querySelector('textarea, input[type=text]')`,
      ),
    );
    const opener = lpage.getByRole("button", { name: /^(Log|Finish) attempt/ }).first();
    await opener.waitFor();
    await lsettle();
    await opener.tap();
    await dialog.getByRole("radio", { name: "Worked" }).waitFor();
    await lsettle();
    await dialog.getByRole("radio", { name: "Worked" }).tap();
    await lsettle();
    const finish = dialog.getByRole("button", { name: /^(Log|Finish) attempt$/ });
    ladd(
      "attempt: Finish with an outcome",
      await tapLatency(lpage, () => finish.first().tap(), `!document.querySelector('[role=dialog]')`),
    );
    await lsettle();

    // Delete the build and undo from the toast.
    const deleteButton = lpage.getByRole("button", { name: /^Delete/ }).first();
    if (await deleteButton.count()) {
      await deleteButton.tap();
      const undo = lpage.getByRole("button", { name: "Undo" });
      await undo.waitFor();
      await lsettle();
      ladd(
        "toast: Undo a delete",
        await tapLatency(lpage, () => undo.tap(), `!document.querySelector('[data-sonner-toast]')`),
      );
    }
    await lpage.goto("/ideas");
    await lpage.locator('main a[href^="/ideas/"]').first().waitFor();
  }

  // Wishlist chip and photos, on an idea.
  await lpage.locator('main a[href^="/ideas/"] img').first().tap();
  await lpage.getByRole("button", { name: "My wishlist" }).first().waitFor();
  for (let run = 0; run < runs; run++) {
    await lsettle();
    const chip = lpage.getByRole("button", { name: "My wishlist" }).first();
    const pressed = (await chip.getAttribute("aria-pressed")) === "true";
    ladd(
      "chip: My wishlist",
      await tapLatency(
        lpage,
        () => chip.tap(),
        `!!document.querySelector('button[aria-pressed=${pressed ? "false" : "true"}]')?.textContent?.includes('wishlist')`,
      ),
    );
  }
  const nextPhoto = lpage.getByRole("button", { name: /^Next photo/ });
  if (await nextPhoto.count()) {
    for (let run = 0; run < runs; run++) {
      await lsettle();
      ladd("photo: next", await tapLatency(lpage, () => nextPhoto.tap(), `true`));
      await lsettle();
      await lpage.getByRole("button", { name: /^Previous photo/ }).tap();
    }
  }
  for (const [name, { inp, shown }] of Object.entries(ltaps)) {
    record(`tap ${name}`, "input to next paint (ms)", inp);
    record(`tap ${name}`, "tap to result (ms)", shown);
  }
  await loop.close();

  // ---- Command palette on desktop ----
  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    baseURL: app.url,
    serviceWorkers: "allow",
  });
  await signedIn(desktop);
  await installProbe(desktop);
  const dpage = await desktop.newPage();
  await dpage.goto("/today");
  await dpage.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await dpage.waitForLoadState("networkidle");
  await dpage.waitForTimeout(3000);
  await throttle(dpage);
  const opens: { inp: number[]; shown: number[] } = { inp: [], shown: [] };
  for (let run = 0; run < runs; run++) {
    await dpage.waitForTimeout(400);
    const tap = await tapLatency(
      dpage,
      () => dpage.keyboard.press("Control+k"),
      onScreen("[role=dialog] [role=combobox]"),
    );
    opens.inp.push(tap.inp);
    opens.shown.push(tap.shown);
    await dpage.keyboard.press("Escape");
    await dpage.locator("[role=dialog]").waitFor({ state: "detached" });
  }
  record("tap command palette (desktop)", "input to next paint (ms)", opens.inp);
  record("tap command palette (desktop)", "tap to result (ms)", opens.shown);

  // The rest of the laptop's keyboard loop, at the same 4× CPU: J and K on the inbox, `/` to search, Backspace to
  // delete an idea and Undo from the toast.
  const keys: Record<string, { inp: number[]; shown: number[] }> = {};
  const keyAdd = (name: string, tap: { inp: number; shown: number }) => {
    const entry = keys[name] ?? { inp: [], shown: [] };
    keys[name] = entry;
    entry.inp.push(tap.inp);
    entry.shown.push(tap.shown);
  };
  const card = 'main a[href^="/ideas/"]';
  await dpage.goto("/ideas");
  await dpage.locator(card).first().waitFor();
  for (let run = 0; run < runs; run++) {
    await dpage.waitForTimeout(500);
    keyAdd(
      "J: next card",
      await tapLatency(
        dpage,
        () => dpage.keyboard.press("j"),
        `document.querySelectorAll('main [data-picks] a')[${run}] === document.activeElement`,
      ),
    );
  }
  for (let run = 0; run < runs; run++) {
    await dpage.waitForTimeout(500);
    await dpage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    keyAdd(
      "/: search",
      await tapLatency(
        dpage,
        () => dpage.keyboard.press("/"),
        `location.pathname === '/search' && document.activeElement?.tagName === 'INPUT'`,
      ),
    );
    await dpage.goBack();
    await dpage.locator(card).first().waitFor();
  }
  for (let run = 0; run < runs; run++) {
    await dpage.goto("/ideas");
    await dpage.locator(card).nth(1).waitFor();
    await dpage.waitForTimeout(800);
    await dpage.locator(card).nth(1).click();
    await dpage.waitForTimeout(800);
    keyAdd(
      "Backspace: delete an idea",
      await tapLatency(dpage, () => dpage.keyboard.press("Backspace"), `location.pathname === '/ideas'`),
    );
    const undo = dpage.getByRole("button", { name: "Undo" });
    await undo.waitFor();
    await dpage.waitForTimeout(500);
    // Event Timing is the number to read here: the toast takes its own 200 ms to leave.
    keyAdd(
      "Undo from the toast",
      await tapLatency(dpage, () => undo.click(), `!document.querySelector('[data-sonner-toast]')`),
    );
  }
  for (const [name, { inp, shown }] of Object.entries(keys)) {
    record(`key ${name} (desktop)`, "input to next paint (ms)", inp);
    record(`key ${name} (desktop)`, "tap to result (ms)", shown);
  }
  await desktop.close();

  if (asJson) console.log(JSON.stringify(results, null, 2));
  else {
    for (const [group, values] of Object.entries(results)) {
      console.log(group);
      for (const [name, value] of Object.entries(values))
        console.log(`  ${name.padEnd(40)} ${String(value).padStart(6)}`);
    }
  }
} finally {
  await browser.close();
  app.stop();
}
