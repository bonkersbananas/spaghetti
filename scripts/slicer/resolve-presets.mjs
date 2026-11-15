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
/**
 * Bambu's own PLA lines the X2D has presets for at the pinned Orca commit, as orca.ts `bambuLine` picks them for Bambu's
 * spools (Orca has no X2D preset for another maker's filament: those slice with the generic ones above): Matte and
 * Silk+ on 0.2 and 0.4 mm with one shared by the 0.6 and 0.8 mm; Silk on 0.4 mm with the shared one (its 0.2 mm is
 * above). Bambu's PLA Pure has no X2D preset there yet (later Orca has it): its spools slice with Basic, which is what
 * orca.ts falls back to, and the name here is for when the pin moves.
 */
const BAMBU_LINES = [
  ...["Bambu PLA Matte", "Bambu PLA Silk+"].flatMap((name) => [
    `${name} @BBL X2D 0.2 nozzle`,
    `${name} @BBL X2D 0.4 nozzle`,
    `${name} @BBL X2D`,
  ]),
  "Bambu PLA Silk @BBL X2D 0.4 nozzle",
  "Bambu PLA Silk @BBL X2D",
];
/** OrcaSlicer 2.5.1's own presets of those lines (and Pure, which it has now) for the 0.6 and 0.8 mm nozzles. */
const BAMBU_LINES_NOZZLES = ["Bambu PLA Matte", "Bambu PLA Silk+", "Bambu PLA Silk", "Bambu PLA Pure"].flatMap((name) =>
  ["0.2", "0.4", "0.6", "0.8"].map((nozzle) => `${name} @BBL X2D ${nozzle} nozzle`),
);
/**
 * Bambu's presets for the 0.6 and 0.8 mm nozzles were one set per filament ("Generic PLA @BBL X2D"); OrcaSlicer 2.5.1
 * has one of their own for most of Bambu's ("Bambu PLA Basic @BBL X2D 0.6 nozzle") and keeps the shared one for the
 * rest. Both forms are asked for, the ones Orca doesn't have are left out (orca.ts `pickFilamentPreset` takes the first
 * the release has), and the build stops when a material has neither on a nozzle.
 */
const forNozzle = (name, nozzle) =>
  nozzle === "0.6" || nozzle === "0.8"
    ? [`${name} @BBL X2D ${nozzle} nozzle`, `${name} @BBL X2D`]
    : [`${name} @BBL X2D ${nozzle} nozzle`];
const REQUIRED = [
  ...MATERIALS.flatMap((name) => ["0.4", "0.6", "0.8"].map((nozzle) => forNozzle(name, nozzle))),
  ...MATERIALS_0_2.map((name) => forNozzle(name, "0.2")),
];
const FILAMENTS = [...new Set([...REQUIRED.flat(), ...BAMBU_LINES, ...BAMBU_LINES_NOZZLES])];

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
  const bbl = folder("BBL");
  const library = folder("OrcaFilamentLibrary");
  const listed = new Set(
    [bbl, library].flatMap((vendor) => (vendor.index.filament_list ?? []).map((entry) => entry.name)),
  );
  const stranded = REQUIRED.filter((names) => !names.some((name) => listed.has(name)));
  if (stranded.length) throw new Error(`no preset on a nozzle: ${JSON.stringify(stranded)}`);
  const wanted = [
    ...MACHINES.map((name) => ({ type: "machine", name })),
    ...PROCESSES.map((name) => ({ type: "process", name })),
    ...FILAMENTS.filter((name) => listed.has(name)).map((name) => ({ type: "filament", name })),
  ];
  const result = await host.request("profiles.resolve", {
    vendor: bbl,
    library,
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
