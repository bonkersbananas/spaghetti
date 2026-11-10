/**
 * pnpm ship — build, apply the remote migrations, deploy. The one step for a deploy (docs/deploy.md).
 *
 * (`pnpm deploy` is pnpm's own command for workspaces, so ours has another name.)
 * Needs CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID when the token sees more than one account.
 * Optional: --message "<text>" is passed to wrangler deploy as the version message.
 * Migrations go first and are additive, so the running version keeps working while the new one goes up.
 */
import { spawnSync } from "node:child_process";
import { root } from "./lib/wrangler.ts";

function step(title: string, command: string, args: string[]) {
  console.log(`\n→ ${title}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
  });
  if (result.status !== 0) {
    console.error(`✗ ${title} failed.`);
    process.exit(result.status ?? 1);
  }
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error("✗ CLOUDFLARE_API_TOKEN is not set.");
  process.exit(1);
}

step("Building", "pnpm", ["build"]);
step("Applying remote migrations", "pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--remote"]);
// `pnpm ship --message "<sha> <subject>"` labels the version (wrangler deployments list shows it).
const extra = process.argv.slice(2).filter((a) => a !== "--");
const m = extra.indexOf("--message");
const message = m >= 0 ? extra[m + 1] : undefined;
step("Deploying", "pnpm", ["exec", "wrangler", "deploy", ...(message ? ["--message", message] : [])]);
console.log("\n✓ Live at https://spaghetti.day");
