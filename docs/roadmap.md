# Roadmap

**The autopilot's plan on fctl is the live version of this plan; this file is a copy, kept in the repository so agents can see what the phases and pull request numbers in commit messages refer to, and it can be behind.** When your pull request finishes an item here, tick it in the same pull request. Settled decisions, including the "no"s, are in [decisions/](decisions/README.md).

**Where it stands:** v1 is built and merged (PRs #1–#12): capture, ideas, builds and attempts, journal and search with "what worked last time", Pantry, Printer page, .3mf files, dark mode, offline, command palette, and an accessibility and performance pass. It is deployed at https://spaghetti.day (docs/deploy.md).

**Direction (Carl Oscar, 10 Nov):** implement the UI improvements spec in its suggested order, make the repo better for agents, then the features and the agent-facing service below. The ideas come from another agent's review; add more as building goes on.

**Stack:** Cloudflare Worker (Hono API + React 19 SPA as static assets), D1 via Drizzle, R2 for photos and slicer files; runs locally and in Docker on workerd.

## Now: UI improvements spec

The spec is `docs/specs/ui-improvements.md`. Its sections, in the suggested order:

- [x] §1 Shared building blocks (PrintProgress, SpoolDisc rim, OutcomeStrip) and §9 small polish, with the styleguide split per section first (#14)
- [x] §5 Pantry (rims, AMS remaining, fill discs, desktop list view; #17) and §6 Journal (one icon per row, plate pictures, printing progress, compact rows; #19), side by side
- [x] §3 Build page: summary under the notes, aligned attempt photos, compare two attempts (#23)
- [ ] §2 Today screen and §7 Navigation (Today tab, header search, now-printing card, styleguide out of the sidebar)
- [ ] §4 Idea page (proportions, link cards and a preview endpoint) and §8 Motion (photo transitions, outcome tap, reflow, stepping between attempts): all done in #25 except the reflow when a print finishes, which is on Today's printing card and waits for the Today screen

## Now: agents in the repo

- [x] Doctor script and a browser-path option; screenshots continue past failures and don't depend on the date; contact sheets and visual diffs against main; a seeded dev mode; this roadmap and the decision records; scaffolding for a route, component and endpoint; a design-review agent; the attempt sheet split into parts

## Next: features

- [x] Live updates between the two of you (a change feed with a cursor, which events and webhooks reuse later) (#13)
- [ ] Push notifications: "Tugboat should be done, how did it go?" with outcome buttons on the notification
- [ ] Insights and recipes: success rate by material and plate, which change fixed which failure, a year in review; promote a what-worked attempt to a named recipe on the spool's page
- [ ] Richer ideas: an "Up next" queue, who it's for, comments between you two, a share target for the phone's share sheet (link previews come with spec §4)
- [ ] Parts and quantities ("print the hull in two halves")
- [ ] Maintenance and drying: a log with print-hour counters, reminders from each spool's dried date
- [ ] Passkeys, and adding people in the app instead of the command line (changing your own password is in the app: the account menu → Change password)
- [x] Filament accounting: grams from slicer files update what's left, "not enough for this print", a shopping list (decided: [grams, automatically](decisions/0009-filament-tracked-in-grams.md); a spool starts at 1 kg, each attempt's slicer grams come off it, failed prints in proportion to how far they got, levels follow and stay correctable)
- [x] Read-only printer bridge on the home network: starts and finishes attempts, syncs AMS slots, grabs a camera frame; the app works without it (#22: the program, its routes and [docs/bridge.md](bridge.md); #24: the app side, "off the bed · how did it go?", the printer's live progress and the bridge line and unknown-tray prompt on the Printer page) (decided: [optional and read-only](decisions/0010-optional-read-only-printer-bridge.md); a small program on a home computer using LAN mode, local MQTT, FTP and the camera, never Bambu's cloud and never a command to the printer)

## Later: Claude in the app

Both items use the Worker's `ANTHROPIC_API_KEY` secret, set by Carl Oscar in the Cloudflare dashboard and kept across `wrangler deploy`; locally it goes in `.dev.vars`, which is never committed. The features are hidden when the key is absent, so the app works fully without it. Both are for people only, with a per-day cap so a key can't run up a bill, and both use the official `@anthropic-ai/sdk` (fetch-based; check it bundles on workerd) with `claude-opus-5-5`.

- [ ] **Import an idea from a model page:** paste a MakerWorld, Printables or Thingiverse link (or share it from the phone), and Spaghetti drafts the idea: a title, a short note, the source link, the model's pictures, the designer, the license, and suggested material and settings. The person tidies it up.
  - Anthropic's server-side web fetch tool (`web_fetch_20260209`, `allowed_domains` limited to the model sites) reads the page, so the Worker never fetches arbitrary URLs for it. The draft comes back structured through `output_config.format` (a JSON schema); handle `stop_reason: "refusal"`.
  - Pictures come from an allowlist of the sites' image CDNs and are stored with `needsResize`, so the next browser makes the thumbnails ([0004](decisions/0004-photos-resized-in-the-browser.md)).
  - Agents may get an `import_idea` MCP tool later.
- [ ] **Read a print from its photo:** when an attempt gets a photo (taken by hand, or the bridge's camera frame), Claude looks at it and *suggests* how it went (Worked, Partly or Spaghetti) and which failure tags fit, from the built-in list. Spaghetti, warping, layer shift, stringing and the rest each come with a short reason.
  - It only ever suggests. Like the bridge's suggested tag (#24), the suggestion is pre-selected and clearly marked "suggested" in the attempt sheet, and the person confirms or changes it. It never sets an outcome on its own.
  - It reads the attempt's large photo variant from R2 (already resized in the browser) and returns a structured output whose tags are an enum of the built-in tag slugs.

## Next: agents using the service

- [x] Agent identities and scoped tokens ("via Claude for Alex" in the journal): named agents with bearer tokens in four scopes, shown quietly as "via"; see [docs/api.md](api.md)
- [x] MCP server on the Worker: search, what worked, a build's story, capture idea, start, log and finish attempt, spools and slots; see [docs/mcp.md](mcp.md) and [the decision](decisions/0014-mcp-hand-written-stateless.md)
- [ ] OAuth for the MCP server, so clients that insist on it can connect (tokens work today)
- [ ] OpenAPI from the zod schemas (a build's whole story as markdown is done: `GET /api/builds/:id/story.md`)
- [ ] Events: a cursor and webhooks (the cursor is done: the change feed, `GET /api/changes`; webhooks are left)
- [ ] Resident agents, suggest-only: failure coach, idea scout, label photo to spool fields, weekly digest
- [ ] Slicer folder watcher: uploads each exported .gcode.3mf and starts a "still printing" attempt

## Deploy

- [x] Deployed to https://spaghetti.day with D1 and R2; one-step `pnpm ship`. Adding the two people is the last step (see [no CI deploys](decisions/0011-no-ci-deploys.md))

## Done (v1)

- [x] Phase 1 foundation and design system (#2) · docs/printer.md (#1) · .3mf reader (#3)
- [x] Phase 2 capture and ideas (#4) · dark mode and offline shell (#5)
- [x] Phase 3 builds and attempts (#6) · offline reading and finishing (#7)
- [x] Phase 4 journal, search, what worked (#8) · command palette (#9)
- [x] Phase 5 Pantry, Printer page, .3mf on attempts (#10) · fresh-eyes pass (#11) · recipe note cards (#12)

## How sessions work here

Each UI pull request shows 390/1440 px screenshots in light and dark and waits for review (see "Screenshots" in [AGENTS.md](../AGENTS.md)); fctl's review agents check the code. Sessions touching the same files run one after another.
