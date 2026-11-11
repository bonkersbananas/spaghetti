import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upsertUser } from "./users.ts";
import { applyMigrations, root } from "./wrangler.ts";

/** The two people in every seeded throwaway database. */
export const SEED_PASSWORD = "spaghetti-al-dente";
export const SEED_USERS = [
  { username: "alex", name: "Alex Rivera", color: "tomato", password: SEED_PASSWORD },
  { username: "sam", name: "Sam Okafor", color: "sea", password: SEED_PASSWORD },
] as const;

/** Makes a fresh local D1 in a temp directory, migrated and seeded. */
export async function seedThrowawayState(): Promise<{ dir: string; cleanup: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "spaghetti-"));
  applyMigrations({ persistTo: dir });
  for (const user of SEED_USERS) await upsertUser({ ...user }, { persistTo: dir });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface DevServer {
  url: string;
  stop: () => void;
}

/**
 * Serves the built app (run `pnpm build` first) on workerd with wrangler,
 * the way the container does: this is the one that has a service worker.
 */
/** Points the app's Claude (drafting from model pages) at a stand-in server (scripts/lib/fake-claude.ts). */
export interface FakeClaude {
  claudeUrl?: string;
}

/** The built app's passkeys belong to localhost, not spaghetti.day (wrangler.jsonc): the same override the dev server gets. */
export const localPasskeyVars = ["--var", "WEBAUTHN_RP_ID:localhost", "--var", "WEBAUTHN_ORIGINS:http://localhost:*"];

export async function startBuiltServer({
  port,
  stateDir,
  claudeUrl,
  inspectorPort,
}: {
  port: number;
  stateDir: string;
  /** wrangler's devtools port (default 9229): servers that start side by side each need their own. */
  inspectorPort?: number;
} & FakeClaude): Promise<DevServer> {
  return waitForServer(
    spawn(
      join(root, "node_modules/.bin/wrangler"),
      [
        "dev",
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--persist-to",
        stateDir,
        "--show-interactive-dev-session=false",
        "--live-reload=false",
        // The Worker sees the address the browser opened, as on the dev server: by default wrangler rewrites the Origin
        // header to the route's host (spaghetti.day), and a passkey made at localhost can't be verified.
        "--infer-origin-from-routes=false",
        ...(inspectorPort ? ["--inspector-port", String(inspectorPort)] : []),
        ...localPasskeyVars,
        ...(claudeUrl
          ? [
              "--var",
              "ANTHROPIC_API_KEY:sk-ant-fake",
              "--var",
              `ANTHROPIC_BASE_URL:${claudeUrl}`,
              // The same stand-in also receives webhooks (scripts/lib/fake-claude.ts), which may go to 127.0.0.1 only here.
              "--var",
              "WEBHOOKS_ALLOW_LOCAL:1",
              "--var",
              "WEBHOOK_SECRET_KEY:throwaway-test-key",
            ]
          : []),
      ],
      {
        cwd: root,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
    port,
    "The built app",
  );
}

/** Starts `vite` (the Worker in workerd plus the client) on given state. */
export async function startDevServer({
  port,
  stateDir,
  claudeUrl,
}: { port: number; stateDir: string } & FakeClaude): Promise<DevServer> {
  return waitForServer(
    spawn(join(root, "node_modules/.bin/vite"), ["--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
      cwd: root,
      env: {
        ...process.env,
        SPAGHETTI_STATE_DIR: stateDir,
        BROWSER: "none",
        ...(claudeUrl ? { SPAGHETTI_FAKE_CLAUDE: claudeUrl } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }),
    port,
    "The dev server",
  );
}

async function waitForServer(child: ChildProcess, port: number, name: string): Promise<DevServer> {
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  const url = `http://127.0.0.1:${port}`;
  const stop = () => child.kill("SIGTERM");

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${name} exited:\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return { url, stop };
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stop();
  throw new Error(`${name} didn't start within a minute:\n${output}`);
}
