import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { serviceWorker } from "./scripts/vite-service-worker.ts";

// SPAGHETTI_STATE_DIR points local D1/R2 state elsewhere (the screenshot
// harness and e2e tests use a throwaway directory). Default: .wrangler/state,
// the same place `wrangler d1 ... --local` uses.
const stateDir = process.env.SPAGHETTI_STATE_DIR;

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    serviceWorker(),
    cloudflare({ persistState: stateDir ? { path: stateDir } : true }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
});
