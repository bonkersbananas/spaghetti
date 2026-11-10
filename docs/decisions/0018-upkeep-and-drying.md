# 0018. Upkeep is a list with intervals, due-ness is a fact, and it nudges at most once a day

Status: Accepted

**Decision:** printer maintenance is a short editable list (seeded for the X2D) where each task has an interval in print hours and/or days, whichever comes first. Print hours are derived from attempts, never stored; "Done" stores who, when and the hours at that moment. Due is shown as a fact (a meter and a sentence), never an alarm colour. Push: one nudge when a task becomes due, at most one a day for the whole printer, to devices that switched it on, outside quiet hours. Drying: a per-material "stays dry for" window (editable, kept with the printer's setup); a spool past it says "Dry it before printing".

**Why:** prints fail for boring reasons. The app already knows the hours and each spool's dried date, so it can say so quietly.

**Consequences:** the starting intervals and windows are unconfirmed for the X2D (docs/printer.md marks them [uncertain]). Removing a task is a soft delete with undo; "Done" can be taken back.
