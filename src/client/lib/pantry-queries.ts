import type { PrinterResponse, Spool, SpoolAttemptsResponse, SpoolsResponse, SpoolUsageResponse } from "@shared/api";
import { DEFAULT_PRINTER, type PrinterSetup, type SpoolLike } from "@shared/spools";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * The pantry's and the printer's queries, apart from lib/pantry.ts (which holds the writes, the weighing and the photo
 * upload): the shell and Today read them on every first load, and must not pull the rest in with them.
 */

/** Every spool in the pantry. */
export const spoolsQuery = queryOptions({
  queryKey: ["spools"] as const,
  queryFn: async () => (await api<SpoolsResponse>("/spools")).spools,
  staleTime: 60_000,
});

/** How the printer is set up, and what is loaded where. */
export const printerQuery = queryOptions({
  queryKey: ["printer"] as const,
  queryFn: async () => api<PrinterResponse>("/printer"),
  staleTime: 60_000,
});

export function spoolAttemptsQuery(spoolId: string) {
  return queryOptions({
    queryKey: ["spools", spoolId, "attempts"] as const,
    queryFn: async () => (await api<SpoolAttemptsResponse>(`/spools/${spoolId}/attempts`)).attempts,
  });
}

/** What used a spool and its weighings: the history on its page. */
export function spoolUsageQuery(spoolId: string) {
  return queryOptions({
    queryKey: ["spools", spoolId, "usage"] as const,
    queryFn: async () => api<SpoolUsageResponse>(`/spools/${spoolId}/usage`),
  });
}

/** The printer's setup, or the Combo's until it has loaded: hints never wait for it. */
export function usePrinterSetup(): PrinterSetup {
  return useQuery(printerQuery).data?.setup ?? DEFAULT_PRINTER;
}

/** Spools as matching and hints need them. */
export const asSpoolLike = (spool: Spool): SpoolLike => spool;
