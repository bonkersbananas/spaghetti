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

**In the app (the usual way):** account menu → Invite someone makes a single-use link, good for a week; the new person opens it, picks a name, a username, a color and a passkey or a password, and is signed in ([0026](decisions/0026-passkeys-sign-in-links-and-invites.md)). Pending invites are listed there and can be withdrawn. Someone who can't sign in but still has a signed-in device makes "Sign in on another device" there (a QR code or a code, good for ten minutes).

**From a session (resets, or when nobody can sign in):** `pnpm user:add` keeps working. Passwords come from an environment variable, never from the command line. Running the command again for an existing username changes their name, color and password and signs them out everywhere, which is how a forgotten password is reset. People change their own in the app (account menu → Change password). A reset leaves their passkeys alone; remove those in the app (account menu → Passkeys) if a device is lost.

```sh
SPAGHETTI_PASSWORD="$SPAGHETTI_PASSWORD_KALASPUFF" pnpm user:add --remote --username kalaspuff --name "Carl Oscar" --color tomato
SPAGHETTI_PASSWORD="$SPAGHETTI_PASSWORD_XIXA" pnpm user:add --remote --username xixa --name Marie --color sea
```

`pnpm user:add --check --remote` writes nothing and only proves the token can reach the database.

## Passkeys

Passkeys are tied to the site they were made on: `vars.WEBAUTHN_RP_ID` (`spaghetti.day`) and `vars.WEBAUTHN_ORIGINS` in `wrangler.jsonc`. Don't change them after people have passkeys: every passkey stops working (passwords keep working, and new ones can be made). Locally (`pnpm dev`, `pnpm start`, the e2e tests) the relying party is `localhost`, so open the app as `http://localhost:…`, not `127.0.0.1`. No secrets are involved.

## Push notifications

The "how did it go?" nudges ([0016](decisions/0016-web-push-nudges.md)) are Web Push signed with a VAPID key pair. The public half is `vars.VAPID_PUBLIC_KEY` in `wrangler.jsonc` (not secret); the private half is the `VAPID_PRIVATE_KEY` secret on the Worker, which `wrangler deploy` keeps. Without it the app works as before (subscribing still works, nothing is sent). To make or replace the pair (replacing it makes every device's subscription useless: people turn notifications on again):

```sh
pnpm vapid:generate --out /tmp/vapid.key        # writes the private key to the file (mode 600) and prints the public key
pnpm exec wrangler secret put VAPID_PRIVATE_KEY < /tmp/vapid.key && rm /tmp/vapid.key
# put the printed public key in wrangler.jsonc (vars.VAPID_PUBLIC_KEY), then `pnpm types` and `pnpm ship`
```

The script never prints the private key and refuses to overwrite a file. The deploy token can set secrets. For local development, `pnpm vapid:generate --dev-vars` appends a fresh pair (both lines) to `.dev.vars`, which is never committed; the dev server has no service worker, so a real subscription needs `pnpm build && pnpm start`, and a browser that can reach its push service (Chrome uses Google's).

The nudges run from a cron every 5 minutes (`*/5 * * * *`, next to the daily purge at 04:00 UTC): an open attempt that the bridge saw come off the bed, or whose slicer estimate plus ten minutes has passed. iPhone and iPad only get web push for an app added to the Home Screen (iOS 16.4 or later): the settings say so.

## Webhooks

Webhooks ([0025](decisions/0025-webhooks-signed-from-the-cron.md)) keep their signing secrets encrypted under a key made from the `WEBHOOK_SECRET_KEY` secret, and from nothing else (not the VAPID key, so redoing push can never break them). Without it the Agents page says "Webhooks need a key on the server; see docs/deploy.md" and every `/api/webhooks` endpoint answers `503 webhooks_unavailable`. Set it once, before the first webhook is added; this generates and sets it without ever printing it, and `wrangler deploy` keeps it. Never change it afterwards (webhooks made under another key fail until they are added again):

```sh
openssl rand -base64 32 | pnpm exec wrangler secret put WEBHOOK_SECRET_KEY
```

A write that records a change also starts a delivery pass (`waitUntil`), and the 5-minute cron sends what that missed and the retries. The e2e tests and screenshots set `WEBHOOKS_ALLOW_LOCAL` (webhooks may then go to 127.0.0.1, where the stand-in receiver in `scripts/lib/fake-claude.ts` listens); never set it on a real Worker.

## Claude drafting ideas

Drafting an idea from a model page ([0019](decisions/0019-claude-drafts-ideas-from-model-pages.md)) uses the `ANTHROPIC_API_KEY` secret, already set on the live Worker (`pnpm exec wrangler secret put ANTHROPIC_API_KEY`; it is kept across `pnpm ship`). Without it the feature is hidden. Locally, put `ANTHROPIC_API_KEY=sk-ant-…` in `.dev.vars` (never committed). The e2e tests and screenshots don't need a key: they point `ANTHROPIC_BASE_URL` at a stand-in server (`scripts/lib/fake-claude.ts`). The 5-minute cron also finishes drafts whose request was lost.

The same key lets Claude suggest what to try after a failed print ([0027](decisions/0027-failure-coach-suggests-what-to-try-next.md)); every run is a row in `coach_runs`: `pnpm exec wrangler d1 execute spaghetti --remote --command "SELECT status, run_outcome, detail, created_at FROM coach_runs ORDER BY created_at DESC LIMIT 10"` says why an attempt got no ideas. The same key lets Claude suggest how a print went from its photo ([0023](decisions/0023-claude-reads-a-print-from-its-photo.md)). Every read is a row in `photo_reads`: `pnpm exec wrangler d1 execute spaghetti --remote --command "SELECT status, run_outcome, detail, created_at FROM photo_reads ORDER BY created_at DESC LIMIT 10"` says why a photo got no suggestion (`unsure`, `refusal`, `api_error` with its HTTP status in `detail`, `timeout`, `cap`, `too_large`).

And reading a spool's label ([0028](decisions/0028-claude-reads-a-spool-label-from-its-photo.md)) is a row in `label_reads`: `SELECT status, run_outcome, detail, created_at FROM label_reads ORDER BY created_at DESC LIMIT 10` says why a label filled nothing (`unreadable`, `refusal`, `api_error`, `timeout`, `cap`, `too_large`, `bad_shape`). Its cap is 20 a day, apart from the photo reads.

If a real link doesn't draft, read why from the runs (never the page's content or the key, only statuses and codes):

```sh
pnpm exec wrangler d1 execute spaghetti --remote --command \
  "SELECT datetime(at/1000,'unixepoch') AS at, item_id, outcome, detail FROM draft_runs ORDER BY at DESC LIMIT 10"
```

`outcome` is `drafted`, `refusal`, `not_readable` (Claude said the page wasn't a readable model page), `max_tokens` or another `stop:…`, `bad_json` or `bad_shape` (the answer didn't match the schema; `detail` names the fields), `timeout`, `api_error` or `exception`. `detail` is JSON: `source` (`worker_fetch`: the Worker read the page; `web_fetch`: Anthropic's tool did, because the Worker could not), `pageStatus` (the HTTP status of the Worker's own fetch; `null` = no answer; 403 on a Cloudflare challenge page), `pageUnreadable` (the Worker got a page with nothing in it to read), `httpStatus`, `errorType` and the SDK's `message` for an API error (401 is a wrong key, 404 a model the key can't use, 400 a request the API refused), `stopReason`, and `fetchErrors`, the web fetch tool's codes (`url_not_allowed`, `url_not_accessible`, `unsupported_content_type`, `too_many_requests` …). A draft that failed before calling Claude (the day's cap) has no run.

## Where agents and the bridge point

- MCP server: `https://spaghetti.day/mcp` ([mcp.md](mcp.md)).
- API base for tokens and the printer bridge (`BRIDGE_APP_URL`): `https://spaghetti.day` ([api.md](api.md), [bridge.md](bridge.md)). Make a token with `pnpm agent:add --remote ...` or in the app (Account menu, Agents).
