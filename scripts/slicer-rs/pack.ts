/**
 * Packs Spaghetti's own slicer (slicer-rs, docs/proposals/rust-slicer.md) for a release: its WebAssembly module as
 * cargo built it, the licence it is shipped under (the AGPL-3.0's text, as the slicing engine's release carries it:
 * the slicer follows OrcaSlicer's algorithms, which are under it) and Spaghetti's manifest and notes (what it is,
 * where its source is). Run by .github/workflows/slicer-rs-release.yml; the app pins the zip in
 * scripts/slicer-rs/release.json and serves its files at /slicer/rust-<version>/ (docs/slicer.md).
 *
 *   node scripts/slicer-rs/pack.ts <spaghetti_slicer.wasm> <out dir> <version>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { zipSync } from "fflate";
import { ensureSlicer } from "../vite-slicer.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const [wasm, out, version] = process.argv.slice(2);
if (!wasm || !out || !version) {
  console.error("usage: node scripts/slicer-rs/pack.ts <spaghetti_slicer.wasm> <out dir> <version>");
  process.exit(2);
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const run = (command: string, args: string[], cwd = ROOT) => {
  try {
    return execFileSync(command, args, { cwd, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
};
const commit = process.env.GITHUB_SHA ?? run("git", ["rev-parse", "HEAD"]);
const crate = /^version\s*=\s*"([^"]+)"/m.exec(readFileSync(join(ROOT, "slicer-rs/Cargo.toml"), "utf8"))?.[1] ?? "";
const repository = "https://github.com/bonkersbananas/spaghetti";
const release = `${repository}/releases/tag/slicer-rs-v${version}`;

const module = new Uint8Array(readFileSync(wasm));
if (!WebAssembly.validate(module)) throw new Error(`${wasm} isn't a WebAssembly module`);
const exports = WebAssembly.Module.exports(new WebAssembly.Module(module)).map((entry) => entry.name);
for (const name of [
  "alloc",
  "dealloc",
  "setup",
  "add",
  "slice",
  "output_ptr",
  "output_len",
  "summary_ptr",
  "summary_len",
]) {
  if (!exports.includes(name)) throw new Error(`${wasm} has no ${name} export`);
}

const files: Record<string, Uint8Array> = {
  "spaghetti_slicer.wasm": module,
  // The AGPL-3.0's text, from the slicing engine's release that the app pins (checked by its sha256 there).
  LICENSE: new Uint8Array(readFileSync(join(await ensureSlicer(), "LICENSE"))),
};
files["SPAGHETTI.md"] = new TextEncoder().encode(
  [
    "# Spaghetti's own slicer",
    "",
    "spaghetti_slicer.wasm is Spaghetti's own slicer, slicer-rs in Spaghetti's repository, compiled to WebAssembly",
    "(one thread, a plain C interface: src/wasm.rs). Spaghetti runs it in a Web Worker to slice .stl and .3mf files",
    "in the browser, and slices with OrcaSlicer's engine what it can't slice yet.",
    "",
    "It follows OrcaSlicer's algorithms and constants closely, so it is shipped as OrcaSlicer is: under the GNU",
    "Affero General Public License, version 3 (LICENSE). Its Corresponding Source is attached to",
    `${release}: slicer-rs and the crates it is built from, at the commit in spaghetti-slicer-rs.json.`,
    "",
  ].join("\n"),
);

const manifest = {
  format: 1,
  version,
  builtAt: new Date(Number(process.env.SOURCE_DATE_EPOCH ?? Date.now() / 1000) * 1000).toISOString(),
  wasm: "spaghetti_slicer.wasm",
  crate: { name: "spaghetti-slicer", version: crate },
  rustc: run("rustc", ["--version"]),
  license: "AGPL-3.0-only",
  source: { repository, commit, release },
  files: Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: sha256(bytes) }]),
  ),
};
files["spaghetti-slicer-rs.json"] = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

mkdirSync(out, { recursive: true });
const name = `spaghetti-slicer-rs-${version}.zip`;
// Every entry gets the same date, so the zip depends only on its files.
const mtime = new Date("2026-01-01T00:00:00Z");
const zip = zipSync(
  Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, [bytes, { level: 9, mtime }]])),
);
writeFileSync(join(out, name), zip);
console.log(`${name}: ${zip.length} bytes, sha256 ${sha256(zip)}`);
for (const [file, { bytes }] of Object.entries(manifest.files)) console.log(`  ${file} ${bytes}`);
