import { useRef } from "react";
import { heldFrom, keyboardProxy } from "./keyboard-proxy";

/** What the palette was opened from, for the real palette that takes over from its frame while open (see `inherit`). */
let recent: HTMLElement | null = null;

/**
 * Puts focus back where it was when the sheet opened. Radix only returns it
 * to a Dialog.Trigger, and our sheets open from state (a shortcut, a button
 * elsewhere, the palette), so without this it would fall to the page.
 */
export function useReturnFocus(open: boolean, inherit = false) {
  const opener = useRef<HTMLElement | null>(null);
  /** The opener's containers, nearest first, up to the page's main area: where focus goes if the opener itself goes. */
  const homes = useRef<HTMLElement[]>([]);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current && typeof document !== "undefined") {
    const active = document.activeElement;
    // Opened by a tap that holds the keyboard up (lib/keyboard-proxy.ts): the stand-in goes, what it took over from stays.
    opener.current = keyboardProxy()
      ? heldFrom()
      : active instanceof HTMLElement && active !== document.body
        ? active
        : null;
    // `inherit` (the palette): focus is in the palette's own frame, which is being swapped for the real palette and
    // is about to go, so the opener is what the frame was opened from, however long the swap took.
    if (inherit) {
      if (opener.current?.closest("[data-palette]") && recent) opener.current = recent;
      else recent = opener.current;
    }
    homes.current = containersOf(opener.current);
  }
  wasOpen.current = open;
  return (event: Event) => {
    let target = opener.current;
    opener.current = null;
    // The sidebar's account button is swapped for the real one once its menu's code arrives (Sidebar.tsx): if that
    // happened while the sheet was open, the button it was opened from is gone and its replacement takes focus.
    if (target && !target.isConnected && target.hasAttribute("data-account-button")) {
      target = document.querySelector<HTMLElement>("[data-account-button]");
    }
    // What the sheet did took its opener away (a "Which build?" answered by the sheet's move): the nearest thing still
    // there that was around it takes focus instead (the card's next control), so the keyboard keeps its place.
    if (target && !target.isConnected) target = nearestLeft(homes.current);
    homes.current = [];
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

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), [tabindex]:not([tabindex="-1"])';

function containersOf(element: HTMLElement | null): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (let at = element?.parentElement; at && at !== document.body; at = at.parentElement) {
    if (at.tagName === "MAIN") break;
    found.push(at);
  }
  return found;
}

/** The first control drawn in the nearest container still on the page. */
function nearestLeft(containers: readonly HTMLElement[]): HTMLElement | null {
  for (const container of containers) {
    if (!container.isConnected) continue;
    for (const candidate of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
      if (candidate.closest("[role=dialog]") || !candidate.getClientRects().length) continue;
      return candidate;
    }
  }
  return null;
}
