import type { ScoutPick } from "@shared/scout";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { ScoutCard } from "@/components/ui/ScoutCard";
import { Section } from "@/components/ui/Section";
import { duration, ease } from "@/lib/motion";
import { scoutHeading, scoutPictureUrl, useScout, useScoutFetched, waitingPicks } from "@/lib/scout";
import { dismissPick, keepPick, undoDismiss, undoKeep } from "@/lib/scout-actions";

/** The row of cards: a swipeable row with the next card peeking on phones, three columns from md. */
function Cards({ picks: current, round }: { picks: ScoutPick[]; round: "today" | "week" }) {
  const queryClient = useQueryClient();
  // The ones still waiting come first when the row appears with the page's own answer; after that the order stays,
  // so a card never jumps away from under a tap.
  const waitingFirst = () =>
    [...current]
      .sort((x, y) => Number(y.status === "suggested") - Number(x.status === "suggested"))
      .map((pick) => pick.id);
  const fresh = useScoutFetched();
  const [order, setOrder] = useState(waitingFirst);
  const ordered = useRef(fresh);
  useEffect(() => {
    if (fresh && !ordered.current) {
      ordered.current = true;
      setOrder(waitingFirst());
    }
  });
  const picks = [...current].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return (
    <ul className="no-scrollbar relative -mx-5 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-1 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:overflow-visible md:px-0 md:pb-0">
      <AnimatePresence initial={false}>
        {picks.map((pick) => (
          <m.li
            key={pick.id}
            layout="position"
            exit={{ opacity: 0, scale: 0.97, transition: { duration: duration.base, ease: ease.inOut } }}
            className="w-4/5 shrink-0 snap-start md:w-auto"
          >
            <ScoutCard
              title={pick.title}
              url={pick.url}
              siteName={pick.siteName}
              picture={scoutPictureUrl(pick)}
              why={pick.why}
              state={round === "today" ? "suggested" : pick.status}
              onKeep={() => keepPick(queryClient, pick)}
              onDismiss={() => dismissPick(queryClient, pick)}
              onUndo={() => (pick.status === "kept" ? undoKeep(queryClient, pick) : undoDismiss(queryClient, pick))}
              keptLink={
                pick.itemId ? (
                  <Link
                    to="/ideas/$ideaId"
                    params={{ ideaId: pick.itemId }}
                    className="focus-ring decoration-ink/30 rounded-xs underline underline-offset-2"
                  >
                    Kept as an idea
                  </Link>
                ) : undefined
              }
            />
          </m.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/**
 * The idea scout's three (decision 0040). On Today it is a calm block of the suggestions still waiting, drawn only
 * when there are some; on this week's page it also shows what was kept or put away, with a way back, and says when
 * the scout is looking or hasn't been out yet. Lazy: Today and the week page load it after themselves.
 */
export default function ScoutSection({ where, showEmpty = true }: { where: "today" | "week"; showEmpty?: boolean }) {
  const round = useScout();
  if (!round) return null;
  const waiting = waitingPicks(round);

  if (where === "today") {
    if (waiting.length === 0) return null;
    return (
      <Section
        id="today-scout"
        title={scoutHeading(waiting.length)}
        size="overline"
        description={<ClaudeLine>Picked by Claude from your wishlists</ClaudeLine>}
      >
        <Cards picks={waiting} round="today" />
      </Section>
    );
  }

  if (round.state === "thinking") {
    return (
      <section aria-label="The scout">
        <ClaudeLine working>The scout is looking for three models…</ClaudeLine>
      </section>
    );
  }
  if (round.picks.length === 0) {
    if (!showEmpty) return null;
    return (
      <Section id="week-scout" title="This week's three" size="overline">
        <ClaudeLine>The scout is out shopping: three models to print land here on Monday mornings.</ClaudeLine>
      </Section>
    );
  }
  return (
    <Section
      id="week-scout"
      title="This week's three"
      size="overline"
      description={<ClaudeLine>Picked by Claude from your wishlists</ClaudeLine>}
    >
      <Cards picks={round.picks} round="week" />
    </Section>
  );
}
