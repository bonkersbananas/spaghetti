import { type AnyRouter, type HistoryState, useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { previousPlace } from "./previous-path";

/** The page an idea or build was opened from: a page in this tab's history, with its name. */
export interface Origin {
  /** Its address, with what was in it (the Journal's filters, the search). */
  href: string;
  /** What the back control says: the page's heading as it was left ("Journal", "Search", another idea's title). */
  label: string;
  /** Its place in this tab's history (TanStack's `__TSR_index`). */
  index: number;
}

/**
 * Router state for a step to the next or previous thing of the same list (J and K): the page keeps the origin it had.
 * A cast because the router's HistoryState declares no fields of its own.
 */
export const keepOrigin = { keepOrigin: true } as HistoryState;

/** Router state for a page opened from outside the app's pages (a tapped notification): back goes to its list. */
export const openedDirectly = { openedDirectly: true } as HistoryState;

/** The pages that remember where they were opened from, by the thing they show (an idea and the build it becomes are one). */
const REMEMBERS = /^\/(?:ideas|builds|twists|pantry)\/([^/]+)\/?$/;

/** Each history entry's origin, by its key. Kept in memory only: a reload or a new tab starts from the list again. */
const origins = new Map<string, Origin | null>();
const listeners = new Set<() => void>();
let here: { key: string; href: string; path: string; index: number } | null = null;

interface EntryState {
  key?: string;
  __TSR_key?: string;
  __TSR_index: number;
  keepOrigin?: boolean;
  openedDirectly?: boolean;
}
interface Moved {
  href: string;
  pathname: string;
  state: unknown;
}
const keyOf = (state: EntryState) => state.__TSR_key ?? state.key ?? "";
const thingOf = (path: string) => REMEMBERS.exec(path)?.[1] ?? null;

/** The name of the page on screen (its heading: the section, an idea's title, a week), read as it is left. */
function nameOfPage(): string {
  const heading = [...document.querySelectorAll("h1")].find((h1) => !h1.closest("[role=dialog]"));
  return heading?.textContent?.trim() || "Back";
}

/**
 * Follows the tab's history: an idea or build opened from another page remembers that page (its address, name and
 * place in history), so its way back can return there. A step within the same thing (an attempt picked, a photo, the
 * idea that became a build, J and K) keeps the origin it had; a page opened directly (a link, a reload) has none.
 */
export function trackOrigins(router: AnyRouter) {
  const start: Moved = router.history.location;
  const startState = start.state as EntryState;
  here = { key: keyOf(startState), href: start.href, path: start.pathname, index: startState.__TSR_index };
  router.history.subscribe(({ location, action }: { location: Moved; action: { type: string } }) => {
    const before = here;
    const state = location.state as EntryState;
    const key = keyOf(state);
    here = { key, href: location.href, path: location.pathname, index: state.__TSR_index };
    // The page being left is still on screen: where it was scrolled to is kept for a step back to it.
    if (before && before.key !== key) scrolls.set(before.key, window.scrollY);
    const scrolled = scrolls.get(key);
    if (action.type !== "PUSH" && action.type !== "REPLACE" && scrolled) settleScroll(scrolled);
    const thing = thingOf(location.pathname);
    if (thing && !origins.has(key) && before && before.key !== key) {
      let origin: Origin | null = null;
      // Back or forward onto an entry from before a reload: where it came from isn't known.
      if ((action.type === "PUSH" || action.type === "REPLACE") && !state.openedDirectly) {
        // A replaced page is gone from history, so what replaced it inherits its origin too.
        const same = thingOf(before.path) === thing || action.type === "REPLACE" || state.keepOrigin;
        origin = same
          ? (origins.get(before.key) ?? null)
          : { href: before.href, label: nameOfPage(), index: before.index };
      }
      origins.set(key, origin);
    }
    for (const listener of listeners) listener();
  });
}

/** Where each history entry was scrolled to when it was left, by its key. */
const scrolls = new Map<string, number>();
/** What a person does that means "leave the scroll to me". */
const TAKING_OVER = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
let stopSettling = () => {};

/**
 * Brings a page stepped back to where it was scrolled. The router restores the position as soon as the move resolves,
 * but a step back slides the page away in a view transition, so the page it lands on is drawn a moment later: the
 * position was set on the page being left and cut short at its height (a long Journal came back near its top). For
 * up to a second, until the person scrolls or taps, the position is set again once the page is tall enough for it.
 */
function settleScroll(top: number) {
  stopSettling();
  const until = performance.now() + 1000;
  let frame = 0;
  const stop = () => {
    cancelAnimationFrame(frame);
    for (const type of TAKING_OVER) removeEventListener(type, stop, true);
  };
  const step = () => {
    if (performance.now() > until) return stop();
    const reachable = document.documentElement.scrollHeight - window.innerHeight >= top - 1;
    if (reachable && Math.abs(window.scrollY - top) > 1) window.scrollTo(0, top);
    frame = requestAnimationFrame(step);
  };
  for (const type of TAKING_OVER) addEventListener(type, stop, { capture: true, passive: true });
  frame = requestAnimationFrame(step);
  stopSettling = stop;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const originHere = () => (here ? (origins.get(here.key) ?? null) : null);

/** Where "back" goes from a detail page: by its control, Escape and pull-to-go. */
export interface BackTo {
  /** What the control says: the origin's name, else the list's. */
  label: string;
  /** Its address (for a new tab). */
  href: string;
  /** Whether it goes to where the page was opened from (else to the list). */
  fromOrigin: boolean;
  go: () => void;
}

/**
 * The way back from a detail page: to the page an idea or build was opened from, as it was left (a step back in
 * history keeps its scroll, filters and search), else to `list` (the other detail pages always go there).
 */
export function useBackTo(list: { to: string; label: string }): BackTo {
  const router = useRouter();
  const origin = useSyncExternalStore(subscribe, originHere);
  return {
    label: origin?.label ?? list.label,
    href: origin?.href ?? list.to,
    fromOrigin: !!origin,
    go: () => {
      const now = originHere();
      const index = (router.history.location.state as EntryState).__TSR_index;
      if (now && now.index < index) return router.history.go(now.index - index);
      if (now) return void router.navigate({ href: now.href });
      // From the list itself, back is a step back in history rather than a new page on top: the list is as it was,
      // and the back button doesn't walk the same two pages forever.
      if (previousPlace() === list.to) return router.history.back();
      void router.navigate({ to: list.to });
    },
  };
}
