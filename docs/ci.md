# CI

Two workflows check every pull request and every push to main, and one publishes the bridge:

- **CI** (`.github/workflows/ci.yml`): lint, typecheck, unit and Worker tests, the build and the bridge program in one job; the Playwright suite in shards of spec files balanced by measured time (`scripts/e2e-shard.ts`, `e2e/timings.json`), each on its own runner in Playwright's container image. The ship deploys the newest commit on main whose CI run passed.
- **Images** (`.github/workflows/images.yml`): the container and the bridge's image build and start, both in one job. On every push to main, and on pull requests that touch what goes into them (the Dockerfiles, `bridge/`, `src/shared/`, dependencies, the build config, migrations, `scripts/start.ts` and the scripts it uses): its `paths` list says which.
- **Bridge release** (`.github/workflows/bridge-release.yml`): only for `bridge-v*` tags and by hand.

## Runners are the bottleneck

The repository gets at most **20 jobs running at once** (GitHub's free plan for an organization); a job beyond that waits in the queue, whatever workflow it belongs to. So the number of jobs per run decides how many runs fit at once: keep it small, prefer one runner that does more over several that each set up, and give every job a `timeout-minutes` so a hung one frees its slot.

- A pull request's newer push cancels its older run (the concurrency group is the PR's ref).
- Pushes to main share one group and never cancel each other: the running one finishes, and GitHub keeps only the newest waiting one, so a burst of merges costs two runs, not one each.
- Neither the fctl app nor an agent can cancel a run (`gh run cancel` answers 403). When GitHub itself stalls, runs created meanwhile can stay "queued" with no jobs for good; a new push to the branch starts a fresh run, and the stuck one stops counting among the PR's checks.

## Measuring

```sh
node scripts/ci-report.ts                      # the last 30 successful runs: wall clock, queue, runner minutes, per job
node scripts/ci-report.ts --runs 50 --logs 10 --since 2026-11-12T08:00Z --event pull_request
```

It reads GitHub's record of the runs (`gh` must be signed in) and prints Markdown: per run the wall clock from the push to the last job's end, the wait for the first runner and the runner minutes; per job the time queued, setting up, building and starting the servers, testing and tearing down; and from the Playwright jobs' logs the seconds each spec took in each project.
