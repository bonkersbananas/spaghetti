import { useRef } from "react";

/** What the last dialog opened from, for one that takes over from it while it is still open (see `inherit`). */
let recent: { element: HTMLElement; at: number } | null = null;

/**
 * Puts focus back where it was when the sheet opened. Radix only returns it
 * to a Dialog.Trigger, and our sheets open from state (a shortcut, a button
 * elsewhere, the palette), so without this it would fall to the page.
 */
export function useReturnFocus(open: boolean, inherit = false) {
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== "undefined") {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    // The palette's frame, replaced by the real palette while open: focus is in the frame's search box, which is about
    // to go, so the opener is what the frame was opened from.
    if (inherit && opener.current?.closest("[role=dialog]") && recent && Date.now() - recent.at < 2000) {
      opener.current = recent.element;
    } else if (opener.current) recent = { element: opener.current, at: Date.now() };
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
    // Something unmounting with the dialog (the palette's frame being swapped for the real one) can take focus
    // away again a moment later: if nothing has it by then, it goes back.
    setTimeout(() => {
      if ((!document.activeElement || document.activeElement === document.body) && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    }, 60);
  };
}
