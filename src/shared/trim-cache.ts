/** The part of a dehydrated query the size cap looks at. */
export interface CachedQuery {
  queryKey: readonly unknown[];
  queryHash: string;
  state: { dataUpdatedAt: number };
}

export interface CachedClient<Q extends CachedQuery> {
  clientState: { queries: Q[] };
}

/**
 * Keeps what is saved for offline reading within bounds: every list stays,
 * item pages are limited to the `maxDetails` most recently fetched, and
 * the oldest of those go first while the copy is over `maxBytes`. Returns null
 * when even the lists alone are too big (the earlier copy is then left alone).
 */
export function trimCache<Q extends CachedQuery, C extends CachedClient<Q>>(
  client: C,
  fetchedAt: ReadonlyMap<string, number>,
  { maxDetails, maxBytes }: { maxDetails: number; maxBytes: number },
): C | null {
  const queries = client.clientState.queries;
  const isDetail = (query: Q) => query.queryKey[1] === "detail";
  const when = (query: Q) => fetchedAt.get(query.queryHash) ?? query.state.dataUpdatedAt;
  const details = queries
    .filter(isDetail)
    .sort((a, b) => when(b) - when(a))
    .slice(0, maxDetails);
  const keep = new Set<Q>([...queries.filter((query) => !isDetail(query)), ...details]);
  const build = (): C => ({
    ...client,
    clientState: { ...client.clientState, queries: queries.filter((query) => keep.has(query)) },
  });
  let next = build();
  let size = JSON.stringify(next).length;
  for (const detail of [...details].reverse()) {
    if (size <= maxBytes) break;
    keep.delete(detail);
    next = build();
    size = JSON.stringify(next).length;
  }
  return size <= maxBytes ? next : null;
}
