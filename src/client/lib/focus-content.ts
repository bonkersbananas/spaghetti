import type { AnyRouter } from "@tanstack/react-router";

/** The page's own content, the target of the skip link and of focus after a move (`<main id="content" tabindex="-1">`). */
export const CONTENT_ID = "content";

/**
 * Focuses the page. It can only take focus while we ask: a permanent tabindex would make a tap on any text inside it
 * move focus to the page (taking it from whatever the tap should leave alone), so it is set for the focus only.
 */
export function focusContent() {
  const main = document.getElementById(CONTENT_ID);
  if (!main) return;
  main.tabIndex = -1;
  main.addEventListener("blur", () => main.removeAttribute("tabindex"), { once: true });
  main.focus({ preventScroll: true });
}

/** After the router moves, focus goes into the page (the code for it loads with the first move). */
export function focusContentAfterMoves(router: AnyRouter) {
  router.subscribe("onResolved", (event) => void import("./focus-after-move").then((m) => m.focusAfterMove(event)));
}
