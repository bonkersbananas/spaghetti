/**
 * Which Playwright spec files a CI shard runs, balanced by how long they took (e2e/timings.json) rather than by
 * how many tests there are: `pnpm test:e2e $(node scripts/e2e-shard.ts 2 5)` is the second of five shards.
 *
 * - A file runs in every project that matches it, so its time is the sum over projects (phone and desktop).
 * - The specs that need the production build (performance, offline, push, share) all go to the last shard, which is
 *   the only one that builds it; `node scripts/e2e-shard.ts 2 5 --needs-built` says "1" or "0" for a shard, and the
 *   Playwright config starts the built server only when E2E_BUILT_SERVER isn't "off".
 * - A file missing from the timings counts as the median, so a new spec lands somewhere sensible until
 *   `node scripts/e2e-timings.ts <CI log>…` refreshes the numbers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const specDir = fileURLToPath(new URL("../e2e/", import.meta.url));

/** Specs that run against the production build (see the projects in playwright.config.ts). */
export const BUILT_SPECS = /^(offline|performance|push|share)\.spec\.ts$/;

export type Timings = Record<string, number>;

export function readTimings(): Timings {
  return JSON.parse(readFileSync(`${here}../e2e/timings.json`, "utf8")) as Timings;
}

export function specFiles(): string[] {
  return readdirSync(specDir)
    .filter((name) => name.endsWith(".spec.ts"))
    .sort();
}

/** Every file in exactly one of `count` shards: the built ones in the last, the rest longest first onto the lightest. */
export function assignShards(files: string[], timings: Timings, count: number): string[][] {
  const known = Object.values(timings).sort((a, b) => a - b);
  const median = known[Math.floor(known.length / 2)] ?? 60;
  const seconds = (file: string) => timings[file] ?? median;
  const shards: string[][] = Array.from({ length: count }, () => []);
  const load = new Array<number>(count).fill(0);
  const place = (file: string, shard: number) => {
    shards[shard]?.push(file);
    load[shard] = (load[shard] ?? 0) + seconds(file);
  };
  const [built, rest] = [files.filter((f) => BUILT_SPECS.test(f)), files.filter((f) => !BUILT_SPECS.test(f))];
  for (const file of built) place(file, count - 1);
  for (const file of rest.sort((a, b) => seconds(b) - seconds(a) || a.localeCompare(b))) {
    place(file, load.indexOf(Math.min(...load)));
  }
  return shards.map((shard) => shard.sort());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [index, count] = [Number(process.argv[2]), Number(process.argv[3])];
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error("Usage: node scripts/e2e-shard.ts <shard, from 1> <of how many> [--needs-built]");
    process.exit(2);
  }
  const shard = assignShards(specFiles(), readTimings(), count)[index - 1] ?? [];
  if (process.argv.includes("--needs-built")) console.log(shard.some((file) => BUILT_SPECS.test(file)) ? "1" : "0");
  else console.log(shard.map((file) => `e2e/${file}`).join(" "));
}
