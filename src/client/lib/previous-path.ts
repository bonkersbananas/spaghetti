import type { AnyRouter } from "@tanstack/react-router";

/** The last move the router made: where it came from and where it landed (for "was the list the page before?"). */
export const lastMove = { from: "", to: "" };

export function trackMoves(router: AnyRouter) {
  router.subscribe("onResolved", (event) => {
    lastMove.from = event.fromLocation?.pathname ?? "";
    lastMove.to = event.toLocation.pathname;
  });
}

/** The in-app page this one was opened from (history has an entry for it), with the name to give it; null on a deep link or a fresh open. */
export function previousPlace(): string | null {
  const index = (window.history.state as { __TSR_index?: number } | null)?.__TSR_index ?? 0;
  const { from, to } = lastMove;
  return index > 0 && from && to === location.pathname && from !== to ? from : null;
}
