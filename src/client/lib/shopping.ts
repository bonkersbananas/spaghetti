import type { ShoppingItem, ShoppingItemResponse, ShoppingItemsResponse } from "@shared/api";
import { parseEntry, shoppingName, splitShopping, tidyPageTitle } from "@shared/shopping";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { featuresQuery } from "./drafts";
import { linkPreviewQuery } from "./queries";
import { canEdit } from "./read-only";

/** The shopping list: what's still to buy in its order, then what was bought, the latest first. */
export const shoppingQuery = queryOptions({
  queryKey: ["shopping"] as const,
  queryFn: async () => (await api<ShoppingItemsResponse>("/shopping-items")).shoppingItems,
  staleTime: 30_000,
});

export function useShopping() {
  const query = useQuery(shoppingQuery);
  return { ...query, ...splitShopping(query.data ?? []) };
}

function patchList(queryClient: QueryClient, change: (items: ShoppingItem[]) => ShoppingItem[]) {
  queryClient.setQueryData<ShoppingItem[]>(shoppingQuery.queryKey, (items) => (items ? change(items) : items));
}

const patchOne = (queryClient: QueryClient, id: string, change: (item: ShoppingItem) => ShoppingItem) =>
  patchList(queryClient, (items) => items.map((item) => (item.id === id ? change(item) : item)));

const keepServer = (queryClient: QueryClient, saved: ShoppingItem) =>
  patchList(queryClient, (items) => items.map((item) => (item.id === saved.id ? saved : item)));

/** Adds still on their way to the server: an order waits for them, or it would name a thing the server doesn't have yet. */
const adding = new Set<Promise<unknown>>();
/** The newest order sent: an older one's answer doesn't move rows. */
let latestOrder = 0;

const topPosition = (items: ShoppingItem[]) =>
  Math.min(1, ...items.filter((item) => item.boughtAt === null).map((item) => item.position)) - 1;

/**
 * Adds a line typed or pasted into the list (words, a shop link, a Prisjakt link): it shows at the top at once and
 * the server's copy replaces it. A thing added with only a link names itself from its page's title once it's read.
 */
export async function addToShopping(queryClient: QueryClient, text: string, userId: string): Promise<boolean> {
  const entry = parseEntry(text);
  if (!entry.name && !entry.link && !entry.priceLink) return false;
  const id = crypto.randomUUID();
  const now = Date.now();
  const before = queryClient.getQueryData<ShoppingItem[]>(shoppingQuery.queryKey) ?? [];
  const optimistic: ShoppingItem = {
    id,
    ...entry,
    picture: null,
    prices: null,
    suggestion: null,
    suggestState: null,
    pricesTriedAt: null,
    position: topPosition(before),
    boughtAt: null,
    boughtBy: null,
    createdBy: userId,
    createdVia: null,
    createdAt: now,
    updatedAt: now,
  };
  queryClient.setQueryData<ShoppingItem[]>(shoppingQuery.queryKey, (items) => [optimistic, ...(items ?? [])]);
  const sending = api<ShoppingItemResponse>("/shopping-items", {
    method: "POST",
    json: {
      id,
      ...(entry.name && { name: entry.name }),
      ...(entry.link && { link: entry.link }),
      ...(entry.priceLink && { priceLink: entry.priceLink }),
    },
  });
  const settled = sending.catch(() => undefined);
  adding.add(settled);
  void settled.finally(() => adding.delete(settled));
  try {
    const { shoppingItem } = await sending;
    // The server's copy, in the place the row has here: it may have been moved while it was being saved.
    patchList(queryClient, (items) =>
      items.map((item) => (item.id === id ? { ...shoppingItem, position: item.position } : item)),
    );
    if (!entry.name) void nameFromPage(queryClient, shoppingItem);
    return true;
  } catch (error) {
    patchList(queryClient, (items) => items.filter((item) => item.id !== id));
    toast.error("Couldn't add that", error instanceof ApiError ? error.message : "Try again in a moment.");
    return false;
  }
}

/** A thing added with only a link takes its page's title as its name (without the shop's name after it). */
async function nameFromPage(queryClient: QueryClient, item: ShoppingItem) {
  const url = item.link ?? item.priceLink;
  if (!url) return;
  try {
    const preview = await queryClient.fetchQuery(linkPreviewQuery(url));
    const name = preview.title ? tidyPageTitle(preview.title, preview.site).slice(0, 120) : "";
    const current = queryClient.getQueryData<ShoppingItem[]>(shoppingQuery.queryKey)?.find((i) => i.id === item.id);
    if (!name || !current || current.name) return;
    await updateShopping(queryClient, item.id, { name });
  } catch {
    // No title to be had: the row keeps showing the address.
  }
}

type Changes = Partial<Pick<ShoppingItem, "name" | "link" | "priceLink">>;

/** Renames a thing or changes its links. Resolves once the server has it (autosave shows "Saved"). */
export async function updateShopping(queryClient: QueryClient, id: string, changes: Changes) {
  patchOne(queryClient, id, (item) => ({
    ...item,
    ...changes,
    // A new Prisjakt page means new prices, as the server does it; a new shop page drops the shop's picture.
    ...(changes.priceLink !== undefined && { prices: null, pricesTriedAt: null, suggestion: null, suggestState: null }),
    ...(((changes.priceLink !== undefined && item.picture?.source === "prisjakt") ||
      (changes.link !== undefined && item.picture?.source === "shop")) && { picture: null }),
  }));
  const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${id}`, {
    method: "PATCH",
    json: changes,
  });
  keepServer(queryClient, shoppingItem);
}

/** Ticks a thing off (bought) or puts it back on the list, at once. Back on the list goes to the top. */
export async function setBought(queryClient: QueryClient, item: ShoppingItem, bought: boolean, userId: string) {
  if (!canEdit() || bought === (item.boughtAt !== null)) return;
  const before = queryClient.getQueryData<ShoppingItem[]>(shoppingQuery.queryKey);
  const position = bought ? item.position : topPosition(before ?? []);
  patchOne(queryClient, item.id, (current) => ({
    ...current,
    boughtAt: bought ? Date.now() : null,
    boughtBy: bought ? userId : null,
    position,
  }));
  try {
    const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${item.id}`, {
      method: "PATCH",
      json: { bought },
    });
    keepServer(queryClient, shoppingItem);
  } catch {
    if (before) queryClient.setQueryData(shoppingQuery.queryKey, before);
    toast.error("Couldn't save that", "It's back the way it was. Try again in a moment.");
  }
}

/** Sets the order of what's still to buy (every id, first to last), at once. */
export async function reorderShopping(queryClient: QueryClient, ids: string[]) {
  if (!canEdit()) return;
  const mine = ++latestOrder;
  const place = new Map(ids.map((id, index) => [id, index + 1]));
  patchList(queryClient, (items) =>
    items.map((item) => (place.has(item.id) ? { ...item, position: place.get(item.id) as number } : item)),
  );
  try {
    await Promise.all(adding);
    const { shoppingItems } = await api<ShoppingItemsResponse>("/shopping-items/order", {
      method: "PUT",
      json: { ids },
    });
    // A newer move is on its way: its answer will say where things are.
    if (mine !== latestOrder) return;
    // Only the places of what's still to buy come from the answer; anything added, ticked or edited here meanwhile
    // stays as it is (the other person's changes arrive through the change feed).
    const server = new Map(shoppingItems.map((item) => [item.id, item.position]));
    patchList(queryClient, (items) =>
      items.map((item) =>
        item.boughtAt === null && server.has(item.id) ? { ...item, position: server.get(item.id) as number } : item,
      ),
    );
  } catch {
    // Not a copy from before (it would undo what happened since): the server's list, fetched again.
    void queryClient.invalidateQueries({ queryKey: shoppingQuery.queryKey });
    toast.error("Couldn't save the new order", "It's back the way it was. Try again in a moment.");
  }
}

/** Moves one thing a place up (-1) or down (+1) among what's still to buy. */
export function moveShopping(queryClient: QueryClient, toBuy: ShoppingItem[], id: string, step: -1 | 1) {
  const ids = toBuy.map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ...ids.splice(from, 1));
  void reorderShopping(queryClient, ids);
}

/**
 * Takes things off the list at once (one from its sheet, or every bought one with "Clear"), with one Undo that puts
 * them all back where they were.
 */
export function removeShopping(queryClient: QueryClient, gone: ShoppingItem[], pageTitle?: string | null) {
  if (!gone.length || !canEdit()) return;
  const ids = new Set(gone.map((item) => item.id));
  patchList(queryClient, (items) => items.filter((item) => !ids.has(item.id)));
  const deleted = Promise.all(
    gone.map((item) =>
      api(`/shopping-items/${item.id}`, { method: "DELETE" }).catch((error) => {
        if (error instanceof ApiError && error.status === 404) return;
        patchList(queryClient, (items) => [...items.filter((i) => i.id !== item.id), item]);
        toast.error("Couldn't take that off the list", "It's back where it was.");
      }),
    ),
  );
  const [only] = gone;
  toast.undo(gone.length === 1 && only ? "Off the list" : `${gone.length} things cleared`, {
    description: gone.length === 1 && only ? shoppingName(only, pageTitle) : "Everything you'd bought.",
    onUndo: async () => {
      await deleted;
      patchList(queryClient, (items) => [...items.filter((item) => !ids.has(item.id)), ...gone]);
      try {
        await Promise.all(gone.map((item) => api(`/shopping-items/${item.id}/restore`, { method: "POST" })));
      } catch {
        toast.error("Couldn't bring that back", "Try again in a moment.");
      }
      void queryClient.invalidateQueries({ queryKey: shoppingQuery.queryKey });
    },
  });
}

/** "Check prices again": the server reads the Prisjakt page now and answers with what it found. */
export async function checkPrices(queryClient: QueryClient, id: string) {
  const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${id}/check-prices`, { method: "POST" });
  keepServer(queryClient, shoppingItem);
}

/** Claude looks for the Prisjakt page in a search engine's results; the answer is a suggestion to confirm. */
export async function lookForPrisjakt(queryClient: QueryClient, id: string) {
  patchOne(queryClient, id, (item) => ({ ...item, suggestion: null, suggestState: "searching" }));
  try {
    const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${id}/suggest`, { method: "POST" });
    keepServer(queryClient, shoppingItem);
  } catch (error) {
    await queryClient.invalidateQueries({ queryKey: shoppingQuery.queryKey });
    throw error;
  }
}

/** "Not this one": the suggestion goes at once and isn't suggested again. */
export async function dismissSuggestion(queryClient: QueryClient, id: string) {
  patchOne(queryClient, id, (item) => ({ ...item, suggestion: null, suggestState: "none" }));
  const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${id}/suggestion/dismiss`, {
    method: "POST",
  });
  keepServer(queryClient, shoppingItem);
}

export const usePriceSuggestionsEnabled = () => useQuery(featuresQuery).data?.priceSuggestions === true;
