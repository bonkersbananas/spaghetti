// Smoke test of a packed engine: unzips it, starts its host in Node and slices a 20 mm cube for the X2D with each
// nozzle's Standard presets from its presets.json (0.4 mm, the default, then 0.2, 0.6 and 0.8), checking the layers
// and line widths each comes out with. The release workflow runs it before publishing.
//
//   node scripts/slicer/smoke.mjs dist/slicer-release/spaghetti-slicer-1.zip
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { startHost } from "./host-client.mjs";

const zipFile = process.argv[2];
if (!zipFile) {
  console.error("usage: node smoke.mjs <spaghetti-slicer-N.zip>");
  process.exit(2);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "spaghetti-slicer-"));
for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(fs.readFileSync(zipFile))))) {
  fs.writeFileSync(path.join(dir, name), bytes);
}
const presets = JSON.parse(fs.readFileSync(path.join(dir, "presets.json"), "utf8"));
/** Each nozzle's Standard: its machine, process and Bambu PLA Basic, as src/shared/slicing/orca.ts names them. */
const NOZZLES = [
  { nozzle: 0.4, process: "0.20mm Standard @BBL X2D", filament: "Bambu PLA Basic @BBL X2D 0.4 nozzle" },
  { nozzle: 0.2, process: "0.10mm Standard @BBL X2D 0.2 nozzle", filament: "Bambu PLA Basic @BBL X2D 0.2 nozzle" },
  { nozzle: 0.6, process: "0.30mm Standard @BBL X2D 0.6 nozzle", filament: "Bambu PLA Basic @BBL X2D" },
  { nozzle: 0.8, process: "0.40mm Standard @BBL X2D 0.8 nozzle", filament: "Bambu PLA Basic @BBL X2D" },
];
for (const { nozzle, process: name, filament } of NOZZLES) {
  if (!presets.machine[`Bambu Lab X2D ${nozzle} nozzle`] || !presets.process[name] || !presets.filament[filament]) {
    throw new Error(`presets.json lacks the ${nozzle} mm nozzle's Standard`);
  }
}

/** A 20 mm cube in the middle of the X2D's plate, as a triangle soup. */
function cube(size, cx, cy) {
  const h = size / 2;
  const v = (x, y, z) => [cx + x * h, cy + y * h, (z + 1) * h];
  const faces = [
    [v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), v(1, -1, -1)],
    [v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)],
    [v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1)],
    [v(1, 1, -1), v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1)],
    [v(-1, 1, -1), v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1)],
    [v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1)],
  ];
  return new Float32Array(faces.flatMap(([a, b, c, d]) => [...a, ...b, ...c, ...a, ...c, ...d]));
}

const host = await startHost(dir);
try {
  console.log(`${host.hello.engine.name} ${host.hello.engine.version}, OrcaSlicer ${host.hello.engine.orca.version}`);
  for (const { nozzle, process: name, filament } of NOZZLES) {
    const machine = presets.machine[`Bambu Lab X2D ${nozzle} nozzle`];
    const process_ = presets.process[name];
    const started = performance.now();
    const result = await host.request("slice", {
      configs: {
        machine,
        process: { ...process_, curr_bed_type: "Textured PEI Plate" },
        filaments: [presets.filament[filament]],
      },
      objects: [{ name: "Cube.stl", mesh: { positions: cube(20, 128, 128) } }],
      output: { toolpaths: false },
    });
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const { layers, printTimeText, filamentG } = result.stats;
    const gcode = typeof result.gcode === "string" ? result.gcode : new TextDecoder().decode(result.gcode);
    const header = (key) => Number(new RegExp(`^; ${key} = ([\\d.]+)`, "m").exec(gcode)?.[1]);
    const height = header("layer_height");
    const width = header("line_width");
    console.log(
      `${nozzle} mm nozzle, a 20 mm cube in ${seconds} s: ${layers} layers of ${height} mm, ${width} mm lines, ${printTimeText}, ${filamentG} g`,
    );
    // Each Standard's first layer is as tall as the rest; lines a little wider than the nozzle.
    if (Math.abs(layers - Math.ceil(20 / height - 1e-6)) > 1 || !(width >= nozzle && width <= nozzle + 0.05)) {
      throw new Error(`the cube didn't slice as it should for the ${nozzle} mm nozzle`);
    }
    if (!(gcode.length > 10_000)) throw new Error("the cube's G-code is too short");
  }
} finally {
  host.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
