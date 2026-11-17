import { lazy, Suspense } from "react";

const UpkeepLine = lazy(() => import("./UpkeepLine"));
const CommentsLine = lazy(() => import("./CommentsLine"));

/**
 * What waits for you, in one place: the other person's new comment and the printer's chore due, as the two quiet
 * lines they are, held by one soft surface under the date (a note on the fridge, not two stray lines). The surface
 * is drawn only when a line is (`has-[a]`), so a day with neither has no strip and no margin.
 */
export function NeedsYou({ comments, upkeep }: { comments: boolean; upkeep: boolean }) {
  return (
    <div className="bg-cream shadow-soft [&>*+*]:border-ink/6 mb-8 hidden flex-col rounded-lg px-4 py-1 has-[a]:flex md:px-5 [&>*+*]:border-t">
      <Suspense fallback={null}>{comments && <CommentsLine bare counted />}</Suspense>
      <Suspense fallback={null}>{upkeep && <UpkeepLine />}</Suspense>
    </div>
  );
}
