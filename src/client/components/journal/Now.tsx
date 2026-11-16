import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { use, useMemo } from "react";
import { PrintingCard } from "@/components/builds/PrintingCard";
import ScoutRow from "@/components/scout/ScoutRow";
import CommentsLine from "@/components/today/CommentsLine";
import UpkeepLine from "@/components/today/UpkeepLine";
import { Section } from "@/components/ui/Section";
import { useVia } from "@/lib/agents";
import { printingAttempts } from "@/lib/builds";
import { featuresQuery } from "@/lib/features";
import { useBuilds } from "@/lib/items";
import { duration, ease } from "@/lib/motion";
import { printerQuery } from "@/lib/pantry-queries";
import { peopleQuery } from "@/lib/queries";
import { scoutQuery, useScout, waitingPicks } from "@/lib/scout";
import { unreadQuery } from "@/lib/unread-comments";
import { upkeepQuery, useDueUpkeep } from "@/lib/upkeep";
import { useNow } from "@/lib/use-now";

/**
 * What is happening now, at the top of the phone's Journal (it replaces the Today tab): under a "Now" label, the prints on the
 * bed (all compact, with the camera and Finish, so the journal still starts on the first screen), the other person's new comments, upkeep that is
 * due and the scout's picks when they are new. Each part is drawn only when it has something to say, so a quiet
 * day has no block at all and the journal starts at the top. The block is itself loaded lazily, so its parts come with it
 * (not each lazily on its own): the Journal shows it and the notebook under it together, and nothing arrives after.
 */
export default function Now() {
  useFirstAnswers(useQueryClient());
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
          <CommentsLine bare />
          {hasDueUpkeep && <UpkeepLine />}
        </div>
        <div className="empty:hidden">{hasScoutPicks && <ScoutRow />}</div>
      </div>
    </Section>
  );
}

/** How long a first visit waits for the quiet lines' answers before the block shows without them. */
const FIRST_ANSWERS_MS = 1000;
let firstAnswers: Promise<unknown> | undefined;

/**
 * On a first visit (nothing kept on this device yet) the block waits a moment for what its quiet lines draw from, so
 * they don't arrive after it and push the notebook down; the Journal shows a skeleton meanwhile. Answers kept from last
 * time (the usual case) wait for nothing, and neither does a phone that is offline.
 */
function useFirstAnswers(queryClient: QueryClient) {
  const missing = [unreadQuery, upkeepQuery, featuresQuery].some(
    (query) => queryClient.getQueryData(query.queryKey) === undefined,
  );
  if (!missing || !navigator.onLine) return;
  firstAnswers ??= Promise.race([
    Promise.allSettled([
      queryClient.fetchQuery(unreadQuery),
      queryClient.fetchQuery(upkeepQuery),
      queryClient
        .fetchQuery(featuresQuery)
        .then((features) => (features.scout ? queryClient.fetchQuery(scoutQuery) : null)),
    ]),
    new Promise((resolve) => setTimeout(resolve, FIRST_ANSWERS_MS)),
  ]);
  use(firstAnswers);
}
