import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { shiftClock } from "../support/shift-clock.ts";

shiftClock(env.FAKE_NOW);

// Every test file starts from the checked-in migrations.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
