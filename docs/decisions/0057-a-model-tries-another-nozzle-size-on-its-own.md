# 0057. A model can try another nozzle size on its own, and a file still prints through the main nozzle

Status: Accepted (amends [0056](0056-each-nozzle-slices-with-its-own-presets-and-qualities.md))

**Decision:** "Slice with…" offers the nozzle size for a model: 0.2, 0.4, 0.6 and 0.8 mm, first under More (phone sheet, desktop panel and a twist's settings are the same component), where the qualities that depend on it are one tap above. The sizes fitted are marked: a solid dot for the main nozzle, a ring for the other when it differs. Picking a size re-slices that model for it with that nozzle's own presets and qualities (`qualitiesFor`, a named quality keeping its name as `withNozzle` does), and the card's before → after with Undo says what changed ("the 0.2 mm nozzle").

The size is the model's own setting, like its quality: saved with its settings (`nozzlePicked` beside `nozzle`), kept across reloads and cleared by "Back to the usual settings" (new in a model's settings, with an undo toast). Picking the size the main nozzle has is no pick: the model follows the main nozzle again. A model that never picked a size follows the main nozzle's size when it changes on the Printer page (`modelSlicing`), its quality keeping its name; its old slice then says it was made for the other size, with the one-tap "Slice for the 0.2 mm".

The Printer page's slicing defaults do not get the choice: the nozzle there is the one their layer height was set for, and every new model slices for the main nozzle. When two sizes are fitted its line says so, and that a model tries another size under More.

Printing stays safe and never blocked: a file prints through the main nozzle, so a slice for a size that isn't fitted there says so wherever it could be printed. The card names the nozzle only when it differs ("Sliced for a 0.2 mm nozzle; the main nozzle has a 0.4 mm.", with its button back to the main nozzle's size), the sheet says it under the Filament, and a twist's "Print it" carries one calm line ("Sliced for a 0.2 mm nozzle: fit it as the main nozzle before printing"). People may swap the nozzle first. Nothing offers printing through the auxiliary nozzle (0056, unchanged); the ring only says a size is fitted there.

**Why:** Carl Oscar (Nov 14), after the 0.2, 0.6 and 0.8 mm nozzles went live: he wants to change and try-slice different nozzle settings without changing the main nozzle on the Printer page too, which changes every model. 0056's one line "to slice for the 0.2 mm, fit it as the main nozzle" was the only way to see what a 0.2 mm slice takes; the choice had been under More for slicing ahead of a swap already, and this makes it a deliberate, marked one with the safety line where a file could be printed.

**Consequences:**

- 0056's "Which nozzle" paragraph is replaced by the above where it says new models only slice for the main nozzle and the sheet shows a line where a choice would be.
- Both slicers take the same setup for any of the four sizes (`sliceSetup`); a size they don't slice falls back as before (OrcaSlicer's engine steps in for ours).
- The auxiliary nozzle is still not a slicing choice; Spaghetti's own slicer brings it later.
