import type { ItemStage } from "./api.ts";

/** Deleted things stay restorable this long, then the daily purge removes them (decision 0006). */
export const PURGE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether a build began as an idea: it was captured, and started later. A build made from scratch
 * (the New build tile, the printer bridge) starts when it is created, so its two times are equal.
 * Scrapping such a build sends it back to Ideas instead of deleting it.
 */
export function beganAsIdea(item: { stage: ItemStage; createdAt: number; startedAt: number | null }): boolean {
  return item.stage !== "idea" && item.startedAt !== null && item.startedAt > item.createdAt;
}

/** Whole days left before something deleted at `deletedAt` goes for good; at least 1 while it is still here. */
export function daysLeft(deletedAt: number, now: number): number {
  return Math.max(1, Math.ceil((deletedAt + PURGE_AFTER_MS - now) / (24 * 60 * 60 * 1000)));
}
