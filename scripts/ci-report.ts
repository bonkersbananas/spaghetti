/**
 * Where CI's time goes, from GitHub's own record of the latest runs of .github/workflows/ci.yml (needs `gh`, signed
 * in). For the successful runs: the wall clock (from the push to the last job's end), the wait before the first job
 * got a runner and the runner minutes, then per job the time queued for a runner, setting up (checkout, pnpm, Node,
 * install, the Playwright container), the work itself and tearing down. The Playwright jobs' logs of the newest runs
 * split their work into building and starting the servers, and the tests, and give the seconds of each spec in each
 * project. Prints Markdown, for a pull request's description.
 *
 *   node scripts/ci-report.ts                         # the last 30 successful runs, the logs of the newest 5
 *   node scripts/ci-report.ts --runs 50 --logs 10 --since 2026-11-12T08:00Z --event pull_request
 */
import { execFileSync } from "node:child_process";
import { parseArgs, stripVTControlCharacters } from "node:util";

const { values: options } = parseArgs({
  options: {
    runs: { type: "string", default: "30" },
    logs: { type: "string", default: "5" },
    since: { type: "string" },
    event: { type: "string" },
    workflow: { type: "string", default: "ci.yml" },
  },
});

interface Step {
  name: string;
  started_at: string | null;
  completed_at: string | null;
}
interface Job {
  id: number;
  name: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  conclusion: string | null;
  steps?: Step[];
}
interface Run {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
}

const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8" }).trim();
const token = gh("auth", "token");
const repo = gh("repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner");

async function get(path: string): Promise<Response> {
  const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} to ${path}`);
  return response;
}

/** Runs `task` over `items`, eight at a time. */
async function pool<T, R>(items: T[], task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return results;
}

const seconds = (from: string | null, to: string | null) =>
  from && to ? Math.max(0, (Date.parse(to) - Date.parse(from)) / 1000) : 0;
const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0) : 0;
};
const minutes = (s: number) => (s / 60).toFixed(1);
const clock = (s: number) => (s >= 90 ? `${minutes(s)} min` : `${Math.round(s)} s`);

// The runs: newest first, until enough successful ones (and every run since --since, for the counts).
const wanted = Number(options.runs);
const runs: Run[] = [];
for (let page = 1; page <= 10; page++) {
  const event = options.event ? `&event=${options.event}` : "";
  const batch = (
    (await (await get(`actions/workflows/${options.workflow}/runs?per_page=100&page=${page}${event}`)).json()) as {
      workflow_runs: Run[];
    }
  ).workflow_runs;
  const fresh = batch.filter((run) => !options.since || run.created_at >= options.since);
  runs.push(...fresh);
  const successes = runs.filter((run) => run.conclusion === "success").length;
  if (batch.length < 100 || fresh.length < batch.length || (!options.since && successes >= wanted)) break;
}
// Without --since, every run back to the oldest successful one counted, for the share that failed or was cancelled.
let counted = runs;
if (!options.since) {
  let found = 0;
  const oldest = runs.findIndex((run) => run.conclusion === "success" && ++found === wanted);
  if (oldest >= 0) counted = runs.slice(0, oldest + 1);
}
const successful = counted.filter((run) => run.conclusion === "success").slice(0, wanted);
if (!successful.length) {
  console.error("No successful runs in that window.");
  process.exit(1);
}
const jobsOf = new Map<number, Job[]>(
  await pool(
    successful,
    async (run) =>
      [
        run.id,
        ((await (await get(`actions/runs/${run.id}/jobs?per_page=100`)).json()) as { jobs: Job[] }).jobs,
      ] as const,
  ),
);

const SETUP =
  /^(Set up job|Initialize containers|Run actions\/checkout|Run pnpm\/action-setup|Run actions\/setup-node|Run pnpm install|Run oven-sh\/setup-bun|Run actions\/cache|Run actions\/download-artifact|Run docker\/setup|Install the browser)/;
const TEARDOWN = /^(Post |Stop containers|Complete job|Run actions\/upload-artifact)/;
const jobKind = (name: string) => name.replace(/\d+\/(\d+)/, "n/$1");

interface Phases {
  job: number;
  queue: number;
  setup: number;
  work: number;
  teardown: number;
  total: number;
  servers?: number;
  tests?: number;
}
const byJob = new Map<string, Phases[]>();
const perRun = successful.map((run) => {
  const jobs = (jobsOf.get(run.id) ?? []).filter(
    (job) => job.started_at && seconds(job.started_at, job.completed_at) > 0,
  );
  for (const job of jobs) {
    const steps = job.steps ?? [];
    const sum = (match: (step: Step) => boolean) =>
      steps.filter(match).reduce((total, step) => total + seconds(step.started_at, step.completed_at), 0);
    const phases: Phases = {
      job: job.id,
      queue: seconds(job.created_at, job.started_at),
      setup: sum((step) => SETUP.test(step.name)),
      teardown: sum((step) => TEARDOWN.test(step.name)),
      work: sum((step) => !SETUP.test(step.name) && !TEARDOWN.test(step.name)),
      total: seconds(job.started_at, job.completed_at),
    };
    byJob.set(jobKind(job.name), [...(byJob.get(jobKind(job.name)) ?? []), phases]);
  }
  const starts = jobs.map((job) => Date.parse(job.started_at ?? ""));
  const ends = jobs.map((job) => Date.parse(job.completed_at ?? ""));
  return {
    wall: (Math.max(...ends) - Date.parse(run.created_at)) / 1000,
    firstRunner: (Math.min(...starts) - Date.parse(run.created_at)) / 1000,
    runner: jobs.reduce((total, job) => total + seconds(job.started_at, job.completed_at), 0),
    jobs: jobs.length,
  };
});

// The Playwright jobs' logs of the newest runs: when the tests began (after the build and the servers), and each test.
const testLine =
  /(?:✓|✘|ok|x)\s+\d+ \[([^\]]+)\] › (e2e\/[\w.-]+\.spec\.ts):\d+:\d+ › .*\((\d+(?:\.\d+)?)(ms|s|m)\)\s*$/;
const unit = { ms: 0.001, s: 1, m: 60 } as const;
const specSeconds = new Map<string, number>();
const logRuns = successful.slice(0, Number(options.logs));
const playwrightJobs = logRuns.flatMap((run) =>
  (jobsOf.get(run.id) ?? []).filter((job) => /playwright|e2e/i.test(job.name)),
);
await pool(playwrightJobs, async (job) => {
  const log = stripVTControlCharacters(await (await get(`actions/jobs/${job.id}/logs`)).text());
  const lines = log.split("\n");
  const started = lines.find((line) => /Running \d+ tests? using \d+ workers?/.test(line));
  // The step the tests ran in (others, such as restoring main's first-load sizes, can come before it).
  const startedAt = started ? Date.parse(started.slice(0, 28)) : Number.NaN;
  const work =
    (job.steps ?? []).find(
      (step) =>
        step.started_at &&
        step.completed_at &&
        Date.parse(step.started_at) - 1000 <= startedAt &&
        startedAt <= Date.parse(step.completed_at) + 1000,
    ) ?? (job.steps ?? []).find((step) => !SETUP.test(step.name) && !TEARDOWN.test(step.name));
  const phases = byJob.get(jobKind(job.name))?.find((p) => p.job === job.id);
  if (started && work?.started_at && work.completed_at && phases) {
    const at = started.slice(0, 28);
    phases.servers = seconds(work.started_at, at);
    phases.tests = seconds(at, work.completed_at);
  }
  for (const line of lines) {
    const match = testLine.exec(line);
    if (!match) continue;
    const key = `${match[2]?.replace("e2e/", "")} [${match[1]}]`;
    specSeconds.set(key, (specSeconds.get(key) ?? 0) + Number(match[3]) * unit[match[4] as keyof typeof unit]);
  }
});

// The report.
const from = successful.at(-1)?.created_at.slice(0, 16).replace("T", " ");
const to = successful[0]?.created_at.slice(0, 16).replace("T", " ");
const outcome = (c: string | null) => counted.filter((run) => (run.conclusion ?? run.status) === c).length;
console.log(`### CI runs ${from} to ${to} UTC\n`);
console.log(
  `${counted.length} runs: ${outcome("success")} passed, ${outcome("failure")} failed, ${outcome("cancelled")} cancelled, ${counted.length - outcome("success") - outcome("failure") - outcome("cancelled")} other (queued, running). The figures are for the ${successful.length} that passed, median (90th percentile).\n`,
);
const row = (values: number[], format = clock) => `${format(quantile(values, 0.5))} (${format(quantile(values, 0.9))})`;
console.log("| Per run | Median (p90) |\n|---|---|");
console.log(`| Wall clock, push to last job done | ${row(perRun.map((r) => r.wall))} |`);
console.log(`| Waiting for the first runner | ${row(perRun.map((r) => r.firstRunner))} |`);
console.log(
  `| Runner minutes | ${row(
    perRun.map((r) => r.runner),
    minutes,
  )} |`,
);
console.log(
  `| Jobs | ${row(
    perRun.map((r) => r.jobs),
    String,
  )} |\n`,
);
console.log(
  "| Job | Queued | Setup | Build and servers | Tests | Other work | Teardown | Total |\n|---|---|---|---|---|---|---|---|",
);
for (const [name, list] of [...byJob].sort(([a], [b]) => a.localeCompare(b))) {
  const split = list.filter((p) => p.tests !== undefined);
  const pick = (k: "queue" | "setup" | "work" | "teardown" | "total") => list.map((p) => p[k]);
  const fromLogs = (k: "servers" | "tests") => (split.length ? row(split.map((p) => p[k] ?? 0)) : "");
  const other = split.length ? "" : row(pick("work"));
  console.log(
    `| ${name} | ${row(pick("queue"))} | ${row(pick("setup"))} | ${fromLogs("servers")} | ${fromLogs("tests")} | ${other} | ${row(pick("teardown"))} | ${row(pick("total"))} |`,
  );
}
if (specSeconds.size) {
  const perRunSeconds = [...specSeconds].map(([key, total]) => [key, total / logRuns.length] as const);
  const projects = new Map<string, number>();
  for (const [key, s] of perRunSeconds) {
    const project = key.slice(key.lastIndexOf("[") + 1, -1);
    projects.set(project, (projects.get(project) ?? 0) + s);
  }
  const total = perRunSeconds.reduce((sum, [, s]) => sum + s, 0);
  console.log(`\nTest time per run (the logs of the newest ${logRuns.length}), ${minutes(total)} min in all:\n`);
  console.log(`| Project | Minutes |\n|---|---|`);
  for (const [project, s] of [...projects].sort((a, b) => b[1] - a[1])) console.log(`| ${project} | ${minutes(s)} |`);
  console.log(`\n| Spec [project] | Seconds per run |\n|---|---|`);
  for (const [key, s] of perRunSeconds.sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`| ${key} | ${Math.round(s)} |`);
}
