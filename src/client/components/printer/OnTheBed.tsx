import type { Person } from "@shared/api";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { BedCards } from "@/components/builds/PrintingCard";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { printingAttempts } from "@/lib/builds";
import { useBuilds } from "@/lib/items";
import { printerQuery } from "@/lib/pantry-queries";
import { peopleQuery } from "@/lib/queries";
import { unreadQuery } from "@/lib/unread-comments";
import { useNow } from "@/lib/use-now";

/**
 * What is on the bed, at the top of the Printer page: the same `PrintingCard`s as Today and Builds (`BedCards`), or a
 * quiet line when the bed is empty. Lazy: the cards come with their own code, so the page's first load stays small.
 */
export function OnTheBed() {
  const { items, isPending } = useBuilds();
  const { data: people } = useQuery(peopleQuery);
  const byId = useMemo(() => new Map<string, Person>(people?.map((person) => [person.id, person])), [people]);
  const via = useVia();
  const now = useNow(60_000);
  const live = useQuery(printerQuery).data?.bridge?.progress;
  const threads = useQuery(unreadQuery).data?.threads;
  const unread = (itemId: string) => threads?.find((thread) => thread.itemId === itemId)?.count ?? 0;
  const prints = useMemo(() => printingAttempts(items, now, live), [items, now, live]);

  return (
    <Section
      id="printer-on-the-bed"
      title="On the bed"
      size="title"
      count={prints.length > 1 ? prints.length : undefined}
    >
      {isPending ? (
        <Skeleton className="h-28 rounded-lg" aria-hidden />
      ) : prints.length === 0 ? (
        <p className="text-body text-ink-soft">Nothing on the bed.</p>
      ) : (
        <BedCards prints={prints} people={byId} via={via} unread={unread} />
      )}
    </Section>
  );
}
