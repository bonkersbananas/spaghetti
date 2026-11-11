import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * A tab or sidebar item that reads as picked the moment it is pressed, before the screen it leads to has rendered.
 * The router navigates inside a React transition, so the old screen (and the old selected item) stays until the new
 * one is ready; the press itself would paint nothing for as long as that takes. `press(to)` is an urgent update that
 * paints first, and the transition carries on after it. It lets go when the location changes, or after a moment if
 * the navigation never came (blocked, cancelled).
 */
export function usePendingNav() {
  const { pathname, status } = useRouterState({
    select: (state) => ({ pathname: state.location.pathname, status: state.status }),
  });
  const [pending, setPending] = useState<{ to: string; from: string } | null>(null);
  useEffect(() => {
    if (!pending) return;
    // The location changed: the real selection has taken over.
    if (pathname !== pending.from) return setPending(null);
    // Still loading: keep the pick as long as it takes. If the router never starts (a ctrl-click, a blocked
    // navigation), let go after a moment.
    if (status === "pending") return;
    const timer = setTimeout(() => setPending(null), 400);
    return () => clearTimeout(timer);
  }, [pending, pathname, status]);
  return {
    pendingTo: pending ? pending.to : null,
    press: (target: string, event?: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number }) => {
      // A click that opens a new tab or window doesn't navigate this one.
      if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
      setPending({ to: target, from: pathname });
    },
  };
}

/** Whether `to` is the section that the current (or pending) location belongs to. */
export function isSelected(to: string, pathname: string, pendingTo: string | null) {
  const place = pendingTo ?? pathname;
  return place === to || place.startsWith(`${to}/`);
}
