import type { FacetsResponse, JournalResponse, JournalSummaryResponse } from "@shared/api";
import { OUTCOME_FILTERS, type OutcomeFilter } from "@shared/journal";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "./api";

/** What the journal and search can be narrowed to. Kept in the URL. */
export interface Filters {
  outcome?: OutcomeFilter;
  /** A filament type, uppercase: "PETG". */
  material?: string;
  /** A username: "sam". */
  person?: string;
  /** A failure tag or success note slug (search only). */
  tag?: string;
}

/** Reads filters from a URL's search params, dropping anything unknown. */
export function readFilters(search: Record<string, unknown>): Filters {
  const text = (value: unknown, max = 48) =>
    typeof value === "string" && value.trim() && value.length <= max ? value.trim() : undefined;
  const outcome = OUTCOME_FILTERS.find((value) => value === search.outcome);
  const tag = text(search.tag);
  return {
    ...(outcome ? { outcome } : {}),
    ...(text(search.material) ? { material: text(search.material)?.toUpperCase() } : {}),
    ...(text(search.person) ? { person: text(search.person) } : {}),
    ...(tag && /^[a-z0-9-]+$/.test(tag) ? { tag } : {}),
  };
}

export const hasFilters = (filters: Filters) =>
  !!(filters.outcome || filters.material || filters.person || filters.tag);

/** Filters as the API takes them: a person by id, not username. */
export function filterParams(filters: Filters, personId: string | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.material) params.set("material", filters.material);
  if (filters.tag) params.set("tag", filters.tag);
  if (filters.person) params.set("person", personId ?? "nobody");
  return params;
}

export const journalKeys = {
  all: ["journal"] as const,
  list: (params: string) => ["journal", "list", params] as const,
  summary: (from: number, to: number) => ["journal", "summary", from, to] as const,
};

/** The journal, newest first, a page at a time. Always refetched on a visit: it's a view of everything. */
export function journalQuery(params: URLSearchParams) {
  const key = params.toString();
  return infiniteQueryOptions({
    queryKey: journalKeys.list(key),
    queryFn: async ({ pageParam }) => {
      const page = new URLSearchParams(params);
      if (pageParam) page.set("cursor", pageParam);
      return api<JournalResponse>(`/journal?${page}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
    staleTime: 0,
  });
}

/** One month in numbers, for its heading. */
export function summaryQuery(from: number, to: number) {
  return queryOptions({
    queryKey: journalKeys.summary(from, to),
    queryFn: async () => (await api<JournalSummaryResponse>(`/journal/summary?from=${from}&to=${to}`)).summary,
    staleTime: 0,
  });
}

/** Materials and tags in use, for filter chips and search suggestions. */
export const facetsQuery = queryOptions({
  queryKey: ["facets"] as const,
  queryFn: () => api<FacetsResponse>("/facets"),
  staleTime: 0,
});
