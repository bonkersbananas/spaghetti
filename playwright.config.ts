import { defineConfig, devices } from "@playwright/test";

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
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /(offline|performance)\.spec/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "phone",
      testIgnore: /(offline|performance)\.spec/,
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
      name: "offline",
      testMatch: /offline\.spec/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${builtPort}`,
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
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
    {
      command: "node scripts/e2e-server.ts",
      url: `http://127.0.0.1:${builtPort}/api/health`,
      env: { PORT: String(builtPort), E2E_BUILT: "1" },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
