# 0050. A model can be sliced lying on another face; the original stays as it is

Status: Accepted

**Decision:** A model's slicing settings (decision 0047's shape) gain `orientation`: the direction in the model's own axes that points down, a unit vector, or null for the way the file lies. "Slice with…" shows the faces the model can rest on as "Lay it down" tiles, under Supports and above the Filament: "As designed" first and picked by default, then up to five faces, each a small plate picture of the model lying so, with how tall it stands. Picking one changes the settings like any other: it is kept on the model and sliced again in the background, with before → after and an Undo (decision 0049), and the card's line says "on its side" (or "upside down"). The slice worker turns the mesh (`layMeshDown` in `shared/mesh.ts`) before it scales and arranges it, so the engine only ever sees a mesh: OrcaSlicer's and, later, slicer-rs's alike. The original file is never changed; a 3MF project's own layout is rearranged when it is turned.

The faces come from `restingFaces` in `shared/mesh.ts`: the faces of the model's convex hull that its centre of mass sits over (dropped onto the face, the centre of mass lands on it), nearly coplanar ones (within 4°) merged, rounded-off slivers (under 4% of the hull's surface) left out, largest first. A box has six, a cylinder its two ends. The search and the pictures run in a worker the first time the settings open; a phone doesn't search a model over the phone-memory line (100 MB, `tooBigForPhone`, decision 0048) and offers only "As designed".

**Why:** Carl Oscar asked for fin supports; Support Fins pay off when a part is laid on its side for strength, which Spaghetti couldn't do (it slices a model the way its file lies, see the proposal in `docs/proposals/fin-supports.md`). Marie answered (Nov 13): lay it down first, fins after. Laying a part on its side is useful on its own: a part is strongest across its layers, and a face that lies flat prints without support under it.

**Consequences:**

- `orientation` is in the API's `SlicingSettings` (null by default, so stored settings from before read as "as designed").
- slicer-rs needs no change: it takes the turned mesh the worker gives it. `slicer-rs/bench/setup.mts` writes a setup from the app's settings without turning anything, so a comparison of a turned model turns the mesh first.
- The face search is on the convex hull, not the model: a model with a hollow or a stepped underside rests on its hull's faces, which it may touch only at a few points. Choosing among the pictures is how people see that.
- The plate picture of each choice is drawn in the first filament's colour.
