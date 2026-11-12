import type { AnyRouter } from "@tanstack/react-router";

/** The last move the router made: where it came from and where it landed (for "was the list the page before?"). */
export const lastMove = { from: "", to: "" };

/** How the router last moved: "BACK" for the back arrow, pull-to-go and the browser's back button. */
let lastAction = "";

/** Whether the move being made is a step back in history (a page slides away to the right only then). */
export const isBackMove = () => lastAction === "BACK";

export function trackMoves(router: AnyRouter) {
  router.history.subscribe(({ action }: { action: { type: string } }) => {
    lastAction = action.type;
  });
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
