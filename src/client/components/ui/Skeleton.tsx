import { cn } from "@/lib/cn";

/**
 * Placeholder for content that is still loading. Mirror the real layout's
 * shapes; never show a full-page spinner.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("sg-skeleton", !className?.includes("rounded-") && "rounded-sm", className)} />;
}

/** Skeleton of a photo Card, for grids that are loading. */
export function CardSkeleton() {
  return (
    <div className="bg-cream shadow-soft flex flex-col gap-3 rounded-lg p-2" aria-hidden>
      <Skeleton className="aspect-4/3 w-full rounded-md" />
      <div className="flex flex-col gap-2 px-2 pb-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/** Skeleton of a list row: avatar, two lines. */
export function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 py-3" aria-hidden>
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-2/5" />
        <Skeleton className="h-3 w-3/5" />
      </div>
    </div>
  );
}
