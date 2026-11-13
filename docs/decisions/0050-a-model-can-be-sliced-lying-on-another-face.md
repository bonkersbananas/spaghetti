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

## Update (Nov 13): faces it stands on at a few spots

Carl Oscar's steampunk glasses had no flat side, so they were offered none (the hull's faces were all dropped for touching the plate over under 4 % of the hull's surface), though they print fine lying on one. A hull face that fails the flat-contact test is now still offered when the corners that reach its plane (within 0.5 % of the model's longest side) span, as a convex hull seen along the face's normal, at least 6 % of the hull's surface and the centre of mass, dropped onto the plane, lands inside that span (`footprint` in `shared/mesh.ts`). Such a face has `spots: true`, and the tile's line says "touches the plate in a few spots: a brim helps"; flat faces come first, so the five tiles are filled by them before any spot face. Faces with a flat contact are unchanged, and nothing new warns: a slice that floats keeps its existing "Parts of it float in the air" caution.

Measured on the real glasses file (21 × 123 × 51 mm): no faces before, one after (on its side, 21 mm tall); sliced so, 1 h 03 min and 7.6 g against 1 h 17 min and 7.7 g upright, and the floating caution is gone. A box (6), the fusilli (2) and the Benchy-sized shapes with flat sides keep their faces; an L bracket goes from four faces to five, the extra one the slanted face across its hollow, offered as "a few spots".
