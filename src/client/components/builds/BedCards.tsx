import type { Person } from "@shared/api";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { AutoHeight } from "@/components/ui/AutoHeight";
import { cn } from "@/lib/cn";
import type { AttemptView, ItemView } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { useIsDesktop } from "@/lib/use-media-query";
import { PrintingCard } from "./PrintingCard";

interface BedCardsProps {
  /** What is physically on the plate: printing, or off the bed and waiting for "how did it go?" (`printingAttempts`). */
  prints: Array<{ item: ItemView; attempt: AttemptView }>;
  people: ReadonlyMap<string, Person>;
  via: (createdVia: string | null | undefined) => string | undefined;
  /** Two cards side by side from `lg` (the Builds list, which has the whole width); Today's column keeps one. */
  pair?: boolean;
  className?: string;
}

/**
 * The prints on the bed as `PrintingCard`s, on Today and at the top of Builds. On phones the first is the big card and
 * the ones after it are compact, so three prints don't push the page two screens down. A print that gets its answer
 * fades and collapses while the others move up, and the next one grows into the big card; with reduced motion
 * everything is at its end state at once.
 */
export function BedCards({ prints, people, via, pair = false, className }: BedCardsProps) {
  const reduce = useReducedMotion();
  const isDesktop = useIsDesktop();
  return (
    <div className={cn("flex flex-col", pair && "lg:grid lg:grid-cols-2 lg:gap-5", className)}>
      <AnimatePresence initial={false}>
        {prints.map(({ item, attempt }, index) => (
          <m.div
            key={attempt.id}
            // The space under a card is its own padding, so a card that leaves takes its gap with it (in the pair
            // grid the gap is the grid's).
            className={cn("pb-4 last:pb-0", pair && "lg:pb-0")}
            exit={{
              opacity: 0,
              height: 0,
              paddingBottom: 0,
              overflow: "hidden",
              // Faded before the collapse shows a clipped slice of it.
              transition: reduce
                ? { duration: 0 }
                : { duration: duration.base, ease: ease.inOut, opacity: { duration: duration.fast } },
            }}
          >
            <AutoHeight trigger={isDesktop ? "row" : index > 0}>
              <PrintingCard
                compact={index > 0}
                item={item}
                attempt={attempt}
                person={people.get(attempt.createdBy)}
                via={via(attempt.createdVia)}
              />
            </AutoHeight>
          </m.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
