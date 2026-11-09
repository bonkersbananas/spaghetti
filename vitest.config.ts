import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    test: {
      projects: [
        {
          // API tests run inside workerd, with real (isolated) D1 and R2.
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.jsonc" },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            name: "worker",
            include: ["test/worker/**/*.test.ts"],
            setupFiles: ["./test/worker/setup.ts"],
          },
        },
        {
          // Plain Node: shared code and scripts.
          resolve: {
            alias: {
              "@": fileURLToPath(new URL("./src/client", import.meta.url)),
              "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)),
            },
          },
          test: {
            name: "unit",
            include: ["test/unit/**/*.test.ts"],
            environment: "node",
          },
        },
      ],
    },
  };
});
