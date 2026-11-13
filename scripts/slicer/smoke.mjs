// Smoke test of a packed engine: unzips it, starts its host in Node and slices a 20 mm cube for the X2D with the
// default presets from its presets.json. The release workflow runs it before publishing.
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
const machine = presets.machine["Bambu Lab X2D 0.4 nozzle"];
const process_ = presets.process["0.20mm Standard @BBL X2D"];
const filament = presets.filament["Bambu PLA Basic @BBL X2D 0.4 nozzle"];
if (!machine || !process_ || !filament) throw new Error("presets.json lacks the defaults");

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
  const started = performance.now();
  const result = await host.request("slice", {
    configs: { machine, process: { ...process_, curr_bed_type: "Textured PEI Plate" }, filaments: [filament] },
    objects: [{ name: "Cube.stl", mesh: { positions: cube(20, 128, 128) } }],
    output: { toolpaths: false },
  });
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const { layers, printTimeText, filamentG } = result.stats;
  console.log(`${host.hello.engine.name} ${host.hello.engine.version}, OrcaSlicer ${host.hello.engine.orca.version}`);
  console.log(
    `a 20 mm cube in ${seconds} s: ${layers} layers, ${printTimeText}, ${filamentG} g, ${result.gcode.length} bytes of G-code`,
  );
  if (layers !== 100 || !(result.gcode.length > 10_000)) throw new Error("the cube didn't slice as it should");
} finally {
  host.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
