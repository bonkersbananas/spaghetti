import type { Item } from "@shared/api";
import { displayName } from "@shared/people";
import { catchUp, sinceLabel } from "@shared/since";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { coverPhoto } from "@/components/ui/Card";
import { MiniCard } from "@/components/ui/MiniCard";
import { Reflow } from "@/components/ui/Reflow";
import { Section } from "@/components/ui/Section";
import { askingAttempts, printingAttempts } from "@/lib/builds";
import { useBuilds } from "@/lib/items";
import { journalQuery } from "@/lib/journal";
import { coverOf } from "@/lib/previews";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useSinceFrom } from "@/lib/since";

const everything = new URLSearchParams();
/** A catch-up reads this many pages of the journal at most. */
const MAX_PAGES = 5;

/**
 * "Since Thursday": after a few days away, what the other person did, at the top of Today (desktop) and of the
 * phone's Journal: a short sentence, then the things themselves as photo cards, each once with its latest news.
 * It comes after a visit that followed a long away and goes quiet half a day later; nothing when they did nothing.
 * Their comments are Today's comment line.
 */
export default function SinceBlock() {
  const from = useSinceFrom();
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const journal = useInfiniteQuery(journalQuery(everything));
  // Newest first: read pages until one reaches back past the start (a few, at most), or the journal ends.
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = journal;
  const pages = journal.data?.pages;
  const oldest = pages?.at(-1)?.entries.at(-1)?.at;
  const reaches = oldest !== undefined && from !== null && oldest <= from;
  const enough = reaches || (pages?.length ?? 0) >= MAX_PAGES;
  useEffect(() => {
    if (from !== null && pages && !enough && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [from, pages, enough, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const page = useMemo(
    () => pages && { entries: pages.flatMap((p) => p.entries), items: pages.flatMap((p) => p.items) },
    [pages],
  );
  // What is on the bed is already shown above or beside this (Now, In the printer): left out of the cards, so
  // the strip fills with the others instead.
  const builds = useBuilds();
  // So is an answered print still asking which build it is: it keeps its card there until it is placed.
  const onBed = useMemo(
    () => new Set([...printingAttempts(builds.items), ...askingAttempts(builds.items)].map(({ item }) => item.id)),
    [builds.items],
  );
  const other = people?.find((person) => person.id !== me?.id);
  const summary = useMemo(() => {
    if (from === null || !me || !page) return null;
    const items = new Map(page.items.map((item) => [item.id, item]));
    return catchUp(page.entries, items, { me: me.id, from, name: displayName(other, "They"), skip: onBed });
  }, [from, me, page, other, onBed]);
  if (from === null || !summary) return null;
  const more = summary.total - summary.lines.length;
  const cut = !enough && hasNextPage;
  return (
    <Section id="since" title={sinceLabel(from, Date.now())} size="overline" className="mb-8">
      <p className="font-display text-lead text-ink md:text-title mb-3">{summary.sentence}</p>
      {summary.lines.length > 0 && (
        <ul className="relative grid grid-cols-3 gap-3 md:flex">
          <Reflow>
            {summary.lines.map((line) => {
              const item = line.item;
              // The cover its page and cards show: the best photo, else the newest plate picture, else the note card.
              const cover = coverOf(item);
              return (
                <MiniCard
                  key={line.itemId}
                  fill
                  link={
                    line.stage === "idea"
                      ? { to: "/ideas/$ideaId", params: { ideaId: line.itemId } }
                      : { to: "/builds/$buildId", params: { buildId: line.itemId } }
                  }
                  photo={coverPhoto(cover, "")}
                  note={cover.kind === "note" ? cover.text : item.note || undefined}
                  // A thing with neither a photo nor a note has its name on the index card, once.
                  title={cover.kind === "note" && cover.fromTitle ? undefined : line.title}
                  sub={line.what}
                />
              );
            })}
          </Reflow>
        </ul>
      )}
      {(more > 0 || cut) && (
        <p className="text-small text-ink-faint mt-2">
          {cut ? "and more in the journal" : `and ${more} more in the journal`}
        </p>
      )}
    </Section>
  );
}
