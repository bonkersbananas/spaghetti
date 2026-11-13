// Flattens the presets Spaghetti slices with, using OrcaSlicer's own preset loader inside the engine
// (`profiles.resolve`: inheritance, included templates, the X2D's nozzle variants), from the same Orca commit as the
// engine, so they can't drift apart. Run by scripts/slicer/build.sh.
//
//   node scripts/slicer/resolve-presets.mjs <engine dist/> <orca resources/profiles/> <out presets.json>
import fs from "node:fs";
import path from "node:path";
import { startHost } from "./host-client.mjs";

// The defaults (src/shared/slicing/defaults.ts) name one of each; the others are here for 3MF projects (a filament
// per material), for the other qualities, and for the X2D's other nozzle sizes (src/shared/slicing/orca.ts says which
// preset each nozzle, quality and filament slices with). Every name is one of Bambu's own X2D presets in Orca's
// profiles: the build stops when one isn't there.
const NOZZLES = ["0.2", "0.4", "0.6", "0.8"];
const MACHINES = NOZZLES.map((nozzle) => `Bambu Lab X2D ${nozzle} nozzle`);
const PROCESSES = [
  // 0.4 mm: the X2D's own names carry no nozzle.
  "0.20mm Standard @BBL X2D",
  "0.08mm High Quality @BBL X2D",
  "0.12mm High Quality @BBL X2D",
  "0.16mm High Quality @BBL X2D",
  "0.16mm Standard @BBL X2D",
  "0.20mm High Quality @BBL X2D",
  "0.24mm Standard @BBL X2D",
  // The other nozzles: every process Bambu has for them.
  "0.08mm High Quality @BBL X2D 0.2 nozzle",
  "0.10mm Standard @BBL X2D 0.2 nozzle",
  "0.12mm Balanced Quality @BBL X2D 0.2 nozzle",
  "0.18mm Balanced Quality @BBL X2D 0.6 nozzle",
  "0.24mm Balanced Quality @BBL X2D 0.6 nozzle",
  "0.30mm Standard @BBL X2D 0.6 nozzle",
  "0.24mm Balanced Quality @BBL X2D 0.8 nozzle",
  "0.32mm Balanced Quality @BBL X2D 0.8 nozzle",
  "0.40mm Standard @BBL X2D 0.8 nozzle",
];
/** A filament per material, as Bambu names them for the 0.4 mm nozzle, and for the 0.6 and 0.8 mm (one set for both). */
const MATERIALS = [
  "Bambu PLA Basic",
  "Generic PLA",
  "Generic PLA Silk",
  "Generic PLA-CF",
  "Generic PETG",
  "Generic PETG-CF",
  "Generic PCTG",
  "Generic ABS",
  "Generic ASA",
  "Generic TPU",
  "Generic PA",
  "Generic PA-CF",
  "Generic PC",
  "Generic PVA",
  "Generic HIPS",
  "Generic PP",
];
/**
 * The 0.2 mm nozzle has fewer: no carbon fibre (it clogs one so fine), no TPU, PA, PP or PCTG, and silk only as
 * Bambu's own. orca.ts slices the others with their nearest kin and says so.
 */
const MATERIALS_0_2 = [
  "Bambu PLA Basic",
  "Generic PLA",
  "Bambu PLA Silk",
  "Generic PETG",
  "Generic ABS",
  "Generic ASA",
  "Generic PC",
  "Generic PVA",
  "Generic HIPS",
];
const FILAMENTS = [
  ...MATERIALS.map((name) => `${name} @BBL X2D 0.4 nozzle`),
  ...MATERIALS.map((name) => `${name} @BBL X2D`),
  ...MATERIALS_0_2.map((name) => `${name} @BBL X2D 0.2 nozzle`),
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
