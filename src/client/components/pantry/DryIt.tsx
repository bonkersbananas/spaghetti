import type { Spool } from "@shared/api";
import { lazy, Suspense } from "react";
import { useIdle } from "@/lib/use-idle";

const View = lazy(() => import("./DryItView"));

/** "Dry it before printing" once the spool is known to be past its window: its rules load from an idle moment. */
export function DryIt(props: {
  spool: Pick<Spool, "material" | "driedAt" | "createdAt" | "remaining">;
  className?: string;
  compact?: boolean;
}) {
  if (!useIdle()) return null;
  return (
    <Suspense fallback={null}>
      <View {...props} />
    </Suspense>
  );
}
