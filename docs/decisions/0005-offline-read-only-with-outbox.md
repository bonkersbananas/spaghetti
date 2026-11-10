# 0005. Offline, saved data is read-only, except captures and finishing a print

Status: Accepted

**Decision:** Without a connection the app shows what it last saw, read-only. The two things that work offline are capturing (a new idea, note or photo) and finishing a print (giving an attempt its outcome); both go through the IndexedDB outbox and are sent when the connection returns.

**Why:** the printer is often in a garage or basement with bad signal, and those are the two moments you can't wait for. Letting every edit happen offline would need conflict handling between two people, which isn't worth it for a notebook.

**Consequences:** every screen that edits saved data uses `useReadOnly` / `canEdit` (`lib/read-only.ts`), and a screen that should open offline needs its query root in `PERSISTED_ROOTS`. Outbox writes carry client-chosen ids so they are idempotent, and the server only fills what is empty when an offline finish arrives. Editing offline would need a new decision about conflicts.
