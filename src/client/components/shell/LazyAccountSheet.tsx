import { lazy, Suspense, useState } from "react";
import { useWarmSoon } from "@/lib/warm-soon";

// The phone's account sheet (with the sheet library) loads just after the first screen, or at the first touch.
const loadAccountSheet = () => import("./AccountSheet");
const AccountSheet = lazy(() => loadAccountSheet().then((m) => ({ default: m.AccountSheet })));

export function LazyAccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [wanted, setWanted] = useState(open);
  if (open && !wanted) setWanted(true);
  useWarmSoon(loadAccountSheet);
  return wanted ? (
    <Suspense fallback={null}>
      <AccountSheet open={open} onOpenChange={onOpenChange} />
    </Suspense>
  ) : null;
}
