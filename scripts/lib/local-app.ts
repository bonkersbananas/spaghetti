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

/** Starts `vite` (the Worker in workerd plus the client) on given state. */
export async function startDevServer({ port, stateDir }: { port: number; stateDir: string }): Promise<DevServer> {
  const child: ChildProcess = spawn(
    join(root, "node_modules/.bin/vite"),
    ["--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: root,
      env: { ...process.env, SPAGHETTI_STATE_DIR: stateDir, BROWSER: "none" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout?.on("data", (chunk) => (output += chunk));
  child.stderr?.on("data", (chunk) => (output += chunk));
  const url = `http://127.0.0.1:${port}`;
  const stop = () => child.kill("SIGTERM");

  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`The dev server exited:\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) return { url, stop };
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stop();
  throw new Error(`The dev server didn't start within a minute:\n${output}`);
}
