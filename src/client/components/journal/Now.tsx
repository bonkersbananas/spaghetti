import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { use, useMemo } from "react";
import { PrintingCard } from "@/components/builds/PrintingCard";
import { Since } from "@/components/today/Since";
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

/**
 * What is happening now, at the top of the phone's Journal (it replaces the Today tab): under a "Now" label, the prints on the
 * bed (all compact, with the camera and Finish, so the journal still starts on the first screen), the other person's new comments, upkeep that is
 * due and the scout's picks when they are new. Each part is drawn only when it has something to say, so a quiet
 * day has no block at all and the journal starts at the top. The Journal shows it and the notebook under it together, and
 * it shows with all its parts (see useLines), so nothing arrives after and pushes the page down.
 */
export default function Now() {
  const { CommentsLine, UpkeepLine, ScoutRow } = useLines(useQueryClient());
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
    <>
      {/* The catch-up after a while away sits above Now. Here rather than in the Journal, so its gate stays out of the
          Journal's first load (desktop never shows it there) and arrives with the rest of the block. */}
      <Since />
      {/* The whole block is hidden (and takes no margin with it) while none of its parts has anything to show. */}
      <Section id="now" title="Now" size="overline" className="mb-8 [&:not(:has(.now-parts>:not(:empty)))]:hidden">
        <div className="now-parts flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {onBed.length > 0 && (
              <m.div
                key="bed"
                exit={{ opacity: 0, transition: { duration: reduce ? 0 : duration.base, ease: ease.inOut } }}
              >
                {/* All alike: a wide picture with the Printing badge, then the name and the time left; the journal starts below them. */}
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
                          lead={onBed.length > 1 ? "short" : "wide"}
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
    </>
  );
}

type Lines = typeof import("./NowLines");
let lines: Lines | undefined;
/** Resolves once the lines' code is here: now-code.ts waits for it, so the block never suspends for it. */
export const loadingLines = import("./NowLines").then((module) => {
  lines = module;
  return module;
});
let waiting: Promise<unknown> | undefined;

/**
 * The quiet lines, asked for as this module runs: the block waits for their code, and on a first visit a moment for
 * their answers, before it first shows. Once both are here (every visit after the first) it waits for nothing.
 */
function useLines(queryClient: QueryClient): Lines {
  if (lines && !lines.missingAnswers(queryClient)) return lines;
  waiting ??= loadingLines.then((module) => module.firstAnswers(queryClient));
  use(waiting);
  return lines as Lines;
}
