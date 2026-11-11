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
| [0010](0010-optional-read-only-printer-bridge.md) | An optional, read-only printer bridge (not built yet) | Accepted |
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

## Format

Copy this into `NNNN-short-name.md` (next free number), keep it to a screen, and add a row above. A decision that changes gets a new record that says it supersedes the old one; set the old one's status to `Superseded by NNNN`.

```markdown
# NNNN. Title, as the decision

Status: Accepted | Open | Superseded by NNNN

**Decision:** one or two sentences.

**Why:** the reason, in a few lines.

**Consequences:** what this rules out or requires of the code, and what would make us revisit it.
```
