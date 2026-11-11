/**
 * Vite plugin: the landing page (landing.html, src/landing) as a second page of the client build, beside the app's
 * index.html, kept apart from the app:
 *
 *   - Its script, styles and pictures are written to /assets/landing/, which the service worker leaves out of the
 *     app's precache (scripts/vite-service-worker.ts) and public/_headers caches for a year (the names are hashed).
 *   - Vite puts its module-preload polyfill in every page's entry; with two pages it would move into a chunk of its
 *     own and change every chunk of the app. The landing page doesn't need it, so it is left out there, and the
 *     app's build stays byte for byte what it was.
 *
 * The Worker serves landing.html at / to someone signed out (src/worker/home.ts). In `vite dev` it is just a page.
 */
import type { Plugin } from "vite";

export const LANDING_ASSETS = "assets/landing/";

const isLanding = (paths: readonly string[]) =>
  paths.some((path) => /(^|\/)(src\/landing\/|landing\.html$)/.test(path));

export function landingPage(): Plugin {
  return {
    name: "spaghetti:landing",
    config: () => ({
      environments: {
        client: {
          build: {
            rolldownOptions: {
              input: { index: "index.html", landing: "landing.html" },
              output: {
                entryFileNames: (chunk) =>
                  chunk.name === "landing" ? `${LANDING_ASSETS}[name]-[hash].js` : "assets/[name]-[hash].js",
                assetFileNames: (asset) =>
                  isLanding(asset.originalFileNames) || asset.names.includes("landing.css")
                    ? `${LANDING_ASSETS}[name]-[hash][extname]`
                    : "assets/[name]-[hash][extname]",
              },
            },
          },
        },
      },
    }),
    transform: {
      order: "post",
      handler(code, id) {
        if (this.environment.mode === "build" && id.endsWith("/landing.html")) {
          return code.replace('import "vite/modulepreload-polyfill";\n', "");
        }
      },
    },
  };
}
