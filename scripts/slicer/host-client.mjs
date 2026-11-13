// A small client for the slicing engine's host in Node (a worker_threads Worker running the host file the browser
// starts), speaking the engine's protocol v2: { v: 2, id, op, params } in, result / error / progress messages out.
// Used by the build (resolve-presets.mjs) and its smoke test.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

/** Starts the host of a runtime folder (its manifest.json names the file) and says hello. */
export async function startHost(dist) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
  const worker = new Worker(pathToFileURL(path.join(dist, manifest.host.file)));
  const pending = new Map();
  let next = 1;
  worker.on("message", (message) => {
    if (message?.v !== 2) return;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    if (message.kind === "progress") waiting.onProgress?.(message.progress);
    else if (message.kind === "warning") waiting.onWarning?.(message.warning);
    else if (message.kind === "result") {
      pending.delete(message.id);
      waiting.resolve(message.result);
    } else if (message.kind === "error") {
      pending.delete(message.id);
      waiting.reject(Object.assign(new Error(message.error.message), message.error));
    }
  });
  worker.on("error", (error) => {
    for (const waiting of pending.values()) waiting.reject(error);
    pending.clear();
  });
  const request = (op, params, handlers = {}) =>
    new Promise((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve, reject, ...handlers });
      worker.postMessage({ v: 2, id, op, params });
    });
  const hello = await request("hello", { protocol: { major: 2 }, client: { name: "spaghetti-build", version: "1" } });
  return { hello, manifest, request, close: () => worker.terminate() };
}
