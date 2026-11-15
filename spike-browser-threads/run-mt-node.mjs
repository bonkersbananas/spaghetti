// node run-mt.mjs <wasm> <threads> [--keep-placement] <model…> ; prints JSON summary + timing + output md5
import fs from "node:fs";
import crypto from "node:crypto";
import { Worker, isMainThread, workerData, parentPort } from "node:worker_threads";

if (!isMainThread) {
  const { module, memory, stackTop, tlsBase } = workerData;
  const inst = await WebAssembly.instantiate(module, { env: { memory, now_ms: () => performance.now() } });
  const e = inst.exports;
  e.__stack_pointer.value = stackTop;
  e.__wasm_init_tls(tlsBase);
  parentPort.postMessage("up");
  e.pool_worker();
} else {
  const [wasmPath, threadsText, ...rest] = process.argv.slice(2);
  const keep = rest.includes("--keep-placement");
  const models = rest.filter((a) => !a.startsWith("--"));
  const threads = Number(threadsText);
  const module = new WebAssembly.Module(fs.readFileSync(wasmPath));
  const memory = new WebAssembly.Memory({ initial: 1024, maximum: 16384, shared: true });
  const inst = await WebAssembly.instantiate(module, { env: { memory, now_ms: () => performance.now() } });
  const e = inst.exports;
  const t0 = performance.now();
  const workers = [];
  const tlsSize = e.__tls_size.value, tlsAlign = e.__tls_align.value;
  for (let k = 0; k < threads - 1; k++) {
    const STACK = 4 << 20;
    const stack = e.alloc(STACK);
    const tls = e.alloc(tlsSize + tlsAlign);
    const tlsBase = Math.ceil(tls / tlsAlign) * tlsAlign;
    const w = new Worker(new URL(import.meta.url), { workerData: { module, memory, stackTop: (stack + STACK) & ~15, tlsBase } });
    workers.push(new Promise((r) => w.once("message", r)));
    w.on("error", (err) => { console.error("worker error", err); process.exit(3); });
    w.once("message", () => w.unref());
  }
  await Promise.all(workers);
  const spawnMs = performance.now() - t0;
  while (e.pool_workers() < threads - 1) await new Promise((r) => setTimeout(r, 5));
  const files = models.map((p) => ({ name: Buffer.from(p.split("/").pop()), data: fs.readFileSync(p) }));
  const t1 = performance.now();
  let code = 0;
  for (const f of files) {
    const name = e.alloc(f.name.length);
    new Uint8Array(memory.buffer, name, f.name.length).set(f.name);
    const data = e.alloc(f.data.length);
    new Uint8Array(memory.buffer, data, f.data.length).set(f.data);
    code = e.add(name, f.name.length, data, f.data.length);
    e.dealloc(name, f.name.length); e.dealloc(data, f.data.length);
    if (code) break;
  }
  if (!code) code = e.slice(keep ? 1 : 0);
  const sliceMs = performance.now() - t1;
  if (code) { console.log("error", code, Buffer.from(new Uint8Array(memory.buffer, e.summary_ptr(), e.summary_len())).toString()); process.exit(1); }
  const out = Buffer.from(new Uint8Array(memory.buffer, e.output_ptr(), e.output_len()));
  const summary = JSON.parse(Buffer.from(new Uint8Array(memory.buffer, e.summary_ptr(), e.summary_len())).toString());
  console.log(JSON.stringify({ threads, spawnMs: Math.round(spawnMs), sliceMs: Math.round(sliceMs), memMB: memory.buffer.byteLength >> 20, bytes: out.length, md5: crypto.createHash("md5").update(out).digest("hex"), timings: summary.timings }));
  process.exit(0);
}
