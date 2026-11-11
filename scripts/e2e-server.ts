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
import { type DevServer, seedThrowawayState, startBuiltServer } from "./lib/local-app.ts";
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
const servers: DevServer[] = [];

function shutdown(code = 0) {
  for (const server of servers) server.stop();
  for (const claude of claudes) claude.stop();
  for (const dir of states) rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

// Every start settles (a server that doesn't answer within a minute is stopped by startBuiltServer itself); if one
// failed, the ones that did start are stopped too, so no port or state is left behind.
const started = await Promise.allSettled(
  states.map((stateDir, slot) =>
    startBuiltServer({ port: basePort + slot, stateDir, claudeUrl: claudes[slot]?.url, inspectorPort: 9300 + slot }),
  ),
);
for (const result of started) if (result.status === "fulfilled") servers.push(result.value);
const failed = started.find((result) => result.status === "rejected");
if (failed) {
  console.error(failed.reason);
  shutdown(1);
}
console.log(`e2e servers ready on ${servers.map((server) => server.url).join(", ")}`);
setInterval(() => {}, 1 << 30);
