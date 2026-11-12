import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Runs without CLOUDFLARE_API_TOKEN: if the script got past its arguments it would stop at the token check.
function ship(...args: string[]) {
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  return spawnSync("node", ["--experimental-strip-types", "scripts/ship.ts", ...args], { env, encoding: "utf8" });
}

describe("pnpm ship arguments", () => {
  it("--help prints usage and exits 0 before anything runs", () => {
    const r = ship("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Usage: pnpm ship");
    expect(r.stderr).not.toContain("CLOUDFLARE_API_TOKEN is not set");
    expect(r.stdout).not.toContain("Building");
  });
  it("refuses unknown flags and a bare --message", () => {
    for (const args of [["--nope"], ["--message"]]) {
      const r = ship(...args);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("Usage: pnpm ship");
      expect(r.stderr).not.toContain("CLOUDFLARE_API_TOKEN is not set");
    }
  });
});
