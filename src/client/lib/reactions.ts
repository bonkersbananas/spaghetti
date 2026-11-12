import { type EmojiUse, hasReacted, quickEmoji, type Reaction, toggleReaction } from "@shared/reactions";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { cachedItem, patchCachedItem } from "./items";
import { canEdit } from "./read-only";

export interface ReactionTarget {
  /** The API path of the thing reacted to: `/items/<id>` or `/comments/<id>`. */
  path: string;
  /** Its reactions in the cache now. */
  read: () => readonly Reaction[] | undefined;
  /** Puts a list of reactions in the cache. */
  write: (reactions: Reaction[]) => void;
}

/** Writes in flight per target: only the answer to the latest one may replace the cache. */
const inFlight = new Map<string, number>();

/**
 * Gives `kind` from `me`, or takes it back: on screen at once, then sent. The server's answer replaces the list once
 * nothing newer is on its way; a refusal puts it back as it was, with a quiet word.
 */
export function reactTo({ path, read, write }: ReactionTarget, kind: string, me: string, queryClient?: QueryClient) {
  if (!canEdit()) return;
  const on = !hasReacted(read(), kind, me);
  write(toggleReaction(read(), kind, me, Date.now()));
  inFlight.set(path, (inFlight.get(path) ?? 0) + 1);
  const settle = () => {
    const left = (inFlight.get(path) ?? 1) - 1;
    if (left) inFlight.set(path, left);
    else inFlight.delete(path);
    return left === 0;
  };
  api<{ reactions: Reaction[] }>(`${path}/reactions/${encodeURIComponent(kind)}`, { method: on ? "PUT" : "DELETE" })
    .then(({ reactions }) => {
      if (settle()) write(reactions);
      // The quick row and "recently used" follow what you give.
      if (on) void queryClient?.invalidateQueries({ queryKey: emojiUseQuery.queryKey });
    })
    .catch(() => {
      settle();
      // Only this one goes back: anything tapped since stays.
      if (hasReacted(read(), kind, me) === on) write(toggleReaction(read(), kind, me, Date.now()));
      toast.error("Couldn't save that reaction", "Try again in a moment.");
    });
}

/** Reacts to an idea or build, wherever it is cached. */
export function reactToItem(queryClient: QueryClient, itemId: string, kind: string, me: string) {
  reactTo(
    {
      path: `/items/${itemId}`,
      read: () => cachedItem(queryClient, itemId)?.reactions,
      write: (reactions) => patchCachedItem(queryClient, itemId, (item) => ({ ...item, reactions })),
    },
    kind,
    me,
    queryClient,
  );
}

/** The emoji the two of you use most and the ones you used last: the picker's quick row and recent row. */
export const emojiUseQuery = queryOptions({
  queryKey: ["reactions", "used"],
  queryFn: () => api<EmojiUse>("/reactions/used"),
  staleTime: 5 * 60_000,
});

/** What the picker needs: the quick row (filled up with the defaults) and your recent picks. */
export function useEmojiUse() {
  const { data } = useQuery(emojiUseQuery);
  return { quick: quickEmoji(data?.popular), recent: data?.recent ?? [] };
}
