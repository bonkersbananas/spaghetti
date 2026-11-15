# Which X2D nozzle should each filament print on?

Nov 15, session 1407. A spike: nothing in slicer-rs or the app changed, and nothing was sent to a printer.

**Recommendation: for now, Spaghetti's own slicer puts every filament on the main (left) nozzle, as OrcaSlicer's engine already does.** It is the only grouping that is sure to print with the Combo's one AMS. It costs flushing: a Benchy painted in two colours takes 6 h 09 m and 58 g on one nozzle, against 2 h 24 m and 28.5 g on two. **Two nozzles come later, once the Printer page knows which nozzle each AMS (or spool) feeds.** Then the slicer uses Orca's grouping, with the larger filament on the main nozzle.

The [pre-flight check](first-print-preflight.md#which-nozzle) found the problem this answers. With two filaments and no map, slicer-rs groups the filaments as native OrcaSlicer 2.5.1 does: filament 1 goes on the auxiliary nozzle and filament 2 on the main one. The app's OrcaSlicer engine keeps them all on the main nozzle, and nothing in the app chooses between the two.

## The X2D's two nozzles and the AMS

| | Main nozzle | Auxiliary nozzle |
| --- | --- | --- |
| Where | Left, extruder 1, `filament_map` 1, `T1` in the start G-code | Right, extruder 2, `filament_map` 2 |
| Drive | Direct drive (servo motor) | A stepper motor at the back, through a PTFE (Bowden) tube |
| Speed | Up to 1,000 mm/s (Bambu's FAQ: "when printing with the main nozzle") | 200 mm/s and 50 mm/s outer walls in the presets (Bowden variants); reviewers measure 200 mm/s |
| Hotend | 300 °C, 0.2, 0.4, 0.6 or 0.8 mm; the two hotends are identical and swap places | the same |
| Reach | The whole plate, 256 × 256 mm, 261 mm high | From x 20.5 mm (235.5 × 256 mm), 256 mm high |
| Retraction | 0.8 mm | 2 mm |
| Materials | Everything the printer prints | Everything except TPU 85A/90A/95A, PLA Aero and PPA-CF (their presets' `filament_printable` 1 = main only). "Print with caution" there: PLA Silk, PETG-CF, ASA-CF, PA6-CF, TPU for AMS, Support for PA/PET; a softer warning for ABS, ASA, PETG, PET-CF |
| What Bambu means it for | The model | Support material ("the main nozzle prints the model while the auxiliary prints the support", Bambu's launch post) |

Sources: Bambu's [X2D specs](https://bambulab.com/en-us/x2d/specs), [FAQ](https://bambulab.com/en-eu/x2d/faq) and [launch post](https://blog.bambulab.com/xcellence-made-simple-bambu-lab-presents-the-x2d/); the X2D presets the app uses (engine release 4, OrcaSlicer 2.5.1); Bambu Studio's own X2D filament profiles (v02.09.01.70).

**The AMS feeds one nozzle.** Each AMS is bound to the left or the right nozzle, and one AMS can't feed both. Only Bambu's Filament Track Switch accessory routes slots to either nozzle. This comes from Bambu's forum ([one AMS with two nozzles](https://forum.bambulab.com/t/one-ams-unit-with-two-nozzles/250717), [two AMS on the left nozzle](https://forum.bambulab.com/t/assigning-2xams-units-to-the-left-nozzle/256592)), not from an official page. Bambu Studio's code agrees: when a file is sent, its slot-mapping popup offers only the "Left AMS" for a filament grouped to the left nozzle and only the "Right AMS" for one grouped to the right. It offers both only with the track switch installed (`SelectMachine.cpp`, `AmsMappingPopup.cpp`). If the filament isn't loaded on that side, Studio suggests "Regroup and slice"; the printer can't move a filament to the other nozzle. The Combo comes with **one** AMS 2 Pro. So the default grouping's "filament 1 on the auxiliary nozzle" needs that nozzle fed by something: a second AMS on the right, the external spool on the right, or the track switch. This contradicts the reviewer's finding in [printer.md](../printer.md#2-the-ams-in-the-combo) that "AMS units can feed either nozzle", which now points here.

## What the groupings are (Orca 2.5.1 and Bambu Studio)

`filament_map_mode` decides the grouping (`PrintConfig.cpp`, `GCode/ToolOrdering.cpp` `get_recommended_filament_maps`, `FilamentGroup.cpp`):

- **Auto For Flush**, the default in Orca and in Studio ("Filament-Saving Mode" in Studio's popup). It tries every way of sharing the filaments out (k-medoids beyond 10,000 ways). It ranks them first by putting each filament on a nozzle that can print it: its material bits and whether its objects lie inside that nozzle's area. Next it prefers groupings that keep each nozzle within the filaments its AMS holds. Last it weighs the flush, counted as time, plus 10 when the main nozzle gets fewer than half of the filaments. The larger group then goes on the main nozzle. With two filaments the groups are 1 and 1, nothing swaps, and **filament 1 ends up on the auxiliary nozzle**. That is what slicer-rs's `filaments.rs` ports, exactly.
- **Auto For Match** ("Convenience Mode") matches the project's filaments to what the connected printer reports in its slots, by colour and filament id. It needs a printer synced to Studio and falls back to Auto For Flush without one. Neither slicer-rs nor the app knows what is loaded where.
- **Manual** ("Custom Mode") is `filament_map` as given; in Studio the user drags filaments between the nozzles. Orca also has **Nozzle Manual** (for printers with several nozzles per extruder) and **Default** (the global setting).
- **Auto For Quality** ("Quality Mode", Studio only, offered when the two extruders differ, as on the X2D) puts support-only filaments on the Bowden nozzle and keeps model filaments off it where it can.
- **TPU** goes on the main nozzle and everything else on the other, with no flush search (Orca's rule whenever a plate uses TPU).

**What someone sees in Bambu Studio.** A plate with two or more filaments gets a "Filament grouping" choice. Its default is Auto For Flush ("…based on the most filament-saving principles to minimize waste"), and the filament list shows each filament under its nozzle. Custom mode lets the user drag them across ("Tips: You can drag the filaments to reassign them to different nozzles."). Convenience mode shows "(Sync with printer)" until a printer is connected. At Print, each filament maps only to a slot of its own nozzle's AMS. A material the nozzle can't print blocks the send ("%s is not supported by %s extruder."), and a cautioned one warns ("There may be critical print quality issues when printing '%s' with %s Bowden extruder. Use with caution!").

## The numbers

slicer-rs as it is on main (release 35's source), native, with the app's setup from engine release 4's presets (`sliceSetup`, PLA Basic for every filament, the app's stand-in colours orange, blue, green and amber, the tower at 211, 196, 0.4 mm on both nozzles, Textured PEI). Each slice took 1 to 2 s; the grouping doesn't change slicing time. "Flush" is what goes down the chute when a nozzle changes filament. "Tower" is the prime tower, printed on every change of nozzle or filament. "Swaps" are changes of filament within one nozzle, which flush; "switches" are changes of nozzle, which don't flush. The model's own plastic is the same in every row.

No real painted project is in the repository or the sandbox (the GitHub sample the memory mentions is gone). The painted cases are therefore a real model, 3DBenchy, painted by face direction as the memory describes: its +x faces in filament 2 for two colours, and its +x, −x and upward faces in filaments 2, 3 and 4 for four.

**Two-colour block** (`bench/colour.py --size 20 --height 6`: the pre-flight's block with an S, 21 × 21 × 6 mm; block 1.63 g, S 0.88 g):

| Grouping | `filament_map` | Time | Total | Tower | Flush | Swaps / switches |
| --- | --- | --- | --- | --- | --- | --- |
| (a) All on the main nozzle | 1 1 | 50 m 57 s | 8.30 g | 1.50 g | 4.29 g | 28 / 0 |
| (b) Orca's default | 2 1 | 26 m 3 s | 4.59 g | 2.07 g | 0 | 0 / 28 |
| (c) Default, larger filament on the main nozzle | 1 2 | 23 m 29 s | 4.59 g | 2.07 g | 0 | 0 / 28 |

**Benchy in two colours** (240 layers; filament 1 9.40 g, filament 2 2.64 g of model):

| Grouping | `filament_map` | Time | Total | Tower | Flush | Swaps / switches |
| --- | --- | --- | --- | --- | --- | --- |
| (a) All on the main nozzle | 1 1 | 6 h 9 m | 58.02 g | 11.95 g | 34.02 g | 236 / 0 |
| (b) Orca's default | 2 1 | 2 h 48 m | 28.54 g | 16.50 g | 0 | 0 / 236 |
| (c) Default, larger filament on the main nozzle | 1 2 | 2 h 24 m | 28.54 g | 16.50 g | 0 | 0 / 236 |

**Benchy in four colours** (filaments 6.41, 2.64, 2.37 and 1.33 g of model):

| Grouping | `filament_map` | Time | Total | Tower | Flush | Swaps main / aux |
| --- | --- | --- | --- | --- | --- | --- |
| (a) All on the main nozzle | 1 1 1 1 | 14 h 28 m | 116.2 g | 28.0 g | 75.4 g | 596 / 0 |
| (b) Orca's default | 1 2 1 1 | 10 h 48 m | 92.8 g | 34.7 g | 45.4 g | 358 / 0 |
| two and two | 1 1 2 2 | 11 h 33 m | 130.2 g | 34.8 g | 82.6 g | 237 / 127 |
| two and two | 1 2 1 2 | 11 h 37 m | 139.2 g | 34.8 g | 91.6 g | 237 / 127 |
| two and two | 1 2 2 1 | 11 h 44 m | 136.4 g | 34.8 g | 88.9 g | 126 / 238 |
| (b) mirrored | 2 1 2 2 | 12 h 26 m | 160.8 g | 34.7 g | 113.3 g | 0 / 358 |

What the numbers say:

- **On two nozzles, two colours flush nothing**, and the plate takes about half the time and plastic of one nozzle. The waste on one nozzle is large: the two-colour Benchy throws away 34 g of flush plus 12 g of tower for 12 g of boat.
- **The tower grows on two nozzles** (16.5 g against 12 g on the Benchy). The nozzle that comes back from idling primes on it at every switch.
- **The auxiliary nozzle is slower.** Putting the larger filament on the main nozzle, (c), saves 2.5 min on the block and 24 min (14 %) on the Benchy over Orca's default. Orca can't tell the two 1-filament groups apart, so it leaves filament 1 on the auxiliary nozzle whichever is larger.
- **The auxiliary nozzle flushes about 2.5 times as much per swap** (0.32 g against 0.13 g on the main nozzle in the four-colour Benchy). It uses the single-nozzle flush table and its own multiplier. That is why Orca's default, which keeps all swaps on the main nozzle, beats every two-and-two split, and the mirror of it is the worst.
- These depend on the colours: flush volumes come from each pair of colours, and black to white flushes far more than orange to blue.

## Risks of each

| Grouping | Risks at the printer |
| --- | --- |
| (a) All on the main nozzle | None found beyond any multi-colour print: the auxiliary nozzle stays off (`M104 S0`). It wastes the most, and long multi-colour prints take two to three times as long. The control lines equal native Orca's with `--filament-map 1,1` ([pre-flight](first-print-preflight.md#which-nozzle)), and it is what OrcaSlicer's engine already makes, so both slicers give the same file. |
| (b) Orca's default | **The auxiliary nozzle must be fed.** With the Combo's one AMS on the main nozzle, Studio's or the printer's mapping can't put filament 1 anywhere and the print can't start until someone regroups or loads the right side. The first filament (often the main body) prints through the Bowden nozzle: slower, with the longer retraction, and with a caution for PETG, ABS, ASA and silk. The idle nozzle cools to 130 to 170 °C between switches and heats again; the tower primes it, but ooze can string across the part when a nozzle comes back. If the auxiliary nozzle has another size fitted (the Printer page allows a 0.2 mm there), a file sliced for 0.4 on both would print wrong lines or fail the printer's nozzle check. |
| (c) Larger filament on the main nozzle | As (b), minus the slow main body: only the smaller filament goes through the Bowden nozzle. It is not Orca's or Studio's behaviour, so our file would differ from what Studio slices for the same project. |
| Quality mode / support on the auxiliary nozzle | What Bambu built the auxiliary nozzle for, and the safest use of it, but only for plates with a support filament (2 % of real projects in the memory's GitHub sample). |

slicer-rs already keeps a filament off the auxiliary nozzle when its material can't print there (TPU, by `filament_printable`) or when its objects lie outside that nozzle's area. It doesn't port Studio's caution levels, and it doesn't port Orca's TPU rule that sends every other filament to the auxiliary nozzle.

## Recommendation

1. **Now, and for the first two-colour prints: everything on the main nozzle.** Make the app's setup for slicer-rs say `filament_map_mode` Manual with every `filament_map` 1, as the CLI's `--filament-map 1,1` does. It is a small change to the app, not to slicer-rs. Both slicers then make the same plate, it prints with the one AMS as it comes, and nothing depends on how the right nozzle is fed. The cost is time and flush on multi-colour plates, shown above.
2. **Then, when someone wants the speed: let the Printer page say what feeds the right nozzle** (nothing, a second AMS, the external spool, or the track switch), next to the auxiliary nozzle's size it already knows. When the right nozzle is fed and has the main nozzle's size, slice with Orca's Auto For Flush and put the larger group's or filament's plastic on the main nozzle. Keep the materials cautioned for the Bowden nozzle off it. The card should name a filament that prints on the auxiliary nozzle, so people load it on the right side. A model could still ask for "one nozzle" in its More.
3. Support filaments on the auxiliary nozzle (Studio's Quality mode) can come with step 2 at little cost, since they are what that nozzle is for.

## The question for Carl Oscar

Should two-colour prints from Spaghetti's own slicer keep every filament on the main nozzle for now (slower and more flush, but it prints with the one AMS as it is), or use both nozzles?

- **Main nozzle only for now** (the recommendation; both nozzles once the Printer page knows what feeds the right one)
- **Both nozzles now**: my AMS or a spool already feeds the right nozzle
- **Wait**: I'll check which nozzle my AMS feeds first
