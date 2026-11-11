/**
 * pnpm start — runs the built app (pnpm build) on workerd with wrangler, the
 * way the container does: applies D1 migrations to the local state, then
 * serves the Worker and its static assets. No Cloudflare account needed.
 *
 *   SPAGHETTI_STATE_DIR  local D1/R2 state (default .wrangler/state; /data in the container)
 *   PORT                 default 8787
 *   HOST                 default 127.0.0.1 (0.0.0.0 in the container)
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { applyMigrations, root } from "./lib/wrangler.ts";

const stateDir = process.env.SPAGHETTI_STATE_DIR;
const port = process.env.PORT ?? "8787";
const host = process.env.HOST ?? "127.0.0.1";

// After `vite build`, wrangler reads dist/spaghetti/wrangler.json through this redirect.
if (!existsSync(join(root, ".wrangler/deploy/config.json"))) {
  console.error("✗ No build found. Run pnpm build first.");
  process.exit(1);
}

console.log(`Applying migrations to ${stateDir ?? ".wrangler/state"}…`);
applyMigrations({ persistTo: stateDir });

const args = [
  "dev",
  "--local",
  "--ip",
  host,
  "--port",
  port,
  "--show-interactive-dev-session=false",
  "--live-reload=false",
  // Passkeys here belong to localhost, not spaghetti.day (wrangler.jsonc).
  ...["--var", "WEBAUTHN_RP_ID:localhost", "--var", "WEBAUTHN_ORIGINS:http://localhost:*"],
];
if (stateDir) args.push("--persist-to", stateDir);

const child = spawn(join(root, "node_modules/.bin/wrangler"), args, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
