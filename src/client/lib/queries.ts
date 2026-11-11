import type { LinkPreviewResponse, PeopleResponse, Person, SessionResponse, ShoppingItemsResponse } from "@shared/api";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, api } from "./api";

/** The signed-in person, or null when signed out. */
export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: async () => {
    try {
      const { user } = await api<SessionResponse>("/session");
      rememberUser(user);
      return user;
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status !== 401) throw error;
        rememberUser(null);
        return null;
      }
      // No connection: the app opens as the person who was signed in, so a
      // capture next to the printer works. The server checks the session again
      // as soon as it can be reached, and a 401 then signs them out.
      return rememberedUser();
    }
  },
  staleTime: 5 * 60 * 1000,
});

/** Both people in the workspace, for avatars beside what they wrote. */
export const peopleQuery = queryOptions({
  queryKey: ["people"],
  queryFn: async () => (await api<PeopleResponse>("/people")).people,
  staleTime: 60 * 60 * 1000,
});

/**
 * What a link in a note calls itself (its page title and site), for link
 * cards. A page's title hardly changes, so a day is fresh; a link that can't
 * be read (offline, a private address, no title) just keeps showing its address.
 */
export function linkPreviewQuery(url: string) {
  return queryOptions({
    queryKey: ["link-preview", url],
    queryFn: async () => api<LinkPreviewResponse>(`/links/preview?url=${encodeURIComponent(url)}`),
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 7 * 24 * 60 * 60 * 1000,
    retry: false,
  });
}

const USER_KEY = "sg-user";

/** Who signed in on this device, kept so the app can open without a connection. */
export function rememberedUser(): Person | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as Person | null) : null;
  } catch {
    return null;
  }
}

export function rememberUser(user: Person | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    // Private mode: the app just needs a connection to open.
  }
}

/** Shopping items, from /api/shopping-items. Mutations update this cache optimistically (see lib/items.ts). */
export const shoppingItemsQuery = queryOptions({
  queryKey: ["shopping-items"],
  queryFn: async () => (await api<ShoppingItemsResponse>("/shopping-items")).shoppingItems,
});
