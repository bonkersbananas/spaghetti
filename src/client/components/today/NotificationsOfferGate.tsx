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
export function NotificationsOfferGate({ className }: { className?: string }) {
  const [show] = useState(hinted);
  const [later, setLater] = useState(false);
  const [resolved, setResolved] = useState(false);
  const onResolved = useCallback(() => setResolved(true), []);
  useEffect(() => {
    const timer = setTimeout(() => setLater(true), 800);
    return () => clearTimeout(timer);
  }, []);
  const holding = show && !resolved;
  return (
    <div className={cn(className ?? "empty:hidden", holding && "min-h-24 md:min-h-[10.5rem]")}>
      {/* Not empty while the place is held, or the callers' empty:hidden would take it away. */}
      {holding && <span aria-hidden />}
      {later && (
        <Suspense fallback={null}>
          <NotificationsOffer show={show} onResolved={onResolved} />
        </Suspense>
      )}
    </div>
  );
}
