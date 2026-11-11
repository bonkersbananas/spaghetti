import { keycaps, SHORTCUTS, type ShortcutId, shortcutKeys } from "@shared/shortcuts";
import { useEffect, useRef } from "react";

/** What to do for each shortcut a screen handles. Leave a key out (or undefined) when it would do nothing. */
export type HotkeyHandlers = Partial<Record<ShortcutId, (() => void) | undefined>>;

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/** Whether the person is on a Mac, for ⌘ against Ctrl. */
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** The keycaps for a shortcut's first key, for hints beside buttons: ["G", "I"], ["⌘", "K"]. */
export function shortcutCaps(id: ShortcutId): string[] {
  const first = shortcutKeys(id)[0];
  return first ? keycaps(first, isMac) : [];
}

/**
 * A key press as the registry writes it: "c", "?", "arrowdown", "mod+k".
 * Null when Alt is held (those belong to the browser and the system).
 */
export function comboOf(event: KeyboardEvent): string | null {
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  return event.metaKey || event.ctrlKey ? `mod+${key}` : key;
}

/**
 * Binds handlers to the shortcuts in `shared/shortcuts.ts`: single keys
 * ("c", "/"), two keys in a row ("g i") and ⌘/Ctrl combos. Ignored while
 * typing in a field or while a dialog is open; ⌘/Ctrl combos work inside
 * fields too (⌘K from the note you are writing), but not over a dialog.
 */
// The first key of a two-key shortcut ("g" of "g i"), shared by every useHotkeys on the page: a screen's own
// handler for "j" must not swallow the "j" of "g j" that the shell is waiting for.
let pending: string | null = null;
let pendingEvent: KeyboardEvent | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | undefined;
function setPending(key: string | null, event: KeyboardEvent | null = null) {
  pending = key;
  pendingEvent = event;
  clearTimeout(pendingTimer);
  if (key) pendingTimer = setTimeout(() => setPending(null), 1200);
}

export function useHotkeys(handlers: HotkeyHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    /** Combo → handler, for the shortcuts this screen handles right now. */
    function bound(): Map<string, () => void> {
      const map = new Map<string, () => void>();
      for (const shortcut of SHORTCUTS) {
        const handler = handlersRef.current[shortcut.id];
        if (handler) for (const key of shortcut.keys) map.set(key, handler);
      }
      return map;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const key = comboOf(event);
      if (key === null) return;
      const modified = key.startsWith("mod+");
      if (!modified && isTyping(event.target)) return;
      if (document.querySelector("[role=dialog]")) return;

      const map = bound();
      if (modified) {
        const handler = map.get(key);
        if (handler) {
          event.preventDefault();
          handler();
        }
        return;
      }

      const combo = pending ? `${pending} ${key}` : key;
      const handler = map.get(combo);
      if (handler) {
        event.preventDefault();
        setPending(null);
        handler();
        return;
      }
      const startsSequence = [...map.keys()].some((k) => k.startsWith(`${key} `));
      if (!pending && startsSequence) setPending(key, event);
      // A second key nobody on the page took ends the sequence, but only after every listener has seen this event.
      else if (pending && pendingEvent !== event) setTimeout(() => pending && setPending(null), 0);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);
}
