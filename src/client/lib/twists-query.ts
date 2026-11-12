import type { TwistsResponse } from "@shared/api";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** Every twist, newest first. */
export const twistsQuery = queryOptions({
  queryKey: ["twists"] as const,
  queryFn: async () => (await api<TwistsResponse>("/twists")).twists,
  staleTime: 60_000,
});
