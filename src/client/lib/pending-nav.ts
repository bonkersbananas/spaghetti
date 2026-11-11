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
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [pending, setPending] = useState<{ to: string; from: string } | null>(null);
  const to = pending && pending.from === pathname ? pending.to : null;
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), 1500);
    return () => clearTimeout(timer);
  }, [pending]);
  return { pendingTo: to, press: (target: string) => setPending({ to: target, from: pathname }) };
}

/** Whether `to` is the section that the current (or pending) location belongs to. */
export function isSelected(to: string, pathname: string, pendingTo: string | null) {
  const place = pendingTo ?? pathname;
  return place === to || place.startsWith(`${to}/`);
}
