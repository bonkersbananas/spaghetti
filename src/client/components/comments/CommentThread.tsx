import { lazy, Suspense } from "react";

const Thread = lazy(() => import("./Thread"));

/** The thread at the foot of an idea or build. Its code loads on its own, after the page: nothing above the fold waits for it. */
export function CommentThread(props: { itemId: string; writeAsk: number; readOnly: boolean }) {
  return (
    <Suspense fallback={<div aria-hidden className="mt-12 h-12 md:mt-16" />}>
      <Thread {...props} />
    </Suspense>
  );
}
