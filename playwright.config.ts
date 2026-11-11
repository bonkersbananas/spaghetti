import { defineConfig, devices } from "@playwright/test";
import "./scripts/lib/api-retries.ts";
import { launchOptions } from "./scripts/lib/browser.ts";
import { E2E_BASE_PORT, e2eOrigin, e2eSlot } from "./scripts/lib/e2e-ports.ts";

/**
 * Every Playwright worker has a server and database of its own (scripts/e2e-server.ts starts one per worker, on the
 * production build), so workers run side by side without seeing each other's data. Playwright evaluates this file
 * again in each worker process, where TEST_PARALLEL_INDEX picks that worker's server (scripts/lib/e2e-ports.ts).
 * Change the number with E2E_WORKERS, not --workers: a worker beyond E2E_WORKERS would have no server.
 */
// Two per 4-core runner: each worker drives a browser and its own server, and a third made the runner slower.
const workers = Number(process.env.E2E_WORKERS) || 2;
if (e2eSlot() >= workers) throw new Error(`Worker ${e2eSlot()} has no server: set E2E_WORKERS rather than --workers.`);

const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
const phone = { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
/** The specs with projects of their own, below. */
const ownProject = /(offline|performance|push|share|safe-area)\.spec/;

/**
 * Every spec runs at desktop width. The phone project runs whole only the specs of the core loop, where a phone
 * differs everywhere (signing in and the tab bar, capture, a build and its attempts, Today at the printer, every
 * screen and sheet opening); elsewhere only the tests tagged @phone (a sheet where the desktop has a popover, touch,
 * what happens at the printer). Playwright's grep sees "project file › title @tags".
 */
const PHONE_SPECS = ["smoke", "ideas", "builds", "today", "screens"];
const onPhone = [new RegExp(`(^| )(${PHONE_SPECS.join("|")})\\.spec\\.ts `), /@phone\b/];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Two workers share a runner's cores with their servers: give a busy moment 10 s rather than 5 (only a failing
  // assertion ever waits that long).
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: e2eOrigin(),
    trace: "retain-on-failure",
    // The production build registers a service worker; only the projects that test it keep it (the dev server never
    // had one, and its caches would outlive a test's data).
    serviceWorkers: "block",
    // SPAGHETTI_BROWSER: use an existing Chromium (see scripts/lib/browser.ts).
    launchOptions: launchOptions(),
  },
  projects: [
    { name: "desktop", testIgnore: ownProject, use: desktop },
    { name: "phone", testIgnore: ownProject, grep: onPhone, use: phone },
    {
      // The phone as the Home Screen app on an iPhone: standalone, with the notch and home indicator
      // insets (simulateIphone in scripts/lib/iphone.ts), which a plain 390 px window never has.
      name: "iphone",
      testMatch: /safe-area\.spec/,
      use: phone,
    },
    // The timing tests need a quiet machine: CI runs them on main only, in a job of their own (docs/ci.md).
    ...(process.env.E2E_SPEED
      ? [{ name: "performance", testMatch: /performance\.spec/, use: { ...desktop, serviceWorkers: "allow" as const } }]
      : []),
    {
      // Notifications need the service worker, at both widths.
      name: "push-desktop",
      testMatch: /push\.spec/,
      use: { ...desktop, serviceWorkers: "allow", permissions: ["notifications"] },
    },
    {
      name: "push-phone",
      testMatch: /push\.spec/,
      use: { ...phone, serviceWorkers: "allow", permissions: ["notifications"] },
    },
    { name: "offline", testMatch: /(offline|share)\.spec/, use: { ...phone, serviceWorkers: "allow" } },
    {
      // The share target at desktop width.
      name: "share-desktop",
      testMatch: /share\.spec/,
      use: { ...desktop, serviceWorkers: "allow" },
    },
  ],
  webServer: {
    command: "node scripts/e2e-server.ts",
    env: { PORT: String(E2E_BASE_PORT), E2E_SLOTS: String(workers) },
    // It builds the app, then starts every worker's server, and says so once they all answer.
    wait: { stdout: /e2e servers ready/ },
    timeout: 240_000,
    // Lets it stop its servers and remove their throwaway state.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
