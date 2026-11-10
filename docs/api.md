# The API, for agents

Everything the app does goes through `/api` (JSON, plus multipart for photos and slicer files). A browser uses its session cookie; anything else (an MCP server, the printer bridge) uses a **token** that acts as a named **agent**. Types live in `src/shared/api.ts`, `src/shared/agents.ts` and `src/shared/changes.ts`.

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
- A token can **never** sign in, read the session, list or change agents and tokens, use `GET /api/links/preview` (the Worker would fetch any public page for whoever asks), change a password (`PUT /api/account/password`), or manage people. Those are for a signed-in person only (`403 person_only`). The same goes for deleting and restoring anything: agents create and change, people delete.
- `last_used` on a token moves at most every 5 minutes.

## Scopes

A token carries one or more of four scopes. A request outside them is `403 missing_scope`, and the message names the scope ("This token needs the "attempts" scope for that.").

| Scope | Allows |
| --- | --- |
| `read` | Every `GET`: items, builds, attempts, the journal, search and "what worked", the pantry, the printer, tags, people, photo and file bytes, and the change feed. |
| `capture` | `PUT /items/up-next/order`, `PATCH /items/:id` with `upNext` or `forWhom`, `POST /capture` (an idea from a link, text and photos in one call: see [share.md](share.md)), `POST /items` (an idea), `PATCH /items/:id` with `title` / `note`, `PUT /items/:id/photos/:photoId` (a photo that isn't of an attempt), `PUT /items/:id/photos/order`. |
| `attempts` | `POST /items` with `stage: "building"` (a build from scratch), `POST /items/:id/attempts`, `PATCH /attempts/:id` (also `endedAt` and `suggestedFailureTag`, the printer bridge's; `settings` replaces the settings, `settingsMerge: { set, unset }` changes only those and keeps the rest, which is what the attempt sheet sends), `POST /attempts/:id/finish`, `PUT /attempts/:id/file`, photos with an `attemptId`, `PATCH /items/:id` with `stage` or `coverPhotoId`, `POST /tags`. |
| `printer` | `PUT /printer/slots/:slot`, `PUT /printer`, `PUT /printer/bridge` (the printer bridge's heartbeat, progress and unknown trays), `POST /spools`, `PATCH /spools/:id`, `PUT /spools/:id/photo/:photoId`, `PUT /spools/:id/weight`, `POST /spools/:id/weighings`. |

The rules are one table, `src/worker/auth/scopes.ts`: any route not listed there is person-only, so a new endpoint is closed to tokens until it is given a scope. Routes that need to look at the body (a photo's `attemptId`, the fields of a `PATCH`) narrow it with `canUse` / `missingScope`. `test/worker/agents.test.ts` has a case per row.

## Who did it

An agent's writes are recorded as the **owner's** (`createdBy`, `finishedBy`: avatars and "captured by" work as they do) and name the agent with `createdVia` / `finishedVia` on items and attempts (and `via` on journal entries). The app shows that quietly as "via Claude for Alex", with the owner's avatar plus a small agent mark.

The change feed (`GET /api/changes?after=<cursor>`, see `src/shared/changes.ts`) records the actor as `{ "kind": "agent", "id": "<agent id>" }` for an agent and `{ "kind": "person", "id": "<user id>" }` for a person. Agent ids resolve to names through `GET /api/agents` (people only; every agent is listed, tokens only for their owner). Creating an agent and adding or revoking a token are `agent` changes, made by the person.

## Idempotent writes

The client picks ids (UUIDs) for items, attempts, photos and files, so any write can be retried safely: a repeat returns the same thing and records no second change. Photos are uploaded already resized (WebP or JPEG, large and thumb); see "Items and photos" in `AGENTS.md`.

## Filament in grams

A spool can count itself down (decision [0009](decisions/0009-filament-tracked-in-grams.md)). Every spool response (`GET /spools`, `GET /spools/:id`, the writes below) carries `netGrams`, `tareGrams`, `gramsLeft` (null until the spool has gram data), `gramsApproximate` (a failed print was counted by a guess) and `weighedAt`. With gram data `remaining` is derived from the grams: a `remaining` sent in a `PATCH` (the printer bridge sends the AMS's on every sync) is ignored for such a spool and changes nothing. Without gram data `remaining` is the hand-set (or AMS) level, as before.

- `POST /spools` accepts `netGrams` (and `tareGrams`): a Bambu spool is 1000 g.
- `PUT /spools/:id/weight` with `{ "netGrams": 1000, "tareGrams": 250 }` sets what it held when new and the empty spool's weight; `null` clears them and drops the spool's weighings (back to a hand-set level). `printer` scope.
- `POST /spools/:id/weighings` with `{ "id": "<uuid>", "onScale": 812 }` (the empty spool's weight is taken off) or `{ "id", "gramsLeft": 562 }`, optionally `tareGrams` and `at`: a fresh baseline. Idempotent on `id`. `printer` scope. `DELETE /spools/:id/weighings/:weighingId` takes one back; it is person-only.
- `GET /spools/:id/usage` lists what used the spool (attempt, build, grams, whether the amount is a guess, whether it still counts) and its weighings.
- Usage is read off finished attempts, never stored: `settings.filaments[].grams` (from the slicer file) of each filament whose `spoolId` is the spool. Editing an attempt, or deleting and restoring it, changes the answer.

## Up next and "for"

An idea can be queued as **Up next**: `upNext` on an item is its place in the queue (1 is first) or `null`. `PATCH /items/:id { "upNext": true }` puts it at the end, `false` or `null` takes it off, a number puts it at that place (the undo of taking it off). Only ideas are queued, and a stage change to a build takes the idea off the queue. `PUT /items/up-next/order { "ids": [...] }` sets the order (those first, in that order; queued ideas not listed follow) and answers with the queue. `forWhom` ("Mila", up to 80 characters, empty clears it) is optional and searchable. All of these are `capture` scope.

## Also here

- `GET /api/links/preview?url=…`: the title and site name of a link in a note (`{ url, title, site }`, the last two nullable), for the link cards. People only. https only, no IP addresses, `localhost`, one-word, `.local` or `.internal` hosts, credentials or ports; the name is resolved through Cloudflare's DNS-over-HTTPS first and refused if it points anywhere private; 3 seconds, 256 KB, `text/html`, three redirects at most with each hop checked the same way; only `og:title`, `<title>` and `og:site_name` are read. Cached in `link_previews` for 30 days, failures for one day.

- `GET /api/builds/:id/story.md`: a build's (or idea's) whole story as one markdown document, with `read`. Works for any item id.
- `/mcp`: the MCP server, with the same tokens; see [mcp.md](mcp.md). It calls this API as the agent, so everything above applies to it.

## Changing your own password

`PUT /api/account/password` with `{ currentPassword, newPassword }` (person-only). The new password needs at least 10 characters and no other rule, and must differ from the current one. It signs out the person's **other** sessions and keeps the one making the request; the answer is `{ signedOut }`, how many devices that was. Errors: `400 too_short`, `400 same_password`, `403 wrong_password`, and `429 rate_limited` after five wrong current passwords in 15 minutes (counted per person in `password_failures`, cleared on success).

## Notifications (people only)

The devices that get "how did it go?" push notifications. A token is refused these (`403 person_only`), reads included.

- `GET /api/push` → `{ publicKey, canSend, subscriptions: [{ endpoint, alsoOthers, timeZone }] }`: the VAPID public key (null when the server has none) and this person's devices.
- `PUT /api/push/subscription` `{ endpoint, keys: { p256dh, auth }, timeZone, alsoOthers? }` turns notifications on for a device (https endpoints only, ten devices per person); `PATCH` changes `alsoOthers` or `timeZone`; `DELETE { endpoint }` turns them off. `DELETE /api/session` also accepts `{ pushEndpoint }` and forgets that device with the session.
- `POST /api/push/test { endpoint }` sends a test notification to that device (`404` unknown, `410` the push service dropped it, `502` it didn't take it, `503` no private key).

A notification's buttons call the ordinary `POST /api/attempts/:id/finish`, with the person's session cookie.
