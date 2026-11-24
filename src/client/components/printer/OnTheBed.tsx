import type { Person } from "@shared/api";
import { creditedTo } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { PrintingCard } from "@/components/builds/PrintingCard";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { printingAttempts } from "@/lib/builds";
import { useBuilds } from "@/lib/items";
import { printerQuery } from "@/lib/pantry-queries";
import { peopleQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { useNow } from "@/lib/use-now";

/**
 * What the printer is printing now, at the top of the Printer page: the print as one compact `PrintingCard` (the same
 * card as Today and Builds), or "Nothing printing." The X2D prints one at a time. Prints it stopped that nobody has
 * answered don't get cards here (that is Today's job): at most one quiet line says how many wait, and where. Lazy:
 * the card comes with its own code, so the page's first load stays small.
 */
export function OnTheBed() {
  const { items, isPending } = useBuilds();
  const { data: people } = useQuery(peopleQuery);
  const byId = useMemo(() => new Map<string, Person>(people?.map((person) => [person.id, person])), [people]);
  const via = useVia();
  const now = useNow(60_000);
  const live = useQuery(printerQuery).data?.bridge?.progress;
  const isDesktop = useIsDesktop();
  const onBed = useMemo(() => printingAttempts(items, now, live), [items, now, live]);
  const printing = onBed.find(({ attempt }) => !isOffTheBed(attempt));
  const waiting = onBed.filter(({ attempt }) => isOffTheBed(attempt)).length;

  return (
    <Section id="printer-printing" title="Printing now" size="title">
      {isPending ? (
        <Skeleton className="h-28 rounded-lg" aria-hidden />
      ) : (
        <>
          {printing ? (
            <PrintingCard
              compact
              item={printing.item}
              attempt={printing.attempt}
              person={byId.get(creditedTo(printing.attempt) ?? "")}
              via={via(printing.attempt.createdVia)}
            />
          ) : (
            <p className="text-body text-ink-soft">Nothing printing.</p>
          )}
          {waiting > 0 && (
            <Link
              to={isDesktop ? "/today" : "/journal"}
              className="focus-ring text-small text-ink-soft hover:text-ink min-h-11 self-start rounded-sm py-2.5"
            >
              {waiting} waiting for how {waiting === 1 ? "it" : "they"} went
            </Link>
          )}
        </>
      )}
    </Section>
  );
}
