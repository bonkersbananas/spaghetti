# 0024. Comments between the two of you: read state per person, one push for a burst

Status: Accepted

**Decision:** Every idea and build has one short thread (`comments`: id picked by the client, `author_id`, `via` for an agent, `edited_at`, soft `deleted_at`). A person edits and deletes only their own comments (an agent only the ones it wrote); a delete has Undo and is purged after 30 days ([0006](0006-soft-deletes-with-undo.md)). Reading is **per person and per thread**: `comment_reads (user_id, item_id, read_at)` says how far someone has read, and the other person's comments created after it are unread. Opening a thread, or writing in it as a person, moves `read_at` forward (never back); an agent writing for someone is not that person reading. The unread marker on cards and in the palette comes from `GET /api/comments/unread`.

**Push:** a new comment sends one web push to the other person's devices that have push on (any subscription, outside quiet hours), "Marie on Tugboat" over the comment, opening the thread. A burst is one push: the Worker waits `PUSH_BATCH_MS` (20 s) after a comment, then claims every unnotified comment of that author on that item at once (`notified_at`, one conditional `UPDATE … RETURNING`), so later waiting calls find nothing left and the push says "3 new comments" with the latest. Quiet hours claim and send nothing: the unread marker is what they find in the morning.

**Why:** two people, one thread each, no need for per-message receipts or typing indicators; "read up to here" is one number and survives edits and deletes. Batching with a conditional claim needs no queue or timer storage on Workers (the wait is in `waitUntil`), and a retry or overlapping calls can't send twice.

**Follow-up:** comments are in search (`kind = 'comment'` rows in the FTS index kept by triggers, migration 0022; a hit shows as its idea or build with the comment as snippet and opens the thread with that comment lit) and Today has one quiet line for unread comments.

**Left out:** a separate toggle for comment pushes (turning push on is the consent), per-message "seen" marks, reactions and threads inside threads, and writing comments offline (offline is read-only, [0005](0005-offline-read-only-with-outbox.md): the draft is kept on the device instead).
