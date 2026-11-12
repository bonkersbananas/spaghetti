# 0044. Phones have no Today tab: Journal opens on a Now block, and Workshop is the fourth tab

Status: Accepted

**Decision:** On phones the tab bar is Ideas · Builds · (+) · Journal · Workshop. What Today showed is spread to where it belongs: the Journal opens with a **Now** block (the prints on the bed with their camera and Finish, the other person's new comment, due upkeep, and the scout's picks as one row), then the notebook; Up next stays on Ideas, Pick up again on Builds, the printer's loadout and upkeep on the Printer page, the month in the Journal's headings. Workshop is a small hub page of three tiles (Pantry, Printer, Shopping list). Phones open on the Journal. `/today` redirects to `/journal` on phones only (push notifications, the share target, bookmarks and the Home Screen icon's `start_url` keep working); desktop keeps Today in its sidebar and opens on it, since it has room for the columns.

**Why:** Marie said on Nov 12 that Today feels unnecessary on a phone and could be part of the Journal or something smarter. Most of its blocks were already somewhere else; the unique part, the print on the bed, is the first thing the Journal now shows.

**Consequences:** "check the print" is still zero taps (the Journal opens on it) and "snap the print" is still one (the camera on the card). Snapping from any screen is not possible without opening the Journal; if that is missed, a "now printing" strip above the tab bar (proposal B) is the follow-up. The Now block is lazy and phone-only so Journal's first load stays small. The account sheet no longer lists the workshop.
