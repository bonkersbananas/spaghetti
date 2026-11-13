// Flattens the presets Spaghetti slices with, using OrcaSlicer's own preset loader inside the engine
// (`profiles.resolve`: inheritance, included templates, the X2D's nozzle variants), from the same Orca commit as the
// engine, so they can't drift apart. Run by scripts/slicer/build.sh.
//
//   node scripts/slicer/resolve-presets.mjs <engine dist/> <orca resources/profiles/> <out presets.json>
//
// The defaults (src/shared/slicing/defaults.ts) name one of each; the others are here for 3MF projects (a filament
// per material) and for settings later (the other layer heights).
import fs from "node:fs";
import path from "node:path";
import { startHost } from "./host-client.mjs";

const MACHINES = ["Bambu Lab X2D 0.4 nozzle"];
const PROCESSES = [
  "0.20mm Standard @BBL X2D",
  "0.08mm High Quality @BBL X2D",
  "0.12mm High Quality @BBL X2D",
  "0.16mm High Quality @BBL X2D",
  "0.16mm Standard @BBL X2D",
  "0.20mm High Quality @BBL X2D",
  "0.24mm Standard @BBL X2D",
];
const FILAMENTS = [
  "Bambu PLA Basic @BBL X2D 0.4 nozzle",
  "Generic PLA @BBL X2D 0.4 nozzle",
  "Generic PLA Silk @BBL X2D 0.4 nozzle",
  "Generic PLA-CF @BBL X2D 0.4 nozzle",
  "Generic PETG @BBL X2D 0.4 nozzle",
  "Generic PETG-CF @BBL X2D 0.4 nozzle",
  "Generic PCTG @BBL X2D 0.4 nozzle",
  "Generic ABS @BBL X2D 0.4 nozzle",
  "Generic ASA @BBL X2D 0.4 nozzle",
  "Generic TPU @BBL X2D 0.4 nozzle",
  "Generic PA @BBL X2D 0.4 nozzle",
  "Generic PA-CF @BBL X2D 0.4 nozzle",
  "Generic PC @BBL X2D 0.4 nozzle",
  "Generic PVA @BBL X2D 0.4 nozzle",
  "Generic HIPS @BBL X2D 0.4 nozzle",
  "Generic PP @BBL X2D 0.4 nozzle",
];

const [dist, profiles, out] = process.argv.slice(2);
if (!dist || !profiles || !out) {
  console.error("usage: node resolve-presets.mjs <engine dist/> <orca resources/profiles/> <out.json>");
  process.exit(2);
}

/** A vendor folder as the engine takes it: its index and every file the index lists. */
function folder(id) {
  const index = JSON.parse(fs.readFileSync(path.join(profiles, `${id}.json`), "utf8"));
  const files = {};
  for (const list of ["machine_model_list", "machine_list", "process_list", "filament_list"]) {
    for (const entry of index[list] ?? []) {
      const file = path.join(profiles, id, entry.sub_path);
      if (fs.existsSync(file)) files[entry.sub_path] = JSON.parse(fs.readFileSync(file, "utf8"));
    }
  }
  return { id, index, files };
}

const host = await startHost(dist);
try {
  await host.request("load", { variant: "st" });
  const wanted = [
    ...MACHINES.map((name) => ({ type: "machine", name })),
    ...PROCESSES.map((name) => ({ type: "process", name })),
    ...FILAMENTS.map((name) => ({ type: "filament", name })),
  ];
  const result = await host.request("profiles.resolve", {
    vendor: folder("BBL"),
    library: folder("OrcaFilamentLibrary"),
    presets: wanted,
  });
  if (result.missing.length) throw new Error(`not in Orca's profiles: ${JSON.stringify(result.missing)}`);
  const presets = { format: 1, orca: host.hello.engine.orca, machine: {}, process: {}, filament: {} };
  for (const preset of result.presets) presets[preset.type][preset.name] = preset.config;
  fs.writeFileSync(out, `${JSON.stringify(presets)}\n`);
  const counts = Object.fromEntries(
    ["machine", "process", "filament"].map((type) => [type, Object.keys(presets[type]).length]),
  );
  console.log(`presets: ${JSON.stringify(counts)}, ${fs.statSync(out).size} bytes`);
} finally {
  host.close();
}
