import type { WeekResponse } from "@shared/week";
import type { QueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** While Claude writes the week's paragraph, look again every few seconds: it lands on its own. */
const WRITING_POLL_MS = 4000;

/**
 * One week of the notebook (Monday to Sunday in the workspace's time zone), worked out by the server. Kept for
 * offline reading like the journal; refreshed by the change feed (lib/live.ts).
 */
export function weekQuery(monday: string) {
  return queryOptions({
    queryKey: ["week", monday] as const,
    queryFn: async () => (await api<WeekResponse>(`/weeks/${monday}`)).week,
    staleTime: 30_000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    refetchInterval: (query) => (query.state.data?.note?.status === "thinking" ? WRITING_POLL_MS : false),
  });
}

/** The weeks either side, fetched quietly once this one is up, so ← and → answer at once. */
export function prefetchNeighbours(queryClient: QueryClient, previous: string, next: string | null) {
  void queryClient.prefetchQuery(weekQuery(previous));
  if (next) void queryClient.prefetchQuery(weekQuery(next));
}
