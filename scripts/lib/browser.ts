/**
 * Which Chromium the screenshot script and the Playwright tests launch.
 *
 * By default Playwright's own download (`pnpm exec playwright install
 * chromium-headless-shell`). Where that download is blocked, or an older
 * Chromium is already installed, point SPAGHETTI_BROWSER at its executable:
 *
 *   SPAGHETTI_BROWSER=/usr/bin/chromium pnpm screenshots
 *   SPAGHETTI_BROWSER=/usr/bin/chromium pnpm test:e2e
 *
 * `pnpm doctor` checks that it launches.
 */
export const BROWSER_ENV = "SPAGHETTI_BROWSER";

/** The browser executable from the environment, if one is set. */
export function browserPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env[BROWSER_ENV]?.trim() || undefined;
}

/** Playwright launch options: the chosen executable, or none for Playwright's own. */
export function launchOptions(env: NodeJS.ProcessEnv = process.env): { executablePath?: string } {
  const executablePath = browserPath(env);
  return executablePath ? { executablePath } : {};
}
