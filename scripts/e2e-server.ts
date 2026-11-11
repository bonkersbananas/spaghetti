/**
 * The servers the Playwright tests run against: the production build on workerd (`wrangler dev`, as the container
 * serves it), one for each Playwright worker, so the workers never see each other's data. Server n of E2E_SLOTS
 * listens on PORT + n (playwright.config.ts gives worker n that port), with its own copy of a seeded throwaway D1
 * and R2 and its own stand-in for Claude, which also receives webhooks, 100 ports above it.
 *
 * Builds the app first (E2E_SKIP_BUILD=1 when it's already built), prints "e2e servers ready" once every server
 * answers, and stops them and removes their state on SIGTERM or SIGINT.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startFakeClaude } from "./lib/fake-claude.ts";
import { seedThrowawayState, startBuiltServer } from "./lib/local-app.ts";
import { root } from "./lib/wrangler.ts";

const slots = Number(process.env.E2E_SLOTS ?? 1);
const basePort = Number(process.env.PORT ?? 5174);

if (process.env.E2E_SKIP_BUILD !== "1") {
  const build = spawnSync(join(root, "node_modules/.bin/vite"), ["build"], { cwd: root, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// Migrating and adding the two people takes a few wrangler runs: do it once and copy the result for each server.
const seeded = await seedThrowawayState();
const states = Array.from({ length: slots }, () => {
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-"));
  cpSync(seeded.dir, dir, { recursive: true });
  return dir;
});
seeded.cleanup();

const claudes = await Promise.all(states.map((_, slot) => startFakeClaude(basePort + slot + 100)));
const servers = await Promise.all(
  states.map((stateDir, slot) =>
    startBuiltServer({ port: basePort + slot, stateDir, claudeUrl: claudes[slot]?.url, inspectorPort: 9300 + slot }),
  ),
);
console.log(`e2e servers ready on ${servers.map((server) => server.url).join(", ")}`);

function shutdown() {
  for (const server of servers) server.stop();
  for (const claude of claudes) claude.stop();
  for (const dir of states) rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
