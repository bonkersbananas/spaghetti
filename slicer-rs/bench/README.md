# The slicer benchmark

How the numbers in [docs/proposals/rust-slicer.md](../../docs/proposals/rust-slicer.md) were made, so they can be made again.

## What runs

| Runner | What |
| --- | --- |
| `rust-native` | This crate's command line (`cargo build --release`), 4 threads, pinned to 4 cores |
| `rust-native-1t` | The same on one thread (`RAYON_NUM_THREADS=1`) |
| `rust-wasm-node` | The WebAssembly build (`cargo rustc --release --lib --crate-type cdylib --target wasm32-unknown-unknown --no-default-features`) in Node, through `wasm-node.mjs` |
| `rust-wasm-chromium` | The same in headless Chromium, on the page's main thread (`wasm-browser.mjs`, `web/index.html`) |
| `orca-wasm-node` | The OrcaSlicer engine the app runs today (Muon3D v0.6.1, single-threaded, OrcaSlicer 2.5.0-dev) in Node |
| `orca-wasm-chromium` | The same engine in headless Chromium, in a Web Worker as in the app |
| `orca-native` | OrcaSlicer 2.5.0's own command line (the Linux AppImage), pinned to 4 cores |

Every runner slices the same placed models with the same settings (the app's defaults: Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm Standard, Bambu PLA Basic, Textured PEI). The Orca runners take them from the flattened presets the app's engine uses; this crate has the same presets built in (`profiles/x2d/`, read by Orca's keys in `src/config.rs`).

- **Time** is the median of three runs: for the command lines from start to exit (reading the files, slicing, writing), for WebAssembly from handing over the files to having the `.gcode.3mf` (the module already loaded, as the app keeps it), for Orca's engine in the browser from reading the files to the packed file (engine loaded).
- **Memory** is the peak resident memory of the process (`measure.py`, from `getrusage`), or for the browsers how much their processes grew while slicing (sampled every 100 ms).
- **Output size** is the `.gcode.3mf`; for Orca's G-code it is the G-code deflated at level 6, as the app packs it.

## Running it

```sh
cargo build --release
cargo rustc --release --lib --crate-type cdylib --target wasm32-unknown-unknown --no-default-features
python3 -I bench/place.py 3DBenchy.stl $BENCH_MODELS/benchy.stl           # and the others: see run.py
python3 -I bench/place.py 3DBenchy.stl $BENCH_MODELS/plate/benchy.stl --copies 12 --columns 3
python3 -I bench/colour.py $BENCH_MODELS/colour                           # the plate in two filaments
python3 -I bench/run.py --runs 3                                          # all runners, all models
python3 -I bench/run.py --runs 3 --only rust-native --models benchy       # one of each
```

The Orca runners need the engine and the native command line, which are not in the repository: `ORCA_SPIKE` points at the slicing spike's folder (the engine's release zip, its Node and browser runners and the flattened presets), `ORCA_NATIVE` at an extracted OrcaSlicer 2.5.0 AppImage. Runners whose tools are missing are skipped. Native Orca reads its presets from `ORCA_PRESETS` (default: the spike's); for the Textured PEI plate, as the app slices, add `"curr_bed_type": "Textured PEI Plate"` to a copy of the machine preset. It leaves the models where the files put them (`--arrange 0`), as ours does (`--keep-placement`), so both slice the same placement.

## Other settings

The app slices with the settings people choose (`src/shared/slicing/settings.ts`): its `sliceSetup` turns them into Orca's configs through `orca.ts`. `setup.mts` writes that same setup, with the app's own code, for this crate's `--setup` (and the WebAssembly module's `setup`); give it the engine's `presets.json` (from its release zip) and the settings that differ from the defaults:

```sh
node bench/setup.mts presets.json '{"layerHeight": 0.12, "walls": 4, "infill": 25, "pattern": "gyroid", "filaments": [{"material": "ABS"}]}' > abs.json
target/release/spaghetti-slicer --setup abs.json model.stl -o model.gcode.3mf
node bench/wasm-node.mjs target/wasm32-unknown-unknown/release/spaghetti_slicer.wasm model.gcode.3mf --setup abs.json model.stl   # in WebAssembly
```

A setup it can't slice yet (rafts, brim ears…) is refused by name; what it prints otherwise than asked (other infill patterns as straight lines…) it notes, on stderr natively and in the summary's `fallbacks` in WebAssembly. Without supports, it warns of each object that needs them as Orca does ("It seems object rack.stl has floating regions. Please re-orient the object or enable support generation."), on stderr natively and in the summary's `warnings` in WebAssembly, each with Orca's kind (`need_support_on`) and words. `tests/setups/` keeps one setup made this way, which the tests and CI slice.

## Several filaments

A plate in several filaments needs a setup with that many (`"filaments": [{…}, {…}]`, as the app's `sliceSetup` makes for a project in colour) and each model's filament: a Bambu Studio or Orca project names each object's, `--filaments 1,2` gives each file one (1-based, in order), here and in `wasm-node.mjs` (the module's `add_in`). The filaments go on the X2D's nozzles as Orca groups them, or as `--filament-map 1,1` says (1 the left nozzle, 2 the right, as Orca's own `--filament-map`). Without a setup, the command line gives each filament the presets' and a stand-in colour. `bench/colour.py` writes the benchmark's plate, a block with an S cut through it and the S, as two STLs; `run.py` slices it on two nozzles (`colour`) and on one (`colour-one-nozzle`), and native Orca with the same two filaments (`--load-filament-ids`, `--filament-map-mode Manual`) and the tower where the app puts it:

```sh
target/release/spaghetti-slicer --keep-placement --filaments 1,2 $BENCH_MODELS/colour/block.stl $BENCH_MODELS/colour/letter.stl -o colour.gcode.3mf
python3 -I bench/run.py --runs 3 --only rust-native,orca-native --models colour,colour-one-nozzle
```

The lines that cool a waiting nozzle and heat it again (`;Multi extruder pre cooling`, `pre heating`) come from a pass after the estimate, as in Orca's G-code processor. To hold ours to Orca's, run it on Orca's own G-code with Orca's lines taken out: it puts them back, each within a move and 1 °C, and says how many exactly (93 of 101 on the plate):

```sh
ORCA_GCODE=bench/out/orca-native-colour/plate_1.gcode cargo test --release --test slice -- --ignored --nocapture preheat
```

`groups.py` holds the grouping of three filaments or more to Orca's: it lays out plates of 15 mm blocks in random colours and heights, one filament each, slices them with native Orca and ours, and compares the filament maps, every tool change with its flush, each filament's grams, the estimate and every extrusion of the prime tower, layer by layer (each line's and arc's end, centre and plastic, as the G-code gives them). With `--x0 20` (the default) the first column of blocks reaches into the strip the right nozzle can't print; `--x0 80` stands them clear of it:

```sh
python3 -I bench/groups.py --plates 30 --seed 23 --filaments 2,3,4,5,6,7,8
```

## Other nozzles

`--nozzle 0.2` (or 0.6, 0.8) slices for another of the X2D's nozzles with Bambu's presets for it (`profiles/x2d-0.2/` and the others, from the engine's release 2: the nozzle's machine, its Standard process and Bambu PLA Basic), which a setup is laid over. It is the command line's only: the WebAssembly module slices what the app's setup brings, a nozzle's presets whole. `run.py` slices a Benchy for each (`benchy-0.2`, `benchy-0.6`, `benchy-0.8`), every runner with those presets, on the Textured PEI plate; `table.py` prints their tables after the others:

```sh
target/release/spaghetti-slicer --nozzle 0.2 --keep-placement $BENCH_MODELS/benchy.stl -o benchy-0.2.gcode.3mf
python3 -I bench/run.py --runs 3 --models benchy-0.2
python3 -I bench/run.py --runs 3 --only rust-native,orca-native --models benchy-0.6,benchy-0.8
```

## Comparing files

To compare what the two write around the toolpaths, diff the head (everything before the first printed line: header, settings, the printer's start G-code, the first layer change) and the tail (everything after the last printed line: the last lift and photo, the end G-code, the totals) of the same model's G-code, line by line:

```sh
python3 -I bench/headtail.py bench/out/rust-native-4t-benchy/out.gcode bench/out/orca-native-benchy/plate_1.gcode
```

To hold the estimate's planner to Orca's, time Orca's own G-code with it, feature by feature, and compare with Orca's estimate (`results.json`, the `orca-native` runs' features):

```sh
SPAGHETTI_TIME_GCODE=bench/out/orca-native-plate/plate_1.gcode cargo test --release time_a_gcode_file -- --ignored --nocapture
```

To look at one layer of any G-code (Orca's or ours), coloured by feature, Orca's arcs drawn as arcs:

```sh
python3 -I bench/layer-mvg.py out.gcode 120 layer.mvg && convert mvg:layer.mvg layer.png
```
