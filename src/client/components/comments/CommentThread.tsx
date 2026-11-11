import { lazy, Suspense } from "react";
import { cn } from "@/lib/cn";

const Thread = lazy(() => import("./Thread"));

/** The thread of an idea or build (the page places it; it has no margin of its own). Its code loads on its own, after the page: nothing above the fold waits for it. */
export function CommentThread(props: { itemId: string; writeAsk: number; readOnly: boolean; className?: string }) {
  return (
    <Suspense fallback={<div aria-hidden className={cn("h-12", props.className)} />}>
      <Thread {...props} />
    </Suspense>
  );
}
