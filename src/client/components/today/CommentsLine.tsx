import { unreadLine } from "@shared/comments";
import { displayName } from "@shared/people";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CommentIcon } from "@/components/ui/icons";
import { QuietRowContent, quietRowClass } from "@/components/ui/QuietRow";
import { Section } from "@/components/ui/Section";
import { peopleQuery } from "@/lib/queries";
import { unreadQuery } from "@/lib/unread-comments";

/**
 * One quiet line when the other person wrote something you haven't read: "Marie on Tugboat: Started it tonight…",
 * under a label that counts them when there are several, leading to the thread with that comment lit. Nothing when all is read.
 * It sits under what is on the bed, a block of its own under a quiet label: a note on the fridge, not a notification.
 */
export default function CommentsLine({ bare = false }: { bare?: boolean }) {
  const { data } = useQuery(unreadQuery);
  const { data: people } = useQuery(peopleQuery);
  const line = data
    ? unreadLine(data.threads, (id) =>
        displayName(
          people?.find((person) => person.id === id),
          "Someone",
        ),
      )
    : null;
  if (!line) return null;
  const { thread } = line;
  const search = { thread: 1, comment: thread.latestId } as never;
  const row = (
    <QuietRowContent icon={CommentIcon} iconClassName="text-tomato-ink">
      <span className="md:block md:truncate">
        <span className="text-ink font-semibold">{line.lead}</span>
        {line.quote && <span>: {line.quote}</span>}
      </span>
    </QuietRowContent>
  );
  const link =
    thread.stage === "idea" ? (
      <Link to="/ideas/$ideaId" params={{ ideaId: thread.itemId }} search={search} className={quietRowClass}>
        {row}
      </Link>
    ) : (
      <Link to="/builds/$buildId" params={{ buildId: thread.itemId }} search={search} className={quietRowClass}>
        {row}
      </Link>
    );
  // The phone's Now block has little room: the line alone, no label.
  if (bare) return link;
  // A block of its own on Today, under a quiet label, so it reads as a note in its place rather than a stray line.
  return (
    <Section
      id="today-comments"
      title={line.total > 1 ? "New comments" : "New comment"}
      count={line.total > 1 ? line.total : undefined}
      size="overline"
    >
      {link}
    </Section>
  );
}
