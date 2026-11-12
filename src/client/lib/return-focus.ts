import { useRef } from "react";

/** What the palette was opened from, for the real palette that takes over from its frame while open (see `inherit`). */
let recent: HTMLElement | null = null;

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
    // `inherit` (the palette): focus is in the palette's own frame, which is being swapped for the real palette and
    // is about to go, so the opener is what the frame was opened from, however long the swap took.
    if (inherit) {
      if (opener.current?.closest("[data-palette]") && recent) opener.current = recent;
      else recent = opener.current;
    }
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
