# Proposal: fin supports for models Spaghetti slices

Status: accepted (Nov 13): lay it down is [0050](../decisions/0050-a-model-can-be-sliced-lying-on-another-face.md), fins [0052](../decisions/0052-fins-are-built-into-the-model-when-it-is-sliced.md). Carl Oscar asked to look into fin supports beside the other support types, with [Support Fins](https://github.com/gittrahan/support-fins) as a lead.

## What the other support types are, and where they stand

Spaghetti slices models with OrcaSlicer's own engine (decision 0046). Its settings shape (decision 0047, `shared/slicing/settings.ts`) already takes every support Orca has. The settings on a model's card, which come in their own pull request after #210 and aren't on main yet, offer them:

- **Where** supports go: off, where needed (only under what would fall: floating parts, long ledges) or everywhere (every overhang past 30°): the Supports tiles.
- **What kind**: Orca's tree (organic), slim tree, strong tree and hybrid, and its normal (grid) and snug supports: "Kind of supports" under More.

Fins are not one of Orca's: until Support Fins they were drawn by hand in CAD, part by part.

## What fins are

Support Fins (MIT, `gittrahan/support-fins`; the technique is Slant3D's) adds breakaway support walls to the model itself: thin fins under the overhangs, joined to the part by one-layer horizontal tines that print as one bead and snap off clean, wedges under broad faces, a pad under a part that barely touches the plate, and sway braces that hold tall, slender parts steady. The fins are separate closed solids appended to the mesh, which the slicer unions with the part; the engine is plain mesh math in JavaScript, with no boolean kernel, made to run in the browser. Its point is orientation: a part tipped on its edge is often up to three times stronger than one printed flat, and fins make that orientation printable without a slicer's supports scarring the surface.

## How it would fit

1. A fourth choice under Supports, **Fins**, with its effect in words ("breakaway fins built into the model"), once the settings UI above is on main: it is the Supports tiles this adds to. The settings shape gains `supports: "fins"`; `orca.ts` maps it to Orca's supports off.
2. The slice worker (`lib/slicing/slice-worker.ts`), for an STL or plain 3MF sliced with fins, runs the engine's `buildFins` on the model's triangles (already read into the shared mesh code for the plate picture), appends the fin triangles to the object, and slices that with Orca's supports off. The engine loads only then, as its own chunk, in the worker.
3. The card's line says "fins", and the 3D view shows them, since they are in the G-code like any wall. The original stays as it was; only the sliced file has fins.
4. Because the fins are part of the mesh, not a slicer setting, they work the same with the Rust slicer (`slicer-rs/`) if it takes over from Orca's engine.

## What it would cost

- **Code:** the engine's core is about 80 modules and 820 kB of source, much of it comments (fins, walls and tines, wedges, the pad, sway braces, the plane and inside tests); what it weighs minified is to be measured, and it would all be lazy: nobody downloads it until they pick Fins. No WebAssembly is needed (the STEP importer and three-mesh-bvh it carries are for its own app). It would be vendored at a pinned release, unmodified, with its MIT licence, in its own folder, the way the slicing engine is pinned (`engine.json`).
- **Tests:** a fixture whose overhang fins hold up (the screenshot routes' drying rack), sliced with fins in Node through the host client as `scripts/slicer` does today, checked for an object that grew and a slice with no floating-part caution.
- **Upkeep:** the engine is young and changes often (about 200 test files; its sway braces and gussets were first printed in September and October 2026). Pinning means updating on purpose, after reading its changelog.

## The catch: orientation

Fins pay off when a part is turned onto its side for strength, which Spaghetti doesn't do: it slices a model the way its file lies. Under a part lying as designed, fins do roughly what "Where needed" does, at a cost in fin plastic and with less margin than Orca's own tested supports. So fins alone would be a fourth tile few would pick. With a way to lay a model on a side ("Lay it on its side": a short list of the faces it can rest on, each a picture of the plate), they become the reason to print it that way. Nothing finds those faces yet: `shared/mesh.ts` reads, writes, scales, mirrors and turns a mesh, no more.

## Proposal

Build it in two steps, each its own pull request:

1. **Lay it down:** a model's settings gain an orientation (the face it rests on), chosen from a few plate pictures under Quality; Orca slices the turned mesh. Most of the work is new mesh code in `shared/mesh.ts` that finds the faces a model can rest on: the faces of its convex hull with the centre of mass above them, largest first, turned flat with the existing `rotateMesh`, with unit tests on simple solids (a box has six, a wedge three).
2. **Fins:** the Fins tile, with the engine vendored at a pinned release and loaded in the slice worker only when picked, the drying-rack fixture sliced with fins in a test, and a decision record.

Until then, the support types Orca has are all there, and "Where needed" is the one to pick for a part that floats.
