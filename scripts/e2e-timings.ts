/**
 * Refreshes e2e/timings.json from the logs of CI's Playwright shards (the list reporter's lines, as
 * `gh api repos/OWNER/REPO/actions/jobs/ID/logs --allow-escape-sequences` prints them): the seconds each spec
 * file took, summed over its projects. Pass the logs of the shards of ONE full run: the seconds of every log are added up (a second run's logs would double them).
 *
 *   node scripts/e2e-timings.ts shard1.log shard2.log shard3.log …
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const line = /^\S*\s*(?:✓|✘|-)\s+\d+ \[[^\]]+\] › (e2e\/[\w-]+\.spec\.ts):\d+:\d+ › .*\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
const unit = { ms: 0.001, s: 1, m: 60 } as const;

const total: Record<string, number> = {};
for (const path of process.argv.slice(2)) {
  for (const text of readFileSync(path, "utf8").split("\n")) {
    const match = line.exec(text.replace(/^[^\s]*\s/, ""));
    if (!match) continue;
    const file = (match[1] ?? "").replace("e2e/", "");
    total[file] = (total[file] ?? 0) + Number(match[2]) * unit[match[3] as keyof typeof unit];
  }
}
const sorted = Object.fromEntries(
  Object.entries(total)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, seconds]) => [file, Math.round(seconds)]),
);
writeFileSync(fileURLToPath(new URL("../e2e/timings.json", import.meta.url)), `${JSON.stringify(sorted, null, 2)}\n`);
console.log(
  `${Object.keys(sorted).length} spec files, ${Math.round(Object.values(sorted).reduce((a, b) => a + b, 0) / 60)} min`,
);
