import type { QueryClient } from "@tanstack/react-query";
import { featuresQuery } from "@/lib/features";
import { scoutQuery } from "@/lib/scout";
import { unreadQuery } from "@/lib/unread-comments";
import { upkeepQuery } from "@/lib/upkeep";

/**
 * The quiet lines of the phone's Now block, in a chunk of their own that Now asks for as soon as its own code runs (so
 * the Journal's first load doesn't list their files), and waits for before it first shows (so none arrives after it).
 */
export { default as ScoutRow } from "@/components/scout/ScoutRow";
export { default as CommentsLine } from "@/components/today/CommentsLine";
export { default as UpkeepLine } from "@/components/today/UpkeepLine";

/** How long a first visit waits for the lines' answers before the block shows without them. */
const FIRST_ANSWERS_MS = 1000;

/**
 * Whether this device has yet to hear what the lines draw from: a first visit, with nothing kept from last time. Only
 * answers the device keeps (lib/persist.ts) count: the features aren't kept, and waiting on them held every resumed app.
 */
export const missingAnswers = (queryClient: QueryClient) =>
  [unreadQuery, upkeepQuery].some((query) => queryClient.getQueryData(query.queryKey) === undefined);

/**
 * On a first visit, the lines' answers, waited for a moment so they don't arrive after the block and push the notebook
 * down (the Journal shows a skeleton meanwhile). Answers kept from last time wait for nothing, nor does a phone offline.
 */
export function firstAnswers(queryClient: QueryClient): Promise<unknown> {
  if (!missingAnswers(queryClient) || !navigator.onLine) return Promise.resolve();
  return Promise.race([
    Promise.allSettled([
      queryClient.fetchQuery(unreadQuery),
      queryClient.fetchQuery(upkeepQuery),
      queryClient
        .fetchQuery(featuresQuery)
        .then((features) => (features.scout ? queryClient.fetchQuery(scoutQuery) : null)),
    ]),
    new Promise((resolve) => setTimeout(resolve, FIRST_ANSWERS_MS)),
  ]);
}
