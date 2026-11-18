import { useSyncExternalStore } from "react";

export type PantryView = "cards" | "list";

/** Remembered per device, the way `sg-theme` is. */
export const PANTRY_VIEW_KEY = "sg-pantry-view";

const listeners = new Set<() => void>();

function stored(): PantryView {
  try {
    return localStorage.getItem(PANTRY_VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

let current: PantryView | null = null;
const read = () => {
  current ??= stored();
  return current;
};

export function setPantryView(view: PantryView) {
  current = view;
  try {
    localStorage.setItem(PANTRY_VIEW_KEY, view);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  for (const listener of listeners) listener();
}

/** Cards or list on desktop, remembered on this device. Phones always show cards. */
export function usePantryView(): [PantryView, (view: PantryView) => void] {
  const view = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== PANTRY_VIEW_KEY) return;
        current = stored();
        listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    read,
    (): PantryView => "cards",
  );
  return [view, setPantryView];
}

export type PantryDensity = "tiles" | "compact";

/** Above this many spools a phone starts on the compact view (three across); fewer keep the big tiles. */
export const COMPACT_ABOVE = 12;

const DENSITY_KEY = "sg-pantry-density";
const densityListeners = new Set<() => void>();
const storedDensity = (): PantryDensity | null => {
  try {
    const value = localStorage.getItem(DENSITY_KEY);
    return value === "tiles" || value === "compact" ? value : null;
  } catch {
    return null;
  }
};
let density: PantryDensity | null | undefined;
const readDensity = () => {
  if (density === undefined) density = storedDensity();
  return density;
};

/**
 * Phones: the tiles or the compact view, remembered on this device. null until someone picks (the count of spools
 * then decides).
 */
export function usePantryDensity(): [PantryDensity | null, (next: PantryDensity) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      densityListeners.add(listener);
      return () => densityListeners.delete(listener);
    },
    readDensity,
    () => null,
  );
  const set = (next: PantryDensity) => {
    density = next;
    try {
      localStorage.setItem(DENSITY_KEY, next);
    } catch {
      // Private mode: the choice lasts until the page closes.
    }
    for (const listener of densityListeners) listener();
  };
  return [value, set];
}
