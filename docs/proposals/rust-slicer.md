# Proposal: a slicer of our own, in Rust

Status: a first version in [`slicer-rs/`](../../slicer-rs), measured against OrcaSlicer, not wired into the app. Since Nov 13 its files carry the X2D's own start and end G-code and are ready for a first, watched test print (section 4). Carl Oscar asked on Nov 13, after slicing in the browser with Orca's engine ([slicing.md](slicing.md)), for a Rust implementation of slicing built for speed: "First step is actually building it, and making sure it's hyper performant". Later it might run on a bridge-like host as an offline slicing proxy.

## 1. What it is

A self-contained crate, about 7,000 lines of Rust on six small crates (polygon booleans, a Voronoi diagram, deflate, CRC32, MD5, and threads natively). It turns STL and plain 3MF files into a `.gcode.3mf` with the defaults the app slices with: Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm Standard, Bambu PLA Basic, Textured PEI. Its files open in Spaghetti as Orca's do: the reader finds the estimate, weight, filament, settings and plate picture, and the 3D view shows every layer by feature. Around the toolpaths they carry the printer's own G-code, from the presets the app's engine ships (copied into `slicer-rs/profiles/x2d/`): the X2D's start and end, and its layer change and timelapse G-code, filled as Orca fills them (`src/template.rs` ports Orca's placeholder language).

The same code builds two ways:

- **Native**: a 1.6 MB command line, `spaghetti-slicer model.stl -o model.gcode.3mf`, slicing on every core (OrcaSlicer's AppImage is 210 MB).
- **WebAssembly**: a 1.2 MB module (389 kB gzip; Orca's engine is 11 MB, 3.4 MB gzip), one thread, with a plain C interface and no generated bindings (`src/wasm.rs`).

What it does, in order:

1. **Read**: binary and text STL; 3MF with units, components, transforms and Bambu's object names (a sliced 3MF is refused). Corners are welded, and an inside-out model is turned right way out.
2. **Lay out**: arranged on the plate as the app's `arrange.ts` does, or kept where a Bambu project placed it. A model that is too big, too tall, or one too many is refused.
3. **Slice** every layer at its middle into outlines, in integer coordinates of 0.1 µm.
4. **Regions**, as Orca's classic walls: two walls, the outer one placed precisely; gap fill along the middle of what is too narrow for a wall (the medial axis of a Voronoi diagram, as Orca); 5 top and 3 bottom layers; bridges over air and internal bridges over sparse infill; 15 % sparse infill, with small sparse areas made solid.
5. **Toolpaths and G-code**, every layer in parallel. Objects are printed one after the other in each layer, their islands nearest first, walls from the inside out, and infill zig-zags on a grid fixed to the plate. Retractions wipe as Orca's do, lifts are Orca's spirals, speeds and accelerations are the X2D's for each feature, and short layers slow down. Between the layers come what Orca writes there: the printer's layer change G-code, a timelapse photo at the spot Orca's picker would choose, and the fans; around each object's moves, the labels (`M624`/`M625`) that let the printer skip it. The file carries Orca's markers (`; FEATURE:`, `; CHANGE_LAYER`, `M73` progress), so readers of Bambu files follow it.
6. **Estimate and pack**: the print time comes from a port of Orca's move planner (acceleration, jerk, the X2D's limits). The plate picture is the app's `render.ts`, ported. The package is deflated in parallel.

Left for later: supports, more than one filament, and arachne walls (section 5).

## 2. Speed and memory

Every runner slices the same placed models with the app's defaults; the Orca runners read the flattened presets the app's engine uses. Times are the median of three runs. Memory is the process's peak resident memory, or for Chromium how much its processes grew while slicing. Everything ran in an agent's sandbox (4 ARM cores, nothing else running). [`slicer-rs/bench/README.md`](../../slicer-rs/bench/README.md) says how to run it again.

| Runner | 3DBenchy (225,154 triangles) | Steampunk glasses (30,080) | UOBF text with clips (1,354) | 12 Benchies on one plate (2,701,848) |
| --- | --- | --- | --- | --- |
| **Rust, native, 4 threads** | **0.26 s, 33 MB** | **0.41 s, 38 MB** | **0.04 s, 21 MB** | **2.80 s, 218 MB** |
| Rust, native, 1 thread | 0.93 s, 32 MB | 1.55 s, 35 MB | 0.10 s, 21 MB | 10.1 s, 209 MB |
| Rust, WebAssembly, Node | 1.43 s, 117 MB | 2.18 s, 108 MB | 0.22 s, 107 MB | 15.9 s, 369 MB |
| **Rust, WebAssembly, Chromium** | **1.40 s, 78 MB** | **2.13 s, 53 MB** | **0.20 s, 39 MB** | **16.4 s, 489 MB** |
| OrcaSlicer 2.5.0, native, 4 threads | 1.42 s, 208 MB | 1.48 s, 256 MB | 0.35 s, 112 MB | 16.3 s, 964 MB |
| Orca's engine, WebAssembly, Node | 8.65 s, 597 MB | 7.68 s, 626 MB | 1.75 s, 483 MB | 93.4 s, 1,927 MB |
| Orca's engine, WebAssembly, Chromium (the app today) | 8.81 s, 489 MB | 8.36 s, 458 MB | 1.72 s, 351 MB | 97.2 s, 2,050 MB |

- **Native, it is 3.5 to 9 times faster than OrcaSlicer** on the same four cores, in a quarter to a seventh of the memory.
- **In the browser, it is 4 to 9 times faster than the engine the app runs today**, in a quarter of the memory or less, from a module a ninth the size. In Chromium, on one thread, it slices a Benchy about as fast as native OrcaSlicer does on four cores.
- **Its own memory is small**: the WebAssembly heap ends at 30 MB for a Benchy or the glasses and 160 MB for the plate; the rest of the Node figures is Node itself and the model files. Orca's engine starts at a 256 MB heap.
- **Most of the time is spent on regions**: the polygon booleans and offsets of walls, shells and gap fill. For the plate, natively, that is 1.6 s of 2.7 s; toolpaths and G-code take 0.6 s, slicing into outlines 0.25 s, reading 0.1 s, the picture 0.09 s and packing 0.1 s. One thread is 3 to 3.7 times slower than four, and WebAssembly another 1.4 to 2 times.

### Output size

| Model | Rust `.gcode.3mf` | Orca's G-code, packed as the app packs it | Rust G-code | Orca's G-code |
| --- | --- | --- | --- | --- |
| 3DBenchy | 821 kB | 653 kB | 3.04 MB | 2.61 MB |
| Steampunk glasses | 1.41 MB | 1.46 MB | 6.01 MB | 6.59 MB |
| UOBF text with clips | 164 kB | 148 kB | 862 kB | 845 kB |
| 12 Benchies on one plate | 8.22 MB | 5.66 MB | 34.48 MB | 29.35 MB |

Our G-code is about as long as Orca's, from 9 % shorter to 17 % longer: Orca fits arcs to curves, and we retract more, each retraction a wipe and a spiral lift. Packed, ours ranges from 3 % smaller to 45 % larger. We deflate at level 4 in parallel chunks, for speed, and our G-code packs less tightly: at level 6 in one stream, as Orca's above, the plate's would be 7.6 MB against 5.7 MB.

## 3. Quality against Orca

The same models in native OrcaSlicer 2.5.0, with the same settings and placements:

| Model | Layers, Rust / Orca | Filament, Rust / Orca | Estimate, Rust / Orca | Extruding, Rust / Orca | Travel, retractions and lifts, Rust / Orca | Retractions, Rust / Orca |
| --- | --- | --- | --- | --- | --- | --- |
| 3DBenchy | 240 / 240 | 10.99 g / 11.32 g (−2.9 %) | 41.1 / 37.8 min (+8.7 %) | 23.0 / 24.2 min (−4.9 %) | 12.9 / 8.4 min (+53.5 %) | 2,525 / 1,445 |
| Steampunk glasses | 253 / 253 | 7.59 g / 7.66 g (−0.9 %) | 79.5 / 76.4 min (+4.0 %) | 25.8 / 27.9 min (−7.7 %) | 48.6 / 43.4 min (+12.0 %) | 10,023 / 8,665 |
| UOBF text with clips | 68 / 68 | 4.20 g / 4.02 g (+4.7 %) | 20.0 / 18.8 min (+6.7 %) | 9.7 / 9.6 min (+0.5 %) | 5.2 / 4.0 min (+30.6 %) | 1,031 / 686 |
| 12 Benchies on one plate | 240 / 240 | 131.85 g / 135.77 g (−2.9 %) | 395.3 / 361.6 min (+9.3 %) | 231.1 / 252.9 min (−8.6 %) | 159.1 / 103.5 min (+53.8 %) | 30,456 / 17,401 |

The estimate is the whole print. Both count its start alike, 5 min 8 s: the X2D's allowance for levelling the bed and the moves of its start G-code, timed as Orca times them. The rest is split the same way for both: the time spent extruding (every feature's), and everything else after the start (travel, retractions, wipes and lifts).

A Benchy's filament by feature, in mm³ (Rust / Orca): outer wall 2,441 / 2,410, inner wall 2,374 / 2,343, sparse infill 1,518 / 1,381, internal solid infill 1,180 / 1,476, gap infill 467 / 574, internal bridge 462 / 370, top surface 175 / 261, bridge 68 / 114, bottom surface 41 / 38, overhang wall 0 / 13.

![The same Benchy in Spaghetti's 3D view, coloured by feature: OrcaSlicer 2.5.0 on the left, the Rust slicer on the right; the whole print above, layer 30 below](images/rust-slicer-benchy.jpg)

In the 3D view the two Benchys look alike from outside. The differences are inside and on top:

- **Walls** match on a Benchy to about 1 %. On the glasses and the text, ours have 6 to 11 % more inner wall. Orca puts only one wall around a top surface, and counts part of the outer wall as overhang wall.
- **Gap fill** follows Orca's rules for which gaps to fill and how wide, but comes out 15 to 23 % lighter.
- **Sparse infill**: Orca's profile uses crosshatch, which turns its direction over a few layers (the waves at layer 30). Ours alternates straight lines at ±45°, and is 10 % heavier on a Benchy.
- **Solid infill** on a Benchy is 20 % short. Orca adds solid infill wherever a slope would leave the shell thin ("ensure vertical shell thickness"), and we don't yet: those are the teal patches by Orca's walls at layer 30. On the glasses and the text, ours has more solid infill than Orca's (12 to 58 % more), for reasons not yet pinned down.
- **Top surfaces** are a fifth to a third smaller than Orca's. Orca puts one wall around a top surface instead of two, and prints it monotonic, every line in the same direction. Ours zig-zag, and the roof shows more gap fill along its edges.
- **The estimate's gap is retractions.** Ours is 4 to 9 % over Orca's, all of it in moving: each retraction takes about 0.2 s (retract, wipe, spiral lift, travel, lower, push back), and we retract 1.2 to 1.8 times as often. Extruding takes up to 9 % less time than Orca's, as we print less solid infill, top surface and gap fill (above) and don't slow down for overhangs (about 2 of the glasses' minutes).
- **Retractions**: 1.2 to 1.8 times as many as Orca's. Both skip retracting for travels under 1 mm and within infill, but we haven't matched how Orca decides when a travel needs one.

## 4. The printer's G-code, against Orca's

A bad start can drive the nozzle into the bed, so everything around the toolpaths is held to native OrcaSlicer's file for the same models in the same place. [`bench/headtail.py`](../../slicer-rs/bench/headtail.py) diffs the head of the two files (from the top to the first printed line: header, settings, the machine limits, the printer's start G-code, the first layer change and the travel down to the first path) and their tail (from the last printed line to the end: the last retraction and lift, the last timelapse photo, the end G-code and the totals), line by line. For the four benchmark models, of Orca's 452 to 529 head lines 9 to 13 differ, and of its 149 to 153 tail lines 11 to 26. Every difference is one of these:

- **Our name and our estimate.** `; generated by` names our slicer, without Orca's date and time (the same models give the same file). The header's printing times and the first progress line (`M73 P0 R…`) carry our estimate, which differs from Orca's (section 3); the start's own time is Orca's, 5 min 8 s.
- **Object labels.** Orca numbers objects with its internal ids (22 for a single model; 323, 342, … for twelve), we number them 1, 2, 3…; the header's list, `; start printing object, unique label id: …`, `; stop printing object, unique label id: …` and the plate's object list (`slice_info.config`) agree with each other. The `M624` masks are the same as Orca's: one bit per object, in label order.
- **The settings block.** Orca lists its whole configuration (743 settings), we list the 29 we use. Six of those read differently: Orca lists both nozzles' values (`nozzle_diameter = 0.4,0.4`, and the wall and travel speeds) and quotes the filament preset's name. The printer doesn't read this block.
- **Progress lines** (`M73 P… R…`). Orca's estimator puts one after any move where the percentage or the minutes left change, which puts one or two inside the start G-code; ours come at the start of every layer, where Spaghetti's 3D view reads each layer's time. They only drive the printer's progress display.
- **The bed levelling area** (`G29 A1 …`, `G29 A2 …`): the first layer's outline and the 2 mm Orca keeps around it. Identical for the UOBF text; for a Benchy and the plate within 1 µm (`Y117.902 … J20.1955` against `Y117.903 … J20.1964`), from rounding the first layer's outline. For the glasses Orca's is 4.7 mm larger on each side: its auto brim gives them a brim that wide, and we print none (section 5).
- **The first travel and the last wipe.** Where the first path starts and how the last retraction splits: the first `G1 X… Y… F60000`, and the last `G1 E-… F1800` with the wipe after it (the wipe goes at the last path's speed, and retracts what the extruder can at that speed; the rest goes before it). Where Orca prints a brim first, its object labels come after the brim; ours come before the first path, as Orca's do for a model without a brim.
- **The totals.** Filament used in mm, cm³, g and cost, from the toolpaths (section 3).

Everything else is Orca's, line for line, for all four models: the 400-line start G-code with its temperatures, homing, bed levelling, nozzle cleaning and purge line; the fans; the first layer change; the travel onto the first layer (`G1 Z.6`, `G1 Z.2`, `G1 E.4 F1800`); the last lift (`G17`, `G3 Z… I1.217 J0 P1  F60000`); the last timelapse photo at Orca's spot (`M9711 … U131 V186 …` for a Benchy); the 100-line end G-code; and `M73 P100 R0`. Inside the file the layer changes, photos, labels, lifts and travels take Orca's form too.

The tests hold the filled start, end, layer change and timelapse G-code to Orca's own output for a Benchy, the timelapse spot to Orca's for all four models, and walk every move of a sliced file: printing only at the layer's height with the filament pushed back, never travelling below the layer, staying on the plate, retractions that add up exactly, spiral lifts that stay on the plate, and every object's moves inside its labels.

## 5. What it would take to reach Orca's quality

In order of what matters for a good print with the default profile. A small item is a session or two, a large one weeks:

| What | Why | Size |
| --- | --- | --- |
| A first test print of a Benchy, watched | The start and end G-code are Orca's (section 4), but nothing has printed yet | A print |
| Ensure vertical shell thickness | Shells on slopes come out thin (20 % less solid infill on a Benchy): weaker, with infill showing through | Medium |
| Overhang walls: detect them, slow down, more fan | Overhangs droop without it | Medium |
| Travel as Orca does it: its order of paths, and when to retract | Up to 1.8 times Orca's retractions, which means more strings, and the estimate's whole gap (4 to 9 % over Orca's; each retraction takes about 0.2 s) | Medium |
| Crosshatch sparse infill; monotonic top, bottom and solid infill | Orca's look and strength for this profile | Medium |
| One wall on top surfaces; bridge direction and anchoring; aligned seams | Smoother tops, stronger bridges, the seam in one line | Medium each |
| Auto brim | Orca's default: a brim where a footprint is small for the height (the glasses get 4.7 mm) | Small |
| Arc fitting | Orca's default: smaller files and smoother curves | Small |
| Refuse objects a project places off the plate, as Orca does | Kept where the file puts them, they are sliced there, and their G-code would run off the bed | Small |
| Supports (normal and tree) | Models that need them: with the app's defaults Orca only warns, and slices without | Large |
| More than one filament (AMS colours, prime tower, flushing) | Multicolour prints | Large |
| Arachne walls | Not the profile's default (`wall_generator = classic`); for thin details | Large |

The estimate will follow once the features above are in: the planner already models the X2D. A rough guess at parity with Orca for single-filament prints without supports: three to four weeks of sessions, each item measured against Orca as in this proposal.

## 6. Where it could run

- **On a bridge-like host, as an offline slicing proxy.** A 1.6 MB program, slicing a Benchy in a quarter of a second and a full plate in under 3 s, in 220 MB. It needs nothing installed, and nothing from Bambu or the internet.
- **In the browser, in place of Orca's engine.** The download shrinks from 3.4 MB to 0.39 MB gzip, a Benchy is ready in under a second and a half instead of nine, and a phone's memory is spared. Only once quality is at parity: today the engine *is* Orca, and its files are what the printer's own software would make.
- **In the Worker itself**, for single models: a Benchy needs 30 MB of WebAssembly memory and 1.4 s of CPU. That fits in a Worker's 128 MB, if the account's CPU limit allows a few seconds a request. Orca's engine can't run there (its heap starts at 256 MB). A plate of many models would not fit.

## 7. Recommendation

Keep Orca's engine in the app: its files are Orca's. Continue the Rust slicer for the bridge first, where speed and footprint matter most and nothing in the app has to change. Go down the list in section 5, starting with a first watched print of a Benchy on the X2D. Run the benchmark again after each item. Once the quality table reads within a few percent everywhere and the prints look right, decide whether it replaces the engine in the browser.

## Notes

- **Licence.** The crate is our own code, but it follows libslic3r's algorithms and constants closely (classic walls, gap-fill limits, the planner), learned from OrcaSlicer's behaviour and sources, so treat it like the engine: derived from AGPL-3.0 code ([slicing.md](slicing.md), section 5).
- **CI.** One job, `.github/workflows/slicer-rs.yml`, runs only when `slicer-rs/` or the workflow changes ([docs/ci.md](../ci.md)). It checks formatting and lints (native and WebAssembly), runs the tests, builds both targets, and slices a model end to end. The tests hold a 20 mm cube to native Orca's filament (±5 %) and printing time (±15 %).
- **Determinism.** The same models give the same file byte for byte: natively on any number of threads, and in WebAssembly, where the Voronoi crate's random numbers come from a fixed sequence. CI checks that the native and WebAssembly builds slice a model to the same file.
