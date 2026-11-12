import { Skeleton } from "@/components/ui/Skeleton";

/** The Upkeep list before it arrives: about as tall as the six tasks it becomes, so the page doesn't jump under a finger. */
export function UpkeepSkeleton() {
  return (
    <div className="bg-cream shadow-soft flex flex-col gap-2 rounded-lg p-3" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed number of identical rows.
        <Skeleton key={index} className="h-20 w-full rounded-md" />
      ))}
    </div>
  );
}
