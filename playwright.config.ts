import { defineConfig, devices } from "@playwright/test";
import "./scripts/lib/api-retries.ts";
import { launchOptions } from "./scripts/lib/browser.ts";

const port = 5174;
// The production build, served by workerd: the only one with a service worker.
const builtPort = 5175;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    // SPAGHETTI_BROWSER: use an existing Chromium (see scripts/lib/browser.ts).
    launchOptions: launchOptions(),
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /(offline|performance|push|share|safe-area)\.spec/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      testIgnore: /(offline|performance|push|share|safe-area)\.spec/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      // The phone as the Home Screen app on an iPhone: standalone, with the notch and home indicator
      // insets (simulateIphone in scripts/lib/iphone.ts), which a plain 390 px window never has.
      name: "iphone",
      testMatch: /safe-area\.spec/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
    {
      // Performance is measured on the production build, like the offline tests.
      name: "performance",
      testMatch: /performance\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${builtPort}`,
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      // Notifications need the service worker, so they run on the production build, at both widths.
      name: "push-desktop",
      testMatch: /push\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${builtPort}`,
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "allow",
        permissions: ["notifications"],
      },
    },
    {
      name: "push-phone",
      testMatch: /push\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${builtPort}`,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "allow",
        permissions: ["notifications"],
      },
    },
    {
      name: "offline",
      testMatch: /(offline|share)\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${builtPort}`,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "allow",
      },
    },
    {
      // The share target at desktop width, also on the production build.
      name: "share-desktop",
      testMatch: /share\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${builtPort}`,
        viewport: { width: 1440, height: 900 },
        serviceWorkers: "allow",
      },
    },
  ],
  webServer: [
    {
      command: "node scripts/e2e-server.ts",
      url: `http://127.0.0.1:${port}/api/health`,
      env: { PORT: String(port) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The production build (and its server) is only started when the specs that run need it: a CI shard without
    // them (scripts/e2e-shard.ts says which) sets E2E_BUILT_SERVER=off and skips the build.
    ...(process.env.E2E_BUILT_SERVER === "off"
      ? []
      : [
          {
            command: "node scripts/e2e-server.ts",
            url: `http://127.0.0.1:${builtPort}/api/health`,
            env: { PORT: String(builtPort), E2E_BUILT: "1" },
            reuseExistingServer: !process.env.CI,
            timeout: 180_000,
          },
        ]),
  ],
});
