import type { ShoppingItem, ShoppingItemResponse, ShoppingItemsResponse } from "@shared/api";
import { parseEntry, shoppingName, splitShopping, tidyPageTitle } from "@shared/shopping";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { ApiError, api } from "./api";
import { featuresQuery } from "./drafts";
import { linkPreviewQuery } from "./queries";
import { canEdit } from "./read-only";
import { keepUnsent, unsent } from "./unsent";

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

/** How many times each thing was changed here: an answer to an older change mustn't overwrite a newer one. */
const edits = new Map<string, number>();

const patchOne = (queryClient: QueryClient, id: string, change: (item: ShoppingItem) => ShoppingItem) => {
  edits.set(id, (edits.get(id) ?? 0) + 1);
  patchList(queryClient, (items) => items.map((item) => (item.id === id ? change(item) : item)));
};

/** What the server works out itself (the shop's picture, prices): safe to take from any answer. */
const serverOwn = (saved: ShoppingItem) => ({
  picture: saved.picture,
  prices: saved.prices,
  pricesTriedAt: saved.pricesTriedAt,
  suggestion: saved.suggestion,
  suggestState: saved.suggestState,
  spoolId: saved.spoolId,
});

/**
 * Keeps the server's answer to a change made at `edit` (what `edits` said right after it was shown). If the thing was
 * changed again since, that newer change stays and only what the server works out is taken.
 */
const keepServer = (queryClient: QueryClient, saved: ShoppingItem, edit?: number) =>
  patchList(queryClient, (items) =>
    items.map((item) => {
      if (item.id !== saved.id) return item;
      return edit !== undefined && edits.get(saved.id) === edit ? saved : { ...item, ...serverOwn(saved) };
    }),
  );

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
    spoolId: null,
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
    // The server's copy, in the place the row has here: it may have been moved while it was being saved. A tick made
    // meanwhile stays too (the server has it bought only once its own tick follows the add): taking the new thing's
    // open state would put a bought row back on the list, and close what was opened from it ("Add to pantry").
    // Words changed meanwhile (a rename, a pasted link) stay too: the server's copy still has the first ones.
    patchList(queryClient, (items) =>
      items.map((item) => {
        if (item.id !== id) return item;
        if (edits.has(id)) return { ...item, ...serverOwn(shoppingItem), updatedAt: shoppingItem.updatedAt };
        return { ...shoppingItem, position: item.position, boughtAt: item.boughtAt, boughtBy: item.boughtBy };
      }),
    );
    if (!entry.name) void nameFromPage(queryClient, shoppingItem);
    return true;
  } catch (error) {
    patchList(queryClient, (items) => items.filter((item) => item.id !== id));
    toast.error("Couldn't add that", error instanceof ApiError ? error.message : "Try again in a moment.");
    return false;
  }
}

/**
 * Puts the lines on the list that aren't there already (the same words, whatever the case), most urgent first, so the
 * first one asked for ends on top. Resolves with how many it added.
 */
export async function addSpoolsToShopping(queryClient: QueryClient, names: string[], userId: string): Promise<number> {
  if (!canEdit()) return 0;
  let added = 0;
  for (const name of [...names].reverse()) {
    const onList = (queryClient.getQueryData<ShoppingItem[]>(shoppingQuery.queryKey) ?? []).some(
      (item) => item.boughtAt === null && sameWords(item.name, name),
    );
    if (!onList && (await addToShopping(queryClient, name, userId))) added += 1;
  }
  return added;
}

/** Whether two lines say the same: case and spacing don't count. */
export const sameWords = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

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
  const edit = edits.get(id) ?? 0;
  // A thing still being added isn't on the server yet: the change follows the add, or it would answer "not found".
  await Promise.all(adding);
  const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${id}`, {
    method: "PATCH",
    json: changes,
  });
  keepServer(queryClient, shoppingItem, edit);
}

const TICKS = "shopping-ticks";

/** Ticks that wait for their thing to be added, by id, kept on the device until sent (`undefined` forgets one). */
function keepTick(id: string, bought: boolean | undefined) {
  const ticks = { ...unsent<Record<string, boolean>>(TICKS) };
  if (bought === undefined) delete ticks[id];
  else ticks[id] = bought;
  keepUnsent(TICKS, Object.keys(ticks).length ? ticks : undefined);
}

/**
 * Sends the ticks a closed page left waiting for their thing's add (see setBought), once the list is fresh from the
 * server: the add has landed by then, or the thing is gone and its tick is dropped.
 */
export function replayTicks(queryClient: QueryClient, items: ShoppingItem[], userId: string | null) {
  const ticks = unsent<Record<string, boolean>>(TICKS) ?? {};
  for (const [id, bought] of Object.entries(ticks)) {
    const item = items.find((candidate) => candidate.id === id);
    if (item && bought !== (item.boughtAt !== null)) void setBought(queryClient, item, bought, userId);
    else keepTick(id, undefined);
  }
}

/** Ticks a thing off (bought) or puts it back on the list, at once. Back on the list goes to the top. */
export async function setBought(queryClient: QueryClient, item: ShoppingItem, bought: boolean, userId: string | null) {
  if (!canEdit() || bought === (item.boughtAt !== null)) return;
  const before = queryClient.getQueryData<ShoppingItem[]>(shoppingQuery.queryKey);
  const position = bought ? item.position : topPosition(before ?? []);
  patchOne(queryClient, item.id, (current) => ({
    ...current,
    boughtAt: bought ? Date.now() : null,
    boughtBy: bought ? userId : null,
    position,
  }));
  const edit = edits.get(item.id) ?? 0;
  try {
    // A thing still being added isn't on the server yet: its tick follows the add, or it would answer "not found".
    // The page may go before the add is answered (a reload): the tick is kept on this device then, and sent on the
    // next visit to the list (replayTicks).
    if (adding.size > 0) {
      keepTick(item.id, bought);
      await Promise.all(adding);
    }
    const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${item.id}`, {
      method: "PATCH",
      json: { bought },
    });
    keepTick(item.id, undefined);
    keepServer(queryClient, shoppingItem, edit);
  } catch {
    keepTick(item.id, undefined);
    // Only this tick is undone: other things changed meanwhile stay as they are.
    const was = before?.find((i) => i.id === item.id);
    if (was)
      patchOne(queryClient, item.id, (current) => ({
        ...current,
        boughtAt: was.boughtAt,
        boughtBy: was.boughtBy,
        position: was.position,
      }));
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
  // A thing still being added is deleted after the add lands, or the add would bring it back on the server.
  const deleted = Promise.all(
    gone.map((item) =>
      Promise.all(adding)
        .then(() => api(`/shopping-items/${item.id}`, { method: "DELETE" }))
        .catch((error) => {
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

/** A bought thing became this spool ("Add to pantry"): the row says so, for both people. */
export async function keepInPantry(
  queryClient: QueryClient,
  item: ShoppingItem,
  spoolId: string,
  saved?: Promise<boolean>,
) {
  patchOne(queryClient, item.id, (current) => ({ ...current, spoolId }));
  try {
    // The spool is on the server first, or the link would be refused.
    if (saved && !(await saved)) throw new Error("The spool wasn't saved.");
    const { shoppingItem } = await api<ShoppingItemResponse>(`/shopping-items/${item.id}`, {
      method: "PATCH",
      json: { spoolId },
    });
    keepServer(queryClient, shoppingItem);
  } catch {
    // The spool is in the pantry either way: only the mark on the row didn't take.
    patchOne(queryClient, item.id, (current) => ({ ...current, spoolId: item.spoolId }));
  }
}
