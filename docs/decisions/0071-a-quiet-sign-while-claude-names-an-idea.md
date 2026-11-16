# 0071. While Claude names an idea, its title's place says so, and the server says when

Status: Accepted

**Decision:** While Claude names an untitled idea ([0070](0070-claude-names-an-idea-saved-without-a-title.md)), the place where its title will land shows it: on the Ideas card and the Journal row a `NamingSkeleton` (Claude's sparkle, breathing, before a shimmer the length of a short title; "Naming…" for screen readers), and on the idea page the title field's placeholder reads "Naming…" with a working `ClaudeLine`, "Claude is naming it", under it. When the title lands it fades in as before; the page's line becomes "Named by Claude". Never a spinner. A title typed on the page ends it at once.

**The server says, the client doesn't guess:** an item carries `titleJob` (`naming` while its `item_titles` job is open, `done` once it ran, null for an idea never asked and for one with a title). So that the sign shows from the first save of a photo-only capture, whose photos come after the idea, the outbox tells `POST /api/items` how many photos are on their way (`photos`); the job starts with the idea and, after its short wait, waits up to eight more seconds for the first photo. A job that ends without a title (a refusal, an error, the day's cap, a person's title, a link, a build) writes to the change feed, so the screens drop the sign at once. Without the key there is never a job, so never a sign.

**It stops by itself:** the screens show it for at most 15 seconds from when the job began (`shared/naming.ts`), then the idea reads "Untitled idea" as before; a title that comes later still fades in.

**Why a shimmer on the lists:** it is the design system's loading look and both lists already load it, so the sign costs nothing in their first load (the Journal was at its ceiling); the idea page has room to say it in words.
