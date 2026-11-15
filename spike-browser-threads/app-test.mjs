import http from "node:http"; import { chromium, webkit } from "playwright-core";
const [which, mode] = process.argv.slice(2); // mode: none | require-corp | credentialless | docs-only
const UP = 4177;
const proxy = http.createServer((req, res) => {
  const h = { ...req.headers, host: `127.0.0.1:${UP}` }; if (h.origin) h.origin = `http://127.0.0.1:${UP}`; if (h.referer) h.referer = h.referer.replace(/127\.0\.0\.1:\d+/, `127.0.0.1:${UP}`);
  const up = http.request({ host: "127.0.0.1", port: UP, path: req.url, method: req.method, headers: h }, (r) => {
    const out = { ...r.headers };
    const isDoc = req.headers["sec-fetch-dest"] === "document" || (req.headers.accept ?? "").startsWith("text/html");
    if (mode === "require-corp" || mode === "credentialless" || (mode === "docs-only" && isDoc)) {
      out["cross-origin-opener-policy"] = "same-origin"; out["cross-origin-embedder-policy"] = mode === "credentialless" ? "credentialless" : "require-corp";
    }
    res.writeHead(r.statusCode, out); r.pipe(res);
  });
  req.pipe(up);
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r)); const P = proxy.address().port; const base = `http://127.0.0.1:${P}`;
const browser = await (which === "webkit" ? webkit : chromium).launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const page = await ctx.newPage();
const problems = []; page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") problems.push(m.text().slice(0, 160)); });
page.on("requestfailed", (r) => problems.push("FAILED " + r.url().slice(0, 100) + " " + r.failure()?.errorText));
const out = { which, mode };
const go = async (u, o) => { try { await page.goto(u, o); } catch (e) { await page.waitForTimeout(1500); } };
await go(base + "/sign-in"); 
out.signIn = await page.evaluate(async () => (await fetch("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alex", password: "spaghetti-al-dente" }) })).status);
await go(base + "/", { waitUntil: "networkidle" });
out.coi = await page.evaluate(() => crossOriginIsolated);
const imgs = {};
for (const route of ["/", "/ideas", "/builds", "/pantry", "/printer"]) {
  await go(base + route, { waitUntil: "networkidle" }); await page.waitForTimeout(600);
  imgs[route] = await page.evaluate(() => { const i = [...document.images]; return `${i.filter((x) => x.complete && x.naturalWidth > 0).length}/${i.length}`; });
}
out.images = imgs;
out.sw = await page.evaluate(async () => { try { const r = await Promise.race([navigator.serviceWorker.ready, new Promise((_, j) => setTimeout(() => j("timeout"), 5000))]); return !!r.active; } catch (e) { return String(e); } });
await page.reload({ waitUntil: "networkidle" }); out.coiAfterSwReload = await page.evaluate(() => crossOriginIsolated); out.controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
// a route's own cached shell via SW, offline
await ctx.setOffline(true); await page.goto(base + "/ideas").catch((e) => (out.offlineErr = String(e).slice(0, 80))); await page.waitForTimeout(500);
out.offlineCoi = await page.evaluate(() => crossOriginIsolated).catch(() => "n/a"); await ctx.setOffline(false);
// worker scripts under COEP: the engine host, and a static worker script
await go(base + "/", { waitUntil: "networkidle" });
out.workers = await page.evaluate(async () => {
  const man = await (await fetch("/slicer/4/manifest.json")).json().catch(() => null);
  const url = man ? "/slicer/4/" + man.host.file : null; if (!url) return "no manifest";
  return await new Promise((res) => { const w = new Worker(url, { type: "module" }); const t = setTimeout(() => res("loaded (no error in 2s)"), 2000); w.onerror = (e) => { clearTimeout(t); res("ERROR " + (e.message || "blocked")); }; });
});
// external image must fail under require-corp, work under credentialless (CORP missing) — local second origin
const other = http.createServer((q, s) => { s.writeHead(200, { "content-type": "image/svg+xml" }); s.end('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'); });
await new Promise((r) => other.listen(0, "127.0.0.1", r)); const OP = other.address().port;
out.crossOriginImage = await page.evaluate((p) => new Promise((res) => { const i = new Image(); i.onload = () => res("loaded"); i.onerror = () => res("blocked"); i.src = `http://localhost:${p}/x.svg`; }), OP);
out.problems = [...new Set(problems)].slice(0, 8);
console.log(JSON.stringify(out));
await browser.close(); proxy.close(); other.close();
