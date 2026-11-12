import type { AnyRouter } from "@tanstack/react-router";

/** The page's own content, the target of the skip link and of focus after a move (`<main id="content" tabindex="-1">`). */
export const CONTENT_ID = "content";

export const focusContent = () => document.getElementById(CONTENT_ID)?.focus({ preventScroll: true });

/**
 * After the router moves to another page, a keyboard starts from the page and not from where the old one's focused
 * control used to be: the control that held focus is gone (`<body>`), or it is the sidebar link that was just used,
 * and either way the next Tab would start at the logo again. Focus that is somewhere real (a field the page
 * focused itself, an open sheet) stays where it is.
 */
export function focusContentAfterMoves(router: AnyRouter) {
  router.subscribe("onResolved", (event) => {
    const { pathname } = event.toLocation;
    // The first load isn't a move: the first Tab belongs to the skip link.
    if (!event.fromLocation || event.fromLocation.pathname === pathname || pathname.startsWith("/search")) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!active || active === document.body || !active.isConnected || active.closest("aside")) focusContent();
    });
  });
}
