import type { D1Migration } from "cloudflare:test";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** Starts the tests' clock at this moment (test/support/shift-clock.ts). */
      FAKE_NOW?: string;
    }
  }
}
