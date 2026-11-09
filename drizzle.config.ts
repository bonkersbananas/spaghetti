import { defineConfig } from "drizzle-kit";

// `pnpm db:generate` writes SQL migrations into ./migrations, where
// `wrangler d1 migrations apply` picks them up.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/worker/db/schema.ts",
  out: "./migrations",
});
