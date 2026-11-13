/**
 * Vite plugin: the slicers as static files of the app (docs/slicer.md): the slicing engine (OrcaSlicer's core in
 * WebAssembly) and Spaghetti's own slicer (slicer-rs in WebAssembly, decision 0055).
 *
 * Each is built by its own workflow and published as a release asset; scripts/slicer/engine.json and
 * scripts/slicer-rs/release.json pin those assets by URL and sha256. This plugin fetches each once into
 * node_modules/.cache, checks the hash, serves them at /slicer/<version>/ and /slicer/rust-<version>/ in `vite dev`,
 * and copies them to the client build's slicer/ folder, where the Worker's assets (and the container's wrangler)
 * serve them like any file. The app never imports either: it starts the engine's host by URL in a worker, and the
 * slice worker fetches our module by URL. `virtual:slicer-engine` says where they are and what they are.
 *
 * SLICER_ARCHIVE=<zip> and SLICER_RS_ARCHIVE=<zip> use local zips instead of the releases (one not yet released, or
 * no network; scripts/slicer-rs/pack.ts makes the second from a module built with cargo).
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cp } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import type { Plugin } from "vite";
import type { SlicerEngineInfo } from "../src/shared/slicing/engine.ts";

const ROOT = resolve(import.meta.dirname, "..");
const VIRTUAL = "virtual:slicer-engine";
const RESOLVED = `\0${VIRTUAL}`;

export interface SlicerPin {
  version: string;
  url: string;
  sha256: string;
}

export const readPin = (): SlicerPin => JSON.parse(readFileSync(join(ROOT, "scripts/slicer/engine.json"), "utf8"));

/** Spaghetti's own slicer's release, pinned like the engine's. */
export const readRustPin = (): SlicerPin =>
  JSON.parse(readFileSync(join(ROOT, "scripts/slicer-rs/release.json"), "utf8"));

/**
 * Spaghetti's own slicer's folder, beside the engine's under /slicer/, which the service worker leaves to the browser
 * and public/_headers makes immutable.
 */
export const rustFolder = (pin: SlicerPin) => `rust-${pin.version}`;

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Each environment of a build (client, worker) starts the plugin: say once that a local zip stands in. */
const warned = new Set<string>();

/**
 * The engine's runtime folder, fetched and checked if it isn't in the cache yet. Throws when it can't be had. The
 * cache is keyed by each zip's own sha256, so a local SLICER_ARCHIVE never passes for the pinned engine later.
 */
export function ensureSlicer(pin: SlicerPin = readPin()): Promise<string> {
  return ensureRelease(
    pin,
    "spaghetti-slicer",
    process.env.SLICER_ARCHIVE,
    "the pinned engine (scripts/slicer/engine.json)",
  );
}

/** Spaghetti's own slicer's folder, as `ensureSlicer` has the engine's (SLICER_RS_ARCHIVE for a local zip). */
export function ensureRustSlicer(pin: SlicerPin = readRustPin()): Promise<string> {
  return ensureRelease(
    pin,
    "spaghetti-slicer-rs",
    process.env.SLICER_RS_ARCHIVE,
    "the pinned slicer (scripts/slicer-rs/release.json)",
  );
}

async function ensureRelease(pin: SlicerPin, cacheName: string, local: string | undefined, pinned: string) {
  const cache = join(ROOT, "node_modules/.cache", cacheName);
  if (local) {
    const zip = new Uint8Array(readFileSync(local));
    const got = sha256(zip);
    if (got !== pin.sha256 && !warned.has(got)) {
      warned.add(got);
      console.warn(`[slicer] ${local} is not ${pinned}: using it as asked`);
    }
    return unpack(join(cache, got), zip);
  }
  const dir = join(cache, pin.sha256);
  if (existsSync(join(dir, ".complete"))) return dir;
  const response = await fetch(pin.url);
  if (!response.ok) throw new Error(`[slicer] ${pin.url}: ${response.status} ${response.statusText}`);
  const zip = new Uint8Array(await response.arrayBuffer());
  const got = sha256(zip);
  if (got !== pin.sha256) throw new Error(`[slicer] ${pin.url} has sha256 ${got}, not the pinned ${pin.sha256}`);
  return unpack(dir, zip);
}

function unpack(dir: string, zip: Uint8Array): string {
  if (existsSync(join(dir, ".complete"))) return dir;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(unzipSync(zip))) {
    if (name.includes("/") || name.startsWith(".")) {
      throw new Error(`[slicer] unexpected entry ${name} in a slicer's zip`);
    }
    writeFileSync(join(dir, name), bytes);
  }
  writeFileSync(join(dir, ".complete"), "");
  return dir;
}

function infoOf(dir: string | null, pin: SlicerPin, rustDir: string | null, rustPin: SlicerPin): SlicerEngineInfo {
  const ours = dir ? JSON.parse(readFileSync(join(dir, "spaghetti-slicer.json"), "utf8")) : null;
  const rust = rustDir ? JSON.parse(readFileSync(join(rustDir, "spaghetti-slicer-rs.json"), "utf8")) : null;
  return {
    base: ours ? `/slicer/${pin.version}/` : null,
    host: ours?.host ?? "",
    version: pin.version,
    engine: {
      name: ours?.engine.name ?? "",
      repository: ours?.engine.repository ?? "",
      tag: ours?.engine.tag ?? "",
      commit: ours?.engine.commit ?? "",
      license: ours?.engine.license ?? "AGPL-3.0-only",
    },
    orca: {
      version: ours?.orca.version ?? "",
      repository: ours?.orca.repository ?? "",
      commit: ours?.orca.commit ?? "",
    },
    source: ours?.source.release ?? "",
    rust: {
      base: rust ? `/slicer/${rustFolder(rustPin)}/` : null,
      wasm: rust?.wasm ?? "",
      version: rustPin.version,
      commit: rust?.source.commit ?? "",
      source: rust?.source.release ?? "",
    },
  };
}

const TYPES: Record<string, string> = {
  ".wasm": "application/wasm",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".patch": "text/plain; charset=utf-8",
};

export function slicerEngine(): Plugin {
  const pin = readPin();
  const rustPin = readRustPin();
  let dir: string | null = null;
  let rustDir: string | null = null;
  let building = false;
  return {
    name: "spaghetti:slicer-engine",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      const fetches: Promise<void>[] = [];
      if (!dir) {
        fetches.push(
          ensureSlicer(pin).then((found) => {
            dir = found;
          }),
        );
      }
      if (!rustDir) {
        fetches.push(
          ensureRustSlicer(rustPin).then((found) => {
            rustDir = found;
          }),
        );
      }
      for (const result of await Promise.allSettled(fetches)) {
        if (result.status === "fulfilled") continue;
        // A build must carry both; the dev server goes on without (slicing then says it can't start, or slices with
        // OrcaSlicer where our own slicer is missing).
        if (building) throw result.reason;
        console.warn(`${(result.reason as Error).message}\n[slicer] the dev server runs without it`);
      }
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      return `export default ${JSON.stringify(infoOf(dir, pin, rustDir, rustPin))};`;
    },
    configureServer(server) {
      const folders = () => [
        { prefix: `/slicer/${pin.version}/`, dir },
        { prefix: `/slicer/${rustFolder(rustPin)}/`, dir: rustDir },
      ];
      // Only the slicers' own files are served: a name their folder lists (never `.`, `..` or `.complete`).
      const served = new Map<string, Set<string>>();
      const servedFiles = (folder: string) => {
        let names = served.get(folder);
        if (!names) {
          names = new Set(
            readdirSync(folder).filter((name) => !name.startsWith(".") && statSync(join(folder, name)).isFile()),
          );
          served.set(folder, names);
        }
        return names;
      };
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        if (!path.startsWith("/slicer/")) return next();
        const folder = folders().find((candidate) => path.startsWith(candidate.prefix));
        const name = folder ? path.slice(folder.prefix.length) : "";
        if (!folder?.dir || !servedFiles(folder.dir).has(name)) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }
        const file = join(folder.dir, name);
        response.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        response.setHeader("Content-Length", String(statSync(file).size));
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
      });
    },
    async writeBundle(options) {
      if (this.environment.name !== "client" || !options.dir) return;
      for (const [folder, from, what] of [
        [pin.version, dir, "engine"],
        [rustFolder(rustPin), rustDir, "our own slicer"],
      ] as const) {
        if (!from) continue;
        const target = join(options.dir, "slicer", folder);
        await cp(from, target, { recursive: true, filter: (source) => !source.endsWith(".complete") });
        console.log(`[slicer] ${what} ${folder} (${readdirSync(target).length} files) -> ${target}`);
      }
    },
  };
}
