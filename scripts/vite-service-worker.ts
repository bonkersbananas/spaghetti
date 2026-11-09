/**
 * Vite plugin: builds /sw.js from src/sw/sw.js. It lists what the client
 * build produced (scripts, styles, fonts, images) and what is in public/ so
 * the service worker can precache the whole app shell, and uses a hash of
 * that list as the version: a new build is a new cache and a new worker.
 *
 * Runs only for the client build; `vite dev` has no service worker.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const precached = /\.(?:js|css|woff2?|svg|png|webp|webmanifest|ico)$/;

export function serviceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "spaghetti:service-worker",
    apply: "build",
    // After Vite's own plugins, so index.html is already in the bundle when its hash is taken.
    enforce: "post",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const built = Object.keys(bundle).filter((name) => precached.test(name));
      const fromPublic = publicDir ? readdirSync(publicDir).filter((name) => precached.test(name)) : [];
      const precache = [...new Set([...built, ...fromPublic])].sort().map((name) => `/${name}`);
      const source = readFileSync(join(import.meta.dirname, "../src/sw/sw.js"), "utf8");
      // Built files have hashed names; public/ files don't, so their bytes count too.
      const hash = createHash("sha256").update(precache.join("\n")).update(source);
      for (const name of fromPublic) hash.update(readFileSync(join(publicDir, name)));
      // The worker caches index.html at install, so a change to it alone (the inline theme script) must make a new version too.
      const html = bundle["index.html"];
      if (html?.type !== "asset") throw new Error("The service worker plugin needs index.html in the bundle");
      hash.update(html.source);
      const version = hash.digest("hex").slice(0, 12);
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: `self.__BUILD__ = ${JSON.stringify({ version, precache })};\n${source}`,
      });
    },
  };
}
