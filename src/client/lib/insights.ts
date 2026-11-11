import type { InsightsResponse } from "@shared/api";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** The year so far. Kept in the offline copy like the journal: a view of everything, refetched on a visit. */
export function insightsQuery(year: number) {
  const tz = new Date().getTimezoneOffset();
  return queryOptions({
    queryKey: ["insights", year, tz] as const,
    queryFn: async () => (await api<InsightsResponse>(`/insights?year=${year}&tz=${tz}`)).insights,
    staleTime: 0,
    gcTime: 7 * 24 * 60 * 60 * 1000,
  });
}
