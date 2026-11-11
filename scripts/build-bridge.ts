/**
 * Builds the printer bridge into single files that need no Node, pnpm or Homebrew: `bun build --compile` bundles
 * bridge/ and its dependencies with the Bun runtime. Writes, for each target, `dist/bridge/spaghetti-bridge-<target>`
 * (the program) and `.gz` (what is published), and SHA256SUMS over the .gz files.
 *
 *   node scripts/build-bridge.ts --version 1.0.0                       both Mac targets
 *   node scripts/build-bridge.ts --version 1.0.0 --targets darwin-arm64
 *   node scripts/build-bridge.ts --targets linux-x64                   to try it here (CI does, then runs the smoke test)
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const TARGETS = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64"] as const;
const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const version = option("--version") ?? "dev";
const targets = (option("--targets") ?? "darwin-arm64,darwin-x64").split(",");
const out = option("--out") ?? "dist/bridge";

for (const target of targets) {
  if (!(TARGETS as readonly string[]).includes(target)) {
    console.error(`✗ Unknown target ${target}. Targets: ${TARGETS.join(", ")}.`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sums: string[] = [];
for (const target of targets) {
  const file = join(out, `spaghetti-bridge-${target}`);
  const built = spawnSync(
    "bun",
    [
      "build",
      "bridge/index.ts",
      "--compile",
      `--target=bun-${target}`,
      "--define",
      `process.env.BRIDGE_BUILD_VERSION=${JSON.stringify(version)}`,
      "--outfile",
      file,
    ],
    { stdio: "inherit" },
  );
  if (built.status !== 0) process.exit(built.status ?? 1);
  const gz = gzipSync(readFileSync(file), { level: 9 });
  writeFileSync(`${file}.gz`, gz);
  sums.push(`${createHash("sha256").update(gz).digest("hex")}  spaghetti-bridge-${target}.gz`);
  console.log(`✓ ${file} (${(gz.length / 1e6).toFixed(1)} MB compressed)`);
}
writeFileSync(join(out, "SHA256SUMS"), `${sums.join("\n")}\n`);
