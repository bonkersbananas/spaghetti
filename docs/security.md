# Security

Spaghetti is private to two people. Nothing of the workspace (ideas, builds, photos, files, comments, names beyond the landing page's "M" and "CO") is meant for anyone who isn't signed in, and the repository is public, so nothing secret lives in it. This page says what is public on purpose, how a request proves who it is, what stays on a device, and how the rule is kept.

## What anyone can reach

The Worker answers seven kinds of address (`src/worker/index.ts`). Everything else is a static file of the build.

| Address | Public? | Why |
| --- | --- | --- |
| `/` | yes | The landing page for a browser with no session cookie, the app's empty shell for one with it (`home.ts`, [0035](decisions/0035-a-landing-page-at-the-root-for-visitors.md)). Neither holds data. |
| App routes (`/today`, `/builds/…`) | yes | The same empty shell (`spa.ts`). It asks `/api/session` first and shows sign-in on a 401. |
| Static files (`/assets/*`, icons, `/sw.js`, `/bridge/install.sh`) | yes | The build: code, styles, fonts, pictures. No data, names, emails or keys (checked by searching the build). |
| `/api/*` | **no**, except the list below | Needs a session cookie or an agent token (`requireAuth` in `app.ts`). |
| `/open/<signed link>/<name>` | yes, with a valid signature | Bambu Studio's own download of one file for ten minutes ([0058](decisions/0058-open-in-bambu-studio-by-a-signed-link.md)): HMAC-signed, one file, read-only; every failure is a 404. |
| `/s/<token>`, `/s/<token>/photos/<id>/<thumb\|large>`, `/s/<token>/files/<id>/<thumb\|toolpaths>` | yes, with a live link | A public link to one idea, build or twist ([0075](decisions/0075-a-public-link-shows-one-thing-read-only.md), its models and 3D view [0077](decisions/0077-a-shared-page-shows-the-models-and-their-3d-view.md)), below. |
| `/mcp` | **no** | A `POST` needs an agent token; `GET` and `DELETE` are a 405. |
| `/oauth/*`, `/.well-known/oauth-*` | yes | The OAuth protocol for MCP clients (below). |
| `POST /api/share` | yes | The share target's fallback when no service worker took it: it only redirects to `/share` with the words. |

The `/api` routes that answer without credentials, each on purpose (the list in `test/worker/auth-guard.test.ts`):

- `GET /api/health`: `{ ok: true }`.
- Signing in: `POST /api/session` (password), `POST /api/session/passkey/options` and `POST /api/session/passkey`, `POST /api/session/link` (a link or code made on a signed-in device). `DELETE /api/session` signs out.
- Joining by invite: `POST /api/join/peek`, `/api/join/options`, `/api/join`, each only with the invite's token.
- `POST /api/bridge/pair`: the printer bridge trades a pairing code for its token.

## Public links

The one way anything of the workspace reaches someone who isn't signed in, on purpose and one thing at a time ([0075](decisions/0075-a-public-link-shows-one-thing-read-only.md)):

- **Made by people only.** `/api/shares` (make, list, stop, bring back) is person-only: no agent scope reaches it, and its changes are private to the people's own feed (never an agent's or a webhook). Nothing is shared by default.
- **A capability.** The token is 144 random bits; links are looked up by its SHA-256 (`worker/shares.ts`), a malformed one without any lookup. One live link per thing. Stopping it (`revoked_at`) or deleting the thing ends it on the next request; an unknown, stopped or deleted link all get the same 404 page.
- **One thing, read-only.** `worker/guest/` answers GET and HEAD only (anything else is a 405) and writes nothing. The page is built field by field from an allow-list (`guest/view.ts`): no people, comments, reactions, Up next, wishlists, "for", Claude's words, files to download or other things. Files show as their cards (`guestFile`: what the print takes, the size, who sliced it, the settings in words, cautions), never their bytes. The token opens nothing under `/api` (it isn't a session or an agent token).
- **Photos.** Only the photos its page shows (`photoIdsOf` in `guest/view.ts`: the thing's own live photos, not a deleted attempt's, an idea's without its attempts', a twist only its lead photo), with its EXIF, XMP, IPTC and comments stripped before serving (`stripPhotoMetadata` in `shared/photo-metadata.ts`, which rewrites the container, not the pixels), and withheld only if it can't be read or `hasPhotoMetadata` still finds some in the copy; Safari's canvas JPEGs carry an Exif block, so a resized photo isn't assumed clean. A photo stored as it came (`needs_resize`, from an agent or the bridge) may hold a GPS position, so it is neither listed nor served. Link-preview covers (`/og/`) are stripped the same way. `Cache-Control: private, max-age=300`: no shared cache keeps one past its link.
- **Files: the 3D view gets toolpaths, not files** ([0077](decisions/0077-a-shared-page-shows-the-models-and-their-3d-view.md)). Only the files whose cards the page shows (`fileIdsOf`), checked again as that thing's own live file (an idea's or build's, a live attempt's of it, the twist's model) on a live thing. `/s/<token>/files/<id>/thumb` is the plate's picture, its text chunks stripped like a photo's metadata (`stripPhotoMetadata` reads PNGs too). `/s/<token>/files/<id>/toolpaths` is a zip of its own, copied by range from the stored `.gcode.3mf` (`guest/toolpaths.ts`): the plate's G-code and the two configs the viewer reads, never the model's mesh, another plate, the original or the sliced file itself; it refuses navigations, downloads and other sites (`Sec-Fetch-*`) with the same 404, and has no `Content-Disposition`. No other part of a file (`file`, `sliced`, `previous`, `original-thumb`) is reachable. Both are `private, max-age=300`.
- **What agents write shows there too.** An agent's token can't make, see or stop a link, but what it may write can appear on a page that is already shared, or is shared later: an idea's or build's title and note (`capture`, `attempts`), an attempt's note, settings and tags and a new tag's label (`attempts`), a twist's name, note, changes, source and recipe (`capture`), a recipe's name, note and settings (`attempts`), and photos (shown only once a browser has resized them). That is the same allow-list and the same escaping as for the people's own words; what an agent writes is no more private than the thing it writes into.
- **It shows the thing as it is now.** A link made while something was an idea keeps working once it becomes a build, and then shows its attempts, notes and settings: the link is to the thing, not to how it looked that day. Stopping it is the way to stop that.
- **The page.** hono/jsx escapes every text and attribute; only http(s) addresses become links (`rel="noopener noreferrer nofollow ugc"`). Headers: `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src <origin>/assets/guest/; worker-src <origin>/assets/guest/; connect-src <origin>/s/<token>/files/; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` (script only from the page's own build, `scripts/vite-guest.ts`: one small script that opens a plate's 3D view, and the viewer it loads on a tap; nothing inline; inline styles carry a photo's placeholder colour and a filament's swatch, both checked as `#rrggbb`, and the viewer's own few; `vite dev` gets a looser policy for its unbundled modules, only when the template is the dev server's), `X-Robots-Tag: noindex, nofollow, noarchive, noimageindex`, `Referrer-Policy: no-referrer` (so the token never leaves in a Referer), `X-Frame-Options: DENY`, `Cache-Control: private, no-store`. Someone signed in (a session checked in D1, not just the cookie's presence) is sent to the thing's page in the app.
- **Tested** in `test/worker/shares.test.ts` and `test/worker/share-files.test.ts` (another thing's file, a deleted file and attempt, a stopped link, every other part of a file, navigations, the token against `/api/files`, the policy, file names and settings words as HTML) and `test/unit/guest-toolpaths.test.ts` (the toolpaths read as the whole file does, without the mesh): another thing's photo through a valid token, a photo of the thing its page doesn't show (photos are served only when the page lists them, `photoIdsOf`), stopped and deleted links, every other method, the token against `/api`, agent tokens, photos with EXIF or stored as they came, and HTML, quote and `javascript:` payloads in every field a person or a model page writes (titles, notes, attempt notes and tags, twist words, the draft's model title, designer and licence), the preview tags included.

## How a request proves who it is

- **A person** has a session cookie, `spaghetti_session`: 32 random bytes, `HttpOnly`, `Secure` on https, `SameSite=Lax`, 400 days, renewed once a day of use (`auth/session.ts`). Only its SHA-256 is stored. Signing out deletes the row, so the cookie is dead even if it was copied; changing the password ends the person's other sessions, and Account → Devices ends any one.
- **An agent** sends `Authorization: Bearer spg_…` (`auth/agent.ts`). Only the token's SHA-256 and prefix are stored; a revoke or an expiry counts on the next request. With an `Authorization` header only the token counts: a bad one is a 401, never retried as the cookie.
- **Scopes** (`auth/scopes.ts`): a token reaches only what its scopes name (an MCP tool checks the token's scopes before it runs, as well as through the API it calls); a route not in the table is for people only, so a new route is closed to tokens by default. Tokens never reach the session, the account, agents, OAuth, webhooks, link previews, push or the bin, and never delete. `test/worker/agents.test.ts` covers the table.
- **CSRF**: writes that a browser could send cross-site (forms, `text/plain`, no content type) must come from the app's own origin (Hono's `csrf()`); JSON needs a CORS preflight, which `/api` never grants; and the cookie is `SameSite=Lax`. Requests with a bearer token skip the check (a browser never adds one on its own).
- **Guessing**: a wrong password counts against the name (10 in 10 minutes) and the address (30); passkeys, sign-in links, invites and pairing codes have their own limits per address, and the short typed codes (sign-in, pairing) have one shared limit too, so they can't be worked through from many addresses. Every count is taken in one statement, so parallel guesses can't slip under it. Passwords are PBKDF2-SHA256 at 100,000 rounds (the most Workers allow), compared in constant time; an unknown name, and a person with a passkey only, take as long as a wrong password.
- **OAuth for MCP** (`oauth/`, [0029](decisions/0029-oauth-small-and-on-d1.md)): authorization code with PKCE S256 only; the redirect address must be one the client registered, exactly, and https, http on localhost or an app's own scheme (never `javascript:`, `data:` and the like). A code lives 5 minutes and is deleted as it is used; access tokens last an hour and refresh tokens rotate on every use. The consent screen is a page of the app, for a signed-in person, and like every page it can't be framed; it says where the app returns to, with the scheme when it is an app's own (`someapp://claude.ai`, which goes to whichever app claims the scheme, not to that host). Registration is open but limited to 20 an hour per address, under a cap of 300 clients.

## Photos and files

Photos, profile pictures and slicer files are served by `/api/photos`, `/api/people/:id/photo` and `/api/files`, behind the same check as the rest of `/api`; their ids are random UUIDs. The app reaches the R2 bucket only through the Worker's binding, and it must have no public access: no r2.dev address and no custom domain (Cloudflare dashboard, R2 → spaghetti-photos → Settings; the deploy token can't read that setting; Carl Oscar checked it on 12 November 2026, see the second pass below). Even then, an object's key holds its random id. Uploads are stored only as JPEG or WebP (plate pictures PNG too), and slicer files are served as downloads (`Content-Disposition: attachment`), so nothing uploaded can run as a page of the app. Item photos, spool labels and upkeep photos share one key space (`photos/<id>/…`) with an id the browser picks, so an upload under an id that is already another picture's is refused (409, `photoOwner` in `photos.ts`): nothing can overwrite or, by replacing it later, delete a picture that isn't its own. A file over 32 MB is sent first through `/api/uploads` (R2 multipart, [0048](decisions/0048-big-files-go-in-parts.md)): the same sign-in or token scopes as the file routes (`capture` or `attempts`; a model's sliced file is for people only), keys only of the form `files/<uuid>/file` or `/sliced`, parts of at most 32 MiB and at most 8 of them, and nothing is served until its row is saved with the object in the bucket at the size it says.

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
| The Worker fetching URLs: link previews, drafts, webhooks, MCP photos, push | Link previews, drafts and webhooks held (public names only, every redirect re-checked). **Fixed (#142):** the `photo_url` of `capture_idea`, `add_photo`, `log_attempt` and `finish_attempt` follows the same rules, so it never reaches a home network from the container. |
| R2 keys | No path tricks reach another prefix. **Fixed (#143):** item photos, spool labels and upkeep log photos share one key space with ids the browser picks. An upload under an id that is another picture's is now refused, where before it overwrote that picture. |
| The R2 bucket's public access | Held. Carl Oscar checked in the Cloudflare dashboard on 12 November 2026 that `spaghetti-photos` has no public access (no r2.dev address, no custom domain). The deploy token can't read that setting, so a person must check again if the bucket's settings change. |
| An ended session's leftovers on a device | **Fixed (#144):** a session ended elsewhere now also empties the browser's HTTP cache of photos, as signing out does. |
| OAuth registration | **Fixed (#145):** at most 20 registrations per address an hour, so no single caller can fill the 300-client cap. |

Still open, for a person:

- **A refresh token used twice** fails, but nothing revokes the tokens already made from it. This is the usual OAuth 2.1 advice for public clients. Connections can still be ended on the Agents page.
- **Push subscription addresses** are only checked for https. Only a signed-in person can add one, so it matters only in the container on a home network.
