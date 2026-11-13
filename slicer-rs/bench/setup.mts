// Writes a slice setup for `spaghetti-slicer --setup` (and the WebAssembly module's `setup`) from Spaghetti's
// slicing settings, made the way the app makes one for Orca's engine: `sliceSetup` (src/shared/slicing/configs.ts)
// picks the X2D's presets from the engine's presets.json and writes the settings onto them through orca.ts.
//
//   node slicer-rs/bench/setup.mts <presets.json> ['<settings JSON>'] > setup.json
//
// The settings are what was chosen, in settings.ts's shape (the rest are the defaults), for example
// '{"layerHeight": 0.12, "walls": 4, "infill": 25, "pattern": "gyroid", "filaments": [{"material": "PETG"}]}'.
// presets.json is in the engine's release zip (docs/slicer.md).
import { readFileSync } from "node:fs";
import { type PresetSet, sliceSetup } from "../../src/shared/slicing/configs.ts";

const [presetsPath, settings = "{}"] = process.argv.slice(2);
if (!presetsPath) {
  process.stderr.write("Usage: node slicer-rs/bench/setup.mts <presets.json> ['<settings JSON>']\n");
  process.exit(2);
}
const presets = JSON.parse(readFileSync(presetsPath, "utf8")) as PresetSet;
const setup = sliceSetup(presets, { settings: JSON.parse(settings) });
process.stdout.write(`${JSON.stringify(setup)}\n`);
