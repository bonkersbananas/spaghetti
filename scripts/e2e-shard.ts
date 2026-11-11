/**
 * Which Playwright spec files a CI shard runs, balanced by how long they took (e2e/timings.json) rather than by
 * how many tests there are: `pnpm test:e2e $(node scripts/e2e-shard.ts 2 2)` is the second of two shards.
 *
 * - A file runs in every project that matches it, so its time is the sum over projects (phone and desktop).
 * - Every shard starts its own servers (one per Playwright worker, on the production build), so any file can go
 *   anywhere; within a shard, Playwright hands the files to whichever worker is free.
 * - A file missing from the timings counts as the median, so a new spec lands somewhere sensible until
 *   `node scripts/e2e-timings.ts <CI log>…` refreshes the numbers.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const specDir = fileURLToPath(new URL("../e2e/", import.meta.url));

export type Timings = Record<string, number>;

export function readTimings(): Timings {
  return JSON.parse(readFileSync(`${here}../e2e/timings.json`, "utf8")) as Timings;
}

/** The timing tests run in their own job, on main only (playwright.config.ts adds their project with E2E_SPEED=1). */
export const SPEED_SPECS = new Set(["performance.spec.ts"]);

export function specFiles(): string[] {
  return readdirSync(specDir)
    .filter((name) => name.endsWith(".spec.ts") && !SPEED_SPECS.has(name))
    .sort();
}

/** Every file in exactly one of `count` shards, longest first onto the lightest. */
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
  for (const file of [...files].sort((a, b) => seconds(b) - seconds(a) || a.localeCompare(b))) {
    place(file, load.indexOf(Math.min(...load)));
  }
  return shards.map((shard) => shard.sort());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [index, count] = [Number(process.argv[2]), Number(process.argv[3])];
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    console.error("Usage: node scripts/e2e-shard.ts <shard, from 1> <of how many>");
    process.exit(2);
  }
  const shard = assignShards(specFiles(), readTimings(), count)[index - 1] ?? [];
  console.log(shard.map((file) => `e2e/${file}`).join(" "));
}
