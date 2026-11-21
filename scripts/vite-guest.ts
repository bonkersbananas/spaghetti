/**
 * Vite plugin: the shared page (guest.html, src/guest; decisions 0075 and 0077) built on its own, after the app's
 * client build, into the same folder: guest.html at the top and everything it loads under /assets/guest/.
 *
 * Its own build because the page's 3D view is the app's own PrintViewer, with React and three.js: in the app's build
 * the two pages would share those modules, and the bundler would move React (and more) out of the app's entry into
 * chunks of their own, changing every screen's first load. Built apart, the app's output doesn't know the page
 * exists, and the page carries its own copy of what its viewer needs, fetched only when a guest opens a plate in 3D.
 *
 * - The page itself loads guest.css and src/guest/island.ts (a few hundred bytes): nothing of the viewer.
 * - Everything goes to /assets/guest/ (scripts, styles, fonts, the toolpath worker), which the page's policy names as
 *   its only source of script and workers (worker/guest/index.tsx), the service worker leaves out of the app's
 *   precache, and public/_headers caches for a year (the names are hashed).
 *
 * In `vite dev` there is nothing to do: the dev server serves guest.html and its modules like any page.
 */
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { build, type InlineConfig, type Plugin } from "vite";
import { GUEST_ASSETS } from "./vite-landing.ts";
import { phosphorWeights } from "./vite-phosphor-weights.ts";

/** The page's build, on its own: the app's aliases (vite.config.ts), React and Tailwind, nothing of the Worker's. */
export function guestBuildConfig(root: string, outDir: string): InlineConfig {
  return {
    configFile: false,
    root,
    logLevel: "warn",
    // public/ is the app build's to copy.
    publicDir: false,
    plugins: [phosphorWeights(), react(), tailwindcss()],
    resolve: {
      alias: { "@": resolve(root, "src/client"), "@shared": resolve(root, "src/shared") },
    },
    build: {
      outDir,
      emptyOutDir: false,
      assetsDir: GUEST_ASSETS.replace(/\/$/, ""),
      // The page has one script with one dynamic import: no preload polyfill for browsers without modulepreload.
      modulePreload: { polyfill: false },
      // The app's whole build is the one that copies public/ and writes the manifest; this one only adds files.
      copyPublicDir: false,
      reportCompressedSize: false,
      chunkSizeWarningLimit: 700,
      rolldownOptions: { input: { guest: resolve(root, "guest.html") } },
    },
    worker: {
      format: "es",
      rolldownOptions: { output: { entryFileNames: `${GUEST_ASSETS}[name]-[hash].js` } },
    },
  };
}

export function guestPage(): Plugin {
  let root = "";
  let started = false;
  return {
    name: "spaghetti:guest",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    // After the app's client build has written its files (`emptyOutDir` has cleared the folder by then).
    closeBundle: {
      sequential: true,
      async handler() {
        if (this.environment.name !== "client" || started) return;
        started = true;
        await build(guestBuildConfig(root, resolve(root, this.environment.config.build.outDir)));
      },
    },
  };
}
