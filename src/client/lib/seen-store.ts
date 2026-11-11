import type { QueryCache, QueryCacheNotifyEvent } from "@tanstack/react-query";

/**
 * The cache events that can change "when was this data last seen" (lib/persist.ts, useLastSeen): a query of a watched
 * root arriving, leaving, changing state, or gaining or losing its last observer (it counts only while on screen).
 * An observer's own result updates ("observerResultsUpdated", "observerOptionsUpdated") can't change it, and every
 * card's useQuery fires them, many in one React commit.
 */
const SNAPSHOT_EVENTS = new Set<QueryCacheNotifyEvent["type"]>([
  "added",
  "removed",
  "updated",
  "observerAdded",
  "observerRemoved",
]);

/**
 * Subscribes `listener` (a useSyncExternalStore store-change callback) to the query cache, for the queries under
 * `roots` only, and tells it after the current work rather than in the middle of it: changes are coalesced into one
 * call on a microtask. Calling it synchronously from inside another component's commit (a grid of cards subscribing
 * at once) forced one nested re-render per cache event, and past 50 React threw "Maximum update depth exceeded"
 * (issue #60). `notify` lets other changes (a fetch time recorded) go through the same coalescing.
 */
export function subscribeToSeen(
  cache: Pick<QueryCache, "subscribe">,
  roots: readonly string[],
  listener: () => void,
  schedule: (task: () => void) => void = queueMicrotask,
): { notify: () => void; unsubscribe: () => void } {
  let pending = false;
  let active = true;
  const notify = () => {
    if (pending || !active) return;
    pending = true;
    schedule(() => {
      pending = false;
      if (active) listener();
    });
  };
  const stop = cache.subscribe((event) => {
    if (!SNAPSHOT_EVENTS.has(event.type)) return;
    if (!roots.includes(event.query.queryKey[0] as string)) return;
    notify();
  });
  return {
    notify,
    unsubscribe: () => {
      active = false;
      stop();
    },
  };
}
