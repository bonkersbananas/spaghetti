import type { AnyRouter, HistoryState } from "@tanstack/react-router";

/** The last move the router made: where it came from and where it landed (for "was the list the page before?"). */
export const lastMove = { from: "", to: "" };

/**
 * Whether the router's last move was a step back in history: the back arrow, pull-to-go, the browser's back button,
 * or a jump of several steps back to the page a detail page was opened from (lib/origin.ts).
 */
let steppedBack = false;

/** Whether the move being made is a step back in history (a page slides away to the right only then). */
export const isBackMove = () => steppedBack;

/** A history entry: its key and place in this tab's history (TanStack's `__TSR_key` and `__TSR_index`). */
export interface Entry {
  key: string;
  href: string;
  path: string;
  index: number;
}

/** How an entry was reached: the entry before it and the kind of move; for a detail page, the name of the page left. */
export interface Reached {
  path: string;
  from: Entry;
  type: string;
  label: string;
  keep?: boolean;
  direct?: boolean;
}

interface EntryState {
  key?: string;
  __TSR_key?: string;
  __TSR_index: number;
  keepOrigin?: boolean;
  openedDirectly?: boolean;
}

/**
 * Router state for a step to the next or previous thing of the same list (J and K): the page keeps the origin it had.
 * A cast because the router's HistoryState declares no fields of its own.
 */
export const keepOrigin = { keepOrigin: true } as HistoryState;
/** Router state for a page opened from outside the app's pages (a tapped notification): back goes to its list. */
export const openedDirectly = { openedDirectly: true } as HistoryState;

/**
 * What the app's moves through history were, read by lib/origin.ts (which loads with the detail pages; this part is in
 * every first load, so it only writes down): how each entry was reached, by its key, and where each entry was
 * scrolled when it was left. In memory only: a reload or a new tab starts afresh.
 */
export const moves = {
  here: null as Entry | null,
  reached: new Map<string, Reached>(),
  scrolls: new Map<string, number>(),
  /** Called after each move (set by lib/origin.ts once it has loaded). */
  after: null as ((type: string) => void) | null,
};

/** The detail pages: they go back to where they were opened from, so the page they were opened from is named. */
const DETAIL = /^\/(?:ideas|builds|twists|pantry)\/[^/]+\/?$/;

/** The page on screen's name (its heading: the section, an idea's title, a week), read as it is left. */
const nameOfPage = () =>
  [...document.querySelectorAll("h1")].find((h1) => !h1.closest("[role=dialog]"))?.textContent?.trim() || "Back";

const entryOf = (location: { href: string; pathname: string; state: unknown }): Entry => {
  const state = location.state as EntryState;
  return {
    key: state.__TSR_key ?? state.key ?? "",
    href: location.href,
    path: location.pathname,
    index: state.__TSR_index,
  };
};

export function trackMoves(router: AnyRouter) {
  moves.here = entryOf(router.history.location);
  router.history.subscribe(
    ({
      location,
      action,
    }: {
      location: { href: string; pathname: string; state: unknown };
      action: { type: string; index?: number };
    }) => {
      steppedBack = action.type === "BACK" || (action.type === "GO" && (action.index ?? 0) < 0);
      const from = moves.here;
      const to = entryOf(location);
      moves.here = to;
      // The page being left is still on screen here.
      if (from && from.key !== to.key) {
        moves.scrolls.set(from.key, window.scrollY);
        if (!moves.reached.has(to.key)) {
          const state = location.state as EntryState;
          const label = DETAIL.test(to.path) ? nameOfPage() : "";
          moves.reached.set(to.key, {
            path: to.path,
            from,
            type: action.type,
            label,
            keep: state.keepOrigin,
            direct: state.openedDirectly,
          });
        }
      }
      moves.after?.(action.type);
    },
  );
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
