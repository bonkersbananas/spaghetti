# Proposal: a slicer of our own, in Rust

Status: a first version in [`slicer-rs/`](../../slicer-rs), measured against OrcaSlicer, not wired into the app. Carl Oscar asked on Nov 13, after slicing in the browser with Orca's engine ([slicing.md](slicing.md)), for a Rust implementation of slicing built for speed: "First step is actually building it, and making sure it's hyper performant". Later it might run on a bridge-like host as an offline slicing proxy.

## 1. What it is

A self-contained crate, about 5,000 lines of Rust on six small crates (polygon booleans, a Voronoi diagram, deflate, CRC32, MD5, and threads natively). It turns STL and plain 3MF files into a `.gcode.3mf` with the defaults the app slices with: Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm Standard, Bambu PLA Basic, Textured PEI. Its files open in Spaghetti as Orca's do: the reader finds the estimate, weight, filament, settings and plate picture, and the 3D view shows every layer by feature.

The same code builds two ways:

- **Native**: a 1.4 MB command line, `spaghetti-slicer model.stl -o model.gcode.3mf`, slicing on every core (OrcaSlicer's AppImage is 210 MB).
- **WebAssembly**: a 1.0 MB module (334 kB gzip; Orca's engine is 11 MB, 3.4 MB gzip), one thread, with a plain C interface and no generated bindings (`src/wasm.rs`).

What it does, in order:

1. **Read**: binary and text STL; 3MF with units, components, transforms and Bambu's object names (a sliced 3MF is refused). Corners are welded, and an inside-out model is turned right way out.
2. **Lay out**: arranged on the plate as the app's `arrange.ts` does, or kept where a Bambu project placed it. A model that is too big, too tall, or one too many is refused.
3. **Slice** every layer at its middle into outlines, in integer coordinates of 0.1 µm.
4. **Regions**, as Orca's classic walls: two walls, the outer one placed precisely; gap fill along the middle of what is too narrow for a wall (the medial axis of a Voronoi diagram, as Orca); 5 top and 3 bottom layers; bridges over air and internal bridges over sparse infill; 15 % sparse infill, with small sparse areas made solid.
5. **Toolpaths and G-code**, every layer in parallel. Islands are printed nearest first, walls from the inside out, and infill zig-zags on a grid fixed to the plate. Wipes, retractions and z-hops follow Orca's output; speeds and accelerations are the X2D's for each feature; short layers slow down. The file carries Orca's markers (`; FEATURE:`, `; CHANGE_LAYER`, `M73` progress), so readers of Bambu files follow it.
6. **Estimate and pack**: the print time comes from a port of Orca's move planner (acceleration, jerk, the X2D's limits). The plate picture is the app's `render.ts`, ported. The package is deflated in parallel.

Left for later: supports, more than one filament, and arachne walls. The file is for looking at, not printing: its start G-code isn't the X2D's (section 4).

## 2. Speed and memory

Every runner slices the same placed models with the app's defaults; the Orca runners read the flattened presets the app's engine uses. Times are the median of three runs. Memory is the process's peak resident memory, or for Chromium how much its processes grew while slicing. Everything ran in an agent's sandbox (4 ARM cores, nothing else running). [`slicer-rs/bench/README.md`](../../slicer-rs/bench/README.md) says how to run it again.

| Runner | 3DBenchy (225,154 triangles) | Steampunk glasses (30,080) | UOBF text with clips (1,354) | 12 Benchies on one plate (2,701,848) |
| --- | --- | --- | --- | --- |
| **Rust, native, 4 threads** | **0.25 s, 33 MB** | **0.40 s, 36 MB** | **0.03 s, 21 MB** | **2.76 s, 210 MB** |
| Rust, native, 1 thread | 0.85 s, 32 MB | 1.42 s, 30 MB | 0.09 s, 21 MB | 9.39 s, 187 MB |
| Rust, WebAssembly, Node | 1.31 s, 110 MB | 1.99 s, 97 MB | 0.19 s, 100 MB | 15.6 s, 361 MB |
| **Rust, WebAssembly, Chromium** | **1.29 s, 74 MB** | **1.98 s, 48 MB** | **0.18 s, 17 MB** | **15.5 s, 478 MB** |
| OrcaSlicer 2.5.0, native, 4 threads | 1.37 s, 207 MB | 1.46 s, 256 MB | 0.34 s, 112 MB | 16.3 s, 973 MB |
| Orca's engine, WebAssembly, Node | 8.14 s, 577 MB | 7.63 s, 602 MB | 1.69 s, 501 MB | 90.0 s, 2,042 MB |
| Orca's engine, WebAssembly, Chromium (the app today) | 8.29 s, 491 MB | 7.81 s, 468 MB | 1.66 s, 352 MB | 92.5 s, 2,046 MB |

- **Native, it is 3.5 to 10 times faster than OrcaSlicer** on the same four cores, in a fifth to a seventh of the memory.
- **In the browser, it is 4 to 9 times faster than the engine the app runs today**, in a quarter of the memory or less, from a module a tenth the size. In Chromium, on one thread, it slices a Benchy about as fast as native OrcaSlicer does on four cores.
- **Its own memory is small**: the WebAssembly heap ends at 28 MB for a Benchy, 25 MB for the glasses and 154 MB for the plate; the rest of the Node figures is Node itself and the model files. Orca's engine starts at a 256 MB heap.
- **Most of the time is spent on regions**: the polygon booleans and offsets of walls, shells and gap fill. For the plate, natively, that is 1.5 s of 2.7 s; toolpaths and G-code take 0.6 s, slicing into outlines 0.24 s, reading 0.1 s, the picture 0.09 s and packing 0.1 s. One thread is 3 to 3.5 times slower than four, and WebAssembly another 1.4 to 1.7 times.

### Output size

| Model | Rust `.gcode.3mf` | Orca's G-code, packed as the app packs it | Rust G-code | Orca's G-code |
| --- | --- | --- | --- | --- |
| 3DBenchy | 786 kB | 650 kB | 2.75 MB | 2.57 MB |
| Steampunk glasses | 1.31 MB | 1.45 MB | 5.33 MB | 6.46 MB |
| UOBF text with clips | 143 kB | 147 kB | 752 kB | 838 kB |
| 12 Benchies on one plate | 7.88 MB | 5.81 MB | 31.96 MB | 29.45 MB |

Our G-code is about as long as Orca's, from 18 % shorter to 9 % longer: Orca fits arcs to curves, and we retract more. Packed, ours ranges from 10 % smaller to 36 % larger. We deflate at level 4 in parallel chunks, for speed, and our G-code packs less tightly: at level 6 in one stream, as Orca's above, the plate's would be 7.4 MB against 5.8 MB.

## 3. Quality against Orca

The same models in native OrcaSlicer 2.5.0, with the same settings and placements:

| Model | Layers, Rust / Orca | Filament, Rust / Orca | Printing time, Rust / Orca | Retractions, Rust / Orca |
| --- | --- | --- | --- | --- |
| 3DBenchy | 240 / 240 | 10.99 g / 11.32 g (−2.9 %) | 31.1 / 32.6 min (−4.7 %) | 2,525 / 1,445 |
| Steampunk glasses | 253 / 253 | 7.59 g / 7.66 g (−0.9 %) | 54.5 / 71.3 min (−23.5 %) | 10,023 / 8,665 |
| UOBF text with clips | 68 / 68 | 4.20 g / 4.02 g (+4.7 %) | 12.9 / 13.6 min (−5.5 %) | 1,031 / 686 |
| 12 Benchies on one plate | 240 / 240 | 131.85 g / 135.77 g (−2.9 %) | 329.2 / 356.0 min (−7.5 %) | 30,456 / 17,401 |

Printing time leaves out the start of the print. Orca counts 309 s for it (the X2D's 260 s allowance plus the moves of its start G-code); our files count the 260 s alone.

A Benchy's filament by feature, in mm³ (Rust / Orca): outer wall 2,441 / 2,410, inner wall 2,374 / 2,343, sparse infill 1,518 / 1,381, internal solid infill 1,180 / 1,476, gap infill 467 / 574, internal bridge 462 / 370, top surface 175 / 261, bridge 68 / 114, bottom surface 41 / 38, overhang wall 0 / 13.

![The same Benchy in Spaghetti's 3D view, coloured by feature: OrcaSlicer 2.5.0 on the left, the Rust slicer on the right; the whole print above, layer 30 below](images/rust-slicer-benchy.jpg)

In the 3D view the two Benchys look alike from outside. The differences are inside and on top:

- **Walls** match on a Benchy to about 1 %. On the glasses and the text, ours have 6 to 11 % more inner wall. Orca puts only one wall around a top surface, and counts part of the outer wall as overhang wall.
- **Gap fill** follows Orca's rules for which gaps to fill and how wide, but comes out 15 to 23 % lighter.
- **Sparse infill**: Orca's profile uses crosshatch, which turns its direction over a few layers (the waves at layer 30). Ours alternates straight lines at ±45°, and is 10 % heavier on a Benchy.
- **Solid infill** on a Benchy is 20 % short. Orca adds solid infill wherever a slope would leave the shell thin ("ensure vertical shell thickness"), and we don't yet: those are the teal patches by Orca's walls at layer 30. On the glasses and the text, ours has more solid infill than Orca's (12 to 58 % more), for reasons not yet pinned down.
- **Top surfaces** are a fifth to a third smaller than Orca's. Orca puts one wall around a top surface instead of two, and prints it monotonic, every line in the same direction. Ours zig-zag, and the roof shows more gap fill along its edges.
- **The time gap is mostly travel.** Orca's estimate has more travel time: 50 % more on a Benchy (709 s against 472 s, over 32.9 m of travel against our 24.2 m), 44 % more on the glasses (41 minutes against 29) and 2.6 times as much on the text. Its lifts are arcs and its paths come in another order; which of these makes the difference is not yet pinned down. Overhang slowdown, which we don't do, is the smaller part: about 2 of the glasses' 17 minutes.
- **Retractions**: 1.2 to 1.8 times as many as Orca's. Both skip retracting for travels under 1 mm and within infill, but we haven't matched how Orca decides when a travel needs one.

## 4. What it would take to reach Orca's quality

In order of what matters for a good print with the default profile. A small item is a session or two, a large one weeks:

| What | Why | Size |
| --- | --- | --- |
| The X2D's start and end G-code (heating, homing, bed levelling, the purge line, the AMS's load) and a test print | Nothing prints without it; until then the file is for the 3D view. A first print should be watched. | Small, plus a print |
| Ensure vertical shell thickness | Shells on slopes come out thin (20 % less solid infill on a Benchy): weaker, with infill showing through | Medium |
| Overhang walls: detect them, slow down, more fan | Overhangs droop without it | Medium |
| Travel as Orca does it: its lifts, wipes, order of paths, and when to retract | The estimate's biggest gap (Orca's travel time is 1.4 to 2.6 times ours), and up to 1.8 times Orca's retractions, which means more strings | Medium |
| Crosshatch sparse infill; monotonic top, bottom and solid infill | Orca's look and strength for this profile | Medium |
| One wall on top surfaces; bridge direction and anchoring; aligned seams | Smoother tops, stronger bridges, the seam in one line | Medium each |
| Arc fitting, auto brim, lifts in arcs | Orca's defaults: smaller files and smoother curves, a brim for small footprints, faster lifts | Small each |
| Supports (normal and tree) | Models that need them: with the app's defaults Orca only warns, and slices without | Large |
| More than one filament (AMS colours, prime tower, flushing) | Multicolour prints | Large |
| Arachne walls | Not the profile's default (`wall_generator = classic`); for thin details | Large |

The estimate will follow once the features above are in: the planner already models the X2D. A rough guess at parity with Orca for single-filament prints without supports: three to four weeks of sessions, each item measured against Orca as in this proposal.

## 5. Where it could run

- **On a bridge-like host, as an offline slicing proxy.** A 1.4 MB program, slicing a Benchy in a quarter of a second and a full plate in under 3 s, in 210 MB. It needs nothing installed, and nothing from Bambu or the internet.
- **In the browser, in place of Orca's engine.** The download shrinks from 3.4 MB to 0.33 MB gzip, a Benchy is ready in about a second instead of eight, and a phone's memory is spared. Only once quality is at parity: today the engine *is* Orca, and its files are what the printer's own software would make.
- **In the Worker itself**, for single models: a Benchy needs 28 MB of WebAssembly memory and 1.3 s of CPU. That fits in a Worker's 128 MB, if the account's CPU limit allows a few seconds a request. Orca's engine can't run there (its heap starts at 256 MB). A plate of many models would not fit.

## 6. Recommendation

Keep Orca's engine in the app: its files are Orca's. Continue the Rust slicer for the bridge first, where speed and footprint matter most and nothing in the app has to change. Go down the list in section 4, starting with a start G-code and a first watched print of a Benchy on the X2D. Run the benchmark again after each item. Once the quality table reads within a few percent everywhere and the prints look right, decide whether it replaces the engine in the browser.

## Notes

- **Licence.** The crate is our own code, but it follows libslic3r's algorithms and constants closely (classic walls, gap-fill limits, the planner), learned from OrcaSlicer's behaviour and sources, so treat it like the engine: derived from AGPL-3.0 code ([slicing.md](slicing.md), section 5).
- **CI.** One job, `.github/workflows/slicer-rs.yml`, runs only when `slicer-rs/` or the workflow changes ([docs/ci.md](../ci.md)). It checks formatting and lints (native and WebAssembly), runs the tests, builds both targets, and slices a model end to end. The tests hold a 20 mm cube to native Orca's filament (±5 %) and printing time (±15 %).
- **Determinism.** The same models give the same file byte for byte: natively on any number of threads, and in WebAssembly, where the Voronoi crate's random numbers come from a fixed sequence. CI checks that the native and WebAssembly builds slice a model to the same file.
