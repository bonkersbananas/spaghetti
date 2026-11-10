# 0006. Deletes are soft and undoable, with a 30-day purge

Status: Accepted

**Decision:** Deleting sets `deleted_at`; a toast offers undo, and there is no "are you sure?" dialog. A daily cron (`purgeDeleted`) removes rows and R2 objects 30 days after deletion.

**Why:** the design rule is to never lose work and never slow the person down. Undo is faster and kinder than a confirmation, and a month's grace covers a delete noticed later.

**Consequences:** every list and search query filters out deleted rows, and a child is hidden while its parent is deleted (photos of a deleted attempt, files of a deleted build). Each delete has a restore endpoint.
