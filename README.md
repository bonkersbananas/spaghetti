# Spaghetti

A private notebook for 3D printing, shared by two people: capture ideas in seconds, follow each build through every print attempt, and keep a journal of what worked and what failed (the spaghetti too).

It runs on Cloudflare Workers with D1 and R2, and just as well entirely locally on workerd, inside or outside a container, without a Cloudflare account.

- **Client:** React 19 SPA built with Vite, TanStack Router and Query, Tailwind CSS v4 with design tokens, `motion`, `vaul`, `sonner`.
- **Server:** a Hono Worker serving the JSON API under `/api`; the client is served as Workers static assets with SPA fallback.
- **Data:** D1 through Drizzle ORM (migrations in `migrations/`), photos in the R2 bucket bound as `PHOTOS`.
- **Design:** [docs/design.md](docs/design.md), live at `/styleguide` once signed in.
- **Landing page:** what someone signed out sees at `/`, a static page of its own ([docs/landing.md](docs/landing.md)); its pictures come from `pnpm landing:shots`.

## Run it locally

Needs Node 24 or later (26 recommended) and pnpm (`npm install -g pnpm`, or Corepack).

```sh
pnpm install
pnpm user:add        # asks for a username, name, color and password
pnpm user:add        # …and once more for the other person
pnpm dev             # http://localhost:5173
```

`pnpm dev` applies migrations to the local D1 and starts one Vite dev server that runs the Worker in workerd (via `@cloudflare/vite-plugin`) with hot reload for both. Local D1 and R2 state lives in `.wrangler/state`; delete that folder to start over.

### Adding the two people

```sh
pnpm user:add                                          # interactive
pnpm user:add --username sam --name "Sam" --color sea  # asks only for the password
SPAGHETTI_PASSWORD=… pnpm user:add --username sam --name Sam --color sea   # non-interactive
```

Colors: tomato, basil, semolina, plum, sea, clay. Running it again for an existing username updates the name, color and password, and signs that person out everywhere. Passwords are hashed locally (PBKDF2-SHA256, 100,000 iterations, per-user salt) and the row is written with `wrangler d1 execute`: local by default, `--remote` for the deployed database, `--persist-to DIR` for another local state directory.

Sessions last 400 days (the browser maximum) and renew with use, so a phone stays signed in.

## Tests and checks

```sh
pnpm lint         # Biome, plus the design lint (tokens only, see docs/design.md)
pnpm typecheck    # tsc for the client, the Worker and the Node scripts
pnpm test         # Vitest: API tests in workerd with real D1 and R2, unit tests in Node
pnpm test:e2e     # Playwright at 390 and 1440 px against the production build, one server per worker
pnpm format       # fix formatting and import order
```

The first Playwright run needs a browser: `pnpm exec playwright install chromium-headless-shell`. CI runs all of the above on every pull request, and builds and smoke-tests the container image.

## Screenshots and exploring with data

```sh
pnpm screenshots                 # every screen at 390×844 and 1440×900
pnpm screenshots ideas capture   # only some (--dark, --both, --scale 1, --out DIR)
pnpm screenshots:compare         # the same on main and on your branch: diff images and contact sheets
pnpm dev:seed                    # the dev server on a throwaway database with the screenshot data
```

They start the app on a seeded throwaway database, sign in and write PNGs to `screenshots/` (gitignored). The list of screens is in `scripts/screenshot-routes.ts`; the seed is in `scripts/seed/`. A shot that fails doesn't stop the rest: failures are listed at the end and the exit code is 1.

`pnpm run doctor` checks Node, pnpm, the browser, wrangler and the local database, and says how to fix what's wrong. To use an existing Chromium instead of Playwright's download, set `SPAGHETTI_BROWSER=/path/to/chromium`.

Decisions and plans: [docs/decisions/](docs/decisions/README.md) and [docs/roadmap.md](docs/roadmap.md). For agents working in the repository, start with [AGENTS.md](AGENTS.md).

## Photos and deleting

Photos are resized in the browser (a 2048 px and a 600 px variant, WebP or JPEG, re-encoded so no EXIF location leaves the phone) and stored in R2 as `photos/<id>/large` and `photos/<id>/thumb`. The Worker serves them to signed-in people only, with year-long immutable caching. Captures wait in the browser's IndexedDB until the server has them, so closing the tab mid-upload loses nothing.

Deleting an idea or a photo only marks it deleted, so Undo is a restore. A daily cron trigger (04:00 UTC, `triggers` in `wrangler.jsonc`) removes what was deleted more than 30 days ago, R2 objects first. Cron triggers only fire on Cloudflare: locally and in the container, deleted things stay in the database until it is deployed (or until you run the purge yourself with `wrangler dev --test-scheduled` and a request to `/__scheduled`).

## Search and backups

Search uses SQLite's FTS5 full-text index in D1 (`migrations/0003_search.sql`): one index over ideas, builds and print attempts (their notes, failure tags, success notes, filaments and settings), kept up to date by triggers, with prefix matching as you type. It works the same locally, in the container and on Cloudflare.

One limit: `wrangler d1 export` refuses a database with a virtual table such as this one ("cannot export databases with Virtual Tables (fts5)"). Back up with the script instead, which exports every ordinary table and appends the SQL that rebuilds the index:

```sh
pnpm db:export                      # local database → spaghetti-<date>.sql
pnpm db:export --remote             # the deployed one
pnpm exec wrangler d1 execute DB --remote --file spaghetti-2026-11-09.sql   # restore into an empty database
```

In the container, back up the `/data` volume as before.

## Run it in a container

The image builds the app and runs it on workerd with `wrangler dev` in local mode; D1 and R2 state persist in the `/data` volume. No Cloudflare account is needed.

```sh
docker build -t spaghetti .
docker run -d --name spaghetti -p 8787:8787 -v spaghetti-data:/data spaghetti
docker exec -it spaghetti node scripts/user-add.ts    # once for each person
```

Or with Compose: `docker compose up -d`, then `docker compose exec app node scripts/user-add.ts`. Open http://localhost:8787. Back up the app by backing up the volume.

Outside Docker, `pnpm build && pnpm start` does the same (state in `.wrangler/state`, or `SPAGHETTI_STATE_DIR`).

The session cookie is marked `Secure` only when the app is reached over https, so plain http on a home network works. Put it behind https (a reverse proxy or a tunnel) before exposing it beyond your network. On Cloudflare it is always https.

## Deploying to Cloudflare

Spaghetti is live at https://spaghetti.day. Deploy with `pnpm ship` (build, remote migrations, `wrangler deploy`; pnpm's own `deploy` is a different command). It needs `CLOUDFLARE_API_TOKEN`. Everything about the setup, rollback, backups and adding people is in [docs/deploy.md](docs/deploy.md).

To host your own copy, create a D1 database and an R2 bucket with `wrangler d1 create` and `wrangler r2 bucket create`, put the database id and your domain in `wrangler.jsonc`, then run `pnpm ship`.

## Project layout

See [AGENTS.md](AGENTS.md) for the code layout and how to add routes, endpoints, migrations and components.
