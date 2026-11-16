# 0066. "On the bed" means what is on the plate

Status: Accepted

**Decision:** "On the bed" names only prints physically on the printer's plate right now: attempts still printing, and those the printer saw stop that nobody has judged yet (Off the bed). It is never a build's stage. The stage `building` reads **In progress** everywhere it shows (the build page's chip, search, the command palette, Ideas' Started rows); Idea, Done and Shelved stay as they were. The Builds list opens with an "On the bed" section of those prints as Today's printing cards (drawn only when there are some), then "In progress" for the builds between prints (not drawn when they are all on the bed), each card with its last outcome and first failure tag. Reopening a shelved build says "Pick up again" (a done one still "Reopen"), and both toast "Back in progress".

**Why:** The phone and laptop design audits of Nov 16 both found the Builds list's "On the bed 7" holding three printing builds and four waiting for their next try, and a build with one Worked attempt wearing an "On the bed" chip, while Today, the Journal's Now and "Off the bed" already meant the plate. Standing at the printer, the words have to mean what is in front of you, and the prints there have to stand out.

**Consequences:** The code keeps the stage value `building`; only the words changed. `printingAttempts` (`lib/builds.ts`) decides what is on the bed for Today, the Journal, the sidebar and Builds alike, and `BedCards` draws it on Today and Builds. A pasta name for the stage ("Simmering") was considered and left out: stage words sit in search rows, chips and the palette, where plain words read faster.
