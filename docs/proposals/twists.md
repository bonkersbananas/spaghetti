# Proposal: a section for adapting existing models

Status: proposal, nothing built. Marie asked for "a Recipes section where adaptations to existing models are possible", and then for another name: the app already has recipes (an attempt's frozen print settings, [decision 0017](../decisions/0017-recipes-are-frozen-attempts.md)), which stay as they are.

The mock screens (`docs/proposals/mocks/*.html`, drawn with the real tokens) are in the pull request description.

## 1. A name

| Name | Why |
| --- | --- |
| **Twists** (pick) | A twist on a model, like fusilli is a twist of pasta. Short, reads as a noun and a verb ("make a twist"), and the tab bar and sidebar have room for it. |
| **Seasonings** | "Season to taste": the model is the dish, we adjust it to taste. Warm, but reads as settings (filament, temperature) before it reads as changes to a model. |
| **Reshapes** | Pasta shapes: the same dough, another shape. Clear about changing geometry, but wrong for "another material" or "0.2 looser", and a bit stiff. |

Pick: **Twists**. The rest of this document uses it.

## 2. What a twist is

A twist is the notebook page for one model we print our own way:

- **Source:** a link (MakerWorld, Printables, Thingiverse: `shared/model-links.ts`, the page's title, designer, licence and picture that an idea draft already reads) or a file we were given (an `.stl` or `.3mf`, kept in R2 like a slicer file, 25 MB cap), plus its picture.
- **What we changed:** a short list of changes, each a kind, a value and an optional few words: scale (84 %), fit tolerance (+0.2 mm), text ("Marie"), material (PETG, was PLA), a parametric value (wall 2.4 mm), or "other" with only words. Words first: a change is useful written down even if nothing in the app can apply it.
- **Result:** our file (the adapted `.3mf`/`.stl`, optional), and the print settings, which are **not copied**: a twist can point at a recipe or at the attempt that worked, so there is one place for "how to print" (recipes) and one for "what to print" (twists).
- **Printed:** the builds made from it, with their outcomes, so "did the 42 mm bin work?" is one glance.

How it relates to what exists:

| Thing | Answers | Link |
| --- | --- | --- |
| Idea / build | "What are we making, and how did it go?" | A build may say it prints a twist (`items.twist_id`, nullable). A twist may say which idea it came from (`from_item_id`). |
| Recipe | "Which settings worked for this filament?" | A twist may reference one recipe (`recipe_id`, no foreign key, like decision 0017). Frozen and untouched. |
| Twist | "This model, changed this way." | New table `twists`: id (client-picked), name, note, `source` (kind, link or file id, title, designer, licence, picture id), `changes` (JSON list, validated by zod in `shared/twists.ts`), `file_id`, `recipe_id`, `from_item_id`, soft delete (undo toast), change-feed entity `twist`. |

Making one takes seconds, from where the idea already is:

- **From an idea with a model link or file:** "Make a twist" in the card's menu and on the idea page. It opens a sheet with the source already filled (title, picture, designer from the draft) and one field: "What will you change?" Save keeps it; changes can be added later, one tap each.
- **From a build that worked:** "Save as twist" next to "Save as recipe" in the attempt menu: it takes the idea's source, the attempt's file and its recipe. Changes are empty until typed.
- **From capture:** a pasted model link plus words ("0.2 looser") can offer "Keep as a twist".
- **"Print it again"** on a twist starts a build (or idea) that points at it, with the file and recipe prefilled. A prefill only, like recipes.

Where it lives: **Twists** is a section in the sidebar (between Builds and Journal) and on phones under the workshop in the account sheet, not a fifth tab (the tab bar keeps four, as with Pantry). Search finds twists by name, note, source title and changes. Agents with the `capture` scope can add and read them (MCP `list_twists`, `add_twist`); deleting is for people.

## 3. Adapting in the app: what is feasible

Workers can't run native code, so everything below happens in the browser, in lazy chunks fetched only when someone opens the editor (like the 3D view, [decision 0036](../decisions/0036-the-3d-view-reads-the-slicer-file-in-the-browser.md)). Sizes are estimates until built, and gzip figures are marked as such.

| Edit | Feasible? | How, and how big | Value for two people at the printer | Effort |
| --- | --- | --- | --- | --- |
| **Scale, rotate, mirror a Bambu/Orca project `.3mf`, keeping plates and settings** | Yes | A project `.3mf` is a zip. Each object's placement is a 3×4 `transform` on the `<item>` in `3D/3dmodel.model` and per-plate data is in `Metadata/model_settings.config`, so a transform edit rewrites a few XML attributes and leaves geometry, plates, filament and project settings as they are. We already read the zip (`shared/threemf/zip.ts`); a zip writer is needed (`fflate`, about 8 kB gzip, or `CompressionStream`). Stale `plate_*.json`, thumbnails and `slice_info` should be dropped so Studio re-slices. A **sliced** `.gcode.3mf` can't be edited (its G-code would no longer match): say so. Needs a spike on real files (several objects, painted colour, modifiers, plate-relative coordinates). | High: "scale to fit 42 mm" is the most common change. | Medium (about a week with the spike) |
| **Scale, mirror, rotate an `.stl`** | Yes | three.js `STLLoader` (already a dependency, 0.187) and `STLExporter`, or edit the vertices directly. Exports a new `.stl` (or a minimal `.3mf`); Studio opens both. About 6 kB gzip on top of three.js, which is already lazy. | High, small | Small |
| **"Fit to N mm" and tolerance helpers** | Yes | Read the bounding box (STL vertices; 3MF vertices) and compute the scale; for tolerance, offering "+0.2 mm" as a **recorded value** is easy, but actually offsetting a mesh (inflating or shrinking faces) is not: non-uniform offsets break thin walls. Uniform scale by (size + tol) / size is a fair approximation for simple parts and we should say so. | Medium | Small |
| **Add text (emboss/deboss)** | Possible, with work | three.js `TextGeometry` needs a font file (a typeface JSON of 50–200 kB per font, subset to Latin) and a boolean to merge or cut it into the model: `manifold-3d` (WASM, Apache-2.0, roughly 0.5–1 MB, robust) or `three-bvh-csg` (about 30 kB, faster to load, flaky on non-manifold models). Picking the face and the position on a phone is the hard part: a 3D placement UI with a tap-to-place and a nudge. Bambu Studio can already add text itself in its own editor, which is the fallback. | Medium-high ("a name added" was asked for) | Large |
| **OpenSCAD in WASM for `.scad` models** | Possible, rarely useful | `openscad-wasm` is **GPL-2.0**; its npm package is about 11–14 MB unpacked (a gzip figure isn't published, perhaps 4–5 MB). It renders in seconds with the Manifold backend on a laptop, slower on a phone, and uses a lot of memory. Serving a GPL binary to two people we trust is fine if we offer its source (a link on the page); our code stays separate (a Web Worker loading the file). It only helps when we have a `.scad`: Printables and Thingiverse mostly host meshes. | Low unless they collect `.scad` | Medium (a customizer UI for `@Parameter`s) |
| **MakerWorld's parametric models** | Out of reach | The Parametric Model Maker generates on Bambu's servers and downloads the result (an STL or 3MF); the OpenSCAD source is not offered (people on Bambu's forum ask for it). Each model's licence differs (some forbid derivatives for commercial use), and automating their site needs a login and would make us depend on a Bambu service ([0003](../decisions/0003-no-bambu-dependency.md)). What we can do: record the **values** we used and link the page, then upload the file it gave us. | The values are worth keeping; the generating is not ours | Stage 1 (values only) |
| **Anything else** | Out of reach | Sculpting, mesh repair, boolean-heavy remodelling, STEP files, painted multi-colour edits, slicing, supports. The slicer does these; a twist links to its file. | — | — |

### Ranking (value ÷ effort)

1. **Record changes in words and values** (stage 1, no geometry at all).
2. **STL scale/rotate/mirror, "fit to N mm"**: smallest geometry step, immediate value.
3. **3MF transform edit that keeps plates and settings**: the most valuable, riskiest to get right with Studio's files.
4. **Text**: valuable, large; do it after the editor exists, with `three-bvh-csg` first and `manifold-3d` if it proves too flaky.
5. **OpenSCAD**: only if they start collecting `.scad` models.

## 4. A staged plan

**Stage 1: the section, with nothing heavy (small pull requests, each with screenshots at 390 and 1440, light and dark)**

1. Data and API: the `twists` table and its migration (renumbered if main takes the number), routes, `shared/twists.ts` (types, change kinds, the "from source" prefill), change feed, search, OpenAPI and the auth-guard list entries, tests.
2. Twists screen and twist page, in the sidebar and the account sheet, with an empty state, and "Make a twist" from an idea and "Save as twist" from an attempt. Source files are stored like slicer files.
3. Builds point at a twist ("Print it again", the Printed list), MCP tools, a decision record, roadmap and AGENTS.md updates.

First-load cost: the section's route and its components are lazy route chunks like the others; nothing new in the entry chunk but a sidebar entry and a type. Sheets are lazy (`useWarmSoon`). Budgets in `e2e/first-load.spec.ts` stay as they are; if Today's or Ideas' menu entry costs bytes, it goes in its own file.

**Stage 2: adapting in the app, only after stage 1 is in use**

- 2a: STL transforms and "fit to N mm" in a lazy editor sheet (three.js and the worker already exist as lazy chunks; the editor shares them).
- 2b: 3MF transform edit (after a spike on their real files: does Studio open it with plates and settings intact?).
- 2c: text, then OpenSCAD only if asked.

None of these are in any first load: every editor is a lazy chunk fetched when someone nears "Adapt", and left out of the service worker's precache (decision 0036). Results are saved as the twist's file through the existing file endpoint; the original stays.

## Open questions for Carl Oscar and Marie

1. Is **Twists** the name?
2. Is the stage 1 shape right: written changes with values and a file, no geometry yet?
3. Do they have `.scad` models, or mostly MakerWorld and Printables meshes and `.3mf`?
4. `src/shared/model-mark.ts` (PR #188) wasn't on `main` yet when this was written; if it changes how a model's source is read, the twist's source reuses it.
