import type { UpkeepResponse, UpkeepTask } from "@shared/api";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";

/** The printer's upkeep tasks, most due first, and its print hours. */
export const upkeepQuery = queryOptions({
  queryKey: ["upkeep"] as const,
  queryFn: () => api<UpkeepResponse>("/printer/upkeep"),
  staleTime: 60_000,
});

/** The tasks that are due (what Today's line and the Printer page's count read). */
export function useDueUpkeep(): UpkeepTask[] {
  return (useQuery(upkeepQuery).data?.tasks ?? []).filter((task) => task.due);
}
