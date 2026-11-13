# 0054. Removing a saved photo takes two taps in place

Status: Accepted

**Decision:** The X on a saved photo (an idea's or build's photo viewer, an attempt's thumbnails in its edit sheet) first turns into a "Remove" pill where it sits; a second tap removes. It falls back after 3 seconds, on a tap elsewhere, on Escape or on a swipe to another photo. The Undo toast still follows, and there is still no dialog. Draft photos (capture sheet, Log attempt, not yet saved) keep their one-tap X.

**Why:** Carl Oscar removed photos by accident with a thumb on the X. It is a narrow exception to [0006](0006-soft-deletes-with-undo.md): undo alone wasn't enough where the control sits on the picture itself.

**Consequences:** `ConfirmRemove` (ui) is the one control; the viewer's X moved to the photo's top-right corner. Other deletes stay one tap with Undo.
