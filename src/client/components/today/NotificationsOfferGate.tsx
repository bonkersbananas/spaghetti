import { lazy, Suspense, useEffect, useState } from "react";

const NotificationsOffer = lazy(() => import("./NotificationsOffer"));

/**
 * The offer's only part in a screen's first load: this gate. The card (and the push code under it) comes in its own
 * chunk a moment after the screen has shown, as only a person without push sees it and it waits at the bottom.
 */
export function NotificationsOfferGate({ className }: { className?: string }) {
  const [later, setLater] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLater(true), 1200);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className={className ?? "empty:hidden"}>
      {later && (
        <Suspense fallback={null}>
          <NotificationsOffer />
        </Suspense>
      )}
    </div>
  );
}
