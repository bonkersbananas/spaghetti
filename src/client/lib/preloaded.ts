import { useSyncExternalStore } from "react";

/**
 * A module loaded on demand and rendered straight from where it is held, not through `React.lazy`: lazy suspends once
 * even with its chunk in, and React holds back a Suspense reveal for up to 300 ms, so a sheet whose code was warmed
 * still showed ~350 ms after the press. `use()` is the module once it is in (re-rendering then), else undefined.
 */
export function preloaded<T>(load: () => Promise<T>) {
  let mod: T | undefined;
  let started: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const start = () =>
    // A failed fetch (offline) is tried again at the next ask.
    (started ??= load().then(
      (loaded) => {
        mod = loaded;
        for (const listener of listeners) listener();
      },
      () => {
        started = undefined;
      },
    ));
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  };
  return { start, use: () => useSyncExternalStore(subscribe, () => mod) };
}
