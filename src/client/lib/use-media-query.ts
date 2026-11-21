import { startTransition, useEffect, useState, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Matches the md breakpoint (48rem = 768 px): the desktop layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 48rem)");
}

/**
 * Whether to offer the camera: any layout narrower than the desktop one, and any touch screen however wide (an iPhone
 * held sideways is 844+ px wide, an iPad 768+, and neither has a mouse: `capture` opens their camera). A desktop with a
 * mouse has no camera to open.
 */
export function useHasCamera(): boolean {
  const isDesktop = useIsDesktop();
  const touch = useMediaQuery("(pointer: coarse)");
  return !isDesktop || touch;
}

/** Matches the lg breakpoint (64rem = 1024 px): room for columns side by side beside the sidebar. */
export function useIsWide(): boolean {
  return useMediaQuery("(min-width: 64rem)");
}

// Here, not in a file of its own: every screen that uses it has this module in its first load already, and a file of
// its own costs the first load a chunk.
/** The history entries whose page has been shown already: going back to one restores its scroll, so it renders whole. */
const shown = new Set<string>();

/**
 * False for the first two frames of a page the person has just opened, true after (at once when it is a return to a
 * page already shown, where the router restores the scroll position and needs the page's full height). What a tap
 * needs goes in the first paint; what is below the fold or seldom looked at waits for `useAfterPaint()`.
 * Reads the history entry's key from `history.state` (where the router keeps it): a router hook would add a chunk to
 * the first load of every screen that uses this.
 */
export function useAfterPaint() {
  const key: string = history.state?.__TSR_key ?? location.href;
  const [after, setAfter] = useState(() => shown.has(key));
  useEffect(() => {
    shown.add(key);
    if (after) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => startTransition(() => setAfter(true)));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [key, after]);
  return after;
}
