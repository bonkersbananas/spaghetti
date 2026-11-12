/**
 * Where a Playwright worker's server is. scripts/e2e-server.ts starts one server per worker, on E2E_BASE_PORT plus
 * the worker's parallel index (0 to workers - 1; a restarted worker keeps its index). Playwright sets
 * TEST_PARALLEL_INDEX in each worker process before it evaluates the config and the specs there.
 */
export const E2E_BASE_PORT = 5174;

/** This worker's index (0 in the main process). */
export function e2eSlot(): number {
  return Number(process.env.TEST_PARALLEL_INDEX ?? 0);
}

/** This worker's server. Passkeys need the `localhost` name rather than 127.0.0.1. */
export function e2eOrigin(host: "127.0.0.1" | "localhost" = "127.0.0.1"): string {
  return `http://${host}:${E2E_BASE_PORT + e2eSlot()}`;
}
