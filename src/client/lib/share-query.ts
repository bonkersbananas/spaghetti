import type { Share, ShareKind, SharesResponse } from "@shared/shares";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { api } from "./api";

/**
 * The live public links (decision 0075), for the share button's "shared" look on a detail page. Kept apart from
 * lib/shares.ts (making and stopping links), which loads only with the share panel. Not persisted: offline, a page
 * just doesn't know whether it is shared.
 */
export const sharesQuery = queryOptions({
  queryKey: ["shares"],
  queryFn: () => api<SharesResponse>("/shares"),
  staleTime: 60_000,
});

/** The live public link of one idea, build or twist, if it has one. */
export function useShareOf(kind: ShareKind, targetId: string): Share | undefined {
  const { data } = useQuery(sharesQuery);
  return data?.shares.find((share) => share.kind === kind && share.targetId === targetId);
}
