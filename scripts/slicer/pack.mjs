// Packs the slicing engine's runtime folder into one zip for a release: the host and the single-threaded engine as
// the engine's build left them, the presets, the engine's licence and notices, and Spaghetti's own manifest and notes
// (what was changed, where the source is). Run by scripts/slicer/build.sh.
//
//   node scripts/slicer/pack.mjs <engine dist/> <dir with presets.json> <out dir> <version>
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const [dist, extra, out, version] = process.argv.slice(2);
if (!dist || !extra || !out || !version) {
  console.error("usage: node pack.mjs <engine dist/> <dir with presets.json> <out dir> <version>");
  process.exit(2);
}
const pin = Object.fromEntries(
  fs
    .readFileSync(path.join(here, "pin.env"), "utf8")
    .split("\n")
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=").replace(/^"|"$/g, "")];
    }),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const commit = () => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};

const engineManifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
const files = {};
// What the host needs, as the engine's build left it: no precompressed copies (Cloudflare compresses on the way out),
// no debug symbols, and only the single-threaded engine.
for (const name of fs.readdirSync(dist).sort()) {
  if (/\.(br|gz|symbols)$/.test(name) || /^engine-(mt|mt64)\./.test(name)) continue;
  if (!fs.statSync(path.join(dist, name)).isFile()) continue;
  files[name] = new Uint8Array(fs.readFileSync(path.join(dist, name)));
}
if (!files["engine-st.wasm"] || !files["engine-st.mjs"] || !files[engineManifest.host.file]) {
  throw new Error(`${dist} has no single-threaded engine and host`);
}
// The engine's manifest lists only what is here.
delete engineManifest.variants.mt;
delete engineManifest.variants.mt64;
files["manifest.json"] = new TextEncoder().encode(`${JSON.stringify(engineManifest, null, 2)}\n`);
files["presets.json"] = new Uint8Array(fs.readFileSync(path.join(extra, "presets.json")));
files["host.patch"] = new Uint8Array(fs.readFileSync(path.join(here, "host.patch")));

const release = `https://github.com/bonkersbananas/spaghetti/releases/tag/slicer-v${version}`;
const ours = {
  format: 1,
  version,
  builtAt: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? Date.now() / 1000) * 1000).toISOString(),
  host: engineManifest.host.file,
  source: { repository: "https://github.com/bonkersbananas/spaghetti", commit: commit(), release },
  engine: {
    name: "Muon3D Slicer Engine",
    repository: pin.ENGINE_REPO.replace(/\.git$/, ""),
    tag: pin.ENGINE_TAG,
    commit: pin.ENGINE_COMMIT,
    license: "AGPL-3.0-only",
    changes: "host.patch",
  },
  orca: {
    version: pin.ORCA_VERSION,
    repository: pin.ORCA_REPO,
    commit: pin.ORCA_COMMIT,
    upstream: { repository: "https://github.com/OrcaSlicer/OrcaSlicer", commit: pin.ORCA_UPSTREAM_COMMIT },
  },
  files: {},
};
files["SPAGHETTI.md"] = new TextEncoder().encode(
  [
    "# Spaghetti's slicing engine",
    "",
    `This folder is the [Muon3D Slicer Engine](${ours.engine.repository}) ${pin.ENGINE_TAG}: OrcaSlicer's slicing core`,
    `(libslic3r, OrcaSlicer ${pin.ORCA_VERSION} at ${pin.ORCA_COMMIT}) compiled to WebAssembly, with the worker host that`,
    "a page talks to by messages. Spaghetti starts it in a Web Worker to slice .stl and .3mf files in the browser.",
    "",
    "It is free software under the GNU Affero General Public License, version 3 (LICENSE; NOTICE and",
    "THIRD-PARTY-NOTICES.md name the copyright holders and the libraries in it). Spaghetti built it from that source",
    `with one change, host.patch (the host checked SharedArrayBuffer where a page has none). The Corresponding Source`,
    `of this exact build is attached to ${release}: the engine's source, OrcaSlicer's, the third-party`,
    "libraries', and the build scripts (scripts/slicer in Spaghetti's repository at the commit in spaghetti-slicer.json).",
    "",
    "presets.json holds OrcaSlicer's presets for the Bambu Lab X2D, flattened by OrcaSlicer's own loader in this engine.",
    "",
  ].join("\n"),
);
for (const [name, bytes] of Object.entries(files)) ours.files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
files["spaghetti-slicer.json"] = new TextEncoder().encode(`${JSON.stringify(ours, null, 2)}\n`);

fs.mkdirSync(out, { recursive: true });
const zipName = `spaghetti-slicer-${version}.zip`;
// Every entry gets the same date, so the zip depends only on its files.
const mtime = new Date("2026-01-01T00:00:00Z");
const zip = zipSync(
  Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { level: 9, mtime }]])),
);
fs.writeFileSync(path.join(out, zipName), zip);
fs.writeFileSync(path.join(out, "SHA256SUMS"), `${sha256(zip)}  ${zipName}\n`);
console.log(`${zipName}: ${zip.length} bytes, sha256 ${sha256(zip)}`);
for (const [name, { bytes }] of Object.entries(ours.files)) console.log(`  ${name} ${bytes}`);
