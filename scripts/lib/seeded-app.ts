import { type Browser, chromium } from "@playwright/test";
import { seedAll } from "../seed/index.ts";
import { launchOptions } from "./browser.ts";
import { startFakeClaude } from "./fake-claude.ts";
import { type DevServer, seedThrowawayState, startBuiltServer, startDevServer } from "./local-app.ts";

export interface SeededApp extends DevServer {
  /** The local D1/R2 state directory. */
  stateDir: string;
  /** Stops the server and removes the state. */
  stop: () => void;
}

/**
 * A running app on a fresh throwaway database, filled with the screenshot
 * seed (scripts/seed): the dev server by default, the production build on
 * workerd with `built` (build it first). pnpm screenshots and pnpm dev:seed
 * are both this.
 */
export async function startSeededApp({
  port,
  built = false,
  now,
  log = () => {},
}: {
  port: number;
  built?: boolean;
  /** What "now" is for the seed's dates (see SEED_NOW). */
  now: number;
  log?: (message: string) => void;
}): Promise<SeededApp> {
  const state = await seedThrowawayState();
  let server: DevServer | undefined;
  let browser: Browser | undefined;
  // Drafting an idea from a model page asks a stand-in for Anthropic, so those screens can be shot.
  const claude = await startFakeClaude(port + 100, { scoutAlways: true });
  try {
    server = await (built ? startBuiltServer : startDevServer)({ port, stateDir: state.dir, claudeUrl: claude.url });
    log("seeding ideas, the pantry and builds…");
    browser = await chromium.launch(launchOptions());
    await seedAll({ browser, origin: server.url, stateDir: state.dir, now });
  } catch (error) {
    server?.stop();
    claude.stop();
    state.cleanup();
    throw error;
  } finally {
    await browser?.close();
  }
  const running = server;
  return {
    url: running.url,
    stateDir: state.dir,
    stop: () => {
      running.stop();
      claude.stop();
      state.cleanup();
    },
  };
}
