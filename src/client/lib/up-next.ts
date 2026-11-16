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

/** Queue changes still on their way: a reorder waits for them, or the server would order places it doesn't have yet. */
const sending = new Set<Promise<unknown>>();

/**
 * Sends a place in the queue (true: the end, null: off it, a number: that place) and keeps the server's answer,
 * unless the place was moved again meanwhile (`shown` is what this change put in the cache): a late answer must not
 * undo a reorder.
 */
function sendUpNext(
  queryClient: QueryClient,
  id: string,
  upNext: boolean | number | null,
  before: number | null,
  shown: number | null,
) {
  const job = (async () => {
    try {
      const { item } = await api<ItemResponse>(`/items/${id}`, { method: "PATCH", json: { upNext } });
      patchCachedItem(queryClient, id, (cached) => ({
        ...cached,
        upNext: cached.upNext === shown ? item.upNext : cached.upNext,
        updatedAt: item.updatedAt,
      }));
    } catch {
      patchCachedItem(queryClient, id, (cached) => ({ ...cached, upNext: before }));
      toast.error("Couldn't save that change", "It's back the way it was. Try again in a moment.");
    }
  })();
  sending.add(job);
  void job.finally(() => sending.delete(job));
}

/** "1st", "2nd", "3rd", "11th", "22nd": a place in the queue. */
function ordinal(place: number): string {
  const tens = place % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][place % 10] ?? "th");
  return `${place}${suffix}`;
}

/** How long after one idea goes in Up next another one joins its toast rather than raising a new one. */
const BATCH_MS = 5000;
const BATCH_TOAST = "up-next-added";

/** The ideas put in Up next one after another (a run of U on the keyboard), so one toast says and undoes them all. */
let batch: { at: number; added: Array<{ id: string; place: number }> } | null = null;

/**
 * Puts an idea in the Up next queue (at the end) or takes it off, at once, with an undo. The toast is one line ("In
 * Up next · 3rd"); ideas added within a few seconds of each other share it ("3 added to Up next"), and its Undo
 * takes them all off again.
 */
export function setUpNext(queryClient: QueryClient, item: Pick<ItemView, "id" | "upNext" | "pending">, on: boolean) {
  if (!canEdit(item.pending) || item.pending) return;
  const before = cachedItem(queryClient, item.id)?.upNext ?? item.upNext;
  if (on === (before !== null)) return;
  const place = on ? endOfQueue(queryClient) : null;
  patchCachedItem(queryClient, item.id, (cached) => ({ ...cached, upNext: place }));
  sendUpNext(queryClient, item.id, on ? true : null, before, place);
  if (!on || place === null) {
    batch = null;
    toast.undo("Off Up next", {
      onUndo: () => {
        patchCachedItem(queryClient, item.id, (cached) => ({ ...cached, upNext: before }));
        sendUpNext(queryClient, item.id, before ?? null, place, before);
      },
    });
    return;
  }
  const now = Date.now();
  batch =
    batch && now - batch.at < BATCH_MS
      ? { at: now, added: [...batch.added, { id: item.id, place }] }
      : { at: now, added: [{ id: item.id, place }] };
  const added = batch.added;
  const queued = (queryClient.getQueryData<Item[]>(itemKeys.list("ideas")) ?? []).filter(
    (idea) => idea.upNext !== null,
  );
  toast.undo(added.length > 1 ? `${added.length} added to Up next` : `In Up next · ${ordinal(queued.length || 1)}`, {
    id: BATCH_TOAST,
    onUndo: () => {
      if (batch?.added === added) batch = null;
      for (const one of added) {
        patchCachedItem(queryClient, one.id, (cached) => ({ ...cached, upNext: null }));
        sendUpNext(queryClient, one.id, null, one.place, null);
      }
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
    await Promise.all(sending);
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
