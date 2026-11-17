import { lazy, Suspense } from "react";

const UpkeepLine = lazy(() => import("./UpkeepLine"));
const CommentsLine = lazy(() => import("./CommentsLine"));

/**
 * What waits for you, in one place: the other person's new comment and the printer's chore due, as the two quiet
 * lines they are, side by side on a wide page (stacked on a narrow one) on one recessed wash, no shadow: a note on the
 * fridge, not a card, so the prints stay the first surface. Drawn only when a line is (`has-[a]`), so a day with
 * neither has no strip and no margin.
 */
export function NeedsYou({ comments, upkeep }: { comments: boolean; upkeep: boolean }) {
  return (
    <div className="bg-ink/4 mb-8 hidden flex-col rounded-lg px-3 py-0.5 has-[a]:flex lg:flex-row lg:gap-8 [&>*]:min-w-0 lg:[&>*]:flex-1">
      <Suspense fallback={null}>{comments && <CommentsLine bare counted />}</Suspense>
      <Suspense fallback={null}>{upkeep && <UpkeepLine />}</Suspense>
    </div>
  );
}
