# Security

Spaghetti is private to two people. Nothing of the workspace (ideas, builds, photos, files, comments, names beyond the landing page's "M" and "CO") is meant for anyone who isn't signed in, and the repository is public, so nothing secret lives in it. This page says what is public on purpose, how a request proves who it is, what stays on a device, and how the rule is kept.

## What anyone can reach

The Worker answers five kinds of address (`src/worker/index.ts`). Everything else is a static file of the build.

| Address | Public? | Why |
| --- | --- | --- |
| `/` | yes | The landing page for a browser with no session cookie, the app's empty shell for one with it (`home.ts`, [0035](decisions/0035-a-landing-page-at-the-root-for-visitors.md)). Neither holds data. |
| App routes (`/today`, `/builds/…`) | yes | The same empty shell (`spa.ts`). It asks `/api/session` first and shows sign-in on a 401. |
| Static files (`/assets/*`, icons, `/sw.js`, `/bridge/install.sh`) | yes | The build: code, styles, fonts, pictures. No data, names, emails or keys (checked by searching the build). |
| `/api/*` | **no**, except the list below | Needs a session cookie or an agent token (`requireAuth` in `app.ts`). |
| `/mcp` | **no** | A `POST` needs an agent token; `GET` and `DELETE` are a 405. |
| `/oauth/*`, `/.well-known/oauth-*` | yes | The OAuth protocol for MCP clients (below). |
| `POST /api/share` | yes | The share target's fallback when no service worker took it: it only redirects to `/share` with the words. |

The `/api` routes that answer without credentials, each on purpose (the list in `test/worker/auth-guard.test.ts`):

- `GET /api/health`: `{ ok: true }`.
- Signing in: `POST /api/session` (password), `POST /api/session/passkey/options` and `POST /api/session/passkey`, `POST /api/session/link` (a link or code made on a signed-in device). `DELETE /api/session` signs out.
- Joining by invite: `POST /api/join/peek`, `/api/join/options`, `/api/join`, each only with the invite's token.
- `POST /api/bridge/pair`: the printer bridge trades a pairing code for its token.

## How a request proves who it is

- **A person** has a session cookie, `spaghetti_session`: 32 random bytes, `HttpOnly`, `Secure` on https, `SameSite=Lax`, 400 days, renewed once a day of use (`auth/session.ts`). Only its SHA-256 is stored. Signing out deletes the row, so the cookie is dead even if it was copied; changing the password ends the person's other sessions, and Account → Devices ends any one.
- **An agent** sends `Authorization: Bearer spg_…` (`auth/agent.ts`). Only the token's SHA-256 and prefix are stored; a revoke or an expiry counts on the next request. With an `Authorization` header only the token counts: a bad one is a 401, never retried as the cookie.
- **Scopes** (`auth/scopes.ts`): a token reaches only what its scopes name (an MCP tool checks the token's scopes before it runs, as well as through the API it calls); a route not in the table is for people only, so a new route is closed to tokens by default. Tokens never reach the session, the account, agents, OAuth, webhooks, link previews, push or the bin, and never delete. `test/worker/agents.test.ts` covers the table.
- **CSRF**: writes that a browser could send cross-site (forms, `text/plain`, no content type) must come from the app's own origin (Hono's `csrf()`); JSON needs a CORS preflight, which `/api` never grants; and the cookie is `SameSite=Lax`. Requests with a bearer token skip the check (a browser never adds one on its own).
- **Guessing**: a wrong password counts against the name (10 in 10 minutes) and the address (30); passkeys, sign-in links, invites and pairing codes have their own limits per address, and the short typed codes (sign-in, pairing) have one shared limit too, so they can't be worked through from many addresses. Every count is taken in one statement, so parallel guesses can't slip under it. Passwords are PBKDF2-SHA256 at 100,000 rounds (the most Workers allow), compared in constant time; an unknown name, and a person with a passkey only, take as long as a wrong password.
- **OAuth for MCP** (`oauth/`, [0029](decisions/0029-oauth-small-and-on-d1.md)): authorization code with PKCE S256 only; the redirect address must be one the client registered, exactly, and https, http on localhost or an app's own scheme (never `javascript:`, `data:` and the like). A code lives 5 minutes and is deleted as it is used; access tokens last an hour and refresh tokens rotate on every use. The consent screen is a page of the app, for a signed-in person, and like every page it can't be framed; it says where the app returns to, with the scheme when it is an app's own (`someapp://claude.ai`, which goes to whichever app claims the scheme, not to that host). Registration is open but limited to 20 an hour per address, under a cap of 300 clients.

## Photos and files

Photos, profile pictures and slicer files are served by `/api/photos`, `/api/people/:id/photo` and `/api/files`, behind the same check as the rest of `/api`; their ids are random UUIDs. The app reaches the R2 bucket only through the Worker's binding, and it must have no public access: no r2.dev address and no custom domain (Cloudflare dashboard, R2 → spaghetti-photos → Settings; the deploy token can't read that setting; Carl Oscar checked it on 12 November 2026, see the second pass below). Even then, an object's key holds its random id. Uploads are stored only as JPEG or WebP (plate pictures PNG too), and slicer files are served as downloads (`Content-Disposition: attachment`), so nothing uploaded can run as a page of the app. Item photos, spool labels and upkeep photos share one key space (`photos/<id>/…`) with an id the browser picks, so an upload under an id that is already another picture's is refused (409, `photoOwner` in `photos.ts`): nothing can overwrite or, by replacing it later, delete a picture that isn't its own.

## On a shared device

What the app keeps on a device for offline use is forgotten when someone signs out, and also when the app finds its session was ended elsewhere (Account → Devices on another device, or a changed password) (`clearOfflineData` in `lib/offline.ts`):

- the offline copy of the query cache (IndexedDB `spaghetti-cache`, which is also tied to the person who saved it),
- the service worker's photo cache (`sg-photos`) and a share on its way (`sg-share`),
- the palette's recent items and searches (localStorage),
- the browser's own HTTP cache for the site: the sign-out answer carries `Clear-Site-Data: "cache"` (photos are otherwise kept a year). A session ended elsewhere asks for that answer too (`forgetEndedSession` in `lib/use-sign-out.ts`), since only the server can empty that cache.

Work not yet sent stays: the outbox (captures and attempts made offline) and text being typed in the capture sheet or a comment. It is sent by whoever signs in next on that browser, which in a workspace of two is the point of keeping it.

## Headers

- Every page the Worker answers (`page-headers.ts`): `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'; object-src 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and HSTS.
- `/api`: Hono's `secureHeaders()` (HSTS, `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, COOP and CORP same-origin) and `Cache-Control: no-store`, except photos and files, which are `private`.
- There is no `script-src` policy yet: the app has one inline script (the theme, in `index.html`), and a policy would need its hash kept in step with the build. React escapes everything it shows and links are http(s) only, so it would be a second line, not the first. It is the next thing to add if the app ever renders HTML it didn't write.

## Secrets

Production secrets (`VAPID_PRIVATE_KEY`, `WEBHOOK_SECRET_KEY`, `ANTHROPIC_API_KEY`) are Worker secrets, set with `wrangler secret put` (docs/deploy.md), never in `wrangler.jsonc`, `.dev.vars` (ignored by git) or the client. The values in `vitest.config.ts` and the seed's password are throwaway ones made for the tests. Webhook secrets are stored encrypted under `WEBHOOK_SECRET_KEY`.

## Keeping it true

`test/worker/auth-guard.test.ts` walks the Worker's own routers (`app.routes`, the MCP and OAuth routers) and calls every route that isn't on its public list with no credentials, with a session that was signed out, with a revoked token and with something that isn't a token: each must answer 401 or 403. A new route is covered the day it is added; making one public means adding it to the list with its reason, and to this page. The test also fails for a public entry whose route is gone.

## The pass of November 2026

What was checked, and what came of it:

- Every route above, against the code and (read-only, signed out) against spaghetti.day: all of `/api` but the public list answers 401, `/mcp` 401/405, photos and files 401. The bucket's public-access setting couldn't be read from here (see Photos and files).
- Sessions, tokens, scopes, CSRF, rate limits, password hashing and comparison, OAuth (redirects, PKCE, one-use codes, rotation, expiry, the consent screen): sound. A person with a passkey only answered a wrong password faster than anyone else, which said whose account had a password: fixed.
- Pages: only `/authorize` couldn't be framed; now none can, and they carry the headers above.
- Devices: sign-out left the browser's HTTP cache of photos, a pending share and the recent items and searches, and a session ended elsewhere left everything until the next write: fixed as above.
- The build and the git history: no keys, tokens or emails (the only key-shaped values are the tests' throwaway ones). `pnpm audit`: one advisory, in esbuild under drizzle-kit, a development tool that never runs in the Worker or the browser.
- Accepted as they are: sessions last 400 idle days (a phone by the printer stays signed in); ten wrong passwords lock a name's password sign-in for ten minutes (passkeys and sign-in links still work); anyone may register an OAuth client (capped at 300 and at 20 an hour per address, unused ones go after a day), and the consent screen names the app and where it returns to.

## The second pass, November 2026

An independent pass that started from the code rather than from the first pass's findings. It looked for ways in that a route-walking guard can't see: requests that reach data without a matching route, and what the public routes, tokens and caches give away.

| What was tried | What came of it |
| --- | --- |
| Routes the router doesn't list: `/` and `/?shell` (`home.ts`), app routes and missing files (`spa.ts`), the assets binding, the service worker's caches | Held. They serve the empty shell, the landing page or static files. The build holds no data or keys, and `wrangler.json` and `.dev.vars` are left out of the uploaded assets (`.assetsignore`, checked live). |
| Methods and path tricks: HEAD, OPTIONS, method override, `/API`, `%61pi`, `%2F`, `//api`, `/api//x`, trailing slashes, dots, `;`, NUL | Held. Anything outside `/api` gets the empty shell or a 404, and everything inside it goes through `requireAuth` (401). Tokens' person-only reads hold under encoded paths because the scope check and the router read the same decoded path. |
| The public list: health, sign-in, invites, bridge pairing, share fallback, OAuth metadata, register, token, revoke | Held: no data without the secret each one needs. Two changes: an app's own scheme is now shown on the consent screen, and registration is limited per address (below). |
| CORS, cookies, `www`, session fixation, open redirects | Held. There is no CORS on `/api` (preflights are a 401), and the cookie is host-only. `www.` and `http://` redirect at Cloudflare before the Worker. Sessions are always made by the server. The sign-in `redirect` only goes to paths on this site, and the router turns `//` and `/\` into a path too. |
| Tokens in URLs and logs | Held. Sign-in links and invites carry their secret after `#`, and no log prints a token, cookie or secret. |
| Tokens against scopes: the REST API, the change feed, OpenAPI, MCP tools | **Fixed (#142):** an MCP tool now checks the token's scopes before it runs. Before, `capture_idea` fetched its `photo_url` even for a token the API would then refuse. |
| The Worker fetching URLs: link previews, drafts, webhooks, MCP photos, push | Link previews, drafts and webhooks held (public names only, every redirect re-checked). **Fixed (#142):** `capture_idea`'s `photo_url` now follows the same rules, so it never reaches a home network from the container. |
| R2 keys | No path tricks reach another prefix. **Fixed (#143):** item photos, spool labels and upkeep log photos share one key space with ids the browser picks. An upload under an id that is another picture's is now refused, where before it overwrote that picture. |
| The R2 bucket's public access | Held. Carl Oscar checked in the Cloudflare dashboard on 12 November 2026 that `spaghetti-photos` has no public access (no r2.dev address, no custom domain). The deploy token can't read that setting, so a person must check again if the bucket's settings change. |
| An ended session's leftovers on a device | **Fixed (#144):** a session ended elsewhere now also empties the browser's HTTP cache of photos, as signing out does. |
| OAuth registration | **Fixed (#145):** at most 20 registrations per address an hour, so no single caller can fill the 300-client cap. |

Still open, for a person:

- **A refresh token used twice** fails, but nothing revokes the tokens already made from it. This is the usual OAuth 2.1 advice for public clients. Connections can still be ended on the Agents page.
- **Push subscription addresses** are only checked for https. Only a signed-in person can add one, so it matters only in the container on a home network.
