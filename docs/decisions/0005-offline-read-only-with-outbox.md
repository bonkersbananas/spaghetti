# 0005. Offline, saved data is read-only, except captures and finishing a print

Status: Accepted

**Decision:** Without a connection the app shows what it last saw, read-only. The two things that work offline are capturing (a new idea, note or photo) and finishing a print (giving an attempt its outcome); both go through the IndexedDB outbox and are sent when the connection returns.

**Why:** the printer is often in a garage or basement with bad signal, and those are the two moments you can't wait for. Letting every edit happen offline would need conflict handling between two people, which isn't worth it for a notebook.

**Consequences:** every screen that edits saved data uses `useReadOnly` / `canEdit` (`lib/read-only.ts`), and a screen that should open offline needs its query root in `PERSISTED_ROOTS`. Outbox writes carry client-chosen ids so they are idempotent, and the server only fills what is empty when an offline finish arrives. Editing offline would need a new decision about conflicts.

**Amended (Nov 18): a field being edited stays editable.** When the connection drops while a title, a note or a "for" line of an idea or build, or a recipe's name or note, has the focus, that field stays editable instead of turning read-only (which lost the words typed next, and let the letters fall through to the global shortcuts). Its words autosave as usual, wait on the device (`lib/unsent.ts`, so a reload keeps them) and are sent the moment the connection returns, with "Saves when online" in the save status. This is `useKeepEditing` (`lib/read-only.ts`): only the field that had the focus is kept, and it follows `useReadOnly` again once it loses it. Everything else saved stays read-only offline. The same edit of a field the other person changed meanwhile follows the autosave rule that already holds (only the changed field is sent, and the later edit wins). The attempt sheet's fields are not covered yet. The hotkey handler also ignores letters that arrive within a second of a text field vanishing from under the focus.

