import { namingUntil } from "@shared/title";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useReducer } from "react";
import { featuresQuery } from "./features";
import type { ItemView } from "./items";

/**
 * Whether Claude is naming this idea right now (decision 0071): the screens show "Naming…" in place of its title. It
 * stops by itself: when the title or the end of the job arrives through the change feed, or at the timeout.
 */
export function useNaming(
  item: Pick<ItemView, "stage" | "title" | "note" | "photos" | "createdAt" | "createdVia" | "titleJob">,
): boolean {
  const titlesOn = useQuery(featuresQuery).data?.titles === true;
  const until = namingUntil({ ...item, photos: item.photos.filter((photo) => !photo.attemptId).length }, titlesOn);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (until === null || until <= Date.now()) return;
    // Drawn again when the time is up, so the sign goes even if nothing else changes.
    const timer = setTimeout(tick, until - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return until !== null && until > Date.now();
}
