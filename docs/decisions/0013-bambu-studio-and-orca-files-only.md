# 0013. Only Bambu Studio and Orca files are read

Status: Accepted

**Decision:** Dropping a slicer file reads `.3mf` / `.gcode.3mf` files from Bambu Studio and Orca Slicer. Other slicers' files (PrusaSlicer, Cura) and plain `.gcode` are not read.

**Why:** these two are what the printer's owners use, and they share the same file layout. Each extra format is a reader to build and keep correct.

**Consequences:** the reader (`src/shared/threemf`) runs in the browser and only knows this layout; anything else is attached as a plain file or rejected with a clear message. Supporting another slicer is a new reader and a new decision.
