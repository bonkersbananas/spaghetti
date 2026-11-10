import { useCallback, useSyncExternalStore } from "react";

interface Clock {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | undefined;
}

const clocks = new Map<number, Clock>();

function clockFor(intervalMs: number): Clock {
  let clock = clocks.get(intervalMs);
  if (!clock) {
    clock = { now: Date.now(), listeners: new Set(), timer: undefined };
    clocks.set(intervalMs, clock);
  }
  return clock;
}

function tick(clock: Clock) {
  clock.now = Date.now();
  for (const listener of clock.listeners) listener();
}

function start(clock: Clock, intervalMs: number) {
  if (clock.timer === undefined && !document.hidden) clock.timer = setInterval(() => tick(clock), intervalMs);
}

function stop(clock: Clock) {
  clearInterval(clock.timer);
  clock.timer = undefined;
}

/** Hidden tabs don't tick; coming back refreshes at once and starts the timers again. */
function onVisibility() {
  for (const [intervalMs, clock] of clocks) {
    if (clock.listeners.size === 0) continue;
    if (document.hidden) {
      stop(clock);
    } else {
      stop(clock);
      tick(clock);
      start(clock, intervalMs);
    }
  }
}

let watching = false;

function subscribe(intervalMs: number, listener: () => void) {
  const clock = clockFor(intervalMs);
  if (!watching) {
    document.addEventListener("visibilitychange", onVisibility);
    watching = true;
  }
  if (clock.listeners.size === 0) {
    // Whatever was cached is stale: the first subscriber starts from the real time.
    clock.now = Date.now();
    start(clock, intervalMs);
  }
  clock.listeners.add(listener);
  return () => {
    clock.listeners.delete(listener);
    if (clock.listeners.size === 0) stop(clock);
  };
}

/**
 * The current time, refreshed every `intervalMs` (30 s by default), for
 * things that read "45 min left" or "2 h ago" and should stay right while
 * open. One timer serves every component that asks for the same interval,
 * it pauses while the tab is hidden, and it refreshes the moment the tab
 * comes back.
 */
export function useNow(intervalMs = 30_000): number {
  const subscribeTo = useCallback((listener: () => void) => subscribe(intervalMs, listener), [intervalMs]);
  const read = useCallback(() => {
    const clock = clockFor(intervalMs);
    // Nobody is ticking it: show the time it was asked for, but not a new one on every read.
    if (clock.listeners.size === 0 && Date.now() - clock.now >= intervalMs) clock.now = Date.now();
    return clock.now;
  }, [intervalMs]);
  return useSyncExternalStore(subscribeTo, read);
}
