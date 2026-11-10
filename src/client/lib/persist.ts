import { trimCache } from "@shared/trim-cache";
import type { Query, QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { useCallback, useSyncExternalStore } from "react";
import { openStore } from "./idb";
import { rememberedUser } from "./queries";

/**
 * What Spaghetti last saw, kept on the device so it can still be read with no
 * connection. The TanStack Query cache is saved to IndexedDB (a store of its
 * own, apart from the outbox) and put back on the next visit. It only fills
 * the screen until the network answers: every restored query is refetched
 * at once, and `fetchedAt` remembers when each one last came from the server
 * (not when it was last edited here), so the offline strip never calls old
 * data current.
 *
 * Only the roots listed here are kept. A new screen that should open offline
 * adds its query's first key to `PERSISTED_ROOTS`.
 */
export const PERSISTED_ROOTS = [
  "items",
  "tags",
  "people",
  "journal",
  "facets",
  "search",
  "what-worked",
  "spools",
  "printer",
] as const;
/** The roots that are "what you saw" (the offline strip dates them); tags and people are support data. */
const SEEN_ROOTS = ["items", "journal", "search"];

/** Bump when the shape of cached data changes: older copies are dropped, not misread. */
const CACHE_VERSION = "1";
/** Forget what was seen this long ago. */
export const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
/** How many of each kept besides the item lists (which hold every item already): the most recently fetched. */
const LIMITS = { "items-detail": 40, "journal-list": 12, "journal-summary": 48, search: 10, "what-worked": 20 };
/** A rough ceiling on what is written (JSON characters). Past it, the oldest item pages go first. */
const MAX_BYTES = 3_000_000;

interface StoredCache {
  key: "client";
  /** Whose data this is: another person signing in on this device never sees it. */
  userId: string;
  client: PersistedClient;
  /** queryHash → when the server last answered it. */
  fetchedAt: Record<string, number>;
}

const store = openStore<StoredCache>("spaghetti-cache", "queries", "key");

const fetchedAt = new Map<string, number>();
const listeners = new Set<() => void>();
const changed = () => {
  for (const listener of listeners) listener();
};

/** Called by the query cache whenever a query's data arrives from the server. */
export function recordFetch(query: { queryHash: string }) {
  fetchedAt.set(query.queryHash, Date.now());
  changed();
}

/**
 * Which queries are saved: any under the listed roots that hold data. Not only
 * the successful ones: a refetch that fails (every one does offline) sets the
 * status to "error" but keeps the data, and dropping it here would wipe the
 * saved copy the next time the cache is written.
 */
export function shouldPersist(query: Query) {
  return query.state.data != null && (PERSISTED_ROOTS as readonly unknown[]).includes(query.queryKey[0]);
}

/** Writes go one after another, so a sign-out's clear can't be overtaken by a save. */
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
};

export const persister: Persister = {
  persistClient: (client) =>
    enqueue(async () => {
      const user = rememberedUser();
      // Signed out (or the session ended): nothing of theirs stays behind.
      if (!user) return store.clear();
      const trimmed = trimCache(client, fetchedAt, { limits: LIMITS, maxBytes: MAX_BYTES });
      if (!trimmed) return;
      const hashes = new Set(trimmed.clientState.queries.map((q) => q.queryHash));
      await store.put({
        key: "client",
        userId: user.id,
        client: trimmed,
        fetchedAt: Object.fromEntries([...fetchedAt].filter(([hash]) => hashes.has(hash))),
      });
    }).catch(() => undefined),
  restoreClient: () =>
    enqueue(async () => {
      const stored = await store.get("client");
      const user = rememberedUser();
      if (!stored || !user || stored.userId !== user.id) {
        if (stored) await store.clear();
        return undefined;
      }
      for (const [hash, time] of Object.entries(stored.fetchedAt)) {
        if (!fetchedAt.has(hash)) fetchedAt.set(hash, time);
      }
      changed();
      return stored.client;
    }).catch(() => undefined),
  removeClient: () => clearPersistedQueries(),
};

export const persistOptions = {
  persister,
  maxAge: MAX_AGE,
  buster: CACHE_VERSION,
  dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
};

/** Forgets everything kept for offline reading. Signing out calls it, like the photo cache. */
export function clearPersistedQueries(): Promise<void> {
  fetchedAt.clear();
  changed();
  return enqueue(() => store.clear()).catch(() => undefined);
}

/** Restored data is stale by definition: ask the server again for everything that is on screen or comes next. */
export function refetchRestored(queryClient: QueryClient) {
  void queryClient.invalidateQueries({
    predicate: (query) => (PERSISTED_ROOTS as readonly unknown[]).includes(query.queryKey[0]),
  });
}

/**
 * When the oldest item data on screen last came from the server, or null when
 * nothing on screen is data. Optimistic edits don't move it: only the server's
 * answer does, which is what lets the offline strip stay honest.
 */
export function useLastSeen(): number | null {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  const subscribe = useCallback(
    (listener: () => void) => {
      listeners.add(listener);
      const unsubscribe = cache.subscribe(listener);
      return () => {
        listeners.delete(listener);
        unsubscribe();
      };
    },
    [cache],
  );
  // A string snapshot is stable across renders when nothing moved.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => {
      let oldest: number | null = null;
      for (const query of cache.findAll({ type: "active" })) {
        if (!SEEN_ROOTS.includes(query.queryKey[0] as string) || query.state.data == null) continue;
        const time = fetchedAt.get(query.queryHash) ?? query.state.dataUpdatedAt;
        if (oldest === null || time < oldest) oldest = time;
      }
      return oldest === null ? "" : String(oldest);
    },
    () => "",
  );
  return snapshot ? Number(snapshot) : null;
}
