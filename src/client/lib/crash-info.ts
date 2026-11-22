import { appVersion } from "./app-version";

/** The component stack React reported for this very error, never an earlier crash's. */
const caught = (error: unknown) => {
  const last = (window as { __crash?: { error: unknown; stack?: string } }).__crash;
  return last && last.error === error ? last.stack : undefined;
};

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
    `Component stack:${componentStack || caught(error) || " (none)"}`,
  ].join("\n");
}
