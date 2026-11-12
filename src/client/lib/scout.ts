import type { ScoutPick, ScoutResponse, ScoutRound } from "@shared/scout";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { featuresQuery } from "./drafts";
import { itemKeys } from "./items";
import { canEdit } from "./read-only";

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

function patchPick(queryClient: QueryClient, id: string, change: Partial<ScoutPick>) {
  queryClient.setQueryData<ScoutRound>(scoutQuery.queryKey, (round) =>
    round ? { ...round, picks: round.picks.map((pick) => (pick.id === id ? { ...pick, ...change } : pick)) } : round,
  );
}

/** One write at a time per suggestion, in order: an Undo tapped at once must not overtake the Keep it undoes. */
const lanes = new Map<string, Promise<unknown>>();
function inOrder<T>(id: string, write: () => Promise<T>): Promise<T> {
  const run = (lanes.get(id) ?? Promise.resolve()).then(write, write);
  lanes.set(
    id,
    run.catch(() => undefined),
  );
  return run;
}

const refreshIdeas = (queryClient: QueryClient) =>
  void queryClient.invalidateQueries({ queryKey: [itemKeys.all[0], "list"] });

async function write(
  queryClient: QueryClient,
  pick: ScoutPick,
  back: Partial<ScoutPick>,
  send: () => Promise<unknown>,
) {
  try {
    await inOrder(pick.id, send);
  } catch {
    patchPick(queryClient, pick.id, back);
    toast.error("Couldn't save that", "It's back the way it was. Try again in a moment.");
  }
}

/** Keep: the suggestion becomes an idea (the server makes it and drafts the rest from its link). Undo takes it back. */
export function keepPick(queryClient: QueryClient, pick: ScoutPick) {
  if (!canEdit()) return;
  const itemId = crypto.randomUUID();
  patchPick(queryClient, pick.id, { status: "kept", itemId });
  toast.undo("Kept as an idea", { description: pick.title, onUndo: () => undoKeep(queryClient, pick) });
  void write(queryClient, pick, { status: "suggested", itemId: null }, async () => {
    await api(`/scout/${pick.id}/keep`, { method: "PUT", json: { itemId } });
    refreshIdeas(queryClient);
  });
}

export function undoKeep(queryClient: QueryClient, pick: ScoutPick) {
  if (!canEdit()) return;
  patchPick(queryClient, pick.id, { status: "suggested", itemId: null });
  void write(queryClient, pick, { status: "kept", itemId: pick.itemId }, async () => {
    await api(`/scout/${pick.id}/keep`, { method: "DELETE" });
    refreshIdeas(queryClient);
  });
}

/** Not for us: put away for good (the scout never suggests that model again). Undo brings it back. */
export function dismissPick(queryClient: QueryClient, pick: ScoutPick) {
  if (!canEdit()) return;
  patchPick(queryClient, pick.id, { status: "dismissed" });
  toast.undo("Not for us", { description: pick.title, onUndo: () => undoDismiss(queryClient, pick) });
  void write(queryClient, pick, { status: "suggested" }, () => api(`/scout/${pick.id}/dismiss`, { method: "PUT" }));
}

export function undoDismiss(queryClient: QueryClient, pick: ScoutPick) {
  if (!canEdit()) return;
  patchPick(queryClient, pick.id, { status: "suggested" });
  void write(queryClient, pick, { status: "dismissed" }, () => api(`/scout/${pick.id}/dismiss`, { method: "DELETE" }));
}

export const scoutPictureUrl = (pick: Pick<ScoutPick, "id" | "hasPicture">) =>
  pick.hasPicture ? `/api/scout/${pick.id}/picture` : undefined;
