// Slices models with the WebAssembly build in Node and prints a JSON summary (the slicer's own timings and stats,
// the time to instantiate, and the size of WebAssembly memory at the end, which only grows: its peak).
//   node wasm-node.mjs <spaghetti_slicer.wasm> <out.gcode.3mf> [--keep-placement] <model…>
import fs from "node:fs";

const [wasmPath, out, ...rest] = process.argv.slice(2);
const keep = rest.includes("--keep-placement");
const models = rest.filter((a) => a !== "--keep-placement");

const t0 = performance.now();
const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {
  env: { now_ms: () => performance.now() },
});
const instantiateMs = performance.now() - t0;
const e = instance.exports;

const files = models.map((path) => ({ name: Buffer.from(path.split("/").pop()), data: fs.readFileSync(path) }));
const size = 4 + files.reduce((sum, f) => sum + 8 + f.name.length + f.data.length, 0);
const t1 = performance.now();
const ptr = e.alloc(size);
const bytes = new Uint8Array(e.memory.buffer, ptr, size);
const view = new DataView(e.memory.buffer, ptr, size);
let at = 0;
view.setUint32(at, files.length, true);
at += 4;
for (const f of files) {
  view.setUint32(at, f.name.length, true);
  bytes.set(f.name, at + 4);
  at += 4 + f.name.length;
  view.setUint32(at, f.data.length, true);
  bytes.set(f.data, at + 4);
  at += 4 + f.data.length;
}
const code = e.slice(ptr, size, keep ? 1 : 0);
const sliceMs = performance.now() - t1;
e.dealloc(ptr, size);
if (code !== 0) {
  console.log(JSON.stringify({ error: code }));
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
    stats: summary.stats.summary,
  }),
);
