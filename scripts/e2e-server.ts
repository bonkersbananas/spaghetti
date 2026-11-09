/**
 * The server Playwright tests run against: a seeded throwaway local D1 and
 * the Vite dev server (the Worker in workerd). Stops and cleans up on exit.
 */
import { seedThrowawayState, startDevServer } from "./lib/local-app.ts";

const port = Number(process.env.PORT ?? 5174);
const state = await seedThrowawayState();
const server = await startDevServer({ port, stateDir: state.dir });
console.log(`e2e server ready on ${server.url}`);

function shutdown() {
  server.stop();
  state.cleanup();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
setInterval(() => {}, 1 << 30);
