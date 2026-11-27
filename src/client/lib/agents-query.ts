import type { AgentsResponse } from "@shared/agents";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** Every agent (so "via Claude for Alex" can be said), with tokens only for the signed-in person's own. Apart from lib/agents: the live updates read it on every screen. */
export const agentsQuery = queryOptions({
  queryKey: ["agents"] as const,
  queryFn: async () => (await api<AgentsResponse>("/agents")).agents,
  staleTime: 5 * 60 * 1000,
});
