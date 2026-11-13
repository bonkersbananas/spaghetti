// Slices models with the WebAssembly build in Node and prints a JSON summary (the slicer's own timings and stats,
// the time to instantiate, and the size of WebAssembly memory at the end, which only grows: its peak). A slice setup
// (setup.mts writes one) slices with those settings instead of the X2D's defaults.
//   node wasm-node.mjs <spaghetti_slicer.wasm> <out.gcode.3mf> [--keep-placement] [--setup <setup.json>] <model…>
import fs from "node:fs";

const [wasmPath, out, ...rest] = process.argv.slice(2);
const keep = rest.includes("--keep-placement");
const setupAt = rest.indexOf("--setup");
const setup = setupAt >= 0 ? fs.readFileSync(rest[setupAt + 1]) : null;
const models = rest.filter((a, i) => a !== "--keep-placement" && (setupAt < 0 || (i !== setupAt && i !== setupAt + 1)));

const t0 = performance.now();
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {
  env: { now_ms: () => performance.now() },
});
const instantiateMs = performance.now() - t0;
const e = instance.exports;

const files = models.map((path) => ({ name: Buffer.from(path.split("/").pop()), data: fs.readFileSync(path) }));
const t1 = performance.now();
let code = 0;
if (setup) {
  const at = e.alloc(setup.length);
  new Uint8Array(e.memory.buffer, at, setup.length).set(setup);
  code = e.setup(at, setup.length);
  e.dealloc(at, setup.length);
}
// One file at a time: its name and bytes into WebAssembly memory, read onto the plate, freed.
for (const f of code === 0 ? files : []) {
  const name = e.alloc(f.name.length);
  new Uint8Array(e.memory.buffer, name, f.name.length).set(f.name);
  const data = e.alloc(f.data.length);
  new Uint8Array(e.memory.buffer, data, f.data.length).set(f.data);
  code = e.add(name, f.name.length, data, f.data.length);
  e.dealloc(name, f.name.length);
  e.dealloc(data, f.data.length);
  if (code !== 0) break;
}
if (code === 0) code = e.slice(keep ? 1 : 0);
const sliceMs = performance.now() - t1;
if (code !== 0) {
  // The summary says what went wrong in words.
  const said = new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.summary_ptr(), e.summary_len()));
  console.log(JSON.stringify({ code, ...(said ? JSON.parse(said) : {}) }));
  process.exit(1);
}
const memory = e.memory.buffer;
const file = new Uint8Array(memory, e.output_ptr(), e.output_len()).slice();
const summary = JSON.parse(new TextDecoder().decode(new Uint8Array(memory, e.summary_ptr(), e.summary_len())));
fs.writeFileSync(out, file);
console.log(
  JSON.stringify({
    instantiateMs: Math.round(instantiateMs * 10) / 10,
    sliceMs: Math.round(sliceMs * 10) / 10,
    wasmMemoryMB: Math.round(memory.byteLength / 1048576),
    fileBytes: file.length,
    timings: summary.timings,
    triangles: summary.triangles,
    gcodeBytes: summary.gcodeBytes,
    fallbacks: summary.fallbacks,
    stats: summary.stats.summary,
  }),
);
