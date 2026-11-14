# Decision records

One short record per settled decision, including the things we decided **not** to do. Read the list before proposing a feature that might already have a "no" attached, and add a record when a decision is made in conversation, in a review or in an issue, so the next agent doesn't have to ask again.

| # | Decision | Status |
|---|---|---|
| [0001](0001-cloudflare-workers-d1-r2.md) | Cloudflare Workers, D1 and R2, running locally and in Docker on workerd | Accepted |
| [0002](0002-two-people-no-sign-up.md) | Two people, no public sign-up, no teams or roles | Accepted |
| [0003](0003-no-bambu-dependency.md) | Never depend on a Bambu service | Accepted |
| [0004](0004-photos-resized-in-the-browser.md) | Photos are resized in the browser; the Worker has no image library | Accepted |
| [0005](0005-offline-read-only-with-outbox.md) | Offline, saved data is read-only, except captures and finishing a print | Accepted |
| [0006](0006-soft-deletes-with-undo.md) | Deletes are soft and undoable, with a 30-day purge | Accepted |
| [0007](0007-inbox-is-a-uniform-grid.md) | The inbox is a uniform 4:5 grid, not masonry | Accepted |
| [0008](0008-spools-are-the-pantry.md) | Spools are called the Pantry | Accepted |
| [0009](0009-filament-tracked-in-grams.md) | Filament is tracked in grams, automatically (not built yet) | Accepted |
| [0010](0010-optional-read-only-printer-bridge.md) | An optional, read-only printer bridge | Accepted |
| [0011](0011-no-ci-deploys.md) | No CI deploys | Accepted |
| [0012](0012-one-printer-the-x2d.md) | One printer, the X2D | Accepted |
| [0013](0013-bambu-studio-and-orca-files-only.md) | Only Bambu Studio and Orca files are read | Accepted |
| [0014](0014-mcp-hand-written-stateless.md) | The MCP server is hand-written, stateless and calls the API | Accepted |
| [0015](0015-share-targets-by-device.md) | Sharing in: a share target, an iOS Shortcut and a bookmarklet | Accepted |
| [0016](0016-web-push-nudges.md) | "How did it go?" arrives as a web push nudge, once, answerable in a tap | Accepted |
| [0017](0017-recipes-are-frozen-attempts.md) | A recipe is a named, frozen copy of an attempt that worked | Accepted |
| [0018](0018-upkeep-and-drying.md) | Upkeep is a list with intervals, due-ness is a fact, and it nudges at most once a day | Accepted |
| [0019](0019-claude-drafts-ideas-from-model-pages.md) | Claude drafts an idea from a model page, in the background, only into empty fields | Accepted |
| [0020](0020-started-ideas-stay-and-scrap-returns.md) | Started ideas stay in Ideas, scrapping a build returns it, and deletes can be found | Accepted |
| [0021](0021-profile-pictures.md) | Profile pictures are small squares cropped in the browser, stored in R2 under a versioned address | Accepted |
| [0022](0022-parts-are-optional-counts-live-on-attempts.md) | Parts are optional, and good-piece counts live on attempts | Accepted |
| [0023](0023-claude-reads-a-print-from-its-photo.md) | Claude suggests how a print went from its photo, and only suggests | Accepted |
| [0029](0029-oauth-small-and-on-d1.md) | OAuth for the MCP server is a small implementation on D1, and a connected app is an agent | Accepted |
| [0027](0027-failure-coach-suggests-what-to-try-next.md) | A failure coach suggests what to try next, and only suggests | Accepted |
| [0034](0034-shopping-list-links-not-prices.md) | The shopping list keeps links (shop, Prisjakt), not prices, in an order people set | Accepted (prices: see 0041) |
| [0024](0024-comments-read-state-and-push-batching.md) | Comments between the two of you: read state per person, one push for a burst | Accepted |
| [0025](0025-webhooks-signed-from-the-cron.md) | Webhooks are queued in D1, sent by the existing cron, signed with HMAC-SHA256 under a secret kept encrypted | Accepted |
| [0026](0026-passkeys-sign-in-links-and-invites.md) | Passkeys, single-use sign-in links and invites, all in the app; password stays as the fallback | Accepted |
| [0028](0028-wishlists-per-person-shared-by-default.md) | Each person keeps a ranked wishlist of ideas, shared by default | Accepted |
| [0030](0030-the-week-is-computed-with-one-paragraph-by-claude.md) | The week is computed, with one paragraph by Claude and one push on Sunday evening | Accepted |
| [0031](0031-claude-reads-a-spool-label-from-its-photo.md) | Claude reads a spool's label from its photo, and only fills what is empty | Accepted |
| [0032](0032-search-reads-questions.md) | Search reads questions: filler, outcome, time, names, Swedish twins and typos, in the Worker, with no new index | Accepted |
| [0033](0033-mac-bridge-paired-by-code.md) | The bridge runs on a Mac as one program, paired with a short code | Accepted |
| [0035](0035-a-landing-page-at-the-root-for-visitors.md) | A landing page at the root for visitors, the app for the two people | Accepted |
| [0036](0036-the-3d-view-reads-the-slicer-file-in-the-browser.md) | The 3D view reads the slicer file in the browser and loads only when asked for | Accepted |
| [0037](0037-e2e-tests-what-matters-quickly.md) | The end-to-end tests check what the two people use, quickly: phone width for the core loop and `@phone` tests, no axe, timing on main only | Accepted |
| [0038](0038-reactions-a-curated-six.md) | Reactions: a curated six on ideas, builds and comments, your own included | Superseded by 0042 |
| [0039](0039-no-page-zoom-photos-zoom-in-place.md) | No page zoom on touch screens, photos zoom in place, text follows the phone's size setting | Accepted |
| [0040](0040-the-idea-scout-suggests-three-models-a-week.md) | The idea scout suggests three models a week, checked for dead links, and only suggests | Accepted |
| [0041](0041-shopping-list-reads-the-prisjakt-pages-people-link.md) | The shopping list reads the Prisjakt pages people link (picture, cheapest offers), and nothing more | Accepted |

## Format

Copy this into `NNNN-short-name.md` (next free number), keep it to a screen, and add a row above. A decision that changes gets a new record that says it supersedes the old one; set the old one's status to `Superseded by NNNN`.

```markdown
# NNNN. Title, as the decision

Status: Accepted | Open | Superseded by NNNN

**Decision:** one or two sentences.

**Why:** the reason, in a few lines.

**Consequences:** what this rules out or requires of the code, and what would make us revisit it.
```
| [0042](0042-reactions-are-any-emoji.md) | Reactions are any emoji: a quick row, a full searchable picker, and a line of them on the Ideas and Builds cards | Accepted |
| [0043](0043-twists-are-models-we-print-our-own-way.md) | A twist is another person's model, changed our way: kept with its source, its changes and a recipe | Accepted |
| [0044](0044-phones-have-no-today-tab.md) | Phones have no Today tab: the Journal opens on a Now block and Workshop is the fourth tab | Accepted |
| [0045](0045-ideas-keep-slicer-files.md) | An idea keeps slicer files (.3mf, .gcode.3mf), which stay with it as a build and count as "has a model" | Accepted |
| [0046](0046-models-are-sliced-in-the-browser.md) | An .stl or plain .3mf is kept as it is and sliced in the browser with OrcaSlicer's own engine, its .gcode.3mf kept beside it | Accepted |
| [0047](0047-slicing-settings-in-one-shape.md) | Slicing settings are one shape in people's words (quality, strength, supports, brim, filament, plate, nozzle, scale), mapped to OrcaSlicer in one place | Accepted |
| [0048](0048-big-files-go-in-parts.md) | Files up to 250 MB are kept; over 32 MB they go to R2 in multipart parts through the Worker, with progress and a retry on the card | Accepted |
| [0049](0049-a-model-keeps-its-settings-and-one-slice-to-undo.md) | A model keeps its slicing settings, is sliced again in the background with the slice there kept in view, and keeps one slice to undo | Accepted |
| [0050](0050-a-model-can-be-sliced-lying-on-another-face.md) | A model can be sliced lying on another face: its settings gain an orientation, chosen from plate pictures of the faces it can rest on, and only the slice is turned | Accepted |
| [0051](0051-slicing-defaults-live-on-the-printer-page-recipes-keep-slices.md) | The workspace's slicing defaults live on the Printer page, and recipes keep the slicing settings that worked and slice a model in one tap | Accepted |
| [0052](0052-fins-are-built-into-the-model-when-it-is-sliced.md) | Supports gain Fins: Support Fins (vendored, MIT) builds breakaway fins into the model in the slice worker, loaded only when picked | Accepted |
| [0053](0053-a-twist-keeps-its-adapted-model.md) | A twist keeps its adapted model (`twist_files`), sliced like an idea's, and "Print it" carries the slice into the build | Accepted |
| [0054](0054-removing-a-saved-photo-takes-two-taps.md) | Removing a saved photo takes two taps in place, still with Undo (an exception to 0006) | Accepted |
| [0055](0055-spaghettis-own-slicer-beside-orcaslicers-engine.md) | Spaghetti's own slicer (Rust, released as WebAssembly) slices a model that picks it, and OrcaSlicer's engine steps in for what it can't do yet, the card saying why; OrcaSlicer stays the default for now | Accepted |
| [0056](0056-each-nozzle-slices-with-its-own-presets-and-qualities.md) | Each nozzle size slices with Bambu's own presets and the qualities keep their names at each nozzle's heights; every slice is for the main nozzle, and a line says so when the two fitted differ | Accepted |
