# Deploying

Spaghetti is live at **https://spaghetti.day**. This page says what exists there, how it was set up, and how to deploy, roll back, back up and add people. Deploys are run by hand from a session, never from CI ([decision 0011](decisions/0011-no-ci-deploys.md)).

## What exists

| What | Name | Notes |
| --- | --- | --- |
| Worker | `spaghetti` | Hono API plus the built React app as static assets, the daily cron (04:00 UTC) and observability, all from `wrangler.jsonc` |
| D1 database | `spaghetti` | binding `DB`; its id is in `wrangler.jsonc` |
| R2 bucket | `spaghetti-photos` | binding `PHOTOS`: photos and slicer files |
| Custom domain | `spaghetti.day` | the Worker's only way in: `workers_dev` and `preview_urls` are off |
| `www.spaghetti.day` | | a proxied placeholder DNS record and a redirect rule: 301 to the apex, path and query kept |
| workers.dev subdomain | `spaghetti-bb4` | the account has one, because Cloudflare refuses to register a cron trigger without it. Spaghetti's own workers.dev and preview URLs stay off, and the account has no other Workers that it could expose |
| Zone settings | | Always Use HTTPS on, minimum TLS 1.2 |

`wrangler.jsonc` keeps a `preview_database_id` that is the old all-zero placeholder. Local development, the e2e servers and the container key their local database by it, so their state didn't move when the real `database_id` went in. Nothing remote uses it.

The session cookie is `Secure` whenever the request is https, which is the case on the domain. The API's CSRF check compares the `Origin` header with the request's own origin, so `https://spaghetti.day` is accepted and other sites are not.

## The API token

Deploys use `CLOUDFLARE_API_TOKEN` (fctl's project secret). It is deliberately narrow: Workers Scripts Write, D1 Write and Account Settings Read on the account, and Workers Routes Write on the spaghetti.day zone only. It was made as an account-owned token and checked with `pnpm ship`, remote migrations, `pnpm db:export --remote` and `pnpm user:add --check --remote`; no R2 permission and no `CLOUDFLARE_ACCOUNT_ID` were needed (wrangler finds the one account). If a deploy ever asks for more, add that permission rather than using a broad token.

One-time setup (the bucket, the domain's `www` record and redirect rule, the zone settings) was done with a broader token. Changing those again needs one too.

## Routine deploys

```sh
pnpm ship
```

(pnpm has its own `deploy` command, as it has `doctor`, so ours is `ship`. It is `scripts/ship.ts`.) It runs `pnpm build`, applies the remote migrations (`wrangler d1 migrations apply DB --remote`) and then `wrangler deploy`. Migrations go first, so a schema change must keep the running version working (add, don't rename or drop in one step).

Check a deploy with `curl https://spaghetti.day/api/health`, which answers `{"ok":true}`.

## Rolling back

- The code: `pnpm exec wrangler rollback` returns to the previous version (`pnpm exec wrangler deployments list` shows them). It doesn't touch the database.
- The data: D1 Time Travel restores the database to any minute of the last 30 days: `pnpm exec wrangler d1 time-travel info DB`, then `pnpm exec wrangler d1 time-travel restore DB --timestamp=<unix time>`. That replaces the live data, so take a backup first.

## Backups

```sh
pnpm db:export --remote --output backup.sql
```

This exports every table and the search index's own SQL (see `scripts/db-export.ts`). Restore into an empty D1 with `wrangler d1 execute DB --file backup.sql`. Photos live in R2 and aren't in the export.

## Adding or resetting a person

Passwords come from an environment variable, never from the command line. Running the command again for an existing username changes their name, color and password and signs them out everywhere, which is how a forgotten password is reset. People change their own in the app (account menu → Change password).

```sh
SPAGHETTI_PASSWORD="$SPAGHETTI_PASSWORD_KALASPUFF" pnpm user:add --remote --username kalaspuff --name "Carl Oscar" --color tomato
SPAGHETTI_PASSWORD="$SPAGHETTI_PASSWORD_XIXA" pnpm user:add --remote --username xixa --name Marie --color sea
```

`pnpm user:add --check --remote` writes nothing and only proves the token can reach the database.

## Push notifications

The "how did it go?" nudges ([0015](decisions/0015-web-push-nudges.md)) are Web Push signed with a VAPID key pair. The public half is `vars.VAPID_PUBLIC_KEY` in `wrangler.jsonc` (not secret); the private half is the `VAPID_PRIVATE_KEY` secret on the Worker, which `wrangler deploy` keeps. Without it the app works as before (subscribing still works, nothing is sent). To make or replace the pair (replacing it makes every device's subscription useless: people turn notifications on again):

```sh
pnpm vapid:generate --out /tmp/vapid.key        # writes the private key to the file (mode 600) and prints the public key
pnpm exec wrangler secret put VAPID_PRIVATE_KEY < /tmp/vapid.key && rm /tmp/vapid.key
# put the printed public key in wrangler.jsonc (vars.VAPID_PUBLIC_KEY), then `pnpm types` and `pnpm ship`
```

The script never prints the private key and refuses to overwrite a file. The deploy token can set secrets. For local development, `pnpm vapid:generate --dev-vars` appends a fresh pair (both lines) to `.dev.vars`, which is never committed; the dev server has no service worker, so a real subscription needs `pnpm build && pnpm start`, and a browser that can reach its push service (Chrome uses Google's).

The nudges run from a cron every 5 minutes (`*/5 * * * *`, next to the daily purge at 04:00 UTC): an open attempt that the bridge saw come off the bed, or whose slicer estimate plus ten minutes has passed. iPhone and iPad only get web push for an app added to the Home Screen (iOS 16.4 or later): the settings say so.

## Where agents and the bridge point

- MCP server: `https://spaghetti.day/mcp` ([mcp.md](mcp.md)).
- API base for tokens and the printer bridge (`BRIDGE_APP_URL`): `https://spaghetti.day` ([api.md](api.md), [bridge.md](bridge.md)). Make a token with `pnpm agent:add --remote ...` or in the app (Account menu, Agents).
