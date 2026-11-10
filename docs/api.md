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
- A token can **never** sign in, read the session, list or change agents and tokens, use `GET /api/links/preview` (the Worker would fetch any public page for whoever asks), or manage people. Those are for a signed-in person only (`403 person_only`). The same goes for deleting and restoring anything: agents create and change, people delete.
- `last_used` on a token moves at most every 5 minutes.

## Scopes

A token carries one or more of four scopes. A request outside them is `403 missing_scope`, and the message names the scope ("This token needs the "attempts" scope for that.").

| Scope | Allows |
| --- | --- |
| `read` | Every `GET`: items, builds, attempts, the journal, search and "what worked", the pantry, the printer, tags, people, photo and file bytes, and the change feed. |
| `capture` | `POST /items` (an idea), `PATCH /items/:id` with `title` / `note`, `PUT /items/:id/photos/:photoId` (a photo that isn't of an attempt), `PUT /items/:id/photos/order`. |
| `attempts` | `POST /items` with `stage: "building"` (a build from scratch), `POST /items/:id/attempts`, `PATCH /attempts/:id` (also `endedAt` and `suggestedFailureTag`, the printer bridge's), `POST /attempts/:id/finish`, `PUT /attempts/:id/file`, photos with an `attemptId`, `PATCH /items/:id` with `stage` or `coverPhotoId`, `POST /tags`. |
| `printer` | `PUT /printer/slots/:slot`, `PUT /printer`, `PUT /printer/bridge` (the printer bridge's heartbeat, progress and unknown trays), `POST /spools`, `PATCH /spools/:id`, `PUT /spools/:id/photo/:photoId`. |

The rules are one table, `src/worker/auth/scopes.ts`: any route not listed there is person-only, so a new endpoint is closed to tokens until it is given a scope. Routes that need to look at the body (a photo's `attemptId`, the fields of a `PATCH`) narrow it with `canUse` / `missingScope`. `test/worker/agents.test.ts` has a case per row.

## Who did it

An agent's writes are recorded as the **owner's** (`createdBy`, `finishedBy`: avatars and "captured by" work as they do) and name the agent with `createdVia` / `finishedVia` on items and attempts (and `via` on journal entries). The app shows that quietly as "via Claude for Alex", with the owner's avatar plus a small agent mark.

The change feed (`GET /api/changes?after=<cursor>`, see `src/shared/changes.ts`) records the actor as `{ "kind": "agent", "id": "<agent id>" }` for an agent and `{ "kind": "person", "id": "<user id>" }` for a person. Agent ids resolve to names through `GET /api/agents` (people only; every agent is listed, tokens only for their owner). Creating an agent and adding or revoking a token are `agent` changes, made by the person.

## Idempotent writes

The client picks ids (UUIDs) for items, attempts, photos and files, so any write can be retried safely: a repeat returns the same thing and records no second change. Photos are uploaded already resized (WebP or JPEG, large and thumb); see "Items and photos" in `AGENTS.md`.

## Also here

- `GET /api/links/preview?url=…`: the title and site name of a link in a note (`{ url, title, site }`, the last two nullable), for the link cards. People only. https only, no IP addresses, `localhost`, one-word, `.local` or `.internal` hosts, credentials or ports; the name is resolved through Cloudflare's DNS-over-HTTPS first and refused if it points anywhere private; 3 seconds, 256 KB, `text/html`, three redirects at most with each hop checked the same way; only `og:title`, `<title>` and `og:site_name` are read. Cached in `link_previews` for 30 days, failures for one day.

- `GET /api/builds/:id/story.md`: a build's (or idea's) whole story as one markdown document, with `read`. Works for any item id.
- `/mcp`: the MCP server, with the same tokens; see [mcp.md](mcp.md). It calls this API as the agent, so everything above applies to it.
