import type { ScoutPick } from "@shared/scout";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { itemKeys } from "./items";
import { canEdit } from "./read-only";
import { patchPick } from "./scout";

// The writes of the idea scout's cards: loaded with the lazy block, not with every screen.

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
