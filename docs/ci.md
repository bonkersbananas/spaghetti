# CI

Two workflows check every pull request and every push to main, and one publishes the bridge:

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit and Worker tests, the build and the bridge program in one job; the Playwright suite in two shards of spec files balanced by measured time (`scripts/e2e-shard.ts`, `e2e/timings.json`), each on its own runner in Playwright's container image; and on pushes to main only, **Speed** (the timing tests). The ship deploys the newest commit on main whose CI run passed.
- **Images** (`.github/workflows/images.yml`): the container and the bridge's image build and start, both in one job. On every push to main, and on pull requests that touch what goes into them (the Dockerfiles, `bridge/`, `src/shared/`, dependencies, the build config, migrations, `scripts/start.ts` and the scripts it uses): its `paths` list says which.
- **Bridge release** (`.github/workflows/bridge-release.yml`): only for `bridge-v*` tags and by hand.

## Runners are the bottleneck

The repository gets at most **20 jobs running at once** (GitHub's free plan for an organization); a job beyond that waits in the queue, whatever workflow it belongs to. So the number of jobs per run decides how many runs fit at once: keep it small, prefer one runner that does more over several that each set up, and give every job a `timeout-minutes` so a hung one frees its slot.

- A pull request's newer push cancels its older run (the concurrency group is the PR's ref).
- Pushes to main share one group and never cancel each other: the running one finishes, and GitHub keeps only the newest waiting one, so a burst of merges costs two runs, not one each.
- Neither the fctl app nor an agent can cancel a run (`gh run cancel` answers 403). When GitHub itself stalls, runs created meanwhile can stay "queued" with no jobs for good; a new push to the branch starts a fresh run, and the stuck one stops counting among the PR's checks.

## The Playwright suite

Every Playwright worker has its own server and database: `scripts/e2e-server.ts` builds the app once, seeds one throwaway D1 and copies it for each worker, and starts the production build on workerd (`wrangler dev`) for each, on ports 5174 and up, with the stand-in for Claude 100 ports above each. Playwright evaluates `playwright.config.ts` again in every worker, where `TEST_PARALLEL_INDEX` picks that worker's port (`scripts/lib/e2e-ports.ts`). So the workers of a runner run side by side, and a test only ever sees the data of the tests before it in the same worker, as before.

- `E2E_WORKERS` sets the number of workers and servers (2 by default, locally and in CI: a third made a 4-core runner slower). `--workers` would leave workers without a server.
- Service workers are blocked except in the projects that test them (offline, push, share, performance): the dev server never had one, and its caches would outlive a test's data.
- The tests used to run on the Vite dev server; the production build answers about twice as fast, and is what ships.
- The shards are balanced by `e2e/timings.json`: when specs are added or change speed, `node scripts/e2e-timings.ts` on the logs of one full run's shards rewrites it.

## What runs where

- **Every spec at desktop width.** At phone width (390 px, touch) only the core loop runs whole (`PHONE_SPECS` in `playwright.config.ts`: smoke, ideas, builds, today and screens), plus the tests tagged `{ tag: "@phone" }` in other specs: the places where a phone does something else (a sheet for a popover, touch, what happens at the printer). Most specs ran the same steps at both widths for twice the time. Tag a new test `@phone` when its phone path differs.
- **No axe.** Accessibility checks of their own aren't needed for the two people who use the app (Carl Oscar, Nov 11; decision [0037](decisions/0037-e2e-tests-what-matters-quickly.md)). `e2e/screens.spec.ts` keeps opening every screen and sheet at both widths, and the phone and keyboard details: 44 px targets, 16 px fields, a sheet's button above the keyboard, visible focus and focus return.
- **First loads** (`e2e/first-load.spec.ts`, every run): each screen's JavaScript before it shows, held to a ceiling only where the change made it heavier than main. The `e2e` job restores main's latest sizes from the Actions cache (`.first-load/main.json`, key `first-load-<sha>`), and every push to main saves its own, so a screen that only main made heavier never fails another pull request. The ceilings are main's size plus 5 kB, in one table in the spec.
- **Speed** (`e2e/performance.spec.ts`: the common taps, the installed app opening, a hundred photos scrolling at 4× CPU): main only, one worker on a runner of its own, since timing on a busy runner failed runs that had nothing to do with speed. A red Speed job holds the ship back like any failure on main; whoever runs the ship (the autopilot) owns it. Run it by hand with `E2E_SPEED=1 E2E_WORKERS=1 pnpm exec playwright test --project=performance` (the sandbox's numbers are noisy).

## Measuring

```sh
node scripts/ci-report.ts                      # the last 30 successful runs: wall clock, queue, runner minutes, per job
node scripts/ci-report.ts --runs 50 --logs 10 --since 2026-11-12T08:00Z --event pull_request
```

It reads GitHub's record of the runs (`gh` must be signed in) and prints Markdown: per run the wall clock from the push to the last job's end, the wait for the first runner and the runner minutes; per job the time queued, setting up, building and starting the servers, testing and tearing down; and from the Playwright jobs' logs the seconds each spec took in each project.
