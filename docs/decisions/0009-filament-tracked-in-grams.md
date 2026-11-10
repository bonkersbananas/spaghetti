# 0009. Filament is tracked in grams, automatically

Status: Accepted (not built yet)

**Decision:** Carl Oscar chose to track filament in grams. A spool has a starting weight (1 kg by default). Each attempt's slicer grams per filament, read from its .3mf, come off the linked spool; a failed print counts in proportion to how far it got. The levels shown today (full, half, low, empty) follow from the grams, and can still be corrected by hand.

**Why:** a level set by hand drifts and can't answer "is there enough for this print?". The slicer file already says how many grams a print needs, so the app can keep the count without anyone weighing spools.

**Consequences:** this replaces the earlier plan of keeping rough levels only. A later session builds it: it needs a starting weight on the spool and a way to correct the remaining grams, and the linked spool comes from the attempt's `spoolId` on each filament. Until it is built, the levels stay hand-set and nothing deducts grams. "Not enough for this print" and a shopping list build on it ([roadmap](../roadmap.md)). Printing live from the printer still isn't involved ([0010](0010-optional-read-only-printer-bridge.md)).
