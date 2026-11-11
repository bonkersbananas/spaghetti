/**
 * Wishlists: each person's ranked list of the ideas they would print first. Shared with the
 * others who sign in unless its owner keeps it private. Only ideas are on a list: an idea that
 * was deleted or became a build drops out (and comes back in its place if that is undone).
 */

/** A list holds at most this many ideas: it is for the top ones, not a second inbox. */
export const WISHLIST_MAX = 50;

export interface WishlistEntry {
  itemId: string;
  /** 1 is the top. */
  position: number;
  addedAt: number;
}

export interface Wishlist {
  /** The person whose list it is. */
  personId: string;
  /** Kept to themselves. Someone else's private list comes with no entries. */
  private: boolean;
  /** Top first. */
  entries: WishlistEntry[];
}

/** GET /api/wishlists: everyone's, yours first. */
export interface WishlistsResponse {
  wishlists: Wishlist[];
}

/** Every write to your own list answers with it. */
export interface WishlistResponse {
  wishlist: Wishlist;
}

/** Moves `id` to where `target` is (before it when moving up, after it when moving down). */
export function moveTo(ids: readonly string[], id: string, target: string): string[] {
  const next = [...ids];
  const from = next.indexOf(id);
  const to = next.indexOf(target);
  if (from < 0 || to < 0 || from === to) return next;
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Moves `id` one place up (-1) or down (+1); unchanged at the ends. */
export function moveBy(ids: readonly string[], id: string, step: number): string[] {
  const from = ids.indexOf(id);
  const target = ids[from + step];
  return from < 0 || target === undefined ? [...ids] : moveTo(ids, id, target);
}
