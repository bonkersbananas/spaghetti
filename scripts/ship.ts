/**
 * pnpm ship — build, apply the remote migrations, deploy. The one step for a deploy (docs/deploy.md).
 *
 * (`pnpm deploy` is pnpm's own command for workspaces, so ours has another name.)
 * Needs CLOUDFLARE_API_TOKEN, and CLOUDFLARE_ACCOUNT_ID when the token sees more than one account.
 * Optional: --message "<text>" is passed to wrangler deploy as the version message; --note "<sentence>" says what
 * changed for the two people (docs/deploy.md) and is added to whats-new.json, which the update toast shows.
 * Migrations go first and are additive, so the running version keeps working while the new one goes up.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addNote, entryOfHtml } from "../src/shared/whats-new.ts";
import { root } from "./lib/wrangler.ts";

const SITE = "https://spaghetti.day";

const USAGE = `Usage: pnpm ship [--message "<text>"] [--note "<sentence>"]

Builds, applies the remote D1 migrations and deploys to spaghetti.day.

Options:
  --message "<text>"  the version message shown by wrangler deployments list
  --note "<sentence>" what changed for the two people, one plain sentence of about 60 characters (docs/deploy.md);
                      leave it out when nothing visible changed
  -h, --help          print this and exit (deploys nothing)

Needs CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID when the token sees several accounts).`;

// Parse the arguments before anything runs: an unknown flag must never start a deploy.
let message: string | undefined;
let note: string | undefined;
{
  const args = process.argv.slice(2).filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else if (a === "--message" && args[i + 1]) {
      message = args[++i];
    } else if (a === "--note" && args[i + 1]?.trim()) {
      note = args[++i]?.trim();
    } else {
      console.error(a === "--message" || a === "--note" ? `${a} needs a value.` : `Unknown argument: ${a}`);
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
await writeNote(note ?? "");
step("Applying remote migrations", "pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--remote"]);
step("Deploying", "pnpm", ["exec", "wrangler", "deploy", ...(message ? ["--message", message] : [])]);
console.log("\n✓ Live at https://spaghetti.day");

/**
 * Adds this version to whats-new.json in the build: the live site's file plus an entry (with an empty note when the ship has no --note, so a page can tell which versions came after the last real note). Whatever goes wrong
 * here (no connection, a broken file, no entry script) only costs the sentence; the deploy goes on.
 */
async function writeNote(text: string) {
  try {
    const dist = join(root, "dist/client");
    const entry = entryOfHtml(readFileSync(join(dist, "index.html"), "utf8"));
    if (!entry) throw new Error("no entry script in index.html");
    let live: unknown;
    try {
      const response = await fetch(`${SITE}/whats-new.json`, {
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      live = response.ok ? await response.json() : undefined;
    } catch {
      // Starting a new file: the page then shows only this note.
    }
    const file = addNote(live, { entry, date: new Date().toISOString().slice(0, 10), note: text });
    writeFileSync(join(dist, "whats-new.json"), `${JSON.stringify(file, null, 2)}\n`);
    console.log(`\n→ Update toast: ${text || "no note for this version"}`);
  } catch (error) {
    console.warn(
      `\n! The note was not added (${error instanceof Error ? error.message : error}); deploying without it.`,
    );
  }
}
