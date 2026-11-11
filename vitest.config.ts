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
              miniflare: {
                bindings: {
                  TEST_MIGRATIONS: migrations,
                  // A throwaway pair made only for the tests; the real one is never in the repository.
                  VAPID_PUBLIC_KEY:
                    "BBxnnFAUPlUsGEZ8Pa-IDPsQuQ8VmvkEfM-gNO8wCBupZWGUkdkkQGzwC1tHzQs7cQG8YM4S5epLdcSOutLISbo",
                  VAPID_PRIVATE_KEY: "JRWTuy9_i4-619ppiGZN_VeMcThGOk0QoCwJK-F1NAo",
                  // Drafting is on in the tests; the Anthropic API itself is stubbed (test/worker/drafts.test.ts).
                  ANTHROPIC_API_KEY: "sk-ant-test-key",
                },
              },
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
            include: ["test/unit/**/*.test.ts", "test/bridge/**/*.test.ts", "test/openapi/**/*.test.ts"],
            environment: "node",
          },
        },
      ],
    },
  };
});
