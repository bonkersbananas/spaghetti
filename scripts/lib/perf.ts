/**
 * Helpers for measuring how fast Spaghetti feels on a mid-range phone: `pnpm perf` (scripts/perf.ts) and the
 * budgets in e2e/performance.spec.ts both use them.
 *
 * - `throttle` is the phone: 4× slower CPU and a slow 4G network (1.6 Mbit/s down, 150 ms round trip), through CDP.
 * - `probe` is injected into every page: it records the Event Timing API's entries (input to next paint, what INP
 *   measures) and can watch for a screen element to appear after a tap or key press.
 * - `tapLatency` runs one interaction and gives both numbers.
 */
import type { BrowserContext, Page } from "@playwright/test";

export const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
} as const;

export const CPU_SLOWDOWN = 4;
const SLOW_4G = { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

/** 4× CPU throttling and slow 4G on this page (it lasts for the page's life). */
export async function throttle(page: Page, { cpu = CPU_SLOWDOWN, network = true } = {}) {
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setCPUThrottlingRate", { rate: cpu });
  if (network) await client.send("Network.emulateNetworkConditions", { offline: false, ...SLOW_4G });
  return client;
}

interface Probe {
  t0: number;
  events: Array<{ name: string; start: number; duration: number }>;
  watch: (check: () => boolean) => Promise<number>;
  ready: number;
  firstScreen: number;
}

declare global {
  interface Window {
    __perf: Probe;
    __readyCheck?: string;
    __watching?: Promise<number>;
  }
}

/** Adds the probe to every page of the context. `ready` is a JS expression that is true once the screen is useful. */
export async function installProbe(context: BrowserContext, ready?: string) {
  await context.addInitScript((readyExpression) => {
    const probe: Probe = {
      t0: 0,
      events: [],
      ready: -1,
      firstScreen: -1,
      watch: (check) =>
        new Promise((resolve) => {
          const mark = performance.now();
          const tick = () => {
            if (probe.t0 >= mark && check()) return resolve(performance.now() - probe.t0);
            if (performance.now() - mark > 10_000) return resolve(-1);
            requestAnimationFrame(tick);
          };
          tick();
        }),
    };
    window.__perf = probe;
    for (const type of ["pointerdown", "keydown"]) {
      addEventListener(type, (event) => (probe.t0 = event.timeStamp), true);
    }
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        probe.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: "event", durationThreshold: 16, buffered: true } as PerformanceObserverInit);
    if (readyExpression) {
      const check = new Function(`return (${readyExpression})`) as () => boolean;
      const tick = () => {
        if (probe.firstScreen < 0 && document.querySelector("h1")) probe.firstScreen = performance.now();
        if (probe.ready < 0 && check()) probe.ready = performance.now();
        if (probe.ready < 0 && performance.now() < 60_000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }, ready);
}

export interface TapResult {
  /** The longest input-to-next-paint among the events this tap caused, ms (events under 16 ms don't register: 0). */
  inp: number;
  /** From the finger going down to the result on screen (the next frame after `done` is true), ms; -1 if it never showed. */
  shown: number;
}

/**
 * Does `act` (a tap, a key press) and says how long until the page painted a reaction (`inp`) and until `done`
 * (a JS expression about the page) was true on screen (`shown`).
 */
export async function tapLatency(page: Page, act: () => Promise<unknown>, done: string): Promise<TapResult> {
  await page.evaluate(() => {
    window.__perf.events = [];
  });
  // The watch must be running before the tap or key press: its `mark` is taken when the page runs this, and a key
  // event stamped earlier (the page's main thread is slowed, so it can run this a moment after the press has been
  // delivered) would never count and the result would be -1. So start it, and only then act.
  await page.evaluate((expression) => {
    window.__watching = window.__perf.watch(new Function(`return (${expression})`) as () => boolean);
  }, done);
  await act();
  const time = await page.evaluate(() => window.__watching as Promise<number>);
  // Event Timing entries arrive a little after the paint.
  await page.waitForTimeout(250);
  const events = await page.evaluate(() => window.__perf.events);
  const inp = events.reduce((max, event) => Math.max(max, event.duration), 0);
  return { inp, shown: time };
}

export const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** The expression that says an element matching `selector` is on screen. */
export const onScreen = (selector: string) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
