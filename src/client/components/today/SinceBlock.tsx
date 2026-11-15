import { displayName } from "@shared/people";
import { catchUp, sinceLabel } from "@shared/since";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { BuildsIcon, IdeasIcon } from "@/components/ui/icons";
import { QuietRowContent, quietRowClass } from "@/components/ui/QuietRow";
import { Section } from "@/components/ui/Section";
import { journalQuery } from "@/lib/journal";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useSinceFrom } from "@/lib/since";

const everything = new URLSearchParams();
/** A catch-up reads this many pages of the journal at most. */
const MAX_PAGES = 5;

/**
 * "Since Thursday": after a few days away, what the other person did, at the top of Today (desktop) and of the
 * phone's Journal: one sentence, then the newest few things to open. It comes after a visit that followed a long
 * away and goes quiet half a day later; nothing when they did nothing. Their comments are Today's comment line.
 */
export default function SinceBlock() {
  const from = useSinceFrom();
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const journal = useInfiniteQuery(journalQuery(everything));
  // Newest first: read pages until one reaches back past the start (a few, at most), or the journal ends.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = journal;
  const pages = journal.data?.pages;
  const oldest = pages?.at(-1)?.entries.at(-1)?.at;
  const reaches = oldest !== undefined && from !== null && oldest <= from;
  const enough = reaches || (pages?.length ?? 0) >= MAX_PAGES;
  useEffect(() => {
    if (from !== null && pages && !enough && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [from, pages, enough, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const page = useMemo(
    () =>
      pages && {
        entries: pages.flatMap((p) => p.entries),
        items: pages.flatMap((p) => p.items),
      },
    [pages],
  );
  const other = people?.find((person) => person.id !== me?.id);
  const summary = useMemo(() => {
    if (from === null || !me || !page) return null;
    const items = new Map(page.items.map((item) => [item.id, item]));
    return catchUp(page.entries, items, { me: me.id, from, name: displayName(other, "They") });
  }, [from, me, page, other]);
  if (from === null || !summary) return null;
  const more = summary.total - summary.lines.length;
  const cut = !enough && hasNextPage;
  return (
    <Section id="since" title={sinceLabel(from, Date.now())} size="overline" className="mb-8">
      <p className="font-display text-title text-ink mb-2">{summary.sentence}</p>
      <div className="-my-1 flex flex-col">
        {summary.lines.map((line) => {
          const row = (
            <QuietRowContent key={line.key} icon={line.stage === "idea" ? IdeasIcon : BuildsIcon}>
              <span className="text-ink font-semibold">{line.title || "Untitled"}</span>
              <span> · {line.what}</span>
            </QuietRowContent>
          );
          return line.stage === "idea" ? (
            <Link key={line.key} to="/ideas/$ideaId" params={{ ideaId: line.itemId }} className={quietRowClass}>
              {row}
            </Link>
          ) : (
            <Link key={line.key} to="/builds/$buildId" params={{ buildId: line.itemId }} className={quietRowClass}>
              {row}
            </Link>
          );
        })}
      </div>
      {(more > 0 || cut) && <p className="text-small text-ink-faint mt-1">and {cut ? "more" : more} in the journal</p>}
    </Section>
  );
}
