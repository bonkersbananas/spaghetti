import { unreadLine } from "@shared/comments";
import { displayName } from "@shared/people";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CommentIcon } from "@/components/ui/icons";
import { peopleQuery } from "@/lib/queries";
import { unreadQuery } from "@/lib/unread-comments";

/**
 * One quiet line when the other person wrote something you haven't read: "Marie on Tugboat: Started it tonight…",
 * or the count when there are several, leading to the thread with that comment lit. Nothing when all is read.
 * It sits under what is on the bed and is as small as the upkeep line: a note on the fridge, not a notification.
 */
export default function CommentsLine() {
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
  const link =
    thread.stage === "idea"
      ? { to: "/ideas/$ideaId" as const, params: { ideaId: thread.itemId }, search }
      : { to: "/builds/$buildId" as const, params: { buildId: thread.itemId }, search };
  return (
    <Link
      {...link}
      className="focus-ring pressable text-small text-ink-soft hover:text-ink duration-fast hover:bg-ink/4 -mx-2 flex min-h-11 items-start gap-2 rounded-md px-2 py-2.5 transition-colors"
    >
      <CommentIcon size={16} className="text-tomato-ink mt-0.5 shrink-0" aria-hidden />
      <span className="min-w-0 md:truncate">
        <span className="text-ink font-semibold">{line.lead}</span>
        {line.quote && <span>: {line.quote}</span>}
      </span>
    </Link>
  );
}
