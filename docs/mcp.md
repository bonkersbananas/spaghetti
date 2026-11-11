# Connecting Claude (the MCP server)

Spaghetti runs an MCP server at `/mcp` (Model Context Protocol over Streamable HTTP) so Claude can search the journal, read a build's story, capture ideas, log prints and keep the AMS record, as an agent of one of you. It is stateless, needs no setup beyond a token, and runs the same locally, in the container and on Cloudflare.

## 1. Make a token

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
| `get_build` | One build as a markdown story: the idea, notes, every attempt with settings, changes and notes, what worked (the same as `GET /api/builds/:id/story.md`) | `read` |
| `add_comment` | A `build_id` and the `text` to say in the thread under an idea or build; it shows as the owner's comment, "via" the agent, and counts as new for the other person. Read the thread with `get_build`, which ends with the comments | `capture` or `attempts` |
| `capture_idea` | A title and/or note, optionally a photo by https URL or base64 (JPEG or WebP) | `capture` |
| `set_parts` | Add or change a build's parts (name and quantity; give `part_id` to change one). Removing is for people | `attempts` |
| `start_attempt` | A print has started: an attempt with no outcome yet | `attempts` |
| `log_attempt` | A print that is already done, with outcome, tags, note, settings and, for a build with parts, `parts` (`part_id` and good pieces) | `attempts` |
| `finish_attempt` | Give a printing attempt its outcome (and `parts` counts); a spaghetti counts no pieces unless a number is given | `attempts` |
| `list_spools` | The pantry, with each spool's slot, level and (where it has gram data) grams left | `read` |
| `weigh_spool` | A weighing: a fresh baseline for the grams left on a spool (`on_scale` minus its empty weight, or `grams_left`) | `printer` |
| `list_upkeep` | The printer's maintenance tasks, most due first, with how long since each was done and the print-hour total | `read` |
| `log_upkeep` | A task was done (now, or `at`), with an optional note: resets it and records the printer hours | `printer` |
| `load_slot` | Record which spool is in an AMS slot (never touches the printer) | `printer` |

Everything an agent writes is recorded as you, "via Claude for Alex" in the journal, attempts and idea cards, and in the change feed as the agent. The server can't delete anything; deleting stays with people.

## How it works

`POST /mcp` takes one JSON-RPC message (or a batch) and answers with JSON: `initialize`, `ping`, `tools/list` and `tools/call`. `GET` and `DELETE` are `405` (there are no sessions or streams), a missing or revoked token is `401`. A tool never touches the database: it calls Spaghetti's own API with the caller's token, so scopes, validation, attribution and the change feed behave exactly as for any other request (`src/worker/mcp/`). Photos sent to `capture_idea` can't be resized on the Worker, so the one image is stored as both sizes (cap 12 MB), with a neutral placeholder colour, and flagged: the next browser that opens the app resizes it quietly and replaces the copies (see decision 0004).

Not built: OAuth (clients that insist on it can't connect yet; tokens only), server-sent events, and tools for deleting or editing past entries.
