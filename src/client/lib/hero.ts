import { type CSSProperties, type MouseEvent, useSyncExternalStore } from "react";

/**
 * A photo travelling from a card to its page (the View Transitions API, through
 * the router's `viewTransition` option).
 *
 * Exactly one element may carry the transition name at a time: a fixed name on
 * every card would break whenever one photo shows twice (the journal can), and
 * duplicate names cancel the whole transition. So the name goes on only when a
 * card is tapped (`heroClick`, on the tapped card's photo frame), and the page
 * it opens gives the same name to its hero photo while that is the same photo
 * (`useHeroName`). Both let go a moment later. When the hero is a different
 * photo, or the browser has no View Transitions, nothing is named and the page
 * simply crossfades (or just changes).
 */
export const HERO_NAME = "hero-photo";
/** Longer than the transition (`--sg-duration-base`), short enough to be gone before anything else is tapped. */
const LET_GO_AFTER_MS = 800;

let target: string | null = null;
const listeners = new Set<() => void>();
const publish = (photoId: string | null) => {
  target = photoId;
  for (const listener of listeners) listener();
};

/** Whether a transition will run at all. */
function canTravel(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Put on a card's link as `onClick`: names the card's photo frame (the first
 * image's parent, or `frame`: the photo showing in a card that swipes) and
 * remembers which photo the next page should name. Skipped for a modified
 * click (a new tab) and where nothing would animate.
 */
export function heroClick(
  event: MouseEvent<HTMLElement>,
  photoId: string | null | undefined,
  frame: Element | null = event.currentTarget.querySelector("img")?.parentElement ?? null,
) {
  if (!photoId || event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !canTravel()) return;
  if (!(frame instanceof HTMLElement)) return;
  frame.style.viewTransitionName = HERO_NAME;
  publish(photoId);
  setTimeout(() => {
    frame.style.viewTransitionName = "";
    if (target === photoId) publish(null);
  }, LET_GO_AFTER_MS);
}

/** The style for a page's hero photo: the transition name while it is the photo that was tapped. */
export function useHeroName(photoId: string | undefined): CSSProperties | undefined {
  const named = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
    () => null,
  );
  return photoId && named === photoId ? { viewTransitionName: HERO_NAME } : undefined;
}
