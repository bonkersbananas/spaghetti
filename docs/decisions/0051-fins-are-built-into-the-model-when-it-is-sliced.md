# 0051. Fins are built into the model when it is sliced

Status: Accepted

**Decision:** Supports gain a fourth choice, **Fins** ("breakaway fins built into the model"), beside Off, Where needed and Everywhere (decision 0047's `supports` is now `off`, `where-needed`, `everywhere` or `fins`). A model sliced with Fins has the fins of [Support Fins](https://github.com/gittrahan/support-fins) (MIT; the technique is Slant3D's) appended to its mesh, in the slice worker, after it is turned (decision 0050), scaled and put on the plate; OrcaSlicer is told supports off. The fins are in the G-code like any wall, so the 3D view and the plate picture show them; the original file is untouched. The card's line says "fins".

The engine is vendored unmodified in `vendor/support-fins/v1.0.6/` (release v1.0.6, with its licence, and the 71 files its plugin entry `plugins/shared/engine/fins_entry.js` imports: plain mesh math, no dependencies, no WebAssembly). `src/client/lib/slicing/fins.ts` loads it with a dynamic import, so it is a chunk of the slice worker that nobody downloads before a model is sliced with Fins; no screen's first load grew (`e2e/first-load.spec.ts`). It is called as the Orca, Cura and Fusion plugins call it (`computeFins`: the part as it lies on the plate in, fin triangles in the engine's seated frame out, mapped back by its offset) with the layer height and nozzle of the settings and the engine's own defaults for the rest. Updating is a deliberate act: read the project's changelog, copy the new tag's files into a new folder, move the `@support-fins` alias.

**Why:** Carl Oscar asked for fin supports beside the other support types; Marie answered (Nov 13): lay it down, then fins. Fins pay off when a part lies on its side for strength, which decision 0050 allows. Because the fins are part of the mesh and not a slicer setting, they work the same with any slicer, the Rust one included.

**Consequences:**

- Orca cannot see fins as supports (they are separate solids a support gap under the part), so with Fins it still reports a floating part that the fins hold up. Spaghetti shows the floating caution only for a model with no supports at all; the drying-rack fixture sliced with fins is checked for an object that grew (its weight) and no caution.
- The engine is young and changes often. The pin is the only way it changes here, and the test slices a fixture through it.
- Fins are made per object of the plate, from the part as placed. A model of several objects gets fins for each.
- A slice with Fins takes a few seconds more than the same without (the engine builds the fins in the worker, then Orca slices the larger mesh).
