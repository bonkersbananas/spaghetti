import type { Reaction } from "@shared/reactions";
import { lazy, Suspense } from "react";
import { cn } from "@/lib/cn";

const Lazy = lazy(() => import("./ItemReactions"));

/** An idea's or build's reactions. Its code loads after the page's own, holding its place meanwhile. */
export function ItemReactions(props: {
  itemId: string;
  reactions: readonly Reaction[] | undefined;
  noun: string;
  readOnly: boolean;
  className?: string;
}) {
  return (
    <Suspense fallback={<div aria-hidden className={cn("h-8", props.className)} />}>
      <Lazy {...props} />
    </Suspense>
  );
}
