import { useSyncExternalStore } from "react";
import * as clock from "./since-clock";
import { ACTIVE, read, SINCE, write } from "./since-clock";

interface Since {
  from: number;
  until: number;
}

const listeners = new Set<() => void>();

let current: Since | null = load();

function load(): Since | null {
  const stored = read(SINCE) as Since | null;
  return stored && typeof stored.from === "number" && typeof stored.until === "number" ? stored : null;
}

/** The app is in use now: after a long away that starts a catch-up from when it was last in use. */
export function markActive(now = Date.now()) {
  if (!clock.markActive(now)) return;
  current = load();
  for (const listener of listeners) listener();
}

/** Starts following use of the app (once, from the signed-in shell). Returns its stop. */
let following = false;

export function followActivity(): () => void {
  if (following) return () => {};
  following = true;
  markActive();
  // Only while in view: a tab left open in the background all night is not use.
  const beat = () => document.visibilityState === "visible" && write(ACTIVE, Date.now());
  const visible = () => (document.visibilityState === "visible" ? markActive() : leave());
  const timer = window.setInterval(beat, 60_000);
  document.addEventListener("visibilitychange", visible);
  const leave = () => write(ACTIVE, Date.now());
  window.addEventListener("pagehide", leave);
  return () => {
    following = false;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("pagehide", leave);
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
