import { appVersion } from "./app-version";

/** Everything Copy details gives: enough to find where it broke without the device in hand. */
export function crashReport(error: unknown, componentStack?: string): string {
  const e = error as Error | undefined;
  const head = e instanceof Error ? `${e.name}: ${e.message}` : String(error);
  return [
    head,
    `Version: ${appVersion()}`,
    `Route: ${location.pathname}${location.search}`,
    `Online: ${navigator.onLine}`,
    `Agent: ${navigator.userAgent}`,
    `Stack:\n${(e instanceof Error && e.stack) || "(none)"}`,
    `Component stack:${componentStack || (window as { __componentStack?: string }).__componentStack || " (none)"}`,
  ].join("\n");
}
