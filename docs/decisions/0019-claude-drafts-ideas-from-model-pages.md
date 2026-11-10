# 0019. Claude drafts an idea from a model page, in the background, only into empty fields

Status: Accepted

**Decision:** When a capture is just a MakerWorld, Printables or Thingiverse link, or someone taps "Draft from this page" on an idea with one, Claude (`claude-opus-5-5` through the official `@anthropic-ai/sdk`) reads the page and drafts the idea: a title, a short note in our voice, the designer, license, suggested material, plate and settings, and up to four of the model's pictures. The first picture becomes the cover.

**How it stays calm:**
- Capture never waits. The idea is saved with its link at once; the draft is a row of its own (`item_drafts`) that shows "Reading the page…" and fills in afterwards. The other person sees it through the change feed.
- It only fills what is empty (a title that is empty, a note that is only links, an idea with no photos), and each write is conditional in the database too. What it wrote is marked "Drafted by Claude" for as long as the text is still its own, with Undo (also a toast on the device that has the idea open). Designer, license and the settings it found are kept apart from the note, as "From the page".
- It fails quietly: a page that can't be read, a refusal, a timeout or the day's cap leave the idea as captured, with one line and a retry.
- Without `ANTHROPIC_API_KEY` nothing about it shows (`GET /api/features`). People only: a signed-in person, or a sharing token whose only scope is `capture` (the iOS Shortcut), never an agent with more scopes (MCP). 30 calls a day for the workspace.

**Safety:** the Worker never fetches an arbitrary page for this. Anthropic's server-side web fetch tool (`web_fetch_20260209`) does the reading, with `allowed_domains` limited to the three sites; the page's text is treated as data, and the answer is constrained to a JSON schema (`output_config.format`). Pictures are downloaded by the Worker only from the sites' image hosts (`src/shared/model-links.ts`), redirects not followed, and stored `needsResize` for a browser to make the thumbnails ([0004](0004-photos-resized-in-the-browser.md)). The request carries no personal details, only the link.

**Why the browser keeps a request open:** an Opus call that fetches a page can take longer than the 30 seconds `waitUntil` allows after a response. So the browser that saved the idea asks `POST /api/items/:id/draft` and the Worker does the call inside that request (no wall-clock limit while the client waits, the same on the deployed Worker and on workerd locally). Anything else that starts a draft (the capture endpoint for the Shortcut and bookmarklet) uses `waitUntil`; and the job row is the fallback for both: the 5-minute cron picks up any draft nobody has worked on for four minutes, twice at most, then marks it timed out. Workers Queues or Durable Objects would work too, but need a binding that the local container doesn't have.

**Left out:** server-side refusal fallbacks (a refusal is shown as a failed draft with a retry); reading a print from a photo (the second roadmap item); an `import_idea` MCP tool.
