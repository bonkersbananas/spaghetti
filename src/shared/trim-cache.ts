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
 * The group a query is capped with: item pages ("items-detail"), the
 * journal's lists and its month summaries separately ("journal-list",
 * "journal-summary": a screen loads many summaries per list), or the first
 * key of anything else ("search"…). The two item lists have no group: they
 * always stay.
 */
export function cacheGroup(query: Pick<CachedQuery, "queryKey">): string | null {
  const [root, second] = query.queryKey;
  if (root === "items") return second === "detail" ? "items-detail" : null;
  if (root === "journal") return `journal-${String(second)}`;
  return String(root);
}

/**
 * Keeps what is saved for offline reading within bounds: the item lists
 * always stay, every other group keeps its `limits[group]` most recently
 * fetched queries (none given: all), and the oldest of the capped ones go
 * first while the copy is over `maxBytes`. Returns null when what can't be
 * dropped is already too big (the earlier copy is then left alone).
 */
export function trimCache<Q extends CachedQuery, C extends CachedClient<Q>>(
  client: C,
  fetchedAt: ReadonlyMap<string, number>,
  { limits, maxBytes }: { limits: Readonly<Record<string, number>>; maxBytes: number },
): C | null {
  const queries = client.clientState.queries;
  const when = (query: Q) => fetchedAt.get(query.queryHash) ?? query.state.dataUpdatedAt;
  const keep = new Set<Q>(queries);
  const droppable: Q[] = [];
  const groups = new Map<string, Q[]>();
  for (const query of queries) {
    const group = cacheGroup(query);
    if (group !== null && group in limits) groups.set(group, [...(groups.get(group) ?? []), query]);
  }
  for (const [group, members] of groups) {
    const newest = members.sort((a, b) => when(b) - when(a));
    for (const extra of newest.slice(limits[group] ?? newest.length)) keep.delete(extra);
    droppable.push(...newest.slice(0, limits[group] ?? newest.length));
  }
  const build = (): C => ({
    ...client,
    clientState: { ...client.clientState, queries: queries.filter((query) => keep.has(query)) },
  });
  let next = build();
  let size = JSON.stringify(next).length;
  // Oldest first, across groups.
  for (const query of droppable.sort((a, b) => when(a) - when(b))) {
    if (size <= maxBytes) break;
    keep.delete(query);
    next = build();
    size = JSON.stringify(next).length;
  }
  return size <= maxBytes ? next : null;
}
