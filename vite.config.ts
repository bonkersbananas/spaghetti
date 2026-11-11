import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { bundleReport } from "./scripts/vite-bundle-report.ts";
import { phosphorWeights } from "./scripts/vite-phosphor-weights.ts";
import { serviceWorker } from "./scripts/vite-service-worker.ts";

// SPAGHETTI_STATE_DIR points local D1/R2 state elsewhere (the screenshot
// harness and e2e tests use a throwaway directory). Default: .wrangler/state,
// the same place `wrangler d1 ... --local` uses.
const stateDir = process.env.SPAGHETTI_STATE_DIR;
const fakeClaude = process.env.SPAGHETTI_FAKE_CLAUDE;

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/client/routes",
      generatedRouteTree: "./src/client/routeTree.gen.ts",
    }),
    phosphorWeights(),
    react(),
    tailwindcss(),
    serviceWorker(),
    ...(process.env.SPAGHETTI_BUNDLE_REPORT ? [bundleReport()] : []),
    cloudflare({
      persistState: stateDir ? { path: stateDir } : true,
      // The e2e tests and screenshots point drafting at a stand-in for the Anthropic API (scripts/lib/fake-claude.ts).
      config: fakeClaude ? { vars: { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: fakeClaude } } : undefined,
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
});
