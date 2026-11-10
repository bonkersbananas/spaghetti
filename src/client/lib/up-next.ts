import type { Item, ItemResponse, ItemsResponse } from "@shared/api";
import type { QueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import { cachedItem, type ItemView, itemKeys, patchCachedItem } from "./items";
import { canEdit } from "./read-only";

/** The queued ideas in queue order, and the ideas that aren't queued in the order they came in. */
export function splitQueue<T extends Pick<Item, "id" | "upNext">>(ideas: T[]): { queue: T[]; rest: T[] } {
  const queue = ideas
    .filter((idea) => idea.upNext !== null)
    .sort((a, b) => (a.upNext ?? 0) - (b.upNext ?? 0) || (a.id > b.id ? 1 : -1));
  return { queue, rest: ideas.filter((idea) => idea.upNext === null) };
}

function endOfQueue(queryClient: QueryClient): number {
  const ideas = queryClient.getQueryData<Item[]>(itemKeys.list("ideas")) ?? [];
  return ideas.reduce((last, idea) => Math.max(last, idea.upNext ?? 0), 0) + 1;
}

/** Sends a place in the queue (true: the end, null: off it, a number: that place) and keeps the server's answer. */
async function sendUpNext(
  queryClient: QueryClient,
  id: string,
  upNext: boolean | number | null,
  before: number | null,
) {
  try {
    const { item } = await api<ItemResponse>(`/items/${id}`, { method: "PATCH", json: { upNext } });
    patchCachedItem(queryClient, id, (cached) => ({ ...cached, upNext: item.upNext, updatedAt: item.updatedAt }));
  } catch {
    patchCachedItem(queryClient, id, (cached) => ({ ...cached, upNext: before }));
    toast.error("Couldn't save that change", "It's back the way it was. Try again in a moment.");
  }
}

/** Puts an idea in the Up next queue (at the end) or takes it off, at once, with an undo. */
export function setUpNext(queryClient: QueryClient, item: Pick<ItemView, "id" | "upNext" | "pending">, on: boolean) {
  if (!canEdit(item.pending) || item.pending) return;
  const before = cachedItem(queryClient, item.id)?.upNext ?? item.upNext;
  if (on === (before !== null)) return;
  const place = on ? endOfQueue(queryClient) : null;
  patchCachedItem(queryClient, item.id, (cached) => ({ ...cached, upNext: place }));
  void sendUpNext(queryClient, item.id, on ? true : null, before);
  toast.undo(on ? "Up next" : "Off the Up next list", {
    description: on ? "At the end of the queue. Move it up whenever." : undefined,
    onUndo: () => {
      patchCachedItem(queryClient, item.id, (cached) => ({ ...cached, upNext: before }));
      void sendUpNext(queryClient, item.id, before ?? null, place);
    },
  });
}

/** Sets the queue's order (every id given, first to last), at once. */
export async function reorderUpNext(queryClient: QueryClient, ids: string[]) {
  if (!canEdit()) return;
  const before = queryClient.getQueryData<Item[]>(itemKeys.list("ideas"));
  for (const [index, id] of ids.entries())
    patchCachedItem(queryClient, id, (cached) => ({ ...cached, upNext: index + 1 }));
  try {
    await api<ItemsResponse>("/items/up-next/order", { method: "PUT", json: { ids } });
  } catch {
    if (before) queryClient.setQueryData(itemKeys.list("ideas"), before);
    toast.error("Couldn't save the new order", "It's back the way it was. Try again in a moment.");
  }
}

/** Moves one queued idea a place up (-1) or down (+1). */
export function moveUpNext(queryClient: QueryClient, queue: Array<{ id: string }>, id: string, step: -1 | 1) {
  const ids = queue.map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ...ids.splice(from, 1));
  void reorderUpNext(queryClient, ids);
}

/** Drops `id` where `target` is (before it when moving up, after it when moving down). */
export function dropUpNext(queryClient: QueryClient, queue: Array<{ id: string }>, id: string, target: string) {
  const ids = queue.map((item) => item.id);
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  ids.splice(to, 0, ...ids.splice(from, 1));
  void reorderUpNext(queryClient, ids);
}
