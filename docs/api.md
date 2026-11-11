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
- A token can **never** sign in, read the session, list or change agents and tokens, use `GET /api/links/preview` (the Worker would fetch any public page for whoever asks), change a password (`PUT /api/account/password`), or manage people. Those are for a signed-in person only (`403 person_only`). The same goes for deleting and restoring anything: agents create and change, people delete.
- `last_used` on a token moves at most every 5 minutes.

## Scopes

A token carries one or more of four scopes. A request outside them is `403 missing_scope`, and the message names the scope ("This token needs the "attempts" scope for that.").

| Scope | Allows |
| --- | --- |
| `read` | Every `GET`: items, builds, attempts, the journal, search and "what worked", the pantry, the printer, tags, people, photo and file bytes, and the change feed. |
| `capture` | `PUT /items/up-next/order`, `PATCH /items/:id` with `upNext` or `forWhom`, `POST /capture` (an idea from a link, text and photos in one call: see [share.md](share.md)), `POST /items` (an idea), `PATCH /items/:id` with `title` / `note`, `PUT /items/:id/photos/:photoId` (a photo that isn't of an attempt), `PUT /items/:id/photos/order`, `POST /items/:id/comments` and `PATCH /comments/:id` (your agent's own comments; see Comments). |
| `attempts` | `POST /recipes` and `PATCH /recipes/:id` (name and note), `POST /items` with `stage: "building"` (a build from scratch), `POST /items/:id/attempts`, `PATCH /attempts/:id` (also `endedAt` and `suggestedFailureTag`, the printer bridge's; `settings` replaces the settings, `settingsMerge: { set, unset }` changes only those and keeps the rest, which is what the attempt sheet sends), `POST /attempts/:id/finish`, `PUT /attempts/:id/file`, photos with an `attemptId`, `PATCH /items/:id` with `stage` or `coverPhotoId`, `PUT /items/:id/parts`, `POST /tags`, `POST /items/:id/comments` and `PATCH /comments/:id` (as with `capture`). |
| `printer` | `POST /printer/upkeep`, `PATCH /printer/upkeep/:id`, `POST /printer/upkeep/:id/done`, `PUT /printer/upkeep/logs/:logId/photo/:photoId`, `PUT /printer/slots/:slot`, `PUT /printer`, `PUT /printer/bridge` (the printer bridge's heartbeat, progress and unknown trays), `POST /spools`, `PATCH /spools/:id`, `PUT /spools/:id/photo/:photoId`, `PUT /spools/:id/weight`, `POST /spools/:id/weighings`. |

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

## People and profile pictures

`GET /people` lists the two people; each `person` (here and in `GET /session`) has `photoUrl`: `/api/people/<id>/photo?v=<version>` or `null` (initials). The address changes with every new picture, and the bytes are served `private, max-age=31536000, immutable`; `GET /people/:id/photo` needs `read` like any read. Agents and MCP see `photoUrl` and can fetch the picture, but never change it.

- `PUT /people/me/photo`: your own picture, people only (`403 person_only` for a token). Multipart with one `photo` file, WebP or JPEG (`415 unsupported` otherwise), at most 512 KB (`413 too_large`); the browser sends a 256 px square it cropped itself. Replaces the old one (its bytes are deleted) and answers `{ user }`. A `person` change in the feed lets the other person's screen refresh.
- `DELETE /people/me/photo`: back to initials, people only. Always `200 { user }`, also when there was none.

## Recipes

A recipe is the named settings of an attempt that worked (decision [0017](decisions/0017-recipes-are-frozen-attempts.md)). `GET /recipes` lists them newest first (`?material=PLA&finish=silk` narrows to what fits a spool: same material, and the same finish where both have one); `GET /search` also returns `recipes`, `GET /what-worked?item=&material=` returns the material's `recipes`.

- `POST /recipes` `{ id, name, note?, sourceAttemptId }` saves an attempt as a recipe: `404` if the attempt is gone, `422 not_worked` unless it worked, `422 no_material` unless it names a filament type. The settings are read from the attempt, never from the request. Idempotent on `id`. `attempts` scope.
- `PATCH /recipes/:id` `{ name?, note? }`: the only things that change. `attempts` scope.
- `DELETE /recipes/:id` and `POST /recipes/:id/restore`: soft delete and its undo, people only.
- A recipe carries `source` (`attemptId`, `itemId`, `title`, `number`, `photo`) while that attempt and its build exist, else `null`.

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
- `DELETE /items/:id/parts/:partId` removes a part (people only). Attempts keep their counts for it; they show nothing once the part is gone.
- `parts` is accepted on `POST /items/:id/attempts`, `PATCH /attempts/:id` (replaces the list) and `POST /attempts/:id/finish`. Without `parts`, an attempt that goes from printing to spaghetti has its counts set to 0; one that worked keeps what was on the plate.
- `GET /search` finds builds by part name, and each attempt hit has a `partsLabel` ("Hull half ×2, Deck"). `GET /builds/:id/story.md` has a Parts section and names parts on attempts.
- An attempt's slicer file keeps the object names of its plate (`file.objects`, sent as the `objects` JSON field of `PUT /attempts/:id/file`); the app offers them as parts.

## Insights

`GET /api/insights?year=2026&tz=-60` (read scope) is the year so far, computed from attempts and not stored: `{ insights: { year, prints, outcomes, months, byMaterial, byPlate, failures, longestBuilds, made, madeTotal } }`. `year` defaults to the current one and `tz` is the viewer's zone in minutes behind UTC (`Date.getTimezoneOffset()`), so a print late on New Year's Eve lands in their year. Each failure carries `fixes`: the changes (as phrases such as "a warmer bed") made right before an attempt of the same build that worked. `longestBuilds` (builds with three or more attempts this year) each carry a `photo` and the `outcomes` of their attempts, oldest first. `made` is the builds that had an attempt that worked this year, newest first, up to 36, each with its final photo (the cover if one was picked, else the newest picture of the attempt that worked); `madeTotal` counts them all. The logic is `src/shared/insights.ts`.

## Up next and "for"

An idea can be queued as **Up next**: `upNext` on an item is its place in the queue (1 is first) or `null`. `PATCH /items/:id { "upNext": true }` puts it at the end, `false` or `null` takes it off, a number puts it at that place (the undo of taking it off). Only ideas are queued, and a stage change to a build takes the idea off the queue. `PUT /items/up-next/order { "ids": [...] }` sets the order (those first, in that order; queued ideas not listed follow) and answers with the queue. `forWhom` ("Mila", up to 80 characters, empty clears it) is optional and searchable. All of these are `capture` scope.


## Wishlists

Each person has a ranked wishlist of ideas, shared with the others who sign in unless it is private. `GET /wishlists` answers `{ wishlists: [{ personId, private, entries: [{ itemId, position, addedAt }] }] }`, yours first; someone else's private list has no entries. Only ideas show: one that was deleted or became a build is hidden and comes back in its place if that is undone. Changing a list is for people only, and only their own: `PUT /wishlists/me/items/:itemId` adds an idea at the end (`{ "position": 2 }` puts it at that place; adding it again changes nothing; 409 `not_an_idea` for a build, `full` past 50), `DELETE /wishlists/me/items/:itemId` takes it off, `PUT /wishlists/me/order { "ids": [...] }` sets the order (those first, the rest after in their turn), `PATCH /wishlists/me { "private": true }` keeps it to yourself. Each answers with your list. Every write records a `wishlist` change whose id is the owner's and whose `itemId` is null, so the feed never says what a list holds.

## Also here

- `GET /api/links/preview?url=…`: the title and site name of a link in a note (`{ url, title, site }`, the last two nullable), for the link cards. People only. https only, no IP addresses, `localhost`, one-word, `.local` or `.internal` hosts, credentials or ports; the name is resolved through Cloudflare's DNS-over-HTTPS first and refused if it points anywhere private; 3 seconds, 256 KB, `text/html`, three redirects at most with each hop checked the same way; only `og:title`, `<title>` and `og:site_name` are read. Cached in `link_previews` for 30 days, failures for one day.

- `GET /api/builds/:id/story.md`: a build's (or idea's) whole story as one markdown document, with `read`. Works for any item id.
- `/mcp`: the MCP server, with the same tokens; see [mcp.md](mcp.md). It calls this API as the agent, so everything above applies to it.

## Changing your own password

`PUT /api/account/password` with `{ currentPassword, newPassword }` (person-only). The new password needs at least 10 characters and no other rule, and must differ from the current one. It signs out the person's **other** sessions and keeps the one making the request; the answer is `{ signedOut }`, how many devices that was. Errors: `400 too_short`, `400 same_password`, `403 wrong_password`, and `429 rate_limited` after five wrong current passwords in 15 minutes (counted per person in `password_failures`, cleared on success).

## Drafting an idea from a model page (people only)

Claude can read a MakerWorld, Printables or Thingiverse page and draft the idea from it ([decision 0019](decisions/0019-claude-drafts-ideas-from-model-pages.md)). It needs the Worker's `ANTHROPIC_API_KEY` secret (locally in `.dev.vars`); without it everything below answers `404` and the app shows nothing about it.

- `GET /api/features`: `{ drafts: boolean, photoReads: boolean }`, whether the key is set (both follow the one secret).
- `POST /api/items/:id/draft` (optional body `{ url }`; else the first model link in the idea's note): makes the idea's draft job (`status: "reading"`) and, because the caller keeps the request open, does it before answering with `{ draft }`. `400` when there is no link on one of the three sites. Asking again after a failure retries; a draft that is reading or done is left as it is.
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

- `GET /api/push` → `{ publicKey, canSend, subscriptions: [{ endpoint, alsoOthers, timeZone }] }`: the VAPID public key (null when the server has none) and this person's devices.
- `PUT /api/push/subscription` `{ endpoint, keys: { p256dh, auth }, timeZone, alsoOthers? }` turns notifications on for a device (https endpoints only, ten devices per person); `PATCH` changes `alsoOthers` or `timeZone`; `DELETE { endpoint }` turns them off. `DELETE /api/session` also accepts `{ pushEndpoint }` and forgets that device with the session.
- `POST /api/push/test { endpoint }` sends a test notification to that device (`404` unknown, `410` the push service dropped it, `502` it didn't take it, `503` no private key).

A notification's buttons call the ordinary `POST /api/attempts/:id/finish`, with the person's session cookie.

## The OpenAPI document

`GET /api/openapi.json` is the API as OpenAPI 3.1. It is made from the code each time it is asked for, never written by hand: request bodies and queries are the zod schemas the routes validate with, the scopes come from the table in `src/worker/auth/scopes.ts`, and every route has a one-line summary, its scopes and its error shapes (`{ "error": { "code", "message" } }`) in `src/worker/openapi/operations.ts`. A test fails when a route exists that the document doesn't describe, and the document is checked against the OpenAPI 3.1 schema.

- Any token or session may read it, whatever its scopes (`x-scopes` on each operation says what it needs). A token is only told about what its scopes allow; a signed-in person sees everything, with the person-only operations marked.
- Answers are described by schemas written to match the types in `src/shared`; a worker test checks real answers against them. The inside of a few long answers (an attempt's `photoRead`, the printer's `bridge`, the journal's entries) is described loosely: see the types.
- The Agents page links it as "API reference". Anything that reads OpenAPI (a client generator, an agent framework) can use it directly: `curl -H "Authorization: Bearer spg_…" https://spaghetti.day/api/openapi.json`.
- The webhook request (below) is in the document's `webhooks` section.

## Webhooks (people only)

A webhook sends the change feed to an address instead of making an agent poll `GET /api/changes`. A person adds one on the Agents page (Webhooks): an `https` address, the kinds of change it wants, and optionally which agent it is for (a label; it doesn't limit what is sent). Managing webhooks is for signed-in people only (`403 person_only` for a token): `GET /api/webhooks`, `POST /api/webhooks` `{ url, kinds, agentId? }`, `DELETE /api/webhooks/:id` and `POST /api/webhooks/:id/restore` (the Undo), `GET /api/webhooks/:id/deliveries`, `POST /api/webhooks/:id/test` ("Send a test event", sent at once) and `POST /api/webhooks/:id/deliveries/:deliveryId/retry`.

**Kinds** are the change feed's `entity`: `item` (ideas and builds), `attempt`, `photo`, `file`, `comment`, `spool`, `recipe`, `slot`, `printer`, `tag`, `agent`, `person`; or `all`. A webhook starts at the feed's end when it is made: what already happened isn't sent.

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
