import { Skeleton } from "@/components/ui/Skeleton";

/**
 * The slicing defaults before their code arrives: their rows of tiles (quality four across on desktop, two by two on
 * a phone; strength and supports three across) and More, so the page doesn't jump under a finger.
 */
export function SlicingDefaultsSkeleton() {
  return (
    <div className="bg-cream shadow-soft flex flex-col gap-7 rounded-lg p-4 md:p-5" aria-hidden>
      {[4, 3, 3].map((tiles, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed number of rows that never move.
        <div key={row} className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-20" />
          <div className={tiles === 4 ? "grid grid-cols-2 gap-2 md:grid-cols-4" : "grid grid-cols-3 gap-2"}>
            {Array.from({ length: tiles }, (_, tile) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed number of identical tiles.
              <Skeleton key={tile} className="h-24 rounded-lg md:h-22" />
            ))}
          </div>
          <Skeleton className="h-4 w-48" />
        </div>
      ))}
      <Skeleton className="h-12 rounded-md" />
    </div>
  );
}
