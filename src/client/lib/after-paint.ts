import { useRouterState } from "@tanstack/react-router";
import { startTransition, useEffect, useState } from "react";

/** The history entries whose page has been shown already, by screen: going back to one restores its scroll, so it renders whole. */
const shown = new Set<string>();

/**
 * False for the first two frames of a page the person has just opened, true after (at once when it is a return to a
 * page already shown, where the router restores the scroll position and needs the page's full height). What a tap
 * needs goes in the first paint; what is below the fold or seldom looked at waits for `useAfterPaint(screen)`.
 */
export function useAfterPaint(screen: string) {
  const key = useRouterState({
    select: (state) => `${screen}:${String(state.location.state.__TSR_key ?? state.location.href)}`,
  });
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
