import type { Reaction } from "@shared/reactions";
import { lazy, Suspense } from "react";
import { cn } from "@/lib/cn";

const Thread = lazy(() => import("./Thread"));
// The same chunk as the thread, which both pages fetch anyway: a lazy module of its own would add to the preload map
// every screen's first load carries.
const Reactions = lazy(() => import("./Thread").then((thread) => ({ default: thread.ItemReactions })));

/** The thread of an idea or build (the page places it; it has no margin of its own). Its code loads on its own, after the page: nothing above the fold waits for it. */
export function CommentThread(props: { itemId: string; writeAsk: number; readOnly: boolean; className?: string }) {
  return (
    <Suspense fallback={<div aria-hidden className={cn("h-12", props.className)} />}>
      <Thread {...props} />
    </Suspense>
  );
}

/** An idea's or build's reactions (components/reactions/ItemReactions), loaded with the thread's code; it holds its place meanwhile. */
export function ItemReactions(props: {
  itemId: string;
  reactions: readonly Reaction[] | undefined;
  noun: string;
  readOnly: boolean;
  className?: string;
}) {
  return (
    <Suspense fallback={<div aria-hidden className={cn("h-8", props.className)} />}>
      <Reactions {...props} />
    </Suspense>
  );
}
