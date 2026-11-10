import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../..", import.meta.url));
const bin = fileURLToPath(new URL("../../node_modules/.bin/wrangler", import.meta.url));

export interface Target {
  /** Write to the deployed database instead of local state. */
  remote?: boolean;
  /** Local state directory (default: wrangler's own, .wrangler/state). */
  persistTo?: string;
}

export function targetArgs({ remote, persistTo }: Target): string[] {
  if (remote) return ["--remote"];
  return ["--local", ...(persistTo ? ["--persist-to", persistTo] : [])];
}

/** Runs wrangler, returning stdout. Throws with its output if it fails. */
export function wrangler(args: string[], { quiet = true } = {}): string {
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false" },
    stdio: quiet ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed:\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result.stdout ?? "";
}

export function applyMigrations(target: Target) {
  return wrangler(["d1", "migrations", "apply", "DB", ...targetArgs(target)]);
}

export function executeSql(sql: string, target: Target) {
  return wrangler(["d1", "execute", "DB", ...targetArgs(target), "--command", sql]);
}
