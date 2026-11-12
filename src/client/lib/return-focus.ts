import { useRef } from "react";

/**
 * Puts focus back where it was when the sheet opened. Radix only returns it
 * to a Dialog.Trigger, and our sheets open from state (a shortcut, a button
 * elsewhere, the palette), so without this it would fall to the page.
 */
export function useReturnFocus(open: boolean) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== "undefined") {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
  }
  wasOpen.current = open;
  return (event: Event) => {
    const target = opener.current;
    opener.current = null;
    if (!target?.isConnected) return;
    // Another sheet opened as this one closed (an action that opens the next step): leave focus there.
    if (document.activeElement?.closest("[role=dialog]")) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  };
}
