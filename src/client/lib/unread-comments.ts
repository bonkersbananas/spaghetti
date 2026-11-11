import type { UnreadCommentsResponse } from "@shared/comments";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";

// Apart from lib/comments.ts (writing, drafts, the thread) so the lists, which only need the marker, don't carry that code.

/** The threads with comments the signed-in person hasn't read: the markers on cards and the palette's way in. */
export const unreadQuery = queryOptions({
  queryKey: ["comments", "unread"] as const,
  queryFn: () => api<UnreadCommentsResponse>("/comments/unread"),
  staleTime: 30_000,
  gcTime: 7 * 24 * 60 * 60 * 1000,
});

/** How many unread comments this idea or build has (0 for none). Cards in a list share one request. */
export function useUnreadCount(itemId: string): number {
  const { data } = useQuery({
    ...unreadQuery,
    select: (response) => response.threads.find((thread) => thread.itemId === itemId)?.count ?? 0,
  });
  return data ?? 0;
}
