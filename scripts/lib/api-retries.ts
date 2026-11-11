/**
 * Playwright's API requests (page.request, request.newContext) keep their sockets alive, and the servers under
 * test close an idle socket after a few seconds: a request that reuses a socket at that very moment gets
 * ECONNRESET before the server has seen it, which killed whole tests (builds.spec's cleanup) on CI. Playwright
 * retries exactly that error when asked with `maxRetries`, so every API request is asked to.
 *
 * Imported by playwright.config.ts, which every worker loads; the patch is on the context class itself, so the
 * specs stay as they are.
 */
import { request } from "@playwright/test";

const probe = await request.newContext();
const contextClass = Object.getPrototypeOf(probe) as {
  fetch: (this: unknown, target: unknown, options?: { maxRetries?: number }) => Promise<unknown>;
};
await probe.dispose();

const fetch = contextClass.fetch;
contextClass.fetch = function (target, options) {
  return fetch.call(this, target, { maxRetries: 3, ...options });
};
