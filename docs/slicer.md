# The slicing engines

Spaghetti slices `.stl` and plain `.3mf` files in the browser with OrcaSlicer's own slicing core, compiled to WebAssembly (the proposal with the measurements is [pull request #205](https://github.com/bonkersbananas/spaghetti/pull/205), which keeps them in `docs/proposals/slicing.md`), or with Spaghetti's own slicer, written in Rust, when a model picks it ([below](#spaghettis-own-slicer)). This page is about the engines: what they are, where they come from, how they are built and released, and how the app gets them.

## What it is

The [Muon3D Slicer Engine](https://github.com/Muon-3D/muon3d-slicer-engine): OrcaSlicer's `src/libslic3r` built with Emscripten, with no edits to Orca's sources, plus a worker **host** that a page starts by URL and talks to with messages ([its protocol](https://github.com/Muon-3D/muon3d-slicer-engine/blob/main/docs/PROTOCOL.md): `hello`, `load`, `slice`, `profiles.resolve`, …). Spaghetti uses its single-threaded build (`engine-st`), which runs on any page; the multithreaded one would need cross-origin isolation headers on the whole app.

| | |
| --- | --- |
| Pin | `scripts/slicer/pin.env`: the engine's tag and commit, OrcaSlicer's commit (2.5.0-dev), the hashes our build must reproduce |
| Our change | `scripts/slicer/host.patch`: the host checked `instanceof SharedArrayBuffer`, which throws on a page that isn't cross-origin isolated |
| Presets | `presets.json` in the release: the X2D's machine for each nozzle size (0.2, 0.4, 0.6 and 0.8 mm), Bambu's processes for each, and a filament per material and nozzle (the 0.2 mm has fewer: no carbon fibre, TPU, PA, PP or PCTG), flattened by Orca's own loader in the engine (`scripts/slicer/resolve-presets.mjs`; since release 2) |
| Size | `engine-st.wasm` 11.1 MB (3.4 MB gzip, 2.3 MB brotli); the host and loader 0.2 MB |
| Licence | AGPL-3.0, like OrcaSlicer: the release carries the Corresponding Source and the engine is served with its LICENSE, NOTICE and SOURCE |

## Building and releasing it

The engine is built by its own workflow, never by the normal CI. To release one:

1. Change what needs changing (`pin.env`, `host.patch`, the preset list in `resolve-presets.mjs`) and merge it.
2. Tag the commit `slicer-vN` (the next number) and push the tag. `.github/workflows/slicer-release.yml` runs `scripts/slicer/build.sh` (Emscripten 6.0.10, the dependencies and the engine from scratch, about 20 minutes on GitHub's runner), checks that `engine-st.wasm` is byte for byte the engine's own release of the same commits, slices a cube with it for each nozzle size (`scripts/slicer/smoke.mjs`), and publishes the release: `spaghetti-slicer-N.zip`, the engine's, OrcaSlicer's and the third-party libraries' source as the engine's release has them (checked against `pin.env`), `host.patch`, our build scripts, and `SHA256SUMS`.
3. Put the zip's URL and sha256 in `scripts/slicer/engine.json` (and the version: the app serves it at `/slicer/N/`) in the pull request that needs it.

A pull request that changes the build (anything in `scripts/slicer/` but `engine.json`, or the workflow) builds and tests the engine without publishing it, and so does "Run workflow" on the Actions page. The same script runs on a Linux machine of your own:

```sh
SLICER_VERSION=0 bash scripts/slicer/build.sh            # into .slicer-build/ (git-ignored) and dist/slicer-release/
SLICER_SYSTEM_TOOLS=1 BSDTAR=… bash scripts/slicer/build.sh   # on ARM: cmake and ninja from PATH; bsdtar is libarchive-tools
```

It needs git, curl, python3, node, pnpm's `node_modules` (for `fflate`), bsdtar and about 6 GB of disk; `JOBS` limits the parallel compiles (a heavy one takes about 2 GB of memory). `ORCA_WASM_ROOT` pointed at an earlier build's toolchain skips the emsdk and the dependencies.

### Moving the pin

To build a newer engine or OrcaSlicer: set the engine's new tag and commit in `pin.env`, with the Orca commit its `orca/` submodule pins and the hashes of its release (`variants.st.sha256` in its `manifest.json`, and its source assets from its `SHA256SUMS`), check that `host.patch` still applies (`git apply --check` in the engine's checkout; drop it once upstream has the fix), and release. OrcaSlicer 2.5.0 itself doesn't build in the engine yet: it moved to CGAL 6, where the engine's dependencies have 5.6.3.

## How the app gets it

`scripts/vite-slicer.ts` (a Vite plugin) reads `scripts/slicer/engine.json`, fetches the zip once into `node_modules/.cache/spaghetti-slicer/`, checks its sha256, and:

- `pnpm build` copies the files to `dist/client/slicer/<version>/`, where the Worker's static assets serve them (and the container's wrangler, and the e2e servers);
- `pnpm dev` serves them at the same address;
- `import engine from "virtual:slicer-engine"` tells the app where they are (`base`, `host`) and what they are (the engine, OrcaSlicer's version and commit, the release with the source), typed by `src/shared/slicing/engine.ts`.

Nothing of it is in a first load or in the service worker's precache (`sw.js` leaves `/slicer/` to the browser, and `public/_headers` makes the files immutable), so a phone downloads the engine only when something needs slicing, once per version. With no network, `SLICER_ARCHIVE=<zip>` makes the plugin use a local zip; `pnpm dev` without one runs on, without slicing, and says so.

## How the app slices

What the feature does is [decision 0046](decisions/0046-models-are-sliced-in-the-browser.md); the code, in the order a model goes through it:

1. `lib/slicer-files.ts` (`readSlicerFile`) and `lib/item-files.ts` take an `.stl`, or a `.3mf` with no G-code, as a model: the row is saved at once with the original (`kind=model`), through the outbox for an attempt and directly for an idea.
2. `lib/slicing/jobs.ts` runs one job at a time on this device, and `sliceModel(file)` (`lib/slicing/slice-model.ts`) starts `slice-worker.ts`, a module worker that reads the model (`shared/mesh.ts` for STL, `shared/slicing/model3mf.ts` for 3MF), lays it out on plate 1 (`arrange.ts`, or a project's own layout when it fits), draws the plate picture (`render.ts`) and starts the engine's host by URL as a nested worker.
3. The worker sends the host `load` and `slice` with the X2D's presets from `presets.json` (`configs.ts` puts together what was chosen, a project's own settings and the defaults, through `orca.ts`, the one place that knows Orca's presets and keys; decision 0047. What was chosen is the model's own settings, kept on its row once someone changed one, else what its last slice was made with; the defaults are the workshop's, `pantry.ts`: a spool from the Pantry, an owned plate and the main nozzle over `defaults.ts`; decision 0049; a model that picked a nozzle size in "Slice with…" slices for it, though a file prints through the main nozzle: `nozzlePicked`, decision 0057), packs the G-code the way Orca exports it (`gcode3mf.ts`: the plate's G-code with its MD5, `slice_info.config`, the project settings and the picture), and reads the result back with the app's own reader, so the estimate and filaments are what a dropped `.gcode.3mf` would give.
4. The job sends it to `PUT /api/files/:id/sliced` once the model is on the server. A failure is the engine's code mapped to a `problem` (2 is out of memory; a model larger than the plate fails before the engine runs, with the scale at which it would fit).

`pnpm test` covers the pure parts (`test/unit/slicing/`), `test/worker/model-files.test.ts` the API, and `e2e/model-files.spec.ts` slices a small STL with the real engine in Chromium (also at phone width) and opens it in 3D.

## Spaghetti's own slicer

`slicer-rs/` is a slicer of our own, in Rust, that slices the X2D's prints the way OrcaSlicer 2.5 does, on the same presets ([proposals/rust-slicer.md](proposals/rust-slicer.md) says how close it is, and what it can't slice yet). Its WebAssembly module slices a Benchy in about 2.5 s in Chromium where OrcaSlicer's engine takes about 8.7 s, from a 3.0 MB file (0.9 MB gzip) where the engine's is 11.1 MB. A model slices with it when its settings say so (`slicer`, under More: "Spaghetti's own" or "OrcaSlicer"), and OrcaSlicer's engine slices what ours can't yet ([decision 0055](decisions/0055-spaghettis-own-slicer-beside-orcaslicers-engine.md)). OrcaSlicer's engine stays the default until a print from ours has come out right on the X2D: `DEFAULT_SLICER` in `src/shared/slicing/defaults.ts` is the one line to change.

### Releasing it

It is released as the engine is, so neither `pnpm build`, the container nor CI needs Rust:

1. Merge what the release should hold, then tag the commit on main `slicer-rs-vN` (the next number) and push the tag. A release is always cut from main, never from a pull request's branch, so it matches merged code: the workflow fails for a tagged commit that isn't on main. `.github/workflows/slicer-rs-release.yml` builds the module with Rust stable (`cargo rustc --lib --crate-type cdylib --target wasm32-unknown-unknown --no-default-features`), slices a test model with it, plain, with normal supports and with tree supports, packs it (`scripts/slicer-rs/pack.ts`: the module, the AGPL's text, `SPAGHETTI.md` and a manifest, `spaghetti-slicer-rs.json`, with the commit and the files' hashes) and publishes `spaghetti-slicer-rs-N.zip` with the Corresponding Source: the crate at that commit and every crate it is built from, vendored, and `SHA256SUMS`. It isn't marked as the repository's latest release.
2. Put the zip's URL, sha256 and version in `scripts/slicer-rs/release.json` in the pull request that needs it.

A pull request that changes the packing (`scripts/slicer-rs/` but `release.json`, or the workflow) builds and tests it without publishing. The release is the crate as it is at its commit: whatever changes in `slicer-rs/` reaches the app only through a new release and a moved pin.

### How the app gets it

The same Vite plugin (`scripts/vite-slicer.ts`) reads `release.json`, fetches the zip once into `node_modules/.cache/spaghetti-slicer-rs/`, checks its sha256, reads its manifest, and serves the files at `/slicer/rust-<version>/` (copied into `dist/client/slicer/` by `pnpm build`): like the engine's, they are in no first load and no precache, and immutable. `virtual:slicer-engine` says where they are (`rust.base`, `rust.wasm`) and what they are (`rust.version`, `rust.commit`, `rust.source`). `SLICER_RS_ARCHIVE=<zip>` uses a local zip, for one built from a branch; without the files `pnpm dev` runs on and every model slices with OrcaSlicer's engine.

### How the app slices with it

The slice worker does everything as for OrcaSlicer's engine (reading the model, laying it out, the plate picture, fins), then, when the model's settings pick ours, `lib/slicing/ours.ts` loads the module and hands it the setup (`orca.ts`'s presets and the settings, with `slicing.scale` 100, the meshes being scaled already) and the meshes as placed, sliced with flag 1 (keep placement). On a plate in several filaments each object goes in with the one it prints in (`add_in`, as the engine gets each object's `extruder`), and ours prints the plate as Orca does on the X2D: tool changes, prime tower (its walls as Orca's arcs since release 8) and flushing. An object prints in one filament with either slicer: a project's painted colours, or parts of an object in other filaments, aren't read. Its `.gcode.3mf` is used as it comes: the plate picture, estimate, filaments and toolpaths are read from it as from any other. OrcaSlicer's engine slices instead, and the card says why in one line ("Sliced by OrcaSlicer: our own slicer can't do slim tree supports yet", `shared/slicing/slicers.ts`), when:

- ours answers that it can't slice a setting yet (code 8, `can't slice with … yet`: slim, strong and hybrid tree supports, …; snug supports slice with ours since release 7);
- the module doesn't load, or answers anything else (a model it can't read, a crash).

Ours warns as OrcaSlicer's engine does, with Orca's kind and words (its summary's `warnings`, from release 6): without supports, of an object that needs them, where a part starts in the air or an overhang reaches more than 6 mm from what holds it (Orca's `need_support_on`). Either slicer's warning makes the card's "Parts of it float in the air" caution when the model has no supports (`cautionsOf` in `shared/slicing/slicers.ts`; fins aren't supports to the check, so a model with fins gets none). Until release 6 a mesh check sent such a model to OrcaSlicer's engine, for its warning: older slices say so ("our own slicer couldn't yet check for floating parts"). What ours prints otherwise than asked (its notes, such as "arachne walls printed as classic walls") is kept with the slice, and said under the settings. The slice records which slicer made it (`settings.slicer`, and `settings.rust`, the release), why OrcaSlicer's engine stepped in (`fallback`), the notes, and how long the slicer took (`ms`, said under the settings: "Sliced in this browser in 2.6 s by Spaghetti's own slicer").

`test/unit/slicing/slicers.test.ts` covers the choices and the cautions, `test/worker/model-files.test.ts` the record, and `e2e/our-slicer.spec.ts` slices a cube with the module in Chromium, opens it in 3D, slices tree supports, a project in two colours (each object in its own filament, two in the file's `filament_maps`) and a beam for a 0.2 mm main nozzle (Bambu's 0.2 mm presets, its bridge with the extra plastic they ask for), slices a part in the air with ours, which warns of it, and a generic filament, which lifts the nozzle with Orca's Auto Lift (release 6), and falls back for slim tree supports.
