# Proposal: slicing .stl and plain .3mf files in the browser

Status: proposal, with the spike done. The engine's build pipeline and the feature follow in their own pull requests. Carl Oscar asked on Nov 13 to upload a generic `.stl` or `.3mf` and have Spaghetti slice it into a `.gcode.3mf` "using the same slicing as OrcaSlicer", so ideas and builds show it as a 3D model, with sensible defaults for now.

The mocks (`docs/proposals/mocks/slicing-390.html` and `slicing-1440.html`, drawn with the real tokens) are in the pull request description.

## 1. What the spike found

**Option 1 works.** OrcaSlicer's own slicing core (libslic3r) compiled to WebAssembly slices in a Web Worker in Chromium and in WebKit, in 2 to 9 seconds for real models, and its output matches the native OrcaSlicer 2.5.0 command line: the same layers, the same filament to 0.01 g, estimates within 0.6 %. The `.gcode.3mf` it makes reads in Spaghetti's own reader (`readThreeMf`: kind "sliced", estimate, weight, filament, settings) and in the 3D view's reader (`readToolpaths`: all 240 layers of a Benchy).

**We don't port the engine ourselves.** Several ports of OrcaSlicer's core to WebAssembly appeared this year. The one to build on is the [Muon3D Slicer Engine](https://github.com/Muon-3D/muon3d-slicer-engine) (AGPL-3.0): it builds Orca's `src/libslic3r` with no edits to Orca's sources (desktop-only parts are left out or stubbed, one wasm32 defect is fixed in a patched copy at build time), follows the path Orca's command line takes for one plate, runs as a Web Worker that a page talks to with documented messages, and has a **single-threaded build that needs no cross-origin isolation**, so the app's headers stay as they are. Its builds are reproducible: our build of its v0.6.1 in this sandbox (ARM, 11.5 minutes on 3 cores) is byte-for-byte its release (`engine-st.wasm` sha256 `290e5825…`, the same as the x86 build in its CI).

| Port | Why not |
| --- | --- |
| [Hiosdra/OrcaWasm](https://github.com/Hiosdra/OrcaWasm) | The first proof; its release is the multithreaded build only (needs a cross-origin isolated page). Muon3D took its serial TBB shim and its notes. |
| [AetherixLabs/say3d-slicer-engine](https://github.com/AetherixLabs/say3d-slicer-engine) | A fork of the above for a phone app; multithreaded releases. |
| [JoshTheDerf/orcaslicer-wasm](https://github.com/JoshTheDerf/orcaslicer-wasm) | Small (8.6 MB) and well tested, but its licence is unclear: its LICENSE says AGPL, its NOTICE "all rights reserved". |
| [Noisyfox/OrcaSlicerNeo](https://github.com/Noisyfox/OrcaSlicerNeo), [boolean3d/slicers.wasm](https://github.com/boolean3d/slicers.wasm) | Whole slicer apps (wasm64, or the desktop GUI in a canvas), far more than we need. |

### Size

| File | Raw | gzip | brotli |
| --- | --- | --- | --- |
| `engine-st.wasm` | 11.07 MB | 3.42 MB | 2.34 MB |
| `engine-st.mjs` + the host's scripts | 0.17 MB | 0.05 MB | 0.04 MB |
| The X2D's three presets (JSON) | 0.07 MB | 0.01 MB | |

Every file is far under Cloudflare's 25 MiB per-file limit for static assets, so nothing has to be split or served from R2. A first slice downloads about 2.4 MB (if Cloudflare compresses `application/wasm`, else 11 MB), and the browser keeps it for next time.

### Time and memory

Measured in this sandbox (4 ARM cores at Neoverse class, headless browsers, nothing else running), the engine already downloaded. "Peak" is how much the browser's processes grew while slicing. The engine's own heap never grew past its initial 256 MB.

| Model | Triangles | Chromium | WebKit | Peak, Chromium / WebKit | Native Orca 2.5.0, 4 threads |
| --- | --- | --- | --- | --- | --- |
| 3DBenchy | 225,154 | 8.5 s | 8.5 s | +490 MB / +610 MB | 1.3 s |
| Orca's badge, three objects | 72,586 | 6.2 s | 6.1 s | +370 MB / +260 MB | 1.6 s |
| Steampunk glasses (Carl Oscar's) | 30,080 | 7.9 s | 7.7 s | +460 MB / +660 MB | 1.4 s |
| UOBF text with clips (Carl Oscar's) | 1,354 | 1.8 s | 1.7 s | +350 MB / +270 MB | 0.3 s |

About a third of each slice is writing the G-code, which Orca does after slicing (for the badge: 1.3 s slicing, 4.6 s G-code). One engine is single-threaded, so the native app is 5 to 6 times faster on four cores; for a phone in a pocket next to the printer that is fine, because nobody waits on it (section 4).

### Against the native command line

The same flattened presets and the same placements, given to the engine (OrcaSlicer 2.5.0-dev, below) and to the native OrcaSlicer 2.5.0 for Linux:

| Model | Layers | Estimate, native / engine | Filament, native / engine |
| --- | --- | --- | --- |
| 3DBenchy | 240 / 240 | 37m 45s / 37m 58s (+0.6 %) | 11.32 g / 11.31 g |
| Orca's badge | 8 / 8 | 25m 1s / 25m 0s | 12.61 g / 12.61 g |
| Steampunk glasses | 253 / 253 | 1h 16m 25s / 1h 16m 47s (+0.5 %) | 7.66 g / 7.66 g |
| UOBF text with clips | 68 / 68 | 18m 45s / 18m 44s | 4.02 g / 4.02 g |

Both warned the same about the glasses and the text: "It seems object … has floating regions. Please re-orient the object or enable support generation." The G-code itself differs in places: the engine's Orca is a few weeks older, and in it the overhang fan keeps arc fitting off for walls (Muon3D's `engine/PATCHES.md` explains it), so the engine writes about 40 % fewer arcs and more straight moves for the same paths.

## 2. The route

**Option 1, the Muon3D engine built by us, single-threaded only.** Option 2 (Cloudflare Containers) isn't needed, and option 3 (the Mac bridge) was ruled out.

- **Which Orca.** The engine's v0.6.1 pins OrcaSlicer 2.5.0-dev: commit `2d1163eb6f` of its fork, which is OrcaSlicer's main branch as of Sep 24 with pull request #13777 on it (`432debfc`; the pull request was merged upstream on Oct 22), plus its own printer profiles. That commit has the X2D's presets. OrcaSlicer 2.5.0 itself (released Nov 7, `40ecc66f`) doesn't build in the engine yet: it dropped Clipper 1 from `deps_src` (a two-line change to the engine's CMake, tried here) and moved to CGAL 6.2.1 where the engine's dependencies have 5.6.3, which is a dependency upgrade (the engine's own upstream canary has failed since Oct 5). We start from the engine's pin, record both commits, and move to an Orca release when the engine does: the numbers above show how close the two are.
- **One fix of ours.** The engine's host checks `memory.buffer instanceof SharedArrayBuffer`, which throws on a page that isn't cross-origin isolated (such pages have no `SharedArrayBuffer` at all), so the single-threaded engine never started in a browser tab. We build the host with a one-line patch and will offer it upstream.
- **Presets.** The defaults are OrcaSlicer's own presets for the X2D: "Bambu Lab X2D 0.4 nozzle", "0.20mm Standard @BBL X2D" and "Bambu PLA Basic @BBL X2D 0.4 nozzle". They are flattened by Orca's own preset loader inside the engine (`profiles.resolve`: inheritance, templates, the X2D's nozzle variants), at build time and from the same Orca commit, so they can't drift from the engine.

## 3. The build pipeline

- `scripts/slicer/` holds the build: it clones the engine at its pinned tag with Orca at the pinned commit, builds the dependencies and the single-threaded engine with Emscripten 6.0.10 (the engine's own scripts), builds the host with our patch, resolves the X2D presets, and packs the runtime (host, `engine-st.mjs` and `.wasm`, the presets, `manifest.json` with the engine's and Orca's commits, LICENSE, NOTICE, SOURCE) into one archive. The same script runs in the sandbox and in CI.
- A workflow of its own, `.github/workflows/slicer.yml`, runs it on a `slicer-v*` tag (like the bridge's release) and publishes a release with the archive, the corresponding source (the engine and Orca at the pinned commits) and `SHA256SUMS`. It takes about 20 minutes on GitHub's runner and runs only when we move the pin, never in the normal CI.
- `scripts/slicer/engine.json` pins the release: its URL, sha256 and the commits. `pnpm build` (a Vite plugin) fetches it once into a cache, checks the hash, and copies the runtime to `dist/client/slicer/<version>/`; `pnpm dev`, wrangler and the Docker container serve it from there like any static file. With no network, `SLICER_ARCHIVE=<path>` points the build at a local copy.
- The app never imports the engine: it starts the host by URL (`/slicer/<version>/host.<hash>.js`) in a worker and talks to it with messages. Nothing of it is in a first load or in the service worker's precache, so `e2e/first-load.spec.ts` doesn't move; the files are immutable and cached by the browser.

## 4. The feature

**Where.** Everywhere a file goes today: an idea's "Add a file" and a drop on the idea page, a build's file, and an attempt's file (the sheet's well, a drop on the build or on an attempt). Each of them also takes `.stl` and a plain `.3mf` (a project with no G-code). Sliced `.gcode.3mf` files are kept as they are.

**What is kept.** One file row, as today (`item_files`, `attempt_files`), with a `kind`: `slicer` (a slicer's own file, as now) or `model` (an `.stl` or `.3mf` Spaghetti slices). The original is saved at once, as the row's file (`files/<id>/file`, a 50 MB cap for models). The sliced `.gcode.3mf` is a second part of the same row (`files/<id>/sliced`, with the plate picture as its `thumb`), sent when slicing ends, with what it said (plate, estimate, filaments, objects) and how it was sliced (engine, Orca, presets). So the card, the plate picture, the estimate, the 3D view, Remove with Undo and the purge work on one thing, and the link between a source and its slice can't break. A failed slice keeps its reason on the row.

**How it feels** (the mocks):

- **Instant.** Adding shows the card at once, saving the original ("Saving the file…"). Slicing starts in a worker; the card shows a calm ring and "Slicing · 42 %" in its meta line, and nothing else on the page waits. Leaving the page doesn't stop it; closing the tab does, and the card then says "Not sliced yet" with "Slice it", for whoever opens it next.
- **Sliced.** The card looks like any slicer file's (the plate picture with its 3D control, the name, "est. 38 min · 11.3 g · 11 MB", download), with one quiet line: "Sliced by Spaghetti · 0.20 mm · PLA". A tap on it (a popover on desktop, a sheet on phones) says how: printer, nozzle, process, filament, plate, supports, "OrcaSlicer's engine, free software under the AGPL", a link to its source, "Download the original" and "Slice again".
- **A caution, not an error.** When Orca says parts float in the air (supports are off by default), the card says so in one semolina line with "Slice with supports", which slices that file again with Orca's tree supports.
- **Failed.** One short sentence and "Try again", and the original stays: "Too big for the plate: 312 mm long, the X2D takes 256.", "This file has no model in it.", "Slicing ran out of memory on this phone. It will finish on a laptop or desktop."
- **The plate picture** is drawn in the worker (a small software renderer: no WebGL, about 0.1 s for a Benchy), from the front left in the filament's colour, and goes into the file as `Metadata/plate_1.png`, where the reader expects it. Orca's command line can't draw one at all.

**Defaults, in one place** (`src/shared/slicing/defaults.ts`): the X2D with its 0.4 mm nozzle, 0.20 mm Standard, Bambu PLA Basic, the Textured PEI plate (the X2D's stock plate; Orca would pick Cool Plate, since the X2D preset names none), supports off, everything else Orca's process defaults. Everything goes on plate 1, laid out in rows around the middle with 6 mm between objects (our arrangement: Orca's lives in its GUI). A `.3mf` made for the X2D (its `printer_model` says so) is sliced with its own settings and layout; a `.3mf` made for another printer keeps its layout if it fits and takes our X2D defaults with its own layer height, walls, infill and supports.

**Phones.** The same engine and file run on an iPhone; nobody can measure one here (section 6). A slice is a background job on the card, so a slow phone costs patience, not a frozen screen. When a phone runs out of memory, the original is already saved and the card offers to finish on a laptop. Reuse: `sliceModel(file)` in `lib/slicing` takes a file and returns the `.gcode.3mf`, its picture and what it said, for Twists later.

**The Worker** accepts the new kind and its part with caps (50 MB for a model, 25 MB for the sliced file), records changes in the feed, lists both in OpenAPI, purges both parts, and MCP `get_build` lists model files with how they were sliced (no slicing through MCP). A decision record says all this.

## 5. Licence

OrcaSlicer and the engine are AGPL-3.0; Spaghetti's repository is public and has no licence file. The plan keeps the engine a separate program: it is built from its own source by its own workflow, served from its own folder with its LICENSE, NOTICE and SOURCE (where the source of that exact build is), and started by URL and spoken to with messages, never bundled into the app's code. The "Sliced by Spaghetti" detail links to the source. Whether that is enough for how Spaghetti is shared is for Carl Oscar to confirm.

## 6. What a sandbox can't tell

- **A real iPhone:** how fast it slices, and how much memory Safari lets a tab use before it reloads it (on iOS that limit is the device's, roughly 1.5 to 3 GB for a tab; the engine needed 0.6 to 0.9 GB of a WebKit process here, so a Benchy should fit).
- **Cloudflare's compression of `.wasm`**: whether the edge sends the engine as 2.3 MB of brotli or 11 MB.
- **The printer:** that the X2D prints our `.gcode.3mf` from Bambu Studio or its SD card. The layout mirrors Orca's export (with the G-code's MD5), but nobody has sent one to the printer.
- **Real downloads:** five models were tried; MakerWorld projects for other printers are the case to watch.
