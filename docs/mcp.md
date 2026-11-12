# Connecting Claude (the MCP server)

Spaghetti runs an MCP server at `/mcp` (Model Context Protocol over Streamable HTTP) so Claude can search the journal, read a build's story, capture ideas, log prints and keep the AMS record, as an agent of one of you. It is stateless, needs no setup beyond a token or a sign-in, and runs the same locally, in the container and on Cloudflare.

## Claude's apps (claude.ai and the iPhone app)

Claude's own apps connect with a sign-in, no token to paste. On claude.ai (Pro, Max, Team or Enterprise; on Team and Enterprise an owner adds it for the organisation first): **Settings → Connectors → Add custom connector**, name it Spaghetti, enter `https://spaghetti.day/mcp` and add it. Choose **Connect**: Spaghetti's own sign-in opens (your name and password, or a passkey), then a screen that says which app asks and what it will be able to do. **Allow** sends you back. The connector is then in Claude on the web and, once added there, in the Claude iPhone and Android apps too: ask "what worked for PETG last time?" from the printer.

It becomes an agent of yours, **Claude for Alex**, with all four scopes (the screen lists them; you approve or decline as a whole). Everything it does is marked "via Claude for Alex", like a token's work. It is on the Agents page as **Signed in with Claude**, where **Disconnect** (with an Undo) ends its tokens at once. Its access tokens last an hour and renew by themselves while the app is in use; unused for 60 days, it asks again.

Other clients that speak MCP's OAuth (MCP Inspector, Claude Code's `/mcp` sign-in) work the same way against `/mcp`. The pieces, for anything else:

| | |
| --- | --- |
| `GET /.well-known/oauth-protected-resource` (also under `/mcp`) | RFC 9728: the resource and its authorization server |
| `GET /.well-known/oauth-authorization-server` | RFC 8414: the endpoints below, `code_challenge_methods_supported: ["S256"]` |
| `POST /oauth/register` | RFC 7591: JSON `{ client_name, redirect_uris }`, answers `201` with a `client_id` (a `client_secret` only if the client asks for client authentication); at most 20 an hour from one address (`429` after) |
| `/authorize` | The consent screen (a page, not an API): `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` (S256 only), `state`, optional `scope` (`read capture attempts printer`, default all) and `resource` |
| `POST /oauth/token` | `authorization_code` (with `code_verifier`) and `refresh_token` (each refresh token works once and comes back replaced); answers `access_token` (`spg_…`, one hour), `refresh_token` (`spr_…`), `scope` |
| `POST /oauth/revoke` | RFC 7009: ends the connection from the app's side |

A `401` from `/mcp` carries `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"`, which is where a client starts. Redirect addresses are https, `http://localhost…`, or an app's own scheme, and must match what was registered exactly. A refresh can ask for fewer scopes than were approved, never more (`invalid_scope`). The decision is [0029](decisions/0029-oauth-small-and-on-d1.md).

## 1. Make a token (Claude Code and config files)

In the app: account menu → **Agents** → **New agent** (name it "Claude for Alex", pick scopes) → copy the token and the "Connect Claude" command shown with it. Or from the command line:

```sh
pnpm agent:add --owner alex --name "Claude for Alex" --scopes read,capture,attempts
```

Scopes are `read`, `capture`, `attempts` and `printer` (see [api.md](api.md)). Give it only what it should do; a tool the token can't use answers with the scope it needs. Revoke the token on the Agents page any time.

## 2. Connect

Claude Code:

```sh
claude mcp add --transport http spaghetti https://spaghetti.day/mcp --header "Authorization: Bearer spg_…"
```

Locally the address is `http://localhost:5173/mcp` (`pnpm dev`) or `http://localhost:8787/mcp` (`pnpm build && pnpm start`).

Any client that takes a JSON config:

```json
{
  "mcpServers": {
    "spaghetti": {
      "type": "http",
      "url": "https://spaghetti.day/mcp",
      "headers": { "Authorization": "Bearer spg_…" }
    }
  }
}
```

## What it can do

| Tool | For | Scope |
| --- | --- | --- |
| `search` | Ideas, builds and attempts by words, with `outcome`, `material` and `tag` filters; gives the `build_id`s the other tools need | `read` |
| `what_worked` | The latest attempts that worked, for a `build_id`, a `material` or free text, with the saved recipes for the material | `read` |
| `list_recipes` | The saved recipes (named settings of attempts that worked), optionally for a `material` and `finish` | `read` |
| `get_build` | One build as a markdown story: the idea, notes, every attempt with settings, changes and notes, what worked (the same as `GET /api/builds/:id/story.md`), then a Photos list: each `photo_id`, what it belongs to (the idea/build or attempt N), when it was taken or added and its size in pixels | `read` |
| `get_photo` | Look at photos: `build_id` plus a `photo_id`, or an `attempt` number, or neither for the build's own photos (`limit` up to 4). Each comes back as MCP image content (`type: "image"`, base64, `mimeType`) after a line of text saying what it is. `search` names an attempt's photo too | `read` |
| `add_photo` | Add a JPEG or WebP (`photo_url` or `photo_base64`) to an existing idea or build (`build_id`) or to one of its attempts (also `attempt_id`); it goes after the photos already there. `log_attempt` and `finish_attempt` take the same two arguments for the attempt they write. Removing a photo is for people | `capture` for an idea or build, `attempts` for an attempt |
| `add_comment` | A `build_id` and the `text` to say in the thread under an idea or build; it shows as the owner's comment, "via" the agent, and counts as new for the other person. Read the thread with `get_build`, which ends with the comments | `capture` or `attempts` |
| `capture_idea` | A title and/or note, optionally a photo by https URL or base64 (JPEG or WebP) | `capture` |
| `set_parts` | Add or change a build's parts (name and quantity; give `part_id` to change one). Removing is for people | `attempts` |
| `start_attempt` | A print has started: an attempt with no outcome yet | `attempts` |
| `log_attempt` | A print that is already done, with outcome, tags, note, settings and, for a build with parts, `parts` (`part_id` and good pieces) | `attempts` |
| `finish_attempt` | Give a printing attempt its outcome (and `parts` counts); a spaghetti counts no pieces unless a number is given | `attempts` |
| `list_scout_suggestions` | This week's three models the idea scout suggested, with why they fit and whether they were kept or put away. Read-only: keeping or dismissing one is for people ([0040](decisions/0040-the-idea-scout-suggests-three-models-a-week.md)) | `read` |
| `list_spools` | The pantry, with each spool's slot, level and (where it has gram data) grams left | `read` |
| `weigh_spool` | A weighing: a fresh baseline for the grams left on a spool (`on_scale` minus its empty weight, or `grams_left`) | `printer` |
| `get_week` | One week (Monday to Sunday): prints and how they went, builds finished, ideas, comments, filament and Claude's paragraph when there is one | `read` |
| `list_upkeep` | The printer's maintenance tasks, most due first, with how long since each was done and the print-hour total | `read` |
| `log_upkeep` | A task was done (now, or `at`), with an optional note: resets it and records the printer hours | `printer` |
| `load_slot` | Record which spool is in an AMS slot (never touches the printer) | `printer` |

Everything an agent writes is recorded as you, "via Claude for Alex" in the journal, attempts and idea cards, and in the change feed as the agent. The server can't delete anything; deleting stays with people.

## The API as OpenAPI

The tools are a curated slice. Everything the API can do, and what each token may do, is described as OpenAPI 3.1 at `GET /api/openapi.json` (made from the code; see [api.md](api.md#the-openapi-document)): hand it to anything that reads OpenAPI when a tool doesn't exist for what you want. A token only sees what its scopes allow. To be told about changes instead of asking, a person can add a [webhook](api.md#webhooks-people-only) on the Agents page.

## How it works

`POST /mcp` takes one JSON-RPC message (or a batch) and answers with JSON: `initialize`, `ping`, `tools/list` and `tools/call`. `GET` and `DELETE` are `405` (there are no sessions or streams), a missing or revoked token is `401`. A tool never touches the database: it calls Spaghetti's own API with the caller's token, so scopes, validation, attribution and the change feed behave exactly as for any other request (`src/worker/mcp/`). A tool is also refused before it runs to a token that has none of its scopes, so it does nothing of its own (such as fetching a photo) for that token. `capture_idea` fetches a `photo_url` only from the open internet: https on the default port, a public name that resolves to public addresses only, checked again on every redirect (the rules of link previews), so it never reaches a local network. Photos sent to `capture_idea` can't be resized on the Worker, so the one image is stored as both sizes (cap 12 MB), with a neutral placeholder colour, and flagged: the next browser that opens the app resizes it quietly and replaces the copies (see decision 0004).

**Photos.** `get_photo` sends the app's display-size copy (the `large` one), and the `thumb` when that is over 900 kB (not for an original no browser has resized yet, whose two copies are the same file: that one waits for the app to resize it), so a picture stays well under what Claude's apps take in a tool result; one that is still too big is named but not sent. Nothing is resized on the Worker. `add_photo` and the `photo_*` arguments of the attempt tools go through the same path as `capture_idea`'s: `photo_url` only from the open internet on every hop, 12 MB cap, stored as both sizes and flagged for the next browser to resize, and shown in the app marked "via" the agent, where a person can remove it. A deleted idea, attempt or photo is not found.

Not built: server-sent events, scope choice on the consent screen (all or nothing), and tools for deleting or editing past entries.
