import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { moves, previousPlace } from "./previous-path";

/**
 * Where a detail page (an idea, a build, a twist, a spool) was opened from, read from what lib/previous-path.ts wrote
 * down about the tab's history. Loaded with the detail pages, not with every screen.
 */
export interface Origin {
  /** Its address, with what was in it (the Journal's filters, the search). */
  href: string;
  /** What the back control says: the page's heading as it was left ("Journal", "Search", another idea's title). */
  label: string;
  /** Its place in this tab's history. */
  index: number;
}

/** The detail pages, by the thing they show: an idea and the build it becomes are one. */
const THING = /^\/(?:ideas|builds|twists|pantry)\/([^/]+)\/?$/;
const thingOf = (path: string) => THING.exec(path)?.[1] ?? null;

const origins = new Map<string, Origin | null>();

/**
 * The page an entry was opened from. A step within the same thing (an attempt picked, a photo, the idea that became a
 * build, J and K) and a replaced page keep the origin they had; a page opened directly (a link, a reload, a tapped
 * notification) or reached by back and forward onto an entry from before a reload has none.
 */
function originOf(key: string): Origin | null {
  const known = origins.get(key);
  if (known !== undefined) return known;
  const move = moves.reached.get(key);
  const thing = move && thingOf(move.path);
  let origin: Origin | null = null;
  if (move && thing && !move.direct && (move.type === "PUSH" || move.type === "REPLACE")) {
    const same = thingOf(move.from.path) === thing || move.type === "REPLACE" || move.keep;
    origin = same ? originOf(move.from.key) : { href: move.from.href, label: move.label, index: move.from.index };
  }
  origins.set(key, origin);
  return origin;
}

const originHere = () => (moves.here ? originOf(moves.here.key) : null);

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

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

moves.after = (type) => {
  for (const listener of listeners) listener();
  const top = moves.here && moves.scrolls.get(moves.here.key);
  if (type !== "PUSH" && type !== "REPLACE" && top) settleScroll(top);
};

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
 * The way back from a detail page: to the page it was opened from, as it was left (a step back in history keeps its
 * scroll, filters and search), else to `list`.
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
      const index = moves.here?.index ?? 0;
      if (now && now.index < index) return router.history.go(now.index - index);
      if (now) return void router.navigate({ href: now.href });
      // From the list itself, back is a step back in history rather than a new page on top: the list is as it was,
      // and the back button doesn't walk the same two pages forever.
      if (previousPlace() === list.to) return router.history.back();
      void router.navigate({ to: list.to });
    },
  };
}
