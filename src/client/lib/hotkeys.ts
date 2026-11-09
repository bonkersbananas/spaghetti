import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, () => void>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Single keys ("c", "/") and two-key sequences ("g i"), ignored while
 * typing, with a modifier held, or while a dialog is open.
 */
export function useHotkeys(map: HotkeyMap) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      if (isTyping(event.target)) return;
      if (document.querySelector("[role=dialog]")) return;
      const key = event.key.toLowerCase();
      const combo = pending ? `${pending} ${key}` : key;
      const handler = mapRef.current[combo];
      clearTimeout(timer);
      if (handler) {
        event.preventDefault();
        pending = null;
        handler();
        return;
      }
      const startsSequence = Object.keys(mapRef.current).some((k) => k.startsWith(`${key} `));
      pending = !pending && startsSequence ? key : null;
      if (pending) timer = setTimeout(() => (pending = null), 1200);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearTimeout(timer);
    };
  }, []);
}
