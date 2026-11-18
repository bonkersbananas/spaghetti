import { useSyncExternalStore } from "react";

/**
 * Which bought things already went into the pantry, on this device: the shopping row then says so instead of
 * offering "Add to pantry" again. Thing id → spool id.
 */
const KEY = "sg-shopping-pantry";
const listeners = new Set<() => void>();

let current: Record<string, string> | null = null;
function read(): Record<string, string> {
  if (current) return current;
  try {
    current = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    current = {};
  }
  return current;
}

export function keepInPantry(itemId: string, spoolId: string) {
  current = { ...read(), [itemId]: spoolId };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Private mode: it lasts until the page closes.
  }
  for (const listener of listeners) listener();
}

/** The spool a bought thing became, if it was added from the list on this device. */
export function useInPantry(itemId: string): string | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read()[itemId],
    () => undefined,
  );
}
