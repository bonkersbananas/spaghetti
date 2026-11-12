# The API, for agents

Everything the app does goes through `/api` (JSON, plus multipart for photos and slicer files). A browser uses its session cookie; anything else (an MCP server, the printer bridge) uses a **token** that acts as a named **agent**. Types live in `src/shared/api.ts`, `src/shared/agents.ts`, `src/shared/changes.ts` and `src/shared/webhooks.ts`. The whole API is also described as OpenAPI 3.1: see [The OpenAPI document](#the-openapi-document).

## Auth

```
Authorization: Bearer spg_…
```

- A token belongs to an agent, and an agent to one of the two people ("Claude for Alex", "Printer bridge"). Make them in the app (Account menu → Agents) or headless:

  ```sh
  pnpm agent:add --owner alex --name "Printer bridge" --scopes read,attempts,printer   # --remote for the deployed database
  ```

  The token is shown once. Only its SHA-256 hash and its first 8 characters (the prefix, for telling tokens apart) are stored. Never log or commit one.
- With an `Authorization` header only the token counts: an unknown, malformed or revoked one is `401 invalid_token`, never retried as a cookie. Revoking takes effect on the next request.
- A token never needs CSRF headers (cookies do; a bearer header can't be sent cross-site by a browser).
- Signed-out or no credentials: `401 signed_out`.
- A token can **never** sign in, read the session, list or change agents and tokens, use `GET /api/links/preview` (the Worker would fetch any public page for whoever asks), change a password (`PUT /api/account/password`), manage passkeys, sign-in links, invites or devices, or manage people. Those are for a signed-in person only (`403 person_only`). The same goes for deleting and restoring anything: agents create and change, people delete.
- `last_used` on a token moves at most every 5 minutes.
- Apps that sign in with OAuth ([mcp.md](mcp.md)) get tokens of the same kind (`spg_…`, scopes as approved) that last an hour, renewed with a refresh token; revoking is Disconnect on the Agents page (`DELETE /api/agents/:id/connection`, which also ends the refresh tokens). Their tokens are not listed: such an agent has `connection` instead of `tokens`, and `POST /api/agents/:id/tokens` refuses it (`400 connected_app`).

## Scopes

A token carries one or more of four scopes. A request outside them is `403 missing_scope`, and the message names the scope ("This token needs the "attempts" scope for that.").

| Scope | Allows |
| --- | --- |
| `read` | Every `GET`: items, builds, attempts, the journal, search and "what worked", the pantry, the printer, tags, people, photo and file bytes, and the change feed. |
| `capture` | `PUT /items/up-next/order`, `PATCH /items/:id` with `upNext` or `forWhom`, `POST /capture` (an idea from a link, text and photos in one call: see [share.md](share.md)), `POST /items` (an idea), `PATCH /items/:id` with `title` / `note`, `PUT /items/:id/photos/:photoId` (a photo that isn't of an attempt), `PUT /items/:id/photos/order`, `POST /items/:id/comments` and `PATCH /comments/:id` (your agent's own comments; see Comments)., `POST /twists` and `PATCH /twists/:id` (a twist, [0043](decisions/0043-twists-are-models-we-print-our-own-way.md)). |
| `attempts` | `POST /recipes` and `PATCH /recipes/:id` (name and note), `POST /items` with `stage: "building"` (a build from scratch), `POST /items/:id/attempts`, `PATCH /attempts/:id` (also `endedAt` and `suggestedFailureTag`, the printer bridge's; `settings` replaces the settings, `settingsMerge: { set, unset }` changes only those and keeps the rest, which is what the attempt sheet sends), `POST /attempts/:id/finish`, `PUT /attempts/:id/file`, photos with an `attemptId`, `PATCH /items/:id` with `stage` or `coverPhotoId`, `PUT /items/:id/parts`, `POST /tags`, `POST /items/:id/comments` and `PATCH /comments/:id` (as with `capture`). |
| `printer` | `POST /printer/upkeep`, `PATCH /printer/upkeep/:id`, `POST /printer/upkeep/:id/done`, `PUT /printer/upkeep/logs/:logId/photo/:photoId`, `PUT /printer/slots/:slot`, `PUT /printer`, `PUT /printer/bridge` (the printer bridge's heartbeat: progress, unknown trays, its version, system and problems), `POST /spools`, `PATCH /spools/:id`, `PUT /spools/:id/photo/:photoId`, `PUT /spools/:id/weight`, `POST /spools/:id/weighings`. |

The rules are one table, `src/worker/auth/scopes.ts`: any route not listed there is person-only, so a new endpoint is closed to tokens until it is given a scope. Routes that need to look at the body (a photo's `attemptId`, the fields of a `PATCH`) narrow it with `canUse` / `missingScope`. `test/worker/agents.test.ts` has a case per row.

## Who did it

An agent's writes are recorded as the **owner's** (`createdBy`, `finishedBy`: avatars and "captured by" work as they do) and name the agent with `createdVia` / `finishedVia` on items and attempts (and `via` on journal entries). The app shows that quietly as "via Claude for Alex", with the owner's avatar plus a small agent mark.

The change feed (`GET /api/changes?after=<cursor>`, see `src/shared/changes.ts`) records the actor as `{ "kind": "agent", "id": "<agent id>" }` for an agent and `{ "kind": "person", "id": "<user id>" }` for a person. Agent ids resolve to names through `GET /api/agents` (people only; every agent is listed, tokens only for their owner). Creating an agent and adding or revoking a token are `agent` changes, made by the person.

## Idempotent writes

The client picks ids (UUIDs) for items, attempts, photos and files, so any write can be retried safely: a repeat returns the same thing and records no second change. Photos are uploaded already resized (WebP or JPEG, large and thumb); see "Items and photos" in `AGENTS.md`.

## Filament in grams

**Pairing the printer bridge** (decision [0033](decisions/0033-mac-bridge-paired-by-code.md)): `POST /api/bridge/pairing` (a signed-in person only) makes a code like `ABCD-EFGH`, valid 10 minutes, single use, one live code per person (6 in ten minutes at most; only its hash is stored). `POST /api/bridge/pair` `{ code }` (no sign-in; rate limited per address and overall) trades it once for `{ token, agentId, appUrl, scopes }`: the "Printer bridge" agent's token with `read`, `attempts` and `printer`, ending the previous bridge token. `DELETE /api/printer/bridge` (people only) disconnects: its tokens end and the bridge's status is forgotten. Heartbeat fields `version`, `platform` and `problems` (`{ code, message }` with codes `local-network`, `unreachable`, `refused`, `wrong-access-code`, `silent`, `certificate`) show on the Printer page.

A spool can count itself down (decision [0009](decisions/0009-filament-tracked-in-grams.md)). Every spool response (`GET /spools`, `GET /spools/:id`, the writes below) carries `netGrams`, `tareGrams`, `gramsLeft` (null until the spool has gram data), `gramsApproximate` (a failed print was counted by a guess) and `weighedAt`. With gram data `remaining` is derived from the grams: a `remaining` sent in a `PATCH` (the printer bridge sends the AMS's on every sync) is ignored for such a spool and changes nothing. Without gram data `remaining` is the hand-set (or AMS) level, as before.

- `POST /spools` accepts `netGrams` (and `tareGrams`): a Bambu spool is 1000 g.
- `PUT /spools/:id/weight` with `{ "netGrams": 1000, "tareGrams": 250 }` sets what it held when new and the empty spool's weight; `null` clears them and drops the spool's weighings (back to a hand-set level). `printer` scope.
- `POST /spools/:id/weighings` with `{ "id": "<uuid>", "onScale": 812 }` (the empty spool's weight is taken off) or `{ "id", "gramsLeft": 562 }`, optionally `tareGrams` and `at`: a fresh baseline. Idempotent on `id`. `printer` scope. `DELETE /spools/:id/weighings/:weighingId` takes one back; it is person-only.
- `GET /spools/:id/usage` lists what used the spool (attempt, build, grams, whether the amount is a guess, whether it still counts) and its weighings.
- Usage is read off finished attempts, never stored: `settings.filaments[].grams` (from the slicer file) of each filament whose `spoolId` is the spool. Editing an attempt, or deleting and restoring it, changes the answer.

## People and profile pictures

`GET /people` lists the two people; each `person` (here and in `GET /session`) has `photoUrl`: `/api/people/<id>/photo?v=<version>` or `null` (initials). The address changes with every new picture, and the bytes are served `private, max-age=31536000, immutable`; `GET /people/:id/photo` needs `read` like any read. Agents and MCP see `photoUrl` and can fetch the picture, but never change it.

- `PUT /people/me/photo`: your own picture, people only (`403 person_only` for a token). Multipart with one `photo` file, WebP or JPEG (`415 unsupported` otherwise), at most 512 KB (`413 too_large`); the browser sends a 256 px square it cropped itself. Replaces the old one (its bytes are deleted) and answers `{ user }`. A `person` change in the feed lets the other person's screen refresh.
- `DELETE /people/me/photo`: back to initials, people only. Always `200 { user }`, also when there was none.

## Twists

A twist is a model we print our own way: where it came from, what we changed and the recipe to print it with (decision [0043](decisions/0043-twists-are-models-we-print-our-own-way.md)). `GET /twists` lists them newest first, `GET /twists/:id` reads one.

- `POST /twists` `{ id, name, note?, fromItemId?, sourceUrl?, sourceTitle?, designer?, license?, sourcePhotoId?, recipeId?, changes? }`: with `fromItemId` the idea's model link, title and cover photo fill in what the request leaves out. `changes` is a list of `{ id, kind, label, value, note }` (`kind` is `scale`, `tolerance`, `text`, `material`, `param` or `other`; at most 20). Idempotent on `id`. `capture` scope.
- `PATCH /twists/:id`: any of `name`, `note`, `sourceUrl`, `sourceTitle`, `designer`, `license`, `recipeId` and `changes` (which replaces the whole list). `capture` scope.
- `DELETE /twists/:id` and `POST /twists/:id/restore`: soft delete and its undo, people only.
- A twist carries `source` (`url`, `title`, `designer`, `license`, `place` such as "MakerWorld", and `photo` while the idea still has it) and `fromItemId` while the idea exists.

## Recipes

A recipe is the named settings of an attempt that worked (decision [0017](decisions/0017-recipes-are-frozen-attempts.md)). `GET /recipes` lists them newest first (`?material=PLA&finish=silk` narrows to what fits a spool: same material, and the same finish where both have one); `GET /search` also returns `recipes`, `GET /what-worked?item=&material=` returns the material's `recipes`.

- `POST /recipes` `{ id, name, note?, sourceAttemptId }` saves an attempt as a recipe: `404` if the attempt is gone, `422 not_worked` unless it worked, `422 no_material` unless it names a filament type. The settings are read from the attempt, never from the request. Idempotent on `id`. `attempts` scope.
- `PATCH /recipes/:id` `{ name?, note? }`: the only things that change. `attempts` scope.
- `DELETE /recipes/:id` and `POST /recipes/:id/restore`: soft delete and its undo, people only.
- A recipe carries `source` (`attemptId`, `itemId`, `title`, `number`, `photo`) while that attempt and its build exist, else `null`.

## The shopping list

Things to buy for the printer, shared by both people. A thing is `{ id, name, link, priceLink, picture, prices, pricesTriedAt, position, boughtAt, boughtBy, createdBy, createdVia, createdAt, updatedAt }`: `link` is the shop's page, `priceLink` its Prisjakt page, `name` may be empty when there is a link (the app shows the page's title), `boughtAt` is null while it is still to buy.

- `GET /shopping-items` (`read`): `{ shoppingItems }`, what's still to buy in its order (`position`, smallest first), then what was bought, the latest first.
- `POST /shopping-items` `{ id, name?, link?, priceLink? }` (`printer`): needs a name or a link; links must be http(s). It goes on top of the list. Idempotent on `id`; `409 deleted` for an id taken off the list, `422 too_many` past 300 things.
- `PATCH /shopping-items/:id` `{ name?, link?, priceLink?, bought? }` (`printer`): an empty string or `null` clears a link. `bought: true` ticks it off (now, by whoever asks; ticking again keeps the first), `bought: false` puts it back on top of the list.
- `PUT /shopping-items/order` `{ ids }` (`printer`): the named things that are still to buy trade the places they hold so they come in this order; anything not named (added since the list was read, say) keeps its own place, and unknown or bought ids are ignored. Answers the whole list.
- `DELETE /shopping-items/:id` and `POST /shopping-items/:id/restore`: soft delete and its undo, people only; purged 30 days after.
- `POST /shopping-items/:id/suggest` (`printer`; `404` without the Anthropic key): looks for its Prisjakt page again in a search engine's results (Claude's web search, 20 a day for the workspace). `suggestion` is `{ url, title }` to confirm and `suggestState` is `searching`, `found` or `none` (null: nobody looked); the suggestion is never used until someone sets `priceLink`. `POST /shopping-items/:id/suggestion/dismiss`: "not this one", not suggested again. A new thing with a name and no Prisjakt link is searched for once, in the background.
- `POST /shopping-items/:id/check-prices` (`printer`): reads its Prisjakt product page now; answers the thing. A check within the last 20 seconds stands. `GET /shopping-items/:id/picture`: its picture (people only).
- `picture` is `{ url, source: "prisjakt" | "shop" }` or null; `prices` is `{ checkedAt, lowest, highest, count, offers: [{ shop, price, inStock }] }` (kronor, up to three offers, in stock first) or null: what the linked Prisjakt product page said when it was read, never a promise. Adding or changing a link reads its page in the background; unbought things are read again at most once a day ([0041](decisions/0041-shopping-list-reads-the-prisjakt-pages-people-link.md)).
- Every write records a `shopping` change (no `itemId`).

## Comments

The short thread under an idea or build (decision [0024](decisions/0024-comments-read-state-and-push-batching.md)). A comment is `{ id, itemId, authorId, via, body, createdAt, editedAt }`: `authorId` is the person it counts as (an agent's comment is its owner's, with `via` the agent's id, shown as "via Claude for Alex"), `editedAt` is null until the text changes.

- `GET /items/:id/comments` (`read`): `{ comments, readAt }`, oldest first, deleted ones left out. `readAt` is how far the signed-in person has read (epoch ms, null if never); the other person's comments after it are the unread ones.
- `POST /items/:id/comments` `{ id, body }` (`capture` or `attempts`): `body` is trimmed, 1 to 2000 characters. Idempotent on `id` (a repeat returns the same comment). A person writing also counts as having read the thread; an agent doesn't. Records a `comment` change (`created`) for the item.
- `PATCH /comments/:id` `{ body }` (`capture` or `attempts`): only your own comment (`403 not_yours`), and for a token only one that agent wrote. An unchanged text isn't an edit.
- `DELETE /comments/:id` and `POST /comments/:id/restore`: soft delete and its undo, people only, your own comments only; purged 30 days after.
- `POST /items/:id/comments/read` and `GET /comments/unread` (`{ threads: [{ itemId, count, latestAt }] }`): the signed-in person's read state; people only.

A new comment also sends one web push to the other person, with a short wait so a burst is one push. Comments are not in search yet. `GET /builds/:id/story.md` ends with a "Comments" section.

## Parts and quantities

A build may be made of parts ("Hull half" ×2, "Deck" ×1); most builds have none. Parts come with the item (`item.parts`, in order: `{ id, itemId, name, quantity, position, photoId }`), and an attempt says what it printed with `attempt.parts`: `[{ partId, count }]`, the good pieces that came out (while the print is still printing, how many are on the plate; they count once it has an outcome). Worked and partly worked prints count their pieces; a spaghetti counts none unless counts are sent. A part's progress is the sum of its counts over the build's finished attempts (`shared/parts.ts`).

- `PUT /items/:id/parts` `{ parts: [{ id, name, quantity, photoId?, position? }] }` adds the parts listed and changes the ones that exist; the others are left alone. Idempotent on `id`, and it is the undo of a removal too. `attempts` scope. `photoId` is one of the build's photos.
- `POST /items/:id/move` `{ targetId, attemptId? }` (people only): an idea's photos (same order, after the target's own; capture times kept) and note (added after the target's or the attempt's note, never over it) move into a build or one of its attempts, and the idea is deleted. `409` for something that isn't an idea or a build, and `409 has_comments` for an idea with comments or reactions, which stay with it. `POST /items/:id/unmove` `{ targetId, attemptId?, photos: [{ id, position }], note }` is its undo: the idea, its note and photos come back and the added note comes off the target (unless edited since).
- `DELETE /items/:id/parts/:partId` removes a part (people only). Attempts keep their counts for it; they show nothing once the part is gone.
- `parts` is accepted on `POST /items/:id/attempts`, `PATCH /attempts/:id` (replaces the list) and `POST /attempts/:id/finish`. Without `parts`, an attempt that goes from printing to spaghetti has its counts set to 0; one that worked keeps what was on the plate.
- `GET /search` finds builds by part name, and each attempt hit has a `partsLabel` ("Hull half ×2, Deck"). `GET /builds/:id/story.md` has a Parts section and names parts on attempts.
- An attempt's slicer file keeps the object names of its plate (`file.objects`, sent as the `objects` JSON field of `PUT /attempts/:id/file`); the app offers them as parts.

## Insights

`GET /api/insights?year=2026&tz=-60` (read scope) is the year so far, computed from attempts and not stored: `{ insights: { year, prints, outcomes, months, byMaterial, byPlate, failures, longestBuilds, made, madeTotal } }`. `year` defaults to the current one and `tz` is the viewer's zone in minutes behind UTC (`Date.getTimezoneOffset()`), so a print late on New Year's Eve lands in their year. Each failure carries `fixes`: the changes (as phrases such as "a warmer bed") made right before an attempt of the same build that worked. `longestBuilds` (builds with three or more attempts this year) each carry a `photo` and the `outcomes` of their attempts, oldest first. `made` is the builds that had an attempt that worked this year, newest first, up to 36, each with its final photo (the cover if one was picked, else the newest picture of the attempt that worked); `madeTotal` counts them all. The logic is `src/shared/insights.ts`.

## The week

`GET /api/weeks/2026-11-09` (read scope; the Monday as `YYYY-MM-DD`, else `400 invalid`) is one week, Monday 00:00 to the next Monday 00:00 in the workspace's time zone (Europe/Stockholm), worked out from the notebook and not stored: `{ week: { monday, sunday, timeZone, start, end, current, prints: { total, worked, partly, spaghetti, printing }, made, onTheBed, buildsFinished, ideas, comments: { total, byPerson, threads }, grams, gramsApproximate, waiting, note, empty } }`. A print belongs to the week its attempt was printed in; deleted things are left out. `made` is the week's answered prints (an attempt id, its build, `attempt` number, `outcome`, `by` person id and its final `photo`), worked first; `onTheBed` the ones with no answer yet; `grams` is the filament the finished prints said they used (null when none did). `waiting` (Up next, builds whose last print was spaghetti, spools running low, upkeep due) is there for the current week only. `note` is the paragraph Claude wrote for the week, `{ status: "done", text }`, or `{ status: "thinking", text: null }` while it is being written, else null: only for a week that is over (or on Sunday evening), once, and never without the key. Asking for such a week with no paragraph yet makes one after the response. The MCP tool is `get_week`. The logic is `src/shared/week.ts` and `src/worker/week/`.

## Up next and "for"

An idea can be queued as **Up next**: `upNext` on an item is its place in the queue (1 is first) or `null`. `PATCH /items/:id { "upNext": true }` puts it at the end, `false` or `null` takes it off, a number puts it at that place (the undo of taking it off). Only ideas are queued, and a stage change to a build takes the idea off the queue. `PUT /items/up-next/order { "ids": [...] }` sets the order (those first, in that order; queued ideas not listed follow) and answers with the queue. `forWhom` ("Mila", up to 80 characters, empty clears it) is optional and searchable. All of these are `capture` scope.


## Wishlists

Each person has a ranked wishlist of ideas, shared with the others who sign in unless it is private. `GET /wishlists` answers `{ wishlists: [{ personId, private, entries: [{ itemId, position, addedAt }] }] }`, yours first; someone else's private list has no entries. Only ideas show: one that was deleted or became a build is hidden and comes back in its place if that is undone. Changing a list is for people only, and only their own: `PUT /wishlists/me/items/:itemId` adds an idea at the end (`{ "position": 2 }` puts it at that place; adding it again changes nothing; 409 `not_an_idea` for a build, `full` past 50), `DELETE /wishlists/me/items/:itemId` takes it off, `PUT /wishlists/me/order { "ids": [...] }` sets the order (those first, the rest after in their turn), `PATCH /wishlists/me { "private": true }` keeps it to yourself. Each answers with your list. Every write records a `wishlist` change whose id is the owner's and whose `itemId` is null, so the feed never says what a list holds.

## Also here

- `GET /api/links/preview?url=…`: the title and site name of a link in a note (`{ url, title, site }`, the last two nullable), for the link cards. People only. https only, no IP addresses, `localhost`, one-word, `.local` or `.internal` hosts, credentials or ports; the name is resolved through Cloudflare's DNS-over-HTTPS first and refused if it points anywhere private; 3 seconds, 256 KB, `text/html`, three redirects at most with each hop checked the same way; only `og:title`, `<title>` and `og:site_name` are read. Cached in `link_previews` for 30 days, failures for one day.

- `GET /api/builds/:id/story.md`: a build's (or idea's) whole story as one markdown document, with `read`. Works for any item id.
- `/mcp`: the MCP server, with the same tokens or the OAuth flow Claude's apps use; see [mcp.md](mcp.md). OAuth's own endpoints (`/.well-known/oauth-*`, `/oauth/register`, `/oauth/token`, `/oauth/revoke`) are outside `/api` and described there; what is under `/api` is the consent screen's `GET /api/oauth/request` and `POST /api/oauth/decision` and `DELETE /api/agents/:id/connection` (disconnect an app), all person-only. It calls this API as the agent, so everything above applies to it.

## Changing your own password

`PUT /api/account/password` with `{ currentPassword, newPassword }` (person-only). The new password needs at least 10 characters and no other rule, and must differ from the current one. It signs out the person's **other** sessions and keeps the one making the request; the answer is `{ signedOut }`, how many devices that was. Errors: `400 too_short`, `400 same_password`, `403 wrong_password`, and `429 rate_limited` after five wrong current passwords in 15 minutes (counted per person in `password_failures`, cleared on success).

## Passkeys, sign-in links, invites and devices (people only)

Everything here is person-only: a token gets `403 person_only` on every route below, including the reads, and can never add a passkey, make a link or an invite, or see any of them ([0026](decisions/0026-passkeys-sign-in-links-and-invites.md)). Types are in `src/shared/signing-in.ts`. Their changes (`signin`, `invite`, `passkey` in the change feed) are the people's alone: `GET /api/changes` leaves them out for a token, and a webhook never sends them, even for "everything". Secrets are single-use, only their SHA-256 is stored, and they are shown once, in the response that makes them. Ceremonies use `@simplewebauthn`'s JSON: `{ ceremonyId, options }` to start, and `{ ceremonyId, response }` to answer; a ceremony is good for five minutes and one answer.

Signed in (cookie):

- `GET /api/account/passkeys` → `{ passkeys: [{ id, name, createdAt, lastUsedAt, backedUp }] }`; `POST /api/account/passkeys/options` starts adding one (user verification required, discoverable) and `POST /api/account/passkeys` finishes it (`201`; `400 not_verified` for a wrong challenge, origin or relying party, `400 expired`, `409 exists`, `409 too_many` above 12). `PATCH /api/account/passkeys/:id { name }` renames, `DELETE` removes (your own only).
- `POST /api/account/sign-in-links` → `201 { id, url, code, createdAt, expiresAt, usedOn, usedAt }`: a link (`/link#spl_…`, the secret is in the fragment) and a code (`ABCD-EFGH`), valid ten minutes, once; it replaces the person's earlier unused link. `GET /api/account/sign-in-links/:id` says whether and where it was used (`usedOn`: "iPhone"), `DELETE` withdraws it. Using one records a `signin` change.
- `GET /api/account/invites` lists pending invites (anyone signed in sees all of them); `POST` makes one (`201 { id, url, … }`, `url` is `/join#spi_…`, valid seven days, at most 10 waiting); `DELETE /api/account/invites/:id` withdraws it.
- `GET /api/account/devices` lists your signed-in sessions (device from the user agent, `lastSeenAt`, `current`); `DELETE /api/account/devices/:id` signs one out (`400 current` for this one); `POST /api/account/devices/sign-out-others` → `{ signedOut }`.

Not signed in (rate limited; `429 rate_limited`):

- `POST /api/session/passkey/options`, then `POST /api/session/passkey { ceremonyId, response }`: signs in with a passkey (`401 wrong_credentials` for anything wrong, replayed, expired, from another origin or with a counter that went backwards).
- `POST /api/session/link { token }` or `{ code }`: signs in as the person who made the link (`410 link_gone` when used or expired).
- `POST /api/join/peek { token }` → `{ invitedBy, expiresAt }` (`410 invite_gone`); `POST /api/join/options { token, name, username, color }` starts a passkey for the new person; `POST /api/join { token, name, username, color, password | passkey: { ceremonyId, response } }` creates that one person, claims the invite and signs them in (`201`; `409 username_taken` leaves the invite usable, `400 too_short` for a password under 10 characters).

## Drafting an idea from a model page (people only)

Claude can read a MakerWorld, Printables or Thingiverse page and draft the idea from it ([decision 0019](decisions/0019-claude-drafts-ideas-from-model-pages.md)). It needs the Worker's `ANTHROPIC_API_KEY` secret (locally in `.dev.vars`); without it everything below answers `404` and the app shows nothing about it.

- `GET /api/features`: `{ drafts: boolean, photoReads: boolean, coach: boolean, labelReads: boolean, webhooks: boolean }`, whether the key is set (the first four follow the one secret).
- `POST /api/items/:id/draft` (optional body `{ url }`; else the first model link in the idea's note): makes the idea's draft job (`status: "reading"`) and, because the caller keeps the request open, does it before answering with `{ draft }`. `400` when there is no link on one of the three sites. Asking again after a failure retries; a draft that is reading or done is left as it is.
- `POST /api/items/:id/draft/pictures`: "Get the pictures" for a drafted idea without any (`{ draft, stored }`, `404` when there is nothing to do). The draft body may carry `sharedTitle`, the title that came with a share: the draft replaces it while the idea still has exactly that title.
- `DELETE /api/items/:id/draft`: undo. Takes back the title and note it wrote (only while they still say exactly that), its pictures, and the draft itself; `404` when there is none.
- Items carry `draft` (`null`, or `status` reading, drafted or failed, `failure` unreadable, refused, timeout or cap, `applied` which of title, note and photos it filled, its `title` and `note`, and `findings`: designer, license, material, plate, settings). A change to it is an `item` update in the change feed.
- The Worker fetches the page itself (the three sites only) and gives Claude its embedded data; Anthropic's web fetch tool is the fallback. See decision 0019.
- It only fills empty fields: a title that is empty, a note that is only links, an idea without photos. Pictures come only from the three sites' image hosts (`src/shared/model-links.ts`), at most four, stored like an agent's photos (`needsResize`).
- People only: no scope lists these routes, so a token gets `403 person_only`. `POST /api/capture` starts a draft by itself when the capture is just a model link, for a person's session or a token whose only scope is `capture` (the sharing Shortcut), never for an agent that can do more.
- Every call is a row in `draft_runs` with its `outcome` and a `detail` (statuses and codes, no page content); how to read them is in [deploy.md](deploy.md). The page's title also goes into the link preview cache, so the note's link card shows it.
- Capped at 30 Claude calls a day for the whole workspace (UTC days, `draft_runs`); past it a draft fails with `failure: "cap"`.

## Reading a print from its photo (automatic)

When an attempt that has no outcome yet gets a photo (`PUT /api/items/:id/photos/:photoId` with an `attemptId`), Claude looks at the photo's large variant and *suggests* how it went ([decision 0023](decisions/0023-claude-reads-a-print-from-its-photo.md)). Nothing is called to start it: the upload does, after its response (`waitUntil`), and the 5-minute cron picks up a read that was lost. It needs `ANTHROPIC_API_KEY`; without it nothing happens and nothing shows.

- Attempts carry `photoRead`: `null`, or `{ status: "reading", photoId, … }` while Claude looks, or `{ status: "read", photoId, outcome, failureTags, successNotes, reason }` with the built-in tag slugs and one short sentence. It is only ever a suggestion: the attempt's own `outcome`, `failureTags`, `successNotes` and `note` are never written by it. A photo Claude can't tell from, a refusal and a failed call all leave `photoRead` `null` (or the suggestion of an earlier photo). A newer photo replaces the suggestion; the same photo is never read twice. A change to it is an `attempt` update in the change feed.
- Who starts it: a signed-in person, or a token with both the `attempts` and `printer` scopes (the printer bridge's camera frame). Any other agent's photo is not read.
- The bridge's frame is stored as the original in both variants (`needsResize`); it is read as it is when it is a JPEG or WebP of at most 4.8 MB and 8000 px a side (the API's limits), and not read otherwise.
- Every read is a row in `photo_reads` with its status, `run_outcome` (`read`, `unsure`, `refusal`, `api_error`, `timeout`, `cap`, `too_large`, …) and a `detail` (model, stop reason, status, how long it took); how to read them is in [deploy.md](deploy.md).
- Capped at 30 reads a day for the whole workspace (UTC days, rows with `ran_at`); past it the read is marked `cap` and nothing is suggested.

## Reading a spool's label from a photo (people only)

"Read the label" has Claude read the label in a spool's photo and fill in the spool ([decision 0031](decisions/0031-claude-reads-a-spool-label-from-its-photo.md)). Same key as above; without it everything answers `404`.

- `POST /api/spools/:id/label-read` (optional body `{ placeholders: ["material", "netGrams"] }`) reads the label in the spool's current photo (`400` without one). It answers at once with the spool, `labelRead: { status: "reading" }`; the call runs after the response and the spool changes through the change feed (a `spool` update). A photo is read once; a read that found nothing or failed is tried again by asking again. `placeholders` names the starting values the label may replace; every other field with a value is left alone.
- Spools carry `diameterMm`, `nozzleTempMin`/`nozzleTempMax`, `bedTempMin`/`bedTempMax`, `dryTempC`, `dryHours` and `productCode` (Bambu's RFID or product code as printed; not `trayUuid`), all settable with `POST` and `PATCH /api/spools`, and **`fromLabel`**: the fields Claude filled in that nobody has edited since (`brand`, `material`, `finish` (the variant), `colorName`, `colorHex`, `netGrams`, and those above). A `PATCH` or `PUT /weight` that sets a field takes it off the list.
- Spools also carry `labelRead`: `null`, or `{ status, photoId, spools }` with `status` `reading`, `multiple` (the photo shows several labels; `spools` lists them, nothing is made yet), `unreadable`, `failed` or `cap` (nothing was filled).
- `POST /api/spools/:id/label-read/accept` confirms `multiple`: the first label fills this spool, each other becomes a new spool with a copy of the photo; answers `201 { spool, created }` (`404` when nothing is waiting). `DELETE /api/spools/:id/label-read` puts away a waiting list or a failure line.
- People only: no scope lists these routes, so a token, whatever its scopes, gets `403 person_only`.
- Every read is a row in `label_reads` with its status, `run_outcome` (`read`, `unreadable`, `refusal`, `api_error`, `timeout`, `cap`, `too_large`, `bad_shape`, …) and a `detail` (model, stop reason, status, how many labels, how long it took); how to read them is in [deploy.md](deploy.md). Capped at 20 reads a day for the whole workspace (UTC days, rows with `ran_at`).

## What to try next (the failure coach, automatic)

When an attempt is answered Partly or Spaghetti (`PATCH /api/attempts/:id`, `POST /api/attempts/:id/finish`, or logged with that outcome), Claude *suggests* what to change for the next try ([decision 0027](decisions/0027-failure-coach-suggests-what-to-try-next.md)). It needs `ANTHROPIC_API_KEY`; without it nothing happens and `features.coach` is `false`.

- Attempts carry `coach`: `null`, or `{ status: "thinking", items: [] }` while Claude works, or `{ status: "ready", items }` where each item is `{ id, title, why, settings, note, dismissed }`: a short title ("Add a brim"), one line of why, the settings it would change (a partial `settings` object using only fields the attempt sheet has, within what the X2D can do, or `null`), a line for the next attempt's note for what settings can't say (or `null`), and whether someone dismissed it. At most three. It is only ever a suggestion: the attempt's own `settings`, `note` and tags are never written by it. Nothing useful to say, a refusal and a failed call leave `coach` `null`; it is also `null` once the attempt is not Partly or Spaghetti any more. A change to it is an `attempt` update in the change feed.
- `PUT /api/attempts/:id/coach/:suggestionId` with `{ dismissed: boolean }` dismisses an item or takes the dismissal back (people only: a token gets `403 person_only`); answers `{ attempt }`.
- Who starts it: a signed-in person, or a token with both the `attempts` and `printer` scopes (the bridge). Any other agent's answer is not coached. An attempt is coached once.
- The suggestions are in a build's `story.md` (`Claude suggests for the next try (only suggestions, nothing was changed): …`).
- Every run is a row in `coach_runs` with `status`, `run_outcome` (`done`, `nothing`, `refusal`, `api_error`, `timeout`, `cap`, …) and a `detail`. Capped at 20 a day for the whole workspace (UTC days, rows with `ran_at`); past it the run is marked `cap`.

## Upkeep and drying

The printer's maintenance list (`src/shared/upkeep.ts`, routes in `src/worker/routes/upkeep.ts`). The first read seeds the starting list for the X2D; people and agents edit it.

- `GET /api/printer/upkeep` (`read`) → `{ printHours, tasks }`, most due first. A task has `intervalHours` and/or `intervalDays` (whichever comes first makes it due), `sinceHours`, `sinceDays`, `fraction` (1 is due), `due`, `lastDone` and the latest five `history` entries.
- `POST /api/printer/upkeep` `{ id, name, note?, intervalHours?, intervalDays? }` adds a task (idempotent on `id`; at least one interval). `PATCH /api/printer/upkeep/:id` changes any of them. `printer` scope.
- `POST /api/printer/upkeep/:id/done` `{ id, note?, at? }` logs a "Done": who (an agent's work is its owner's), when, and the printer's print hours at that moment; it resets the task. Idempotent on `id`. `PUT /api/printer/upkeep/logs/:logId/photo/:photoId` attaches a photo (multipart, like a spool's). `printer` scope.
- Removing a task (`DELETE /printer/upkeep/:id`, undone by `POST …/restore`) and taking a "Done" back (`DELETE /printer/upkeep/logs/:logId`) are person-only.
- **Print hours** are the sum over attempts of their `actualMinutes`, else the bridge's started-to-off-the-bed time, else the slicer's estimate (a failed print only as far as `failedAtPercent`); a print still going counts what it has run so far.
- **Drying windows**: `PUT /api/printer` also takes `dryingDays` (`{ "PETG": 14 }`, whole: a material left out goes back to its starting value). A spool is past its window after that many days since `driedAt` (or since it was added). The app says "Dry it before printing"; the API only carries the numbers.
- **Nudge**: devices with `upkeepNudges` (`PUT/PATCH /push/subscription`) get one push when a task becomes due: at most one a day for the whole printer, outside quiet hours.

## Notifications (people only)

The devices that get "how did it go?" push notifications. A token is refused these (`403 person_only`), reads included.

- `GET /api/push` → `{ publicKey, canSend, subscriptions: [{ endpoint, alsoOthers, upkeepNudges, weekNudges, timeZone }] }`: the VAPID public key (null when the server has none) and this person's devices.
- `PUT /api/push/subscription` `{ endpoint, keys: { p256dh, auth }, timeZone, alsoOthers? }` turns notifications on for a device (https endpoints only, ten devices per person); `PATCH` changes `alsoOthers`, `upkeepNudges`, `weekNudges` (the Sunday-evening "Your week", on by default) or `timeZone`; `DELETE { endpoint }` turns them off. `DELETE /api/session` also accepts `{ pushEndpoint }` and forgets that device with the session.
- `POST /api/push/test { endpoint }` sends a test notification to that device (`404` unknown, `410` the push service dropped it, `502` it didn't take it, `503` no private key).

A notification's buttons call the ordinary `POST /api/attempts/:id/finish`, with the person's session cookie.

## The OpenAPI document

`GET /api/openapi.json` is the API as OpenAPI 3.1. It is made from the code each time it is asked for, never written by hand: request bodies and queries are the zod schemas the routes validate with, the scopes come from the table in `src/worker/auth/scopes.ts`, and every route has a one-line summary, its scopes and its error shapes (`{ "error": { "code", "message" } }`) in `src/worker/openapi/operations.ts`. A test fails when a route exists that the document doesn't describe, and the document is checked against the OpenAPI 3.1 schema.

- Any token or session may read it, whatever its scopes (`x-scopes` on each operation says what it needs). A token is only told about what its scopes allow; a signed-in person sees everything, with the person-only operations marked.
- Answers are described by schemas written to match the types in `src/shared`; a worker test checks real answers against them. The inside of a few long answers (an attempt's `photoRead`, the printer's `bridge`, the journal's entries) is described loosely: see the types.
- `docs/openapi.json` is a copy of it as a signed-in person sees it (everything), kept in sync by a test (`UPDATE_OPENAPI=1 pnpm test` rewrites it after an API change). The installed app on an iPhone keeps every spaghetti.day URL inside its window, so there the Agents page links this copy on GitHub, which opens in Safari's sheet.
- The Agents page links it as "API reference". Anything that reads OpenAPI (a client generator, an agent framework) can use it directly: `curl -H "Authorization: Bearer spg_…" https://spaghetti.day/api/openapi.json`.
- The webhook request (below) is in the document's `webhooks` section.

## Webhooks (people only)

A webhook sends the change feed to an address instead of making an agent poll `GET /api/changes`. A person adds one on the Agents page (Webhooks): an `https` address, the kinds of change it wants, and optionally which agent it is for (a label; it doesn't limit what is sent). Managing webhooks is for signed-in people only (`403 person_only` for a token): `GET /api/webhooks`, `POST /api/webhooks` `{ url, kinds, agentId? }`, `DELETE /api/webhooks/:id` and `POST /api/webhooks/:id/restore` (the Undo), `GET /api/webhooks/:id/deliveries`, `POST /api/webhooks/:id/test` ("Send a test event", sent at once) and `POST /api/webhooks/:id/deliveries/:deliveryId/retry`.

**Kinds** are the change feed's `entity`: `item` (ideas and builds), `attempt`, `photo`, `file`, `comment`, `spool`, `recipe`, `shopping` (the shopping list), `slot`, `printer`, `tag`, `agent`, `person`, `wishlist`, `scout` (the idea scout); or `all`. A webhook starts at the feed's end when it is made: what already happened isn't sent.

**The secret** (`whsec_…`) is shown once, when the webhook is made, and only its first characters can be read afterwards. It is kept encrypted so Spaghetti can sign with it ([decision 0025](decisions/0025-webhooks-signed-from-the-cron.md)); lost it? Add a new webhook and remove the old one.

**The request** is a `POST` with `Content-Type: application/json`, one change at a time, in the shape `GET /api/changes` returns plus who it is for:

```json
{
  "deliveryId": "6f0c…",
  "webhookId": "b1d2…",
  "test": false,
  "changes": [
    { "seq": 1042, "entity": "attempt", "id": "9a7e…", "itemId": "5c3b…", "action": "updated",
      "actor": { "kind": "agent", "id": "e3f1…" }, "at": 1793000000000 }
  ],
  "cursor": 1042,
  "more": false,
  "reset": false
}
```

The change only says what changed and where, never its content (no titles, notes or photos): fetch the thing with your token (`GET /api/items/:id`, …). `cursor` is the change's `seq`, so a receiver that missed some can catch up with `GET /api/changes?after=<its last cursor>`. A test event has `"test": true` and a made-up change (`seq` and `cursor` 0). Three headers come with it:

| Header | Value |
| --- | --- |
| `Spaghetti-Timestamp` | Seconds since the epoch when this try was sent |
| `Spaghetti-Signature` | `v1=` and the lowercase hex HMAC-SHA256, keyed with the secret, of `<timestamp>.<body>` (the exact bytes received) |
| `Spaghetti-Delivery` | The `deliveryId`: the same across retries |

**Checking the signature** (any language with HMAC-SHA256; this is TypeScript on Web Crypto, which Node 20+, Deno, Bun and Workers all have). Verify against the raw body before parsing it, compare in constant time and refuse old timestamps:

```ts
export async function verify(secret: string, headers: Headers, body: string, toleranceSeconds = 300) {
  const timestamp = headers.get("Spaghetti-Timestamp") ?? "";
  const signature = headers.get("Spaghetti-Signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = signature.startsWith("v1=") ? signature.slice(3).match(/../g) : null;
  if (!expected || expected.length !== 32) return false;
  const bytes = Uint8Array.from(expected, (pair) => Number.parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(`${timestamp}.${body}`));
}
```

**Answering and retrying.** Answer with any `2xx` within 10 seconds; the body is ignored. Anything else (another status, a timeout, no connection) is retried: after 1 minute, then 5 minutes, 30 minutes, 2 hours, 6 hours and 12 hours, so seven tries in about 20 hours, and then it gives up on that delivery. The webhook is then marked **failing** on the Agents page, with the last error; it keeps sending new changes, and the next `2xx` makes it working again. Retries send the same body with a new timestamp and signature, so dedupe on `deliveryId`. Redirects are not followed (a `3xx` is a failure), and a delivery is not guaranteed to arrive in order: use `seq`. "Retry" on a delivery on the Agents page tries it again now, with a fresh day of retries.

**Where it may go.** Addresses must be `https` on the default port, with a public name: no IP addresses, `localhost`, single-word or `.local`-style names, and a name that resolves to a private, loopback or link-local address is refused when the webhook is made and again on every delivery (the same checks as link previews: `shared/link-safety.ts`, DNS over HTTPS). A refused address fails the delivery at once, without retries.

**When it is sent.** A write that records a change starts a delivery pass right after the response (seconds, not guaranteed), the Worker's 5-minute cron is the fallback and sends the retries, and "Send a test event" and "Retry" send at once. Finished deliveries are kept a week, and the Agents page shows the latest twenty of each webhook. Webhooks need a key to keep secrets under on the server: `WEBHOOK_SECRET_KEY` (docs/deploy.md); without it every `/api/webhooks` endpoint answers `503 webhooks_unavailable`.
