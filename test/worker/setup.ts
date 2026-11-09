import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Every test file starts from the checked-in migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
