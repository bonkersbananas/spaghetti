// slicer-rs threaded prototype in a Web Worker; pool workers are this same script with data.pool set
self.onmessage = async (ev) => {
  const d = ev.data;
  if (d.pool) {
    const { module, memory, stackTop, tlsBase } = d;
    const inst = await WebAssembly.instantiate(module, { env: { memory, now_ms: () => performance.now() } });
    const e = inst.exports; e.__stack_pointer.value = stackTop; e.__wasm_init_tls(tlsBase);
    postMessage("up"); e.pool_worker(); return;
  }
  const { wasm, threads, models, runs } = d;
  const bytes = await (await fetch(wasm)).arrayBuffer();
  const module = await WebAssembly.compile(bytes);
  const shared = threads > 0;
  const memory = shared ? new WebAssembly.Memory({ initial: 1024, maximum: 16384, shared: true }) : null;
  const t0 = performance.now();
  const inst = await WebAssembly.instantiate(module, { env: { ...(shared ? { memory } : {}), now_ms: () => performance.now() } });
  const e = inst.exports; const mem = shared ? memory : e.memory;
  const ups = [];
  if (shared) {
    const tlsSize = e.__tls_size.value, tlsAlign = e.__tls_align.value;
    for (let k = 0; k < threads - 1; k++) {
      const STACK = 4 << 20; const stack = e.alloc(STACK); const tls = e.alloc(tlsSize + tlsAlign);
      const tlsBase = Math.ceil(tls / tlsAlign) * tlsAlign;
      const w = new Worker("/rs-worker.js", { type: "module" });
      ups.push(new Promise((r) => (w.onmessage = r)));
      w.postMessage({ pool: true, module, memory, stackTop: (stack + STACK) & ~15, tlsBase });
    }
    await Promise.all(ups);
    while (e.pool_workers() < threads - 1) await new Promise((r) => setTimeout(r, 5));
  }
  const startMs = performance.now() - t0;
  const files = await Promise.all(models.map(async (p) => ({ name: new TextEncoder().encode(p.split("/").pop()), data: new Uint8Array(await (await fetch(p)).arrayBuffer()) })));
  const out = [];
  for (let r = 0; r < runs; r++) {
    const t1 = performance.now(); let code = 0;
    for (const f of files) {
      const name = e.alloc(f.name.length); new Uint8Array(mem.buffer, name, f.name.length).set(f.name);
      const data = e.alloc(f.data.length); new Uint8Array(mem.buffer, data, f.data.length).set(f.data);
      code = e.add(name, f.name.length, data, f.data.length); e.dealloc(name, f.name.length); e.dealloc(data, f.data.length); if (code) break;
    }
    if (!code) code = e.slice(1);
    const ms = Math.round(performance.now() - t1);
    if (code) { postMessage({ error: code }); return; }
    const bytesOut = e.output_len(); out.push({ ms, bytesOut, memMB: mem.buffer.byteLength >> 20 }); e.clear();
  }
  postMessage({ startMs: Math.round(startMs), out });
};
