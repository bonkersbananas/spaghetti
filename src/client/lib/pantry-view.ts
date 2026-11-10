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
