import type { SearchResponse, WhatWorkedResponse } from "@shared/api";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** The search box's id, so "/" can focus it from anywhere. */
export const SEARCH_BOX_ID = "search-box";

/** Focuses the search box once it is on the page. */
export function focusSearch() {
  requestAnimationFrame(() => document.getElementById(SEARCH_BOX_ID)?.focus());
}

/**
 * Search results for a query and filters. The results answer `q`, which the
 * screen uses to mark what matched, and the last results stay on screen while
 * the next arrive.
 */
export function searchQuery(q: string, params: URLSearchParams) {
  const all = new URLSearchParams(params);
  if (q) all.set("q", q);
  // So "last week" starts on this person's Monday.
  all.set("tz", String(-new Date().getTimezoneOffset()));
  return queryOptions({
    queryKey: ["search", all.toString()] as const,
    queryFn: async ({ signal }) => ({ ...(await api<SearchResponse>(`/search?${all}`, { signal })), q }),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** "What worked last time" for an attempt about to be logged on this build, with this material. */
export function whatWorkedQuery(itemId: string, material: string | undefined) {
  const params = new URLSearchParams({ item: itemId });
  if (material) params.set("material", material);
  return queryOptions({
    queryKey: ["what-worked", itemId, material?.toUpperCase() ?? null] as const,
    queryFn: async () => (await api<WhatWorkedResponse>(`/what-worked?${params}`)).matches,
    staleTime: 0,
  });
}

const RECENT_KEY = "sg-recent-searches";
const RECENT_MAX = 6;

/** Searches made on this device, newest first. */
export function recentSearches(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** Remembers a search someone followed through on; returns the new list. */
export function rememberSearch(query: string): string[] {
  const trimmed = query.trim().replace(/\s+/g, " ");
  const list = recentSearches();
  if (trimmed.length < 2) return list;
  const next = [trimmed, ...list.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Private mode: nothing remembered.
  }
  return next;
}

export function forgetSearches(): string[] {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {
    // Nothing to forget.
  }
  return [];
}
