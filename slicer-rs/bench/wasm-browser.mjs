// Slices models with the WebAssembly build in a browser (Chromium or WebKit, through Playwright), on a fresh page
// per run, sampling the browser's processes' memory every 100 ms. Prints one JSON line per run.
//   node wasm-browser.mjs <chromium|webkit> <dir with spaghetti_slicer.wasm> <runs> [--keep-placement] <model…>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "../../node_modules/@playwright/test/index.mjs";

const [which, wasmDir, runsText, ...rest] = process.argv.slice(2);
const keep = rest.includes("--keep-placement");
const models = rest.filter((a) => a !== "--keep-placement").map((m) => path.resolve(m));
const here = path.dirname(fileURLToPath(import.meta.url));

// The page, the module and the models, each at its own fixed path: nothing else is served, and only to this machine.
const files = new Map([
  ["/", path.join(here, "web/index.html")],
  ["/wasm/spaghetti_slicer.wasm", path.join(wasmDir, "spaghetti_slicer.wasm")],
  ...models.map((model, i) => [`/model/${i}`, model]),
]);
const server = http.createServer((req, res) => {
  const file = files.get(new URL(req.url, "http://127.0.0.1").pathname);
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  const type = file.endsWith(".wasm")
    ? "application/wasm"
    : file.endsWith(".html")
      ? "text/html"
      : "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

function browserRss() {
  const out = execFileSync("ps", ["-eo", "rss=,args="], { encoding: "utf8" });
  return out
    .split("\n")
    .filter((l) => l.includes("ms-playwright"))
    .map((l) => Number(l.trim().split(/\s+/)[0]) * 1024);
}

const browser = await (which === "webkit" ? webkit : chromium).launch();
for (let run = 0; run < Number(runsText); run++) {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  const base = browserRss();
  const baseTotal = base.reduce((s, v) => s + v, 0);
  let peakTotal = baseTotal;
  let peakOne = Math.max(...base);
  const timer = setInterval(() => {
    const now = browserRss();
    peakTotal = Math.max(
      peakTotal,
      now.reduce((s, v) => s + v, 0),
    );
    peakOne = Math.max(peakOne, ...now);
  }, 100);
  const result = await page.evaluate(
    ([paths, k]) => window.runSlice(paths, k),
    [models.map((_, i) => `/model/${i}`), keep],
  );
  clearInterval(timer);
  const mb = (b) => Math.round(b / 1048576);
  console.log(
    JSON.stringify({
      browser: which,
      run,
      ...result,
      memory: {
        baselineMB: mb(baseTotal),
        peakAllMB: mb(peakTotal),
        peakExtraMB: mb(peakTotal - baseTotal),
        peakLargestMB: mb(peakOne),
      },
    }),
  );
  await page.close();
}
await browser.close();
server.close();
