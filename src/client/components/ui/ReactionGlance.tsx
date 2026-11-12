import { type Reaction, summarizeReactions } from "@shared/reactions";
import { cn } from "@/lib/cn";

/** How many emoji a card shows before "+2". */
const SHOWN = 4;

/**
 * The reactions to an idea or build, small enough for a card: just the emoji in the order they were given, and a
 * count only where both of you gave the same one. Nothing when there are none. It isn't a button: the card opens
 * the idea, where reacting happens (components/reactions/ItemReactions).
 */
export function ReactionGlance({
  reactions,
  className,
}: {
  reactions: readonly Reaction[] | undefined;
  className?: string;
}) {
  const summaries = summarizeReactions(reactions, undefined);
  if (!summaries.length) return null;
  const more = summaries.length - SHOWN;
  return (
    <p
      role="img"
      aria-label={`Reactions: ${summaries.map((s) => (s.userIds.length > 1 ? `${s.emoji} from both of you` : s.emoji)).join(", ")}`}
      className={cn("text-small text-ink-faint flex min-w-0 items-center gap-1.5 pt-1.5 tabular-nums", className)}
    >
      {summaries.slice(0, SHOWN).map((summary) => (
        <span key={summary.emoji} aria-hidden className="inline-flex items-center gap-0.5">
          <span className="font-emoji text-body leading-none">{summary.emoji}</span>
          {summary.userIds.length > 1 && <span className="text-caption font-semibold">{summary.userIds.length}</span>}
        </span>
      ))}
      {more > 0 && (
        <span aria-hidden className="text-caption font-semibold">
          +{more}
        </span>
      )}
    </p>
  );
}
