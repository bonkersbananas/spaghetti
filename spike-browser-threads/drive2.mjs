// node drive.mjs <chromium|webkit> '<json job>'   job: {kind:"orca"|"rs", coep:"require-corp"|"credentialless"|"none", ...}
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { chromium, webkit } from "playwright-core";
const [which, jobText] = process.argv.slice(2); const job = JSON.parse(jobText);
const here = path.dirname(new URL(import.meta.url).pathname);
const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json", ".html": "text/html" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"); let file;
  if (u.pathname === "/") file = path.join(here, "page.html");
  else if (u.pathname === "/rs-worker.js") file = path.join(here, "rs-worker.js");
  else if (u.pathname.startsWith("/e/")) file = path.join(job.engines[u.pathname.split("/")[2]] ?? "/nonexistent", u.pathname.split("/").slice(3).join("/"));
  else if (u.pathname.startsWith("/m/")) file = job.modelFiles[Number(u.pathname.slice(3))];
  if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  const h = { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" };
  if (job.coep !== "none") { h["cross-origin-opener-policy"] = "same-origin"; h["cross-origin-embedder-policy"] = job.coep ?? "require-corp"; h["cross-origin-resource-policy"] = "same-origin"; }
  res.writeHead(200, h); fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r)); const port = server.address().port;
const rss = () => execFileSync("ps", ["-eo", "rss=,args="], { encoding: "utf8" }).split("\n").filter((l) => /ms-playwright|WPE|chrome|webkit/i.test(l) && !/drive\.mjs/.test(l)).map((l) => Number(l.trim().split(/\s+/)[0]) * 1024);
const browser = await (which === "webkit" ? webkit : chromium).launch();
const page = await browser.newPage();
page.on("pageerror", (e) => console.error("pageerror", e.message));
await page.goto(`http://127.0.0.1:${port}/`);
console.log(JSON.stringify({ env: await page.evaluate(() => window.info()) }));
const base = rss().reduce((a, b) => a + b, 0); let peak = base; let peakOne = 0; const baseOne = Math.max(...rss());
const timer = setInterval(() => { const now = rss(); peak = Math.max(peak, now.reduce((a, b) => a + b, 0)); peakOne = Math.max(peakOne, ...now); }, 50);
let result;
try {
  const models = job.models.map((_, i) => `/m/${i}`);
  result = job.kind === "orca"
    ? await page.evaluate((a) => window.runOrca(a), { base: `/e/${job.engine}/`, variant: job.variant, threads: job.threads, models, runs: job.runs ?? 1 })
    : await page.evaluate((a) => window.runRs(a), { wasm: `/e/${job.engine}/${job.wasm}`, threads: job.threads, models, runs: job.runs ?? 1 });
} catch (e) { result = { failed: String(e.message).slice(0, 400) }; }
clearInterval(timer);
console.log(JSON.stringify({ which, job: { ...job, engines: undefined, modelFiles: undefined }, peakGrowthMB: Math.round((peak - base) / 1048576), peakOneMB: Math.round(peakOne / 1048576), baseMB: Math.round(base / 1048576), result }));
await browser.close(); server.close();
