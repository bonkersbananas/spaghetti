import { AWAY_MS, CATCH_UP_MS } from "@shared/since";
import { useSyncExternalStore } from "react";

// This device's own record of when the app was last in use, for "Since Thursday". Not data: no server, no outbox.
const ACTIVE = "sg-active";
const SINCE = "sg-since";

interface Since {
  from: number;
  until: number;
}

const listeners = new Set<() => void>();

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full: there is just no catch-up.
  }
}

let current: Since | null = load();

function load(): Since | null {
  const stored = read(SINCE) as Since | null;
  return stored && typeof stored.from === "number" && typeof stored.until === "number" ? stored : null;
}

/** The app is in use now: after a long away that starts a catch-up from when it was last in use. */
export function markActive(now = Date.now()) {
  const last = read(ACTIVE);
  if (typeof last === "number" && now - last >= AWAY_MS) {
    current = { from: last, until: now + CATCH_UP_MS };
    write(SINCE, current);
    for (const listener of listeners) listener();
  }
  write(ACTIVE, now);
}

/** Starts following use of the app (once, from the signed-in shell). Returns its stop. */
export function followActivity(): () => void {
  markActive();
  const beat = () => write(ACTIVE, Date.now());
  const visible = () => (document.visibilityState === "visible" ? markActive() : beat());
  const timer = window.setInterval(beat, 60_000);
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("pagehide", beat);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pagehide", beat);
  };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** When the current catch-up starts from (epoch ms), or null when there is none (or it has gone quiet). */
export function useSinceFrom(): number | null {
  const since = useSyncExternalStore(subscribe, () => current);
  return since && Date.now() < since.until ? since.from : null;
}
