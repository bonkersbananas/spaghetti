import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { OFFER_HINT } from "./offer-hint";

const NotificationsOffer = lazy(() => import("./NotificationsOffer"));

const hinted = () => {
  try {
    return localStorage.getItem(OFFER_HINT) === "1";
  } catch {
    return false;
  }
};

/**
 * The offer's only part in a screen's first load: this gate. The card (and the push code under it) comes in its own
 * chunk a moment after the screen has shown. Nothing already drawn ever moves for it: when this device found last time
 * that the offer applies, the card's place is kept from the first paint (the card fills it, or the place closes if it
 * no longer applies); otherwise the card waits for the next visit.
 */
export function NotificationsOfferGate({
  className,
  layout = "card",
}: {
  className?: string;
  /** The offer's shape (NotificationOffer's `layout`): the place held for it is its height. */
  layout?: "card" | "line";
}) {
  const [show] = useState(hinted);
  const [later, setLater] = useState(false);
  const [resolved, setResolved] = useState(false);
  const onResolved = useCallback(() => setResolved(true), []);
  useEffect(() => {
    // Its chunk and its push fetch share a slow phone's link with whatever the person opens first (the palette's code
    // after a ⌘K): they start once the browser is idle, not at a fixed moment after the screen. The place is held
    // already, so nothing moves whenever the card arrives.
    let idle = 0;
    let wait = 0;
    const timer = setTimeout(() => {
      const start = () => setLater(true);
      if ("requestIdleCallback" in window) idle = requestIdleCallback(start, { timeout: 5000 });
      else wait = setTimeout(start, 3000) as unknown as number;
    }, 800);
    return () => {
      clearTimeout(timer);
      clearTimeout(wait);
      if (idle && "cancelIdleCallback" in window) cancelIdleCallback(idle);
    };
  }, []);
  const holding = show && !resolved;
  return (
    <div
      className={cn(
        className ?? "empty:hidden",
        holding && (layout === "line" ? "min-h-11" : "min-h-24 md:min-h-[10.5rem]"),
      )}
    >
      {/* Not empty while the place is held, or the callers' empty:hidden would take it away. */}
      {holding && <span aria-hidden />}
      {later && (
        <Suspense fallback={null}>
          <NotificationsOffer show={show} onResolved={onResolved} layout={layout} />
        </Suspense>
      )}
    </div>
  );
}
