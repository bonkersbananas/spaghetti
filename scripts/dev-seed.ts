/**
 * pnpm dev:seed — starts the dev server on a throwaway local database seeded
 * with the screenshot data (two people, a dozen ideas, the pantry, builds with
 * histories), for exploring by hand. Nothing is kept: the database goes when
 * you stop it, and your own `.wrangler/state` is untouched.
 *
 *   pnpm dev:seed                # http://127.0.0.1:5173, sign in as alex or sam
 *   pnpm dev:seed --port 5200
 *
 * Dates count back from today, so the app looks lived in. `pnpm screenshots`
 * uses the same seed on a fixed date.
 */
import { SEED_PASSWORD, SEED_USERS } from "./lib/local-app.ts";
import { startSeededApp } from "./lib/seeded-app.ts";

const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : (process.env.PORT ?? 5173));
if (!Number.isInteger(port) || port <= 0) {
  console.error("✗ --port needs a port number.");
  process.exit(1);
}

console.log("Starting the dev server on a seeded throwaway database…");
const app = await startSeededApp({ port, now: Date.now(), log: (message) => console.log(`  ${message}`) });

console.log(`\n✓ ${app.url}`);
console.log(`  Sign in as ${SEED_USERS.map((user) => user.username).join(" or ")}, password ${SEED_PASSWORD}.`);
console.log("  Ctrl-C stops it and removes the database.");

function shutdown() {
  app.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
