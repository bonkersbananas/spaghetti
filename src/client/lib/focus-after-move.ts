import type { RouterEvents } from "@tanstack/react-router";
import { CONTENT_ID, focusContent } from "./focus-content";

/**
 * Runs `work` once the frame that follows the move has painted: focusing a card scrolls it into view and measures the
 * page, which inside the frame would hold the first paint of the new page back (the "Start building" budget).
 */
function afterPaint(work: () => void) {
  requestAnimationFrame(() => setTimeout(work, 0));
}

/**
 * After the router moves to another page, a keyboard starts from the page and not from where the old one's focused
 * control used to be: the control that held focus is gone (`<body>`), or it is the sidebar link that was just used,
 * and either way the next Tab would start at the logo again. Focus that is somewhere real (a field the page
 * focused itself, an open sheet) stays where it is. Loaded with the first move, not with the first screen.
 */
export function focusAfterMove(event: RouterEvents["onResolved"]) {
  const { pathname } = event.toLocation;
  // The first load isn't a move: the first Tab belongs to the skip link.
  if (!event.fromLocation || event.fromLocation.pathname === pathname || pathname.startsWith("/search")) return;
  const from = event.fromLocation.pathname;
  let frames = 0;
  const settle = () => {
    const active = document.activeElement;
    if (active && active !== document.body && active.id !== CONTENT_ID && !active.closest("aside")) return;
    // Back from an item to its list: the card that was opened has focus again, so J goes on from it. The list may
    // take a frame or two to draw.
    const card = document.querySelector<HTMLElement>(`main [data-picks] a[href="${from}"]`);
    if (card) card.focus();
    else if (++frames < 6) afterPaint(settle);
    else focusContent();
  };
  afterPaint(settle);
}
