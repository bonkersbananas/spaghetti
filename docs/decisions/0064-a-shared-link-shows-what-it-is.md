# 0064. A shared link shows what it is

Status: Accepted

**Decision:** A link to `/ideas/<id>`, `/builds/<id>` or `/twists/<id>` carries link-preview tags (Open Graph and Twitter) that anyone can read without signing in: the title (else the first line of the note), the rest of the text cut to 160 characters at a word, and the cover photo, served from `/og/<kind>/<id>.jpg`. The Worker answers these paths first (`run_worker_first`) and writes the tags into the app's `index.html` with `HTMLRewriter`; one small D1 read, never R2. A thing that is unknown, deleted, or has no text says only "Spaghetti" and the tagline, with the landing page's picture (`public/og.jpg`), so the tags don't tell whether an id exists. A thing with no photo uses the landing page's picture.

**What a link reveals without signing in:** the title, up to 160 characters of the note and the one cover photo of that thing, to whoever holds the link. Nothing else: no comments, reactions, attempts' notes, other photos, names or wishlists, and nothing of a deleted thing. The image route answers only for an existing, undeleted thing and serves the stored `large` variant when it is under 1 MB, else the `thumb`; the bucket itself stays private.

**Why:** Carl Oscar asked to paste a link in Slack or iMessage and have the preview show what it is. Ids are random UUIDs, so a link is as unguessable as the photo URLs of a shared album, and the other person already has the same access by signing in.

**Consequences:** The Worker can't transcode, so the picture is the stored WebP or JPEG as it is (Slack, iMessage, Facebook and X read WebP). Crawlers cache an unfurl: a link pasted before this shipped needs a fresh paste or `?v=2`. Someone who gets hold of a link can read its preview; deleting the thing closes it at once.
