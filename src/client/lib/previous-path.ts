import type { AnyRouter } from "@tanstack/react-router";

/** The last move the router made: where it came from and where it landed (for "was the list the page before?"). */
export const lastMove = { from: "", to: "" };

export function trackMoves(router: AnyRouter) {
  router.subscribe("onResolved", (event) => {
    lastMove.from = event.fromLocation?.pathname ?? "";
    lastMove.to = event.toLocation.pathname;
  });
}
