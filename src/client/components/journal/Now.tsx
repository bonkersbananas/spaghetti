import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { lazy, Suspense, useMemo } from "react";
import { PrintingCard } from "@/components/builds/PrintingCard";
import { Section } from "@/components/ui/Section";
import { useVia } from "@/lib/agents";
import { printingAttempts } from "@/lib/builds";
import { useBuilds } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { printerQuery } from "@/lib/pantry-queries";
import { peopleQuery } from "@/lib/queries";
import { useScout, waitingPicks } from "@/lib/scout";
import { useDueUpkeep } from "@/lib/upkeep";
import { useNow } from "@/lib/use-now";

const UpkeepLine = lazy(() => import("@/components/today/UpkeepLine"));
const CommentsLine = lazy(() => import("@/components/today/CommentsLine"));
const ScoutRow = lazy(() => import("@/components/scout/ScoutRow"));

/**
 * What is happening now, at the top of the phone's Journal (it replaces the Today tab): under a "Now" label, the prints on the
 * bed (all compact, with the camera and Finish, so the journal still starts on the first screen), the other person's new comments, upkeep that is
 * due and the scout's picks when they are new. Each part is drawn only when it has something to say, so a quiet
 * day has no block at all and the journal starts at the top.
 */
export default function Now() {
  const reduce = useReducedMotion();
  const now = useNow(60_000);
  const builds = useBuilds();
  const via = useVia();
  const { data: people } = useQuery(peopleQuery);
  const live = useQuery(printerQuery).data?.bridge?.progress;
  const hasDueUpkeep = useDueUpkeep().length > 0;
  const hasScoutPicks = waitingPicks(useScout()).length > 0;
  const onBed = useMemo(() => printingAttempts(builds.items, now, live), [builds.items, now, live]);

  return (
    // The whole block is hidden (and takes no margin with it) while none of its parts has anything to show.
    <Section id="now" title="Now" size="overline" className="mb-8 [&:not(:has(.now-parts>:not(:empty)))]:hidden">
      <div className="now-parts flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {onBed.length > 0 && (
            <m.div
              key="bed"
              exit={{ opacity: 0, transition: { duration: reduce ? 0 : duration.base, ease: ease.inOut } }}
            >
              {/* All compact (a small square picture beside the name): the journal must still start on the first screen. */}
              <section aria-label="On the bed" className="flex flex-col gap-3">
                <AnimatePresence initial={false}>
                  {onBed.map(({ item, attempt }) => (
                    <m.div
                      key={attempt.id}
                      exit={{
                        opacity: 0,
                        height: 0,
                        overflow: "hidden",
                        transition: reduce ? { duration: 0 } : { duration: duration.base, ease: ease.inOut },
                      }}
                    >
                      <PrintingCard
                        compact
                        item={item}
                        attempt={attempt}
                        person={people?.find((person) => person.id === attempt.createdBy)}
                        via={via(attempt.createdVia)}
                      />
                    </m.div>
                  ))}
                </AnimatePresence>
              </section>
            </m.div>
          )}
        </AnimatePresence>
        {/* The two quiet lines sit together: each row already has its own 44 px of room. */}
        <div className="-my-1 empty:hidden">
          <Suspense fallback={null}>
            <CommentsLine bare />
          </Suspense>
          {hasDueUpkeep && (
            <Suspense fallback={null}>
              <UpkeepLine />
            </Suspense>
          )}
        </div>
        <div className="empty:hidden">
          {hasScoutPicks && (
            <Suspense fallback={null}>
              <ScoutRow />
            </Suspense>
          )}
        </div>
      </div>
    </Section>
  );
}
