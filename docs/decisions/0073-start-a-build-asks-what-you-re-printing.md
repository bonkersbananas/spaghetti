# 0073. "Start a build" asks what you're printing

Status: Accepted

**Decision:** "Start a build" (the empty Builds page's "Pick an idea to print") and the + / "New build" on Builds open a picker, "What are you printing?": a bottom sheet on phones, a dialog on desktop, loaded on its own (not in Builds' first load, warmed just after the page). It lists the ideas, Up next first, then those with a model (a file or a model link), then the rest, with the rows of "Add to a build" (`PickRow`), a search field, and arrows and Enter. Picking an idea is Start building (the same record becomes the build, with Undo) and opens its build. "Link or file" starts a build whose note is the model link, or that keeps the .stl/.3mf (picked, or dropped while the sheet is open). "Something new" opens a blank build. With no ideas it goes straight to link, file and new.

**Why:** in production 9 of 10 builds were opened from scratch and thrown away within minutes: an empty build page has nowhere to pick a model, a link or an idea.

**A blank build leaves no ghost:** "Something new" (and "From scratch") still make the record at once (`createBuild`, which twist printing keeps using), because a lazily made build would have touched the build page's every effect. Instead the ids of builds made this way are kept in localStorage, and the Builds page silently deletes one that is still empty (no title, note, photo, file or attempt) at the next visit (`sweepUntouched`), as `discardIfUntouched` does on leaving. A build someone typed into is kept.
