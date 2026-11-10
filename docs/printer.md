# The printer: Bambu Lab X2D (Combo, with AMS)

Background for agents building printer-aware features. Spaghetti **understands** this printer's details but **must never depend on a Bambu service** (cloud, Handy app, account) to work. Everything below that Spaghetti consumes must be readable from files the user hands us or from what they type.

## How to read this document

- **[confirmed]** appears in at least two independent sources or an official page.
- **[uncertain]** comes from a single source, sources conflict, or it is from memory of file formats and unverified against the X2D specifically.
- The X2D launched in April 2026. Most sources are retailer listings and early reviews; Bambu's own pages (bambulab.com, wiki.bambulab.com) blocked or did not return to our fetcher, so **verify against Bambu's wiki before building anything that hinges on a single number**.
- Section 3 (file formats) is confirmed against the slicers' source, but not yet against a real file from the X2D: when you get one, run it through `readThreeMf` and check.

Sources:

- [BambuHub X2D specs](https://bambuhub.net/printers/x2d)
- [Anton Månsson: X2D breakdown](https://www.antonmansson.com/3d-printing-blog/bambu-lab-x2d-breakdown)
- [Makers101: X2D specs and release](https://makers101.com/bambu-lab-x2d-specs-release-date/)
- [B&H: X2D Combo listing](https://www.bhphotovideo.com/c/product/1966031-REG/bambu_lab_pf004_p_sa007_us_x2d_combo_3d_printer.html)
- [Bambu Lab store: AMS 2 Pro](https://eu.store.bambulab.com/collections/bambu-lab-ams/products/ams-2-pro)
- [DEV: What's inside a Bambu/Orca 3MF](https://dev.to/joyfunc/whats-actually-inside-a-bambuorca-3mf-24p0)
- [Printago: 3MF file format](https://printago.io/blog/3mf-file-format)
- [BambuStudio wiki: command-line usage](https://github.com/bambulab/BambuStudio/wiki/Command-Line-Usage)
- [Bambu Studio source: bbs_3mf.cpp](https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp) and [Orca Slicer source: bbs_3mf.cpp](https://github.com/SoftFever/OrcaSlicer/blob/main/src/libslic3r/Format/bbs_3mf.cpp)

## 1. The printer

| Item | Value | Status |
|---|---|---|
| Build volume, main (left) nozzle | 256 × 256 × 260 mm | confirmed |
| Build volume, dual-nozzle / auxiliary nozzle | about 235 × 256 × 256 mm (sources say 235 or 235.5 wide) | uncertain on exact numbers |
| Nozzles | Two: a direct-drive main nozzle and an auxiliary nozzle fed through a Bowden tube | confirmed |
| Nozzle swap | Mechanical lift, no extra motor. Not a tool-changer like the H2C | confirmed (Månsson, Makers101) |
| Nozzle size | Stock 0.4 mm. Other sizes not listed by any source we could read | uncertain |
| Hardened nozzle | BambuHub says stock nozzles are hardened steel; no second source | uncertain |
| Nozzle fitting | Tool-free quick-release, said to be shared across X2, H2 and P2 series | uncertain |
| Max nozzle temp | 300 °C (a rumored 350 °C did not ship) | confirmed |
| Max bed temp | 120 °C | confirmed |
| Chamber | Actively heated to 65 °C ("Heat mode"); a "Cool mode" pulls in outside air for PLA/PETG. 3-stage filter (G3, H12 HEPA, carbon) | confirmed |
| Motion | CoreXY; main toolhead up to 1,000 mm/s, 20,000 mm/s² | confirmed (BambuHub) |
| Auxiliary nozzle limit | 200 mm/s, 1,000 mm/s². Dual-material prints run a bit slower; reviewers saw about 10 min extra on a 2 h print | confirmed |
| Layer height | 0.08–0.28 mm with a 0.4 mm nozzle (Bambu Studio default range) | confirmed |
| Cameras | 1080p Liveview camera plus a toolhead camera; AI failure detection (spaghetti, nozzle clumping, poop-chute jams) and plate checks before printing. No LiDAR, no nozzle/BirdsEye camera, no laser | confirmed |
| Optional | Vision Encoder add-on (about 50 µm motion accuracy) | confirmed |
| Network | Dual-band Wi-Fi, no Ethernet | uncertain (one source) |

**Build plates.** Textured PEI on a magnetic plate is the stock surface per BambuHub **[uncertain]**; a double-sided PEI plate is sold as an accessory. Bambu Studio also offers Cool Plate, Engineering Plate, High Temp Plate and Smooth/Textured PEI as "bed type" options; the X2D's exact list is **[uncertain]**. The cameras verify the loaded plate type.

**Materials.**

- Main nozzle: PLA, PETG, ABS, ASA, PA, PC, PET, PVA and fiber-reinforced (CF/GF) variants. TPU only on the main nozzle.
- Auxiliary (Bowden) nozzle: best for support materials (PVA, BVOH, Bambu support filaments). Bambu advises against TPU there.
- PA6-CF, PETG-CF and ASA-CF: main nozzle recommended. PPA-CF/GF: main nozzle only. PPS: not supported.
- Drying matters for PA and PC.
- Listings conflict on TPU through the AMS: some say supported with "TPU for AMS", others list generic TPU, TPE, damp PVA and damp BVOH as unsupported **[uncertain]**.

**Speed profiles.** Bambu Studio ships Standard, Quiet/Silent, Sport and Ludicrous-style process presets named like `0.20mm Standard @BBL X2D` **[uncertain]**; the preset name is stored in the 3mf (`print_settings_id`), which is what Spaghetti should read rather than hard-coding the list. Typical layer heights are 0.08, 0.12, 0.16, 0.20 and 0.28 mm.

## 2. The AMS in the Combo

- The Combo includes one **AMS 2 Pro** (sources B&H, Gigaparts, BambuHub). The base X2D has no AMS.
- Four slots per unit. The X2D supports AMS 2 Pro and AMS HT, up to 4 AMS 2 Pro plus 8 AMS HT, about 24 slots, and up to 25 colors per print including the external spool **[confirmed by several retailers, not by Bambu's own page]**.
- The AMS 2 Pro has a built-in filament dryer with a humidity sensor and an electromagnetic air valve, and spools rotate while drying. It dries to about 70 °C; the AMS HT reaches about 85 °C, better for PA/PC **[uncertain on exact temperatures]**. Drying needs Bambu's official power adapter.
- Filaments it can't feed or dry fully: TPE and generic TPU, damp PVA/BVOH, and some CF/GF materials. Filaments marked with an asterisk on Bambu's page need an AMS HT.
- AMS units can feed either nozzle (one reviewer's finding). Bambu Studio's per-nozzle filament assignment has a learning curve **[uncertain]**.
- The AMS has run-out, grinding and tangle sensors.

**Slot to color mapping.** In a slice, each *project filament* (numbered from 1) is assigned a physical AMS slot at print time. The 3mf stores the filaments' type and color per project filament; which slot they land in is decided when the user presses Print (the "AMS mapping"). A 3mf therefore tells us *what* filaments a plate used and their colors, but often **not** which physical slot. Treat slot as something the user can optionally tell us. Slot IDs conventionally look like unit A–D and slot 1–4 (for example "A2") **[uncertain]**.

## 3. What a `.3mf` / `.gcode.3mf` holds

A 3mf is a ZIP; unzip it locally and read it with no network. A *project* `.3mf` is saved before slicing; a sliced `.gcode.3mf` also holds G-code and per-plate stats. **[confirmed]** against the writers in Bambu Studio's and Orca Slicer's source (`src/libslic3r/Format/bbs_3mf.cpp`, `bbs_3mf.hpp`, `GCode/ThumbnailData.hpp`, `PrintConfig.cpp`); the file list still varies by slicer version. Not checked against a file from the X2D itself.

| Path in archive | Format | Contents useful to Spaghetti |
|---|---|---|
| `Metadata/plate_N.png` | PNG | Plate thumbnail (N from 1). Also `plate_no_light_N.png`, `top_N.png`, `pick_N.png` (the picking map, not for display); `plate_N_small.png` is not written by the sources we read. `model_settings.config` names the thumbnail in its `thumbnail_file` entry. Best source for a "photo of what was meant to print" |
| `Metadata/slice_info.config` | XML | Written only when the plate was sliced. `<config>` holds a `<header>` (client type/version) and one `<plate>` per sliced plate. A plate holds `<metadata key= value=>` entries (`index` from 1, `prediction` in seconds, `weight` in grams, `nozzle_diameters`, `printer_model_id`, `support_used`, `outside`, `timelapse_type`, `first_layer_time`, `filament_maps`, …), `<object identify_id name skipped/>` and `<filament id tray_info_idx type color used_m used_g …/>`. Only filaments used on that plate appear, so this beats the project-wide list. `<warning msg level error_code/>` carries slicer warnings |
| `Metadata/plate_N.json` | JSON | Layout for the printer's object-skipping view. Keys: `bbox_all`, `bbox_objects` (`name`, `bbox`, `area`, `layer_height`), `filament_ids`, `filament_colors`, `is_seq_print`, `first_extruder`, `nozzle_diameter` (a float32, so `0.4000000059604645`), `bed_type`, `first_layer_time`, `version` |
| `Metadata/project_settings.config` | JSON | All slicer settings (500+ keys), all values strings or arrays of strings. Scalars: `layer_height`, `initial_layer_print_height`, `sparse_infill_density` (`"15%"`), `sparse_infill_pattern`, `wall_loops`, `enable_support` (`"0"`/`"1"`), `support_type`, `printer_model`, `printer_settings_id`, `print_settings_id`, `curr_bed_type` (`"Textured PEI Plate"`, `"Cool Plate"`, `"Engineering Plate"`, `"High Temp Plate"`, `"Supertack Plate"`). Per filament, one entry each: `filament_type`, `filament_colour` (British spelling), `filament_settings_id`, `nozzle_temperature`, `nozzle_temperature_initial_layer`, and the bed temperature of each plate type: `cool_plate_temp`, `eng_plate_temp`, `hot_plate_temp`, `textured_plate_temp`. `nozzle_diameter` is per extruder |
| `Metadata/model_settings.config` | XML | `<object id>` with `<metadata key="name">` and `extruder` (the project filament number, from 1), `<part>`s, and one `<plate>` per plate: `plater_id`, `plater_name` (empty unless named), `locked`, `bed_type`, `thumbnail_file`, and `<model_instance>`s that point at objects by `object_id` |
| `Metadata/plate_N.gcode` (+ `.md5`) | text | G-code. Its header comments repeat time, weight and filament usage; only in sliced files. Large, so never read whole |
| `3D/3dmodel.model`, `3D/Objects/*.model` | XML | Geometry and the object-to-plate assembly. The top-level model's `<metadata name="Application">` says who wrote the file (`BambuStudio-02.01.00.00`, `OrcaSlicer-2.3.1`) |
| `[Content_Types].xml`, `_rels/.rels` | XML | Standard 3MF plumbing |

Guidance for the parser:

- Parse defensively: every key optional, unknown keys ignored, and a failure must never block logging an attempt.
- Orca Slicer writes the same layout and key names (checked in its source); versions add keys rather than rename them.
- Reading `.gcode.3mf` also lets us offer "estimated time vs actual" for free.
- Never write back into the user's 3mf.

### Reading .3mf files

`src/shared/threemf/` reads these files in the browser (or a Worker): no network, no DOM, only `fflate` for the zip. Import from `@shared/threemf/index.ts`.

```ts
import { readThreeMf, readThreeMfFile } from "@shared/threemf/index.ts";

const result = await readThreeMfFile(file); // a dropped File/Blob; readThreeMf(bytes) is the sync form
```

`ThreeMfResult` (see `types.ts`):

- `kind`: `"sliced"` (has `slice_info.config`), `"project"` (plates or settings, never sliced) or `"unknown"` (foreign or broken).
- `slicer?`: `{ name, version }` from the model's Application metadata.
- `plates[]`: `index`, `name?`, `thumbnail?` (`{ bytes, mediaType }`, sniffed from the bytes), `predictedSeconds?`, `weightGrams?`, `objects[]` (`name`, `skipped?`), `filaments[]` (`slot`, `type?`, `colorHex?` as `#rrggbb`, `profile?`, `usedGrams?`, `usedMeters?`), `bedType?`, `nozzleDiameter?`, `supportUsed?`.
- `settings`: `printerModel`, `printerPreset`, `processPreset`, `layerHeight`, `initialLayerHeight`, `infillDensity` (percent), `infillPattern`, `wallLoops`, `supportEnabled`, `supportType`, `nozzleTemperature[]`, `nozzleTemperatureInitialLayer[]`, `bedTemperature[]` (for the selected bed type; all per project filament), `bedType`, `nozzleDiameter`. All optional.
- `warnings[]`: why something is missing. The reader never throws.

Safety: each entry is inflated as a stream and dropped as soon as it passes its cap (a few MB for config files, 4 MB for images), so a zip bomb costs little. G-code and geometry are never unpacked; only the first 16 KB of `3D/3dmodel.model` is read.

What it can't know:

- **Which physical AMS slot a filament ended up in.** `PlateFilament.slot` is the *project* filament number (from 1), not a slot like A2; the AMS mapping is made when the user presses Print and no file records it. The UI should let the person say it.
- **Actual print time, success or failure.** Only the slicer's estimate is in the file; the real outcome comes from the person.
- **Settings are the project's, not per-object.** Per-object and per-layer-range overrides (a different infill on one part, say) are ignored, and with several printers or process presets in one project only the first entry is read.
- **Project files have no slice.** Their plate filaments are a guess from each object's assigned extruder, with no grams or meters, and there is no time or weight.
- **Unrecognised files.** Other slicers' 3mf files (PrusaSlicer, Cura, CAD tools) give `kind: "unknown"`; the PrusaSlicer layout is different and not read.

### How the app uses it

- `settingsFromFile(result, plate)` (`src/shared/threemf/prefill.ts`) turns one plate into `AttemptSettings`: its filaments (type, color, preset without the `@BBL X2D` suffix), bed type, nozzle size, layer height, infill, wall loops, supports (tree when `support_type` says so), process preset, the temperatures of the first filament the plate uses, and the plate's estimate (minutes) and weight. `printablePlates` lists the sliced plates of a `.gcode.3mf` (else every plate) for the "which plate?" question.
- `matchFilaments` (`src/shared/spools.ts`) links the file's filaments to spools: the same material (`materialKey`: "PETG HF" is PETG, "PLA Matte" is PLA) in a color within `SAME_COLOR` of the file's (a "redmean" distance), preferring a spool with filament left, then one loaded in the AMS, then the closest color. A file without colors only matches a lone spool of that material.
- `printerHints` gives the gentle checks of section 1 and 2 against the printer's setup as people describe it (nozzles fitted, hardened or not).

## 4. Local-only printer state (background only)

Not proposed for now. For awareness:

- **LAN Only mode / Developer mode.** The printer can be switched to local operation, which the slicer connects to by IP and access code. Orca Slicer supports this. **Needs:** the printer on the same network, its IP, serial number and the access code. **Risks:** the user gives up the cloud features they may like (Handy app, remote monitoring); the access code is a secret; and the X2D is new, so firmware may change this behavior **[uncertain]**.
- **MQTT** (TLS, on the printer) pushes status JSON (temperatures, progress, AMS tray info, errors) and accepts commands. **Risks:** commands can start, stop or heat the printer, so a bug can damage a print or hardware. The message schema is community-documented and shifts between firmware versions.
- **FTP** (implicit TLS) gives access to the SD card (uploaded `.3mf` files, timelapses). **Risks:** same credentials; a write could overwrite files.
- **Camera.** An RTSP/stream or image stream on the LAN. **Risks:** hold a live connection, credentials, and a private view of the home.
- Bambu's firmware "authorization" changes have affected third-party control in the past; never design a feature that stops working when these change.

## 5. Failure modes (starting vocabulary)

| Failure | Looks like | Likely cause |
|---|---|---|
| Spaghetti | Loose tangled strands where the part detached or the layers lost support | Part came off the bed, a failed overhang, or a layer-shift knock |
| Poor bed adhesion | First layer lifts or peels, corners curl up, part slides | Dirty plate, wrong plate for the material, bed too cool, no glue stick |
| Warping | Corners or edges lift as the part cools; bottom curves | Thermal contraction on ABS/ASA/PA/PC, or a drafty or cold chamber |
| Layer shift | Layers offset sideways partway up | Collision with a curled edge or a nozzle blob, too-fast moves, or a loose belt |
| Nozzle clog | Extrusion stops or clicks, thin or no filament | Debris, burnt filament, heat creep, or a wet or low-quality spool |
| Under-extrusion | Gaps, thin or weak walls, rough top | Partial clog, wet filament, too-fast volumetric flow, wrong flow ratio |
| Over-extrusion / blobs | Rough surface, bulging, zits | Flow too high, wet filament, or pressure advance mistuned |
| Stringing | Fine hairs between features | Wet filament, nozzle too hot, retraction too small |
| Elephant's foot | Bottom layers flare outward | Bed too hot or first layers squished |
| AMS feed failure | Print pauses, "filament run out" or won't load | Spool tangle, a slot not seen, or a brittle filament |
| AMS tangle | Spool jammed, AMS grinding sound | Loose spool wrap, cheap spool |
| Filament change blobs / poop-chute jam | Waste clump blocks the purge chute | Lots of color changes and a full purge chute |
| Aux nozzle quirks | Slightly wavy walls, poor TPU feed | Bowden path and 200 mm/s cap; use the main nozzle for TPU |
| Wet filament | Pops and hisses, rough surface, stringing | Filament absorbed moisture (nylon, PETG, TPU, PVA) |
| Poor overhang / bridging | Drooping or ragged underside | Cooling or support settings |
| Seam / Z-banding | Visible seam line, regular horizontal ripples | Seam placement, mechanical resonance or Z issues |
| Supports stuck or failed | Hard to remove, surface damaged, or supports toppled | Interface gap too small, wrong support filament |
| Cosmetic: color bleed | Streaks of the previous color | Purge too small after a change |

## 6. Proposal: fields per print attempt

Goal: a complete log in under 10 seconds on a phone, one-handed. Everything else is optional and can be added later.

**Required (at most three taps or one photo):**

1. **Build** the attempt belongs to (defaults to the most recent one).
2. **Outcome**: success / partial / failed (one tap; default "success").
3. **Date and time** (defaults to now; editable).

Everything else, including the photo, is optional. If both outcome and a photo are missing, the attempt still saves as a draft. Autosave always.

**Optional, in rough order of usefulness:**

- Photo(s) of the result (the highest-value thing; allow capture right from the attempt sheet).
- One-line note ("what worked / what went wrong").
- Failure tags (shown only when outcome ≠ success).
- Filament(s): type, brand and color, optionally AMS slot.
- Plate type and nozzle (main or auxiliary).
- Layer height, infill, supports, speed profile (profile name).
- Slicer temps: nozzle, bed, chamber.
- Estimated vs actual duration, weight used.
- Slicer file attached (`.3mf`), from which many of the above are **prefilled**, never required.
- Where it failed (layer number or percent), if known.
- Dried filament recently? (yes / no).

Storage principle: record what the user saw or chose as plain values; never store an ID that only makes sense inside Bambu's cloud.

## 7. Proposal: starter failure tags and success notes

**Failure tags** (multi-select, free text allowed; the label is for people, the slug is stable):

`spaghetti`, `bed-adhesion`, `warping`, `layer-shift`, `clog`, `under-extrusion`, `over-extrusion`, `stringing`, `elephants-foot`, `ams-feed`, `ams-tangle`, `purge-chute-jam`, `wet-filament`, `bad-overhang`, `support-trouble`, `color-bleed`, `seam-or-banding`, `power-or-pause`, `other`.

**Success notes** (quick chips that can be tapped; they feed "what worked last time"):

`great-first-layer`, `clean-supports`, `strong-and-tight-fit`, `nice-surface`, `colors-crisp`, `fast-profile-ok`, `dried-filament-helped`, `settings-worth-reusing`, `would-print-again`.

Both lists are a seed. Expect the users to add their own; keep slugs in the data and wording in the UI so labels can change without a migration. The pasta theme can live in the labels' flavor, not the slugs.
