# 0054. Removing a saved photo takes two taps, never from the hero

Status: Accepted (amended Nov 16, 2026: the hero's X is gone)

**Decision:** Removing a saved photo or file takes two deliberate steps, and the Undo toast still follows; there is still no dialog.

- An idea's or build's photos come off in the thumbnail strip, not on the big photo: the thumbnail showing carries a small "…", and a second tap on it, a finger held on any thumbnail, or a right click opens a small menu (Make cover · Remove photo; a sheet on phones, a popover from the thumbnail on desktop). Remove there goes at once, with Undo. Nothing on the hero photo removes or reads as "close": it has only its upload badge (and a finished build's "Final print" chip). A hero with one photo still has its strip, so the menu is always there.
- A saved file's Remove (an idea's or build's files, a twist's model, an attempt's file in its sheet) is in a "…" menu beside its Download, not a bare X.
- An attempt's saved thumbnails in its edit sheet keep `ConfirmRemove`: the X first turns into a "Remove" pill where it sits, and a second tap removes. It falls back after 3 seconds, on a tap elsewhere or on Escape.
- Drafts (capture sheet, Log attempt, not yet saved) keep their one-tap X, photos and files.

**Why:** Carl Oscar removed photos by accident with a thumb on the X. The first fix (two taps on the X, Nov 2026) wasn't enough: the 44 px dark round X sat top-right on every hero photo, just under the back bar, where a hand expects "close" or "back", and they still hit it ("I've accidentally clicked it several times", Nov 16; phone audit, session 1414). It was the loudest control on the page's most important picture, for its rarest action. It is a narrow exception to [0006](0006-soft-deletes-with-undo.md): undo alone wasn't enough where the control sits on the picture itself.

**Consequences:** `ActionMenu` / `MoreMenu` (ui) hold the rare actions on a thing; `PhotoMenuDot` marks a thumbnail's menu; `useLongPress` (lib/long-press.ts) is the hold. `PhotoViewer` takes no remove. `ConfirmRemove` stays for an attempt sheet's thumbnails. Other deletes stay one tap with Undo.
