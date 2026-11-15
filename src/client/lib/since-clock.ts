import { AWAY_MS, CATCH_UP_MS } from "@shared/since-times";

// This device's own record of when the app was last in use, for "Since Thursday". Not data: no server, no outbox.
// Apart from since.ts so the gate on Today and Journal can start a catch-up the moment the screen opens, without the rest.
export const ACTIVE = "sg-active";
export const SINCE = "sg-since";

export function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full: there is just no catch-up.
  }
}

/** The app is in use now: after a long away that starts a catch-up from when it was last in use. True if it did. */
export function markActive(now = Date.now()): boolean {
  const last = read(ACTIVE);
  const started = typeof last === "number" && now - last >= AWAY_MS;
  if (started) write(SINCE, { from: last, until: now + CATCH_UP_MS });
  write(ACTIVE, now);
  return started;
}

/** Is a catch-up on right now? */
export function hasCatchUp(now = Date.now()): boolean {
  const since = read(SINCE) as { until?: number } | null;
  return typeof since?.until === "number" && now < since.until;
}
