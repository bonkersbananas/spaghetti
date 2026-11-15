# Pre-flight check: is slicer-rs's G-code safe for its first real print on the X2D?

Nov 15, session 1397. Nothing here was sent to a printer, and nothing in the app changed.

**Result: no defect in slicer-rs that would hurt the printer turned up, so there is no slicer fix in this pull request.** Against native OrcaSlicer 2.5.1, with the settings the app hands both slicers, the printer's control G-code of the single-colour cube is the same line for line (start, end, temperatures, fans, bounds, Z), and the two-colour plates differ only in a timelapse photo's form and a few idle-nozzle cooling temperatures (both below). Three things need a person's eye before or at the print, because a sandbox can't settle them:

1. **A two-colour plate with the default grouping prints its first filament on the auxiliary (Bowden) nozzle**, as native Orca's own grouping does. The app cannot choose the nozzle, and OrcaSlicer's engine, the default today, keeps every filament on the main nozzle. See [which nozzle](#which-nozzle).
2. **The `.gcode.3mf` is not byte-compatible with what Bambu Studio writes** (a short settings block, `H-1` as the hotend, no mesh file beside the model). It passes our encoding of Studio's reader rules and opened in Studio on Nov 14, but no X2D has read one yet. See [the file](#the-gcode3mf).
3. **Estimates and filament use are within 0.4 to 2.5 % of Orca's, but the two-colour block has 30 % less "internal solid infill" than Orca's** (it is not a safety matter; see [the numbers](#time-and-filament)).

The task text called the main nozzle the right one. Spaghetti's own decision 0056 and the files say the main (direct-drive) nozzle is the **left** one, extruder 1 (`filament_map` 1, `T1` in the start G-code); the auxiliary Bowden one is the right, extruder 2. This page follows the files.

## What was compared

| | |
| --- | --- |
| Ours | slicer-rs release 34 (the app's pin; `slicer-rs/` has no commit since its source), run as the app runs it: the WebAssembly module in Node (`bench/wasm-node.mjs`) with the setup the app's own `sliceSetup` makes from the engine release's `presets.json` (`slicer-v4`), tower at the app's spot (211, 196) |
| Native | OrcaSlicer 2.5.1's AppImage command line (aarch64), `--arrange 0`, with the same setup's machine, process and filament files, the plate on Textured PEI |
| Part 1 | A 20 mm cube, one PLA (Bambu PLA Basic, 0.4 mm nozzle, 0.20 mm Standard), main nozzle |
| Part 2 | `bench/colour.py --size 20 --height 6`: a 21 × 21 × 6 mm block with an S through it and the S, two objects, two PLA filaments, a prime tower. Sliced twice: Orca's default grouping (**two nozzles**) and both filaments on the main nozzle (`filament_map` 1,1: **one nozzle**) |

`slicer-rs/bench/preflight.py <ours.gcode> <orca.gcode>` repeats the readings below on any pair of files (bounds, flow, speeds, Z, temperatures, and the control lines in order).

## The table

OK means the same lines as native Orca's (or the same by every measure below). Line numbers are those of the cube's file (`cube`) and the two-nozzle plate's (`two`) from the run above.

| Area | What | Verdict | Where |
| --- | --- | --- | --- |
| Start sequence | Every start line (heat bed first `M140 S55`, `G28 X T300 R` homing, `G28 Z`, detection, `M109 S140 A` wipe heat, `M190 S55`, `G29 A1 X116 Y116 I24 J24 R` levelling, mech sweep, the purge line `G130 O0 X100 Y-0.2 Z0.6`) is the machine preset's own text, filled with the same values | OK | `cube` 141, 277, 289, 306, 430 |
| Start | Nozzle temperatures: `M104 S0 T0/T1` both off, `M104 S220 T1` main nozzle rising, `M104 S180 A`, `M109 S220` before the purge; bed 55 (Textured PEI); chamber `M191 S0` (no chamber heating for PLA) | OK | `cube` 158ff |
| Start | Nozzle and extruder selection: `M620 S0A H-1 B`, `T0 H-1`, `M621 S0A B` (twice, as Orca writes them) | OK, with an assumption: `H-1` | `cube` 196, 201 |
| First layer | Z `0.2`, outer wall 50 mm/s, infill 105 mm/s, line width 0.5, `M204 S500`; first path starts at another point of the loop than Orca's (`X118.9 Y137.1`, Orca's `X137.1 Y137.1`) | OK / differs-but-safe | `cube` 496ff |
| Bounds | Extrusion box of the cube [118.21, 118.21, 137.79, 137.79] and of both two-colour plates: identical to Orca's to 0.01 mm; the plate's printable area is 0..256 on both axes with no excluded areas, and the tower (x 211 to 235, y 196 to 219) lies inside the auxiliary nozzle's own area (x from 20.5) | OK | `preflight.py` |
| Bounds | No move goes below its layer's Z (the lowest is the layer's own, `0.2`); layers are 0.2 mm all the way; hops are 0.4 mm over the layer (`G1 Z.6` then `G1 Z.2`) | OK | `preflight.py` |
| Bounds | The toolhead goes to Y 256 (the plate's edge) in every filament change, from the preset's own `G1 Y256 F18000`; Orca's identical | OK | `two` 1178 |
| Speeds | Fastest feed `F60000` = 1,000 mm/s (travel), the preset's machine limit; extrusions at most 258 mm/s on the main nozzle (Orca 263) and 200 mm/s on the auxiliary one (the Bowden cap, Orca's too); `M201`/`M203`/`M204`/`M205` limits are the preset's: 20000 mm/s², 1000 mm/s, jerk 9 | OK | `cube` 1ff |
| Flow | Highest volumetric flow 20.58 mm³/s (cube) and 21.00 (plates), at the filament's limit of 21; Orca's reaches 21.22 on the tower (206 moves above 21), ours never exceeds it | OK (ours is lower) | `preflight.py` |
| Filament change | The `M620`/`M621` blocks, `M620.10` flush lines (`F523.843 H0.4 T240 P220 S1`), `M620.11`, `M620.22`, `T0/T1 H-1`, `M628/M629`, `M1015.x` and `G1 Y256` are Orca's, in the same order, with the same slots: filament 1 asks for AMS slot `M620 S0A`, filament 2 for `S1A` (`two` 1075 `M620 S1A B H-1`). The only changed lines are listed below | OK | `two` 1075ff |
| Filament change | Flush volumes and tower: tower extrusion equal to Orca's, 1,643 mm³ on two nozzles and 1,188 on one (to the mm³); the tower sits at 211, 196 and 50 mm deep | OK | feature volumes |
| Filament change | The idle nozzle cools before the tower and heats again as Orca's does, to targets 1 to 8 °C from Orca's (`M104 T1 S171 N0` against Orca's `S163`; `T0 S210/S195..` likewise); every one is between 25 and 240 °C; the idle one goes to 25 °C at the end | differs-but-safe | `two` 1062, 1084, 18842 |
| Which nozzle | See [below](#which-nozzle) | **Check at the printer** | `two` and the `.gcode.3mf`'s `filament_maps` |
| Temperatures | Highest `M104`/`M109` is 220 (the filament's range is 190 to 240), highest flush temperature 240 (the range's top), bed 55, chamber 0; same set of values as Orca's, nothing above the filament's maximum | OK | `preflight.py` |
| Fans | Part cooling (`M106 P1`), auxiliary and chamber fans (`P2`, `P3`, `P10`), `M142` autocooling `S40` and every `M106` value are the same set as Orca's | OK | |
| End | Heaters off (`M140 S0`, `M141 S0`, `M104 S0 T0/T1`), fans off, `G1 Z20.4` then `Z30` over the cube, filament pulled back to the AMS (`M620 S65279 B` / `S65535`), `G150.3` parks, then the bed goes down (`M17 Z0.4`, `G1 Z90 F600`) with a lowered motor current and returns it | OK | `cube` 14494ff, 14525, 14547 |
| Timelapse | With the app's preset (`farthest_point_timelapse` 1) Orca 2.5.1 takes the photo where the head stands (`M971 S11 C10 O0` and `M1004 S5 P1`); slicer-rs doesn't port that and writes the classic photo (`M9711 M0 E1 U180 V130 Z0.6 S11 C10 O0 T3000`: the head goes to a spot outside the objects first, or the printer picks one). Both run only if the printer's timelapse flag is on (`M622 J1`) | differs-but-safe (a photo moves the head to a spot clear of the print) | `cube` 655 |
| G-code details | One extra `G17` after each lift arc, `M204` written in a different place on the tower plates, `; model label id` 1 and 2 against Orca's 22, 69 and 88 | OK (no effect) | |
| Estimates | See [below](#time-and-filament) | OK (within a few %) | |
| The file | See [below](#the-gcode3mf) | differs-but-safe, with assumptions | |

### Which nozzle

On the X2D the main nozzle is the left direct-drive one (extruder 1); the right one is the auxiliary Bowden nozzle, limited to 200 mm/s and meant for support materials. With two filaments and no map, Orca's "Auto For Flush" grouping (which slicer-rs ports exactly, `filaments.rs`) puts them on one nozzle each, **and the first filament on the auxiliary one**: the file's `filament_maps` is `2 1` (filament 1 on extruder 2), the G-code's block prints filament 1 at 200 mm/s at most and with the auxiliary nozzle's own outer-wall speed of 50 mm/s, and its start asks for `M104 S220` on that nozzle. Native Orca's output has the same, so this is not slicer-rs being wrong, but:

- OrcaSlicer's engine, which slices by default today, keeps every filament on the main nozzle (`gcode3mf.ts` writes `filament_maps` all `1`), and the app has no setting to choose a nozzle. So the same two-colour model prints on a different nozzle depending on which slicer made the file.
- Whether the AMS feeds the auxiliary nozzle depends on how the AMS and the Bowden tube are connected on the real machine; the sandbox can't tell.
- With `filament_map_mode` Manual and `filament_map` 1,1 (the command line's `--filament-map 1,1`, the setup's `filament_map_mode`/`filament_map`) both filaments go on the main nozzle, with flushing at every change: the control lines then equal Orca's apart from the timelapse photo, 50 m 54 s against Orca's 51 m 10 s.

**For the first two-colour print, use the one-nozzle file** (or accept that filament 1 prints on the auxiliary nozzle and watch it). The app can't make one: only the command line can (`spaghetti-slicer --setup setup.json --filaments 1,2 --filament-map 1,1 …`, with a setup from `bench/setup.mts`), and the module's setup with `filament_map_mode` `Manual` and `filament_map` `1,1` in its process. Giving the app a way to ask is a product decision, not made here.

### Time and filament

Orca's numbers are native 2.5.1 with the same settings; ours the WebAssembly module of release 34.

| Plate | Time Orca / ours | Filament mm Orca / ours | Grams Orca / ours |
| --- | --- | --- | --- |
| Cube, one filament | 14 m 0 s / 14 m 3 s (+0.4 %) | 1191.0 / 1186.5 (−0.4 %) | 3.61 / 3.60 |
| Two colours, two nozzles | 26 m 19 s / 25 m 55 s (−1.5 %) | 928.9 + 586.8 / 908.2 + 578.8 (−2.2 %, −1.4 %) | 2.82 + 1.78 / 2.75 + 1.75 |
| Two colours, one nozzle | 51 m 10 s / 50 m 54 s (−0.5 %) | 1619.1 + 1122.7 / 1598.3 + 1114.7 (−1.3 %, −0.7 %) | 4.91 + 3.40 / 4.84 + 3.38 |

On the cube every feature's volume matches (sparse infill 1,127 against 1,116 mm³, the rest exact). On the two-colour block the walls, tower, top and bottom surfaces and sparse infill match, but **internal solid infill is 158 mm³ against Orca's 226** (26 against 38 mm³ in each of the six layers under the top surface): that is the whole 2 % of filament. It makes the top surface rest on less plastic than Orca's would, which may show as a sagging top on such a part; it hurts nothing. It is a known-unknown, not investigated further here (a follow-up for the slicer, not a blocker).

### The .gcode.3mf

`test/unit/slicing/bambu-rules.ts` (our encoding of Bambu Studio's reader: the `BambuStudio-` application tag, entry order, `printer_model_id` N6, the MD5, filament ids and colours) finds no problem in the three files, and the G-code inside is byte-identical to the one written beside it, with the `plate_1.gcode.md5` matching its MD5. Against the `.gcode.3mf` native Orca exports for the cube: the same entries (ours has the plate picture, `Metadata/plate_1.png`; Orca's CLI writes the mesh as a second file under `3D/Objects/`, ours keeps it in `3dmodel.model`), the same `slice_info.config` apart from our `printer_model_id N6` (Orca's CLI leaves it empty) and the estimate, and the same `filament_sequence.json`. Differences a printer or Studio might care about, none of which could be tried here:

- **`H-1`.** The start G-code asks for hotend `-1` (`M620 S0A H-1 B`, `T0 H-1`), as native Orca's command line does (its `initial_no_support_hotend`). Bambu Studio itself might write another number for the X2D; there is no Studio-exported X2D file in the repository to compare with. Assumption: the printer treats `-1` as "the one in the extruder", as it does for Orca's own output.
- **A short settings block.** The G-code's `CONFIG_BLOCK` lists 29 settings (Orca: 743) and the 3MF's `project_settings.config` 40 keys (Orca: 790). Nothing the G-code needs reads them, but the X2D's firmware and Studio's "print" dialog may read more of them than the reader rules say. Studio opened such a file on Nov 14 (Carl Oscar, macOS); the X2D has not read one.
- **The header** says `generated by Spaghetti slicer 0.1.0` where Orca writes `OrcaSlicer 2.5.1`, and the `slice_info` header carries `X-BBL-Client-Version 02.08.01.55` as Studio would.
- Orca's own `slice_info.config` carries a caution (`bed_temperature_too_high_than_filament`: the preset's bed 55 °C against PLA's vitrification temperature of 45 °C); ours writes none, so Studio won't show it. It is Bambu's own preset value, and the cube's bed temperature is the same in both.

### What the CLI's built-in profiles would do

`spaghetti-slicer` without `--setup` slices with profiles from OrcaSlicer 2.5.0-dev (`slicer-rs/profiles/x2d/`), whose filament-change G-code starts with a bare `======== X2D filament_change gcode ==========` line, not a comment; native Orca writes the same line from those profiles. The app always passes a setup made from the 2.5.1 presets (which have the `;`), so its files don't contain it. **Don't print a file made by the command line without `--setup`.**

## Risks, with the lines

No item is a defect found in slicer-rs. In the order to look at them:

1. **First filament on the auxiliary nozzle** (two-colour, default grouping): `M104 S220 T0` heats extruder 0 (the auxiliary), `T0 H-1`, `M620 S0A`, and the 3MF's `filament_maps="2 1"`. Hardware-dependent; use the one-nozzle file for the first two-colour print.
2. **`H-1` in `M620 S0A H-1 B` / `T0 H-1`** (lines 196 and 201 of the cube's file): the same as native Orca's command line, not checked against Studio's own output for the X2D.
3. **A file the X2D has never read**: header and settings block differ from Orca's (above). Studio opened the plain-plate files on Nov 14.
4. **Timelapse** (`M9711 …` in each layer, lines like 655): runs only with timelapse on in the print job; if it is on, watch the first layer's photo: the head leaves the print for a moment.
5. **The tower at the plate's back right** (it stands at x 211, y 196, extruding to x 235, y 219): no object is near it; `G1 Y256 F18000` takes the head to the back edge in every filament change.

## Checklist for the person at the printer

**Print the single-filament cube first, on the main (left) nozzle.** The two-colour test waits until the nozzle grouping question ([above](#which-nozzle)) is decided: do not print a two-colour file from the app before then.

Before: send only a file made by the app (not `spaghetti-slicer` without a setup). For the first print choose the cube, one filament, PLA Bambu PLA Basic on the Textured PEI plate (the file asks for bed 55 °C and nozzle 220 °C). In Bambu Studio's or the printer's dialog check the filament matches the loaded slot and the timelapse is **off**. Clear the plate and the chamber.

The first minute (the start G-code, about 4 to 6 minutes before the first layer: homing, the nozzle wipe, bed levelling and the purge line):

- The toolhead homes (`G28`), the printer runs its detections and levels the bed with its usual probing, with no grinding or knocking. **Stop (the printer's stop button) on any grinding, a nozzle touching the plate before the purge line, or an error about the nozzle camera or the bed.**
- The purge line (`G130 … Y-0.2 Z0.6`, at the plate's front edge, 40 mm long from X 100) prints on the plate and the nozzle never presses into it.
- The first layer starts at 50 mm/s on the outer wall: look at the first 30 seconds: the lines stick and are flat, 0.2 mm high. **Stop** if the nozzle drags the plastic, it lifts off, or the nozzle skips and clicks.
- In a single-filament print the other nozzle stays off (`M104 S0`).

During the print: it runs about 14 minutes; check layer 5 and layer 50 for stringing and the top for clean surfaces. For the two-colour plate (about 26 minutes on two nozzles, 51 on one): at the first filament change watch the tower at the back right: the head goes to Y 256, the old filament is pulled back, the AMS feeds the other slot (`M620 S1A`), the flush lines print on the tower, then the object continues. **Stop** if a slot is empty and the printer asks for a filament it hasn't got (the AMS prompt), if the head hits the tower, or if a flush line doesn't stick.

After: heaters turn off, the filament is pulled back to the AMS, the bed lowers, the toolhead parks.

Compare the real time with the estimate (14 m 3 s for the cube, `M73` on the screen) and tell us: a difference over 10 % is worth a note. Then fill in the retrospective of the print on Spaghetti, and only then change `DEFAULT_SLICER`.
