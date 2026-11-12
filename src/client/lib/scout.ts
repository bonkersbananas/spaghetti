import type { ScoutPick, ScoutResponse, ScoutRound } from "@shared/scout";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { featuresQuery } from "./features";

/** While the scout looks, ask again every few seconds: the picks land on their own. */
const THINKING_POLL_MS = 4000;

/** This week's picks (persisted for offline reading; refreshed by `scout` changes in lib/live.ts). */
export const scoutQuery = queryOptions({
  queryKey: ["scout"] as const,
  queryFn: async () => (await api<ScoutResponse>("/scout")).scout,
  staleTime: 30_000,
  refetchInterval: (query) => (query.state.data?.state === "thinking" ? THINKING_POLL_MS : false),
});

/** Whether the scout is set up (the Worker has the key): nothing about it shows otherwise. */
export const useScoutEnabled = () => useQuery(featuresQuery).data?.scout === true;

/** This week's round, or undefined until it is known (and always while the scout isn't set up). */
export function useScout(): ScoutRound | undefined {
  const enabled = useScoutEnabled();
  return useQuery({ ...scoutQuery, enabled }).data;
}

/** The picks still waiting for an answer. */
export const waitingPicks = (round: ScoutRound | undefined) =>
  round?.picks.filter((pick) => pick.status === "suggested") ?? [];

export function patchPick(queryClient: QueryClient, id: string, change: Partial<ScoutPick>) {
  queryClient.setQueryData<ScoutRound>(scoutQuery.queryKey, (round) =>
    round ? { ...round, picks: round.picks.map((pick) => (pick.id === id ? { ...pick, ...change } : pick)) } : round,
  );
}

export const scoutPictureUrl = (pick: Pick<ScoutPick, "id" | "hasPicture">) =>
  pick.hasPicture ? `/api/scout/${pick.id}/picture` : undefined;
