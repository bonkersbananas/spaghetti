// Slices models with the WebAssembly build in Node and prints a JSON summary (the slicer's own timings and stats,
// the time to instantiate, and the size of WebAssembly memory at the end, which only grows: its peak). A slice setup
// (setup.mts writes one) slices with those settings instead of the X2D's defaults; --filaments gives each model its
// filament of the setup's (1-based, one per model, in order), and --parts makes the models the parts of one object
// (the module's add_part), as the command line's do.
//   node wasm-node.mjs <spaghetti_slicer.wasm> <out.gcode.3mf> [--keep-placement] [--setup <setup.json>]
//     [--filaments <n,…>] [--parts] <model…>
//   node wasm-node.mjs <spaghetti_slicer.wasm> <out.gcode.3mf> --job <job.json>
// --job replays what the app handed the module (bench/app-slice.mts writes it): the setup, each object or part with
// its filament and paint, kept where they are.
import fs from "node:fs";
import path from "node:path";

const [wasmPath, out, ...rest] = process.argv.slice(2);
const jobAt = rest.indexOf("--job");
const jobDir = jobAt >= 0 ? path.dirname(rest[jobAt + 1]) : null;
const job = jobAt >= 0 ? JSON.parse(fs.readFileSync(rest[jobAt + 1], "utf8")) : null;
const keep = rest.includes("--keep-placement") || job !== null;
const parts = rest.includes("--parts");
const setupAt = rest.indexOf("--setup");
const setup = job
  ? fs.readFileSync(path.join(jobDir, job.setup))
  : setupAt >= 0
    ? fs.readFileSync(rest[setupAt + 1])
    : null;
const filamentsAt = rest.indexOf("--filaments");
const filaments = filamentsAt >= 0 ? rest[filamentsAt + 1].split(",").map(Number) : [];
// An option's index and its value's, for the options given.
const options = new Set([setupAt, filamentsAt, jobAt].filter((i) => i >= 0).flatMap((i) => [i, i + 1]));
const models = rest.filter((a, i) => a !== "--keep-placement" && a !== "--parts" && !options.has(i));

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
// Bytes into WebAssembly memory for one call, freed after.
const withBytes = (bytes, use) => {
  const at = e.alloc(bytes.length);
  new Uint8Array(e.memory.buffer, at, bytes.length).set(bytes);
  try {
    return use(at);
  } finally {
    e.dealloc(at, bytes.length);
  }
};
for (const call of code === 0 && job ? job.calls : []) {
  const name = Buffer.from(call.name);
  const data = fs.readFileSync(path.join(jobDir, call.stl));
  code = withBytes(name, (n) =>
    withBytes(data, (d) =>
      call.op === "add_part"
        ? e.add_part(n, name.length, d, data.length, call.filament, call.first ? 1 : 0)
        : call.op === "add_in"
          ? e.add_in(n, name.length, d, data.length, call.filament)
          : e.add(n, name.length, d, data.length),
    ),
  );
  for (const [key, fn] of [
    ["paint", e.paint],
    ["supports", e.paint_supports],
    ["seams", e.paint_seam],
  ]) {
    if (code !== 0 || !call[key]) continue;
    const bytes = fs.readFileSync(path.join(jobDir, call[key]));
    code = withBytes(bytes, (p) => fn(p, bytes.length)) ? 1 : 0;
  }
  if (code !== 0) break;
}
// One file at a time: its name and bytes into WebAssembly memory, read onto the plate, freed.
for (const [k, f] of (code === 0 && !job ? files : []).entries()) {
  const name = e.alloc(f.name.length);
  new Uint8Array(e.memory.buffer, name, f.name.length).set(f.name);
  const data = e.alloc(f.data.length);
  new Uint8Array(e.memory.buffer, data, f.data.length).set(f.data);
  code = parts
    ? e.add_part(name, f.name.length, data, f.data.length, filaments[k] ?? 1, k === 0 ? 1 : 0)
    : filaments[k]
      ? e.add_in(name, f.name.length, data, f.data.length, filaments[k])
      : e.add(name, f.name.length, data, f.data.length);
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
    warnings: summary.warnings,
    stats: summary.stats.summary,
  }),
);
