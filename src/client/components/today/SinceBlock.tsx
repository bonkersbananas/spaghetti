import { displayName } from "@shared/people";
import { catchUp, sinceLabel } from "@shared/since";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { BuildsIcon, IdeasIcon } from "@/components/ui/icons";
import { QuietRowContent, quietRowClass } from "@/components/ui/QuietRow";
import { Section } from "@/components/ui/Section";
import { journalQuery } from "@/lib/journal";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useSinceFrom } from "@/lib/since";

const everything = new URLSearchParams();

/**
 * "Since Thursday": after a few days away, what the other person did, at the top of Today (desktop) and of the
 * phone's Journal: one sentence, then the newest few things to open. It comes after a visit that followed a long
 * away and goes quiet half a day later; nothing when they did nothing. Their comments are Today's comment line.
 */
export default function SinceBlock() {
  const from = useSinceFrom();
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const page = useInfiniteQuery(journalQuery(everything)).data?.pages[0];
  const other = people?.find((person) => person.id !== me?.id);
  const summary = useMemo(() => {
    if (from === null || !me || !page) return null;
    const items = new Map(page.items.map((item) => [item.id, item]));
    return catchUp(page.entries, items, { me: me.id, from, name: displayName(other, "They") });
  }, [from, me, page, other]);
  if (from === null || !summary) return null;
  const more = summary.total - summary.lines.length;
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
      {more > 0 && <p className="text-small text-ink-faint mt-1">and {more} more in the journal</p>}
    </Section>
  );
}
