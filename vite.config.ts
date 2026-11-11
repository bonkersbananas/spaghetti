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
const fakeClaude = process.env.SPAGHETTI_FAKE_CLAUDE;

// The dev server's passkeys belong to localhost on any port; the deployed relying party (spaghetti.day) is in
// wrangler.jsonc and must never reach a build, so this only applies to `vite` (serve), never `vite build`.
const localPasskeys = { WEBAUTHN_RP_ID: "localhost", WEBAUTHN_ORIGINS: "http://localhost:*" };

export default defineConfig(({ command }) => ({
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
    cloudflare({
      persistState: stateDir ? { path: stateDir } : true,
      // The e2e tests and screenshots point drafting at a stand-in for the Anthropic API (scripts/lib/fake-claude.ts).
      config: () => ({
        vars: {
          ...(command === "serve" ? localPasskeys : {}),
          ...(fakeClaude ? { ANTHROPIC_API_KEY: "sk-ant-fake", ANTHROPIC_BASE_URL: fakeClaude } : {}),
        },
      }),
    }),
  ],
  // Loaded on demand, so the dev server would only find them mid-session, re-bundle and reload the page under the
  // person (and under the e2e tests): list them up front.
  optimizeDeps: { include: ["@simplewebauthn/browser", "qrcode-generator"] },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/client", import.meta.url)),
      "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
    },
  },
}));
