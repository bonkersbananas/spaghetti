/**
 * Vite plugin: the slicing engine (OrcaSlicer's core in WebAssembly, docs/slicer.md) as static files of the app.
 *
 * The engine is built by its own workflow and published as a release asset; scripts/slicer/engine.json pins that
 * asset by URL and sha256. This plugin fetches it once into node_modules/.cache/spaghetti-slicer, checks the hash,
 * serves it at /slicer/<version>/ in `vite dev`, and copies it to the client build's slicer/<version>/, where the
 * Worker's assets (and the container's wrangler) serve it like any file. The app never imports it: it starts the
 * engine's host by URL in a worker. `virtual:slicer-engine` says where it is and what it is.
 *
 * SLICER_ARCHIVE=<zip> uses a local zip instead of the release (an engine not yet released, or no network).
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

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Each environment of a build (client, worker) starts the plugin: say once that a local zip stands in. */
const warned = new Set<string>();

/**
 * The engine's runtime folder, fetched and checked if it isn't in the cache yet. Throws when it can't be had. The
 * cache is keyed by each zip's own sha256, so a local SLICER_ARCHIVE never passes for the pinned engine later.
 */
export async function ensureSlicer(pin: SlicerPin = readPin()): Promise<string> {
  const cache = join(ROOT, "node_modules/.cache/spaghetti-slicer");
  const local = process.env.SLICER_ARCHIVE;
  if (local) {
    const zip = new Uint8Array(readFileSync(local));
    const got = sha256(zip);
    if (got !== pin.sha256 && !warned.has(got)) {
      warned.add(got);
      console.warn(`[slicer] ${local} is not the pinned engine (scripts/slicer/engine.json): using it as asked`);
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
      throw new Error(`[slicer] unexpected entry ${name} in the engine's zip`);
    }
    writeFileSync(join(dir, name), bytes);
  }
  writeFileSync(join(dir, ".complete"), "");
  return dir;
}

function infoOf(dir: string | null, pin: SlicerPin): SlicerEngineInfo {
  const ours = dir ? JSON.parse(readFileSync(join(dir, "spaghetti-slicer.json"), "utf8")) : null;
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
  let dir: string | null = null;
  let building = false;
  return {
    name: "spaghetti:slicer-engine",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      if (dir) return;
      try {
        dir = await ensureSlicer(pin);
      } catch (error) {
        // A build must carry the engine; the dev server goes on without it (slicing then says it can't start).
        if (building) throw error;
        console.warn(`${(error as Error).message}\n[slicer] the dev server runs without the slicing engine`);
      }
    },
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      return `export default ${JSON.stringify(infoOf(dir, pin))};`;
    },
    configureServer(server) {
      const prefix = `/slicer/${pin.version}/`;
      // Only the engine's own files are served: a name the folder lists (never `.`, `..` or `.complete`).
      let served: Set<string> | null = null;
      const servedFiles = (folder: string) => {
        served ??= new Set(
          readdirSync(folder).filter((name) => !name.startsWith(".") && statSync(join(folder, name)).isFile()),
        );
        return served;
      };
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        if (!path.startsWith("/slicer/")) return next();
        const name = path.startsWith(prefix) ? path.slice(prefix.length) : "";
        if (!dir || !servedFiles(dir).has(name)) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }
        const file = join(dir, name);
        response.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
        response.setHeader("Content-Length", String(statSync(file).size));
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        createReadStream(file)
          .on("error", () => response.destroy())
          .pipe(response);
      });
    },
    async writeBundle(options) {
      if (this.environment.name !== "client" || !dir || !options.dir) return;
      const target = join(options.dir, "slicer", pin.version);
      await cp(dir, target, { recursive: true, filter: (source) => !source.endsWith(".complete") });
      const files = readdirSync(target);
      console.log(`[slicer] engine ${pin.version} (${files.length} files) -> ${target}`);
    },
  };
}
