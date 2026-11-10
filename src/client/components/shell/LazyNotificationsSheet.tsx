import { lazy, Suspense, useState } from "react";

// The settings sheet (and the push code behind it) loads when it is first opened, not with every first screen.
const NotificationsSheet = lazy(() => import("./NotificationsSheet").then((m) => ({ default: m.NotificationsSheet })));

export function LazyNotificationsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  return wanted ? (
    <Suspense fallback={null}>
      <NotificationsSheet open={open} onOpenChange={onOpenChange} />
    </Suspense>
  ) : null;
}
