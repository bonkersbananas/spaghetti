// Slices models with the WebAssembly build in a browser (Chromium or WebKit, through Playwright), on a fresh page
// per run, sampling the browser's processes' memory every 100 ms. Prints one JSON line per run. A slice setup slices
// with its settings, as in wasm-node.mjs; --job replays what the app handed the module for a model (app-slice.mts
// writes the job), and says the file's SHA-256 (to check it against Node's and the command line's).
//   node wasm-browser.mjs <chromium|webkit> <dir with spaghetti_slicer.wasm> <runs> [--keep-placement]
//     [--setup <setup.json>] <model…>
//   node wasm-browser.mjs <chromium|webkit> <dir with spaghetti_slicer.wasm> <runs> --job <job.json>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "../../node_modules/@playwright/test/index.mjs";

const [which, wasmDir, runsText, ...rest] = process.argv.slice(2);
const keep = rest.includes("--keep-placement");
const setupAt = rest.indexOf("--setup");
const setup = setupAt >= 0 ? path.resolve(rest[setupAt + 1]) : null;
const jobAt = rest.indexOf("--job");
const jobDir = jobAt >= 0 ? path.dirname(path.resolve(rest[jobAt + 1])) : null;
const job = jobAt >= 0 ? JSON.parse(fs.readFileSync(rest[jobAt + 1], "utf8")) : null;
const taken = new Set([setupAt, jobAt].filter((i) => i >= 0).flatMap((i) => [i, i + 1]));
const models = rest.filter((a, i) => a !== "--keep-placement" && !taken.has(i)).map((m) => path.resolve(m));
const here = path.dirname(fileURLToPath(import.meta.url));

// The page, the module and the models, each at its own fixed path: nothing else is served, and only to this machine.
const files = new Map([
  ["/", path.join(here, "web/index.html")],
  ["/wasm/spaghetti_slicer.wasm", path.join(wasmDir, "spaghetti_slicer.wasm")],
  ...models.map((model, i) => [`/model/${i}`, model]),
  ...(setup ? [["/setup.json", setup]] : []),
  // A job's setup and files, each at /job/<its name in the job>.
  ...(job
    ? [job.setup, ...job.calls.flatMap((call) => [call.stl, call.paint, call.supports])]
        .filter(Boolean)
        .map((file) => [`/job/${file}`, path.join(jobDir, file)])
    : []),
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
  const result = job
    ? await page.evaluate((j) => window.runJob(j), job)
    : await page.evaluate(
        ([paths, k, s]) => window.runSlice(paths, k, s),
        [models.map((_, i) => `/model/${i}`), keep, setup ? "/setup.json" : null],
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
