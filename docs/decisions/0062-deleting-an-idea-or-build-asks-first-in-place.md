# 0062. Deleting an idea or a build asks first, in place

Status: Accepted

**Decision:** The trash can on an idea's or a build's page first turns into "Delete this idea?" (or "Delete this build?", "Scrap this build?" for one that began as an idea) in the bar where it sits, with a tomato "Delete" and a "Keep" to go back. The second press deletes, and the Undo toast still follows. Keys follow the same two steps: plain Backspace and Delete no longer delete anything; ⌘⌫ (Ctrl+Backspace elsewhere) asks, and ⌘⌫ again or Enter confirms. Escape, "Keep" and a tap elsewhere back out. It is not a modal dialog. The keys do nothing inside a text field, where Ctrl+Backspace deletes a word. This is the same two-step pattern as [0054](0054-removing-a-saved-photo-takes-two-taps.md), applied to ideas and builds.

**Why:** Carl Oscar asked that Backspace on an idea or a build never delete it, and that deleting should need an extra confirmation, like the X on a photo, so it is not done by accident. It amends the "undo, not are-you-sure" rule of [0006](0006-soft-deletes-with-undo.md) for ideas and builds, the two things that hold the most work.

**Consequences:** `ConfirmDelete` (ui) is the one control; the page owns whether it is asking, so the key can ask. `ideaDelete`, `buildDelete` and `spoolDelete` are bound to ⌘⌫/Ctrl+Backspace. Spools (taking one out of the pantry), photos, attempts, comments and the rest keep their one step with Undo; a build page's key still deletes a picked attempt at once.
