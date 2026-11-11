import { moveBy, WISHLIST_MAX, type Wishlist, type WishlistResponse, type WishlistsResponse } from "@shared/wishlist";
import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { toast } from "@/components/ui/Toast";
import { api } from "./api";
import type { ItemView } from "./items";
import { canEdit } from "./read-only";

/** Everyone's wishlist, yours first (persisted, so it opens offline; refreshed by `wishlist` changes in live.ts). */
export const wishlistsQuery = queryOptions({
  queryKey: ["wishlists"],
  queryFn: async () => (await api<WishlistsResponse>("/wishlists")).wishlists,
});

export function useWishlists(): { wishlists: Wishlist[] | undefined; isPending: boolean } {
  const { data, isPending } = useQuery(wishlistsQuery);
  return { wishlists: data, isPending };
}

/** The ids on a person's list, top first. */
export function useWishlistIds(personId: string | undefined): string[] {
  const { wishlists } = useWishlists();
  return wishlists?.find((list) => list.personId === personId)?.entries.map((entry) => entry.itemId) ?? [];
}

/**
 * A list's entries as the ideas they are, top first: only ideas this device knows and that are still ideas
 * (one that became a build drops out at once, before the server says so).
 */
export function wishedIdeas(list: Wishlist | undefined, ideas: ItemView[]): ItemView[] {
  if (!list) return [];
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  return list.entries.flatMap((entry) => {
    const idea = byId.get(entry.itemId);
    return idea && idea.stage === "idea" ? [idea] : [];
  });
}

// --- writes -----------------------------------------------------------------------------------------

/** Writes still on their way: an answer only replaces the cache once the last of them is back. */
let inFlight = 0;

function patchMine(queryClient: QueryClient, me: string, change: (list: Wishlist) => Wishlist) {
  queryClient.setQueryData<Wishlist[]>(wishlistsQuery.queryKey, (lists) => {
    const current = lists ?? [];
    const mine = current.find((list) => list.personId === me) ?? { personId: me, private: false, entries: [] };
    const next = change(mine);
    return current.some((list) => list.personId === me)
      ? current.map((list) => (list.personId === me ? next : list))
      : [next, ...current];
  });
}

const withIds = (list: Wishlist, ids: string[]): Wishlist => {
  const byId = new Map(list.entries.map((entry) => [entry.itemId, entry]));
  return {
    ...list,
    entries: ids.map((itemId, index) => ({
      itemId,
      position: index + 1,
      addedAt: byId.get(itemId)?.addedAt ?? Date.now(),
    })),
  };
};

const idsOf = (queryClient: QueryClient, me: string) =>
  queryClient
    .getQueryData<Wishlist[]>(wishlistsQuery.queryKey)
    ?.find((list) => list.personId === me)
    ?.entries.map((entry) => entry.itemId) ?? [];

/** Sends one write; the shown list already changed. A failure puts the server's list back and says so. */
async function send(queryClient: QueryClient, me: string, path: string, init: { method: string; json?: unknown }) {
  inFlight++;
  void queryClient.cancelQueries({ queryKey: wishlistsQuery.queryKey });
  try {
    const { wishlist } = await api<WishlistResponse>(`/wishlists/me${path}`, init);
    if (inFlight === 1) patchMine(queryClient, me, () => wishlist);
  } catch {
    toast.error("Couldn't save your wishlist", "It's back the way it was. Try again in a moment.");
    void queryClient.invalidateQueries({ queryKey: wishlistsQuery.queryKey });
  } finally {
    inFlight--;
  }
}

/** Puts an idea on your wishlist (at the end, or at `position`), at once. */
export function addToWishlist(
  queryClient: QueryClient,
  me: string,
  item: Pick<ItemView, "id" | "pending">,
  { position, quiet }: { position?: number; quiet?: boolean } = {},
) {
  if (!canEdit(item.pending) || item.pending) return;
  const ids = idsOf(queryClient, me);
  if (ids.includes(item.id)) return;
  if (ids.length >= WISHLIST_MAX) {
    toast.message("Your wishlist is full", `It holds ${WISHLIST_MAX} ideas. Take one off to make room.`);
    return;
  }
  const at = position ? Math.min(position - 1, ids.length) : ids.length;
  patchMine(queryClient, me, (list) => withIds(list, ids.toSpliced(at, 0, item.id)));
  void send(queryClient, me, `/items/${item.id}`, { method: "PUT", json: position ? { position } : {} });
  if (quiet) return;
  toast.undo(at === 0 ? "Top of your wishlist" : `On your wishlist, at ${at + 1}`, {
    description: "Drag it up the list whenever.",
    onUndo: () => removeFromWishlist(queryClient, me, item, { quiet: true }),
  });
}

/** Takes an idea off your wishlist, at once, with an undo that puts it back in its place. */
export function removeFromWishlist(
  queryClient: QueryClient,
  me: string,
  item: Pick<ItemView, "id" | "pending">,
  { quiet }: { quiet?: boolean } = {},
) {
  if (!canEdit(item.pending)) return;
  const ids = idsOf(queryClient, me);
  const place = ids.indexOf(item.id);
  if (place < 0) return;
  patchMine(queryClient, me, (list) => withIds(list, ids.toSpliced(place, 1)));
  void send(queryClient, me, `/items/${item.id}`, { method: "DELETE" });
  if (quiet) return;
  toast.undo("Off your wishlist", {
    onUndo: () => addToWishlist(queryClient, me, item, { position: place + 1, quiet: true }),
  });
}

/** On or off your list; `quiet` where the screen shows the change itself (the picker), so no toast. */
export function toggleWishlist(
  queryClient: QueryClient,
  me: string,
  item: Pick<ItemView, "id" | "pending">,
  { quiet }: { quiet?: boolean } = {},
) {
  if (idsOf(queryClient, me).includes(item.id)) removeFromWishlist(queryClient, me, item, { quiet });
  else addToWishlist(queryClient, me, item, { quiet });
}

/** Sets your list's order (every id, top first), at once. */
export function reorderWishlist(queryClient: QueryClient, me: string, ids: string[]) {
  if (!canEdit()) return;
  const before = idsOf(queryClient, me);
  if (before.length === ids.length && before.every((id, index) => id === ids[index])) return;
  patchMine(queryClient, me, (list) => withIds(list, ids));
  void send(queryClient, me, "/order", { method: "PUT", json: { ids } });
}

/** Moves one idea a place up (-1) or down (+1). */
export function moveInWishlist(queryClient: QueryClient, me: string, id: string, step: -1 | 1) {
  reorderWishlist(queryClient, me, moveBy(idsOf(queryClient, me), id, step));
}

/** Shares your list with the others (the default) or keeps it to yourself. */
export function setWishlistPrivate(queryClient: QueryClient, me: string, value: boolean) {
  if (!canEdit()) return;
  patchMine(queryClient, me, (list) => ({ ...list, private: value }));
  void send(queryClient, me, "", { method: "PATCH", json: { private: value } });
}
