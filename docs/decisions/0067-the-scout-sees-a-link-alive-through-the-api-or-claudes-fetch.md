# 0067. The scout sees a link alive through MakerWorld's API, the page, or Claude's own fetch

Status: Accepted (amends the "Never a dead link" rule of [0040](0040-the-idea-scout-suggests-three-models-a-week.md); the drafts of [0019](0019-claude-drafts-ideas-from-model-pages.md) gain the API too)

**What happened:** the first two weekly rounds in production (the weeks of Mondays 2026-11-09 and 2026-11-16, run at 06:00 UTC on November 12 and 16) dropped all three of Claude's links as dead (`all_dead`, `dead: 3`), so the scout never showed anything. The round didn't record which links or why, so the cause can't be read back for certain. What could be checked:

- The drafts' Worker fetch of MakerWorld pages works from a person's request: 24 of the 25 MakerWorld drafts that recorded a page fetch (November 11 to 15) read it (`worker_fetch`, 200). One got a 403, and the same page read fine 14 seconds later, so MakerWorld's Cloudflare bot protection does challenge a Worker now and then. A Worker preview on Cloudflare's edge (CPH) read model pages with a 200 and a title. The scout runs from the cron, which Cloudflare may place in another data centre with other addresses, and from a data-centre address MakerWorld's page answers `403` with `cf-mitigated: challenge` ("Just a moment…"). That is the likeliest cause.
- MakerWorld's public design API (`/api/v1/design-service/design/<id>`) answers the same data-centre address with 200 and the design as JSON (the same object the page ships with, plus English translations), and a plain 404 for a number that doesn't exist.
- Claude's own web fetch can't read MakerWorld (`url_not_accessible`, decision 0019), so in those rounds Claude only had search results for MakerWorld.
- A second, separate hole: Thingiverse answers a thing that doesn't exist with 200 and its home page's title ("Thingiverse - The community for Open Hardware"), which the old check took for a live model. A made-up Thingiverse link would have been shown.

**Decision:** a suggested link is alive when one of these saw it alive, and its title and picture come from what saw it, never from Claude's words alone:

1. **MakerWorld's design API**, asked first for a MakerWorld link (one small JSON, answered where the page is challenged): its English title, its pictures. A 404 there is the model not existing, and the link is dropped without asking further.
2. **The page**, as the Worker fetches it ([0019](0019-claude-drafts-ideas-from-model-pages.md)'s fetch: only the two sites, redirects checked, public addresses). A page whose title is the site's own name, or a challenge's or an error's, names no model (a soft "not found") and isn't alive.
3. **Claude's own web fetch in this answer:** a page Claude's `web_fetch` read successfully in the same answer, at the same model's address, whose document title names a model (not the site, a challenge or an error). Its title (without the site's name after it) is the pick's title, and a picture is taken from the site's image hosts named in the page's text or by Claude. It is the second way when the Worker can't read the page (a plain 403, a challenge, a timeout), mostly Thingiverse's, since MakerWorld turns Claude's fetch away.

Search results alone never make a link alive: a search index says a page existed once, not that it is there. So the guarantee of 0040 stands: nobody is shown a link that neither the Worker nor Claude's fetch saw alive during that run.

**Why the round says more now:** `scout_rounds.detail` keeps how many searches and fetches Claude made, how each kept link was seen alive (`aliveBy`: `api`, `page`, `web_fetch`), and for each dropped link its address, its reason (`deadBy` counts: `not_found`, `no_model`, `challenge`, `http_<status>`, `unreachable`, `not_html`, `no_why`) and whether Claude's search had returned it (`inSearch`, which tells a made-up link from a real one the Worker couldn't read). They are public model addresses, nothing personal. [docs/deploy.md](../deploy.md) says how to read it and how to run a week again.

**Drafts:** the draft from a link reads the page first, as before, and asks MakerWorld's API when the page gives nothing, before falling back to Claude's web fetch (which MakerWorld refuses). `draft_runs.detail.source` says `worker_api` then, and `unread` says why the Worker read nothing. Production drafts weren't failing like the scout, but the one challenged draft would have been read this way.

**Left out:** trusting search results; a headless browser or a proxy to get past the challenge; Thingiverse's API, which needs a token.
