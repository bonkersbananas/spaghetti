# Proposal: OrcaSlicer 2.5.1 in the app's engine

Status: engine built and measured (below); the build change is in this pull request, the release and the app's pin follow. Carl Oscar asked on Nov 15 what [OrcaSlicer 2.5.1](https://github.com/OrcaSlicer/OrcaSlicer/releases/tag/v2.5.1) changes for Spaghetti, whether Spaghetti's own slicer should follow, and whether the app should slice with 2.5.1 rather than 2.5.0.

## 1. The finding that matters more than 2.5.1

The app's engine is not 2.5.0. It is OrcaSlicer's main of Sep 24 (`432debfc74`, "2.5.0-dev"), **1,865 commits before v2.5.0** (571 files and 50,000 lines changed under `src/libslic3r`), and 2.5.1 adds 56 more (28 files, +487/-204). So moving the pin to 2.5.1 brings the app's engine up to the version people run, and to what slicer-rs is held to (native Orca 2.5), whereas 2.5.1's own changes are small. Between the pin and 2.5.0 are, among the 293 libslic3r commits that mention a fix, slicing or print features: the X2D's multi-nozzle-size support (#14125), the wipe tower's sparse layers (#15841, #15441), travel optimisation (#16492), seam fixes (#16334, #16447), "features printing with the wrong filament" (#16805), tree support fixes (#16549, #17060), Precise Seam (#12974) and the prime tower fixes of Oct 2026.

## 2. What 2.5.1 changes (v2.5.0..v2.5.1, libslic3r)

There are no changes to Bambu's profiles, none under `resources/profiles/BBL`. Everything else is GUI, connectivity or CLI. Each of the twenty commits that touch `src/libslic3r` sorted by what it does for us:

| Orca PR | What | The X2D in the app | slicer-rs |
| --- | --- | --- | --- |
| [#16933](https://github.com/OrcaSlicer/OrcaSlicer/pull/16933) | A nozzle lifted by Auto Lift travels at the lifted height and descends at its destination (since 2.3.2 it came down while crossing the print, streaking colour after a tool change) | **Yes**: the X2D's z hop type is Auto Lift on every nozzle| Port |
| [#15917](https://github.com/OrcaSlicer/OrcaSlicer/pull/15917) + [#17496](https://github.com/OrcaSlicer/OrcaSlicer/pull/17496) | The last filament is unloaded again when the prime tower stops below the object's top (single extruder multi material only) | **No**: it changes only the Type2 tower branch of `Print::_make_wipe_tower`, and `Print::wipe_tower_type()` returns Type1 for every Bambu printer, whatever the preset's `wipe_tower_type` says; the X2D's machine sets `single_extruder_multi_material = 1`, but that is not reached | No |
| [#17204](https://github.com/OrcaSlicer/OrcaSlicer/pull/17204) | Precise Z height: a tower layer thinner than half the minimum layer height joins the tower layer below (no more "partially outside the printable area") | Only with `precise_z_height` (off in Bambu's processes) | Not needed until slicer-rs reads it |
| [#16999](https://github.com/OrcaSlicer/OrcaSlicer/pull/16999) | Prime tower checks run only when a tower is printed (a support interface in another filament no longer refuses a plate that needs no support) | Only with variable layer height (the checks it relaxes); the app has none | No (a refusal, not output) |
| [#17229](https://github.com/OrcaSlicer/OrcaSlicer/pull/17229) | With classic walls, gap infill takes the inner wall filament (it took the outer's) | The X2D's walls are classic, but only a project with a wall filament set shows it | Port when per-feature filaments arrive |
| [#17183](https://github.com/OrcaSlicer/OrcaSlicer/pull/17183) | Objects with the same transform but another `center_offset()` no longer share sliced layers (printed shifted) | Not us: copies are separate objects, the arranger never rotates them, one instance each (decision 0063) | No (Orca reuses layers; slicer-rs slices every object) |
| [#17279](https://github.com/OrcaSlicer/OrcaSlicer/pull/17279) | Objects with different height ranges don't share slices | Only projects with height ranges | No |
| [#16491](https://github.com/OrcaSlicer/OrcaSlicer/pull/16491), [#17143](https://github.com/OrcaSlicer/OrcaSlicer/pull/17143), [#17154](https://github.com/OrcaSlicer/OrcaSlicer/pull/17154) | Height ranges follow Z shrinkage; spiral vase with height ranges | Z shrinkage is 100 % in Bambu's filaments | No unless slicer-rs gets height ranges |
| [#17341](https://github.com/OrcaSlicer/OrcaSlicer/pull/17341) | Multiline infill paths that started mid-line are joined | Only `fill_multiline > 1` (the X2D has 1) | No |
| #17290, #16884, #17461, #17243, #17439, #17440, #17496's CLI part, #17062 and the rest | expat guard, plugin pipeline, toolchanger copy, CLI crashes, HTTPS CA, preview | Not our engine (GUI, CLI, security of Orca's own app) | No |

The "support interface filament and tower checks", "gap infill filament" and "Precise Z" items the request names are the three rows above (#16999, #17229, #17204). The copies item (#17183) is not hit by decision 0063: it needs a rotated instance or a model object with several instances.

A native check on this sandbox (Orca 2.5.0 and 2.5.1 AppImages, aarch64, the app's own setup for a Benchy): the two G-codes are identical but for the config header, so a one-filament plate is unchanged by 2.5.1. The two-filament cases have no tower in the native CLI here (it needs a project with the tower on), so #16933 was not measured on such a plate against native; it is read from the diff. #15917 is not reached by the X2D (Type1 tower), as a native plate with the tower stopping at 4 mm under a 20 mm object confirmed.

## 3. The engine

**Muon3D has no engine on 2.5.x.** Its newest release is 0.6.1 (Oct 19, on the 2.5.0-dev commit), its `main` still pins that submodule, and its weekly "upstream canary" (issue #3) has failed every week since Oct 5: it builds against upstream and meets CGAL 6 (the canary still downloads 5.6.3). No branch or issue plans 2.5.x.

**Building 2.5.1 ourselves works.** The engine's CMake reads Orca's own source list, so 237 of Orca's 251 libslic3r sources compiled with no list to keep. What it took, all in `scripts/slicer/engine.patch` (248 lines, applied to the engine's checkout at the same tag; Orca itself is untouched):

- **CGAL 6.2.1** (header-only) in place of 5.6.3, same hash as Orca's pin; the GMP-free setup the engine has works with it. CGAL 6's `Surface_sweep_2` pulls in Boost.Interval, whose `hw_rounding.hpp` stops on wasm ("Please specify rounding control mechanism"): the prefix's copy keeps Boost's no-op rounding control (the interval code behind it is an algebraic kernel the engine never runs; CGAL's own intervals have `CGAL_ALWAYS_ROUND_TO_NEAREST`). Deliberately one `sed` in the dependency script, not a fork of Boost.
- **expat 2.10.0**, Orca's new pin for its XML guard (`deps_src/expat` is gone): one more dependency step.
- No ClipperLib (`deps_src/clipper` is gone); Clipper2 now allocates through tbbmalloc's C API.
- The serial TBB shim gained what 2.5.1 uses: `scalable_malloc`/`scalable_free`, `parallel_invoke`, `parallel_sort`, `is_current_task_group_canceling`; the OCCT stand-ins gained the two headers `STEP.hpp` now includes.
- The profile list: Bambu's shared 0.6/0.8 mm filament presets (`Bambu PLA Basic @BBL X2D`) became per-nozzle ones for Bambu's own lines, and Bambu PLA Pure now has X2D presets (all four nozzles). `resolve-presets.mjs` asks for both forms and stops if a material has neither.

Two things this did not need: a new Emscripten (6.0.10 as now), and any change to Orca. One thing to watch: the engine's host still reports "2.5.0-dev" in its `hello` and in `presets.json` (its settings catalogue and rules port are stamped with the old commit); the G-code header says `OrcaSlicer 2.5.1`. The app reads the version from the release's own manifest, so it shows the right one; the host's settings catalogue is not used by the app.

**Measured** (this sandbox, 4 cores, Node, single-threaded engine, the app's settings and presets for each; old = today's engine, 0.6.1):

| | Engine 0.6.1 (2.5.0-dev) | On 2.5.1 |
| --- | --- | --- |
| `engine-st.wasm` | 11,070,968 B (3.42 MB gzip, 2.34 MB brotli) | 11,959,922 B (+8 %; 3.73 MB gzip, 2.56 MB brotli) |
| release zip | 3.86 MB | 4.19 MB |
| Benchy, 0.20 mm | 8.1 s | 5.1 s |
| Benchy, normal supports | 8.8 s | 5.2 s |
| 4 Benchies | 30.7 s | 18.0 s |
| Benchy and a box in two filaments, with the tower | 8.2 s | 5.0 s |
| G-code of the Benchy | 3.25 MB, 133,042 lines | 2.63 MB, 109,968 lines (native 2.5.1: 109,507) |
| Benchy estimate | 38m 03s | 37m 56s (native 2.5.1: 37m 46s) |
| Benchy, extrusion per feature against native 2.5.1 | up to 0.2 % off | 0.0 % on every feature |
| Two boxes plus a third, two filaments, tower | 1h 38m 24s, 25.92 g | 1h 37m 23s, 25.95 g |
| Benchy and a box, two filaments, tower | 1h 34m 02s, 17.91 g | 1h 32m 27s, 17.91 g |

So the new engine slices the same models about 40 % faster (the 2.5.0 travel optimisation and the other speed-ups since September), writes 19 % fewer lines (it fits arcs more), and agrees with native 2.5.1 to the digit on extrusion; the estimates of two-filament plates fall 1 to 2 %. Nearly all of that is the 1,865 commits to 2.5.0, not 2.5.1's 56. Costs: +0.9 MB of wasm (+0.3 MB over the wire for people who slice), and a build that is ours to keep: each Orca release can need a patch like this one. A clean run of `build.sh` here (fresh work folder, Emscripten and every dependency from scratch, 4 cores, warm ccache) took 13.5 minutes, with the source bundles (2.7 min of it) and reproduced the pinned `engine-st.wasm` byte for byte; the pull request's check times it on the runner.

The smoke test (a 20 mm cube per nozzle, 0.2, 0.4, 0.6 and 0.8 mm) passes on both: 100/200/67/50 layers, 0.42/0.22/0.62/0.82 mm lines.

## 4. The plan

1. This pull request: the build moves to OrcaSlicer's v2.5.1 tag (`pin.env`, `engine.patch`, `build.sh`, the release workflow's source bundles: the engine's own release assets are for the other Orca, so the engine's, OrcaSlicer's and the third-party sources are now bundled by our own build), the smoke test and the preset list; the pull request's check builds the engine and holds it to the pinned wasm hash.
2. Merge, tag `slicer-v4` on main (the workflow builds, tests and publishes it).
3. A second pull request: `engine.json` (release 4) and the app side (`orca.ts` takes Bambu's per-nozzle filament presets first on the 0.6 and 0.8 mm nozzles and Pure for Bambu PLA Pure; the e2e and smoke slices).
4. slicer-rs: not touched here (session #1136 owns it); the list is below.

## 5. For slicer-rs

Each against the Orca file and function, what to port, in order of effect on the X2D:

1. **#16933, lifted travel descends at the destination.** `GCode.cpp` `GCode::travel_to` (its final branch and the avoid-crossing detour loop) and `GCodeWriter.cpp` `travel_to_xyz`. When the nozzle is lifted (`zhop > 0`, current z above the target z) and X or Y change, travel in XY at the lifted height and emit the descent to the target z after it (`G1 X Y` then `G1 Z`), also when the travel has several points: the whole detour stays lifted and only the last point descends (no first-point drop to the layer height); a lift the retraction leaves pending counts as lifted. The exclusion-volume check starts from the lifted height. In slicer-rs: `src/gcode.rs` `travel`, `src/toolchange.rs`, `src/lift.rs`.
2. **#15917 + #17496, final unload when the tower stops short: not for the X2D, nothing to port.** `Print.cpp` `Print::_make_wipe_tower`: in the Type2 tower branch only, when the last print layer is above the tower's last layer and `single_extruder_multi_material` is on, `wipe_tower.set_layer(tool_ordering.back().print_z, layer_height, 0, false, true)` makes the final unload at the object's top layer; without SEMM it is skipped. Bambu printers always get the Type1 tower (`Print::wipe_tower_type()` is `is_BBL_printer() ? Type1 : config`), so the X2D's output is unchanged (natively, 2.5.0 and 2.5.1 slice a plate whose tower stops at 4 mm under a 20 mm object alike but for #16933's travels). Port it only if slicer-rs ever gets a Type2 tower.
3. **#17204, tower layers thinner than half the minimum layer height join the one below** (only with `precise_z_height` on). `ToolOrdering.cpp` `fill_wipe_tower_partitions` (new `wipe_tower_print_z`, `wipe_tower_layer_ends`, `joins_wipe_tower_layer_below`), `Print.cpp` (tower planning at `wipe_tower_print_z`), `GCode.cpp` (`m_layer_joined`, `join_layer()`, `joined_tower_z()`, descent deferral). Low priority: slicer-rs doesn't read `precise_z_height`.
4. **#17229, gap fill filament with classic walls.** `ToolOrdering.cpp` `region_filament`: `erGapFill` takes `inner_wall_filament` when `wall_loops > 1`, else `outer_wall_filament`. Only when slicer-rs reads per-feature filaments.
5. **Refusals, for parity of messages only:** #16999 (`Print.cpp` `validate_wipe_tower_layering`, `wipe_tower_certain_before_slicing`): the layering errors apply only when a tower is certain before slicing, else after the tool changes are known and only if a tower is printed.
6. **Not slicer-rs's:** #17183 and #17279 (layer sharing between objects: slicer-rs slices every object), #16491/#17143/#17154 (height ranges and spiral vase, if it gets height ranges: `PrintApply.cpp` `LayerRanges` scales ranges by the Z shrinkage; `Slicing.cpp` `object_print_z_uncompensated_height`), #17341 (multiline infill, `Fill/FillBase.cpp`: join pieces that start mid-line and end on themselves, only for `fill_multiline > 1`).

And from the pin move itself: slicer-rs was held to native 2.5.0, so the **app's engine is now what slicer-rs is compared to** (a Benchy's features agree to 0.0 %, the estimate to 0.4 %); comparisons in `slicer-rs/bench/README.md` and `docs/proposals/rust-slicer.md` that name the engine as "OrcaSlicer 2.5.0-dev" should say 2.5.1 once release 4 is in.
