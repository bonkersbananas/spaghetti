import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { lazy, type ReactNode, Suspense, useMemo } from "react";
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
 * What is happening now, at the top of the phone's Journal (it replaces the Today tab): the prints on the bed (the
 * first one big, the rest compact, with the camera and Finish), the other person's new comments, upkeep that is
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
    <div className="mb-8 flex flex-col gap-5 empty:hidden">
      <AnimatePresence initial={false}>
        {onBed.length > 0 && (
          <m.div
            key="bed"
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : duration.base, ease: ease.inOut } }}
          >
            <Block count={onBed.length}>
              <div className="flex flex-col gap-3">
                <AnimatePresence initial={false}>
                  {onBed.map(({ item, attempt }, index) => (
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
                        compact={index > 0}
                        shallow
                        item={item}
                        attempt={attempt}
                        person={people?.find((person) => person.id === attempt.createdBy)}
                        via={via(attempt.createdVia)}
                      />
                    </m.div>
                  ))}
                </AnimatePresence>
              </div>
            </Block>
          </m.div>
        )}
      </AnimatePresence>
      <div className="flex flex-col gap-2 empty:hidden">
        <Suspense fallback={null}>
          <CommentsLine bare />
        </Suspense>
        {hasDueUpkeep && (
          <Suspense fallback={null}>
            <UpkeepLine />
          </Suspense>
        )}
      </div>
      {hasScoutPicks && (
        <Suspense fallback={null}>
          <ScoutRow />
        </Suspense>
      )}
    </div>
  );
}

/** The prints' block: a small label that counts when there are several; one print says "Printing" on its own card. */
function Block({ count, children }: { count: number; children: ReactNode }) {
  return count > 1 ? (
    <Section id="now-bed" title="On the bed" size="overline" count={count}>
      {children}
    </Section>
  ) : (
    <section aria-label="On the bed">{children}</section>
  );
}
