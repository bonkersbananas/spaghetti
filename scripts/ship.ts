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

const USAGE = `Usage: pnpm ship [--message "<text>"]

Builds, applies the remote D1 migrations and deploys to spaghetti.day.

Options:
  --message "<text>"  the version message shown by wrangler deployments list
  -h, --help          print this and exit (deploys nothing)

Needs CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID when the token sees several accounts).`;

// Parse the arguments before anything runs: an unknown flag must never start a deploy.
let message: string | undefined;
{
  const args = process.argv.slice(2).filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--message" && args[i + 1]) {
      message = args[++i];
    } else {
      console.error(a === "--message" ? "--message needs a value." : `Unknown argument: ${a}`);
      console.error(USAGE);
      process.exit(1);
    }
  }
}

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
step("Deploying", "pnpm", ["exec", "wrangler", "deploy", ...(message ? ["--message", message] : [])]);
console.log("\n✓ Live at https://spaghetti.day");
