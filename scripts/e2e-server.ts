/**
 * The servers Playwright tests run against, each on a seeded throwaway local
 * D1. By default the Vite dev server (the Worker in workerd). With
 * E2E_BUILT=1 the production build on workerd, which is the one with a
 * service worker (the offline tests). Stops and cleans up on exit.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { startFakeClaude } from "./lib/fake-claude.ts";
import { seedThrowawayState, startBuiltServer, startDevServer } from "./lib/local-app.ts";
import { root } from "./lib/wrangler.ts";

const built = process.env.E2E_BUILT === "1";
const port = Number(process.env.PORT ?? (built ? 5175 : 5174));
const state = await seedThrowawayState();

if (built) {
  const build = spawnSync(join(root, "node_modules/.bin/vite"), ["build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
// Drafting an idea from a model page asks Anthropic; the tests ask this stand-in instead.
const claude = await startFakeClaude(port + 100);
const server = built
  ? await startBuiltServer({ port, stateDir: state.dir, claudeUrl: claude.url })
  : await startDevServer({ port, stateDir: state.dir, claudeUrl: claude.url });
console.log(`e2e ${built ? "built app" : "dev"} server ready on ${server.url}`);

function shutdown() {
  server.stop();
  claude.stop();
  state.cleanup();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
