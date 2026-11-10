# 0012. One printer, the X2D

Status: Accepted

**Decision:** The app is built for one printer, a Bambu Lab X2D (likely the Combo with an AMS). There is one `printer` row, and no list of printers.

**Why:** that's the printer these two people own. A printer picker, per-printer profiles and fleets would add UI to every screen for no one.

**Consequences:** the printer's details (nozzles, AMS slots A1–D4 and Ext, build volume) are built in; see [docs/printer.md](../printer.md). A second printer would change the schema, the Printer page and attempts, so it needs a new decision first.
