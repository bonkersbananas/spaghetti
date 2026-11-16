import { cn } from "@/lib/cn";
import { SparkleIcon } from "./icons";

/**
 * Placeholder for content that is still loading. Mirror the real layout's
 * shapes; never show a full-page spinner.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("sg-skeleton", !className?.includes("rounded-") && "rounded-sm", className)} />;
}

/**
 * The title's line while Claude names an idea (decision 0071): Claude's sparkle, breathing, before a shimmer as long as
 * a short title, where the title will land; screen readers hear "Naming…". Cards and Journal rows show it.
 */
export function NamingSkeleton({ className }: { className?: string }) {
  return (
    <span role="status" className={cn("text-ink-faint flex min-h-6 items-center gap-1.5", className)}>
      <SparkleIcon size={14} weight="fill" aria-hidden className="sg-pulse shrink-0" />
      <span aria-hidden className="sg-skeleton block h-3.5 w-3/5 max-w-40 rounded-sm" />
      <span className="sr-only">Naming…</span>
    </span>
  );
}

const aspects = { landscape: "aspect-4/3", portrait: "aspect-4/5", square: "aspect-square" };

/** Skeleton of a photo Card, for grids that are loading. Match the Card's aspect. */
export function CardSkeleton({ aspect = "landscape" }: { aspect?: keyof typeof aspects }) {
  return (
    <div className="bg-cream shadow-soft flex flex-col gap-3 rounded-lg p-1.5" aria-hidden>
      <Skeleton className={cn("w-full rounded-md", aspects[aspect])} />
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
