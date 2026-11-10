# 0020. Started ideas stay in Ideas, scrapping returns them, and deletes can be found

Status: Accepted (adds to 0006)

**Decision:**
- "Start building" doesn't take an idea out of Ideas. A build that began as an idea (captured, then started: `started_at` later than `created_at`; a build from scratch or from the bridge starts when it is created, so the two are equal) stays on the Ideas screen in a quiet "Started" section after the unstarted ideas, newest start first, six at most with a way on to Builds. No column: the two times tell.
- Deleting such a build **scraps** it: it goes back to being an idea (stage idea, not started) and its attempts are deleted with it, with an undo toast (`POST /api/items/:id/scrap`, `/unscrap`). Deleting an idea, or a build that never was an idea, deletes it as before (0006).
- Soft deletes are visible: **Recently deleted** (`/deleted`, `GET /api/deleted`, people only) lists ideas, builds and attempts deleted in the last 30 days with Restore and the days left, from the account menu and the foot of Ideas and Builds. An idea or build deleted with nothing in it is not listed.
- A new build from the New build tile that is left with nothing in it (no title, note, photo or attempt) deletes itself when you leave it, without a toast.

**Why:** an idea was lost when it was started and then the build deleted; people clean up after stray taps, and a missed undo toast shouldn't cost work. Keeping the one-item model (an idea becomes a build) means no second record to keep in step.

**Consequences:** the Ideas screen also reads the builds list. A scrap clears a finished build's final photo choice (the undo sends it back). Agents can't scrap, unscrap or read the deleted list (person-only).
