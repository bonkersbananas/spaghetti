// Records what the app hands Spaghetti's own slicer for a model, so the benchmark slices exactly that: runs the app's
// slice worker (src/client/lib/slicing/slice-worker.ts, bundled by Vite) in Node on the model with its slicing
// settings, as the browser would (reading, turning, scaling, arranging, copies, fins, colours and the setup), and
// writes each call it makes to the WebAssembly module into a folder: `calls.json` (setup, add, add_in, add_part,
// paint, paint_supports and slice, in order) beside the bytes each call took. `wasm-node.mjs --replay <folder>` and
// the command line's `--replay <folder>` slice it again.
//
//   node slicer-rs/bench/capture.mts <model> <out folder> ['<settings JSON>'] ['<printer setup JSON>']
//
// The settings are a model's `item_files.slicing` (what it was last sliced with: the worker's `chosen`); the printer
// setup is the `printer` row's (the workshop's defaults come from it, with an empty Pantry: pantry.ts). The module it
// records with is the app's pinned release (scripts/slicer-rs/release.json), and the presets the engine's
// (scripts/slicer/engine.json): both are fetched as `vite` would, into node_modules/.cache.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { ensureRustSlicer, ensureSlicer } from "../../scripts/vite-slicer.ts";

const [model, outDir, settings = "{}", printer] = process.argv.slice(2);
if (!model || !outDir) {
  process.stderr.write("Usage: node slicer-rs/bench/capture.mts <model> <out folder> ['<settings>'] ['<printer>']\n");
  process.exit(2);
}
const root = resolve(import.meta.dirname, "../..");
const out = resolve(outDir);
mkdirSync(out, { recursive: true });

// The worker and the workshop's defaults, bundled for Node with the app's aliases.
const work = mkdtempSync(join(tmpdir(), "capture-"));
const entry = join(work, "entry.ts");
writeFileSync(
  entry,
  `export { workshopDefaults } from "@shared/slicing/pantry.ts";
export { DEFAULT_PRINTER } from "@shared/spools";
import "@/lib/slicing/slice-worker";
`,
);
await build({
  configFile: false,
  logLevel: "warn",
  root,
  publicDir: false,
  resolve: {
    alias: {
      "@": join(root, "src/client"),
      "@shared": join(root, "src/shared"),
      "@support-fins": join(root, "vendor/support-fins/v1.0.6"),
    },
  },
  ssr: { noExternal: true },
  build: {
    ssr: entry,
    outDir: work,
    emptyOutDir: false,
    rolldownOptions: { output: { format: "es", entryFileNames: "worker.mjs", codeSplitting: false } },
  },
});
const bundle = join(work, "worker.mjs");

const engineDir = await ensureSlicer();
const rustDir = await ensureRustSlicer();

// Files by URL, as the worker fetches presets.json and the module.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "file:") return realFetch(input);
  return new Response(readFileSync(url));
}) as typeof fetch;

// The module's calls, recorded as they pass.
type Call = { op: string; name?: string; file?: string; filament?: number; first?: number; flags?: number };
const calls: Call[] = [];
let files = 0;
const saved = (bytes: Uint8Array, ext: string) => {
  const file = `${String(files++).padStart(3, "0")}.${ext}`;
  writeFileSync(join(out, file), bytes);
  return file;
};
const instantiate = WebAssembly.instantiate.bind(WebAssembly);
// biome-ignore lint/suspicious/noExplicitAny: wrapping the module's exports
(WebAssembly as any).instantiate = async (source: BufferSource, imports: WebAssembly.Imports) => {
  const made = (await instantiate(source, imports)) as WebAssembly.WebAssemblyInstantiatedSource;
  // biome-ignore lint/suspicious/noExplicitAny: the module's plain C interface
  const e = made.instance.exports as any;
  const bytes = (ptr: number, len: number) => new Uint8Array(e.memory.buffer, ptr, len).slice();
  const text = (ptr: number, len: number) => new TextDecoder().decode(bytes(ptr, len));
  const exports = {
    ...e,
    setup(ptr: number, len: number) {
      calls.push({ op: "setup", file: saved(bytes(ptr, len), "json") });
      return e.setup(ptr, len);
    },
    add(n: number, nl: number, d: number, dl: number) {
      calls.push({ op: "add", name: text(n, nl), file: saved(bytes(d, dl), "stl") });
      return e.add(n, nl, d, dl);
    },
    add_in(n: number, nl: number, d: number, dl: number, filament: number) {
      calls.push({ op: "add_in", name: text(n, nl), file: saved(bytes(d, dl), "stl"), filament });
      return e.add_in(n, nl, d, dl, filament);
    },
    add_part(n: number, nl: number, d: number, dl: number, filament: number, first: number) {
      calls.push({ op: "add_part", name: text(n, nl), file: saved(bytes(d, dl), "stl"), filament, first });
      return e.add_part(n, nl, d, dl, filament, first);
    },
    paint(ptr: number, len: number) {
      calls.push({ op: "paint", file: saved(bytes(ptr, len), "paint") });
      return e.paint(ptr, len);
    },
    paint_supports(ptr: number, len: number) {
      calls.push({ op: "paint_supports", file: saved(bytes(ptr, len), "paint") });
      return e.paint_supports(ptr, len);
    },
    slice(flags: number) {
      calls.push({ op: "slice", flags });
      return e.slice(flags);
    },
  };
  return { ...made, instance: { exports } };
};

// The worker, in this thread: its `self` is the global.
type Message = { type: string; slice?: { status: string; fallback?: unknown; problem?: string; notes?: string[] } };
const done = new Promise<Message>((resolveDone) => {
  // biome-ignore lint/suspicious/noExplicitAny: the worker's global
  const self = globalThis as any;
  self.self = self;
  self.postMessage = (message: Message) => {
    if (message.type === "done" || message.type === "failed") resolveDone(message);
  };
});
const worker = await import(pathToFileURL(bundle).href);
const setup = printer ? JSON.parse(printer) : worker.DEFAULT_PRINTER;
const defaults = worker.workshopDefaults({ spools: [], setup });
const rustPin = JSON.parse(readFileSync(join(root, "scripts/slicer-rs/release.json"), "utf8"));
// biome-ignore lint/suspicious/noExplicitAny: the worker's global
(globalThis as any).onmessage({
  data: {
    file: new Blob([readFileSync(model)]),
    name: basename(model),
    chosen: JSON.parse(settings),
    defaults,
    spools: [],
    engine: { base: `${pathToFileURL(engineDir).href}/`, host: "host.js", version: "engine" },
    rust: { base: `${pathToFileURL(rustDir).href}/`, wasm: "spaghetti_slicer.wasm", version: rustPin.version },
  },
});
const result = await done;
rmSync(work, { recursive: true, force: true });
writeFileSync(join(out, "calls.json"), `${JSON.stringify(calls, null, 1)}\n`);
console.log(
  JSON.stringify({
    model: basename(model),
    result: result.type,
    slicer: result.slice?.status,
    fallback: result.slice?.fallback,
    problem: result.slice?.problem,
    notes: result.slice?.notes,
    calls: calls.map((call) => call.op).join(" "),
  }),
);
process.exit(0);
